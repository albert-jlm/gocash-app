#!/usr/bin/env bash
# ===========================================================================
# Database-level test runner.
#
# Builds a throwaway database from supabase/migrations/, runs the two layers
# of assertions against it, prints a summary, drops the database, and exits
# non-zero if anything failed.
#
#   ./tests/run.sh              # build, test, drop
#   ./tests/run.sh --keep       # leave the scratch database for inspection
#
# WHY A SCRATCH DATABASE EVERY TIME
# The migrations are a squashed dump of a schema that was built by hand, so
# the only way to know they still reproduce it is to replay them from nothing.
# A long-lived test database would drift exactly the way production did — the
# drift Audit #5a spent its entire scope documenting. This also means the run
# proves the migrations are replayable, which is a regression test in itself:
# 20260923000001 originally passed on production and failed everywhere else,
# because it relied on a grant that only existed live.
#
# SAFETY
# Every statement goes through psql_scratch(), which refuses any database name
# not matching gocash_test_[0-9a-z_]+. The name is generated per run from the
# pid and the clock, so concurrent and repeated runs cannot collide, and the
# drop runs from an EXIT trap so an assertion failure still cleans up. Nothing
# here connects to `postgres` except to CREATE and DROP that one database.
# ===========================================================================

set -Eeuo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TESTS_DIR/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

# The migrations must be applied as a superuser. On this instance `postgres` is
# neither a superuser nor a member of supabase_admin, so REVOKE statements
# produce "WARNING: no privileges could be revoked" and change nothing, and
# CREATE EVENT TRIGGER is refused outright. Both failures are silent enough to
# produce a green run against an unprotected database.
DB_USER="${GOCASH_TEST_DB_USER:-supabase_admin}"
DB_CONTAINER="${GOCASH_TEST_DB_CONTAINER:-supabase-db}"
ADMIN_DB="${GOCASH_TEST_ADMIN_DB:-postgres}"

SCRATCH_DB="gocash_test_$$_$(date +%s)"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'
  C_DIM=$'\033[2m';  C_BLD=$'\033[1m';  C_OFF=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YEL=''; C_DIM=''; C_BLD=''; C_OFF=''
fi

say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$C_BLD" "$C_OFF" "$*"; }
die()  { printf '%sERROR:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 2; }

# ---------------------------------------------------------------------------
# psql plumbing.
#
# Runs through `docker exec` when the Supabase container is present, and falls
# back to a local psql otherwise, so this works on a workstation with a direct
# connection as well as against the homelab stack. Override the whole thing
# with GOCASH_TEST_PSQL if neither fits.
# ---------------------------------------------------------------------------
if [[ -n "${GOCASH_TEST_PSQL:-}" ]]; then
  # shellcheck disable=SC2206
  PSQL_BASE=( $GOCASH_TEST_PSQL )
elif command -v docker >/dev/null 2>&1 \
     && docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  PSQL_BASE=( docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" )
elif command -v psql >/dev/null 2>&1; then
  PSQL_BASE=( psql -U "$DB_USER" )
else
  die "no way to reach postgres: container '$DB_CONTAINER' is not running and psql is not on PATH.
       Set GOCASH_TEST_PSQL to a psql command prefix, or GOCASH_TEST_DB_CONTAINER."
fi

# --- the guard -------------------------------------------------------------
# The single choke point. Nothing in this script talks to a database without
# passing through here, so a scratch name that does not match the pattern
# cannot be created, connected to, or dropped.
assert_scratch_name() {
  [[ "$1" =~ ^gocash_test_[0-9a-z_]+$ ]] \
    || die "refusing to touch database '$1': only gocash_test_* is allowed"
}

psql_scratch() {                       # psql_scratch <args...>  (on SCRATCH_DB)
  assert_scratch_name "$SCRATCH_DB"
  "${PSQL_BASE[@]}" -d "$SCRATCH_DB" -v ON_ERROR_STOP=1 -q "$@"
}

psql_admin() {                         # psql_admin <sql>  (create/drop only)
  # The leading SET keeps "database does not exist, skipping" off the console
  # on a fresh run. Real problems are WARNING or above and still print.
  "${PSQL_BASE[@]}" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 -q \
    -c "SET client_min_messages = warning" -c "$1"
}

drop_scratch() {
  assert_scratch_name "$SCRATCH_DB"
  psql_admin "DROP DATABASE IF EXISTS $SCRATCH_DB WITH (FORCE);" >/dev/null 2>&1 || true
}

cleanup() {
  local rc=$?
  if (( KEEP )); then
    say ""
    say "${C_YEL}--keep:${C_OFF} scratch database left in place: ${C_BLD}$SCRATCH_DB${C_OFF}"
    say "  ${C_DIM}docker exec -it $DB_CONTAINER psql -U $DB_USER -d $SCRATCH_DB${C_OFF}"
    say "  ${C_DIM}drop it with: DROP DATABASE $SCRATCH_DB;${C_OFF}"
  else
    drop_scratch
  fi
  exit "$rc"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Build the schema from nothing.
# ---------------------------------------------------------------------------
say ""
say "${C_BLD}gocash database harness${C_OFF}  ${C_DIM}(scratch db: $SCRATCH_DB)${C_OFF}"
say ""

[[ -d "$MIGRATIONS_DIR" ]] || die "no migrations directory at $MIGRATIONS_DIR"

step "creating scratch database"
assert_scratch_name "$SCRATCH_DB"
# Repeatable by construction: the name is unique per run, and this drops any
# leftover of the same name before creating.
psql_admin "DROP DATABASE IF EXISTS $SCRATCH_DB WITH (FORCE);" >/dev/null
psql_admin "CREATE DATABASE $SCRATCH_DB;" >/dev/null

step "applying stubs (auth schema, extensions, auth.uid)"
psql_scratch -f - < "$TESTS_DIR/lib/stubs.sql" >/dev/null

step "applying migrations in filename order"
shopt -s nullglob
migrations=( "$MIGRATIONS_DIR"/*.sql )
shopt -u nullglob
(( ${#migrations[@]} > 0 )) || die "no .sql files in $MIGRATIONS_DIR"

# Sorted by filename — the ordering the migration timestamps encode.
IFS=$'\n' migrations=( $(printf '%s\n' "${migrations[@]}" | sort) ); unset IFS

for m in "${migrations[@]}"; do
  printf '    %s ... ' "$(basename "$m")"
  if psql_scratch -f - < "$m" >/dev/null 2>"$TESTS_DIR/.last_migration_error"; then
    printf '%sok%s\n' "$C_GRN" "$C_OFF"
  else
    printf '%sFAILED%s\n' "$C_RED" "$C_OFF"
    say ""
    say "${C_RED}The migration itself failed to apply. This is a schema problem, not a"
    say "test problem — the harness never got as far as asserting anything.${C_OFF}"
    say ""
    sed 's/^/    /' "$TESTS_DIR/.last_migration_error" >&2 || true
    rm -f "$TESTS_DIR/.last_migration_error"
    exit 2
  fi
done
rm -f "$TESTS_DIR/.last_migration_error"

# ---------------------------------------------------------------------------
# 2. Run the assertions.
# ---------------------------------------------------------------------------
step "loading harness"
psql_scratch -f - < "$TESTS_DIR/lib/harness.sql" >/dev/null

run_layer() {                          # run_layer <file> <label>
  local file="$1" label="$2"
  step "running $label"
  if ! psql_scratch -f - < "$file" >/dev/null; then
    say ""
    say "${C_RED}$label aborted part-way through.${C_OFF} Everything it had already"
    say "asserted is reported below; anything after the abort never ran."
    say ""
    return 1
  fi
}

layers_ok=0
run_layer "$TESTS_DIR/layer1_authorization.sql"     "layer 1 — authorization" || layers_ok=1
run_layer "$TESTS_DIR/layer2_ledger_invariants.sql" "layer 2 — ledger invariants" || layers_ok=1

# ---------------------------------------------------------------------------
# 3. Report.
# ---------------------------------------------------------------------------
q() { psql_scratch -tAX -c "$1"; }

say ""
say "${C_BLD}results${C_OFF}"
say ""
psql_scratch -tAX -c "SELECT harness.report();" \
  | sed -e "s/^  PASS/  ${C_GRN}PASS${C_OFF}/" \
        -e "s/^  FAIL/  ${C_RED}FAIL${C_OFF}/" \
        -e "s/^  GAP /  ${C_YEL}GAP ${C_OFF}/"

total=$(q "SELECT count(*) FROM harness.results;")
passed=$(q "SELECT count(*) FROM harness.results WHERE status = 'PASS';")
failed=$(q "SELECT harness.failure_count();")
gaps=$(q "SELECT count(*) FROM harness.results WHERE status = 'GAP';")
l1=$(q "SELECT harness.assertion_count('layer1');")
l2=$(q "SELECT harness.assertion_count('layer2');")

say ""
say "────────────────────────────────────────────────────────────────────────"
printf '  %s assertions: %s%s passed%s, %s%s failed%s' \
  "$total" "$C_GRN" "$passed" "$C_OFF" \
  "$( [[ "$failed" == "0" ]] && echo "$C_DIM" || echo "$C_RED" )" "$failed" "$C_OFF"
# NOTE: written as an `if` rather than `(( ... )) && printf`. Under `set -e`
# that one-liner returns exit 1 when the count is zero and kills the run, so a
# suite with no known gaps reported FAILED despite every assertion passing.
if (( gaps > 0 )); then
  printf ', %s%s known gap(s)%s' "$C_YEL" "$gaps" "$C_OFF"
fi
printf '\n'
say "────────────────────────────────────────────────────────────────────────"

# A green run that asserted nothing is the failure mode this whole harness
# exists to prevent, so refuse to report success on an empty layer.
if (( l1 == 0 )) || (( l2 == 0 )); then
  say ""
  die "a layer contributed no assertions (layer1=$l1, layer2=$l2). A run that
       asserts nothing must never report success."
fi

if (( gaps > 0 )); then
  say ""
  say "${C_YEL}Known gaps are real defects, proven by this run, in files this harness"
  say "does not own. They do not fail the gate; they are listed above with the"
  say "follow-up that owns each fix. If one stops reproducing it becomes a hard"
  say "FAIL telling you to promote it.${C_OFF}"
fi

if (( failed > 0 )) || (( layers_ok != 0 )); then
  say ""
  say "${C_RED}FAILED${C_OFF}"
  exit 1
fi

say ""
say "${C_GRN}PASSED${C_OFF}"

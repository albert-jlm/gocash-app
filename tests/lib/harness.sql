-- ===========================================================================
-- The assertion harness.
--
-- WHY THIS EXISTS RATHER THAN A PILE OF psql SCRIPTS
-- The invariants in layer 2 are mostly NEGATIVE: the database must REFUSE
-- something. A plain psql script cannot express "this statement must fail"
-- without either aborting the run or swallowing every error including the
-- ones that mean the test itself is broken. So each assertion runs inside a
-- plpgsql subtransaction, its outcome is compared against what was expected,
-- and the verdict is recorded in a table that survives the rollback.
--
-- Three properties this buys, all of which the project has been burned by:
--
--   1. A test that PASSES VACUOUSLY is a failure. `expect_error` fails if the
--      statements are accepted AND fails if they are rejected for the wrong
--      reason. Audit #5a's root cause was an assertion (on pg_default_acl)
--      that passed while protecting nothing; "it errored, good enough" is the
--      same mistake one level down.
--
--   2. Every assertion carries its own `invariant` string explaining what real
--      defect it guards. That text is printed on failure, so the output names
--      the broken invariant instead of just echoing a Postgres error.
--
--   3. Passing tests leave no residue. A successful `expect_*` rolls itself
--      back via a sentinel exception, so the final "the books are clean"
--      check at the end of layer 2 is meaningful rather than a tautology.
--
-- Deferred constraints: gocash.postings_must_balance is a DEFERRABLE
-- INITIALLY DEFERRED constraint trigger, so it fires at COMMIT — which in a
-- plpgsql subtransaction never arrives. Every runner below therefore ends
-- with `SET CONSTRAINTS ALL IMMEDIATE`, which forces the pending deferred
-- checks to run at that point. That is the same check the same trigger would
-- perform at COMMIT; it is not a weaker substitute. Doing it centrally means
-- an individual test cannot forget it and silently pass.
-- ===========================================================================

-- Incidental NOTICEs (the event trigger announcing each auto-revoke, DROP ...
-- IF EXISTS on a fresh database) would bury the assertion output. Real
-- problems are WARNING or above and still come through.
SET client_min_messages = warning;

DROP SCHEMA IF EXISTS harness CASCADE;
CREATE SCHEMA harness;

CREATE TABLE harness.results (
  seq       SERIAL PRIMARY KEY,
  layer     TEXT NOT NULL,
  name      TEXT NOT NULL,
  -- WHY the assertion exists and what real defect it guards. Printed on
  -- failure; this is the part that makes the output legible.
  invariant TEXT NOT NULL,
  -- GAP: a real defect the harness has proven, in a file this worker does not
  -- own. Reported loudly, separately, and does not fail the gate. See
  -- harness.expect_no_rows_known_gap below for why that cannot become a
  -- hiding place.
  status    TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'GAP')),
  detail    TEXT
);

-- ---------------------------------------------------------------------------
-- record — the only writer. Kept separate so it can be called from inside an
-- EXCEPTION handler, at which point plpgsql has already rolled the failed
-- subtransaction back and the INSERT lands in the surviving outer context.
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.record(
  p_layer     TEXT,
  p_name      TEXT,
  p_invariant TEXT,
  p_ok        BOOLEAN,
  p_detail    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO harness.results (layer, name, invariant, status, detail)
  VALUES (p_layer, p_name, p_invariant,
          CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END,
          NULLIF(btrim(COALESCE(p_detail, '')), ''));
END;
$$;

-- ---------------------------------------------------------------------------
-- expect_error — the statements MUST be rejected, and rejected for the stated
-- reason.
--
-- p_expect is matched case-insensitively against the error message. Passing a
-- substring of the message the schema actually raises is deliberate: if
-- someone replaces a specific guard with a blunter one (say, drops the
-- balance trigger and lets a NOT NULL fail instead), the statement still
-- errors but this test still fails. "Something went wrong" is not the
-- invariant; "THIS went wrong" is.
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.expect_error(
  p_layer     TEXT,
  p_name      TEXT,
  p_invariant TEXT,
  p_stmts     TEXT[],
  p_expect    TEXT
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  s          TEXT;
  v_msg      TEXT;
  v_state    TEXT;
  v_errored  BOOLEAN := TRUE;
BEGIN
  BEGIN
    FOREACH s IN ARRAY p_stmts LOOP
      EXECUTE s;
    END LOOP;
    -- Force any DEFERRABLE INITIALLY DEFERRED check to happen now; see header.
    SET CONSTRAINTS ALL IMMEDIATE;
    -- Nothing objected. Unwind anyway so a failing test leaves no rows behind,
    -- and flag it below.
    RAISE EXCEPTION '__harness_accepted__';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_msg   := SQLERRM;
    IF v_msg = '__harness_accepted__' THEN
      v_errored := FALSE;
    END IF;
  END;

  IF NOT v_errored THEN
    PERFORM harness.record(p_layer, p_name, p_invariant, FALSE,
      format('statements were ACCEPTED; expected rejection containing %L. '
             'The guard is missing or was removed.', p_expect));
  ELSIF position(lower(p_expect) IN lower(v_msg)) > 0 THEN
    PERFORM harness.record(p_layer, p_name, p_invariant, TRUE,
      format('rejected as expected [%s] %s', v_state, v_msg));
  ELSE
    PERFORM harness.record(p_layer, p_name, p_invariant, FALSE,
      format('rejected, but by the WRONG guard. expected a message containing '
             '%L, got [%s] %s', p_expect, v_state, v_msg));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- expect_ok — the statements MUST be accepted.
--
-- p_persist=FALSE (default) rolls the work back so the assertion is free of
-- side effects. p_persist=TRUE keeps it, for the one test that has to leave
-- real rows behind for the balance assertions that follow.
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.expect_ok(
  p_layer     TEXT,
  p_name      TEXT,
  p_invariant TEXT,
  p_stmts     TEXT[],
  p_persist   BOOLEAN DEFAULT FALSE
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  s       TEXT;
  v_msg   TEXT;
  v_state TEXT;
  v_ok    BOOLEAN := TRUE;
BEGIN
  BEGIN
    FOREACH s IN ARRAY p_stmts LOOP
      EXECUTE s;
    END LOOP;
    SET CONSTRAINTS ALL IMMEDIATE;
    IF NOT p_persist THEN
      RAISE EXCEPTION '__harness_rollback__';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_msg   := SQLERRM;
    IF v_msg <> '__harness_rollback__' THEN
      v_ok := FALSE;
    END IF;
  END;

  IF v_ok THEN
    PERFORM harness.record(p_layer, p_name, p_invariant, TRUE, NULL);
  ELSE
    PERFORM harness.record(p_layer, p_name, p_invariant, FALSE,
      format('statements were REJECTED but should have been accepted: [%s] %s',
             v_state, v_msg));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- probe — run some statements, evaluate a boolean about the resulting state,
-- then ALWAYS roll back.
--
-- For invariants where the expected outcome is that bad data is DETECTED
-- rather than rejected: the zero-posting entry, which no trigger can catch
-- and which gocash.unbalanced_entries exists to surface. Writing that row and
-- leaving it committed would poison the "books are clean" check at the end of
-- layer 2, and gocash.ledger_entries is append-only so it could not be
-- deleted afterwards.
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.probe(
  p_layer     TEXT,
  p_name      TEXT,
  p_invariant TEXT,
  p_stmts     TEXT[],
  p_predicate TEXT,          -- SQL returning a single BOOLEAN; must be TRUE
  p_detail    TEXT DEFAULT NULL  -- SQL returning a single TEXT, for the report
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  s        TEXT;
  v_ok     BOOLEAN := FALSE;
  v_detail TEXT;
  v_msg    TEXT;
  v_state  TEXT;
  v_broke  BOOLEAN := FALSE;
BEGIN
  BEGIN
    FOREACH s IN ARRAY p_stmts LOOP
      EXECUTE s;
    END LOOP;
    SET CONSTRAINTS ALL IMMEDIATE;
    EXECUTE p_predicate INTO v_ok;
    IF p_detail IS NOT NULL THEN
      EXECUTE p_detail INTO v_detail;
    END IF;
    -- plpgsql variables are not rolled back with the subtransaction, so v_ok
    -- and v_detail survive this.
    RAISE EXCEPTION '__harness_rollback__';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_msg   := SQLERRM;
    IF v_msg <> '__harness_rollback__' THEN
      v_broke := TRUE;
    END IF;
  END;

  IF v_broke THEN
    PERFORM harness.record(p_layer, p_name, p_invariant, FALSE,
      format('the probe itself failed to run: [%s] %s', v_state, v_msg));
  ELSE
    PERFORM harness.record(p_layer, p_name, p_invariant, COALESCE(v_ok, FALSE),
      COALESCE(v_detail, CASE WHEN v_ok THEN NULL ELSE 'predicate was false' END));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- expect_no_rows — the workhorse of layer 1.
--
-- p_query is a SELECT whose every row is a violation. Zero rows is a pass;
-- any row is a failure and the offending rows are printed verbatim, so the
-- report names the specific function/table/view at fault rather than saying
-- "authorization check failed".
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.expect_no_rows(
  p_layer     TEXT,
  p_name      TEXT,
  p_invariant TEXT,
  p_query     TEXT
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_count   INT;
  v_rows    TEXT;
  v_msg     TEXT;
  v_state   TEXT;
BEGIN
  BEGIN
    EXECUTE format(
      'SELECT count(*)::int, left(COALESCE(string_agg(v.violation, E''\n           ''), ''''), 4000) '
      'FROM (%s) AS v', p_query)
    INTO v_count, v_rows;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
    PERFORM harness.record(p_layer, p_name, p_invariant, FALSE,
      format('the assertion query itself failed: [%s] %s', v_state, v_msg));
    RETURN;
  END;

  IF v_count = 0 THEN
    PERFORM harness.record(p_layer, p_name, p_invariant, TRUE, NULL);
  ELSE
    PERFORM harness.record(p_layer, p_name, p_invariant, FALSE,
      format('%s violation(s):%s%s', v_count, E'\n           ', v_rows));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- expect_true — a single boolean about the state of the world, with a detail
-- expression evaluated either way so a failure shows the actual numbers.
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.expect_true(
  p_layer     TEXT,
  p_name      TEXT,
  p_invariant TEXT,
  p_predicate TEXT,
  p_detail    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_ok     BOOLEAN;
  v_detail TEXT;
  v_msg    TEXT;
  v_state  TEXT;
BEGIN
  BEGIN
    EXECUTE p_predicate INTO v_ok;
    IF p_detail IS NOT NULL THEN
      EXECUTE p_detail INTO v_detail;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
    PERFORM harness.record(p_layer, p_name, p_invariant, FALSE,
      format('the assertion query itself failed: [%s] %s', v_state, v_msg));
    RETURN;
  END;

  PERFORM harness.record(p_layer, p_name, p_invariant, COALESCE(v_ok, FALSE),
    CASE WHEN COALESCE(v_ok, FALSE) THEN NULL
         ELSE COALESCE('actual: ' || v_detail, 'predicate was false or NULL') END);
END;
$$;

-- ---------------------------------------------------------------------------
-- expect_no_rows_known_gap — an assertion that currently fails because of a
-- defect in a file this harness does not own.
--
-- WHY THIS EXISTS AT ALL
-- The schema carries at least one confirmed, still-open defect (see
-- tests/layer1_authorization.sql, the gaps section). Deleting the assertion
-- would lose it. Letting it fail the gate would make the whole harness red on
-- day one, and a permanently-red gate is a gate nobody reads.
--
-- WHY IT CANNOT BECOME A PLACE TO HIDE FAILURES
-- The polarity is inverted. A gap that still reproduces is reported as GAP and
-- does not fail the run. A gap that has STOPPED reproducing is a hard FAIL
-- telling you to promote it to expect_no_rows — so the list drains itself and
-- cannot silently accumulate passing entries. p_tracking is mandatory: a gap
-- with no named owner is not a gap, it is a shrug.
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.expect_no_rows_known_gap(
  p_layer     TEXT,
  p_name      TEXT,
  p_invariant TEXT,
  p_query     TEXT,
  p_tracking  TEXT            -- who owns the fix; must not be blank
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
  v_rows  TEXT;
BEGIN
  IF btrim(COALESCE(p_tracking, '')) = '' THEN
    RAISE EXCEPTION 'harness: a known gap must name who owns the fix';
  END IF;

  EXECUTE format(
    'SELECT count(*)::int, left(COALESCE(string_agg(v.violation, E''\n           ''), ''''), 4000) '
    'FROM (%s) AS v', p_query)
  INTO v_count, v_rows;

  IF v_count > 0 THEN
    INSERT INTO harness.results (layer, name, invariant, status, detail)
    VALUES (p_layer, p_name, p_invariant, 'GAP',
            format('%s violation(s) — %s%s%s', v_count, p_tracking,
                   E'\n           ', v_rows));
  ELSE
    PERFORM harness.record(p_layer, p_name, p_invariant, FALSE,
      format('this known gap NO LONGER REPRODUCES. It is fixed — promote it to '
             'harness.expect_no_rows so it becomes a hard gate. (%s)', p_tracking));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- A run that asserts nothing is not a passing run. The runner calls this to
-- guard against a layer file silently failing to load.
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.assertion_count(p_layer TEXT) RETURNS INT
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM harness.results WHERE layer = p_layer;
$$;

CREATE FUNCTION harness.failure_count() RETURNS INT
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM harness.results WHERE status = 'FAIL';
$$;

-- ---------------------------------------------------------------------------
-- report — the human-readable run summary.
--
-- Built in SQL rather than by post-processing psql output in the shell,
-- because details are multi-line (the list of offending functions, the
-- Postgres error that actually arrived) and row-per-line parsing mangles them.
--
-- A passing assertion prints one line. A failing one prints the invariant it
-- guards and what actually happened, which is the difference between
-- "ERROR: new row violates check constraint" and "2.9 an amount past 2^53 is
-- rejected — accepted, the guard is gone".
-- ---------------------------------------------------------------------------
CREATE FUNCTION harness.report() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(block, E'\n' ORDER BY seq), '  (no assertions ran)')
  FROM (
    SELECT r.seq,
           format('  %-4s  [%s] %s%s',
                  r.status, r.layer, r.name,
                  CASE WHEN r.status = 'PASS' THEN ''
                       ELSE E'\n        guards: '
                            || regexp_replace(r.invariant, E'\\s+', ' ', 'g')
                            || COALESCE(E'\n        result: ' || r.detail, '')
                            || E'\n'
                  END) AS block
    FROM harness.results r
  ) t;
$$;

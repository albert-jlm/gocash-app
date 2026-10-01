#!/usr/bin/env bash
# Typecheck the Deno edge functions.
#
# `supabase/functions/main` is excluded from tsconfig.json because it imports
# over https://, which tsc cannot resolve — so `npm run typecheck` does not
# cover it and this script is the only gate on that half of the codebase.
#
# Runs in a container because Deno is not installed on this machine, and keeps
# DENO_DIR OUTSIDE the repo: a bind-mounted cache is created as root and then
# cannot be cleaned up without a second container.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${DENO_CACHE_DIR:-${TMPDIR:-/tmp}/gocash-deno-cache}"
IMAGE="${DENO_IMAGE:-denoland/deno:alpine-2.1.4}"

mkdir -p "$CACHE"

# --no-lock: a lockfile would be written into the repo as root, and the edge
# runtime does not read one.
exec docker run --rm \
  -v "$REPO:/w" \
  -v "$CACHE:/deno-cache" \
  -w /w \
  -e DENO_DIR=/deno-cache \
  --entrypoint deno \
  "$IMAGE" \
  check --no-lock "${@:-supabase/functions/main/index.ts}"

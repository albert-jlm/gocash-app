# Edge Functions

## What this directory is

These files were imported verbatim from the live edge runtime on 2026-09-23:

    /home/zether/homelab/supabase/volumes/functions/main/

They are the code that actually serves traffic. The repo had been stale since
2026-03-22 while production was edited directly in the Docker volume — the repo's
previous `process-transaction/` and `confirm-transaction/` directories described a
system that no longer existed, and their `confirm-transaction` called an RPC
signature that would return PGRST202. Both were deleted in this commit.
See AUDITS.md entries #5 and #5a.

## Only `main/` is served

The edge runtime starts with:

    edge-runtime start --main-service /home/deno/functions/main

so `main/index.ts` is the only entry point. The sibling directories that used to sit
next to it in the volume (`process-transaction/`, `confirm-transaction/`,
`delete-transaction/`, `cleanup-receipts/`) were never loaded. Routing is an
exact-match lookup on the path segment inside `main/index.ts`.

This is why `cleanup-receipts` has never run: it is a `serve()` in a directory the
runtime does not load, so the receipt deletion queue has no drain. (Phase 2.)

## `_mago_admin.ts` is deliberately absent

The live `main/index.ts` also routes `mago-admin`, which belongs to MagoHQ — a
separate inventory product that shares this edge runtime and Postgres instance. It
is tracked in its own repo at `~/homelab/magohq/packages/db/edge-functions/main/`
and is not carried here.

Consequence: this directory is **not** currently a drop-in replacement for the
volume. Do not bind-mount it over `volumes/functions` on the shared stack — that
would remove MagoHQ's route. GoCash is moving to its own stack (Phase 0.6), which
will bind-mount this directory directly and carry no MagoHQ code at all.

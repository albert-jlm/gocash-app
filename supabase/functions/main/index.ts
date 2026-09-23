/**
 * GoCash edge runtime entry point.
 *
 * The runtime starts with `--main-service /home/deno/functions/main`, so this
 * file is the ONLY entry point and routing is an exact-match lookup on the path
 * segment. A directory sitting next to this one is never loaded — which is why
 * `cleanup-receipts` has never run, and why the audit found four stale copies
 * of these handlers that nothing executed.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleProcessTransaction } from "./_process_transaction.ts";
import { handleConfirmTransaction } from "./_confirm_transaction.ts";
import { handleVoidTransaction } from "./_void_transaction.ts";

// NOTE: the `mago-admin` route was removed. It belongs to MagoHQ, a separate
// product that shares the OLD edge runtime; it lives in its own repo at
// ~/homelab/magohq/packages/db/edge-functions/main/. Keep it out — Deno
// resolves static imports eagerly, so a parse error in an unrelated inventory
// app would stop GoCash serving.
const routes: Record<string, (req: Request) => Promise<Response>> = {
  // Phase 1: OCR, save a DRAFT. Moves no money.
  "process-transaction": handleProcessTransaction,
  // Phase 2: the gate. The only place balances change.
  "confirm-transaction": handleConfirmTransaction,
  // Corrections. A reversal entry, never a delete.
  "void-transaction": handleVoidTransaction,
  // Kept so existing clients do not 404 mid-rollout. The old endpoint claimed
  // to delete; it now voids, which is the only thing an append-only ledger can
  // honestly offer. Remove once the app no longer calls it.
  "delete-transaction": handleVoidTransaction,
};

// `update-transaction` is deliberately gone. It aliased confirm-transaction
// back when that was an edit endpoint. Confirmation and amendment are now
// distinct operations — amending a confirmed transaction means voiding and
// reposting — so an alias between them would be actively misleading.

serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathSegment = url.pathname.replace(/^\/+|\/+$/g, "");

  const handler = routes[pathSegment];
  if (handler) return handler(req);

  if (pathSegment === "" || pathSegment === "health") {
    return new Response(
      JSON.stringify({ status: "ok", functions: Object.keys(routes) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ error: `Unknown function: ${pathSegment}` }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
});

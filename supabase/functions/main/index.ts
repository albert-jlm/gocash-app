/**
 * GoCash edge runtime entry point.
 *
 * The runtime is started with `--main-service /home/deno/functions/main`, so this
 * file is the ONLY entry point — routing is an exact-match lookup on the path
 * segment. A directory sitting next to this one is never loaded.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleProcessTransaction } from "./_process_transaction.ts";
import { handleConfirmTransaction } from "./_confirm_transaction.ts";
import { handleDeleteTransaction } from "./_delete_transaction.ts";

// NOTE: the `mago-admin` route was removed here. It belongs to MagoHQ, a separate
// product that shares the OLD edge runtime; it lives in its own repo at
// ~/homelab/magohq/packages/db/edge-functions/main/. Keep it out of this file —
// Deno resolves static imports eagerly, so importing it would mean a parse error
// in an unrelated inventory app could stop GoCash from serving.
const routes: Record<string, (req: Request) => Promise<Response>> = {
  "process-transaction": handleProcessTransaction,
  "confirm-transaction": handleConfirmTransaction,
  "update-transaction":  handleConfirmTransaction,
  "delete-transaction":  handleDeleteTransaction,
};

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

/**
 * Edge Function Router — main entrypoint for self-hosted Supabase edge-runtime.
 *
 * The Docker edge-runtime container runs with `--main-service /home/deno/functions/main`
 * which routes ALL requests through this single file. Kong strips the `/functions/v1/`
 * prefix, so we receive paths like `/process-transaction` or `/confirm-transaction`.
 *
 * Each handler is a plain async function (not wrapped in serve()) imported from
 * sibling modules. The sandbox only allows static imports from within this directory.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleProcessTransaction } from "./_process_transaction.ts";
import { handleConfirmTransaction } from "./_confirm_transaction.ts";

// ---------------------------------------------------------------------------
// Route table — maps URL path segments to handler functions
// ---------------------------------------------------------------------------

const routes: Record<string, (req: Request) => Promise<Response>> = {
  "process-transaction": handleProcessTransaction,
  "confirm-transaction": handleConfirmTransaction,
};

// ---------------------------------------------------------------------------
// Main server
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  const url = new URL(req.url);
  // Path may be "/process-transaction" or "/process-transaction/" — normalize
  const pathSegment = url.pathname.replace(/^\/+|\/+$/g, "");

  const handler = routes[pathSegment];

  if (handler) {
    return handler(req);
  }

  // Health check / fallback
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

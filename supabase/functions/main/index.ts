import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleProcessTransaction } from "./_process_transaction.ts";
import { handleConfirmTransaction } from "./_confirm_transaction.ts";
import { handleDeleteTransaction } from "./_delete_transaction.ts";

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

  if (handler) {
    return handler(req);
  }

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

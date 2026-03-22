import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "../_shared/cors.ts";

interface ReceiptQueueRow {
  id: string;
  bucket: string;
  path: string;
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const secret = Deno.env.get("RECEIPT_CLEANUP_SECRET");
  if (!secret) {
    return jsonResponse(req, { error: "RECEIPT_CLEANUP_SECRET is not configured" }, 500);
  }

  if (req.headers.get("x-cleanup-secret") !== secret) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "gocash" } }
  );

  const nowIso = new Date().toISOString();
  const { data: rows, error: fetchError } = await adminClient
    .from("receipt_deletion_queue")
    .select("id, bucket, path")
    .is("deleted_at", null)
    .lte("delete_after", nowIso)
    .order("delete_after", { ascending: true })
    .limit(100);

  if (fetchError) {
    console.error("Failed to fetch queued receipts:", fetchError.message);
    return jsonResponse(req, { error: "Failed to fetch queued receipts" }, 500);
  }

  const queueRows = (rows ?? []) as ReceiptQueueRow[];
  let deletedCount = 0;
  let failedCount = 0;

  for (const row of queueRows) {
    const attemptedAt = new Date().toISOString();

    const { error: storageError } = await adminClient.storage
      .from(row.bucket)
      .remove([row.path]);

    if (storageError) {
      failedCount += 1;

      await adminClient
        .from("receipt_deletion_queue")
        .update({
          attempted_at: attemptedAt,
          last_error: storageError.message,
        })
        .eq("id", row.id);

      continue;
    }

    deletedCount += 1;

    await adminClient
      .from("receipt_deletion_queue")
      .update({
        attempted_at: attemptedAt,
        deleted_at: attemptedAt,
        last_error: null,
      })
      .eq("id", row.id);
  }

  return jsonResponse(req, {
    processed: queueRows.length,
    deleted: deletedCount,
    failed: failedCount,
  });
});

/**
 * share-upload — a screenshot from a phone's share sheet becomes a DRAFT.
 *
 * Called by an Apple Shortcut (or anything else that can POST a file), not by
 * the app. There is no login here: the caller presents an upload key, which
 * identifies the operator and can do nothing but this.
 *
 * The response always carries a short `message` written for a person, because
 * the Shortcut shows it as a notification. The draft is confirmed in the app,
 * from the "Waiting for you" list.
 *
 * Accepts the image three ways, so the Shortcut can stay simple:
 *   - the raw file as the request body (Content-Type: image/…)
 *   - multipart/form-data with a file field
 *   - JSON { image_base64, mime_type }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processReceipt } from "./_process_transaction.ts";
import { sha256Hex, UPLOAD_KEY_PREFIX } from "./_upload_keys.ts";

// ~4.5 MB of image, the same ceiling process-transaction applies.
const MAX_IMAGE_BYTES = 4_500_000;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic"];

function reply(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** PNG, JPEG, WebP or HEIC by their leading bytes; null if none. */
function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|mif1|msf1)/.test(ascii(8, 12))) return "image/heic";
  return null;
}

function pesos(n: unknown): string {
  return typeof n === "number" && n > 0
    ? "₱" + n.toLocaleString("en-PH", { maximumFractionDigits: 2 })
    : "";
}

export async function handleShareUpload(req: Request): Promise<Response> {
  if (req.method !== "POST") return reply(405, "Send the screenshot with POST.");

  try {
    // ----- the key -----
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const key = bearer.startsWith(UPLOAD_KEY_PREFIX)
      ? bearer
      : (req.headers.get("X-GoCash-Key") ?? "").trim();

    if (!key.startsWith(UPLOAD_KEY_PREFIX)) {
      return reply(401, "GoCash: the upload key is missing. Check the Shortcut's Authorization header.");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    const { data: keyRow } = await admin
      .from("upload_keys")
      .select("id, operator_id")
      .eq("key_hash", await sha256Hex(key))
      .is("revoked_at", null)
      .maybeSingle();

    if (!keyRow) {
      return reply(401, "GoCash: this upload key is not valid any more. Make a new one in Settings.");
    }

    // ----- the image -----
    const contentType = (req.headers.get("Content-Type") ?? "").toLowerCase();
    let bytes: Uint8Array | null = null;

    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      for (const value of form.values()) {
        if (value instanceof File) { bytes = new Uint8Array(await value.arrayBuffer()); break; }
      }
    } else if (contentType.startsWith("application/json")) {
      const json = await req.json().catch(() => null);
      if (json && typeof json.image_base64 === "string") {
        try {
          bytes = Uint8Array.from(atob(json.image_base64), (c) => c.charCodeAt(0));
        } catch { bytes = null; }
      }
    } else {
      bytes = new Uint8Array(await req.arrayBuffer());
    }

    if (!bytes || bytes.length === 0) {
      return reply(400, "GoCash: no image arrived. Share a screenshot, not a link or text.");
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return reply(413, "GoCash: that image is too large. Add a \"Convert Image\" to JPEG step in the Shortcut.");
    }

    // Decided from the bytes, not from what the sender says it is.
    const mimeType = sniffImage(bytes);
    if (!mimeType || !ALLOWED.includes(mimeType)) {
      return reply(415, "GoCash: that file isn't a screenshot it can read (PNG or JPEG).");
    }

    await admin.from("upload_keys")
      .update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);

    // ----- the same pipeline the app uses -----
    const result = await processReceipt(req, admin, keyRow.operator_id, {
      image_base64: toBase64(bytes),
      mime_type: mimeType,
    });

    const data = await result.json().catch(() => ({}));

    if (!result.ok) {
      // Already a full sentence for the person holding the phone.
      if (data.code === "not_a_receipt" || data.code === "reader_unavailable") {
        return reply(result.status, `GoCash: ${data.error}.`);
      }
      return reply(result.status, `GoCash couldn't save it: ${data.error ?? "something went wrong"}.`);
    }

    const type = data.transaction_type && data.transaction_type !== "Unknown" ? data.transaction_type : "";
    const platform = data.platform && data.platform !== "Unknown" ? data.platform : "";
    // A transfer reads better as a route than as a type and one app.
    const route = data.transaction_type === "Wallet Transfer" && data.transfer_to
      ? `Transfer ${platform} → ${data.transfer_to}`
      : null;
    const summary = (route ? [route, pesos(data.amount)] : [type, platform, pesos(data.amount)])
      .filter(Boolean).join(" · ");

    if (data.other_half) {
      return reply(200, `This is the other side of a transfer already recorded${summary ? ` (${summary})` : ""}. Nothing new was added.`, {
        transaction_id: data.transaction_id, duplicate: true,
      });
    }

    if (data.duplicate) {
      return reply(200, `Already recorded${summary ? `: ${summary}` : ""}. Nothing new was added.`, {
        transaction_id: data.transaction_id, duplicate: true,
      });
    }

    const missing: string[] = Array.isArray(data.needs_review) ? data.needs_review : [];
    const message = missing.length > 0
      ? `Draft saved${summary ? ` (${summary})` : ""}, but some details couldn't be read. Open GoCash to fill them in.`
      : `Draft saved: ${summary}. Open GoCash to confirm.`;

    return reply(200, message, { transaction_id: data.transaction_id, needs_review: missing });
  } catch (err) {
    console.error("Unhandled error in share-upload:", err);
    return reply(500, "GoCash couldn't save it. Try again, or add it in the app.");
  }
}

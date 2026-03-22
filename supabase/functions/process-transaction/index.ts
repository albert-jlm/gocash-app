/**
 * process-transaction — Phase 1 Edge Function
 *
 * Accepts a base64-encoded screenshot, runs it through GPT-4o vision for
 * structured extraction, applies local business logic, writes an
 * `awaiting_confirmation` transaction record, and returns the draft to
 * the client for operator review.
 *
 * Called by: Capture screen (after the operator selects / shares a screenshot)
 * Auth required: Yes — Supabase JWT in Authorization header
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4";
import { corsHeaders, handleCors, jsonResponse } from "../_shared/cors.ts";
import {
  detectPlatform,
  detectType,
  calculateProfit,
  extractAccountNumber,
  type TransactionRule,
} from "../_shared/transaction-processing.ts";
import {
  buildTransactionImagePath,
  TRANSACTION_IMAGE_BUCKET,
} from "../_shared/storage.ts";
import {
  buildProcessedTelegramMessage,
  buildProcessingErrorTelegramMessage,
  parseTelegramNotificationTarget,
  sendTelegramMessage,
} from "../_shared/telegram.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestBody {
  /** Base64-encoded JPEG/PNG screenshot (no data URI prefix needed) */
  image_base64: string;
  /** Optional: data URI mime type, defaults to image/jpeg */
  mime_type?: string;
}

interface AIExtraction {
  raw_text: string;
  platform: string;
  transaction_type: string;
  amount: number | null;
  reference_number: string | null;
  account_number: string | null;
  transaction_date: string | null;
}

interface OperatorNotificationRow {
  settings: unknown;
  telegram_chat_id: string | null;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a fintech assistant helping a Filipino mobile money operator (remittance/e-wallet agent) process transaction receipts.
You will receive a screenshot from a Philippine payment app — GCash, MariBank, Maya, BPI, UnionBank, or others.
Always respond with valid JSON only. Use null for fields you cannot determine with confidence. Never guess amounts.
All amounts must be plain numbers in PHP (no ₱ symbol, no commas). Dates must be ISO 8601 format.`;

const EXTRACTION_PROMPT = `Step 1 — read the entire screenshot carefully and transcribe ALL visible text verbatim into "raw_text".
Step 2 — using that text, fill in the JSON below:

{
  "raw_text": "<all visible text from the screenshot, verbatim>",
  "platform": "GCash" | "MariBank" | "Maya" | "Unknown",
  "transaction_type": "Cash In" | "Cash Out" | "Telco Load" | "Bills Payment" | "Bank Transfer" | "Unknown",
  "amount": <transaction amount as a plain number, null if unclear>,
  "reference_number": <the transaction/reference/confirmation number shown — usually 9-13 digits, null if not found>,
  "account_number": <the CUSTOMER's Philippine mobile number in 09XXXXXXXXX format, null if not found>,
  "transaction_date": <ISO 8601 datetime if a date/time is visible, null if not found>
}

Platform detection hints:
- GCash: green branding, "GCash", "G-Xchange"
- MariBank: purple/blue branding, "MariBank", "mari"
- Maya: "Maya", "PayMaya", teal branding

Transaction type rules (from the OPERATOR's perspective):
- "Cash In": customer gave the operator CASH and received e-wallet credit (cash enters operator's drawer)
- "Cash Out": customer gave e-wallet credit and received CASH from the operator (cash leaves operator's drawer)
- "Telco Load": mobile prepaid load purchase (Globe, Smart, DITO, TNT, Sun)
- "Bills Payment": utility/bill payment transaction
- "Bank Transfer": bank-to-bank or e-wallet-to-bank transfer

Account number rules:
- Must be the CUSTOMER's mobile number, NOT the operator's number
- Operator blacklist (never use): 09757058698, 13246870917
- If multiple numbers are visible, pick the one that received or sent the transaction (not the operator's own number)
- Format: 09XXXXXXXXX (11 digits starting with 09)

Reference number hints:
- GCash reference: typically starts with digits, 13 characters
- MariBank reference: alphanumeric, shown near "Reference No." or "Ref No."
- Look for labels: "Ref", "Reference", "Transaction No.", "Confirmation No."`;


// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only allow POST
  if (req.method !== "POST") {
    return jsonResponse(req,{ error: "Method not allowed" }, 405);
  }

  let uploadedImagePath: string | null = null;
  let adminClient: ReturnType<typeof createClient> | null = null;
  let operatorNotifications: OperatorNotificationRow | null = null;

  async function cleanupUploadedImage() {
    if (!adminClient || !uploadedImagePath) return;

    try {
      await adminClient.storage
        .from(TRANSACTION_IMAGE_BUCKET)
        .remove([uploadedImagePath]);
    } catch {
      // Best-effort cleanup only.
    }
  }

  async function notifyProcessed(transaction: {
    id: string;
    platform: string;
    transaction_type: string;
    amount: number;
    net_profit: number;
    account_number: string | null;
    reference_number: string | null;
  }) {
    const target = operatorNotifications
      ? parseTelegramNotificationTarget(operatorNotifications)
      : null;

    if (!target?.isEnabledFor("processed")) return;

    try {
      await sendTelegramMessage({
        botToken: Deno.env.get("TELEGRAM_BOT_TOKEN"),
        chatId: target.chatId,
        text: buildProcessedTelegramMessage({
          transactionId: transaction.id,
          platform: transaction.platform,
          transactionType: transaction.transaction_type,
          amount: transaction.amount,
          netProfit: transaction.net_profit,
          accountNumber: transaction.account_number,
          referenceNumber: transaction.reference_number,
        }),
      });
    } catch (error) {
      console.error(
        "Telegram processed notification failed:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async function notifyProcessingError(reason: string) {
    const target = operatorNotifications
      ? parseTelegramNotificationTarget(operatorNotifications)
      : null;

    if (!target?.isEnabledFor("processing_error")) return;

    try {
      await sendTelegramMessage({
        botToken: Deno.env.get("TELEGRAM_BOT_TOKEN"),
        chatId: target.chatId,
        text: buildProcessingErrorTelegramMessage({ reason }),
      });
    } catch (error) {
      console.error(
        "Telegram processing error notification failed:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  try {
    // ----- 1. Auth -----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req,{ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        db: { schema: "gocash" },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) return jsonResponse(req,{ error: "Unauthorized" }, 401);

    // ----- 2. Resolve operator -----
    const { data: operator, error: opError } = await supabase
      .from("operators")
      .select("id, settings, telegram_chat_id")
      .eq("user_id", user.id)
      .single();

    if (opError || !operator) {
      return jsonResponse(req,{ error: "Operator record not found" }, 404);
    }

    operatorNotifications = {
      settings: operator.settings,
      telegram_chat_id: operator.telegram_chat_id,
    };

    adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        db: { schema: "gocash" },
      }
    );

    // ----- 3. Rate limit — max 50 submissions per operator per hour -----
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("operator_id", operator.id)
      .gte("created_at", oneHourAgo);

    if (recentCount !== null && recentCount >= 50) {
      return jsonResponse(req, { error: "Rate limit exceeded — max 50 transactions per hour" }, 429);
    }

    // ----- 4. Parse and validate request -----
    const body: RequestBody = await req.json();
    if (!body.image_base64) {
      return jsonResponse(req, { error: "image_base64 is required" }, 400);
    }

    // Payload size limit: ~4.5MB decoded
    if (body.image_base64.length > 6_000_000) {
      return jsonResponse(req, { error: "Image too large — maximum 4.5 MB" }, 413);
    }

    // MIME type allowlist
    const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    const mimeType = body.mime_type ?? "image/jpeg";
    if (!ALLOWED_MIMES.includes(mimeType)) {
      return jsonResponse(req, { error: `Unsupported image type: ${mimeType}` }, 415);
    }

    const imageBytes = Uint8Array.from(
      atob(body.image_base64),
      (char) => char.charCodeAt(0)
    );
    uploadedImagePath = buildTransactionImagePath(operator.id, mimeType);

    const { error: uploadError } = await adminClient.storage
      .from(TRANSACTION_IMAGE_BUCKET)
      .upload(uploadedImagePath, imageBytes, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Transaction image upload failed:", uploadError.message);
      await notifyProcessingError("Failed to store screenshot");
      return jsonResponse(req, { error: "Failed to store screenshot" }, 500);
    }

    // ----- 5. GPT-4o vision extraction -----
    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${body.image_base64}`,
                detail: "high",
              },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    let ai: AIExtraction;
    try {
      ai = JSON.parse(completion.choices[0].message.content!) as AIExtraction;
    } catch {
      // Do NOT log model output — may contain sensitive OCR text (account numbers, amounts)
      console.error("Failed to parse AI response: [redacted for security]");
      await cleanupUploadedImage();
      await notifyProcessingError("AI extraction failed — could not parse response");
      return jsonResponse(req,{ error: "AI extraction failed — could not parse response" }, 422);
    }

    // ----- 5. Business logic fallbacks -----
    const rawText = ai.raw_text ?? "";
    const platform =
      ai.platform && ai.platform !== "Unknown"
        ? ai.platform
        : detectPlatform(rawText);

    const txType =
      ai.transaction_type && ai.transaction_type !== "Unknown"
        ? ai.transaction_type
        : detectType(rawText);

    const amount = ai.amount ?? 0;

    const accountNumber =
      ai.account_number ?? extractAccountNumber(rawText) ?? null;

    // ----- 6. Fetch operator rules and compute profit -----
    const { data: rules } = await supabase
      .from("transaction_rules")
      .select("*")
      .eq("operator_id", operator.id)
      .eq("is_active", true);

    const netProfit = calculateProfit(
      txType,
      platform,
      amount,
      (rules ?? []) as TransactionRule[]
    );

    if (ai.reference_number) {
      const { data: existing } = await supabase
        .from("transactions")
        .select(
          "id, status, platform, transaction_type, amount, net_profit, account_number, reference_number, transaction_date"
        )
        .eq("operator_id", operator.id)
        .eq("reference_number", ai.reference_number)
        .maybeSingle();

      if (existing) {
        await cleanupUploadedImage();
        return jsonResponse(req,{
          transaction_id: existing.id,
          status: existing.status,
          platform: existing.platform,
          transaction_type: existing.transaction_type,
          amount: existing.amount,
          net_profit: existing.net_profit,
          account_number: existing.account_number,
          reference_number: existing.reference_number,
          transaction_date: existing.transaction_date,
          duplicate: true,
        });
      }
    }

    // ----- 7. Write transaction (Phase 1) -----
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .insert({
        operator_id: operator.id,
        platform,
        transaction_type: txType,
        amount,
        net_profit: netProfit,
        account_number: accountNumber,
        reference_number: ai.reference_number ?? null,
        transaction_date: ai.transaction_date ?? null,
        image_url: uploadedImagePath,
        ai_raw_text: rawText || null,
        status: "awaiting_confirm",
        was_edited: false,
        edit_history: [],
      })
      .select()
      .single();

    if (txError) {
      // Duplicate reference — return existing transaction so operator can review it
      if (txError.code === "23505" && ai.reference_number) {
        const { data: existing } = await supabase
          .from("transactions")
          .select("id, status, platform, transaction_type, amount, net_profit, account_number, reference_number, transaction_date")
          .eq("operator_id", operator.id)
          .eq("reference_number", ai.reference_number)
          .single();
        if (existing) {
          await cleanupUploadedImage();
          return jsonResponse(req,{
            transaction_id: existing.id,
            status: existing.status,
            platform: existing.platform,
            transaction_type: existing.transaction_type,
            amount: existing.amount,
            net_profit: existing.net_profit,
            account_number: existing.account_number,
            reference_number: existing.reference_number,
            transaction_date: existing.transaction_date,
            duplicate: true,
          });
        }
      }
      console.error("Transaction insert error:", txError);
      await cleanupUploadedImage();
      await notifyProcessingError("Failed to save transaction");
      return jsonResponse(req,{ error: "Failed to save transaction", detail: txError.message }, 500);
    }

    await notifyProcessed(transaction);

    // ----- 8. Return draft for operator review -----
    return jsonResponse(req,{
      transaction_id: transaction.id,
      status: transaction.status,
      platform: transaction.platform,
      transaction_type: transaction.transaction_type,
      amount: transaction.amount,
      net_profit: transaction.net_profit,
      account_number: transaction.account_number,
      reference_number: transaction.reference_number,
      transaction_date: transaction.transaction_date,
    });
  } catch (err) {
    console.error("Unhandled error in process-transaction:", err);
    await cleanupUploadedImage();
    await notifyProcessingError("Internal server error");
    return jsonResponse(req,{ error: "Internal server error" }, 500);
  }
});

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import {
  detectPlatform,
  detectType,
  calculateProfit,
  extractAccountNumber,
  type TransactionRule,
} from "./_shared/transaction-processing.ts";
import { detectGrossAmount } from "../_core/fees.ts";
import { toMinor } from "../_core/money.ts";
import {
  buildTransactionImagePath,
  TRANSACTION_IMAGE_BUCKET,
} from "./_shared/storage.ts";
import {
  buildProcessedTelegramMessage,
  buildProcessingErrorTelegramMessage,
  parseTelegramNotificationTarget,
  sendTelegramMessage,
} from "./_shared/telegram.ts";

interface RequestBody {
image_base64: string;
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

Identify the ISSUING APP — the app whose interface rendered this screen — NOT any
institution named inside it. Receipts routinely name a DIFFERENT institution as the
destination of a transfer, and that name is not the issuer:
- A Maya receipt reading "Account Type: GCash" is a MAYA receipt.
- A GCash receipt listing "Maya Philippines, Inc." is a GCASH receipt.
Decide from the TOP of the screen: the title bar, the success headline, the block
above the amount. Ignore brand names appearing after "Transfer to", "Sent to",
"Bank", or "Account Type" — those are the counterparty.

Issuer fingerprints:
- GCash: "Sent via GCash", "Express Send", "GCash Padala", "Total Amount Sent",
  "Ref No."/"Ref. No." followed by 13 digits (often grouped 4-3-6),
  "Your new balance is PHP", "AVAILABLE BALANCE", GSave/GInsure/GInvest/GForest/
  GGives, a "gCO2e" carbon-footprint card. BLUE interface. Uppercase AM/PM.
- Maya (formerly PayMaya): "Sent money via Instapay", "Paid bill",
  "Payment successful", a "Completed" status chip, "Bill amount", "Biller's fee",
  "Paid using"/"My Wallet", "Reference ID", "Wallet balance", a lowercase "maya"
  wordmark inside the receipt card. GREEN interface. Lowercase am/pm.
- MariBank (formerly SeaBank — renamed September 2025; both names appear in the
  wild): "MariBank", "SeaBank", "MariCard", "Scan & Pay", "Transfer Type: Realtime",
  "Transfer Fee: FREE", "Acct. No.:", "Deposits are insured by PDIC".
  24-hour timestamps such as "01 Sep 2025, 12:28".

Do NOT use "G-Xchange" as evidence of GCash: it is the label Maya's own bank picker
uses FOR GCash, so it appears on Maya receipts.

Some receipts show no brand name at all. If you cannot identify the issuer from the
screen itself, return "Unknown" — do not infer it from the counterparty, the colour
alone, or the transaction type. An honest Unknown is asked about at review; a
confident wrong answer silently posts against the wrong wallet.

Transaction type rules (from the CUSTOMER's perspective):
- "Cash In": customer gives the operator CASH and receives e-wallet credit; on the operator's receipt this is usually "Send Money", "You sent", or "Sent to"
- "Cash Out": customer gives the operator e-wallet credit and receives CASH; on the operator's receipt this is usually "You received"
- "Telco Load": mobile prepaid load purchase (Globe, Smart, DITO, TNT, Sun)
- "Bills Payment": utility/bill payment transaction
- "Bank Transfer": bank-to-bank or e-wallet-to-bank transfer

Account number rules:
- Must be the CUSTOMER's mobile number, NOT the operator's number
- Operator blacklist (never use): 09990000001, 13990000002
- If multiple numbers are visible, pick the one that received or sent the transaction (not the operator's own number)
- Format: 09XXXXXXXXX (11 digits starting with 09)

Reference number hints:
- GCash reference: typically starts with digits, 13 characters
- MariBank reference: alphanumeric, shown near "Reference No." or "Ref No."
- Look for labels: "Ref", "Reference", "Transaction No.", "Confirmation No."`;

export async function handleProcessTransaction(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  let uploadedImagePath: string | null = null;
  // Annotated with the schema generic. `ReturnType<typeof createClient>` leaves
  // SchemaName defaulted to 'public', so assigning a client built with
  // `db: { schema: "gocash" }` fails to typecheck — the long-standing TS2322
  // here, which the runtime never saw because the edge runtime strips types
  // without checking them.
  // deno-lint-ignore no-explicit-any
  let adminClient: SupabaseClient<any, "gocash"> | null = null;
  let operatorNotifications: OperatorNotificationRow | null = null;

  async function cleanupUploadedImage() {
    if (!adminClient || !uploadedImagePath) return;

    try {
      await adminClient.storage
        .from(TRANSACTION_IMAGE_BUCKET)
        .remove([uploadedImagePath]);
    } catch {
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization" }, 401);

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

    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const { data: operator, error: opError } = await supabase
      .from("operators")
      .select("id, settings, telegram_chat_id")
      .eq("user_id", user.id)
      .single();

    if (opError || !operator) {
      return jsonResponse(req, { error: "Operator record not found" }, 404);
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

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("operator_id", operator.id)
      .gte("created_at", oneHourAgo);

    if (recentCount !== null && recentCount >= 50) {
      return jsonResponse(req, { error: "Rate limit exceeded — max 50 transactions per hour" }, 429);
    }

    const body: RequestBody = await req.json();
    if (!body.image_base64) {
      return jsonResponse(req, { error: "image_base64 is required" }, 400);
    }

    if (body.image_base64.length > 6_000_000) {
      return jsonResponse(req, { error: "Image too large — maximum 4.5 MB" }, 413);
    }

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
      console.error("Failed to parse AI response: [redacted for security]");
      await cleanupUploadedImage();
      await notifyProcessingError("AI extraction failed — could not parse response");
      return jsonResponse(req, { error: "AI extraction failed — could not parse response" }, 422);
    }

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
        return jsonResponse(req, {
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
        // PHASE 1 ONLY. Balances do not move here — the operator reviews this
        // draft and confirms it, and confirm-transaction writes the ledger
        // entry. Until 2026-09-23 this said "confirmed" and the wallet update
        // ran in the same request, so the confirmation gate the PRD calls
        // mandatory did not exist.
        status: "awaiting_confirm",
        was_edited: false,
        edit_history: [],
      })
      .select()
      .single();

    if (txError) {
      if (txError.code === "23505" && ai.reference_number) {
        const { data: existing } = await supabase
          .from("transactions")
          .select("id, status, platform, transaction_type, amount, net_profit, account_number, reference_number, transaction_date")
          .eq("operator_id", operator.id)
          .eq("reference_number", ai.reference_number)
          .single();
        if (existing) {
          await cleanupUploadedImage();
          return jsonResponse(req, {
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
      return jsonResponse(req, { error: "Failed to save transaction", detail: txError.message }, 500);
    }

    // NO WALLET UPDATE HERE.
    //
    // This is where confirm_transaction_atomic used to be called, with
    // p_status: "confirmed", immediately after the insert. That is what made
    // the gate a fiction: a GPT-4o misread of PHP 1,850 as PHP 1,850,000 moved
    // real balances before any human saw the number. The ledger is append-only,
    // so the only remedy was a reversal that stays in the audit trail forever.
    //
    // Balances now move exactly once, in confirm-transaction, after the
    // operator taps confirm.

    // Fee rules still live in transaction_rules at this point in the rollout;
    // map the matching one into the shape _core expects so the hint is priced
    // by the same code the gate will use.
    const hintRule = (rules ?? []).find((r: TransactionRule) =>
      r.transaction_type === txType && (r.platform === platform || r.platform === "all"));

    const grossHint = hintRule
      ? detectGrossAmount(txType, platform, toMinor(amount), [{
          transaction_type: hintRule.transaction_type,
          platform: hintRule.platform,
          rate_bps: Math.round((hintRule.profit_rate ?? 0) * 100),
          minimum_minor: Math.round((hintRule.profit_minimum ?? 0) * 100),
          is_active: true,
        }])
      : null;

    await notifyProcessed(transaction);

    return jsonResponse(req, {
      transaction_id: transaction.id,
      status: "awaiting_confirm",
      platform: transaction.platform,
      transaction_type: transaction.transaction_type,
      amount: transaction.amount,
      net_profit: transaction.net_profit,
      account_number: transaction.account_number,
      reference_number: transaction.reference_number,
      transaction_date: transaction.transaction_date,
      // No wallet_deltas: nothing has moved yet. The client shows this as a
      // draft for review; confirm-transaction reports the postings once the
      // operator accepts it.
      //
      // A SUGGESTION, not a decision. If this Cash Out amount divides cleanly
      // back to a whole peso, the receipt may be showing the figure with the
      // fee already in it. The old code silently assumed so, and at 2% the
      // gross of any whole peso divides cleanly — 510, 1020, 2040, 5100 and
      // 383 other amounts under 20,000 were each charged about a peso short.
      // The number cannot answer this; the operator holding the receipt can.
      // The gate asks, and passes the answer to confirm-transaction as
      // `amount_includes_fee`.
      gross_amount_hint: grossHint && {
        implied_amount: grossHint.impliedBaseMinor / 100,
        implied_fee: grossHint.impliedFeeMinor / 100,
      },
    });
  } catch (err) {
    console.error("Unhandled error in process-transaction:", err);
    await cleanupUploadedImage();
    await notifyProcessingError("Internal server error");
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}

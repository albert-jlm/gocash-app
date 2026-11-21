import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4";
import { handleCors, jsonResponse } from "./_shared/cors.ts";
import { extractFields, type ModelAnswer } from "./_shared/extraction.ts";
import { applyOwnAccounts, readReceipt, type OcrResult, type OwnIdentifier } from "./_shared/receipt_rules.ts";
import { resolveTransferAccounts } from "./_shared/transfer.ts";
import { resolveRuleAt } from "./_shared/fee_rules.ts";
import { resolveMembership } from "./_shared/operator.ts";
import { calculateFee, detectGrossAmount } from "../_core/fees.ts";
import { toMinor, toPesos } from "../_core/money.ts";
import { isTransactionType } from "../_core/types.ts";
import type { FeeRule } from "../_core/types.ts";
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

export interface RequestBody {
image_base64: string;
mime_type?: string;
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
- Never return the operator's own number as the customer's. If you cannot tell which number is the customer's, return null
- If multiple numbers are visible, pick the one that received or sent the transaction (not the operator's own number)
- Format: 09XXXXXXXXX (11 digits starting with 09)

Reference number hints:
- GCash reference: typically starts with digits, 13 characters
- MariBank reference: alphanumeric, shown near "Reference No." or "Ref No."
- Look for labels: "Ref", "Reference", "Transaction No.", "Confirmation No."`;

/** The vision-model reader. Null when its answer is not a JSON object. */
async function readWithOpenAI(mimeType: string, imageBase64: string): Promise<ModelAnswer | null> {
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
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "high" } },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  try {
    const parsed: unknown = JSON.parse(completion.choices[0].message.content!);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as ModelAnswer;
  } catch {
    return null;
  }
}

export async function handleProcessTransaction(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, db: { schema: "gocash" } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const membership = await resolveMembership(userClient);
    if (!membership) {
      return jsonResponse(req, { error: "Operator record not found" }, 404);
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "gocash" } }
    );

    const body: RequestBody = await req.json();
    return await processReceipt(req, adminClient, membership.operatorId, body);
  } catch (err) {
    console.error("Unhandled error in process-transaction:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}

/**
 * The receipt pipeline: store the image, read it, save a DRAFT.
 *
 * Shared by the two ways an image arrives: process-transaction (the app, with
 * a login) and share-upload (a phone's share sheet, with an upload key). Both
 * have already established WHICH operator; nothing here trusts the request for
 * that. It moves no money: the draft waits for confirm-transaction.
 */
export async function processReceipt(
  req: Request,
  // The schema generic matters: without it the client type defaults to the
  // 'public' schema and every query against gocash fails to typecheck.
  // deno-lint-ignore no-explicit-any
  adminClient: SupabaseClient<any, "gocash">,
  operatorId: string,
  body: RequestBody,
): Promise<Response> {
  const { data: operator, error: operatorError } = await adminClient
    .from("operators")
    .select("id, settings, telegram_chat_id")
    .eq("id", operatorId)
    .single();

  if (operatorError || !operator) {
    return jsonResponse(req, { error: "Operator record not found" }, 404);
  }

  let uploadedImagePath: string | null = null;
  const operatorNotifications: OperatorNotificationRow = {
    settings: operator.settings,
    telegram_chat_id: operator.telegram_chat_id,
  };

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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await adminClient
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("operator_id", operator.id)
      .gte("created_at", oneHourAgo);

    if (recentCount !== null && recentCount >= 50) {
      return jsonResponse(req, { error: "Rate limit exceeded — max 50 transactions per hour" }, 429);
    }

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

    // ----- read the receipt -----
    // "local" (default): text is read off the image by the OCR service on this
    // machine and turned into fields by fixed rules. Nothing leaves the server
    // and there is no per-image cost. "openai": the previous path, a vision
    // model, kept selectable for comparison. There is no automatic fallback
    // from one to the other: a receipt the rules do not recognise is held for
    // the operator, which is the safe outcome.
    const reader = (Deno.env.get("RECEIPT_READER") ?? "local").toLowerCase();
    let ai: ModelAnswer;

    if (reader === "openai") {
      const answer = await readWithOpenAI(mimeType, body.image_base64);
      if (!answer) {
        console.error("Failed to parse AI response: [redacted for security]");
        await cleanupUploadedImage();
        await notifyProcessingError("AI extraction failed — could not parse response");
        return jsonResponse(req, { error: "AI extraction failed — could not parse response" }, 422);
      }
      ai = answer;
    } else {
      const ocrUrl = (Deno.env.get("OCR_URL") ?? "http://ocr:8000").replace(/\/+$/, "");
      let ocr: OcrResult;
      try {
        const response = await fetch(`${ocrUrl}/ocr`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: imageBytes,
          signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) throw new Error(`OCR service answered ${response.status}`);
        ocr = await response.json() as OcrResult;
      } catch (err) {
        console.error("OCR service unavailable:", err instanceof Error ? err.message : String(err));
        await cleanupUploadedImage();
        await notifyProcessingError("Receipt reading is unavailable");
        return jsonResponse(req, {
          error: "Screenshots can't be read right now. Type this one in instead",
          code: "reader_unavailable",
        }, 503);
      }

      // Was the other side the shop itself? Its own numbers and accounts are
      // in gocash.operator_identifiers; a match turns the receipt into a
      // transfer between two of its wallets instead of a customer transaction.
      const { data: identifierRows } = await adminClient
        .from("operator_identifiers")
        .select("kind, value, accounts!inner(name, is_active)")
        .eq("operator_id", operator.id);

      const own: OwnIdentifier[] = (identifierRows ?? [])
        // deno-lint-ignore no-explicit-any
        .map((row: any) => {
          const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
          return account?.is_active ? { kind: row.kind, value: row.value, wallet: account.name } : null;
        })
        .filter((x: OwnIdentifier | null): x is OwnIdentifier => x !== null);

      const read = applyOwnAccounts(readReceipt(ocr), own);
      // Which rule matched, and nothing from the receipt itself.
      console.log(
        `receipt read locally: layout=${read.layout} lines=${ocr.lines.length}` +
        (read.transfer_to ? " own-transfer" : ""),
      );

      // No known layout, no amount and no reference: this is not a receipt
      // (a photo, a chat, a shopping page). A draft with every field empty
      // would only be clutter the operator has to open and discard.
      if (read.layout === "none" && read.amount === null && read.reference_number === null) {
        await cleanupUploadedImage();
        return jsonResponse(req, {
          error: "That doesn't look like a receipt. Nothing was saved",
          code: "not_a_receipt",
        }, 422);
      }
      ai = read;
    }

    // Everything the draft is built from. An unknown platform or type, or an
    // amount that could not be read, stays unknown and is listed in
    // `needsReview` for the confirm screen. See _shared/extraction.ts.
    // The rule reader's "Unknown" is final; a model's may be rescued by
    // keywords. See ExtractOptions.
    const { data: walletRows } = await adminClient
      .from("accounts").select("name")
      .eq("operator_id", operator.id).eq("kind", "platform").eq("is_active", true);
    const knownPlatforms = (walletRows ?? []).map((w: { name: string }) => w.name);

    // The shop's own mobile numbers, so one of them is never recorded as a
    // customer's. (The rule reader has already used the full list, accounts
    // included; this covers the model path, which has not.)
    const { data: ownMobileRows } = await adminClient
      .from("operator_identifiers").select("value")
      .eq("operator_id", operator.id).eq("kind", "mobile");
    const ownNumbers = (ownMobileRows ?? []).map((r: { value: string }) => r.value);

    const fields = reader === "openai"
      ? extractFields(ai, { knownPlatforms, ownNumbers })
      : extractFields(ai, { keywordFallback: false, knownPlatforms, ownNumbers });

    // A transfer's destination has to be one of the operator's active wallets
    // (or the drawer). If it is not usable, the draft is still saved as a
    // transfer and the operator picks the destination on the review screen.
    let transferTo: string | null = null;
    if (fields.txType === "Wallet Transfer" && fields.transferTo) {
      const ends = await resolveTransferAccounts(adminClient, operator.id, fields.platform, fields.transferTo);
      if (ends.ok) transferTo = ends.to;
    }
    const { rawText, platform, txType, accountNumber } = fields;
    // The column is NOT NULL. Zero means "not read": confirm-transaction
    // refuses a zero amount, so this cannot be posted until it is entered.
    const amount = fields.amount ?? 0;

    // A preview of the fee, priced by the same rules and code the gate uses.
    // Only a preview: confirm-transaction reprices at confirm time. Zero when
    // any input is still unknown.
    let rule: FeeRule | null = null;
    let netProfit = 0;
    if (isTransactionType(txType) && platform !== "Unknown" && fields.amount !== null) {
      rule = await resolveRuleAt(
        adminClient, operator.id, txType, platform,
        fields.transactionDate ?? new Date().toISOString(),
      );
      if (rule && txType !== "Profit Remittance") {
        netProfit = toPesos(calculateFee(txType, platform, toMinor(amount), [rule]));
      }
    }

    if (fields.referenceNumber) {
      const { data: existing } = await adminClient
        .from("transactions")
        .select(
          "id, status, platform, transaction_type, amount, net_profit, account_number, reference_number, transaction_date"
        )
        .eq("operator_id", operator.id)
        .eq("reference_number", fields.referenceNumber)
        // A voided transaction no longer holds its reference: the way to fix
        // a wrong one is to void it and capture the receipt again.
        .neq("status", "voided")
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

    // ----- the other half of a transfer already recorded -----
    // Moving money between two wallets produces a receipt in each app, with
    // different reference numbers, so the check above cannot see that they
    // are one movement. Same route, same money, within a quarter of an hour:
    // this screenshot is the other side of a transfer that is already here.
    if (fields.txType === "Wallet Transfer" && transferTo && fields.amount !== null) {
      const when = fields.transactionDate ? new Date(fields.transactionDate).getTime() : Date.now();
      const windowMs = 15 * 60 * 1000;
      const { data: candidates } = await adminClient
        .from("transactions")
        .select("id, status, platform, transfer_to, transaction_type, amount, platform_fee, net_profit, account_number, reference_number, transaction_date")
        .eq("operator_id", operator.id)
        .eq("transaction_type", "Wallet Transfer")
        .eq("platform", fields.platform)
        .eq("transfer_to", transferTo)
        .neq("status", "voided")
        .gte("transaction_date", new Date(when - windowMs).toISOString())
        .lte("transaction_date", new Date(when + windowMs).toISOString());

      // The sending side may show the total including the app's fee and the
      // receiving side only what arrived, so either reading counts as equal.
      const cents = (n: unknown) => Math.round(Number(n ?? 0) * 100);
      const mine = cents(fields.amount), myFee = cents(fields.platformFee);
      // deno-lint-ignore no-explicit-any
      const half = (candidates ?? []).find((c: any) => {
        const theirs = cents(c.amount), theirFee = cents(c.platform_fee);
        return theirs === mine || theirs + theirFee === mine || theirs === mine + myFee;
      });

      if (half) {
        await cleanupUploadedImage();
        return jsonResponse(req, {
          transaction_id: half.id,
          status: half.status,
          platform: half.platform,
          transfer_to: half.transfer_to,
          transaction_type: half.transaction_type,
          amount: half.amount,
          net_profit: half.net_profit,
          account_number: half.account_number,
          reference_number: half.reference_number,
          transaction_date: half.transaction_date,
          duplicate: true,
          other_half: true,
        });
      }
    }

    // Written with the service client. The browser role has no INSERT or
    // UPDATE on transactions (20260925000003): if it did, a client could write
    // a row straight to 'confirmed' with no ledger entry behind it. operator_id
    // comes from the verified JWT above, never from the request.
    const { data: transaction, error: txError } = await adminClient
      .from("transactions")
      .insert({
        operator_id: operator.id,
        platform,
        transaction_type: txType,
        amount,
        net_profit: netProfit,
        account_number: accountNumber,
        reference_number: fields.referenceNumber,
        transaction_date: fields.transactionDate,
        image_url: uploadedImagePath,
        ai_raw_text: rawText || null,
        // PHASE 1 ONLY. Balances do not move here — the operator reviews this
        // draft and confirms it, and confirm-transaction writes the ledger
        // entry. Until 2026-09-23 this said "confirmed" and the wallet update
        // ran in the same request, so the confirmation gate the PRD calls
        // mandatory did not exist.
        status: "awaiting_confirm",
        // Stated, not defaulted. 20260924000008 dropped the column default so
        // that a row whose origin is unknown fails to insert rather than
        // quietly claiming to have been read from an image.
        entry_source: "ocr",
        transfer_to: transferTo,
        platform_fee: fields.txType === "Wallet Transfer" ? fields.platformFee : 0,
        was_edited: false,
        edit_history: [],
      })
      .select()
      .single();

    if (txError) {
      if (txError.code === "23505" && fields.referenceNumber) {
        const { data: existing } = await adminClient
          .from("transactions")
          .select("id, status, platform, transaction_type, amount, net_profit, account_number, reference_number, transaction_date")
          .eq("operator_id", operator.id)
          .eq("reference_number", fields.referenceNumber)
          .neq("status", "voided")
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
      // Code and message only. The full error object can carry the failing
      // row, which holds the receipt text and a customer's mobile number.
      console.error("Transaction insert error:", txError.code, txError.message);
      await cleanupUploadedImage();
      await notifyProcessingError("Failed to save transaction");
      return jsonResponse(req, { error: "Failed to save transaction" }, 500);
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

    const grossHint = rule && fields.amount !== null
      ? detectGrossAmount(txType, platform, toMinor(amount), [rule])
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
      // What the operator has to supply before this can be saved. The confirm
      // screen derives the same thing from the row (Unknown / zero), so this
      // is for callers that show a summary without loading the draft.
      transfer_to: transaction.transfer_to,
      needs_review: fields.txType === "Wallet Transfer" && !transferTo
        ? [...fields.needsReview, "transfer_to"]
        : fields.needsReview,
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
    await cleanupUploadedImage();

    // The reading service refusing the request is not a bug in this code and
    // should not read like one. Out of credit, a revoked key and rate limits
    // all mean the same thing to the person holding the phone: screenshots
    // cannot be read right now, so type this one in.
    const e = err as { status?: number; code?: string; type?: string };
    const readerDown = e?.code === "credit_balance_exhausted"
      || e?.code === "insufficient_quota" || e?.type === "insufficient_quota"
      || e?.code === "invalid_api_key"
      || e?.status === 401 || e?.status === 429;

    if (readerDown) {
      console.error("Receipt reader unavailable:", e.status, e.code ?? e.type);
      await notifyProcessingError("Receipt reading is unavailable");
      return jsonResponse(req, {
        error: "Screenshots can't be read right now. Type this one in instead",
        code: "reader_unavailable",
      }, 503);
    }

    console.error("Unhandled error in process-transaction:", err);
    await notifyProcessingError("Internal server error");
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}

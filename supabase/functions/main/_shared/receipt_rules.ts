/**
 * Reading a receipt from its text, with fixed rules.
 *
 * Input: the lines a local OCR engine found on a screenshot, with positions.
 * Output: the same shape a vision model used to return, so everything
 * downstream (extractFields, the draft, the confirm screen) is unchanged.
 *
 * WHY RULES
 * A receipt screenshot is a fixed layout rendered as clean text. Rules read a
 * layout they know the same way every time, cost nothing per image and send
 * nothing off the machine. What they cannot do is cope with a layout they have
 * never seen, and that failure is the safe one here: an unrecognised screen
 * yields "Unknown", the confirm screen leaves the field empty, and nothing is
 * saved until a person fills it in. A model's failure mode was a confident
 * wrong answer.
 *
 * THE OPERATOR'S POINT OF VIEW
 * Screens describe what happened to the wallet; the app records what happened
 * at the counter. Money LEAVING the wallet to a person is a Cash In (the
 * customer handed over cash). Money ARRIVING is a Cash Out.
 *
 * The layouts below were written against real receipts captured in 2026.
 * When an app redesigns a screen, the rule for it stops matching and its
 * fields come back empty; update the rule and add the new capture to the
 * private sample set (tests/ocr/private-samples.test.ts).
 */

export interface OcrLine {
  text: string;
  x0: number; y0: number; x1: number; y1: number;
  /** Lines on the same visual row share a row index. */
  row: number;
  score?: number;
}

export interface OcrResult {
  width: number;
  height: number;
  lines: OcrLine[];
}

export interface RuleAnswer {
  raw_text: string;
  /** A layout's own app, or after applyOwnAccounts any of the shop's wallets. */
  platform: string;
  transaction_type:
    | "Cash In" | "Cash Out" | "Telco Load" | "Bills Payment" | "Bank Transfer" | "Wallet Transfer" | "Unknown";
  amount: number | null;
  reference_number: string | null;
  account_number: string | null;
  transaction_date: string | null;
  /** Which rule matched, for logs and tests. "none" when no layout was recognised. */
  layout: string;
  /**
   * Who was on the other side, as far as the screen shows it. Used only to
   * decide whether that was the shop itself (see applyOwnAccounts); none of
   * it is stored.
   */
  parties: {
    /** GCash "Transfer from A to B": both numbers, in that order. */
    from_mobile?: string | null;
    to_mobile?: string | null;
    /** The other side's mobile number, where the screen shows only one. */
    mobile?: string | null;
    /** The other side's bank or wallet account number, digits only, in full. */
    account?: string | null;
    /** Only the last four digits were shown ("ending in 4388", "....4388"). */
    account_last4?: string | null;
  };
  /**
   * GCash bank transfer receipt only: what arrived and what GCash charged,
   * separately. `amount` on that layout is their total.
   */
  transfer_amount?: number | null;
  platform_fee?: number | null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** OCR drops and adds spaces freely, so labels are compared without them. */
function squash(s: string): string {
  return s.toLowerCase().replace(/[\s:]/g, "");
}

interface Row { cells: string[]; text: string; squashed: string }

function toRows(ocr: OcrResult): Row[] {
  const byRow = new Map<number, OcrLine[]>();
  for (const line of ocr.lines) {
    if (!byRow.has(line.row)) byRow.set(line.row, []);
    byRow.get(line.row)!.push(line);
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => {
      // Single characters are dropped. They are almost always an icon read as
      // a letter (a back arrow as "K", a close button as "X", a signal bar as
      // "1"), and which icons get "read" changes from one OCR model to the
      // next. Left in, a stray "K" in front of "Transaction Details" made the
      // heading unrecognisable. No field on a receipt is one character long.
      const sorted = cells
        .sort((a, b) => a.x0 - b.x0)
        .map((c) => c.text.trim())
        .filter((text) => text.length > 1);
      const text = sorted.join(" ");
      return { cells: sorted, text, squashed: squash(text) };
    });
}

/**
 * The value that goes with a label.
 *
 * Three shapes occur: label and value as separate cells on one row
 * ("Amount" … "+500.00"), fused into one cell ("Ref No.4409227229071"), or the
 * value alone on the next row. `labels` are given squashed.
 */
function valueOf(rows: Row[], labels: string[]): string | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const label of labels) {
      const first = squash(row.cells[0] ?? "");
      if (first === label && row.cells.length > 1) {
        return row.cells.slice(1).join(" ").trim();
      }
      if (first.startsWith(label) && first.length > label.length) {
        // Fused: cut the label off the ORIGINAL text, letter by letter.
        const original = row.cells[0];
        let consumed = 0, index = 0;
        while (index < original.length && consumed < label.length) {
          if (!/[\s:]/.test(original[index])) consumed++;
          index++;
        }
        const rest = [original.slice(index), ...row.cells.slice(1)].join(" ").trim();
        if (rest) return rest;
      }
      if (first === label && row.cells.length === 1 && rows[i + 1]) {
        return rows[i + 1].text.trim();
      }
    }
  }
  return null;
}

/** "₱1,960.00", "P1960.00", "PHP 15,000.00", "+500.00", "- P1,000.00" -> pesos. */
export function parseAmount(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text
    .replace(/php/i, "")
    .replace(/[₱\s^]/g, "")
    .replace(/^[+\-−–]/, "")
    .replace(/^[pP]/, "")        // the peso sign, as OCR renders it
    .replace(/^[+\-−–]/, "");
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const pesos = Number(m[1].replace(/,/g, "")) + Number(((m[2] ?? "0") + "0").slice(0, 2)) / 100;
  return pesos > 0 ? Math.round(pesos * 100) / 100 : null;
}

/** The sign in front of an amount: "+", "-" or "" when none is shown. */
function signOf(text: string | null): "+" | "-" | "" {
  const m = /^\s*([+\-−–])/.exec(text ?? "");
  if (!m) return "";
  return m[1] === "+" ? "+" : "-";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A receipt date to ISO 8601 in Philippine time (+08:00).
 *
 * Tolerates what OCR does to it: "Sep 13, 202609:18 AM", "Oct28,202612:00PM",
 * "Nov 18,2026,10:44 am", "15 Apr 2026, 01:19 AM", "10 Jun 2026, 10:46" (24h).
 */
export function parseDate(text: string | null): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ");
  let day: number, month: number, year: number, rest: string;

  let m = /([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})\s*,?\s*(20\d{2})(.*)$/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) {
    month = MONTHS[m[1].toLowerCase()]; day = Number(m[2]); year = Number(m[3]); rest = m[4];
  } else {
    m = /(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?\s*,?\s*(20\d{2})(.*)$/.exec(t);
    if (!m || !MONTHS[m[2].toLowerCase()]) return null;
    day = Number(m[1]); month = MONTHS[m[2].toLowerCase()]; year = Number(m[3]); rest = m[4];
  }
  if (day < 1 || day > 31) return null;

  let hour = 0, minute = 0;
  const time = /(\d{1,2})\s*:\s*(\d{2})\s*([AaPp])?\.?\s*[Mm]?/.exec(rest);
  if (time) {
    hour = Number(time[1]); minute = Number(time[2]);
    const half = time[3]?.toLowerCase();
    if (half === "p" && hour < 12) hour += 12;
    if (half === "a" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

/**
 * PH mobile numbers in a text, normalised to 09XXXXXXXXX, in order.
 *
 * Matched line by line. Joining lines first let the digits that end one line
 * ("…1,000.00") run into a number that starts the next, and the number was
 * then rejected as part of a longer run of digits.
 */
function mobiles(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const re = /(?<!\d)(?:\+?63|0)[\s-]?(9(?:[\s-]?\d){9})(?!\d)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) found.push("0" + m[1].replace(/[\s-]/g, ""));
  }
  return found;
}

/** Digits only, when there are enough to be an account number; else null. */
function digitsOf(text: string | null | undefined): string | null {
  const d = (text ?? "").replace(/\D/g, "");
  return d.length >= 6 ? d : null;
}

/** The four digits after "ending in", or after a run of dots or asterisks. */
function last4(text: string): string | null {
  const m = /ending\s*in\s*(\d{4})(?!\d)/i.exec(text) ?? /[.*•x]{2,}\s*(\d{4})(?!\d)/i.exec(text);
  return m ? m[1] : null;
}

/** Reference numbers are compared across screens, so spaces are removed. */
function cleanReference(text: string | null): string | null {
  if (!text) return null;
  // The value may be followed by a date on the same row (GCash Express Send).
  const first = text.split(/\s{2,}|(?=\s[A-Z][a-z]{2}\s?\d)/)[0];
  const ref = first.replace(/\s+/g, "").replace(/[^A-Za-z0-9-]/g, "");
  return ref.length >= 5 ? ref : null;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const REF_LABELS = ["refno.", "refno", "ref.no.", "referencenumber", "referenceno.", "referenceno", "referenceid"];
const DATE_LABELS = ["date&time", "date", "paidon", "transactiondate&time", "transactiontime", "completed"];

export function readReceipt(ocr: OcrResult): RuleAnswer {
  const rows = toRows(ocr);
  const raw = rows.map((r) => r.text).join("\n");
  const all = squash(raw);
  const has = (...needles: string[]) => needles.some((n) => all.includes(n));

  const answer: RuleAnswer = {
    raw_text: raw,
    platform: "Unknown",
    transaction_type: "Unknown",
    amount: null,
    reference_number: cleanReference(valueOf(rows, REF_LABELS)),
    account_number: null,
    transaction_date: parseDate(valueOf(rows, DATE_LABELS)),
    layout: "none",
    parties: {},
  };

  // A date that sits beside the reference with no label of its own.
  if (!answer.transaction_date) {
    for (const row of rows) {
      const d = parseDate(row.text);
      if (d && /\d{1,2}\s*:\s*\d{2}/.test(row.text)) { answer.transaction_date = d; break; }
    }
  }

  // ===== GCash: Transaction Details ========================================
  // The screen behind a history entry. It never says "GCash" when the
  // counterparty is another GCash user; the fingerprint is its exact set of
  // labels plus a signed amount.
  const amountCell = valueOf(rows, ["amount"]);
  if (has("transactiondetails") && has("date&time") && has("referencenumber")
      && amountCell && signOf(amountCell) !== "" && !has("referenceid") && !/php/i.test(amountCell)) {
    const sign = signOf(amountCell);
    answer.platform = "GCash";
    answer.amount = parseAmount(amountCell);

    const start = rows.findIndex((r) => r.squashed.includes("transactiondetails"));
    const end = rows.findIndex((r, i) => i > start && squash(r.cells[0] ?? "") === "amount");
    const description = rows.slice(start + 1, end).map((r) => r.text).join("\n");
    const d = squash(description);

    if (d.startsWith("transferfrom")) {
      // "Transfer from <sender> to <receiver>". One of the two is this phone;
      // the sign says which: "+" means the money came in.
      const numbers = mobiles(description);
      answer.layout = "gcash.details.transfer";
      answer.parties = { from_mobile: numbers[0] ?? null, to_mobile: numbers[1] ?? null };
      if (sign === "+") {
        answer.transaction_type = "Cash Out";
        answer.account_number = numbers[0] ?? null;
      } else {
        answer.transaction_type = "Cash In";
        answer.account_number = numbers[1] ?? null;
      }
    } else if (d.startsWith("sentgcashto")) {
      answer.layout = "gcash.details.to-bank";
      answer.transaction_type = "Bank Transfer";
      answer.parties = { account_last4: last4(description) };
    } else if (d.startsWith("paymentto") && sign === "-") {
      // Paid a merchant or biller from the wallet.
      answer.layout = "gcash.details.payment";
      answer.transaction_type = "Bills Payment";
    } else if (d.startsWith("receivedgcashfrom")) {
      // A bank deposit into the wallet: the customer paid e-money, takes cash.
      answer.layout = "gcash.details.from-bank";
      answer.transaction_type = "Cash Out";
      answer.parties = { account_last4: last4(description) };
    } else {
      answer.layout = "gcash.details.other";
      // Direction unknown: leave the type for the operator.
    }
    return answer;
  }

  // ===== GCash: Express Send receipt =======================================
  // "Total Amount Sent" as well as the "Express Send" title: a receipt saved
  // from the app as an image has no title bar at all.
  if (has("sentviagcash") && has("expresssend", "totalamountsent") && !has("banktransfer")) {
    answer.layout = "gcash.express-send";
    answer.platform = "GCash";
    answer.transaction_type = "Cash In";
    answer.amount = parseAmount(valueOf(rows, ["totalamountsent"])) ?? parseAmount(amountCell);
    // The recipient's number is printed above "Sent via GCash".
    const upTo = rows.findIndex((r) => r.squashed.includes("sentviagcash"));
    answer.account_number = mobiles(rows.slice(0, upTo).map((r) => r.text).join("\n"))[0] ?? null;
    answer.parties = { mobile: answer.account_number };
    return answer;
  }

  // ===== GCash: Bank Transfer receipt ======================================
  if (has("sentviagcash") && has("banktransfer")) {
    answer.layout = "gcash.bank-transfer";
    answer.platform = "GCash";
    answer.transaction_type = "Bank Transfer";
    // Total, not Transfer Amount: GCash's own fee leaves the wallet too, and
    // the wallet balance is what this app has to match.
    answer.amount = parseAmount(valueOf(rows, ["total"])) ?? parseAmount(valueOf(rows, ["transferamount"]));
    answer.transfer_amount = parseAmount(valueOf(rows, ["transferamount"]));
    answer.platform_fee = parseAmount(valueOf(rows, ["+fee", "fee"]));
    answer.parties = { account_last4: last4(valueOf(rows, ["accountno.", "accountno", "accountnumber"]) ?? "") };
    return answer;
  }

  // ===== GCash: Pay Online / Pay Bills / Buy Load ==========================
  // "Paid and linked via GCash" is the same receipt when the merchant account
  // was linked during the payment.
  if (has("paidviagcash", "paidandlinkedviagcash")) {
    answer.platform = "GCash";
    answer.amount = parseAmount(valueOf(rows, ["total", "totalamount"])) ?? parseAmount(amountCell);
    if (has("buyload")) {
      answer.layout = "gcash.buy-load";
      answer.transaction_type = "Telco Load";
    } else {
      answer.layout = "gcash.paid";
      answer.transaction_type = "Bills Payment";
    }
    return answer;
  }

  // ===== Maya ==============================================================
  // The wordmark "maya" stands alone on details screens; receipts say
  // "Paid with maya". "Reference ID" is Maya's label and nobody else's here.
  const mayaMark = rows.some((r) => /^maya[!l]?$/i.test(r.text.trim())) || has("paidwithmaya");
  if (mayaMark && has("referenceid")) {
    answer.platform = "Maya";
    // Cell by cell, not row by row: on a transfer from a bank the amount
    // shares its row with the InstaPay mark.
    const money = rows.flatMap((r) => r.cells)
      .find((t) => /^[+\-−–]?\s*[P₱]\s?[\d,]+\.\d{2}$/.test(t.trim()));

    if (has("sentmoneyto")) {
      answer.layout = "maya.details.sent";
      answer.transaction_type = "Cash In";
      answer.amount = parseAmount(money ?? null);
      answer.account_number = mobiles(raw)[0] ?? null;
      answer.parties = { mobile: answer.account_number, account: digitsOf(valueOf(rows, ["accountnumber"])) };
    } else if (has("receivedmoneyfrom")) {
      answer.layout = "maya.details.received";
      answer.transaction_type = "Cash Out";
      answer.amount = parseAmount(money ?? null);
      answer.account_number = mobiles(raw)[0] ?? null;
      // From a bank, the sender is an account number, not a mobile.
      answer.parties = { mobile: answer.account_number, account: digitsOf(valueOf(rows, ["accountnumber"])) };
    } else if (has("paymentsuccessful", "paidtomerchant")) {
      answer.layout = "maya.payment";
      answer.transaction_type = "Bills Payment";
      answer.amount = parseAmount(valueOf(rows, ["paidtomerchant"]));
    } else {
      answer.layout = "maya.other";
      answer.amount = parseAmount(money ?? null);
    }
    return answer;
  }

  // ===== MariBank ==========================================================
  if (has("maribank", "seabank")) {
    answer.platform = "MariBank";
    const headline = rows.find((r) => /^PHP\s?[\d,]+\.\d{2}$/i.test(r.text.trim()))?.text ?? null;

    if (has("processingload") || (has("productname") && has("telco"))) {
      answer.layout = "maribank.load";
      answer.transaction_type = "Telco Load";
      answer.amount = parseAmount(valueOf(rows, ["totalamount", "orderamount"])) ?? parseAmount(headline);
      answer.account_number = mobiles(raw)[0] ?? null;
    } else if (has("processingbillpayment") || has("biller")) {
      answer.layout = "maribank.bill";
      answer.transaction_type = "Bills Payment";
      answer.amount = parseAmount(valueOf(rows, ["billamount", "orderamount"])) ?? parseAmount(headline);
    } else if (has("transfermethod") || has("transferamount")) {
      answer.layout = "maribank.transfer";
      answer.amount = parseAmount(valueOf(rows, ["transferamount"])) ?? parseAmount(headline);
      // "From … MariBank: ****" means this account sent it. If the MariBank
      // line sits under "To" instead, the money came in.
      const from = rows.findIndex((r) => squash(r.cells[0] ?? "") === "from");
      const to = rows.findIndex((r) => squash(r.cells[0] ?? "") === "to");
      const own = rows.findIndex((r) => /^maribank\s*:/i.test(r.text.trim()));
      // The other side's account: the "Acct. No." line that is not ours.
      const acct = rows.find((r) => /^acct\.?\s*no\.?\s*:?/i.test(r.text.trim()));
      answer.parties = { account: digitsOf(acct?.text.replace(/^acct\.?\s*no\.?\s*:?/i, "") ?? null) };
      if (from >= 0 && to >= 0 && own > from && own < to) {
        answer.transaction_type = "Bank Transfer";
      } else if (to >= 0 && own > to) {
        answer.transaction_type = "Cash Out";
      }
    } else {
      answer.layout = "maribank.other";
      answer.amount = parseAmount(headline);
    }
    return answer;
  }

  // ===== Not recognised ====================================================
  // Still offer what the generic labels gave (reference, date) and an amount
  // if the screen has exactly one labelled total. The app and the type stay
  // unknown, so the draft is held for the operator.
  answer.amount = parseAmount(valueOf(rows, ["totalamount", "total", "amount"]));
  return answer;
}

// ---------------------------------------------------------------------------
// The shop's own numbers and accounts
// ---------------------------------------------------------------------------

/** One of the shop's own identifiers, and the wallet it belongs to. */
export interface OwnIdentifier {
  kind: "mobile" | "account";
  /** mobile: 09XXXXXXXXX. account: digits only. */
  value: string;
  /** The wallet's name, as in gocash.accounts. */
  wallet: string;
}

export interface OwnedAnswer extends RuleAnswer {
  /** Set when the receipt is the shop moving its own money. */
  transfer_to: string | null;
}

/**
 * Decide whether the other side of a receipt was the shop itself.
 *
 * A screen shows which way money moved, not why. If the counterparty is one of
 * the shop's own numbers or accounts, nobody was served: it is a Wallet
 * Transfer between two of the shop's wallets, and recording it as a Cash In or
 * Cash Out would book a fee nobody paid.
 *
 * Three strengths of match, strongest first:
 *   - a mobile number, exactly
 *   - a full account number, exactly
 *   - the last four digits of an account, and only if exactly ONE registered
 *     account ends in them. A masked number cannot prove more than that, and
 *     the operator confirms the draft either way.
 *
 * It also makes sure one of the shop's own numbers is never offered as the
 * customer's number.
 */
export function applyOwnAccounts(answer: RuleAnswer, own: readonly OwnIdentifier[]): OwnedAnswer {
  const out: OwnedAnswer = { ...answer, transfer_to: null };
  if (own.length === 0 || answer.platform === "Unknown") return out;

  const walletOfMobile = (m?: string | null) =>
    m ? own.find((o) => o.kind === "mobile" && o.value === m)?.wallet ?? null : null;
  const walletOfAccount = (a?: string | null) =>
    a ? own.find((o) => o.kind === "account" && o.value === a)?.wallet ?? null : null;
  const walletOfLast4 = (d?: string | null) => {
    if (!d) return null;
    const hits = own.filter((o) => o.kind === "account" && o.value.endsWith(d));
    return hits.length === 1 ? hits[0].wallet : null;
  };

  if (out.account_number && walletOfMobile(out.account_number)) out.account_number = null;

  const p = answer.parties;

  // GCash "Transfer from A to B" shows both ends.
  if (p.from_mobile || p.to_mobile) {
    const from = walletOfMobile(p.from_mobile);
    const to = walletOfMobile(p.to_mobile);
    if (from && to && from !== to) {
      out.transaction_type = "Wallet Transfer";
      out.platform = from;
      out.transfer_to = to;
      out.account_number = null;
    } else if (from && !to) {
      // This phone is the sender: the screenshot belongs to that wallet, which
      // matters when the shop runs two GCash numbers.
      out.platform = from;
    } else if (to && !from) {
      out.platform = to;
    }
    return out;
  }

  const other = walletOfMobile(p.mobile) ?? walletOfAccount(p.account) ?? walletOfLast4(p.account_last4);
  if (!other || other === answer.platform) return out;

  const moneyIn = answer.transaction_type === "Cash Out";
  const moneyOut = answer.transaction_type === "Cash In" || answer.transaction_type === "Bank Transfer";
  if (!moneyIn && !moneyOut) return out;

  out.transaction_type = "Wallet Transfer";
  out.account_number = null;
  if (moneyIn) {
    out.platform = other;
    out.transfer_to = answer.platform;
  } else {
    out.transfer_to = other;
    // Where the receipt separates what arrived from what the app charged,
    // the transfer is recorded that way round: amount = what arrived.
    if (answer.transfer_amount && answer.platform_fee) {
      out.amount = answer.transfer_amount;
    } else {
      out.platform_fee = null;
    }
  }
  return out;
}

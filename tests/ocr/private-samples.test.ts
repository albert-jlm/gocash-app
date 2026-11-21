/**
 * The rules against real receipts.
 *
 * The receipts are a shop's own screenshots. They show real names and
 * numbers, so they live outside this (public) repository and this suite is
 * skipped when they are absent. Point GOCASH_PRIVATE_SAMPLES at a folder with:
 *
 *   ocr-out/<image>.json      what the OCR service returned for each image
 *   truth-A.json, truth-B.json  the answer key, transcribed by eye
 *
 * Default: ~/gocash-receipt-samples. Run with `pnpm run test:ocr`.
 *
 * It asserts a floor, not perfection, and prints every miss. A miss that the
 * rules leave EMPTY is safe (the operator is asked). A miss the rules fill in
 * WRONG is the dangerous kind and is counted separately and must stay at zero
 * for amounts and types.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDate, readReceipt, type OcrResult } from "../../supabase/functions/main/_shared/receipt_rules.ts";

const DIR = process.env.GOCASH_PRIVATE_SAMPLES ?? join(homedir(), "gocash-receipt-samples");
const available = existsSync(join(DIR, "truth-A.json")) && existsSync(join(DIR, "ocr-out"));

interface Truth {
  /** Which folder the image's OCR output is in. Set when the key is loaded. */
  set: string;
  file: string; app: string; screen_kind: string; what_happened: string;
  amount_number: number | null; total: string | null;
  reference_number: string | null; datetime_text: string | null;
  counterparty_number: string | null;
}

/** 09XXXXXXXXX if the answer key shows a full mobile number, else null. */
function mobile(s: string | null): string | null {
  const m = /^(?:\+?63|0)(9\d{9})$/.exec((s ?? "").replace(/[\s-]/g, ""));
  return m ? "0" + m[1] : null;
}

/** What the operator's books should say, from what the screen says happened. */
function expectedType(t: Truth): string | null {
  const w = t.what_happened.toLowerCase();
  if (w.includes("received") || w.includes("transfer in")) return "Cash Out";
  if (w.includes("instapay") || w.includes("transferred to a bank")) return "Bank Transfer";
  if (w.includes("load")) return "Telco Load";
  if (w.includes("bill") || w.includes("merchant")) return "Bills Payment";
  if (w.includes("sent") || w.includes("transfer out")) return "Cash In";
  return null;
}

const SUPPORTED = ["GCash", "Maya", "MariBank"];
const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const num = (s: string | null) => (s ? Number(s.replace(/[^\d.]/g, "")) : null);

describe.skipIf(!available)("rules against the private sample set", () => {
  // Every answer key found: the first set at the top level, later batches in
  // their own folders (batch2/truth-C.json, …), each beside its ocr-out/.
  const load = (dir: string, names: string[]): Truth[] =>
    names.filter((n) => existsSync(join(dir, n))).flatMap((n) =>
      (JSON.parse(readFileSync(join(dir, n), "utf8")) as Truth[]).map((t) => ({ ...t, set: dir })));

  const truth: Truth[] = available
    ? [...load(DIR, ["truth-A.json", "truth-B.json"]),
       ...load(join(DIR, "batch2"), ["truth-C.json"])]
    : [];

  const receipts = truth.filter((t) =>
    SUPPORTED.includes(t.app) && ["success receipt", "transaction details"].includes(t.screen_kind));
  const others = truth.filter((t) => !receipts.includes(t));

  const read = (t: Truth) =>
    readReceipt(JSON.parse(readFileSync(join(t.set, "ocr-out", t.file + ".json"), "utf8")) as OcrResult);

  it("reads supported receipts, and never fills a field in wrong", () => {
    const score = { platform: 0, type: 0, amount: 0, reference: 0, date: 0, customer: 0 };
    const wrong: string[] = [];   // filled in, and incorrect
    const empty: string[] = [];   // left for the operator

    for (const t of receipts) {
      const a = read(t);
      const tag = `${t.set === DIR ? "" : "batch2/"}${t.file} [${a.layout}]`;

      if (a.platform === t.app) score.platform++;
      else (a.platform === "Unknown" ? empty : wrong).push(`${tag} platform: got ${a.platform}`);

      const type = expectedType(t);
      if (a.transaction_type === type) score.type++;
      else (a.transaction_type === "Unknown" ? empty : wrong).push(`${tag} type: got ${a.transaction_type}, want ${type}`);

      // On a GCash bank transfer the wallet is debited the total, fee included.
      const accepted = [t.amount_number, num(t.total)].filter((n): n is number => n !== null && n !== undefined);
      if (a.amount !== null && accepted.some((n) => Math.abs(n - a.amount!) < 0.005)) score.amount++;
      else (a.amount === null ? empty : wrong).push(`${tag} amount: got ${a.amount}, want ${accepted.join(" or ")}`);

      if (t.reference_number) {
        if (a.reference_number && norm(a.reference_number) === norm(t.reference_number)) score.reference++;
        else (a.reference_number === null ? empty : wrong).push(`${tag} reference`);
      } else score.reference++;

      // The same parser on the clean, hand-transcribed text is the reference:
      // this checks that OCR noise (lost spaces, fused words) changed nothing.
      if (t.datetime_text) {
        const want = parseDate(t.datetime_text);
        if (a.transaction_date && a.transaction_date === want) score.date++;
        else (a.transaction_date === null ? empty : wrong).push(`${tag} date: got ${a.transaction_date}, want ${want}`);
      } else score.date++;

      // The customer's number, where the screen shows one in full. Never
      // printed: only whether it matched.
      const customer = mobile(t.counterparty_number);
      if (customer) {
        if (a.account_number === customer) score.customer++;
        else (a.account_number === null ? empty : wrong).push(`${tag} customer number`);
      } else score.customer++;
    }

    const n = receipts.length;
    console.log(
      `\nprivate samples: ${n} supported receipts\n` +
      Object.entries(score).map(([k, v]) => `  ${k.padEnd(10)} ${v}/${n}`).join("\n") +
      (empty.length ? `\n  left empty (safe):\n    ${empty.join("\n    ")}` : "") +
      (wrong.length ? `\n  FILLED IN WRONG:\n    ${wrong.join("\n    ")}` : "") + "\n"
    );

    expect(wrong, "a field was filled in with the wrong value").toEqual([]);
    expect(score.platform / n).toBeGreaterThanOrEqual(0.95);
    expect(score.type / n).toBeGreaterThanOrEqual(0.95);
    expect(score.amount / n).toBeGreaterThanOrEqual(0.95);
    expect(score.reference / n).toBeGreaterThanOrEqual(0.95);
    expect(score.date / n).toBeGreaterThanOrEqual(0.95);
  });

  it("does not mistake other screens for a supported receipt", () => {
    // Bank apps, shopping pages, statements. They must come back with the app
    // unknown, so the draft is held instead of posted against a wallet.
    const claimed = others.map((t) => ({ t, a: read(t) })).filter(({ a }) => a.platform !== "Unknown");
    console.log(`private samples: ${others.length} other screens, ${claimed.length} wrongly claimed`);
    expect(claimed.map(({ t, a }) => `${t.file} -> ${a.platform} (${a.layout})`)).toEqual([]);
  });
});

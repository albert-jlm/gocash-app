/**
 * extractFields — unit checks on the rule "unknown stays unknown".
 *
 * The fixtures in ./fixtures replay whole receipts. These pin the individual
 * decisions, including the ones no fixture happens to exercise.
 */
import { describe, expect, it } from "vitest";
import { extractFields } from "../../supabase/functions/main/_shared/extraction.ts";
import {
  detectPlatform,
  detectType,
  extractAccountNumber,
} from "../../supabase/functions/main/_shared/transaction-processing.ts";

const clean = {
  raw_text: "GCash\nSent via GCash\n₱500.00",
  platform: "GCash",
  transaction_type: "Cash In",
  amount: 500,
  reference_number: "1029384756123",
  account_number: null,
  transaction_date: null,
};

describe("amount", () => {
  const amountOf = (amount: unknown) => extractFields({ ...clean, amount });

  it("accepts a positive number or an exactly readable string", () => {
    expect(amountOf(500).amount).toBe(500);
    expect(amountOf(1250.5).amount).toBe(1250.5);
    expect(amountOf("1,250.00").amount).toBe(1250);
    expect(amountOf("PHP 300").amount).toBe(300);
    expect(amountOf(500).needsReview).toEqual([]);
  });

  it("never turns an unreadable amount into a number", () => {
    for (const bad of [null, undefined, 0, -500, NaN, "", "abc", "1,25", 12.345, 2_000_000, {}, []]) {
      const f = amountOf(bad);
      expect(f.amount, `amount ${JSON.stringify(bad)}`).toBeNull();
      expect(f.needsReview).toContain("amount");
    }
  });
});

describe("transaction type", () => {
  it("takes the model's answer only if it is a real type", () => {
    expect(extractFields({ ...clean, transaction_type: "Cash Out" }).txType).toBe("Cash Out");
    expect(extractFields({ ...clean, raw_text: "", transaction_type: "Refund" }).txType).toBe("Unknown");
    expect(extractFields({ ...clean, raw_text: "", transaction_type: 7 }).txType).toBe("Unknown");
  });

  it("has no default: no keyword, or keywords for two types, is Unknown", () => {
    expect(detectType("Successful\n₱1,000.00")).toBe("Unknown");
    expect(detectType("You received ₱800")).toBe("Cash Out");
    expect(detectType("You sent ₱750 to LORNA")).toBe("Cash In");
    // "Sent to" (Cash In) and "InstaPay" (Bank Transfer) both match.
    expect(detectType("Sent to BDO via InstaPay")).toBe("Unknown");
    expect(detectType("SMART POSTPAID\nPayment Successful")).toBe("Unknown");
  });

  it("flags Unknown for review", () => {
    const f = extractFields({ ...clean, raw_text: "Successful", transaction_type: "Unknown" });
    expect(f.txType).toBe("Unknown");
    expect(f.needsReview).toEqual(["transaction_type"]);
  });
});

describe("platform", () => {
  it("folds old branding into the current name", () => {
    expect(extractFields({ ...clean, platform: "PayMaya" }).platform).toBe("Maya");
    expect(extractFields({ ...clean, platform: "SeaBank" }).platform).toBe("MariBank");
  });

  it("uses the text only when it names exactly one platform", () => {
    expect(detectPlatform("Sent via GCash")).toBe("GCash");
    expect(detectPlatform("MariBank\nSend Money\nTo GCash")).toBe("Unknown");
    expect(detectPlatform("Transfer Successful")).toBe("Unknown");
  });

  it("treats a platform the model invented as Unknown", () => {
    const f = extractFields({ ...clean, raw_text: "Successful", platform: "BPI" });
    expect(f.platform).toBe("Unknown");
    expect(f.needsReview).toEqual(["platform"]);
  });
});

describe("customer number", () => {
  it("does not find a mobile number inside a longer run of digits", () => {
    expect(extractAccountNumber("Reference No. MB2409240001987")).toBeNull();
    expect(extractAccountNumber("Ref 1209171234567")).toBeNull();
    expect(extractAccountNumber("to 09171234567 today")).toBe("09171234567");
    expect(extractAccountNumber("to +639171234567")).toBe("09171234567");
  });
});

describe("a model answer of the wrong shape", () => {
  it("degrades to a draft that needs everything, not a crash", () => {
    const f = extractFields({});
    expect(f.needsReview).toEqual(["platform", "transaction_type", "amount"]);
    expect(f.referenceNumber).toBeNull();
    expect(f.accountNumber).toBeNull();
  });

  it("keeps a reference returned as a number", () => {
    expect(extractFields({ ...clean, reference_number: 1029384756123 }).referenceNumber)
      .toBe("1029384756123");
  });
});

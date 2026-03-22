import { describe, expect, it } from "vitest";
import {
  getTransactionDateKey,
  isWithinDateRange,
  matchesTransactionSearch,
} from "../transaction-filters";

const SAMPLE_TRANSACTION = {
  transaction_type: "Cash In",
  account_number: "09171234567",
  reference_number: "1234567890123",
  amount: 1500,
  created_at: "2026-03-22T02:15:00.000Z",
};

describe("transaction filter helpers", () => {
  it("matches amount, account, and reference searches", () => {
    expect(matchesTransactionSearch(SAMPLE_TRANSACTION, "1500")).toBe(true);
    expect(matchesTransactionSearch(SAMPLE_TRANSACTION, "0917")).toBe(true);
    expect(matchesTransactionSearch(SAMPLE_TRANSACTION, "1234567890123")).toBe(true);
    expect(matchesTransactionSearch(SAMPLE_TRANSACTION, "cash in")).toBe(true);
    expect(matchesTransactionSearch(SAMPLE_TRANSACTION, "missing")).toBe(false);
  });

  it("builds Manila date keys", () => {
    expect(getTransactionDateKey(SAMPLE_TRANSACTION.created_at)).toBe("2026-03-22");
  });

  it("checks inclusive date ranges", () => {
    expect(isWithinDateRange(SAMPLE_TRANSACTION.created_at, "2026-03-22", "2026-03-22")).toBe(true);
    expect(isWithinDateRange(SAMPLE_TRANSACTION.created_at, "2026-03-23", "")).toBe(false);
    expect(isWithinDateRange(SAMPLE_TRANSACTION.created_at, "", "2026-03-21")).toBe(false);
  });
});


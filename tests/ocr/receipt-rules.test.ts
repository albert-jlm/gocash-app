/**
 * The receipt rules, on made-up receipts.
 *
 * Each case is the text an OCR engine returns for one layout, row by row, with
 * the quirks real output has (lost spaces, the peso sign read as "P", fused
 * label and value). Names, numbers and references are invented. The same rules
 * are scored against real receipts in private-samples.test.ts, which only runs
 * where those receipts exist.
 */
import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, readReceipt, type OcrResult } from "../../supabase/functions/main/_shared/receipt_rules.ts";
import { extractFields } from "../../supabase/functions/main/_shared/extraction.ts";

/** Rows of cells -> an OcrResult. Cells on a row are spread left to right. */
function screen(rows: string[][]): OcrResult {
  const lines = rows.flatMap((cells, row) =>
    cells.map((text, i) => ({
      text, row, x0: 100 + i * 600, x1: 100 + i * 600 + 400, y0: row * 90, y1: row * 90 + 50,
    })));
  return { width: 1290, height: 2796, lines };
}

const OWN = "09170000001";
const CUSTOMER = "09180000002";

describe("GCash", () => {
  it("transaction details, money in: a Cash Out, and the sender is the customer", () => {
    const a = readReceipt(screen([
      ["8:421", "82"],
      ["Transaction Details"],
      [`Transfer from${CUSTOMER} to`],
      [OWN],
      ["Amount", "+500.00"],
      ["Date & Time", "Feb 27, 2026 8:42AM"],
      ["Reference Number", "4265040134042"],
      ["Have questions or concerns about this transaction?"],
      ["Get Help"],
    ]));
    expect(a).toMatchObject({
      layout: "gcash.details.transfer", platform: "GCash", transaction_type: "Cash Out",
      amount: 500, reference_number: "4265040134042", account_number: CUSTOMER,
      transaction_date: "2026-02-27T08:42:00+08:00",
    });
  });

  it("transaction details, money out: a Cash In, and the receiver is the customer", () => {
    const a = readReceipt(screen([
      ["Transaction Details"],
      [`Transfer from ${OWN} to`],
      [CUSTOMER],
      ["Amount", "-2,500.00"],
      ["Date & Time", "Apr 6,2026 5:18PM"],
      ["ReferenceNumber", "2155342246904"],
      ["Get Help"],
    ]));
    expect(a).toMatchObject({
      platform: "GCash", transaction_type: "Cash In", amount: 2500,
      account_number: CUSTOMER, transaction_date: "2026-04-06T17:18:00+08:00",
    });
  });

  it("icons read as stray letters do not hide the layout", () => {
    // What a different OCR model returns for the same screen: the back arrow
    // becomes "K", the status bar grows a "G" and a "1".
    const a = readReceipt(screen([
      ["8:42", "1", "G", "82"],
      ["K", "Transaction Details"],
      [`Transfer from ${CUSTOMER} to`],
      [OWN],
      ["Amount", "+500.00"],
      ["Date & Time", "Feb 27,2026 8:42AM"],
      ["Reference Number", "4265040134042"],
    ]));
    expect(a).toMatchObject({
      layout: "gcash.details.transfer", transaction_type: "Cash Out", amount: 500, account_number: CUSTOMER,
    });
  });

  it("the sign decides the direction, not the order of the two numbers", () => {
    const rows = (sign: string) => screen([
      ["Transaction Details"], [`Transfer from ${CUSTOMER} to`], [OWN],
      ["Amount", `${sign}300.00`], ["Date & Time", "May 1, 2026 9:00AM"],
      ["Reference Number", "1111111111111"],
    ]);
    expect(readReceipt(rows("+")).transaction_type).toBe("Cash Out");
    expect(readReceipt(rows("-")).transaction_type).toBe("Cash In");
  });

  it("Express Send receipt, with the reference and date fused onto one row", () => {
    const a = readReceipt(screen([
      ["8:18 1"],
      ["Express Send"],
      ["MA.A T."],
      [CUSTOMER],
      ["Sentvia GCash"],
      ["Amount", "1,960.00"],
      ["Total Amount Sent", "P1960.00"],
      ["Ref No.4409227229071", "Sep 30,2026 8:18 PM"],
      ["279g (gco2e)"],
    ]));
    expect(a).toMatchObject({
      layout: "gcash.express-send", platform: "GCash", transaction_type: "Cash In",
      amount: 1960, reference_number: "4409227229071", account_number: CUSTOMER,
      transaction_date: "2026-09-30T20:18:00+08:00",
    });
  });

  it("a receipt saved as an image has no title bar and is still recognised", () => {
    const a = readReceipt(screen([
      ["JU..A C."], [CUSTOMER], ["Sent via GCash"],
      ["Amount", "500.00"], ["TotalAmountSent", "P500.00"],
      ["RefNo.5560734213316", "Jun21,20264:14PM"],
    ]));
    expect(a).toMatchObject({ layout: "gcash.express-send", amount: 500, transaction_type: "Cash In" });
  });

  it("bank transfer: the amount is the total that left the wallet, fee included", () => {
    const a = readReceipt(screen([
      ["Bank Transfer", "X"],
      ["Bank Transfer Complete"],
      ["Sent via GCash"],
      ["Bank", "BPI/VYBE byBPI"],
      ["Account No.", "....4388"],
      ["Transfer Method", "InstaPay"],
      ["Transfer Amount", "1,000.00"],
      ["+Fee", "10.00"],
      ["Total", "p 1,010.00"],
      ["Date", "Sep 13, 202609:18 AM"],
      ["InstaPay InvoiceNo.", "3346636"],
      ["Ref No.", "2219252523104"],
    ]));
    expect(a).toMatchObject({
      layout: "gcash.bank-transfer", platform: "GCash", transaction_type: "Bank Transfer",
      amount: 1010, reference_number: "2219252523104", account_number: null,
      transaction_date: "2026-09-13T09:18:00+08:00",
    });
  });

  it("a deposit from a bank into the wallet is money in", () => {
    const a = readReceipt(screen([
      ["Transaction Details"],
      ["Received GCash from Example Bank"], ["with account ending in 0000"],
      ["Amount", "+1,020.00"], ["Date & Time", "Apr16,20263:53PM"],
      ["ReferenceNumber", "8914205381555"],
    ]));
    expect(a).toMatchObject({ layout: "gcash.details.from-bank", transaction_type: "Cash Out", amount: 1020 });
  });

  it("transaction details for a payment to a merchant", () => {
    const a = readReceipt(screen([
      ["Transaction Details"], ["Payment to Example Merchant"],
      ["Amount", "-300.00"], ["Date & Time", "Nov16,20264:26PM"],
      ["Reference Number", "091850450"],
    ]));
    expect(a).toMatchObject({
      layout: "gcash.details.payment", platform: "GCash", transaction_type: "Bills Payment", amount: 300,
    });
  });

  it("an online payment is read as a bill payment", () => {
    const a = readReceipt(screen([
      ["Pay Online"], ["EXAMPLE MERCHANT"], ["Paidand linkedviaGCash"],
      ["Amount", "717.86"], ["Total", "p 717.86"],
      ["Date", "Oct28,202612:00PM"], ["Reference No.", "704962150"],
    ]));
    expect(a).toMatchObject({
      layout: "gcash.paid", platform: "GCash", transaction_type: "Bills Payment",
      amount: 717.86, reference_number: "704962150",
      transaction_date: "2026-10-28T12:00:00+08:00",
    });
  });
});

describe("Maya", () => {
  it("sent money: a Cash In", () => {
    const a = readReceipt(screen([
      ["Sent money to", "X"], ["- P1,000.00"], [CUSTOMER],
      ["Completed", "Nov 18,2026,10:44 am"], ["Share"],
      ["Reference ID", "D70E 46F3 B518"], ["maya"], ["Get help"],
    ]));
    expect(a).toMatchObject({
      layout: "maya.details.sent", platform: "Maya", transaction_type: "Cash In",
      amount: 1000, reference_number: "D70E46F3B518", account_number: CUSTOMER,
      transaction_date: "2026-11-18T10:44:00+08:00",
    });
  });

  it("received money: a Cash Out", () => {
    const a = readReceipt(screen([
      ["Received money from"], ["P200.00"], [CUSTOMER],
      ["V Completed", "Mar 9,2026,08:47 pm"],
      ["Reference ID", "CF7725430054"], ["maya"],
    ]));
    expect(a).toMatchObject({
      platform: "Maya", transaction_type: "Cash Out", amount: 200,
      transaction_date: "2026-03-09T20:47:00+08:00",
    });
  });

  it("received from a bank: the amount shares its row with the InstaPay mark", () => {
    const a = readReceipt(screen([
      ["Received money from", "X"], ["P2,000.00", "instaFay"], ["EXAMPLE SENDER"],
      ["Completed", "Nov 18,2026,05:27 pm"],
      ["Account type", "Example Bank, Inc."], ["Account number", "00000000000"],
      ["Reference ID", "9503F408F2DB"], ["Trace No", "351705"], ["maya"],
    ]));
    expect(a).toMatchObject({
      layout: "maya.details.received", platform: "Maya", transaction_type: "Cash Out",
      amount: 2000, reference_number: "9503F408F2DB",
    });
  });

  it("payment to a merchant", () => {
    const a = readReceipt(screen([
      ["Payment successful"], ["Paid with mayal"],
      ["Merchant", "Example Agency"], ["Paid to merchant", "P5,700.00"],
      ["Paid on", "15 Apr 2026, 01:19 AM"],
      ["Payment ID", "5D7A3265DC15"], ["Reference ID", "5186 2512 6414"],
    ]));
    expect(a).toMatchObject({
      layout: "maya.payment", transaction_type: "Bills Payment", amount: 5700,
      reference_number: "518625126414", transaction_date: "2026-04-15T01:19:00+08:00",
    });
  });
});

describe("MariBank", () => {
  it("transfer out to another bank", () => {
    const a = readReceipt(screen([
      ["M", "MariBank"], ["Transaction Receipt"], ["PHP", "15,000.00"],
      ["From", "EXAMPLE OWNER"], ["MariBank: *******0000"],
      ["To", "EXAMPLE RECIPIENT"], ["PNB"], ["Acct.No.:000000000000"],
      ["TransferAmount", "PHP 15,000.00"], ["Reference Number", "844348"],
      ["TransferMethod", "instaFay"], ["TransactionDate&Time", "10 Jun 2026, 10:46"],
      ["Receipt generated from MariBank app"],
    ]));
    expect(a).toMatchObject({
      layout: "maribank.transfer", platform: "MariBank", transaction_type: "Bank Transfer",
      amount: 15000, reference_number: "844348", transaction_date: "2026-06-10T10:46:00+08:00",
    });
  });

  it("prepaid load", () => {
    const a = readReceipt(screen([
      ["Transaction Result"], ["Payment Submitted"], ["PHP 98.01"], ["Processing Load"],
      ["Product Name", "Telco Promo"], [`Mobile Number:${CUSTOMER}`],
      ["Total Amount", "PHP 98.01^"], ["Order Amount", "PHP 98.01"],
      ["Payment Method", "MariBank Savings"],
      ["Reference Number", "2000090000000000"], ["TransactionNumber", "FC86700143663234"],
      ["TransactionTime", "21 Nov 2026, 17:33"],
    ]));
    expect(a).toMatchObject({
      layout: "maribank.load", platform: "MariBank", transaction_type: "Telco Load",
      amount: 98.01, reference_number: "2000090000000000", account_number: CUSTOMER,
      transaction_date: "2026-11-21T17:33:00+08:00",
    });
  });
});

describe("screens that are not a supported receipt", () => {
  it("a bank app's payment page: app and type stay unknown, so the draft is held", () => {
    const a = readReceipt(screen([
      ["Payment Successful"], ["Biller", "EXAMPLE ELECTRIC"],
      ["Amount", "PHP 2,345.67"], ["Reference Number", "ABC123456789"],
      ["Date", "03 May 2026, 14:05"],
    ]));
    expect(a.platform).toBe("Unknown");
    expect(a.transaction_type).toBe("Unknown");
    expect(a.layout).toBe("none");
    // What it could read is still offered, to save typing.
    expect(a.amount).toBe(2345.67);

    const fields = extractFields(a, { keywordFallback: false });
    expect(fields.needsReview).toEqual(["platform", "transaction_type"]);
  });

  it("a page with no receipt on it yields nothing", () => {
    const a = readReceipt(screen([["Search results"], ["Dress", "P499"], ["Add to cart"]]));
    expect(a).toMatchObject({ platform: "Unknown", transaction_type: "Unknown", amount: null, reference_number: null });
    expect(extractFields(a, { keywordFallback: false }).needsReview).toEqual(["platform", "transaction_type", "amount"]);
  });

  it("a recognised receipt passes through extractFields with nothing to review", () => {
    const a = readReceipt(screen([
      ["Transaction Details"], [`Transfer from ${CUSTOMER} to`], [OWN],
      ["Amount", "+500.00"], ["Date & Time", "Feb 27, 2026 8:42AM"],
      ["Reference Number", "4265040134042"],
    ]));
    const fields = extractFields(a, { keywordFallback: false });
    expect(fields.needsReview).toEqual([]);
    expect(fields).toMatchObject({ platform: "GCash", txType: "Cash Out", amount: 500 });
  });
});

describe("amounts and dates as OCR renders them", () => {
  it("amounts", () => {
    expect(parseAmount("P1960.00")).toBe(1960);
    expect(parseAmount("p 1,010.00")).toBe(1010);
    expect(parseAmount("₱5,700.00")).toBe(5700);
    expect(parseAmount("PHP 98.01^")).toBe(98.01);
    expect(parseAmount("+13,860.00")).toBe(13860);
    expect(parseAmount("- P1,000.00")).toBe(1000);
    expect(parseAmount("717.86")).toBe(717.86);
    expect(parseAmount("FREE")).toBeNull();
    expect(parseAmount("1,96")).toBeNull();
    expect(parseAmount("0.00")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });

  it("dates, in Philippine time", () => {
    expect(parseDate("Sep 13, 202609:18 AM")).toBe("2026-09-13T09:18:00+08:00");
    expect(parseDate("Oct28,202612:00PM")).toBe("2026-10-28T12:00:00+08:00");
    expect(parseDate("Nov 18,2026,10:44 am")).toBe("2026-11-18T10:44:00+08:00");
    expect(parseDate("15 Apr 2026, 01:19 AM")).toBe("2026-04-15T01:19:00+08:00");
    expect(parseDate("10 Jun 2026, 10:46")).toBe("2026-06-10T10:46:00+08:00");
    expect(parseDate("21 Nov 2026, 17:33")).toBe("2026-11-21T17:33:00+08:00");
    expect(parseDate("Mar 9,2026,08:47 pm")).toBe("2026-03-09T20:47:00+08:00");
    expect(parseDate("Jan 5, 2026 12:05AM")).toBe("2026-01-05T00:05:00+08:00");
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

export interface SearchableTransaction {
  amount: number;
  account_number: string | null;
  reference_number: string | null;
  transaction_type: string;
  created_at: string;
}

const DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function getTransactionDateKey(iso: string): string {
  return DATE_KEY_FORMATTER.format(new Date(iso));
}

export function isWithinDateRange(
  iso: string,
  dateFrom?: string,
  dateTo?: string
): boolean {
  const key = getTransactionDateKey(iso);

  if (dateFrom && key < dateFrom) return false;
  if (dateTo && key > dateTo) return false;

  return true;
}

export function matchesTransactionSearch(
  tx: SearchableTransaction,
  query: string
): boolean {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return true;

  const digitsQuery = normalizedQuery.replace(/\D/g, "");
  const amountFormats = [
    tx.amount.toFixed(2),
    tx.amount.toLocaleString("en-PH", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }),
    tx.amount.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  ];

  const haystacks = [
    tx.transaction_type.toLowerCase(),
    (tx.account_number ?? "").toLowerCase(),
    (tx.reference_number ?? "").toLowerCase(),
    ...amountFormats.map((value) => value.toLowerCase()),
  ];

  if (haystacks.some((value) => value.includes(normalizedQuery))) return true;
  if (!digitsQuery) return false;

  return haystacks.some((value) => value.replace(/\D/g, "").includes(digitsQuery));
}


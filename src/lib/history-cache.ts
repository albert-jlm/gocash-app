let rows: unknown[] | null = null;

export function readHistory<T>(): T[] | null {
  return rows as T[] | null;
}

export function writeHistory<T>(next: T[]) {
  rows = next;
}

export function dropFromHistory(id: string) {
  if (rows) rows = rows.filter((row) => (row as { id?: string }).id !== id);
}

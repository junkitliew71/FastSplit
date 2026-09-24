export type ReceiptKeywordCategory =
  | 'SUBTOTAL'
  | 'SERVICE_CHARGE'
  | 'TAX'
  | 'SST'
  | 'GRAND_TOTAL'
  | 'DISCOUNT'
  | 'ROUNDING'
  | 'METADATA'
  | 'PAYMENT'
  | 'FOOTER';

export type ReceiptKeywordMatch = {
  category: ReceiptKeywordCategory;
  keyword: string;
  similarity: number;
  exact: boolean;
};

const KEYWORDS: Record<ReceiptKeywordCategory, string[]> = {
  SUBTOTAL: ['SUBTOTAL', 'SUB TOTAL', 'SUB-TOTAL'],
  SERVICE_CHARGE: ['SERVICE CHARGE', 'SERVICE CHG', 'SERV CHG', 'SVC CHARGE', 'SVC CHG', '10% SC'],
  TAX: ['TAX', 'SERVICE TAX', 'SALES TAX', 'GST'],
  SST: ['SST', 'SST 6%', 'SST 8%'],
  GRAND_TOTAL: ['GRAND TOTAL', 'NET TOTAL', 'NETT TOTAL', 'AMOUNT DUE', 'TOTAL DUE', 'TOTAL AMOUNT'],
  DISCOUNT: ['DISCOUNT', 'DISC', 'PROMO'],
  ROUNDING: ['ROUNDING', 'ROUND', 'ROUNDING ADJ'],
  METADATA: ['TABLE', 'TABLE NO', 'CASHIER', 'DATE', 'TIME', 'INVOICE', 'INV NO', 'BILL NO', 'RECEIPT NO', 'TERMINAL', 'TRANS TYPE', 'PAX'],
  PAYMENT: ['CASH', 'CARD', 'VISA', 'MASTERCARD', 'TENDERED', 'RECEIVED', 'CHANGE', 'PAYMENT'],
  FOOTER: ['THANK YOU', 'COME AGAIN', 'NO REFUND'],
};

const entries = Object.entries(KEYWORDS).flatMap(([category, keywords]) => keywords.map((keyword) => ({
  category: category as ReceiptKeywordCategory,
  keyword: normalizeReceiptText(keyword),
})));

export function normalizeReceiptText(text: string): string {
  return text
    .toUpperCase()
    .trim()
    .replace(/[‐‑‒–—-]+/g, ' ')
    .replace(/\bSVC\./g, 'SVC')
    .replace(/[,:;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function similarity(left: string, right: string): number {
  const a = normalizeReceiptText(left);
  const b = normalizeReceiptText(right);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return Math.max(0, 1 - (previous[b.length] ?? Math.max(a.length, b.length)) / Math.max(a.length, b.length));
}

export function matchReceiptKeyword(text: string): ReceiptKeywordMatch | null {
  const normalized = normalizeReceiptText(text);
  const labelText = normalized.replace(/\s+(?:RM|MYR)?\s*[-+]?\d+(?:[.,]\d+)?\s*$/i, '').trim();
  let best: ReceiptKeywordMatch | null = null;
  for (const entry of entries) {
    const exact = normalized === entry.keyword
      || normalized.startsWith(`${entry.keyword} `)
      || labelText === entry.keyword;
    const score = exact ? 1 : similarity(labelText, entry.keyword);
    const length = entry.keyword.length;
    const threshold = length <= 3 ? 1 : length <= 7 ? 0.88 : 0.82;
    if (score < threshold || (length <= 3 && !exact)) continue;
    if (!best || score > best.similarity || (score === best.similarity && entry.keyword.length > best.keyword.length)) {
      best = { ...entry, similarity: score, exact };
    }
  }
  return best;
}

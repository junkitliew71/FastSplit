const MONEY_PATTERN = /^(?:RM|MYR)?\s*[-+]?\(?\d{1,7}(?:[.,]\d{2})?\)?$/i;

export function parseMoneyCents(text: string): number | null {
  const normalized = text.trim().replace(/\s+/g, '').replace(/^(?:RM|MYR)/i, '');
  if (!MONEY_PATTERN.test(text.trim().replace(/\s+/g, ''))) return null;
  const negative = normalized.startsWith('-') || (normalized.startsWith('(') && normalized.endsWith(')'));
  const unsigned = normalized.replace(/[+()-]/g, '').replace(',', '.');
  const [whole = '0', decimal = ''] = unsigned.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0').slice(0, 2));
  return Number.isSafeInteger(cents) ? (negative ? -cents : cents) : null;
}

export function parseQuantity(text: string): number | null {
  const match = text.trim().match(/^(\d{1,5}(?:,\d{3})?)(?:\s*[x×])?$/i);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', ''));
  return value > 0 ? value : null;
}

export function approximatelyEqual(left: number, right: number, toleranceCents = 1): boolean {
  return Math.abs(left - right) <= toleranceCents;
}

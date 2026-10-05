const PAYMENT_PHONE_KEY = 'fastsplit:payment-phone';

export function normalizePaymentPhone(value: string): string | null {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return `${hasPlus ? '+' : ''}${digits}`;
}

export function loadPaymentPhone(storage: Pick<Storage, 'getItem'>): string {
  return normalizePaymentPhone(storage.getItem(PAYMENT_PHONE_KEY) ?? '') ?? '';
}

export function savePaymentPhone(storage: Pick<Storage, 'setItem'>, value: string): string | null {
  const normalized = normalizePaymentPhone(value);
  if (!normalized) return null;
  storage.setItem(PAYMENT_PHONE_KEY, normalized);
  return normalized;
}

export function deletePaymentPhone(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(PAYMENT_PHONE_KEY);
}

import { describe, expect, it } from 'vitest';
import { deletePaymentPhone, loadPaymentPhone, normalizePaymentPhone, savePaymentPhone } from '../src/payment-phone.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('payment phone storage', () => {
  it('normalizes common Malaysian phone formatting for easy TNG copy and paste', () => {
    expect(normalizePaymentPhone(' 012-345 6789 ')).toBe('0123456789');
    expect(normalizePaymentPhone('+60 12-345 6789')).toBe('+60123456789');
  });

  it('rejects values that are too short or too long', () => {
    expect(normalizePaymentPhone('1234')).toBeNull();
    expect(normalizePaymentPhone('1234567890123456')).toBeNull();
  });

  it('saves, loads and deletes the normalized number', () => {
    const storage = memoryStorage();
    expect(savePaymentPhone(storage, '012-345 6789')).toBe('0123456789');
    expect(loadPaymentPhone(storage)).toBe('0123456789');
    deletePaymentPhone(storage);
    expect(loadPaymentPhone(storage)).toBe('');
  });
});

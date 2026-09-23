import { describe, expect, it } from 'vitest';
import { createHistoryRecord } from '../src/receipt-history-model.js';
import type { ReviewModel } from '../src/review-model.ts';
import type { ReceiptOcrResponse } from '../src/types.ts';

describe('permanent receipt history record', () => {
  it('stores the owner, complete review state and image reference without base64', () => {
    const review = { items: [], summary: {
      subtotal: { valueCents: 1000, mapping: { ocrIds: ['a'] } },
      serviceCharge: { valueCents: 100, mapping: { ocrIds: [] } },
      tax: { valueCents: 60, mapping: { ocrIds: [] } },
      discount: { valueCents: 0, mapping: { ocrIds: [] } },
      rounding: { valueCents: 0, mapping: { ocrIds: [] } },
      grandTotal: { valueCents: 1160, mapping: { ocrIds: ['b'] } },
    }, validation: { itemArithmeticValid: true, subtotalValid: true, grandTotalValid: true, needsReview: false } } as ReviewModel;
    const result = { parsed: { restaurantName: { value: 'Cafe' } } } as ReceiptOcrResponse;
    const saved = createHistoryRecord('firebase-uid', result, review, 'receipts/firebase-uid/id/receipt.jpg', 'https://storage.example/image');
    expect(saved.ownerUid).toBe('firebase-uid');
    expect(saved.grandTotalCents).toBe(1160);
    expect(saved.ocrMappings.summary.subtotal.mapping.ocrIds).toEqual(['a']);
    expect(saved.people).toEqual([]);
    expect(JSON.stringify(saved)).not.toContain('data:image');
  });

  it('rejects a record without a trusted owner UID', () => {
    expect(() => createHistoryRecord('', {} as ReceiptOcrResponse, {} as ReviewModel, '', '')).toThrow(/UID/);
  });
});

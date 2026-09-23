import { describe, expect, it } from 'vitest';
import {
  assignDetection,
  clearTarget,
  cloneReviewModel,
  createReviewModel,
  mappedIdsForTarget,
} from '../src/review-model.js';
import type { OcrDetection, ReceiptOcrResponse } from '../src/types.js';

function detection(id: string, text: string, x: number, y: number): OcrDetection {
  return {
    id, text, confidence: 0.95,
    bbox: { x1: x, y1: y, x2: x + 0.08, y2: y + 0.02 },
    centerX: x + 0.04, centerY: y + 0.01,
  };
}

const ocr = [
  detection('name_2', 'Chicken', 0.1, 0.2),
  detection('name_1', 'Special', 0.1, 0.15),
  detection('name_3', 'Rice', 0.1, 0.25),
  detection('qty', '3', 0.5, 0.25),
  detection('unit', '0.20', 0.65, 0.25),
  detection('total', '0.60', 0.85, 0.25),
  detection('subtotal', '0.60', 0.85, 0.7),
  detection('grand', '0.60', 0.85, 0.9),
];

function response(): ReceiptOcrResponse {
  return {
    requestId: 'request', image: { width: 800, height: 1200, format: 'jpeg' },
    quality: { brightness: 0.7, contrast: 0.5, lowContrast: false, underexposed: false, overexposed: false },
    ocr: { passUsed: 1, secondPassReason: null, confidence: 0.9, text: '', detections: ocr },
    parsed: {
      restaurantName: { value: 'Cafe', confidence: 0.9, mapping: { ocrIds: [] } },
      items: [{
        id: 'item_1', name: '', quantity: null, unitPriceCents: null, totalCents: null,
        confidence: 0.8, needsReview: true,
        mappings: {
          name: { ocrIds: [] }, quantity: { ocrIds: [] }, unitPrice: { ocrIds: [] }, total: { ocrIds: [] },
        },
      }],
      charges: {
        serviceChargeCents: 0, taxCents: 0, discountCents: 0, roundingCents: 0, otherCents: 0,
        mappings: {},
      },
      totals: {
        itemSumCents: 0, subtotalCents: null, grandTotalCents: null,
        mappings: { subtotal: { ocrIds: [] }, grandTotal: { ocrIds: [] } },
      },
      validation: {
        itemArithmeticValid: true, subtotalChecked: false, subtotalValid: null,
        grandTotalChecked: false, grandTotalValid: null,
      },
      confidence: 0.5, needsReview: true,
    },
    timingsMs: { total: 500 }, cacheHit: false, needsReview: true, message: null,
  };
}

describe('Review Receipt OCR mapping', () => {
  it('combines multiple food-name OCR boxes in visual reading order', () => {
    let model = createReviewModel(response());
    model = assignDetection(model, 'item:item_1:foodName', 'name_3', ocr);
    model = assignDetection(model, 'item:item_1:foodName', 'name_1', ocr);
    model = assignDetection(model, 'item:item_1:foodName', 'name_2', ocr);
    expect(model.items[0]?.name).toBe('Special Chicken Rice');
    expect(mappedIdsForTarget(model, 'item:item_1:foodName')).toEqual(['name_3', 'name_1', 'name_2']);
  });

  it('immediately revalidates quantity times unit price against total', () => {
    let model = createReviewModel(response());
    model = assignDetection(model, 'item:item_1:quantity', 'qty', ocr);
    model = assignDetection(model, 'item:item_1:unitPrice', 'unit', ocr);
    model = assignDetection(model, 'item:item_1:total', 'total', ocr);
    expect(model.items[0]?.validation).toEqual({ checked: true, valid: true, differenceCents: 0 });
    expect(model.validation.itemArithmeticValid).toBe(true);
  });

  it('supports clear and a snapshot for undo', () => {
    let model = createReviewModel(response());
    model = assignDetection(model, 'item:item_1:quantity', 'qty', ocr);
    const undoSnapshot = cloneReviewModel(model);
    model = clearTarget(model, 'item:item_1:quantity');
    expect(model.items[0]?.quantity).toBeNull();
    expect(undoSnapshot.items[0]?.quantity).toBe(3);
  });

  it('revalidates subtotal and grand total mappings', () => {
    let model = createReviewModel(response());
    model = assignDetection(model, 'item:item_1:quantity', 'qty', ocr);
    model = assignDetection(model, 'item:item_1:unitPrice', 'unit', ocr);
    model = assignDetection(model, 'item:item_1:total', 'total', ocr);
    model = assignDetection(model, 'summary:subtotal', 'subtotal', ocr);
    model = assignDetection(model, 'summary:grandTotal', 'grand', ocr);
    expect(model.validation).toMatchObject({ subtotalValid: true, grandTotalValid: true, needsReview: false });
  });
});

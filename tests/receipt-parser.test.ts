import { describe, expect, it } from 'vitest';
import { reconstructLayout } from '../server/layout.js';
import { parseMoneyCents } from '../server/money.js';
import { parseReceipt } from '../server/receipt-parser.js';
import type { OcrDetection } from '../server/types.js';

let detectionNumber = 0;
function word(text: string, x: number, y: number, confidence = 0.96): OcrDetection {
  const width = Math.max(0.025, text.length * 0.012);
  return {
    id: `ocr_${++detectionNumber}`,
    text,
    confidence,
    bbox: { x1: x, y1: y, x2: x + width, y2: y + 0.018 },
    centerX: x + width / 2,
    centerY: y + 0.009,
  };
}

function receiptDetections(): OcrDetection[] {
  detectionNumber = 0;
  const detections = [
    word('KEDAI', 0.30, 0.04), word('MAKAN', 0.40, 0.04), word('SENTOSA', 0.51, 0.04),
    word('ITEM', 0.08, 0.20), word('QTY', 0.52, 0.20), word('UNIT', 0.65, 0.20), word('TOTAL', 0.84, 0.20),
    word('Chicken', 0.08, 0.28), word('Rice', 0.19, 0.28), word('2', 0.53, 0.28), word('7.50', 0.66, 0.28), word('15.00', 0.85, 0.28),
    word('Teh', 0.08, 0.34), word('Tarik', 0.14, 0.34), word('2', 0.53, 0.34), word('2.50', 0.66, 0.34), word('5.00', 0.86, 0.34),
    word('Take', 0.08, 0.40), word('Away', 0.16, 0.40), word('3', 0.51, 0.40), word('x', 0.55, 0.40), word('0.20', 0.66, 0.40), word('0.60', 0.86, 0.40),
    word('SUBTOTAL', 0.55, 0.55), word('20.60', 0.85, 0.55),
    word('SERVICE', 0.50, 0.61), word('CHARGE', 0.61, 0.61), word('1.00', 0.86, 0.61),
    word('SST', 0.58, 0.67), word('1.24', 0.86, 0.67),
    word('DISCOUNT', 0.54, 0.73), word('-1.00', 0.85, 0.73),
    word('ROUNDING', 0.54, 0.79), word('-0.01', 0.85, 0.79),
    word('GRAND', 0.53, 0.87), word('TOTAL', 0.65, 0.87), word('21.83', 0.85, 0.87),
  ];
  return detections.sort((left, right) => right.id.localeCompare(left.id));
}

describe('receipt layout and parser', () => {
  it('reconstructs rows by coordinates instead of OCR input order', () => {
    const layout = reconstructLayout(receiptDetections().reverse());
    expect(layout.rows[0]?.text).toBe('KEDAI MAKAN SENTOSA');
    expect(layout.rows.find((row) => row.text.includes('Chicken'))?.text).toBe('Chicken Rice 2 7.50 15.00');
    expect(layout.columns.map((column) => column.kind)).toEqual(['description', 'quantity', 'unitPrice', 'total']);
  });

  it('extracts items, charges and reconciles the whole receipt', () => {
    const parsed = parseReceipt(receiptDetections());
    expect(parsed.restaurantName.value).toBe('KEDAI MAKAN SENTOSA');
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[2]).toMatchObject({
      name: 'Take Away', quantity: 3, unitPriceCents: 20, totalCents: 60,
      needsReview: false,
      validation: { checked: true, valid: true, differenceCents: 0 },
    });
    expect(parsed.charges).toMatchObject({
      serviceChargeCents: 100, taxCents: 124, discountCents: 100, roundingCents: -1,
    });
    expect(parsed.totals).toEqual({ itemSumCents: 2060, subtotalCents: 2060, grandTotalCents: 2183 });
    expect(parsed.validation).toMatchObject({
      itemArithmeticValid: true,
      subtotalChecked: true,
      subtotalValid: true,
      grandTotalChecked: true,
      grandTotalValid: true,
      expectedGrandTotalCents: 2183,
    });
    expect(parsed.needsReview).toBe(false);
    expect(parsed.items[2]?.mappings.unitPrice.ocrIds).toHaveLength(1);
  });

  it('rejects mathematically inconsistent item associations', () => {
    const detections = receiptDetections();
    const quantity = detections.find((item) => item.text === '3');
    const unitPrice = detections.find((item) => item.text === '0.20');
    if (!quantity || !unitPrice) throw new Error('Fixture is incomplete');
    quantity.text = '9';
    unitPrice.text = '0.07';
    const parsed = parseReceipt(detections);
    expect(parsed.items.find((item) => item.name === 'Take Away')?.validation).toMatchObject({
      checked: true, valid: false, differenceCents: 3,
    });
    expect(parsed.validation.itemArithmeticValid).toBe(false);
    expect(parsed.needsReview).toBe(true);
  });

  it('associates a wrapped item name with the following numeric row', () => {
    detectionNumber = 0;
    const parsed = parseReceipt([
      word('ITEM', 0.08, 0.10), word('QTY', 0.52, 0.10), word('UNIT', 0.65, 0.10), word('TOTAL', 0.84, 0.10),
      word('Special', 0.08, 0.20), word('Chicken', 0.19, 0.20),
      word('Rice', 0.08, 0.24), word('1', 0.53, 0.24), word('8.50', 0.66, 0.24), word('8.50', 0.85, 0.24),
      word('TOTAL', 0.65, 0.40), word('8.50', 0.85, 0.40),
    ]);
    expect(parsed.items[0]).toMatchObject({ name: 'Special Chicken Rice', quantity: 1, unitPriceCents: 850, totalCents: 850 });
  });

  it('parses Malaysian money without floating-point arithmetic', () => {
    expect(parseMoneyCents('RM 2.10')).toBe(210);
    expect(parseMoneyCents('MYR2.10')).toBe(210);
    expect(parseMoneyCents('(0.05)')).toBe(-5);
  });
});

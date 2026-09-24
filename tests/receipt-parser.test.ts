import { describe, expect, it } from 'vitest';
import { reconstructLayout } from '../server/layout.js';
import { parseMoneyCents, parseQuantity } from '../server/money.js';
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
    expect(parsed.totals).toMatchObject({ itemSumCents: 2060, subtotalCents: 2060, grandTotalCents: 2183 });
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

  it('parses Malaysian GST invoices with numeric rows followed by item names and dual prices', () => {
    detectionNumber = 0;
    const parsed = parseReceipt([
      word('KEDAI', 0.28, 0.04), word('PAPAN', 0.39, 0.04), word('YEW', 0.51, 0.04), word('CHUAN', 0.60, 0.04),
      word('Item', 0.04, 0.20), word('Qty', 0.31, 0.20), word('S/Price', 0.44, 0.20), word('S/Price', 0.59, 0.20), word('Amount', 0.77, 0.20), word('Tax', 0.92, 0.20),
      word('100135', 0.04, 0.26), word('4', 0.32, 0.26), word('8.00', 0.45, 0.26), word('8.48', 0.60, 0.26), word('33.92', 0.78, 0.26), word('SR', 0.93, 0.26),
      word('BESI', 0.04, 0.30), word('R', 0.12, 0.30), word('5.5', 0.16, 0.30), word('(CQ)', 0.23, 0.30),
      word('Total', 0.50, 0.44), word('Sales', 0.58, 0.44), word('(Excluding', 0.66, 0.44), word('GST)', 0.76, 0.44), word('32.00', 0.86, 0.44),
      word('Total', 0.46, 0.50), word('GST', 0.56, 0.50), word('1.92', 0.86, 0.50),
      word('Total', 0.40, 0.56), word('Sales', 0.50, 0.56), word('(Inclusive', 0.60, 0.56), word('of', 0.72, 0.56), word('GST)', 0.76, 0.56), word('33.92', 0.86, 0.56),
    ]);
    expect(parsed.restaurantName.value).toBe('KEDAI PAPAN YEW CHUAN');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({ name: 'BESI R 5.5 (CQ)', quantity: 4, unitPriceCents: 848, totalCents: 3392 });
    expect(parsed.items[0]?.validation.valid).toBe(true);
  });

  it('parses Malaysian money without floating-point arithmetic', () => {
    expect(parseMoneyCents('RM 2.10')).toBe(210);
    expect(parseMoneyCents('MYR2.10')).toBe(210);
    expect(parseMoneyCents('(0.05)')).toBe(-5);
    expect(parseQuantity('1,200')).toBe(1200);
  });

  it('uses semantic receipt evidence while rejecting noisy top rows as the merchant name', () => {
    detectionNumber = 0;
    const parsed = parseReceipt([
      word(':', 0.35, 0.02, 0.35), word('rom', 0.39, 0.02, 0.35),
      word('RESTORAN', 0.28, 0.08), word('AL', 0.46, 0.08), word('RIZWATH', 0.52, 0.08),
      word('12', 0.18, 0.12), word('JALAN', 0.25, 0.12), word('DESA', 0.38, 0.12),
      word('QTY', 0.08, 0.20), word('DESCRIPTION', 0.22, 0.20), word('TOTAL', 0.84, 0.20),
      word('1', 0.08, 0.28), word('Teh', 0.22, 0.28), word('Ais', 0.30, 0.28), word('3.00', 0.85, 0.28),
      word('Sub', 0.55, 0.40), word('Total', 0.64, 0.40), word('3.00', 0.85, 0.40),
      word('Servlce', 0.49, 0.46), word('Chg', 0.65, 0.46), word('0.30', 0.85, 0.46),
      word('Grand', 0.50, 0.52), word('Total', 0.64, 0.52), word('3.30', 0.85, 0.52),
    ]);
    expect(parsed.restaurantName.value).toBe('RESTORAN AL RIZWATH');
    expect(parsed.charges.serviceChargeCents).toBe(30);
    expect(parsed.understanding.lines.find((line) => line.text.includes('Servlce'))?.primaryLabel).toBe('SERVICE_CHARGE');
  });

  it('associates description-only rows with following amount-only rows and stops at TOTAL AMOUNT', () => {
    detectionNumber = 0;
    const parsed = parseReceipt([
      word('CAFE', 0.40, 0.05),
      word('DESCRIPTION', 0.10, 0.15), word('TOTAL', 0.84, 0.15),
      word('Coffee', 0.10, 0.24),
      word('5.00', 0.84, 0.27),
      word('Cake', 0.10, 0.32),
      word('8.00', 0.84, 0.35),
      word('TOTAL', 0.55, 0.44), word('AMOUNT', 0.66, 0.44), word('13.00', 0.84, 0.44),
    ]);
    expect(parsed.items.map((item) => item.name)).toEqual(['Coffee', 'Cake']);
    expect(parsed.items.map((item) => item.totalCents)).toEqual([500, 800]);
    expect(parsed.totals.grandTotalCents).toBe(1300);
  });
});

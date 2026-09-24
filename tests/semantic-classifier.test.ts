import { describe, expect, it } from 'vitest';
import { reconstructLayout } from '../server/layout.js';
import { normalizeReceiptText, matchReceiptKeyword, similarity } from '../server/receipt-keywords.js';
import { detectReceiptRegions } from '../server/receipt-regions.js';
import { classifyLine, classifyReceiptLayout } from '../server/semantic-classifier.js';
import type { LayoutRow, OcrDetection, ReceiptRegionKind, ReceiptSemanticLabel } from '../server/types.js';

let sequence = 0;

function word(text: string, x: number, y: number, confidence = 0.96): OcrDetection {
  const width = Math.max(0.025, text.length * 0.011);
  return {
    id: `semantic_ocr_${++sequence}`,
    text,
    confidence,
    bbox: { x1: x, y1: y, x2: x + width, y2: y + 0.018 },
    centerX: x + width / 2,
    centerY: y + 0.009,
  };
}

function line(y: number, parts: Array<[string, number, number?]>): OcrDetection[] {
  return parts.map(([text, x, confidence]) => word(text, x, y, confidence));
}

function row(textParts: Array<[string, number, number?]>): LayoutRow {
  return reconstructLayout(line(0.2, textParts)).rows[0] as LayoutRow;
}

function label(textParts: Array<[string, number, number?]>, region: ReceiptRegionKind): ReceiptSemanticLabel {
  return classifyLine(row(textParts), { region, regionConfidence: 0.95 }).primaryLabel;
}

describe('Malaysian receipt keyword normalization and matching', () => {
  it('normalizes harmless punctuation without numeric-looking character substitutions', () => {
    expect(normalizeReceiptText('  Sub-Total:  ')).toBe('SUB TOTAL');
    expect(normalizeReceiptText('Svc.   Chg')).toBe('SVC CHG');
    expect(normalizeReceiptText('S0I')).toBe('S0I');
  });

  it.each(['Service Chg', 'Servlce Chg', 'Service Chq', 'Svc Chg', '10% SC'])('matches service charge variant %s', (text) => {
    expect(matchReceiptKeyword(text)?.category).toBe('SERVICE_CHARGE');
    expect(label([[text, 0.5], ['37.80', 0.84]], 'SUMMARY')).toBe('SERVICE_CHARGE');
  });

  it.each([
    ['SST', 'SST'], ['SST 6%', 'SST'], ['GST', 'TAX'], ['TAX', 'TAX'],
    ['SUBTOTAL', 'SUBTOTAL'], ['SUB TOTAL', 'SUBTOTAL'], ['SUB-TOTAL', 'SUBTOTAL'],
    ['GRAND TOTAL', 'GRAND_TOTAL'], ['NET TOTAL', 'GRAND_TOTAL'], ['NETT TOTAL', 'GRAND_TOTAL'], ['AMOUNT DUE', 'GRAND_TOTAL'], ['TOTAL AMOUNT', 'GRAND_TOTAL'],
  ] as const)('classifies %s as %s in SUMMARY', (text, expected) => {
    expect(label([[text, 0.5], ['12.00', 0.84]], 'SUMMARY')).toBe(expected);
  });

  it('uses exact matching for short keywords and rejects short fuzzy false positives', () => {
    expect(similarity('SST', 'S5T')).toBeGreaterThan(0.6);
    expect(matchReceiptKeyword('S5T')).toBeNull();
    expect(label([['Taxo', 0.08], ['Chicken', 0.22], ['8.00', 0.84]], 'SUMMARY')).toBe('UNKNOWN');
  });
});

describe('semantic line classification', () => {
  it.each([
    ['Cashier ABB', 'CASHIER'], ['Table No 4', 'TABLE_NUMBER'], ['Date 24-Feb-2021', 'DATE'],
    ['Time 12:19 PM', 'TIME'], ['Invoice 0012945', 'INVOICE_NUMBER'], ['Terminal SFE1', 'TERMINAL'],
  ] as const)('classifies metadata %s', (text, expected) => {
    expect(label([[text, 0.08]], 'METADATA')).toBe(expected);
  });

  it.each([
    ['Cash 500.00', 'CASH'], ['Card', 'PAYMENT_METHOD'], ['Visa', 'PAYMENT_METHOD'],
    ['Mastercard', 'PAYMENT_METHOD'], ['Change 59.25', 'CHANGE'],
  ] as const)('classifies payment %s', (text, expected) => {
    expect(label([[text, 0.55]], 'PAYMENT')).toBe(expected);
  });

  it('distinguishes merchant website, phone, address and name without inventing a name from a domain', () => {
    expect(label([['ryu-sushi.com', 0.35]], 'MERCHANT')).toBe('MERCHANT_WEBSITE');
    expect(label([['Tel', 0.18], ['03-87686092', 0.35]], 'MERCHANT')).toBe('MERCHANT_PHONE');
    expect(label([['12', 0.08], ['Jalan', 0.16], ['Banting', 0.30]], 'MERCHANT')).toBe('MERCHANT_ADDRESS');
    expect(label([['RYU-SUSHI', 0.36]], 'MERCHANT')).toBe('MERCHANT_NAME');
  });

  it.each(['THANK YOU', 'COME AGAIN'])('ignores footer phrase %s', (text) => {
    expect(label([[text, 0.35]], 'FOOTER')).toBe('IGNORE');
  });

  it('keeps unknown text UNKNOWN and never treats a TOTAL item header as GRAND_TOTAL', () => {
    expect(label([['LUCKY DRAW', 0.35]], 'UNKNOWN')).toBe('UNKNOWN');
    expect(label([['QTY', 0.08], ['ITEM', 0.22], ['TOTAL', 0.82]], 'ITEM_HEADER')).toBe('ITEM_HEADER');
  });

  it('requires item structure, preserves field OCR IDs, and keeps OCR confidence separate', () => {
    sequence = 0;
    const classified = classifyLine(row([['1', 0.06], ['GREEN', 0.18], ['TEA', 0.31], ['12.00', 0.84, 0.31]]), {
      region: 'ITEMS', regionConfidence: 0.9,
    });
    expect(classified.primaryLabel).toBe('ITEM');
    expect(classified.fields.map((field) => field.label)).toEqual(['ITEM_QUANTITY', 'ITEM_NAME', 'ITEM_TOTAL']);
    expect(classified.fields.find((field) => field.label === 'ITEM_TOTAL')?.ocrIds).toHaveLength(1);
    expect(classified.ocrIds).toHaveLength(4);
    expect(classified.ocrConfidence).toBeLessThan(classified.semanticConfidence);
    expect(label([['123.00', 0.84]], 'ITEMS')).toBe('UNKNOWN');
  });

  it('does not promote food text resembling a keyword to a summary meaning', () => {
    expect(label([['Promo', 0.08], ['Chicken', 0.22], ['12.00', 0.84]], 'ITEMS')).toBe('ITEM');
  });

  it('retains a fuzzy-match warning and independent semantic confidence', () => {
    const classified = classifyLine(row([['Servlce Chg', 0.50, 0.35], ['37.80', 0.84, 0.35]]), {
      region: 'SUMMARY', regionConfidence: 0.95,
    });
    expect(classified.primaryLabel).toBe('SERVICE_CHARGE');
    expect(classified.warnings).toContain('fuzzy keyword match; retain for review');
    expect(classified.ocrConfidence).toBe(0.35);
    expect(classified.semanticConfidence).toBeGreaterThanOrEqual(0.82);
  });
});

describe('RYU-like semantic regression', () => {
  it('classifies the full general receipt structure while preserving multiline item candidates', () => {
    sequence = 0;
    const detections = [
      ...line(0.03, [['RYU-SUSHI', 0.36]]), ...line(0.06, [['ryu-sushi.com', 0.38]]),
      ...line(0.12, [['Table', 0.08], ['No', 0.18], ['4', 0.30]]), ...line(0.15, [['Cashier', 0.08], ['ABB', 0.28]]),
      ...line(0.18, [['Date', 0.08], ['24-Feb-2021', 0.28]]), ...line(0.21, [['Terminal', 0.08], ['SFE1', 0.28]]),
      ...line(0.27, [['QTY', 0.06], ['ITEM', 0.18], ['DESC', 0.29], ['S/PRICE', 0.62], ['AMOUNT', 0.83]]),
      ...line(0.34, [['1', 0.06], ['GREEN', 0.18], ['TEA', 0.29], ['12.00', 0.85]]),
      ...line(0.39, [['2', 0.06], ['MATSU', 0.18], ['338.00', 0.84]]),
      ...line(0.44, [['1', 0.06], ['OPEN', 0.18], ['FOOD', 0.29]]),
      ...line(0.47, [['CHEESECAKE', 0.18], ['28.00', 0.85]]),
      ...line(0.55, [['Sub', 0.54], ['Total', 0.63], ['378.00', 0.84]]),
      ...line(0.59, [['Service', 0.50], ['Chg', 0.63], ['37.80', 0.84]]),
      ...line(0.63, [['SST', 0.55], ['6%', 0.63], ['24.95', 0.84]]),
      ...line(0.67, [['Grand', 0.50], ['Total', 0.63], ['440.75', 0.84]]),
      ...line(0.73, [['Payment', 0.50], ['Card', 0.64]]), ...line(0.77, [['Cash', 0.55], ['500.00', 0.84]]),
      ...line(0.81, [['Change', 0.55], ['59.25', 0.84]]), ...line(0.88, [['THANK', 0.36], ['YOU', 0.49]]),
    ].sort((left, right) => right.id.localeCompare(left.id));
    const layout = reconstructLayout(detections);
    const result = classifyReceiptLayout(layout, detectReceiptRegions(layout));
    const labelsByText = new Map(result.lines.map((item) => [item.text, item.primaryLabel]));

    expect(labelsByText.get('RYU-SUSHI')).toBe('MERCHANT_NAME');
    expect(labelsByText.get('ryu-sushi.com')).toBe('MERCHANT_WEBSITE');
    expect(labelsByText.get('Table No 4')).toBe('TABLE_NUMBER');
    expect(labelsByText.get('QTY ITEM DESC S/PRICE AMOUNT')).toBe('ITEM_HEADER');
    expect(labelsByText.get('1 GREEN TEA 12.00')).toBe('ITEM');
    expect(labelsByText.get('1 OPEN FOOD')).toBe('ITEM');
    expect(labelsByText.get('CHEESECAKE 28.00')).toBe('ITEM');
    expect(labelsByText.get('Sub Total 378.00')).toBe('SUBTOTAL');
    expect(labelsByText.get('Service Chg 37.80')).toBe('SERVICE_CHARGE');
    expect(labelsByText.get('SST 6% 24.95')).toBe('SST');
    expect(labelsByText.get('Grand Total 440.75')).toBe('GRAND_TOTAL');
    expect(labelsByText.get('Payment Card')).toBe('PAYMENT_METHOD');
    expect(labelsByText.get('Cash 500.00')).toBe('CASH');
    expect(labelsByText.get('Change 59.25')).toBe('CHANGE');
    expect(labelsByText.get('THANK YOU')).toBe('IGNORE');
  });
});

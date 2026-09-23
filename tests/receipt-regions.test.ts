import { describe, expect, it } from 'vitest';
import { reconstructLayout } from '../server/layout.js';
import { detectReceiptRegions } from '../server/receipt-regions.js';
import type { OcrDetection, ReceiptRegionKind } from '../server/types.js';

let detectionNumber = 0;

function word(text: string, x: number, y: number, width = Math.max(0.025, text.length * 0.011), confidence = 0.96): OcrDetection {
  return {
    id: `region_ocr_${++detectionNumber}`,
    text,
    confidence,
    bbox: { x1: x, y1: y, x2: x + width, y2: y + 0.018 },
    centerX: x + width / 2,
    centerY: y + 0.009,
  };
}

function line(y: number, parts: Array<[string, number, number?]>): OcrDetection[] {
  return parts.map(([text, x, width]) => word(text, x, y, width));
}

function classify(detections: OcrDetection[]): Array<{ text: string; kind: ReceiptRegionKind }> {
  const layout = reconstructLayout(detections);
  const detected = detectReceiptRegions(layout);
  return layout.rows.map((row) => ({
    text: row.text,
    kind: detected.assignments.find((assignment) => assignment.rowId === row.id)?.kind ?? 'UNKNOWN',
  }));
}

function ryuLikeFixture(): OcrDetection[] {
  detectionNumber = 0;
  return [
    ...line(0.03, [['RYU-SUSHI', 0.36]]),
    ...line(0.06, [['ryu-sushi.com', 0.38]]),
    ...line(0.12, [['Table', 0.08], ['No', 0.18], ['4', 0.30]]),
    ...line(0.15, [['Cashier', 0.08], ['ABB', 0.28]]),
    ...line(0.18, [['Date', 0.08], ['24-Feb-2021', 0.28]]),
    ...line(0.21, [['Terminal', 0.08], ['SFE1', 0.28]]),
    ...line(0.27, [['QTY', 0.06], ['ITEM', 0.18], ['DESC', 0.29], ['S/PRICE', 0.62], ['AMOUNT', 0.83]]),
    ...line(0.34, [['1', 0.06], ['GREEN', 0.18], ['TEA', 0.29], ['12.00', 0.85]]),
    ...line(0.39, [['2', 0.06], ['MATSU', 0.18], ['338.00', 0.84]]),
    ...line(0.44, [['1', 0.06], ['OPEN', 0.18], ['FOOD', 0.29]]),
    ...line(0.47, [['CHEESECAKE', 0.18], ['28.00', 0.85]]),
    ...line(0.55, [['Sub', 0.54], ['Total', 0.63], ['378.00', 0.84]]),
    ...line(0.59, [['Service', 0.50], ['Chg', 0.63], ['37.80', 0.84]]),
    ...line(0.63, [['SST', 0.55], ['6%', 0.63], ['24.95', 0.84]]),
    ...line(0.67, [['Grand', 0.50], ['Total', 0.63], ['440.75', 0.84]]),
    ...line(0.73, [['Payment', 0.50], ['Card', 0.64]]),
    ...line(0.77, [['Cash', 0.55], ['500.00', 0.84]]),
    ...line(0.81, [['Change', 0.55], ['59.25', 0.84]]),
    ...line(0.88, [['THANK', 0.36], ['YOU', 0.49]]),
  ].sort((left, right) => right.id.localeCompare(left.id));
}

describe('line reconstruction', () => {
  it('reconstructs out-of-order, slightly tilted OCR boxes without merging neighboring rows', () => {
    detectionNumber = 0;
    const detections = [
      word('Nasi', 0.08, 0.200),
      word('Lemak', 0.28, 0.205),
      word('1', 0.62, 0.214),
      word('8.50', 0.84, 0.220),
      word('Tea', 0.08, 0.255),
      word('1', 0.62, 0.267),
      word('2.50', 0.84, 0.273),
    ].sort(() => -1);

    const layout = reconstructLayout(detections);
    expect(layout.rows.map((row) => row.text)).toEqual(['Nasi Lemak 1 8.50', 'Tea 1 2.50']);
    expect(layout.rows[0]?.slope).toBeGreaterThan(0);
    expect(layout.rows[0]?.detectionIds).toHaveLength(4);
  });

  it('marks close left-aligned rows as multiline candidates but keeps separate row identities', () => {
    detectionNumber = 0;
    const layout = reconstructLayout([
      ...line(0.20, [['Special', 0.08], ['Chicken', 0.20]]),
      ...line(0.235, [['Rice', 0.08], ['12.00', 0.84]]),
    ]);
    expect(layout.rows).toHaveLength(2);
    expect(layout.rows.every((row) => row.multilineCandidate)).toBe(true);
  });
});

describe('receipt region detection', () => {
  it('detects the general RYU-like merchant, metadata, item, summary, payment and footer structure', () => {
    const rows = classify(ryuLikeFixture());
    expect(rows.filter((row) => /RYU-SUSHI|ryu-sushi\.com/.test(row.text)).map((row) => row.kind)).toEqual(['MERCHANT', 'MERCHANT']);
    expect(rows.filter((row) => /Table|Cashier|Date|Terminal/.test(row.text)).every((row) => row.kind === 'METADATA')).toBe(true);
    expect(rows.find((row) => row.text.includes('QTY ITEM DESC'))?.kind).toBe('ITEM_HEADER');
    expect(rows.filter((row) => /GREEN TEA|MATSU|OPEN FOOD|CHEESECAKE/.test(row.text)).every((row) => row.kind === 'ITEMS')).toBe(true);
    expect(rows.filter((row) => /Sub Total|Service Chg|SST|Grand Total/.test(row.text)).every((row) => row.kind === 'SUMMARY')).toBe(true);
    expect(rows.filter((row) => /^(?:Payment|Cash|Change)\b/.test(row.text)).every((row) => row.kind === 'PAYMENT')).toBe(true);
    expect(rows.find((row) => row.text === 'THANK YOU')?.kind).toBe('FOOTER');
  });

  it('infers items without a header only from multiple neighboring rows with aligned amount columns', () => {
    detectionNumber = 0;
    const rows = classify([
      ...line(0.05, [['CAFE', 0.40]]),
      ...line(0.25, [['Coffee', 0.08], ['5.00', 0.84]]),
      ...line(0.30, [['Cake', 0.08], ['8.00', 0.84]]),
      ...line(0.38, [['Sub', 0.55], ['Total', 0.65], ['13.00', 0.84]]),
    ]);
    expect(rows.filter((row) => /Coffee|Cake/.test(row.text)).map((row) => row.kind)).toEqual(['ITEMS', 'ITEMS']);
  });

  it('does not infer an ITEMS region from a single numeric row', () => {
    detectionNumber = 0;
    const rows = classify([
      ...line(0.05, [['CAFE', 0.40]]),
      ...line(0.25, [['Reference', 0.08], ['123.00', 0.84]]),
    ]);
    expect(rows.find((row) => row.text.includes('Reference'))?.kind).toBe('UNKNOWN');
  });

  it('establishes a summary boundary directly after the final item and never leaks later rows into ITEMS', () => {
    const rows = classify(ryuLikeFixture());
    const summaryIndex = rows.findIndex((row) => row.text.includes('Sub Total'));
    expect(rows[summaryIndex - 1]?.text).toContain('CHEESECAKE');
    expect(rows.slice(summaryIndex).some((row) => row.kind === 'ITEMS')).toBe(false);
  });

  it('keeps unsupported rows UNKNOWN instead of forcing a region', () => {
    detectionNumber = 0;
    const rows = classify([
      ...line(0.05, [['BISTRO', 0.40]]),
      ...line(0.14, [['LUCKY', 0.33], ['DRAW', 0.44]]),
      ...line(0.22, [['QTY', 0.06], ['ITEM', 0.18], ['AMOUNT', 0.84]]),
      ...line(0.30, [['1', 0.06], ['Soup', 0.18], ['9.00', 0.84]]),
      ...line(0.36, [['SubTotal', 0.58], ['9.00', 0.84]]),
      ...line(0.44, [['PROMO', 0.38], ['CODE', 0.48]]),
      ...line(0.50, [['Cash', 0.58], ['10.00', 0.84]]),
      ...line(0.56, [['THANK', 0.38], ['YOU', 0.49]]),
    ]);
    expect(rows.find((row) => row.text === 'PROMO CODE')?.kind).toBe('UNKNOWN');
    expect(rows.find((row) => row.text.startsWith('Cash'))?.kind).toBe('PAYMENT');
    expect(rows.find((row) => row.text === 'THANK YOU')?.kind).toBe('FOOTER');
  });
});

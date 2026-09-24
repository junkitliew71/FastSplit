import { describe, expect, it } from 'vitest';
import { normalizeRecognition } from '../server/ocr-engine.js';
import { getSecondPassReason, mergePasses } from '../server/receipt-ocr.js';
import type { OcrDetection, OcrPass } from '../server/types.js';

function detection(id: string, text: string, confidence: number, x1: number, y1: number, x2: number, y2: number): OcrDetection {
  return { id, text, confidence, bbox: { x1, y1, x2, y2 }, centerX: (x1 + x2) / 2, centerY: (y1 + y2) / 2 };
}

describe('OCR foundation', () => {
  it('normalizes word coordinates and confidence', () => {
    const result = normalizeRecognition({
      text: 'RM 2.10', confidence: 92,
      blocks: [{ paragraphs: [{ lines: [{ words: [
        { text: 'RM', confidence: 98, bbox: { x0: 20, y0: 10, x1: 50, y1: 30 } },
        { text: '2.10', confidence: 86, bbox: { x0: 60, y0: 10, x1: 100, y1: 30 } },
      ] }] }] }],
    }, 200, 100);

    expect(result.confidence).toBe(0.92);
    expect(result.detections[0]).toMatchObject({
      id: 'ocr_1', text: 'RM', confidence: 0.98,
      bbox: { x1: 0.1, y1: 0.1, x2: 0.25, y2: 0.3 },
      centerX: 0.175, centerY: 0.2,
    });
  });

  it('requests a second pass only for unreliable output', () => {
    const reliable = { text: 'receipt', confidence: 0.9, detections: Array.from({ length: 5 }, (_, index) => ({
      id: `ocr_${index}`, text: 'line', confidence: 0.9,
      bbox: { x1: 0, y1: 0, x2: 1, y2: 1 }, centerX: 0.5, centerY: 0.5,
    })) };
    const clear = { lowContrast: false, underexposed: false, overexposed: false };
    expect(getSecondPassReason(reliable, clear)).toBeNull();
    expect(getSecondPassReason({ ...reliable, confidence: 0.5 }, clear)).toBe('very_low_ocr_confidence');
    expect(getSecondPassReason({ ...reliable, confidence: 0.7 }, clear)).toBe('low_ocr_confidence');
    expect(getSecondPassReason({ ...reliable, confidence: 0.7 }, { ...clear, lowContrast: true })).toBe('low_ocr_confidence');
    expect(getSecondPassReason({ ...reliable, detections: [] }, clear)).toBe('too_few_text_regions');
  });

  it('deduplicates shifted second-pass words and prefers a credible amount correction', () => {
    const first: OcrPass = {
      text: 'OPEN FOOD 800K', confidence: 0.7,
      detections: [
        detection('ocr_1', 'OPEN', 0.8, 0.18, 0.4, 0.30, 0.43),
        detection('ocr_2', '800K', 0.62, 0.80, 0.4, 0.91, 0.43),
      ],
    };
    const second: OcrPass = {
      text: 'OPEN FOOD 28.00', confidence: 0.82,
      detections: [
        detection('ocr_1', 'OPEN', 0.84, 0.185, 0.402, 0.305, 0.432),
        detection('ocr_2', '28.00', 0.60, 0.805, 0.402, 0.915, 0.432),
      ],
    };
    const merged = mergePasses(first, second);
    expect(merged.detections).toHaveLength(2);
    expect(merged.detections[1]).toMatchObject({ id: 'ocr_2', text: '28.00' });
  });
});

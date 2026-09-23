import { describe, expect, it } from 'vitest';
import { normalizeRecognition } from '../server/ocr-engine.js';
import { getSecondPassReason } from '../server/receipt-ocr.js';

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
    expect(getSecondPassReason({ ...reliable, confidence: 0.7 }, clear)).toBeNull();
    expect(getSecondPassReason({ ...reliable, confidence: 0.7 }, { ...clear, lowContrast: true })).toBe('image_quality_and_ocr_confidence');
    expect(getSecondPassReason({ ...reliable, detections: [] }, clear)).toBe('too_few_text_regions');
  });
});

import { randomUUID } from 'node:crypto';
import type { OcrEngine } from './ocr-engine.js';
import { preprocessImage } from './preprocess.js';
import { StageTimer } from './timing.js';
import type { OcrPass, ReceiptOcrResponse } from './types.js';

const MIN_CONFIDENCE = 0.76;
const MIN_WORDS = 4;

export async function processReceipt(input: Buffer, engine: OcrEngine): Promise<ReceiptOcrResponse> {
  const requestId = randomUUID();
  const timer = new StageTimer();
  const prepared = await timer.measure('preprocess', () => preprocessImage(input));
  const first = await timer.measure('ocrPass1', () => engine.recognize(prepared.firstPass, prepared.width, prepared.height));
  const secondPassReason = getSecondPassReason(first, prepared.quality.lowContrast);
  let selected = first;
  let passUsed: 1 | 2 = 1;

  if (secondPassReason) {
    const enhanced = await timer.measure('enhance', prepared.createSecondPass);
    const second = await timer.measure('ocrPass2', () => engine.recognize(enhanced, prepared.width, prepared.height));
    if (score(second) > score(first)) {
      selected = second;
      passUsed = 2;
    }
  }

  const needsReview = selected.confidence < MIN_CONFIDENCE || selected.detections.length < MIN_WORDS;
  const timingsMs = timer.finish();
  return {
    requestId,
    image: { width: prepared.width, height: prepared.height, format: prepared.format },
    quality: prepared.quality,
    ocr: { ...selected, passUsed, secondPassReason },
    timingsMs,
    needsReview,
    message: needsReview ? 'Could not read this receipt clearly. Please retake the photo or enter the bill manually.' : null,
  };
}

export function getSecondPassReason(result: OcrPass, lowContrast: boolean): string | null {
  if (result.detections.length < MIN_WORDS) return 'too_few_text_regions';
  if (result.confidence < MIN_CONFIDENCE) return 'low_ocr_confidence';
  if (lowContrast && result.confidence < 0.86) return 'low_image_contrast';
  return null;
}

function score(result: OcrPass): number {
  const usefulRegions = Math.min(result.detections.length, 25) / 25;
  return result.confidence * 0.82 + usefulRegions * 0.18;
}

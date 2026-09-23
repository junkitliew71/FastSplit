import { createHash, randomUUID } from 'node:crypto';
import type { OcrEngine } from './ocr-engine.js';
import { preprocessImage } from './preprocess.js';
import { parseReceipt } from './receipt-parser.js';
import { StageTimer } from './timing.js';
import type { OcrPass, ReceiptOcrResponse } from './types.js';

const MIN_CONFIDENCE = 0.76;
const SECOND_PASS_CONFIDENCE = 0.82;
const MIN_WORDS = 4;
const VERY_LOW_CONFIDENCE = 0.55;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 24;

type CacheEntry = { expiresAt: number; response: ReceiptOcrResponse };
const resultCache = new Map<string, CacheEntry>();

export async function processReceipt(input: Buffer, engine: OcrEngine): Promise<ReceiptOcrResponse> {
  const requestId = randomUUID();
  const timer = new StageTimer();
  const cacheStarted = performance.now();
  const cacheKey = createHash('sha256').update(input).digest('hex');
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    resultCache.delete(cacheKey);
    resultCache.set(cacheKey, cached);
    return {
      ...structuredClone(cached.response),
      requestId,
      cacheHit: true,
      timingsMs: { cacheLookup: Math.round((performance.now() - cacheStarted) * 10) / 10, total: Math.round((performance.now() - cacheStarted) * 10) / 10 },
    };
  }
  if (cached) resultCache.delete(cacheKey);

  const prepared = await timer.measure('preprocess', () => preprocessImage(input));
  const first = await timer.measure('ocrPass1', () => engine.recognize(prepared.firstPass, prepared.width, prepared.height));
  const secondPassReason = getSecondPassReason(first, prepared.quality);
  let selected = first;
  let passUsed: 1 | 2 = 1;

  if (secondPassReason) {
    const enhanced = await timer.measure('enhance', prepared.createSecondPass);
    const rawSecond = await timer.measure('ocrPass2', () => engine.recognize(enhanced.image, enhanced.width, enhanced.height, 'receipt'));
    const second = remapPass(rawSecond, enhanced, prepared.width, prepared.height);
    if (process.env.NODE_ENV !== 'production') console.debug(`[ocr:passes] first=${first.confidence}/${first.detections.length} second=${second.confidence}/${second.detections.length}`);
    const combined = mergePasses(first, second);
    if (score(combined) > score(first)) {
      selected = combined;
      passUsed = 2;
    }
  }

  const needsReview = selected.confidence < MIN_CONFIDENCE || selected.detections.length < MIN_WORDS;
  const parsed = await timer.measure('layoutParserValidation', async () => parseReceipt(selected.detections));
  const timingsMs = timer.finish();
  const response: ReceiptOcrResponse = {
    requestId,
    image: { width: prepared.width, height: prepared.height, format: prepared.format },
    quality: prepared.quality,
    ocr: { ...selected, passUsed, secondPassReason },
    parsed,
    timingsMs,
    cacheHit: false,
    needsReview: needsReview || parsed.needsReview,
    message: needsReview ? 'Could not read this receipt clearly. Please retake the photo or enter the bill manually.' : null,
  };
  remember(cacheKey, response);
  return response;
}

export function getSecondPassReason(
  result: OcrPass,
  quality: { lowContrast: boolean; underexposed: boolean; overexposed: boolean },
): string | null {
  if (result.detections.length < MIN_WORDS) return 'too_few_text_regions';
  if (result.confidence < VERY_LOW_CONFIDENCE) return 'very_low_ocr_confidence';
  if (result.confidence < SECOND_PASS_CONFIDENCE) return 'low_ocr_confidence';
  const qualityIssue = quality.lowContrast || quality.underexposed || quality.overexposed;
  if (qualityIssue && result.confidence < 0.82) return 'image_quality_and_ocr_confidence';
  return null;
}

function score(result: OcrPass): number {
  const usefulRegions = Math.min(result.detections.length, 25) / 25;
  return result.confidence * 0.82 + usefulRegions * 0.18;
}

function mergePasses(first: OcrPass, second: OcrPass): OcrPass {
  const detections = first.detections.map((item) => ({ ...item }));
  for (const candidate of second.detections) {
    if (candidate.confidence < 0.45) continue;
    const overlaps = detections.some((existing) => {
      const intersectionWidth = Math.max(0, Math.min(existing.bbox.x2, candidate.bbox.x2) - Math.max(existing.bbox.x1, candidate.bbox.x1));
      const intersectionHeight = Math.max(0, Math.min(existing.bbox.y2, candidate.bbox.y2) - Math.max(existing.bbox.y1, candidate.bbox.y1));
      const intersection = intersectionWidth * intersectionHeight;
      const candidateArea = (candidate.bbox.x2 - candidate.bbox.x1) * (candidate.bbox.y2 - candidate.bbox.y1);
      return candidateArea > 0 && intersection / candidateArea > 0.45;
    });
    if (!overlaps) detections.push({ ...candidate, id: `ocr_${detections.length + 1}` });
  }
  const confidence = detections.length
    ? detections.reduce((sum, item) => sum + item.confidence, 0) / detections.length
    : 0;
  return { text: first.text, confidence: Math.round(confidence * 10_000) / 10_000, detections };
}

function remapPass(
  pass: OcrPass,
  crop: { width: number; height: number; offsetX: number; offsetY: number },
  fullWidth: number,
  fullHeight: number,
): OcrPass {
  if (crop.offsetX === 0 && crop.offsetY === 0 && crop.width === fullWidth && crop.height === fullHeight) return pass;
  return {
    ...pass,
    detections: pass.detections.map((detection) => {
      const bbox = {
        x1: (crop.offsetX + detection.bbox.x1 * crop.width) / fullWidth,
        y1: (crop.offsetY + detection.bbox.y1 * crop.height) / fullHeight,
        x2: (crop.offsetX + detection.bbox.x2 * crop.width) / fullWidth,
        y2: (crop.offsetY + detection.bbox.y2 * crop.height) / fullHeight,
      };
      return { ...detection, bbox, centerX: (bbox.x1 + bbox.x2) / 2, centerY: (bbox.y1 + bbox.y2) / 2 };
    }),
  };
}

function remember(key: string, response: ReceiptOcrResponse): void {
  if (resultCache.size >= CACHE_LIMIT) {
    const oldestKey = resultCache.keys().next().value as string | undefined;
    if (oldestKey) resultCache.delete(oldestKey);
  }
  resultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, response: structuredClone(response) });
}

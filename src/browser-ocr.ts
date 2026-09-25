import { createWorker, PSM, type Worker } from 'tesseract.js';
import { parseReceipt } from '../server/receipt-parser.ts';
import type { OcrDetection, ReceiptOcrResponse } from './types.ts';

type RawBox = { x0: number; y0: number; x1: number; y1: number };
type RawWord = { text?: unknown; confidence?: unknown; bbox?: unknown };
type RawLine = { words?: unknown };
type RawParagraph = { lines?: unknown };
type RawBlock = { paragraphs?: unknown };
type RecognitionData = { text?: unknown; confidence?: unknown; blocks?: unknown };

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng', 1).then(async (worker) => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
    return worker;
  });
  return workerPromise;
}

export async function scanReceiptInBrowser(blob: Blob, signal: AbortSignal): Promise<ReceiptOcrResponse> {
  if (signal.aborted) throw new DOMException('Scan cancelled.', 'AbortError');
  const started = performance.now();
  const bitmap = await createImageBitmap(blob);
  const worker = await getWorker();
  if (signal.aborted) throw new DOMException('Scan cancelled.', 'AbortError');
  const ocrStarted = performance.now();
  const result = await worker.recognize(blob, {}, { blocks: true, text: true });
  if (signal.aborted) throw new DOMException('Scan cancelled.', 'AbortError');
  const ocr = normalizeRecognition(result.data as RecognitionData, bitmap.width, bitmap.height);
  const parserStarted = performance.now();
  const parsed = parseReceipt(ocr.detections);
  const total = performance.now() - started;
  bitmap.close();
  return {
    requestId: crypto.randomUUID(),
    image: { width: bitmap.width, height: bitmap.height, format: blob.type || null },
    quality: { brightness: 0.5, contrast: 0.5, lowContrast: false, underexposed: false, overexposed: false },
    ocr: { ...ocr, passUsed: 1, secondPassReason: 'browser_fallback' },
    parsed: parsed as ReceiptOcrResponse['parsed'],
    timingsMs: {
      ocrPass1: Math.round((parserStarted - ocrStarted) * 10) / 10,
      layoutParserValidation: Math.round((performance.now() - parserStarted) * 10) / 10,
      total: Math.round(total * 10) / 10,
    },
    cacheHit: false,
    needsReview: parsed.needsReview || ocr.confidence < 0.76,
    message: parsed.needsReview ? 'Browser OCR completed. Please check the highlighted fields.' : null,
  };
}

function normalizeRecognition(data: RecognitionData, width: number, height: number) {
  const detections: OcrDetection[] = [];
  for (const word of collectWords(data.blocks)) {
    const text = typeof word.text === 'string' ? word.text.trim() : '';
    const confidence = typeof word.confidence === 'number' ? clamp(word.confidence / 100) : 0;
    const box = parseBox(word.bbox);
    if (!text || !box) continue;
    const bbox = {
      x1: clamp(box.x0 / width), y1: clamp(box.y0 / height),
      x2: clamp(box.x1 / width), y2: clamp(box.y1 / height),
    };
    detections.push({
      id: `ocr_${detections.length + 1}`, text, confidence, bbox,
      centerX: (bbox.x1 + bbox.x2) / 2, centerY: (bbox.y1 + bbox.y2) / 2,
    });
  }
  const confidence = typeof data.confidence === 'number'
    ? clamp(data.confidence / 100)
    : detections.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, detections.length);
  return { text: typeof data.text === 'string' ? data.text.trim() : '', confidence, detections };
}

function collectWords(blocks: unknown): RawWord[] {
  if (!Array.isArray(blocks)) return [];
  return (blocks as RawBlock[]).flatMap((block) => Array.isArray(block.paragraphs) ? block.paragraphs : [])
    .flatMap((paragraph: RawParagraph) => Array.isArray(paragraph.lines) ? paragraph.lines : [])
    .flatMap((line: RawLine) => Array.isArray(line.words) ? line.words as RawWord[] : []);
}

function parseBox(value: unknown): RawBox | null {
  if (!value || typeof value !== 'object') return null;
  const box = value as Partial<RawBox>;
  return [box.x0, box.y0, box.x1, box.y1].every((number) => typeof number === 'number') ? box as RawBox : null;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 10_000) / 10_000));
}


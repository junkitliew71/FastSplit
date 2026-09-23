import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { OcrDetection, OcrPass } from './types.js';

type RawBox = { x0: number; y0: number; x1: number; y1: number };
type RawWord = { text?: unknown; confidence?: unknown; bbox?: unknown };
type RawLine = { words?: unknown };
type RawParagraph = { lines?: unknown };
type RawBlock = { paragraphs?: unknown };
type RecognitionData = { text?: unknown; confidence?: unknown; blocks?: unknown };

export class OcrTimeoutError extends Error {
  constructor() {
    super('OCR processing timed out. Please try a smaller or clearer image.');
    this.name = 'OcrTimeoutError';
  }
}

export class OcrEngine {
  #worker: Promise<Worker> | null = null;
  #queue: Promise<void> = Promise.resolve();

  constructor(private readonly languages: string, private readonly timeoutMs: number) {}

  async warmup(): Promise<void> {
    await this.#getWorker();
  }

  recognize(image: Buffer, width: number, height: number, layout: 'auto' | 'receipt' = 'auto'): Promise<OcrPass> {
    const task = this.#queue.then(() => this.#recognizeWithTimeout(image, width, height, layout));
    this.#queue = task.then(() => undefined, () => undefined);
    return task;
  }

  async close(): Promise<void> {
    if (this.#worker) await (await this.#worker).terminate();
    this.#worker = null;
  }

  async #getWorker(): Promise<Worker> {
    const options = process.env.NODE_ENV === 'development'
      ? { logger: (message: { status: string; progress: number }) => console.debug(`[ocr:model] ${message.status} ${Math.round((message.progress ?? 0) * 100)}%`) }
      : {};
    this.#worker ??= createWorker(this.languages, 1, options);
    return this.#worker;
  }

  async #recognizeWithTimeout(image: Buffer, width: number, height: number, layout: 'auto' | 'receipt'): Promise<OcrPass> {
    const worker = await this.#getWorker();
    let timeout: NodeJS.Timeout | undefined;
    try {
      if (layout === 'receipt') {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      } else {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      }
      const result = await Promise.race([
        worker.recognize(image, {}, { blocks: true, text: true }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new OcrTimeoutError()), this.timeoutMs);
        }),
      ]);
      return normalizeRecognition(result.data as RecognitionData, width, height);
    } catch (error) {
      if (error instanceof OcrTimeoutError) {
        await worker.terminate().catch(() => undefined);
        this.#worker = null;
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export function normalizeRecognition(data: RecognitionData, width: number, height: number): OcrPass {
  const words = collectWords(data.blocks);
  const detections: OcrDetection[] = [];
  for (const word of words) {
    const text = typeof word.text === 'string' ? word.text.trim() : '';
    const confidence = typeof word.confidence === 'number' ? clamp(word.confidence / 100) : 0;
    const box = parseBox(word.bbox);
    if (!text || !box) continue;
    const bbox = {
      x1: clamp(box.x0 / width), y1: clamp(box.y0 / height),
      x2: clamp(box.x1 / width), y2: clamp(box.y1 / height),
    };
    detections.push({
      id: `ocr_${detections.length + 1}`,
      text,
      confidence,
      bbox,
      centerX: (bbox.x1 + bbox.x2) / 2,
      centerY: (bbox.y1 + bbox.y2) / 2,
    });
  }
  const confidence = typeof data.confidence === 'number' ? clamp(data.confidence / 100) : meanConfidence(detections);
  return { text: typeof data.text === 'string' ? data.text.trim() : '', confidence, detections };
}

function collectWords(blocks: unknown): RawWord[] {
  if (!Array.isArray(blocks)) return [];
  const words: RawWord[] = [];
  for (const block of blocks as RawBlock[]) {
    if (!Array.isArray(block.paragraphs)) continue;
    for (const paragraph of block.paragraphs as RawParagraph[]) {
      if (!Array.isArray(paragraph.lines)) continue;
      for (const line of paragraph.lines as RawLine[]) {
        if (Array.isArray(line.words)) words.push(...line.words as RawWord[]);
      }
    }
  }
  return words;
}

function parseBox(value: unknown): RawBox | null {
  if (!value || typeof value !== 'object') return null;
  const box = value as Partial<RawBox>;
  return [box.x0, box.y0, box.x1, box.y1].every((number) => typeof number === 'number')
    ? box as RawBox : null;
}

function meanConfidence(detections: OcrDetection[]): number {
  return detections.length
    ? detections.reduce((sum, item) => sum + item.confidence, 0) / detections.length
    : 0;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 10_000) / 10_000));
}

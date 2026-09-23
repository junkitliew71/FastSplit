import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { OcrEngine } from '../server/ocr-engine.js';
import { preprocessImage } from '../server/preprocess.js';
import { processReceipt } from '../server/receipt-ocr.js';

const fixture = await readFile(new URL('./fixtures/sample-receipt.svg', import.meta.url));
const engine = new OcrEngine('eng', 30_000);
const modelStart = performance.now();
await engine.warmup();
const modelInitMs = performance.now() - modelStart;

const prepared = await preprocessImage(fixture);
const legacyStart = performance.now();
await engine.recognize(prepared.firstPass, prepared.width, prepared.height);
const enhanced = await prepared.createSecondPass();
await engine.recognize(enhanced.image, enhanced.width, enhanced.height, 'receipt');
const legacyTwoPassMs = performance.now() - legacyStart;

const optimized = await processReceipt(fixture, engine);
const cached = await processReceipt(fixture, engine);
console.log(JSON.stringify({
  modelInitMs: Math.round(modelInitMs * 10) / 10,
  legacyForcedTwoPassMs: Math.round(legacyTwoPassMs * 10) / 10,
  optimized: optimized.timingsMs,
  optimizedPassUsed: optimized.ocr.passUsed,
  optimizedConfidence: optimized.ocr.confidence,
  cached: cached.timingsMs,
}, null, 2));
await engine.close();

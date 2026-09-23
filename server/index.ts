import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { config } from './config.js';
import { OcrEngine, OcrTimeoutError } from './ocr-engine.js';
import { processReceipt } from './receipt-ocr.js';

const app = express();
const engine = new OcrEngine(config.languages, config.timeoutMs);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileBytes, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, /^image\/(jpeg|png|webp|tiff)$/.test(file.mimetype)),
});

app.disable('x-powered-by');
app.use(cors({ origin: config.clientOrigin }));

app.get('/api/health', (_request, response) => response.json({ status: 'ok', ocr: 'ready' }));

app.post('/api/ocr/receipt', upload.single('receipt'), async (request, response, next) => {
  const uploadStarted = performance.now();
  try {
    if (!request.file) {
      response.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'A valid receipt image is required.' } });
      return;
    }
    const uploadMs = Math.round((performance.now() - uploadStarted) * 10) / 10;
    const result = await processReceipt(request.file.buffer, engine);
    result.timingsMs.upload = uploadMs;
    if (config.isDevelopment) console.info(`[ocr:${result.requestId}]`, result.timingsMs);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  void _next;
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: { code: 'IMAGE_TOO_LARGE', message: 'The receipt image is too large.' } });
    return;
  }
  if (error instanceof OcrTimeoutError) {
    response.status(504).json({ error: { code: 'OCR_TIMEOUT', message: error.message } });
    return;
  }
  const invalidImage = error instanceof Error && /image|Input buffer|unsupported/i.test(error.message);
  console.error('[ocr:error]', error instanceof Error ? error.message : 'Unknown OCR error');
  response.status(invalidImage ? 400 : 500).json({
    error: {
      code: invalidImage ? 'INVALID_IMAGE' : 'OCR_ERROR',
      message: invalidImage ? 'This image could not be read. Please choose a JPG, PNG, WebP, or TIFF image.' : 'The receipt could not be processed. Please try again.',
    },
  });
});

if (process.env.NODE_ENV === 'production') {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(directory));
  app.get(/.*/, (_request, response) => response.sendFile(path.join(directory, 'index.html')));
}

const server = app.listen(config.port, async () => {
  console.info(`[server] FastSplit listening on http://localhost:${config.port}`);
  try {
    const modelStarted = performance.now();
    await engine.warmup();
    console.info(`[ocr] ${config.languages} model loaded once in ${Math.round(performance.now() - modelStarted)}ms and ready`);
  } catch (error) {
    console.error('[ocr] model warmup failed', error instanceof Error ? error.message : error);
  }
});

async function shutdown(): Promise<void> {
  server.close();
  await engine.close();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

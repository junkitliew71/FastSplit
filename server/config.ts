function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: positiveInteger(process.env.PORT, 8787),
  timeoutMs: positiveInteger(process.env.OCR_TIMEOUT_MS, 30_000),
  maxFileBytes: positiveInteger(process.env.OCR_MAX_FILE_BYTES, 12 * 1024 * 1024),
  languages: process.env.OCR_LANGUAGES?.trim() || 'eng',
  clientOrigin: process.env.CLIENT_ORIGIN?.trim() || 'http://localhost:5173',
  isDevelopment: process.env.NODE_ENV !== 'production',
} as const;

import type { ReceiptOcrResponse } from './types.ts';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const OCR_ENDPOINT = `${API_BASE_URL}/api/ocr/receipt`;

type ApiError = { error?: { message?: string } };

export async function scanReceipt(blob: Blob, signal: AbortSignal): Promise<ReceiptOcrResponse> {
  const form = new FormData();
  form.append('receipt', blob, 'receipt.jpg');

  const response = await fetch(OCR_ENDPOINT, { method: 'POST', body: form, signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ApiError;
    throw new Error(body.error?.message ?? `Receipt scan failed (${response.status}).`);
  }
  return response.json() as Promise<ReceiptOcrResponse>;
}

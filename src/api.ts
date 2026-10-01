import type { ReceiptOcrResponse } from './types.ts';

const GOOGLE_SCRIPT_URL = (import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined)?.trim() ?? '';

type ApiError = { error?: { message?: string } };

export async function scanReceipt(blob: Blob, signal: AbortSignal): Promise<ReceiptOcrResponse> {
  if (!GOOGLE_SCRIPT_URL) throw new Error('Google receipt scanner is not configured yet.');
  const imageBase64 = await blobToBase64(blob);
  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ imageBase64, mimeType: blob.type || 'image/jpeg' }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ApiError;
    throw new Error(body.error?.message ?? `Receipt scan failed (${response.status}).`);
  }
  const body = await response.json() as ReceiptOcrResponse | ApiError;
  if (!('requestId' in body)) throw new Error(body.error?.message ?? 'Google could not read this receipt.');
  return body as ReceiptOcrResponse;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not prepare the receipt image.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

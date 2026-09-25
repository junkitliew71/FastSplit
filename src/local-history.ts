import type { ReviewModel } from './review-model.ts';
import type { ReceiptOcrResponse } from './types.ts';

export const HISTORY_TTL_MS = 72 * 60 * 60 * 1000;
const HISTORY_KEY = 'fastsplit:receipt-history:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type LocalHistoryPerson = { id: string; name: string };

export type LocalHistoryRecord = {
  id: string;
  restaurant: string;
  grandTotalCents: number | null;
  reviewModel: ReviewModel;
  ocrResult: ReceiptOcrResponse;
  people: LocalHistoryPerson[];
  assignments: Array<{ itemId: string; personIds: string[] }>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type LocalHistoryInput = Omit<LocalHistoryRecord, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt'>;

function readAll(storage: StorageLike): LocalHistoryRecord[] {
  try {
    const parsed = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function listLocalHistory(storage: StorageLike, now = Date.now()): LocalHistoryRecord[] {
  const records = readAll(storage);
  const active = records.filter((record) => Date.parse(record.expiresAt) > now);
  if (active.length !== records.length) storage.setItem(HISTORY_KEY, JSON.stringify(active));
  return active.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function saveLocalHistory(
  storage: StorageLike,
  input: LocalHistoryInput,
  existingId?: string | null,
  now = Date.now(),
): LocalHistoryRecord {
  const records = listLocalHistory(storage, now);
  const existing = existingId ? records.find((record) => record.id === existingId) : undefined;
  const record: LocalHistoryRecord = {
    ...structuredClone(input),
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + HISTORY_TTL_MS).toISOString(),
  };
  storage.setItem(HISTORY_KEY, JSON.stringify([record, ...records.filter((item) => item.id !== record.id)]));
  return record;
}

export function getLocalHistory(storage: StorageLike, id: string, now = Date.now()): LocalHistoryRecord | null {
  return listLocalHistory(storage, now).find((record) => record.id === id) ?? null;
}

export function deleteLocalHistory(storage: StorageLike, id: string, now = Date.now()): void {
  storage.setItem(HISTORY_KEY, JSON.stringify(listLocalHistory(storage, now).filter((record) => record.id !== id)));
}


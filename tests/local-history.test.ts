import { describe, expect, it } from 'vitest';
import { deleteLocalHistory, getLocalHistory, HISTORY_TTL_MS, listLocalHistory, saveLocalHistory } from '../src/local-history.js';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const input = {
  restaurant: 'Test Cafe', grandTotalCents: 1250,
  reviewModel: { items: [], summary: {}, validation: {} } as never,
  ocrResult: { parsed: { restaurantName: { value: 'Test Cafe' } } } as never,
  people: [{ id: 'p1', name: 'Alex' }],
  assignments: [{ itemId: 'i1', personIds: ['p1'] }],
};

describe('72-hour local receipt history', () => {
  it('saves and reopens a complete split snapshot', () => {
    const storage = new MemoryStorage();
    const saved = saveLocalHistory(storage, input, null, 1_000);
    expect(getLocalHistory(storage, saved.id, 2_000)?.people[0]?.name).toBe('Alex');
  });

  it('updates an existing record without creating a duplicate', () => {
    const storage = new MemoryStorage();
    const first = saveLocalHistory(storage, input, null, 1_000);
    saveLocalHistory(storage, { ...input, restaurant: 'Updated Cafe' }, first.id, 2_000);
    expect(listLocalHistory(storage, 3_000)).toHaveLength(1);
    expect(listLocalHistory(storage, 3_000)[0]?.restaurant).toBe('Updated Cafe');
  });

  it('removes records after 72 hours and supports manual deletion', () => {
    const storage = new MemoryStorage();
    saveLocalHistory(storage, input, null, 1_000);
    expect(listLocalHistory(storage, 1_000 + HISTORY_TTL_MS + 1)).toHaveLength(0);
    const active = saveLocalHistory(storage, input, null, 9_000 + HISTORY_TTL_MS);
    deleteLocalHistory(storage, active.id, 9_001 + HISTORY_TTL_MS);
    expect(getLocalHistory(storage, active.id, 9_002 + HISTORY_TTL_MS)).toBeNull();
  });
});

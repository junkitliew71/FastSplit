import { describe, expect, it } from 'vitest';
import {
  authenticatedIdentity,
  clearGuestMode,
  enableGuestMode,
  restoreGuestMode,
} from '../src/auth-session.js';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('authentication session', () => {
  it('preserves and restores Guest Mode after reload', () => {
    const storage = new MemoryStorage();
    expect(enableGuestMode(storage)).toMatchObject({ mode: 'guest', uid: null });
    expect(restoreGuestMode(storage)).toMatchObject({ mode: 'guest', displayName: 'Guest' });
  });

  it('clears Guest Mode on logout', () => {
    const storage = new MemoryStorage();
    enableGuestMode(storage);
    clearGuestMode(storage);
    expect(restoreGuestMode(storage)).toBeNull();
  });

  it('uses the trusted UID provided by Firebase User', () => {
    const identity = authenticatedIdentity({
      uid: 'firebase-uid-123', displayName: 'Fast Splitter', email: 'user@example.com', photoURL: null,
    });
    expect(identity).toMatchObject({ mode: 'authenticated', uid: 'firebase-uid-123' });
  });

  it('rejects an authenticated identity without a Firebase UID', () => {
    expect(() => authenticatedIdentity({ uid: '', displayName: null, email: null, photoURL: null })).toThrow();
  });
});

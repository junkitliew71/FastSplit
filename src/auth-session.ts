export type AuthIdentity =
  | { mode: 'authenticated'; uid: string; displayName: string | null; email: string | null; photoURL: string | null }
  | { mode: 'guest'; uid: null; displayName: 'Guest'; email: null; photoURL: null };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const GUEST_KEY = 'fastsplit:guest-mode';

export function guestIdentity(): AuthIdentity {
  return { mode: 'guest', uid: null, displayName: 'Guest', email: null, photoURL: null };
}

export function enableGuestMode(storage: StorageLike): AuthIdentity {
  storage.setItem(GUEST_KEY, 'true');
  return guestIdentity();
}

export function restoreGuestMode(storage: StorageLike): AuthIdentity | null {
  return storage.getItem(GUEST_KEY) === 'true' ? guestIdentity() : null;
}

export function clearGuestMode(storage: StorageLike): void {
  storage.removeItem(GUEST_KEY);
}

export function authenticatedIdentity(user: {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}): AuthIdentity {
  if (!user.uid) throw new Error('Firebase returned a user without a UID.');
  return {
    mode: 'authenticated',
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  };
}

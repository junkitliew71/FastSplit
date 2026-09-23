import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
};

const requiredKeys: Array<keyof FirebaseOptions> = ['apiKey', 'authDomain', 'projectId', 'appId'];
export const firebaseConfigured = requiredKeys.every((key) => typeof firebaseConfig[key] === 'string' && firebaseConfig[key] !== '');

let authInstance: Auth | null = null;
let persistenceReady: Promise<void> | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfigured) return null;
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth | null {
  if (!firebaseConfigured) return null;
  if (authInstance) return authInstance;
  const app = getFirebaseApp();
  if (!app) return null;
  authInstance = getAuth(app);
  persistenceReady ??= setPersistence(authInstance, browserLocalPersistence);
  return authInstance;
}

export async function signInWithGoogle(): Promise<User> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error('Firebase is not configured yet.');
  await persistenceReady;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(auth, provider)).user;
}

export async function logoutFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  if (auth) await signOut(auth);
}

export function observeFirebaseUser(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}

export function friendlyAuthError(error: unknown): string {
  if (!(error instanceof Error)) return 'Could not sign in. Please try again.';
  if (error.message.includes('popup-closed-by-user')) return 'Google sign-in was cancelled.';
  if (error.message.includes('popup-blocked')) return 'Allow pop-ups for this site, then try again.';
  if (error.message.includes('unauthorized-domain')) return 'This domain is not authorized in Firebase Authentication.';
  if (error.message.includes('operation-not-allowed')) return 'Google sign-in is not enabled in Firebase Console.';
  return 'Could not sign in with Google. Please try again.';
}

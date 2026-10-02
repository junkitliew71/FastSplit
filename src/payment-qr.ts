export type PaymentQrRecord = {
  blob: Blob;
  name: string;
  updatedAt: number;
};

const DATABASE_NAME = 'fastsplit-settings';
const STORE_NAME = 'profile';
const PAYMENT_QR_KEY = 'payment-qr';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local QR storage.'));
  });
}

async function runTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not update local QR storage.'));
    });
  } finally {
    database.close();
  }
}

export function loadPaymentQr(): Promise<PaymentQrRecord | undefined> {
  return runTransaction('readonly', (store) => store.get(PAYMENT_QR_KEY));
}

export function savePaymentQr(file: File): Promise<IDBValidKey> {
  const record: PaymentQrRecord = { blob: file, name: file.name || 'fastsplit-payment-qr.png', updatedAt: Date.now() };
  return runTransaction('readwrite', (store) => store.put(record, PAYMENT_QR_KEY));
}

export function deletePaymentQr(): Promise<undefined> {
  return runTransaction('readwrite', (store) => store.delete(PAYMENT_QR_KEY));
}

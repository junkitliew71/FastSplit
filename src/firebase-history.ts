import { deleteDoc, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where, collection, Timestamp } from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { getFirebaseApp } from './firebase-auth.ts';
import type { NewReceiptHistoryRecord, ReceiptHistoryRecord } from './receipt-history-model.ts';

const COLLECTION = 'receipts';

function services() {
  const app = getFirebaseApp();
  if (!app) throw new Error('Firebase is not configured.');
  return { db: getFirestore(app), storage: getStorage(app) };
}

export async function saveReceiptHistory(
  uid: string,
  image: Blob | null,
  record: Omit<NewReceiptHistoryRecord, 'receiptImagePath' | 'receiptImageUrl'>,
  existingId: string | null,
  existingImage?: Pick<ReceiptHistoryRecord, 'receiptImagePath' | 'receiptImageUrl'>,
): Promise<string> {
  const { db, storage } = services();
  const receiptRef = existingId ? doc(db, COLLECTION, existingId) : doc(collection(db, COLLECTION));
  let receiptImagePath = existingImage?.receiptImagePath ?? '';
  let receiptImageUrl = existingImage?.receiptImageUrl ?? '';
  if (!existingId) {
    if (!image) throw new Error('The receipt image is required for a new history entry.');
    receiptImagePath = `receipts/${uid}/${receiptRef.id}/receipt.jpg`;
    const imageRef = ref(storage, receiptImagePath);
    await uploadBytes(imageRef, image, { contentType: 'image/jpeg' });
    receiptImageUrl = await getDownloadURL(imageRef);
  }
  const previous = existingId ? await getDoc(receiptRef) : null;
  await setDoc(receiptRef, {
    ...record,
    ownerUid: uid,
    receiptImagePath,
    receiptImageUrl,
    createdAt: previous?.data()?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return receiptRef.id;
}

export async function listReceiptHistory(uid: string): Promise<ReceiptHistoryRecord[]> {
  const { db } = services();
  const snapshot = await getDocs(query(collection(db, COLLECTION), where('ownerUid', '==', uid)));
  return snapshot.docs.map((item) => fromFirestore(item.id, item.data()))
    .sort((left, right) => (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0));
}

export async function getReceiptHistory(uid: string, id: string): Promise<ReceiptHistoryRecord> {
  const { db } = services();
  const snapshot = await getDoc(doc(db, COLLECTION, id));
  if (!snapshot.exists() || snapshot.data().ownerUid !== uid) throw new Error('Receipt not found.');
  return fromFirestore(snapshot.id, snapshot.data());
}

export async function deleteReceiptHistory(uid: string, record: ReceiptHistoryRecord): Promise<void> {
  if (record.ownerUid !== uid) throw new Error('You cannot delete another user’s receipt.');
  const { db, storage } = services();
  await deleteDoc(doc(db, COLLECTION, record.id));
  if (record.receiptImagePath) {
    try { await deleteObject(ref(storage, record.receiptImagePath)); } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('object-not-found')) throw error;
    }
  }
}

function fromFirestore(id: string, data: Record<string, unknown>): ReceiptHistoryRecord {
  const convertDate = (value: unknown) => value instanceof Timestamp ? value.toDate() : null;
  return { ...(data as Omit<ReceiptHistoryRecord, 'id' | 'createdAt' | 'updatedAt'>), id, createdAt: convertDate(data.createdAt), updatedAt: convertDate(data.updatedAt) };
}

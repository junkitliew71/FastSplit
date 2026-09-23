import type { ReviewModel } from './review-model.ts';
import type { ReceiptOcrResponse } from './types.ts';

export type SavedPerson = { id: string; name: string };
export type SavedAssignment = { itemId: string; personIds: string[] };
export type SavedSplitAmount = { personId: string; amountCents: number };

export type ReceiptHistoryRecord = {
  id: string;
  ownerUid: string;
  restaurant: string;
  receiptDate: string | null;
  items: ReviewModel['items'];
  charges: {
    serviceChargeCents: number | null;
    taxCents: number | null;
    discountCents: number | null;
    roundingCents: number | null;
  };
  subtotalCents: number | null;
  grandTotalCents: number | null;
  people: SavedPerson[];
  assignments: SavedAssignment[];
  splitAmounts: SavedSplitAmount[];
  ocrMappings: ReviewModel;
  ocrResult: ReceiptOcrResponse;
  receiptImagePath: string;
  receiptImageUrl: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type NewReceiptHistoryRecord = Omit<ReceiptHistoryRecord, 'id' | 'createdAt' | 'updatedAt'>;

export function createHistoryRecord(
  ownerUid: string,
  result: ReceiptOcrResponse,
  review: ReviewModel,
  receiptImagePath: string,
  receiptImageUrl: string,
): NewReceiptHistoryRecord {
  if (!ownerUid) throw new Error('A Firebase UID is required to save receipt history.');
  return {
    ownerUid,
    restaurant: result.parsed.restaurantName.value?.trim() || 'Unnamed receipt',
    receiptDate: null,
    items: structuredClone(review.items),
    charges: {
      serviceChargeCents: review.summary.serviceCharge.valueCents,
      taxCents: review.summary.tax.valueCents,
      discountCents: review.summary.discount.valueCents,
      roundingCents: review.summary.rounding.valueCents,
    },
    subtotalCents: review.summary.subtotal.valueCents,
    grandTotalCents: review.summary.grandTotal.valueCents,
    people: [],
    assignments: [],
    splitAmounts: [],
    ocrMappings: structuredClone(review),
    ocrResult: structuredClone(result),
    receiptImagePath,
    receiptImageUrl,
  };
}

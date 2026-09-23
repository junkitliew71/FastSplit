export type BoundingBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type OcrDetection = {
  id: string;
  text: string;
  confidence: number;
  bbox: BoundingBox;
  centerX: number;
  centerY: number;
};

export type ReceiptOcrResponse = {
  requestId: string;
  image: { width: number; height: number; format: string | null };
  quality: {
    brightness: number;
    contrast: number;
    lowContrast: boolean;
    underexposed: boolean;
    overexposed: boolean;
  };
  ocr: {
    passUsed: 1 | 2;
    secondPassReason: string | null;
    confidence: number;
    text: string;
    detections: OcrDetection[];
  };
  parsed: {
    restaurantName: { value: string | null; confidence: number; mapping: { ocrIds: string[] } };
    items: Array<{
      id: string;
      name: string;
      quantity: number | null;
      unitPriceCents: number | null;
      totalCents: number | null;
      confidence: number;
      needsReview: boolean;
      mappings: {
        name: { ocrIds: string[] };
        quantity: { ocrIds: string[] };
        unitPrice: { ocrIds: string[] };
        total: { ocrIds: string[] };
      };
    }>;
    charges: {
      serviceChargeCents: number;
      taxCents: number;
      discountCents: number;
      roundingCents: number;
      otherCents: number;
      mappings: Record<string, { ocrIds: string[] }>;
    };
    totals: {
      itemSumCents: number;
      subtotalCents: number | null;
      grandTotalCents: number | null;
      mappings: { subtotal: { ocrIds: string[] }; grandTotal: { ocrIds: string[] } };
    };
    validation: {
      itemArithmeticValid: boolean;
      subtotalChecked: boolean;
      subtotalValid: boolean | null;
      grandTotalChecked: boolean;
      grandTotalValid: boolean | null;
    };
    confidence: number;
    needsReview: boolean;
  };
  timingsMs: Record<string, number>;
  cacheHit: boolean;
  needsReview: boolean;
  message: string | null;
};

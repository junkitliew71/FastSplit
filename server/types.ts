export type BoundingBox = { x1: number; y1: number; x2: number; y2: number };

export type OcrDetection = {
  id: string;
  text: string;
  confidence: number;
  bbox: BoundingBox;
  centerX: number;
  centerY: number;
};

export type ImageQuality = {
  brightness: number;
  contrast: number;
  lowContrast: boolean;
  underexposed: boolean;
  overexposed: boolean;
};

export type OcrPass = {
  text: string;
  confidence: number;
  detections: OcrDetection[];
};

export type LayoutRow = {
  id: string;
  text: string;
  centerY: number;
  bbox: BoundingBox;
  confidence: number;
  detectionIds: string[];
  detections: OcrDetection[];
  medianHeight?: number;
  slope?: number;
  horizontalGaps?: number[];
  multilineCandidate?: boolean;
};

export type ReceiptRegionKind =
  | 'MERCHANT'
  | 'METADATA'
  | 'ITEM_HEADER'
  | 'ITEMS'
  | 'SUMMARY'
  | 'PAYMENT'
  | 'FOOTER'
  | 'UNKNOWN';

export type RowRegionAssignment = {
  rowId: string;
  kind: ReceiptRegionKind;
  confidence: number;
  evidence: string[];
};

export type ReceiptRegion = {
  id: string;
  kind: ReceiptRegionKind;
  confidence: number;
  rowIds: string[];
  startY: number;
  endY: number;
  evidence: string[];
};

export type ReceiptRegionDetection = {
  assignments: RowRegionAssignment[];
  regions: ReceiptRegion[];
  itemHeaderRowId: string | null;
  summaryBoundaryRowId: string | null;
};

export type ReceiptColumn = {
  kind: 'description' | 'quantity' | 'unitPrice' | 'total' | 'numeric';
  centerX: number;
  confidence: number;
};

export type FieldMapping = { ocrIds: string[] };

export type ParsedItem = {
  id: string;
  name: string;
  quantity: number | null;
  unitPriceCents: number | null;
  totalCents: number | null;
  confidence: number;
  needsReview: boolean;
  validation: { checked: boolean; valid: boolean | null; differenceCents: number | null };
  mappings: {
    name: FieldMapping;
    quantity: FieldMapping;
    unitPrice: FieldMapping;
    total: FieldMapping;
  };
};

export type ParsedReceipt = {
  restaurantName: { value: string | null; confidence: number; mapping: FieldMapping };
  items: ParsedItem[];
  charges: {
    serviceChargeCents: number;
    taxCents: number;
    discountCents: number;
    roundingCents: number;
    otherCents: number;
    mappings: Record<string, FieldMapping>;
  };
  totals: {
    itemSumCents: number;
    subtotalCents: number | null;
    grandTotalCents: number | null;
    mappings: { subtotal: FieldMapping; grandTotal: FieldMapping };
  };
  validation: {
    itemArithmeticValid: boolean;
    subtotalChecked: boolean;
    subtotalValid: boolean | null;
    subtotalDifferenceCents: number | null;
    grandTotalChecked: boolean;
    grandTotalValid: boolean | null;
    expectedGrandTotalCents: number | null;
    grandTotalDifferenceCents: number | null;
  };
  confidence: number;
  needsReview: boolean;
  layout: { rows: LayoutRow[]; columns: ReceiptColumn[] };
};

export type ReceiptOcrResponse = {
  requestId: string;
  image: { width: number; height: number; format: string | null };
  quality: ImageQuality;
  ocr: OcrPass & { passUsed: 1 | 2; secondPassReason: string | null };
  parsed: ParsedReceipt;
  timingsMs: Record<string, number>;
  cacheHit: boolean;
  needsReview: boolean;
  message: string | null;
};

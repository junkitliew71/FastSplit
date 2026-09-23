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

export type ReceiptOcrResponse = {
  requestId: string;
  image: { width: number; height: number; format: string | null };
  quality: ImageQuality;
  ocr: OcrPass & { passUsed: 1 | 2; secondPassReason: string | null };
  timingsMs: Record<string, number>;
  needsReview: boolean;
  message: string | null;
};

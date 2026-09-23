import type { BoundingBox, LayoutRow, OcrDetection, ReceiptColumn } from './types.js';

const HEADER_PATTERNS: Array<[ReceiptColumn['kind'], RegExp]> = [
  ['description', /^(?:item|description|particulars?)$/i],
  ['quantity', /^(?:qty|quantity)$/i],
  ['unitPrice', /^(?:unit|price|s\/?price|u\/?price|u\/p|unit price)$/i],
  ['total', /^(?:amount|total|amt)$/i],
];

export function reconstructLayout(detections: OcrDetection[]): { rows: LayoutRow[]; columns: ReceiptColumn[] } {
  const sorted = [...detections].sort((left, right) => left.centerY - right.centerY || left.centerX - right.centerX);
  const medianHeight = median(sorted.map((item) => item.bbox.y2 - item.bbox.y1)) || 0.018;
  const threshold = Math.max(0.007, Math.min(0.032, medianHeight * 0.68));
  const groups: OcrDetection[][] = [];

  for (const detection of sorted) {
    const best = groups
      .map((group, index) => ({ index, ...rowCompatibility(group, detection, threshold, medianHeight) }))
      .filter((candidate) => candidate.compatible)
      .sort((left, right) => right.score - left.score)[0];
    if (best) groups[best.index]?.push(detection);
    else groups.push([detection]);
  }

  const rows = groups.map((group, index) => makeRow(group, index + 1))
    .sort((left, right) => left.centerY - right.centerY);
  markMultilineCandidates(rows, medianHeight);
  return { rows, columns: detectColumns(rows) };
}

function rowCompatibility(group: OcrDetection[], detection: OcrDetection, threshold: number, typicalHeight: number): { compatible: boolean; score: number } {
  const groupTop = Math.min(...group.map((item) => item.bbox.y1));
  const groupBottom = Math.max(...group.map((item) => item.bbox.y2));
  const overlap = Math.max(0, Math.min(groupBottom, detection.bbox.y2) - Math.max(groupTop, detection.bbox.y1));
  const detectionHeight = Math.max(0.0001, detection.bbox.y2 - detection.bbox.y1);
  const overlapRatio = overlap / Math.min(detectionHeight, Math.max(0.0001, groupBottom - groupTop));
  const predictedY = predictCenterY(group, detection.centerX);
  const centerDistance = Math.abs(predictedY - detection.centerY);
  const rightEdge = Math.max(...group.map((item) => item.bbox.x2));
  const leftEdge = Math.min(...group.map((item) => item.bbox.x1));
  const horizontalGap = detection.bbox.x1 > rightEdge
    ? detection.bbox.x1 - rightEdge
    : leftEdge > detection.bbox.x2 ? leftEdge - detection.bbox.x2 : 0;
  const strongOverlap = overlapRatio >= 0.42;
  const centerAligned = centerDistance <= threshold;
  const weakAlignmentAcrossLargeGap = horizontalGap > 0.32
    && overlapRatio < 0.25
    && centerDistance > threshold * 0.85;
  const compatible = (strongOverlap || centerAligned) && !weakAlignmentAcrossLargeGap
    && centerDistance <= Math.max(threshold * 1.35, typicalHeight * 0.9);
  const score = overlapRatio * 0.62 + Math.max(0, 1 - centerDistance / Math.max(threshold, 0.001)) * 0.38;
  return { compatible, score };
}

function predictCenterY(group: OcrDetection[], x: number): number {
  if (group.length < 2) return mean(group.map((item) => item.centerY));
  const meanX = mean(group.map((item) => item.centerX));
  const meanY = mean(group.map((item) => item.centerY));
  const denominator = group.reduce((sum, item) => sum + (item.centerX - meanX) ** 2, 0);
  if (denominator < 0.00001) return meanY;
  const slope = group.reduce((sum, item) => sum + (item.centerX - meanX) * (item.centerY - meanY), 0) / denominator;
  const limitedSlope = Math.max(-0.08, Math.min(0.08, slope));
  return meanY + limitedSlope * (x - meanX);
}

function makeRow(detections: OcrDetection[], number: number): LayoutRow {
  const ordered = [...detections].sort((left, right) => left.bbox.x1 - right.bbox.x1);
  const bbox: BoundingBox = {
    x1: Math.min(...ordered.map((item) => item.bbox.x1)),
    y1: Math.min(...ordered.map((item) => item.bbox.y1)),
    x2: Math.max(...ordered.map((item) => item.bbox.x2)),
    y2: Math.max(...ordered.map((item) => item.bbox.y2)),
  };
  const gaps = ordered.slice(1).map((item, index) => Math.max(0, item.bbox.x1 - (ordered[index]?.bbox.x2 ?? item.bbox.x1)));
  return {
    id: `row_${number}`,
    text: ordered.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
    centerY: mean(ordered.map((item) => item.centerY)),
    bbox,
    confidence: mean(ordered.map((item) => item.confidence)),
    detectionIds: ordered.map((item) => item.id),
    detections: ordered,
    medianHeight: median(ordered.map((item) => item.bbox.y2 - item.bbox.y1)),
    slope: estimateSlope(ordered),
    horizontalGaps: gaps,
    multilineCandidate: false,
  };
}

function estimateSlope(detections: OcrDetection[]): number {
  if (detections.length < 2) return 0;
  const first = detections[0];
  const last = detections[detections.length - 1];
  if (!first || !last || Math.abs(last.centerX - first.centerX) < 0.001) return 0;
  return Math.round(((last.centerY - first.centerY) / (last.centerX - first.centerX)) * 10_000) / 10_000;
}

function markMultilineCandidates(rows: LayoutRow[], typicalHeight: number): void {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const next = rows[index + 1];
    if (!row || !next) continue;
    const verticalGap = next.bbox.y1 - row.bbox.y2;
    const leftAligned = Math.abs(row.bbox.x1 - next.bbox.x1) < 0.08;
    const eitherShort = row.detections.length <= 3 || next.detections.length <= 3;
    if (verticalGap >= -typicalHeight * 0.15 && verticalGap <= typicalHeight * 1.35 && leftAligned && eitherShort) {
      row.multilineCandidate = true;
      next.multilineCandidate = true;
    }
  }
}

function detectColumns(rows: LayoutRow[]): ReceiptColumn[] {
  const headerColumns: ReceiptColumn[] = [];
  for (const row of rows) {
    for (const detection of row.detections) {
      const matched = HEADER_PATTERNS.find(([, pattern]) => pattern.test(detection.text));
      if (matched) headerColumns.push({ kind: matched[0], centerX: detection.centerX, confidence: detection.confidence });
    }
    if (headerColumns.length >= 2) return deduplicateColumns(headerColumns);
  }

  const numericPositions = rows.flatMap((row) => row.detections)
    .filter((item) => /^(?:RM|MYR)?\s*\d+(?:[.,]\d{2})?$/i.test(item.text.trim()))
    .map((item) => item.centerX)
    .sort((left, right) => left - right);
  const clusters: number[][] = [];
  for (const position of numericPositions) {
    const cluster = clusters.find((candidate) => Math.abs(mean(candidate) - position) < 0.065);
    if (cluster) cluster.push(position); else clusters.push([position]);
  }
  const centers = clusters.filter((cluster) => cluster.length >= 2).map(mean).sort((left, right) => left - right);
  return centers.map((centerX, index) => ({
    kind: index === centers.length - 1 ? 'total' : index === centers.length - 2 ? 'unitPrice' : 'numeric',
    centerX,
    confidence: Math.min(0.9, 0.55 + (clusters[index]?.length ?? 1) * 0.05),
  }));
}

function deduplicateColumns(columns: ReceiptColumn[]): ReceiptColumn[] {
  const result = new Map<ReceiptColumn['kind'], ReceiptColumn>();
  for (const column of columns) if (!result.has(column.kind)) result.set(column.kind, column);
  return [...result.values()].sort((left, right) => left.centerX - right.centerX);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

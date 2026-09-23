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
  const threshold = Math.max(0.008, Math.min(0.035, medianHeight * 0.62));
  const groups: OcrDetection[][] = [];

  for (const detection of sorted) {
    const best = groups
      .map((group, index) => ({ index, distance: Math.abs(mean(group.map((item) => item.centerY)) - detection.centerY) }))
      .filter((candidate) => candidate.distance <= threshold)
      .sort((left, right) => left.distance - right.distance)[0];
    if (best) groups[best.index]?.push(detection);
    else groups.push([detection]);
  }

  const rows = groups.map((group, index) => makeRow(group, index + 1))
    .sort((left, right) => left.centerY - right.centerY);
  return { rows, columns: detectColumns(rows) };
}

function makeRow(detections: OcrDetection[], number: number): LayoutRow {
  const ordered = [...detections].sort((left, right) => left.bbox.x1 - right.bbox.x1);
  const bbox: BoundingBox = {
    x1: Math.min(...ordered.map((item) => item.bbox.x1)),
    y1: Math.min(...ordered.map((item) => item.bbox.y1)),
    x2: Math.max(...ordered.map((item) => item.bbox.x2)),
    y2: Math.max(...ordered.map((item) => item.bbox.y2)),
  };
  return {
    id: `row_${number}`,
    text: ordered.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
    centerY: mean(ordered.map((item) => item.centerY)),
    bbox,
    confidence: mean(ordered.map((item) => item.confidence)),
    detectionIds: ordered.map((item) => item.id),
    detections: ordered,
  };
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

import { parseMoneyCents } from './money.js';
import type { LayoutRow, ReceiptRegion, ReceiptRegionDetection, ReceiptRegionKind, RowRegionAssignment } from './types.js';

const ITEM_HEADER_TOKEN = /\b(?:qty|quantity|item|description|desc|particulars?|s\/?price|u\/?price|unit\s*price|price|amount|amt|total)\b/gi;
const SUMMARY_MARKER = /\b(?:sub[\s-]*total|service\s*(?:charge|chg)|serv\s*chg|svc\s*chg|sst|gst|sales\s*tax|service\s*tax|discount|round(?:ing|\s*adj(?:ustment)?)|grand\s*total|nett?\s*total|amount\s*due|total\s*due|total\s*amount)\b/i;
const STRONG_SUMMARY_MARKER = /\b(?:sub[\s-]*total|service\s*(?:charge|chg)|sst|gst|grand\s*total|nett?\s*total|amount\s*due|total\s*due|total\s*amount)\b/i;
const PAYMENT_MARKER = /\b(?:payment|cash|card|visa|mastercard|tendered|received|change|credit|debit)\b/i;
const METADATA_MARKER = /\b(?:table(?:\s*no)?|cashier|date|time|invoice|inv\s*no|bill\s*no|terminal|transaction|trans\s*type|pax|receipt\s*no|order\s*no)\b/i;
const FOOTER_MARKER = /\b(?:thank\s*you|come\s*again|goods\s*sold|not\s*returnable|no\s*refund|please\s*visit)\b/i;
const GENERIC_DOCUMENT = /\b(?:tax\s*invoice|invoice|receipt)\b/i;

type RowSignals = {
  headerStrength: number;
  summaryLike: boolean;
  strongSummary: boolean;
  payment: boolean;
  metadata: boolean;
  footer: boolean;
  itemLike: boolean;
  hasDescription: boolean;
  rightAmountX: number | null;
};

export function detectReceiptRegions(layout: { rows: LayoutRow[] }): ReceiptRegionDetection {
  const { rows } = layout;
  const signals = rows.map(rowSignals);
  const itemHeaderIndex = strongestItemHeader(signals);
  const summaryIndex = findSummaryBoundary(rows, signals, itemHeaderIndex);
  const inferredItems = itemHeaderIndex < 0 ? inferItemRun(rows, signals, summaryIndex) : null;
  const assignments = rows.map((row, index) => assignRow(rows, signals, index, itemHeaderIndex, summaryIndex, inferredItems));
  return {
    assignments,
    regions: groupRegions(rows, assignments),
    itemHeaderRowId: itemHeaderIndex >= 0 ? rows[itemHeaderIndex]?.id ?? null : null,
    summaryBoundaryRowId: summaryIndex >= 0 ? rows[summaryIndex]?.id ?? null : null,
  };
}

function rowSignals(row: LayoutRow): RowSignals {
  const text = row.text.replace(/[_|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const headerMatches = text.match(ITEM_HEADER_TOKEN) ?? [];
  const amounts = row.detections
    .filter((item) => parseMoneyCents(item.text) !== null)
    .sort((left, right) => left.centerX - right.centerX);
  const rightAmount = amounts[amounts.length - 1];
  const hasDescription = row.detections.some((item) => item.centerX < 0.68 && /[A-Za-z\u3400-\u9fff]{2}/.test(item.text));
  return {
    headerStrength: new Set(headerMatches.map((item) => item.toLowerCase())).size,
    summaryLike: SUMMARY_MARKER.test(text),
    strongSummary: STRONG_SUMMARY_MARKER.test(text) && (amounts.length > 0 || row.confidence >= 0.82),
    payment: PAYMENT_MARKER.test(text),
    metadata: METADATA_MARKER.test(text),
    footer: FOOTER_MARKER.test(text),
    itemLike: hasDescription && amounts.length > 0 && (rightAmount?.centerX ?? 0) > 0.55,
    hasDescription,
    rightAmountX: rightAmount?.centerX ?? null,
  };
}

function strongestItemHeader(signals: RowSignals[]): number {
  let best = -1;
  let strength = 1;
  for (let index = 0; index < signals.length; index += 1) {
    const current = signals[index];
    if (current && current.headerStrength >= 2 && current.headerStrength > strength) {
      best = index;
      strength = current.headerStrength;
    }
  }
  return best;
}

function findSummaryBoundary(rows: LayoutRow[], signals: RowSignals[], headerIndex: number): number {
  const start = Math.max(0, headerIndex + 1);
  for (let index = start; index < rows.length; index += 1) {
    const current = signals[index];
    const next = signals[index + 1];
    if (current?.strongSummary) return index;
    if (current?.summaryLike && next?.summaryLike) return index;
  }
  return -1;
}

function inferItemRun(rows: LayoutRow[], signals: RowSignals[], summaryIndex: number): { start: number; end: number } | null {
  const limit = summaryIndex >= 0 ? summaryIndex : rows.length;
  for (let start = 0; start < limit - 1; start += 1) {
    if (!signals[start]?.itemLike) continue;
    const firstX = signals[start]?.rightAmountX;
    let end = start;
    let aligned = 1;
    for (let index = start + 1; index < limit; index += 1) {
      const signal = signals[index];
      if (!signal?.itemLike || firstX == null || signal.rightAmountX === null || Math.abs(signal.rightAmountX - firstX) > 0.075) break;
      aligned += 1;
      end = index;
    }
    if (aligned >= 2) return { start, end };
  }
  return null;
}

function assignRow(
  rows: LayoutRow[], signals: RowSignals[], index: number, headerIndex: number, summaryIndex: number,
  inferredItems: { start: number; end: number } | null,
): RowRegionAssignment {
  const row = rows[index];
  const signal = signals[index];
  if (!row || !signal) return { rowId: row?.id ?? `row_${index + 1}`, kind: 'UNKNOWN', confidence: 0, evidence: [] };
  if (index === headerIndex) return assignment(row, 'ITEM_HEADER', 0.96, ['multiple item-header markers']);
  if (signal.footer) return assignment(row, 'FOOTER', 0.94, ['footer marker']);
  if (summaryIndex >= 0 && index >= summaryIndex) {
    if (signal.payment) return assignment(row, 'PAYMENT', 0.94, ['payment marker after summary']);
    if (signal.summaryLike) return assignment(row, 'SUMMARY', signal.strongSummary ? 0.96 : 0.84, ['summary marker', 'at/after summary boundary']);
    return assignment(row, 'UNKNOWN', 0.35, ['after summary boundary without summary/payment/footer evidence']);
  }
  const inHeaderItems = headerIndex >= 0 && index > headerIndex && (summaryIndex < 0 || index < summaryIndex);
  if (inHeaderItems && (signal.itemLike || neighborSupportsItem(signals, index))) {
    return assignment(row, 'ITEMS', signal.itemLike ? 0.9 : 0.7, ['below item header', signal.itemLike ? 'description-left/amount-right' : 'neighboring item structure']);
  }
  if (inferredItems && index >= inferredItems.start && index <= inferredItems.end) {
    return assignment(row, 'ITEMS', 0.78, ['repeated neighboring item structure', 'aligned right amount column']);
  }
  if (signal.metadata) return assignment(row, 'METADATA', 0.92, ['metadata marker']);
  const structuralBoundary = headerIndex >= 0 ? headerIndex : inferredItems?.start ?? summaryIndex;
  if (structuralBoundary !== null && structuralBoundary !== undefined && structuralBoundary >= 0 && index < structuralBoundary && likelyMerchant(rows, signals, index)) {
    return assignment(row, 'MERCHANT', 0.74, ['before transaction/item structure', 'merchant-like text']);
  }
  return assignment(row, 'UNKNOWN', 0.3, ['insufficient region evidence']);
}

function neighborSupportsItem(signals: RowSignals[], index: number): boolean {
  const previous = signals[index - 1];
  const next = signals[index + 1];
  const current = signals[index];
  const wrappedDescription = current?.hasDescription && !current.itemLike
    && next?.rightAmountX !== null && (next?.rightAmountX ?? 0) > 0.55 && !next?.hasDescription;
  const wrappedAmount = !current?.hasDescription && (current?.rightAmountX ?? 0) > 0.55
    && previous?.hasDescription && !previous.itemLike;
  return Boolean((previous?.itemLike || next?.itemLike || wrappedDescription || wrappedAmount)
    && !current?.metadata && !current?.summaryLike);
}

function likelyMerchant(rows: LayoutRow[], signals: RowSignals[], index: number): boolean {
  const row = rows[index];
  if (!row || signals[index]?.metadata || GENERIC_DOCUMENT.test(row.text)) return false;
  const hasLetters = /[A-Za-z\u3400-\u9fff]{3}/.test(row.text);
  const domain = /\b[\w-]+\.(?:com|my|net|org)\b/i.test(row.text);
  const prominent = row.detections.length <= 8 && row.confidence >= 0.65 && !row.detections.some((item) => parseMoneyCents(item.text) !== null);
  return hasLetters && (domain || prominent);
}

function assignment(row: LayoutRow, kind: ReceiptRegionKind, confidence: number, evidence: string[]): RowRegionAssignment {
  return { rowId: row.id, kind, confidence, evidence };
}

function groupRegions(rows: LayoutRow[], assignments: RowRegionAssignment[]): ReceiptRegion[] {
  const result: ReceiptRegion[] = [];
  for (const current of assignments) {
    const row = rows.find((candidate) => candidate.id === current.rowId);
    if (!row) continue;
    const previous = result[result.length - 1];
    if (previous?.kind === current.kind) {
      previous.rowIds.push(row.id);
      previous.endY = row.bbox.y2;
      previous.confidence = Math.round(((previous.confidence * (previous.rowIds.length - 1) + current.confidence) / previous.rowIds.length) * 10_000) / 10_000;
      previous.evidence = [...new Set([...previous.evidence, ...current.evidence])];
    } else {
      result.push({ id: `region_${result.length + 1}`, kind: current.kind, confidence: current.confidence, rowIds: [row.id], startY: row.bbox.y1, endY: row.bbox.y2, evidence: [...current.evidence] });
    }
  }
  return result;
}

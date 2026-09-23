import { approximatelyEqual, parseMoneyCents, parseQuantity } from './money.js';
import { reconstructLayout } from './layout.js';
import type {
  FieldMapping,
  LayoutRow,
  OcrDetection,
  ParsedItem,
  ParsedReceipt,
  ReceiptColumn,
} from './types.js';

const SUMMARY_PATTERNS = {
  subtotal: /\b(?:sub\s*total|total\s*(?:sales\s*)?\(?excluding\s*(?:sst|gst)?)\b/i,
  service: /\b(?:(?:service|serv|sarv|svc)[.:\s-]*(?:chg|cha|charge|fee)|cha\s*10%)/i,
  tax: /\b(?:sst|gst(?:\s*payable)?|service\s*tax|tax)\b/i,
  discount: /\b(?:discount|voucher|rebate|promo)\b/i,
  rounding: /\b(?:rounding|round\s*(?:adj|adjustment)?)\b/i,
  grandTotal: /\b(?:grand\s*total|amount\s*due|total\s*due|net\s*total|total\s*\(?inclusive\s*(?:of\s*)?(?:sst|gst))\b|^\s*total\b/i,
};

const NON_ITEM_PATTERN = /\b(?:receipt|invoice|cashier|table|date|time|tel|phone|address|cash|change|payment|thank|welcome|tax invoice)\b/i;
const HEADER_PATTERN = /^(?:item|description|particulars?|qty|quantity|unit price|price|amount|total|amt)(?:\s+(?:qty|quantity|unit price|price|amount|total|amt))*$/i;
const DATE_TIME_PATTERN = /(?:\b\d{1,2}[/:.-]\d{1,2}[/:.-]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b)/;

type NumericToken = {
  detection: OcrDetection;
  cents: number;
  quantity: number | null;
};

export function parseReceipt(detections: OcrDetection[]): ParsedReceipt {
  const layout = reconstructLayout(detections);
  const summaryStart = layout.rows.findIndex(isSummaryRow);
  const itemBoundary = summaryStart >= 0 ? summaryStart : layout.rows.length;
  const rowsBeforeSummary = layout.rows.slice(0, itemBoundary);
  const headerIndex = rowsBeforeSummary.findIndex(isHeaderRow);
  const itemRows = associateWrappedItemRows(headerIndex >= 0 ? rowsBeforeSummary.slice(headerIndex + 1) : rowsBeforeSummary);
  const items = itemRows.map((row, index) => parseItemRow(row, layout.columns, index + 1))
    .filter((item): item is ParsedItem => item !== null);
  const summaryRows = layout.rows.filter(isSummaryRow);
  const charges = parseCharges(summaryRows);
  const subtotal = findSummaryAmount(summaryRows, SUMMARY_PATTERNS.subtotal);
  const grandTotal = findGrandTotal(summaryRows);
  const itemSumCents = items.reduce((sum, item) => sum + (item.totalCents ?? 0), 0);
  const itemArithmeticValid = items.every((item) => item.validation.valid !== false);
  const subtotalChecked = subtotal !== null && items.length > 0 && items.every((item) => item.totalCents !== null);
  const subtotalDifferenceCents = subtotalChecked ? itemSumCents - subtotal.value : null;
  const subtotalValid = subtotalChecked ? approximatelyEqual(itemSumCents, subtotal.value) : null;
  const base = subtotal?.value ?? (items.length > 0 ? itemSumCents : null);
  const expectedGrandTotalCents = base === null ? null
    : base + charges.serviceChargeCents + charges.taxCents + charges.otherCents - charges.discountCents + charges.roundingCents;
  const grandTotalChecked = grandTotal !== null && expectedGrandTotalCents !== null;
  const grandTotalDifferenceCents = grandTotalChecked ? expectedGrandTotalCents - grandTotal.value : null;
  const grandTotalValid = grandTotalChecked ? approximatelyEqual(expectedGrandTotalCents, grandTotal.value) : null;
  const restaurantName = findRestaurantName(layout.rows, itemBoundary);
  const confidence = receiptConfidence(items, subtotalValid, grandTotalValid, restaurantName.confidence);
  const needsReview = items.length === 0
    || items.some((item) => item.needsReview)
    || subtotalValid === false
    || grandTotalValid === false
    || grandTotal === null
    || !itemArithmeticValid;

  return {
    restaurantName,
    items,
    charges,
    totals: {
      itemSumCents,
      subtotalCents: subtotal?.value ?? null,
      grandTotalCents: grandTotal?.value ?? null,
      mappings: {
        subtotal: mapping(subtotal?.detections ?? []),
        grandTotal: mapping(grandTotal?.detections ?? []),
      },
    },
    validation: {
      itemArithmeticValid,
      subtotalChecked,
      subtotalValid,
      subtotalDifferenceCents,
      grandTotalChecked,
      grandTotalValid,
      expectedGrandTotalCents,
      grandTotalDifferenceCents,
    },
    confidence,
    needsReview,
    layout,
  };
}

function associateWrappedItemRows(rows: LayoutRow[]): LayoutRow[] {
  const associated: LayoutRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const next = rows[index + 1];
    if (!row) continue;
    const rowHasAmount = row.detections.some((item) => parseMoneyCents(item.text) !== null);
    const nextHasAmount = next?.detections.some((item) => parseMoneyCents(item.text) !== null) ?? false;
    const canWrap = !rowHasAmount
      && nextHasAmount
      && !isNonItemRow(row)
      && !isHeaderRow(row)
      && next !== undefined
      && next.centerY - row.centerY < 0.065;
    const canAppendFollowingName = rowHasAmount
      && !nextHasAmount
      && next !== undefined
      && !isNonItemRow(next)
      && !isHeaderRow(next)
      && /[A-Za-z\u3400-\u9fff]{2}/.test(next.text)
      && next.bbox.x1 < 0.58
      && next.centerY - row.centerY < 0.055;
    if ((!canWrap && !canAppendFollowingName) || !next) {
      associated.push(row);
      continue;
    }
    const detections = [
      ...[...(canWrap ? row : next).detections].sort((left, right) => left.centerX - right.centerX),
      ...[...(canWrap ? next : row).detections].sort((left, right) => left.centerX - right.centerX),
    ];
    associated.push({
      id: `${row.id}_${next.id}`,
      text: `${row.text} ${next.text}`,
      centerY: (row.centerY + next.centerY) / 2,
      bbox: {
        x1: Math.min(row.bbox.x1, next.bbox.x1), y1: Math.min(row.bbox.y1, next.bbox.y1),
        x2: Math.max(row.bbox.x2, next.bbox.x2), y2: Math.max(row.bbox.y2, next.bbox.y2),
      },
      confidence: mean([row.confidence, next.confidence]),
      detectionIds: detections.map((item) => item.id),
      detections,
    });
    index += 1;
  }
  return associated;
}

function parseItemRow(row: LayoutRow, columns: ReceiptColumn[], number: number): ParsedItem | null {
  if (isNonItemRow(row) || isHeaderRow(row)) return null;
  const numeric = row.detections.map(toNumericToken).filter((token): token is NumericToken => token !== null);
  if (numeric.length === 0) return null;

  const rightmostTotal = chooseByColumn(numeric, columns, 'total') ?? numeric[numeric.length - 1] ?? null;
  if (!rightmostTotal) return null;
  const remaining = numeric.filter((token) => token !== rightmostTotal);
  const arithmetic = findArithmeticPair(remaining, rightmostTotal.cents);
  const explicitQuantity = arithmetic?.quantity ?? findExplicitQuantity(row, remaining, columns);
  const remainingAfterQuantity = explicitQuantity
    ? remaining.filter((token) => token !== explicitQuantity)
    : remaining;
  const unitPrice = arithmetic?.unitPrice ?? chooseByColumn(remainingAfterQuantity, columns, 'unitPrice')
    ?? remainingAfterQuantity[remainingAfterQuantity.length - 1]
    ?? null;
  const quantity = explicitQuantity?.quantity ?? inferQuantity(remaining, unitPrice);
  const quantityDetection = explicitQuantity?.detection
    ?? (quantity !== null ? remaining.find((token) => token.quantity === quantity && token !== unitPrice)?.detection : undefined);

  const nameDetections = row.detections.filter((detection) => {
    if (numeric.some((token) => token.detection.id === detection.id)) return false;
    return !/^[x×]$/i.test(detection.text.trim());
  }).filter((detection) => !(detection.centerX > 0.84 && /^(?:SR|ZRL|SST|GST|TAX)$/i.test(detection.text.trim())));
  const name = nameDetections.map((item) => item.text).join(' ').trim();
  if (!name || NON_ITEM_PATTERN.test(name)) return null;

  const totalCents = rightmostTotal.cents;
  const unitPriceCents = unitPrice?.cents ?? null;
  const arithmeticChecked = quantity !== null && unitPriceCents !== null;
  const differenceCents = arithmeticChecked ? quantity * unitPriceCents - totalCents : null;
  const arithmeticValid = arithmeticChecked ? approximatelyEqual(quantity * unitPriceCents, totalCents) : null;
  const sourceConfidence = mean([
    ...nameDetections.map((item) => item.confidence),
    rightmostTotal.detection.confidence,
    ...(unitPrice ? [unitPrice.detection.confidence] : []),
    ...(quantityDetection ? [quantityDetection.confidence] : []),
  ]);
  const confidence = clamp(sourceConfidence * (arithmeticValid === false ? 0.55 : arithmeticChecked ? 1 : 0.82));
  const needsReview = arithmeticValid === false || confidence < 0.75 || totalCents < 0;

  return {
    id: `item_${number}`,
    name,
    quantity,
    unitPriceCents,
    totalCents,
    confidence,
    needsReview,
    validation: { checked: arithmeticChecked, valid: arithmeticValid, differenceCents },
    mappings: {
      name: mapping(nameDetections),
      quantity: mapping(quantityDetection ? [quantityDetection] : []),
      unitPrice: mapping(unitPrice ? [unitPrice.detection] : []),
      total: mapping([rightmostTotal.detection]),
    },
  };
}

function findExplicitQuantity(row: LayoutRow, tokens: NumericToken[], columns: ReceiptColumn[]): NumericToken | null {
  const quantityColumn = columns.find((column) => column.kind === 'quantity');
  const marked = tokens.find((token) => {
    const index = row.detections.findIndex((item) => item.id === token.detection.id);
    return token.quantity !== null && /^[x×]$/i.test(row.detections[index + 1]?.text.trim() ?? '');
  });
  if (marked) return marked;
  if (quantityColumn) {
    const candidate = [...tokens]
      .filter((token) => token.quantity !== null && !/[.,]/.test(token.detection.text))
      .sort((left, right) => Math.abs(left.detection.centerX - quantityColumn.centerX) - Math.abs(right.detection.centerX - quantityColumn.centerX))[0];
    if (candidate && Math.abs(candidate.detection.centerX - quantityColumn.centerX) < 0.12) return candidate;
  }
  return tokens.find((token) => token.quantity !== null && !/[.,]/.test(token.detection.text)) ?? null;
}

function inferQuantity(tokens: NumericToken[], unitPrice: NumericToken | null): number | null {
  const candidate = tokens.find((token) => token !== unitPrice && token.quantity !== null && !/[.,]/.test(token.detection.text));
  return candidate?.quantity ?? (unitPrice ? 1 : null);
}

function findArithmeticPair(tokens: NumericToken[], totalCents: number): { quantity: NumericToken; unitPrice: NumericToken } | null {
  const candidates: Array<{ quantity: NumericToken; unitPrice: NumericToken; difference: number; distance: number }> = [];
  for (const quantity of tokens) {
    if (quantity.quantity === null) continue;
    for (const unitPrice of tokens) {
      if (unitPrice === quantity || unitPrice.cents <= 0) continue;
      const difference = Math.abs(quantity.quantity * unitPrice.cents - totalCents);
      if (difference > 1) continue;
      candidates.push({
        quantity,
        unitPrice,
        difference,
        distance: Math.abs(unitPrice.detection.centerX - quantity.detection.centerX),
      });
    }
  }
  const best = candidates.sort((left, right) => left.difference - right.difference || right.distance - left.distance)[0];
  return best ? { quantity: best.quantity, unitPrice: best.unitPrice } : null;
}

function chooseByColumn(tokens: NumericToken[], columns: ReceiptColumn[], kind: ReceiptColumn['kind']): NumericToken | null {
  const column = columns.find((candidate) => candidate.kind === kind);
  if (!column || tokens.length === 0) return null;
  const candidate = [...tokens].sort((left, right) =>
    Math.abs(left.detection.centerX - column.centerX) - Math.abs(right.detection.centerX - column.centerX))[0];
  return candidate && Math.abs(candidate.detection.centerX - column.centerX) < 0.13 ? candidate : null;
}

function parseCharges(rows: LayoutRow[]): ParsedReceipt['charges'] {
  const service = findSummaryAmount(rows, SUMMARY_PATTERNS.service);
  const tax = findSummaryAmount(rows, SUMMARY_PATTERNS.tax);
  const discount = findSummaryAmount(rows, SUMMARY_PATTERNS.discount);
  const rounding = findSummaryAmount(rows, SUMMARY_PATTERNS.rounding, true);
  return {
    serviceChargeCents: Math.abs(service?.value ?? 0),
    taxCents: Math.abs(tax?.value ?? 0),
    discountCents: Math.abs(discount?.value ?? 0),
    roundingCents: rounding?.value ?? 0,
    otherCents: 0,
    mappings: {
      serviceCharge: mapping(service?.detections ?? []),
      tax: mapping(tax?.detections ?? []),
      discount: mapping(discount?.detections ?? []),
      rounding: mapping(rounding?.detections ?? []),
    },
  };
}

function findGrandTotal(rows: LayoutRow[]): { value: number; detections: OcrDetection[] } | null {
  const candidates = rows.filter((row) => SUMMARY_PATTERNS.grandTotal.test(row.text)
    && !SUMMARY_PATTERNS.subtotal.test(row.text)
    && !SUMMARY_PATTERNS.service.test(row.text));
  const row = candidates[candidates.length - 1];
  return row ? amountFromRow(row, false) : null;
}

function findSummaryAmount(rows: LayoutRow[], pattern: RegExp, preserveSign = false): { value: number; detections: OcrDetection[] } | null {
  const row = rows.find((candidate) => pattern.test(candidate.text));
  return row ? amountFromRow(row, preserveSign) : null;
}

function amountFromRow(row: LayoutRow, preserveSign: boolean): { value: number; detections: OcrDetection[] } | null {
  type AmountCandidate = { detection: OcrDetection; cents: number; detections?: OcrDetection[] };
  const ordered = [...row.detections].sort((left, right) => left.centerX - right.centerX);
  const values: AmountCandidate[] = ordered.flatMap((detection) => {
    const cents = parseMoneyCents(detection.text);
    return cents === null ? [] : [{ detection, cents }];
  });
  const fragments: AmountCandidate[] = ordered.flatMap((detection, index) => {
    const next = ordered[index + 1];
    if (!next || !/^(?:RM|MYR)?\d+$/i.test(detection.text.trim()) || !/^[.,]\d{2}$/.test(next.text.trim())) return [];
    const cents = parseMoneyCents(`${detection.text.trim()}${next.text.trim()}`);
    return cents === null ? [] : [{ detection: next, cents, detections: [detection, next] }];
  });
  const selected = fragments[fragments.length - 1] ?? values[values.length - 1];
  if (!selected) return null;
  const textSuggestsNegative = /[-−]/.test(row.text);
  const value = preserveSign
    ? (textSuggestsNegative ? -Math.abs(selected.cents) : selected.cents)
    : Math.abs(selected.cents);
  return { value, detections: selected.detections ?? [selected.detection] };
}

function findRestaurantName(rows: LayoutRow[], itemBoundary: number): ParsedReceipt['restaurantName'] {
  const candidate = rows.slice(0, Math.min(itemBoundary, 6)).find((row) =>
    /[A-Za-z\u3400-\u9fff]{3}/.test(row.text)
    && !NON_ITEM_PATTERN.test(row.text)
    && !DATE_TIME_PATTERN.test(row.text)
    && !isHeaderRow(row)
    && row.detections.every((item) => parseMoneyCents(item.text) === null));
  return candidate
    ? { value: candidate.text, confidence: candidate.confidence, mapping: mapping(candidate.detections) }
    : { value: null, confidence: 0, mapping: { ocrIds: [] } };
}

function isSummaryRow(row: LayoutRow): boolean {
  if (isHeaderRow(row) || /\btax\s+invoice\b/i.test(row.text)) return false;
  const hasAmount = row.detections.some((detection) => parseMoneyCents(detection.text) !== null);
  return hasAmount && Object.values(SUMMARY_PATTERNS).some((pattern) => pattern.test(row.text));
}

function isNonItemRow(row: LayoutRow): boolean {
  return NON_ITEM_PATTERN.test(row.text) || DATE_TIME_PATTERN.test(row.text) || isSummaryRow(row);
}

function isHeaderRow(row: LayoutRow): boolean {
  if (HEADER_PATTERN.test(row.text)) return true;
  const matches = row.text.match(/\b(?:item|description|particulars?|qty|quantity|s\/?price|u\/?price|unit|price|amount|total|amt|tax)\b/gi);
  return (matches?.length ?? 0) >= 2;
}

function toNumericToken(detection: OcrDetection): NumericToken | null {
  const cents = parseMoneyCents(detection.text);
  const quantity = parseQuantity(detection.text);
  if (cents === null && quantity === null) return null;
  return { detection, cents: cents ?? (quantity ?? 0) * 100, quantity };
}

function mapping(detections: OcrDetection[]): FieldMapping {
  return { ocrIds: detections.map((item) => item.id) };
}

function receiptConfidence(items: ParsedItem[], subtotalValid: boolean | null, grandTotalValid: boolean | null, restaurantConfidence: number): number {
  const itemConfidence = items.length ? mean(items.map((item) => item.confidence)) : 0;
  const validationConfidence = [subtotalValid, grandTotalValid]
    .filter((value): value is boolean => value !== null)
    .reduce((sum, valid) => sum + (valid ? 1 : 0), 0) / 2;
  return clamp(itemConfidence * 0.65 + validationConfidence * 0.25 + restaurantConfidence * 0.1);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 10_000) / 10_000));
}

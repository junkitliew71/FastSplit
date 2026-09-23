import type { OcrDetection, ReceiptOcrResponse } from './types.ts';

export type ItemField = 'foodName' | 'quantity' | 'unitPrice' | 'total';
export type SummaryField = 'subtotal' | 'serviceCharge' | 'tax' | 'discount' | 'rounding' | 'grandTotal';
export type TargetKey = `item:${string}:${ItemField}` | `summary:${SummaryField}`;

type Mapping = { ocrIds: string[] };

export type ReviewItem = {
  id: string;
  name: string;
  quantity: number | null;
  unitPriceCents: number | null;
  totalCents: number | null;
  mappings: Record<ItemField, Mapping>;
  validation: { checked: boolean; valid: boolean | null; differenceCents: number | null };
};

export type ReviewModel = {
  items: ReviewItem[];
  summary: Record<SummaryField, { valueCents: number | null; mapping: Mapping }>;
  validation: {
    itemArithmeticValid: boolean;
    subtotalValid: boolean | null;
    grandTotalValid: boolean | null;
    needsReview: boolean;
  };
};

export function createReviewModel(result: ReceiptOcrResponse): ReviewModel {
  const parsed = result.parsed;
  return recalculate({
    items: parsed.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents: item.totalCents,
      mappings: {
        foodName: copyMapping(item.mappings.name),
        quantity: copyMapping(item.mappings.quantity),
        unitPrice: copyMapping(item.mappings.unitPrice),
        total: copyMapping(item.mappings.total),
      },
      validation: { checked: false, valid: null, differenceCents: null },
    })),
    summary: {
      subtotal: { valueCents: parsed.totals.subtotalCents, mapping: copyMapping(parsed.totals.mappings.subtotal) },
      serviceCharge: { valueCents: parsed.charges.serviceChargeCents, mapping: copyMapping(parsed.charges.mappings.serviceCharge) },
      tax: { valueCents: parsed.charges.taxCents, mapping: copyMapping(parsed.charges.mappings.tax) },
      discount: { valueCents: parsed.charges.discountCents, mapping: copyMapping(parsed.charges.mappings.discount) },
      rounding: { valueCents: parsed.charges.roundingCents, mapping: copyMapping(parsed.charges.mappings.rounding) },
      grandTotal: { valueCents: parsed.totals.grandTotalCents, mapping: copyMapping(parsed.totals.mappings.grandTotal) },
    },
    validation: { itemArithmeticValid: true, subtotalValid: null, grandTotalValid: null, needsReview: false },
  });
}

export function assignDetection(
  model: ReviewModel,
  target: TargetKey,
  detectionId: string,
  detections: OcrDetection[],
): ReviewModel {
  const next = structuredClone(model);
  const detection = detections.find((item) => item.id === detectionId);
  if (!detection) return next;
  const parsed = parseTarget(target);
  if (parsed.type === 'item') {
    const item = next.items.find((candidate) => candidate.id === parsed.itemId);
    if (!item) return next;
    if (parsed.field === 'foodName') {
      const ids = item.mappings.foodName.ocrIds;
      if (!ids.includes(detectionId)) ids.push(detectionId);
      const selected = ids.map((id) => detections.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is OcrDetection => candidate !== undefined)
        .sort(readingOrder);
      item.name = selected.map((candidate) => candidate.text).join(' ').trim();
    } else if (parsed.field === 'quantity') {
      item.mappings.quantity = { ocrIds: [detectionId] };
      item.quantity = parseQuantity(detection.text);
    } else if (parsed.field === 'unitPrice') {
      item.mappings.unitPrice = { ocrIds: [detectionId] };
      item.unitPriceCents = parseMoneyCents(detection.text);
    } else {
      item.mappings.total = { ocrIds: [detectionId] };
      item.totalCents = parseMoneyCents(detection.text);
    }
  } else {
    const field = next.summary[parsed.field];
    field.mapping = { ocrIds: [detectionId] };
    const cents = parseMoneyCents(detection.text);
    field.valueCents = parsed.field === 'discount' ? absoluteOrNull(cents) : cents;
  }
  return recalculate(next);
}

export function clearTarget(model: ReviewModel, target: TargetKey): ReviewModel {
  const next = structuredClone(model);
  const parsed = parseTarget(target);
  if (parsed.type === 'item') {
    const item = next.items.find((candidate) => candidate.id === parsed.itemId);
    if (!item) return next;
    item.mappings[parsed.field] = { ocrIds: [] };
    if (parsed.field === 'foodName') item.name = '';
    else if (parsed.field === 'quantity') item.quantity = null;
    else if (parsed.field === 'unitPrice') item.unitPriceCents = null;
    else item.totalCents = null;
  } else {
    next.summary[parsed.field] = { valueCents: null, mapping: { ocrIds: [] } };
  }
  return recalculate(next);
}

export function mappedIdsForTarget(model: ReviewModel, target: TargetKey): string[] {
  const parsed = parseTarget(target);
  if (parsed.type === 'item') {
    return model.items.find((item) => item.id === parsed.itemId)?.mappings[parsed.field].ocrIds ?? [];
  }
  return model.summary[parsed.field].mapping.ocrIds;
}

export function fieldValue(model: ReviewModel, target: TargetKey): string {
  const parsed = parseTarget(target);
  if (parsed.type === 'item') {
    const item = model.items.find((candidate) => candidate.id === parsed.itemId);
    if (!item) return '—';
    if (parsed.field === 'foodName') return item.name || '—';
    if (parsed.field === 'quantity') return item.quantity?.toString() ?? '—';
    return formatMoney(parsed.field === 'unitPrice' ? item.unitPriceCents : item.totalCents);
  }
  return formatMoney(model.summary[parsed.field].valueCents);
}

export function targetLabel(target: TargetKey, model: ReviewModel): string {
  const parsed = parseTarget(target);
  if (parsed.type === 'summary') return summaryLabel(parsed.field);
  const index = model.items.findIndex((item) => item.id === parsed.itemId) + 1;
  const labels: Record<ItemField, string> = {
    foodName: 'Food name', quantity: 'Quantity', unitPrice: 'Unit price', total: 'Item total',
  };
  return `Item ${String(index).padStart(2, '0')} · ${labels[parsed.field]}`;
}

export function cloneReviewModel(model: ReviewModel): ReviewModel {
  return structuredClone(model);
}

function recalculate(model: ReviewModel): ReviewModel {
  for (const item of model.items) {
    const checked = item.quantity !== null && item.unitPriceCents !== null && item.totalCents !== null;
    const differenceCents = checked
      ? (item.quantity ?? 0) * (item.unitPriceCents ?? 0) - (item.totalCents ?? 0)
      : null;
    item.validation = { checked, valid: checked ? Math.abs(differenceCents ?? 0) <= 1 : null, differenceCents };
  }
  const completeTotals = model.items.every((item) => item.totalCents !== null);
  const itemSum = model.items.reduce((sum, item) => sum + (item.totalCents ?? 0), 0);
  const subtotal = model.summary.subtotal.valueCents;
  const subtotalValid = completeTotals && subtotal !== null ? Math.abs(itemSum - subtotal) <= 1 : null;
  const grandTotal = model.summary.grandTotal.valueCents;
  const expectedGrandTotal = subtotal === null ? null
    : subtotal
      + (model.summary.serviceCharge.valueCents ?? 0)
      + (model.summary.tax.valueCents ?? 0)
      - Math.abs(model.summary.discount.valueCents ?? 0)
      + (model.summary.rounding.valueCents ?? 0);
  const grandTotalValid = expectedGrandTotal !== null && grandTotal !== null
    ? Math.abs(expectedGrandTotal - grandTotal) <= 1 : null;
  const itemArithmeticValid = model.items.every((item) => item.validation.valid !== false);
  model.validation = {
    itemArithmeticValid,
    subtotalValid,
    grandTotalValid,
    needsReview: !itemArithmeticValid || subtotalValid === false || grandTotalValid === false,
  };
  return model;
}

function parseTarget(target: TargetKey):
  | { type: 'item'; itemId: string; field: ItemField }
  | { type: 'summary'; field: SummaryField } {
  const parts = target.split(':');
  if (parts[0] === 'summary') return { type: 'summary', field: parts[1] as SummaryField };
  return { type: 'item', itemId: parts[1] ?? '', field: parts[2] as ItemField };
}

function parseMoneyCents(text: string): number | null {
  const cleaned = text.trim().replace(/\s+/g, '').replace(/^(?:RM|MYR)/i, '');
  const match = cleaned.match(/^([-+])?\(?([0-9]+)(?:[.,]([0-9]{1,2}))?\)?$/);
  if (!match?.[2]) return null;
  const negative = match[1] === '-' || cleaned.startsWith('(');
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return negative ? -cents : cents;
}

function parseQuantity(text: string): number | null {
  const match = text.trim().match(/^(\d{1,3})(?:\s*[x×])?$/i);
  return match?.[1] ? Number(match[1]) : null;
}

function formatMoney(cents: number | null): string {
  return cents === null ? '—' : `RM${(cents / 100).toFixed(2)}`;
}

function readingOrder(left: OcrDetection, right: OcrDetection): number {
  return Math.abs(left.centerY - right.centerY) > 0.018
    ? left.centerY - right.centerY
    : left.centerX - right.centerX;
}

function summaryLabel(field: SummaryField): string {
  const labels: Record<SummaryField, string> = {
    subtotal: 'Subtotal', serviceCharge: 'Service charge', tax: 'SST / GST',
    discount: 'Discount', rounding: 'Rounding', grandTotal: 'Grand total',
  };
  return labels[field];
}

function copyMapping(mapping: { ocrIds: string[] } | undefined): Mapping {
  return { ocrIds: [...(mapping?.ocrIds ?? [])] };
}

function absoluteOrNull(value: number | null): number | null {
  return value === null ? null : Math.abs(value);
}

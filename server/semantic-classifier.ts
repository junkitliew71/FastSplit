import { parseMoneyCents } from './money.js';
import { matchReceiptKeyword, normalizeReceiptText } from './receipt-keywords.js';
import type {
  ClassifiedReceiptLine,
  LayoutRow,
  ReceiptRegionDetection,
  ReceiptRegionKind,
  ReceiptSemanticLabel,
  SemanticClassification,
  SemanticField,
} from './types.js';

export type SemanticLineContext = {
  region: ReceiptRegionKind;
  regionConfidence: number;
  previousRow?: LayoutRow;
  nextRow?: LayoutRow;
};

const ADDRESS_PATTERN = /\b(?:JALAN|JLN|ROAD|RD|STREET|LOT|TAMAN|BANDAR|SELANGOR|KUALA LUMPUR|PENANG|JOHOR|MALAYSIA|NEGERI SEMBILAN|SARAWAK|SABAH)\b/i;
const WEBSITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i;
const PHONE_PATTERN = /(?:\+?6?0?1\d[-\s]?\d{3,4}[-\s]?\d{4}|0\d[-\s]?\d{6,8})/;

export function classifyReceiptLayout(layout: { rows: LayoutRow[] }, regions: ReceiptRegionDetection): SemanticClassification {
  const assignmentByRow = new Map(regions.assignments.map((assignment) => [assignment.rowId, assignment]));
  return {
    lines: layout.rows.map((row, index) => {
      const assignment = assignmentByRow.get(row.id);
      return classifyLine(row, {
        region: assignment?.kind ?? 'UNKNOWN',
        regionConfidence: assignment?.confidence ?? 0,
        previousRow: layout.rows[index - 1],
        nextRow: layout.rows[index + 1],
      });
    }),
  };
}

export function classifyLine(row: LayoutRow, context: SemanticLineContext): ClassifiedReceiptLine {
  const base = baseLine(row, context);
  const normalized = normalizeReceiptText(row.text);

  if (context.region === 'FOOTER') {
    const keyword = matchReceiptKeyword(row.text);
    if (keyword?.category === 'FOOTER') return complete(base, 'IGNORE', 0.97, [`footer keyword: ${keyword.keyword}`]);
  }

  if (context.region === 'MERCHANT') return classifyMerchant(row, context, base);
  if (context.region === 'METADATA') return classifyMetadata(row, context, base, normalized);
  if (context.region === 'ITEM_HEADER') return complete(base, 'ITEM_HEADER', 0.98, ['ITEM_HEADER region', 'multiple column markers']);
  if (context.region === 'ITEMS') return classifyItem(row, context, base);
  if (context.region === 'SUMMARY') return classifySummary(row, context, base);
  if (context.region === 'PAYMENT') return classifyPayment(row, context, base, normalized);

  const keyword = matchReceiptKeyword(row.text);
  if (keyword?.exact) {
    return unknown(base, [`keyword ${keyword.keyword} found outside expected region`], ['region does not support semantic label']);
  }
  return unknown(base, ['insufficient semantic evidence']);
}

function classifyMerchant(row: LayoutRow, context: SemanticLineContext, base: ClassifiedReceiptLine): ClassifiedReceiptLine {
  if (WEBSITE_PATTERN.test(row.text)) return complete(base, 'MERCHANT_WEBSITE', 0.97, ['domain pattern', 'MERCHANT region']);
  if (PHONE_PATTERN.test(row.text)) return complete(base, 'MERCHANT_PHONE', 0.94, ['phone pattern', 'MERCHANT region']);
  if (ADDRESS_PATTERN.test(row.text) || /\b\d{5}\b/.test(row.text)) {
    return complete(base, 'MERCHANT_ADDRESS', 0.86, ['address marker or postcode', 'MERCHANT region']);
  }
  const hasLetters = /[A-Z\u3400-\u9fff]{2}/i.test(row.text);
  const noAmount = moneyDetections(row).length === 0;
  if (hasLetters && noAmount && context.regionConfidence >= 0.62) {
    return complete(base, 'MERCHANT_NAME', 0.84, ['top merchant region', 'text prominence', 'no monetary amount']);
  }
  return unknown(base, ['merchant evidence is insufficient']);
}

function classifyMetadata(row: LayoutRow, _context: SemanticLineContext, base: ClassifiedReceiptLine, normalized: string): ClassifiedReceiptLine {
  const rules: Array<[RegExp, ReceiptSemanticLabel]> = [
    [/^TABLE(?:\s+NO)?\b/, 'TABLE_NUMBER'],
    [/^CASHIER\b/, 'CASHIER'],
    [/^DATE\b/, 'DATE'],
    [/^TIME\b/, 'TIME'],
    [/^(?:INVOICE|INV\s+NO|BILL\s+NO|RECEIPT\s+NO)\b/, 'INVOICE_NUMBER'],
    [/^TERMINAL\b/, 'TERMINAL'],
    [/^TRANS(?:ACTION)?\s+TYPE\b/, 'TRANSACTION_TYPE'],
    [/^PAX\b/, 'PAX'],
  ];
  const matched = rules.find(([pattern]) => pattern.test(normalized));
  return matched
    ? complete(base, matched[1], 0.95, ['exact metadata marker', 'METADATA region'])
    : unknown(base, ['METADATA region without a supported marker']);
}

function classifySummary(row: LayoutRow, _context: SemanticLineContext, base: ClassifiedReceiptLine): ClassifiedReceiptLine {
  const match = matchReceiptKeyword(row.text);
  const labelByCategory: Partial<Record<string, ReceiptSemanticLabel>> = {
    SUBTOTAL: 'SUBTOTAL',
    SERVICE_CHARGE: 'SERVICE_CHARGE',
    TAX: 'TAX',
    SST: 'SST',
    GRAND_TOTAL: 'GRAND_TOTAL',
    DISCOUNT: 'DISCOUNT',
    ROUNDING: 'ROUNDING',
  };
  const label = match ? labelByCategory[match.category] : undefined;
  if (!match || !label) return unknown(base, ['SUMMARY region without a sufficiently strong summary keyword']);
  const confidence = match.exact ? 0.96 : Math.max(0.82, Math.min(0.9, match.similarity));
  const amount = rightmostMoney(row);
  const fields = amount ? [semanticField(label, amount.text, amount.ids, amount.ocrConfidence, confidence, ['rightmost summary amount'])] : [];
  return complete(base, label, confidence, [
    `${match.exact ? 'exact' : 'fuzzy'} keyword: ${match.keyword}`,
    'SUMMARY region',
    ...(amount ? ['amount on right'] : []),
  ], fields, match.exact ? [] : ['fuzzy keyword match; retain for review']);
}

function classifyPayment(row: LayoutRow, _context: SemanticLineContext, base: ClassifiedReceiptLine, normalized: string): ClassifiedReceiptLine {
  let label: ReceiptSemanticLabel = 'PAYMENT_METHOD';
  if (/^CASH\b/.test(normalized)) label = 'CASH';
  else if (/^CHANGE\b/.test(normalized)) label = 'CHANGE';
  else if (!/^(?:PAYMENT|CARD|VISA|MASTERCARD|TENDERED|RECEIVED)\b/.test(normalized)) {
    return unknown(base, ['PAYMENT region without a supported payment marker']);
  }
  const amount = rightmostMoney(row);
  const fields = amount ? [semanticField(label, amount.text, amount.ids, amount.ocrConfidence, 0.95, ['payment amount'])] : [];
  return complete(base, label, 0.95, ['payment marker', 'PAYMENT region'], fields);
}

function classifyItem(row: LayoutRow, context: SemanticLineContext, base: ClassifiedReceiptLine): ClassifiedReceiptLine {
  const amounts = moneyDetections(row);
  const quantityDetection = row.detections.find((item) => item.centerX < 0.4 && /^\d+(?:[.,]\d+)?$/.test(item.text.trim()));
  const nameDetections = row.detections.filter((item) => /[A-Za-z\u3400-\u9fff]{2}/.test(item.text) && parseMoneyCents(item.text) === null);
  const rightAmount = amounts[amounts.length - 1];
  const hasLeftDescription = nameDetections.some((item) => item.centerX < 0.68);
  const neighboringItem = Boolean(
    context.previousRow?.multilineCandidate
    || context.nextRow?.multilineCandidate
    || (context.nextRow && supportsWrappedContinuation(row, context.nextRow)),
  );
  const evidence = ['ITEMS region'];
  if (hasLeftDescription) evidence.push('description text on left');
  if (rightAmount && rightAmount.centerX > 0.55) evidence.push('amount on right');
  if (neighboringItem) evidence.push('neighboring multiline/item structure');
  if (!hasLeftDescription || (!rightAmount && !neighboringItem)) return unknown(base, [...evidence, 'insufficient item structure']);

  const confidence = rightAmount ? 0.9 : 0.7;
  const fields: SemanticField[] = [];
  if (quantityDetection) {
    fields.push(semanticField('ITEM_QUANTITY', quantityDetection.text, [quantityDetection.id], quantityDetection.confidence, 0.88, ['left quantity position']));
  }
  if (nameDetections.length) {
    fields.push(semanticField('ITEM_NAME', nameDetections.map((item) => item.text).join(' '), nameDetections.map((item) => item.id), average(nameDetections.map((item) => item.confidence)), confidence, ['description text on left']));
  }
  if (amounts.length >= 2) {
    const unitPrice = amounts[amounts.length - 2];
    if (unitPrice) fields.push(semanticField('ITEM_UNIT_PRICE', unitPrice.text, [unitPrice.id], unitPrice.confidence, 0.76, ['numeric column before total']));
  }
  if (rightAmount) fields.push(semanticField('ITEM_TOTAL', rightAmount.text, [rightAmount.id], rightAmount.confidence, 0.9, ['rightmost aligned amount']));
  return complete(base, 'ITEM', confidence, evidence, fields, rightAmount ? [] : ['multiline item-name candidate; association deferred']);
}

function baseLine(row: LayoutRow, context: SemanticLineContext): ClassifiedReceiptLine {
  return {
    rowId: row.id,
    text: row.text,
    region: context.region,
    regionConfidence: context.regionConfidence,
    primaryLabel: 'UNKNOWN',
    ocrConfidence: row.confidence,
    semanticConfidence: 0,
    fields: [],
    ocrIds: [...row.detectionIds],
    evidence: [],
    warnings: [],
  };
}

function complete(
  base: ClassifiedReceiptLine,
  label: ReceiptSemanticLabel,
  confidence: number,
  evidence: string[],
  fields: SemanticField[] = [],
  warnings: string[] = [],
): ClassifiedReceiptLine {
  if (confidence < 0.62) return unknown(base, evidence, warnings);
  return { ...base, primaryLabel: label, semanticConfidence: confidence, evidence, fields, warnings };
}

function unknown(base: ClassifiedReceiptLine, evidence: string[], warnings: string[] = []): ClassifiedReceiptLine {
  return { ...base, primaryLabel: 'UNKNOWN', semanticConfidence: 0.3, evidence, warnings, fields: [] };
}

function semanticField(
  label: ReceiptSemanticLabel,
  text: string,
  ocrIds: string[],
  ocrConfidence: number,
  semanticConfidence: number,
  evidence: string[],
  valueCents = parseMoneyCents(text) ?? undefined,
): SemanticField {
  return { label, text, valueCents, ocrIds, ocrConfidence, semanticConfidence, evidence };
}

function moneyDetections(row: LayoutRow) {
  return row.detections
    .filter((item) => /(?:\d+[.,]\d{2}|(?:RM|MYR)\s*\d+)/i.test(item.text) && parseMoneyCents(item.text) !== null)
    .sort((left, right) => left.centerX - right.centerX);
}

function rightmostMoney(row: LayoutRow): { text: string; ids: string[]; ocrConfidence: number } | null {
  const detection = moneyDetections(row).at(-1);
  return detection ? { text: detection.text, ids: [detection.id], ocrConfidence: detection.confidence } : null;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function supportsWrappedContinuation(row: LayoutRow, next: LayoutRow): boolean {
  const typicalHeight = row.medianHeight ?? row.bbox.y2 - row.bbox.y1;
  const verticalGap = next.bbox.y1 - row.bbox.y2;
  const rowHasName = row.detections.some((item) => item.centerX < 0.68 && /[A-Za-z\u3400-\u9fff]{2}/.test(item.text));
  const nextHasName = next.detections.some((item) => item.centerX < 0.68 && /[A-Za-z\u3400-\u9fff]{2}/.test(item.text));
  const nextAmount = moneyDetections(next).at(-1);
  const indentation = next.bbox.x1 - row.bbox.x1;
  return rowHasName
    && nextHasName
    && Boolean(nextAmount && nextAmount.centerX > 0.55)
    && verticalGap >= -typicalHeight * 0.15
    && verticalGap <= typicalHeight * 1.5
    && indentation >= -0.03
    && indentation <= 0.18;
}

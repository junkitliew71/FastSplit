import './style.css';
import { scanReceipt } from './api.ts';
import { prepareReceiptImage, type PreparedImage } from './image.ts';
import {
  assignDetection,
  clearTarget,
  cloneReviewModel,
  createReviewModel,
  fieldValue,
  mappedIdsForTarget,
  targetLabel,
  type ReviewModel,
  type TargetKey,
} from './review-model.ts';
import type { ReceiptOcrResponse } from './types.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root is missing.');

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="FastSplit home"><span>F</span> FastSplit</a>
    <div class="lang" aria-label="Language"><button class="active">EN</button><button>中文</button></div>
  </header>
  <main>
    <section class="hero">
      <p class="eyebrow">SMART RECEIPT SCANNER</p>
      <h1>Split the bill.<br><em>Keep the moment.</em></h1>
      <p class="intro">Upload a restaurant receipt and FastSplit will read every line securely on the server.</p>
    </section>
    <section class="scanner" aria-labelledby="scan-title">
      <div class="section-heading"><div><p class="step">01 · RECEIPT</p><h2 id="scan-title">Scan your receipt</h2></div><span class="privacy">Processed privately</span></div>
      <label class="dropzone" id="dropzone">
        <input id="receipt-input" type="file" accept="image/*" capture="environment" />
        <span class="camera">⌁</span><strong>Take a photo or choose a receipt</strong>
        <small>JPG, PNG, WebP · large photos are resized before upload</small>
      </label>
      <div id="workspace" class="workspace hidden">
        <div class="preview-wrap"><img id="preview" alt="Receipt preview" /><div id="boxes" class="boxes"></div></div>
        <div class="result-panel">
          <div id="status" class="status">Ready to scan</div>
          <p id="image-info" class="image-info"></p>
          <button id="scan-button" class="primary">Read receipt</button>
          <button id="cancel-button" class="secondary">Choose another</button>
          <div id="summary" class="summary hidden"></div>
          <section id="review" class="review hidden" aria-labelledby="review-title">
            <div class="review-title-row"><div><p class="step">02 · REVIEW RECEIPT</p><h3 id="review-title">Check the receipt</h3></div></div>
            <div id="editing-banner" class="editing-banner" aria-live="polite"><span>Select a field to correct</span></div>
            <div class="mapping-actions">
              <button id="undo-mapping" class="compact-button" disabled>Undo last mapping</button>
              <button id="clear-field" class="compact-button" disabled>Clear field</button>
            </div>
            <div id="review-fields"></div>
          </section>
          <details id="raw-detections" class="raw-detections hidden"><summary>Detected OCR text</summary><ol id="detections" class="detections"></ol></details>
        </div>
      </div>
    </section>
  </main>
  <footer>FastSplit · Built for fairer tables</footer>
`;

const input = document.querySelector<HTMLInputElement>('#receipt-input')!;
const dropzone = document.querySelector<HTMLLabelElement>('#dropzone')!;
const workspace = document.querySelector<HTMLDivElement>('#workspace')!;
const preview = document.querySelector<HTMLImageElement>('#preview')!;
const boxes = document.querySelector<HTMLDivElement>('#boxes')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const imageInfo = document.querySelector<HTMLParagraphElement>('#image-info')!;
const scanButton = document.querySelector<HTMLButtonElement>('#scan-button')!;
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel-button')!;
const summary = document.querySelector<HTMLDivElement>('#summary')!;
const detections = document.querySelector<HTMLOListElement>('#detections')!;
const review = document.querySelector<HTMLElement>('#review')!;
const reviewFields = document.querySelector<HTMLDivElement>('#review-fields')!;
const editingBanner = document.querySelector<HTMLDivElement>('#editing-banner')!;
const undoButton = document.querySelector<HTMLButtonElement>('#undo-mapping')!;
const clearButton = document.querySelector<HTMLButtonElement>('#clear-field')!;
const rawDetections = document.querySelector<HTMLDetailsElement>('#raw-detections')!;

let prepared: PreparedImage | null = null;
let controller: AbortController | null = null;
let currentResult: ReceiptOcrResponse | null = null;
let reviewModel: ReviewModel | null = null;
let activeTarget: TargetKey | null = null;
let mappingHistory: ReviewModel[] = [];

function reset(): void {
  controller?.abort();
  if (prepared) URL.revokeObjectURL(prepared.previewUrl);
  prepared = null;
  input.value = '';
  workspace.classList.add('hidden');
  dropzone.classList.remove('hidden');
  boxes.replaceChildren();
  detections.replaceChildren();
  summary.classList.add('hidden');
  review.classList.add('hidden');
  rawDetections.classList.add('hidden');
  currentResult = null;
  reviewModel = null;
  activeTarget = null;
  mappingHistory = [];
}

function renderResult(result: ReceiptOcrResponse): void {
  status.textContent = result.needsReview ? 'Review recommended' : 'Receipt read successfully';
  status.className = `status ${result.needsReview ? 'warning' : 'success'}`;
  summary.classList.remove('hidden');
  summary.innerHTML = `<strong>${result.ocr.detections.length} text regions</strong><span>${Math.round(result.ocr.confidence * 100)}% confidence · Pass ${result.ocr.passUsed} · ${Math.round(result.timingsMs.total ?? 0)} ms${result.cacheHit ? ' · cached' : ''}</span>`;
  boxes.replaceChildren();
  detections.replaceChildren();
  currentResult = result;
  reviewModel = createReviewModel(result);
  activeTarget = null;
  mappingHistory = [];
  review.classList.remove('hidden');
  rawDetections.classList.remove('hidden');

  for (const item of result.ocr.detections) {
    const box = document.createElement('button');
    box.className = 'ocr-box';
    box.dataset.ocrId = item.id;
    box.draggable = true;
    box.setAttribute('aria-label', `${item.text}, ${Math.round(item.confidence * 100)}% confidence`);
    box.style.left = `${item.bbox.x1 * 100}%`;
    box.style.top = `${item.bbox.y1 * 100}%`;
    box.style.width = `${(item.bbox.x2 - item.bbox.x1) * 100}%`;
    box.style.height = `${(item.bbox.y2 - item.bbox.y1) * 100}%`;
    box.title = `${item.text} · ${Math.round(item.confidence * 100)}%`;
    box.addEventListener('click', () => selectOcrDetection(item.id));
    box.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/x-fastsplit-ocr-id', item.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    });
    boxes.append(box);

    const row = document.createElement('li');
    row.dataset.ocrId = item.id;
    row.draggable = true;
    row.innerHTML = `<span>${escapeHtml(item.text)}</span><small>${Math.round(item.confidence * 100)}%</small>`;
    row.addEventListener('click', () => selectOcrDetection(item.id));
    row.addEventListener('dragstart', (event) => event.dataTransfer?.setData('text/x-fastsplit-ocr-id', item.id));
    detections.append(row);
  }
  renderReview();
}

function renderReview(): void {
  if (!reviewModel) return;
  const itemCards = reviewModel.items.map((item, index) => {
    const itemNumber = String(index + 1).padStart(2, '0');
    const fields: Array<[string, TargetKey]> = [
      ['Food name', `item:${item.id}:foodName`],
      ['Quantity', `item:${item.id}:quantity`],
      ['Unit price', `item:${item.id}:unitPrice`],
      ['Item total', `item:${item.id}:total`],
    ];
    const validation = item.validation.checked
      ? `<span class="math-check ${item.validation.valid ? 'valid' : 'invalid'}">${item.quantity ?? '—'} × ${formatMoney(item.unitPriceCents)} ${item.validation.valid ? '=' : '≠'} ${formatMoney(item.totalCents)} ${item.validation.valid ? '✓' : `(${formatDifference(item.validation.differenceCents)})`}</span>`
      : '<span class="math-check pending">Complete quantity, unit price and total</span>';
    return `<article class="item-card">
      <div class="item-card-title"><strong>Item ${itemNumber}</strong>${validation}</div>
      <div class="field-grid">${fields.map(([label, target]) => mappingField(label, target)).join('')}</div>
    </article>`;
  }).join('');
  const summaryTargets: Array<[string, TargetKey]> = [
    ['Subtotal', 'summary:subtotal'], ['Service charge', 'summary:serviceCharge'],
    ['SST / GST', 'summary:tax'], ['Discount', 'summary:discount'],
    ['Rounding', 'summary:rounding'], ['Grand total', 'summary:grandTotal'],
  ];
  const overall = reviewModel.validation;
  const overallText = overall.needsReview
    ? 'Amounts need review'
    : overall.subtotalValid === true && overall.grandTotalValid === true ? 'Receipt balances ✓' : 'Complete totals to validate';
  reviewFields.innerHTML = `${itemCards}
    <article class="item-card totals-card"><div class="item-card-title"><strong>Receipt totals</strong><span class="math-check ${overall.needsReview ? 'invalid' : 'pending'}">${overallText}</span></div>
    <div class="field-grid">${summaryTargets.map(([label, target]) => mappingField(label, target)).join('')}</div></article>`;
  editingBanner.innerHTML = activeTarget
    ? `<strong>EDITING</strong><span>${escapeHtml(targetLabel(activeTarget, reviewModel))}</span><small>Tap an OCR box on the receipt${activeTarget.endsWith(':foodName') ? ' · tap more boxes to combine the name' : ''}</small>`
    : '<span>Select a field, then tap OCR text on the receipt</span>';
  undoButton.disabled = mappingHistory.length === 0;
  clearButton.disabled = activeTarget === null;
  updateBoxStates();
}

function mappingField(label: string, target: TargetKey): string {
  if (!reviewModel) return '';
  const ids = mappedIdsForTarget(reviewModel, target);
  return `<button class="mapping-field${activeTarget === target ? ' active' : ''}" data-target="${target}" type="button">
    <span>${escapeHtml(label)}</span><strong>${escapeHtml(fieldValue(reviewModel, target))}</strong><small>${ids.length ? `${ids.length} OCR box${ids.length > 1 ? 'es' : ''}` : 'Tap to map'}</small>
  </button>`;
}

function selectOcrDetection(ocrId: string): void {
  if (!activeTarget || !reviewModel || !currentResult) return;
  mappingHistory.push(cloneReviewModel(reviewModel));
  reviewModel = assignDetection(reviewModel, activeTarget, ocrId, currentResult.ocr.detections);
  if (!activeTarget.endsWith(':foodName')) activeTarget = null;
  renderReview();
}

function activateTarget(target: TargetKey): void {
  activeTarget = target;
  renderReview();
}

function updateBoxStates(): void {
  if (!reviewModel) return;
  const mapped = new Set<string>();
  for (const item of reviewModel.items) {
    for (const mapping of Object.values(item.mappings)) mapping.ocrIds.forEach((id) => mapped.add(id));
  }
  for (const field of Object.values(reviewModel.summary)) field.mapping.ocrIds.forEach((id) => mapped.add(id));
  const selected = new Set(activeTarget ? mappedIdsForTarget(reviewModel, activeTarget) : []);
  for (const element of document.querySelectorAll<HTMLElement>('[data-ocr-id]')) {
    const id = element.dataset.ocrId ?? '';
    element.classList.toggle('mapped', mapped.has(id));
    element.classList.toggle('selected', selected.has(id));
  }
}

function formatMoney(cents: number | null): string {
  return cents === null ? '—' : `RM${(cents / 100).toFixed(2)}`;
}

function formatDifference(cents: number | null): string {
  if (cents === null) return 'not checked';
  const sign = cents > 0 ? '+' : '';
  return `${sign}${(cents / 100).toFixed(2)}`;
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  status.textContent = 'Improving image…';
  try {
    prepared = await prepareReceiptImage(file);
    preview.src = prepared.previewUrl;
    imageInfo.textContent = `${prepared.width} × ${prepared.height} · ${(prepared.uploadedBytes / 1024 / 1024).toFixed(2)} MB upload`;
    dropzone.classList.add('hidden');
    workspace.classList.remove('hidden');
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not prepare image.';
  }
});

scanButton.addEventListener('click', async () => {
  if (!prepared) return;
  controller = new AbortController();
  scanButton.disabled = true;
  status.className = 'status loading';
  status.textContent = 'Uploading receipt… Reading text…';
  try {
    renderResult(await scanReceipt(prepared.blob, controller.signal));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    status.className = 'status error';
    status.textContent = error instanceof Error ? error.message : 'Could not read this receipt clearly.';
  } finally {
    scanButton.disabled = false;
    controller = null;
  }
});

cancelButton.addEventListener('click', reset);

review.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-target]')?.dataset.target;
  if (target) activateTarget(target as TargetKey);
});

review.addEventListener('dragover', (event) => {
  const field = (event.target as HTMLElement).closest<HTMLElement>('[data-target]');
  if (!field) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  field.classList.add('drag-over');
});

review.addEventListener('dragleave', (event) => {
  (event.target as HTMLElement).closest<HTMLElement>('[data-target]')?.classList.remove('drag-over');
});

review.addEventListener('drop', (event) => {
  const field = (event.target as HTMLElement).closest<HTMLElement>('[data-target]');
  const target = field?.dataset.target as TargetKey | undefined;
  const ocrId = event.dataTransfer?.getData('text/x-fastsplit-ocr-id');
  field?.classList.remove('drag-over');
  if (!target || !ocrId || !reviewModel || !currentResult) return;
  event.preventDefault();
  mappingHistory.push(cloneReviewModel(reviewModel));
  reviewModel = assignDetection(reviewModel, target, ocrId, currentResult.ocr.detections);
  activeTarget = target.endsWith(':foodName') ? target : null;
  renderReview();
});

clearButton.addEventListener('click', () => {
  if (!reviewModel || !activeTarget) return;
  mappingHistory.push(cloneReviewModel(reviewModel));
  reviewModel = clearTarget(reviewModel, activeTarget);
  renderReview();
});

undoButton.addEventListener('click', () => {
  const previous = mappingHistory.pop();
  if (!previous) return;
  reviewModel = previous;
  renderReview();
});

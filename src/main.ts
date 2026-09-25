import './style.css';
import { scanReceipt } from './api.ts';
import {
  authenticatedIdentity,
  clearGuestMode,
  enableGuestMode,
  type AuthIdentity,
} from './auth-session.ts';
import {
  firebaseConfigured,
  friendlyAuthError,
  logoutFirebase,
  signInWithGoogle,
} from './firebase-auth.ts';
import { prepareReceiptImage, type PreparedImage } from './image.ts';
import { deleteReceiptHistory, getReceiptHistory, listReceiptHistory, saveReceiptHistory } from './firebase-history.ts';
import { createHistoryRecord, type ReceiptHistoryRecord } from './receipt-history-model.ts';
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
  <section id="auth-gate" class="auth-gate hidden" aria-labelledby="auth-title">
    <div class="auth-card">
      <a class="brand auth-brand" href="/" aria-label="FastSplit home"><span>F</span> FastSplit</a>
      <p class="eyebrow">WELCOME TO FASTSPLIT</p>
      <h1 id="auth-title">Split together.<br><em>Settle simply.</em></h1>
      <p class="intro">Sign in to keep your account ready across devices, or continue as a guest to split a bill now.</p>
      <button id="google-login" class="auth-button google-button" type="button"><span class="google-mark">G</span> Continue with Google</button>
      <button id="guest-login" class="auth-button guest-button" type="button">Continue as Guest</button>
      <p id="auth-message" class="auth-message" aria-live="polite"></p>
      <small class="auth-note">Guest Mode keeps the core receipt and bill-splitting flow available without an account.</small>
    </div>
  </section>
  <header class="topbar">
    <a class="brand" href="/" aria-label="FastSplit home"><span>F</span> FastSplit</a>
    <div class="topbar-actions">
      <div class="lang" aria-label="Language"><button class="active">EN</button><button>中文</button></div>
      <button id="split-nav" class="header-link" type="button">Split a bill</button>
      <button id="history-nav" class="history-nav hidden" type="button">↶&nbsp; History</button>
      <div id="account-chip" class="account-chip hidden"><span id="account-avatar"></span><span id="account-name"></span><button id="logout-button" type="button">Log out</button></div>
    </div>
  </header>
  <main id="app-main">
    <div id="scan-view">
    <section class="hero">
      <h1>Split the bill.<br><em>Pay for what you ate.</em></h1>
      <p class="intro">Add your receipt, choose who had what, and share the totals.</p>
      <div class="hero-actions">
        <button id="scan-hero" class="hero-primary" type="button">▣&nbsp; Scan receipt</button>
        <button id="upload-hero" class="hero-secondary" type="button">⇧&nbsp; Upload receipt</button>
      </div>
      <button id="manual-hero" class="manual-link" type="button">⌕&nbsp; Enter manually&nbsp; →</button>
      <div class="how-it-works" aria-label="How FastSplit works">
        <div><span>1</span><strong>Add receipt</strong><small>Take a photo or upload one</small></div>
        <div><span>2</span><strong>Check & assign</strong><small>Fix anything unclear, then choose diners</small></div>
        <div><span>3</span><strong>Share totals</strong><small>Send a clear text breakdown</small></div>
      </div>
    </section>
    <section class="scanner hidden" aria-labelledby="scan-title">
      <button id="scanner-back" class="history-back" type="button">‹&nbsp; Back</button>
      <nav id="wizard" class="wizard" aria-label="Bill steps">
        <button class="active" data-step="1" type="button"><span>1</span>Receipt</button>
        <button data-step="2" type="button"><span>2</span>Review</button>
        <button data-step="3" type="button"><span>3</span>People</button>
        <button data-step="4" type="button"><span>4</span>Split</button>
        <button data-step="5" type="button"><span>5</span>Summary</button>
      </nav>
      <div id="receipt-step" class="workflow-step">
      <p class="step">BRING THE BILL</p>
      <div class="section-heading"><div><h2 id="scan-title">Scan your receipt</h2><p class="scanner-copy">Keep the whole receipt in frame, with readable prices.</p></div><span class="privacy">Processed privately</span></div>
      <label class="dropzone" id="dropzone">
        <input id="receipt-input" type="file" accept="image/*" capture="environment" />
        <input id="upload-input" type="file" accept="image/*" />
        <span class="camera">⌁</span><strong>Take a photo or choose a receipt</strong>
        <small>JPG, PNG, WebP · large photos are resized before upload</small>
      </label>
      <div class="scan-tips" aria-label="Tips for a better scan">
        <span>✓ Show all four receipt edges</span><span>✓ Avoid shadows and glare</span><span>✓ Keep prices sharp and readable</span>
      </div>
      <div id="workspace" class="workspace hidden">
        <div class="preview-column"><div class="preview-wrap"><img id="preview" alt="Receipt preview" /><div id="boxes" class="boxes"></div></div></div>
        <div class="result-panel">
          <div id="status" class="status" aria-live="polite">Ready to scan</div>
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
            <div id="review-health" class="review-health" aria-live="polite"></div>
            <div id="review-fields"></div>
            <button id="confirm-review" class="primary" type="button">Confirm receipt →</button>
            <button id="save-history" class="primary history-save hidden" type="button">Save to History</button>
            <p id="save-message" class="save-message" aria-live="polite"></p>
          </section>
          <details id="raw-detections" class="raw-detections hidden"><summary>Detected OCR text</summary><ol id="detections" class="detections"></ol></details>
        </div>
      </div>
      </div>
      <section id="people-step" class="workflow-step hidden">
        <p class="step">WHO IS SHARING?</p><h2>Add people</h2>
        <p class="scanner-copy">Add everyone at the table before assigning the food.</p>
        <form id="people-form" class="people-form"><input id="person-name" maxlength="40" placeholder="Name" required><button type="submit">+ Add person</button></form>
        <p id="people-feedback" class="inline-feedback" aria-live="polite"></p>
        <div id="people-list" class="people-list"></div>
        <button id="people-continue" class="primary" type="button" disabled>Continue to split →</button>
      </section>
      <section id="manual-step" class="workflow-step hidden">
        <p class="step">ENTER THE BILL</p><h2>Enter receipt manually</h2>
        <p class="scanner-copy">Add each item exactly as it appears on the bill.</p>
        <label class="manual-restaurant">Restaurant<input id="manual-restaurant" placeholder="Restaurant name"></label>
        <div id="manual-items" class="manual-items"></div>
        <button id="manual-add-item" class="secondary" type="button">＋ Add item</button>
        <div class="manual-totals">
          <label>Service charge<input id="manual-service" type="number" min="0" step="0.01" value="0.00"></label>
          <label>SST / GST<input id="manual-tax" type="number" min="0" step="0.01" value="0.00"></label>
          <label>Discount<input id="manual-discount" type="number" min="0" step="0.01" value="0.00"></label>
          <label>Rounding<input id="manual-rounding" type="number" step="0.01" value="0.00"></label>
        </div>
        <div id="manual-calculated" class="manual-calculated"></div>
        <button id="manual-continue" class="primary" type="button">Confirm receipt →</button>
      </section>
      <section id="split-step" class="workflow-step hidden">
        <p class="step">WHO HAD WHAT?</p><h2>Split the items</h2>
        <p class="scanner-copy">Select one or more people for every item. Shared items are divided equally.</p>
        <div id="assignment-progress" class="assignment-progress" aria-live="polite"></div>
        <div id="assignment-list" class="assignment-list"></div>
        <button id="split-continue" class="primary" type="button">Review summary →</button>
      </section>
      <section id="final-step" class="workflow-step hidden">
        <p class="step">ALL SQUARE</p><h2>Good food. Fair split.</h2>
        <p id="final-restaurant" class="scanner-copy"></p>
        <div id="final-total" class="final-total"></div>
        <div id="person-totals" class="person-totals"></div>
        <div id="allocation-check" class="allocation-check"></div>
        <button id="share-result" class="primary share-result" type="button">⌯&nbsp; Share result</button>
        <p id="share-message" class="save-message" aria-live="polite"></p>
        <button id="start-over" class="primary" type="button">Split another bill</button>
      </section>
    </section>
    </div>
    <section id="history-view" class="history-view hidden" aria-labelledby="history-title">
      <button id="history-back" class="history-back" type="button">← Back to receipt</button>
      <p class="eyebrow">YOUR SAVED RECEIPTS</p>
      <h2 id="history-title">Receipt history</h2>
      <p class="intro">Your receipts stay here until you choose to delete them.</p>
      <div id="history-status" class="history-status" aria-live="polite"></div>
      <div id="history-list" class="history-list"></div>
    </section>
  </main>
  <footer id="app-footer"><strong>FastSplit·</strong><span>Made for meals, not maths.</span></footer>
`;

const authGate = document.querySelector<HTMLElement>('#auth-gate')!;
const authMessage = document.querySelector<HTMLParagraphElement>('#auth-message')!;
const googleLoginButton = document.querySelector<HTMLButtonElement>('#google-login')!;
const guestLoginButton = document.querySelector<HTMLButtonElement>('#guest-login')!;
const logoutButton = document.querySelector<HTMLButtonElement>('#logout-button')!;
const accountChip = document.querySelector<HTMLDivElement>('#account-chip')!;
const accountAvatar = document.querySelector<HTMLSpanElement>('#account-avatar')!;
const accountName = document.querySelector<HTMLSpanElement>('#account-name')!;
const appMain = document.querySelector<HTMLElement>('#app-main')!;
const appFooter = document.querySelector<HTMLElement>('#app-footer')!;
const scanView = document.querySelector<HTMLElement>('#scan-view')!;
const historyView = document.querySelector<HTMLElement>('#history-view')!;
const historyNav = document.querySelector<HTMLButtonElement>('#history-nav')!;
const splitNav = document.querySelector<HTMLButtonElement>('#split-nav')!;
const scanHero = document.querySelector<HTMLButtonElement>('#scan-hero')!;
const uploadHero = document.querySelector<HTMLButtonElement>('#upload-hero')!;
const manualHero = document.querySelector<HTMLButtonElement>('#manual-hero')!;
const scannerBack = document.querySelector<HTMLButtonElement>('#scanner-back')!;
const scannerSection = document.querySelector<HTMLElement>('.scanner')!;
const hero = document.querySelector<HTMLElement>('.hero')!;
const wizard = document.querySelector<HTMLElement>('#wizard')!;
const receiptStep = document.querySelector<HTMLElement>('#receipt-step')!;
const peopleStep = document.querySelector<HTMLElement>('#people-step')!;
const manualStep = document.querySelector<HTMLElement>('#manual-step')!;
const splitStep = document.querySelector<HTMLElement>('#split-step')!;
const finalStep = document.querySelector<HTMLElement>('#final-step')!;
const confirmReviewButton = document.querySelector<HTMLButtonElement>('#confirm-review')!;
const peopleForm = document.querySelector<HTMLFormElement>('#people-form')!;
const personName = document.querySelector<HTMLInputElement>('#person-name')!;
const peopleList = document.querySelector<HTMLDivElement>('#people-list')!;
const peopleContinue = document.querySelector<HTMLButtonElement>('#people-continue')!;
const peopleFeedback = document.querySelector<HTMLParagraphElement>('#people-feedback')!;
const assignmentList = document.querySelector<HTMLDivElement>('#assignment-list')!;
const assignmentProgress = document.querySelector<HTMLDivElement>('#assignment-progress')!;
const splitContinue = document.querySelector<HTMLButtonElement>('#split-continue')!;
const finalRestaurant = document.querySelector<HTMLParagraphElement>('#final-restaurant')!;
const finalTotal = document.querySelector<HTMLDivElement>('#final-total')!;
const personTotals = document.querySelector<HTMLDivElement>('#person-totals')!;
const allocationCheck = document.querySelector<HTMLDivElement>('#allocation-check')!;
const startOver = document.querySelector<HTMLButtonElement>('#start-over')!;
const shareResult = document.querySelector<HTMLButtonElement>('#share-result')!;
const shareMessage = document.querySelector<HTMLParagraphElement>('#share-message')!;
const manualRestaurant = document.querySelector<HTMLInputElement>('#manual-restaurant')!;
const manualItems = document.querySelector<HTMLDivElement>('#manual-items')!;
const manualAddItem = document.querySelector<HTMLButtonElement>('#manual-add-item')!;
const manualService = document.querySelector<HTMLInputElement>('#manual-service')!;
const manualTax = document.querySelector<HTMLInputElement>('#manual-tax')!;
const manualDiscount = document.querySelector<HTMLInputElement>('#manual-discount')!;
const manualRounding = document.querySelector<HTMLInputElement>('#manual-rounding')!;
const manualCalculated = document.querySelector<HTMLDivElement>('#manual-calculated')!;
const manualContinue = document.querySelector<HTMLButtonElement>('#manual-continue')!;
const historyBack = document.querySelector<HTMLButtonElement>('#history-back')!;
const historyStatus = document.querySelector<HTMLDivElement>('#history-status')!;
const historyList = document.querySelector<HTMLDivElement>('#history-list')!;

const input = document.querySelector<HTMLInputElement>('#receipt-input')!;
const uploadInput = document.querySelector<HTMLInputElement>('#upload-input')!;
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
const reviewHealth = document.querySelector<HTMLDivElement>('#review-health')!;
const editingBanner = document.querySelector<HTMLDivElement>('#editing-banner')!;
const undoButton = document.querySelector<HTMLButtonElement>('#undo-mapping')!;
const clearButton = document.querySelector<HTMLButtonElement>('#clear-field')!;
const rawDetections = document.querySelector<HTMLDetailsElement>('#raw-detections')!;
const saveHistoryButton = document.querySelector<HTMLButtonElement>('#save-history')!;
const saveMessage = document.querySelector<HTMLParagraphElement>('#save-message')!;

let prepared: PreparedImage | null = null;
let controller: AbortController | null = null;
let currentResult: ReceiptOcrResponse | null = null;
let reviewModel: ReviewModel | null = null;
let activeTarget: TargetKey | null = null;
let mappingHistory: ReviewModel[] = [];
let currentIdentity: AuthIdentity | null = null;
let currentHistoryId: string | null = null;
let currentHistoryImage: Pick<ReceiptHistoryRecord, 'receiptImagePath' | 'receiptImageUrl'> | undefined;
type Person = { id: string; name: string };
let people: Person[] = [];
let assignments = new Map<string, Set<string>>();
let currentStep = 1;
let manualMode = false;
let scanProgressTimer: number | null = null;

function beginFlow(): void {
  hero.classList.add('hidden');
  scannerSection.classList.remove('hidden');
  goToStep(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToStep(step: number): void {
  currentStep = step;
  receiptStep.classList.toggle('hidden', step !== 1 && step !== 2);
  peopleStep.classList.toggle('hidden', step !== 3);
  splitStep.classList.toggle('hidden', step !== 4);
  finalStep.classList.toggle('hidden', step !== 5);
  manualStep.classList.toggle('hidden', !manualMode || step !== 2);
  if (manualMode && step === 2) receiptStep.classList.add('hidden');
  scannerSection.dataset.step = String(step);
  for (const button of wizard.querySelectorAll<HTMLButtonElement>('[data-step]')) {
    const buttonStep = Number(button.dataset.step);
    button.classList.toggle('active', buttonStep === step);
    button.classList.toggle('complete', buttonStep < step);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function beginManualFlow(): void {
  beginFlow();
  manualMode = true;
  addManualItem();
  goToStep(2);
}

function reset(): void {
  controller?.abort();
  stopScanProgress();
  if (prepared) URL.revokeObjectURL(prepared.previewUrl);
  prepared = null;
  input.value = '';
  uploadInput.value = '';
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
  currentHistoryId = null;
  currentHistoryImage = undefined;
  saveMessage.textContent = '';
  people = [];
  peopleFeedback.textContent = '';
  assignments = new Map();
  manualMode = false;
  manualItems.replaceChildren();
  manualRestaurant.value = '';
  manualService.value = '0.00';
  manualTax.value = '0.00';
  manualDiscount.value = '0.00';
  manualRounding.value = '0.00';
  renderPeople();
  goToStep(1);
}

function renderResult(result: ReceiptOcrResponse, restoredReview?: ReviewModel): void {
  const incompleteItems = result.parsed.items.filter((item) => item.needsReview || item.totalCents === null).length;
  status.textContent = result.needsReview
    ? incompleteItems > 0
      ? `Scan complete — please check ${incompleteItems} ${incompleteItems === 1 ? 'item' : 'items'}. Tap a field, then tap the correct receipt text.`
      : 'Scan complete — please check the highlighted totals before continuing.'
    : `Receipt ready — ${result.parsed.items.length} ${result.parsed.items.length === 1 ? 'item' : 'items'} found.`;
  status.className = `status ${result.needsReview ? 'warning' : 'success'}`;
  summary.classList.remove('hidden');
  summary.innerHTML = `<strong>${result.parsed.items.length} items found · ${result.ocr.detections.length} selectable receipt fields</strong><span>${Math.round(result.ocr.confidence * 100)}% scan confidence · ${Math.round(result.timingsMs.total ?? 0)} ms${result.cacheHit ? ' · reused recent scan' : ''}</span>`;
  boxes.replaceChildren();
  detections.replaceChildren();
  currentResult = result;
  reviewModel = restoredReview ? cloneReviewModel(restoredReview) : createReviewModel(result);
  activeTarget = null;
  mappingHistory = [];
  review.classList.remove('hidden');
  rawDetections.classList.remove('hidden');
  saveHistoryButton.classList.toggle('hidden', currentIdentity?.mode !== 'authenticated');

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
  goToStep(2);
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
  const issues = reviewIssues(reviewModel);
  reviewHealth.className = `review-health ${issues.length ? 'needs-attention' : 'ready'}`;
  reviewHealth.innerHTML = issues.length
    ? `<strong>${issues.length} ${issues.length === 1 ? 'check' : 'checks'} remaining</strong><span>${escapeHtml(issues.slice(0, 3).join(' · '))}${issues.length > 3 ? ` · +${issues.length - 3} more` : ''}</span>`
    : '<strong>Ready to continue ✓</strong><span>Items and receipt total are complete.</span>';
  confirmReviewButton.textContent = issues.length ? `Continue after review (${issues.length}) →` : 'Confirm receipt →';
  editingBanner.innerHTML = activeTarget
    ? `<strong>EDITING</strong><span>${escapeHtml(targetLabel(activeTarget, reviewModel))}</span><small>Tap an OCR box on the receipt${activeTarget.endsWith(':foodName') ? ' · tap more boxes to combine the name' : ''}</small>`
    : '<span>Select a field, then tap OCR text on the receipt</span>';
  undoButton.disabled = mappingHistory.length === 0;
  clearButton.disabled = activeTarget === null;
  updateBoxStates();
}

function reviewIssues(model: ReviewModel): string[] {
  const issues: string[] = [];
  model.items.forEach((item, index) => {
    const label = `Item ${String(index + 1).padStart(2, '0')}`;
    if (!item.name.trim()) issues.push(`${label}: food name`);
    if (item.totalCents === null) issues.push(`${label}: total`);
    if (item.validation.valid === false) issues.push(`${label}: maths`);
  });
  if (model.items.length === 0) issues.push('No items found');
  if (model.summary.grandTotal.valueCents === null) issues.push('Grand total');
  if (model.validation.grandTotalValid === false) issues.push('Receipt total does not balance');
  return issues;
}

async function showHistory(): Promise<void> {
  scanView.classList.add('hidden');
  historyView.classList.remove('hidden');
  if (currentIdentity?.mode !== 'authenticated') {
    historyList.replaceChildren();
    historyStatus.textContent = 'No saved receipts yet.';
    return;
  }
  historyStatus.textContent = 'Loading your receipts…';
  historyList.replaceChildren();
  try {
    const records = await listReceiptHistory(currentIdentity.uid);
    historyStatus.textContent = records.length ? '' : 'No saved receipts yet.';
    historyList.innerHTML = records.map((record) => `<article class="history-card" data-history-id="${escapeHtml(record.id)}">
      <div><strong>${escapeHtml(record.restaurant)}</strong><span>${record.updatedAt ? record.updatedAt.toLocaleString() : 'Saved receipt'}</span></div>
      <div class="history-amount">${formatMoney(record.grandTotalCents)}</div>
      <button data-action="open" type="button">View receipt</button>
      <button data-action="delete" class="danger-link" type="button">Delete</button>
    </article>`).join('');
  } catch (error) {
    historyStatus.textContent = friendlyHistoryError(error);
  }
}

async function openHistoryReceipt(id: string): Promise<void> {
  if (currentIdentity?.mode !== 'authenticated') return;
  historyStatus.textContent = 'Opening receipt…';
  const record = await getReceiptHistory(currentIdentity.uid, id);
  reset();
  currentHistoryId = record.id;
  currentHistoryImage = { receiptImagePath: record.receiptImagePath, receiptImageUrl: record.receiptImageUrl };
  preview.src = record.receiptImageUrl;
  dropzone.classList.add('hidden');
  workspace.classList.remove('hidden');
  scanView.classList.remove('hidden');
  historyView.classList.add('hidden');
  renderResult(record.ocrResult, record.ocrMappings);
  saveMessage.textContent = 'Opened from History. Saving will update this receipt.';
  review.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function removeHistoryReceipt(id: string): Promise<void> {
  if (currentIdentity?.mode !== 'authenticated') return;
  const record = await getReceiptHistory(currentIdentity.uid, id);
  if (!window.confirm(`Delete “${record.restaurant}” permanently?`)) return;
  await deleteReceiptHistory(currentIdentity.uid, record);
  if (currentHistoryId === id) reset();
  await showHistory();
}

function friendlyHistoryError(error: unknown): string {
  if (error instanceof Error && error.message.includes('index')) return 'History needs the Firestore index described in the setup instructions.';
  if (error instanceof Error && error.message.includes('permission')) return 'History access was denied. Check the Firestore and Storage security rules.';
  return error instanceof Error ? error.message : 'Could not load receipt history.';
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

function addManualItem(): void {
  const id = crypto.randomUUID();
  const row = document.createElement('article');
  row.className = 'manual-item';
  row.dataset.manualItemId = id;
  row.innerHTML = `<label class="manual-name">Food name<input data-field="name" placeholder="e.g. Chicken rice"></label>
    <label>Quantity<input data-field="quantity" type="number" min="0.01" step="any" value="1"></label>
    <label>Unit price<input data-field="unitPrice" type="number" min="0" step="0.01" placeholder="0.00"></label>
    <label>Total<input data-field="total" type="number" min="0" step="0.01" placeholder="0.00"></label>
    <button type="button" data-remove-manual aria-label="Delete item">Delete</button>`;
  manualItems.append(row);
  updateManualTotal();
}

function moneyInputCents(input: HTMLInputElement): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function updateManualTotal(): void {
  const itemSubtotal = [...manualItems.querySelectorAll<HTMLElement>('[data-manual-item-id]')].reduce((sum, row) => {
    const quantity = Number(row.querySelector<HTMLInputElement>('[data-field="quantity"]')?.value ?? 0);
    const unit = moneyInputCents(row.querySelector<HTMLInputElement>('[data-field="unitPrice"]')!);
    const totalInput = row.querySelector<HTMLInputElement>('[data-field="total"]')!;
    const total = totalInput.value === '' ? Math.round(quantity * unit) : moneyInputCents(totalInput);
    return sum + total;
  }, 0);
  const grand = itemSubtotal + moneyInputCents(manualService) + moneyInputCents(manualTax)
    - moneyInputCents(manualDiscount) + moneyInputCents(manualRounding);
  manualCalculated.innerHTML = `<span>Calculated bill total</span><strong>${formatMoney(grand)}</strong>`;
}

function confirmManualReceipt(): void {
  const rows = [...manualItems.querySelectorAll<HTMLElement>('[data-manual-item-id]')];
  const items = rows.map((row, index) => {
    const name = row.querySelector<HTMLInputElement>('[data-field="name"]')?.value.trim() ?? '';
    const quantity = Number(row.querySelector<HTMLInputElement>('[data-field="quantity"]')?.value ?? 0);
    const unitPriceCents = moneyInputCents(row.querySelector<HTMLInputElement>('[data-field="unitPrice"]')!);
    const totalInput = row.querySelector<HTMLInputElement>('[data-field="total"]')!;
    const totalCents = totalInput.value === '' ? Math.round(quantity * unitPriceCents) : moneyInputCents(totalInput);
    return {
      id: row.dataset.manualItemId ?? `manual_${index + 1}`,
      name,
      quantity,
      unitPriceCents,
      totalCents,
      mappings: { foodName: { ocrIds: [] }, quantity: { ocrIds: [] }, unitPrice: { ocrIds: [] }, total: { ocrIds: [] } },
      validation: { checked: true, valid: Math.abs(quantity * unitPriceCents - totalCents) <= 1, differenceCents: quantity * unitPriceCents - totalCents },
    };
  }).filter((item) => item.name && item.quantity > 0);
  if (!items.length) { manualCalculated.textContent = 'Add at least one item with a name and quantity.'; return; }
  const subtotal = items.reduce((sum, item) => sum + item.totalCents, 0);
  const service = moneyInputCents(manualService);
  const tax = moneyInputCents(manualTax);
  const discount = moneyInputCents(manualDiscount);
  const rounding = moneyInputCents(manualRounding);
  const grand = subtotal + service + tax - discount + rounding;
  reviewModel = {
    items,
    summary: {
      subtotal: { valueCents: subtotal, mapping: { ocrIds: [] } },
      serviceCharge: { valueCents: service, mapping: { ocrIds: [] } },
      tax: { valueCents: tax, mapping: { ocrIds: [] } },
      discount: { valueCents: discount, mapping: { ocrIds: [] } },
      rounding: { valueCents: rounding, mapping: { ocrIds: [] } },
      grandTotal: { valueCents: grand, mapping: { ocrIds: [] } },
    },
    validation: { itemArithmeticValid: items.every((item) => item.validation.valid), subtotalValid: true, grandTotalValid: true, needsReview: items.some((item) => !item.validation.valid) },
  };
  currentResult = { parsed: { restaurantName: { value: manualRestaurant.value.trim() || 'Manual receipt' } } } as ReceiptOcrResponse;
  goToStep(3);
}

function renderPeople(): void {
  peopleList.innerHTML = people.length
    ? people.map((person, index) => `<div class="person-row" data-person-id="${person.id}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(person.name)}</strong><button type="button" aria-label="Remove ${escapeHtml(person.name)}">Remove</button></div>`).join('')
    : '<div class="friendly-empty"><strong>No one added yet</strong><span>Add yourself first, then everyone sharing the bill.</span></div>';
  peopleContinue.disabled = people.length === 0;
  peopleContinue.textContent = people.length ? `Continue with ${people.length} ${people.length === 1 ? 'person' : 'people'} →` : 'Add at least one person';
}

function renderAssignments(): void {
  if (!reviewModel) return;
  assignmentList.innerHTML = reviewModel.items.map((item, index) => {
    const selected = assignments.get(item.id) ?? new Set<string>();
    return `<article class="assignment-card"><div><small>ITEM ${String(index + 1).padStart(2, '0')}</small><strong>${escapeHtml(item.name || 'Unnamed item')}</strong><span>${formatMoney(item.totalCents)}</span></div><div class="person-options">${people.map((person) => `<label><input type="checkbox" data-item-id="${item.id}" data-person-id="${person.id}" ${selected.has(person.id) ? 'checked' : ''}><span>${escapeHtml(person.name)}</span></label>`).join('')}</div></article>`;
  }).join('');
  updateAssignmentProgress();
}

function updateAssignmentProgress(): void {
  if (!reviewModel) return;
  const assigned = reviewModel.items.filter((item) => (assignments.get(item.id)?.size ?? 0) > 0).length;
  const total = reviewModel.items.length;
  const remaining = total - assigned;
  assignmentProgress.className = `assignment-progress ${remaining === 0 ? 'ready' : ''}`;
  assignmentProgress.innerHTML = `<strong>${assigned} of ${total} items assigned</strong><span>${remaining === 0 ? 'Everyone’s items are covered ✓' : `${remaining} ${remaining === 1 ? 'item still needs' : 'items still need'} someone`}</span><i style="--progress:${total ? assigned / total * 100 : 0}%"></i>`;
  splitContinue.textContent = remaining === 0 ? 'Review summary →' : `Review with ${remaining} unassigned →`;
}

function calculateShares(): Array<Person & { amountCents: number }> {
  const shares = new Map(people.map((person) => [person.id, 0]));
  if (!reviewModel || people.length === 0) return people.map((person) => ({ ...person, amountCents: 0 }));
  for (const item of reviewModel.items) {
    const owners = [...(assignments.get(item.id) ?? [])];
    if (!owners.length || item.totalCents === null) continue;
    const base = Math.floor(item.totalCents / owners.length);
    let remainder = item.totalCents - base * owners.length;
    owners.forEach((personId) => {
      shares.set(personId, (shares.get(personId) ?? 0) + base + (remainder-- > 0 ? 1 : 0));
    });
  }
  const foodAllocated = [...shares.values()].reduce((sum, value) => sum + value, 0);
  const grandTotal = reviewModel.summary.grandTotal.valueCents ?? foodAllocated;
  let extras = grandTotal - foodAllocated;
  if (extras !== 0) {
    const weights = people.map((person) => shares.get(person.id) ?? 0);
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const denominator = weightTotal || people.length;
    people.forEach((person, index) => {
      const weight = weightTotal ? weights[index] ?? 0 : 1;
      const portion = index === people.length - 1 ? extras : Math.round((grandTotal - foodAllocated) * weight / denominator);
      shares.set(person.id, (shares.get(person.id) ?? 0) + portion);
      extras -= portion;
    });
  }
  return people.map((person) => ({ ...person, amountCents: shares.get(person.id) ?? 0 }));
}

function renderFinalSummary(): void {
  if (!reviewModel || !currentResult) return;
  const shares = calculateShares();
  const grand = reviewModel.summary.grandTotal.valueCents ?? shares.reduce((sum, person) => sum + person.amountCents, 0);
  const allocated = shares.reduce((sum, person) => sum + person.amountCents, 0);
  finalRestaurant.textContent = currentResult.parsed.restaurantName.value || 'Receipt';
  finalTotal.innerHTML = `<span>Everyone’s share, sorted.</span><strong>${formatMoney(grand)}</strong><small>${people.length} people · ${reviewModel.items.length} items</small>`;
  personTotals.innerHTML = shares.map((person) => `<article><span>${escapeHtml(person.name.charAt(0).toUpperCase())}</span><strong>${escapeHtml(person.name)}</strong><b>${formatMoney(person.amountCents)}</b></article>`).join('');
  allocationCheck.innerHTML = `<div><span>Bill total</span><strong>${formatMoney(grand)}</strong></div><div><span>Allocated</span><strong>${formatMoney(allocated)}</strong></div><div class="${allocated === grand ? 'balanced' : 'unbalanced'}"><span>${allocated === grand ? '✓ Difference' : '△ Difference'}</span><strong>${formatMoney(grand - allocated)}</strong></div>`;
}

function buildShareText(): string {
  if (!reviewModel || !currentResult) return '';
  const shares = calculateShares();
  const grand = reviewModel.summary.grandTotal.valueCents ?? shares.reduce((sum, person) => sum + person.amountCents, 0);
  const restaurant = currentResult.parsed.restaurantName.value || 'FastSplit bill';
  return [
    `FastSplit · ${restaurant}`,
    `Bill total: ${formatMoney(grand)}`,
    '',
    ...shares.flatMap((person) => {
      const itemNames = reviewModel?.items
        .filter((item) => assignments.get(item.id)?.has(person.id))
        .map((item) => item.name || 'Unnamed item') ?? [];
      return [
        `${person.name}: ${formatMoney(person.amountCents)}`,
        ...(itemNames.length ? [`  ${itemNames.join(' · ')}`] : ['  No items assigned']),
      ];
    }),
    '',
    'Split fairly with FastSplit.',
  ].join('\n');
}

async function shareBillResult(): Promise<void> {
  const text = buildShareText();
  if (!text) return;
  shareMessage.textContent = '';
  try {
    if (navigator.share) {
      await navigator.share({ title: 'FastSplit bill', text });
      shareMessage.textContent = 'Share sheet opened.';
    } else {
      await navigator.clipboard.writeText(text);
      shareMessage.textContent = 'Bill copied as text. Paste it into WhatsApp or your messaging app.';
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    try {
      await navigator.clipboard.writeText(text);
      shareMessage.textContent = 'Bill copied as text. Paste it into WhatsApp or your messaging app.';
    } catch {
      shareMessage.textContent = 'Could not open sharing. Please try again.';
    }
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

async function prepareSelectedReceipt(file: File): Promise<void> {
  beginFlow();
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
}

function startScanProgress(): void {
  stopScanProgress();
  const messages = [
    'Uploading receipt securely…',
    'Reading printed text and prices…',
    'Reconstructing receipt rows…',
    'Checking items against the totals…',
  ];
  let index = 0;
  status.textContent = messages[index] ?? 'Reading receipt…';
  scanProgressTimer = window.setInterval(() => {
    index = Math.min(index + 1, messages.length - 1);
    status.textContent = messages[index] ?? 'Reading receipt…';
  }, 1400);
}

function stopScanProgress(): void {
  if (scanProgressTimer !== null) window.clearInterval(scanProgressTimer);
  scanProgressTimer = null;
}

input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) void prepareSelectedReceipt(file);
});
uploadInput.addEventListener('change', () => {
  const file = uploadInput.files?.[0];
  if (file) void prepareSelectedReceipt(file);
});

scanButton.addEventListener('click', async () => {
  if (!prepared) return;
  controller = new AbortController();
  scanButton.disabled = true;
  scanButton.textContent = 'Reading receipt…';
  status.className = 'status loading';
  startScanProgress();
  try {
    renderResult(await scanReceipt(prepared.blob, controller.signal));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    status.className = 'status error';
    status.textContent = error instanceof Error ? error.message : 'Could not read this receipt clearly.';
  } finally {
    stopScanProgress();
    scanButton.disabled = false;
    scanButton.textContent = 'Read receipt';
    controller = null;
  }
});

saveHistoryButton.addEventListener('click', async () => {
  if (currentIdentity?.mode !== 'authenticated' || !currentResult || !reviewModel) return;
  saveHistoryButton.disabled = true;
  saveMessage.textContent = currentHistoryId ? 'Updating receipt…' : 'Saving receipt and image…';
  try {
    const fullRecord = createHistoryRecord(currentIdentity.uid, currentResult, reviewModel, '', '');
    const { receiptImagePath, receiptImageUrl, ...record } = fullRecord;
    void receiptImagePath;
    void receiptImageUrl;
    currentHistoryId = await saveReceiptHistory(
      currentIdentity.uid,
      prepared?.blob ?? null,
      record,
      currentHistoryId,
      currentHistoryImage,
    );
    if (!currentHistoryImage) {
      const saved = await getReceiptHistory(currentIdentity.uid, currentHistoryId);
      currentHistoryImage = { receiptImagePath: saved.receiptImagePath, receiptImageUrl: saved.receiptImageUrl };
    }
    saveMessage.textContent = 'Saved permanently to History.';
  } catch (error) {
    saveMessage.textContent = friendlyHistoryError(error);
  } finally {
    saveHistoryButton.disabled = false;
  }
});

historyNav.addEventListener('click', () => void showHistory());
splitNav.addEventListener('click', beginFlow);
scanHero.addEventListener('click', () => { beginFlow(); input.click(); });
uploadHero.addEventListener('click', () => { beginFlow(); uploadInput.click(); });
manualHero.addEventListener('click', beginManualFlow);
scannerBack.addEventListener('click', () => {
  if (currentStep > 1) goToStep(currentStep - 1);
  else { scannerSection.classList.add('hidden'); hero.classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});
historyBack.addEventListener('click', () => {
  historyView.classList.add('hidden');
  scanView.classList.remove('hidden');
});
historyList.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  const id = button?.closest<HTMLElement>('[data-history-id]')?.dataset.historyId;
  if (!button || !id) return;
  const operation = button.dataset.action === 'delete' ? removeHistoryReceipt(id) : openHistoryReceipt(id);
  operation.catch((error) => { historyStatus.textContent = friendlyHistoryError(error); });
});

confirmReviewButton.addEventListener('click', () => goToStep(3));
peopleForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = personName.value.trim();
  if (!name) return;
  if (people.some((person) => person.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) {
    peopleFeedback.textContent = `${name} is already on the list.`;
    personName.select();
    return;
  }
  people.push({ id: crypto.randomUUID(), name });
  peopleFeedback.textContent = `${name} added.`;
  personName.value = '';
  renderPeople();
  personName.focus();
});
peopleList.addEventListener('click', (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-person-id]');
  if (!(event.target instanceof HTMLButtonElement) || !row?.dataset.personId) return;
  const id = row.dataset.personId;
  people = people.filter((person) => person.id !== id);
  for (const selected of assignments.values()) selected.delete(id);
  renderPeople();
});
peopleContinue.addEventListener('click', () => { renderAssignments(); goToStep(4); });
assignmentList.addEventListener('change', (event) => {
  const checkbox = event.target as HTMLInputElement;
  const itemId = checkbox.dataset.itemId;
  const personId = checkbox.dataset.personId;
  if (!itemId || !personId) return;
  const selected = assignments.get(itemId) ?? new Set<string>();
  if (checkbox.checked) selected.add(personId); else selected.delete(personId);
  assignments.set(itemId, selected);
  updateAssignmentProgress();
});
splitContinue.addEventListener('click', () => {
  const missing = reviewModel?.items.some((item) => (assignments.get(item.id)?.size ?? 0) === 0);
  if (missing && !window.confirm('Some items are not assigned. Continue anyway?')) return;
  renderFinalSummary();
  goToStep(5);
});
startOver.addEventListener('click', () => { reset(); scannerSection.classList.add('hidden'); hero.classList.remove('hidden'); });
shareResult.addEventListener('click', () => void shareBillResult());
wizard.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-step]');
  const target = Number(button?.dataset.step ?? 0);
  if (target > 0 && target < currentStep) goToStep(target);
});
manualAddItem.addEventListener('click', addManualItem);
manualItems.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('[data-remove-manual]');
  if (!button) return;
  button.closest('[data-manual-item-id]')?.remove();
  if (!manualItems.children.length) addManualItem();
  updateManualTotal();
});
manualItems.addEventListener('input', updateManualTotal);
for (const inputElement of [manualService, manualTax, manualDiscount, manualRounding]) inputElement.addEventListener('input', updateManualTotal);
manualContinue.addEventListener('click', confirmManualReceipt);

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

function enterApplication(identity: AuthIdentity): void {
  currentIdentity = identity;
  authGate.classList.add('hidden');
  appMain.classList.remove('auth-hidden');
  appFooter.classList.remove('auth-hidden');
  accountChip.classList.toggle('hidden', identity.mode === 'guest');
  const name = identity.displayName || identity.email || (identity.mode === 'guest' ? 'Guest' : 'Account');
  accountName.textContent = identity.mode === 'guest' ? 'Guest Mode' : name;
  accountAvatar.textContent = name.trim().charAt(0).toUpperCase() || 'F';
  accountChip.dataset.mode = identity.mode;
  historyNav.classList.remove('hidden');
  saveHistoryButton.classList.toggle('hidden', identity.mode !== 'authenticated' || !reviewModel);
}

function showAuthentication(): void {
  currentIdentity = null;
  authGate.classList.remove('hidden');
  appMain.classList.add('auth-hidden');
  appFooter.classList.add('auth-hidden');
  accountChip.classList.add('hidden');
  historyNav.classList.add('hidden');
  authMessage.textContent = firebaseConfigured
    ? ''
    : 'Google sign-in needs the Firebase web configuration. Guest Mode is ready.';
  googleLoginButton.disabled = !firebaseConfigured;
}

googleLoginButton.addEventListener('click', async () => {
  authMessage.textContent = 'Opening Google sign-in…';
  googleLoginButton.disabled = true;
  try {
    clearGuestMode(localStorage);
    const user = await signInWithGoogle();
    enterApplication(authenticatedIdentity(user));
    authMessage.textContent = '';
  } catch (error) {
    authMessage.textContent = friendlyAuthError(error);
  } finally {
    googleLoginButton.disabled = !firebaseConfigured;
  }
});

guestLoginButton.addEventListener('click', () => {
  authMessage.textContent = '';
  enterApplication(enableGuestMode(localStorage));
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    clearGuestMode(localStorage);
    if (currentIdentity?.mode === 'authenticated') await logoutFirebase();
    reset();
    showAuthentication();
  } finally {
    logoutButton.disabled = false;
  }
});

// FastSplit now opens directly without an authentication gate.
enterApplication(enableGuestMode(localStorage));

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
    </section>
    <section class="scanner" aria-labelledby="scan-title">
      <button id="scanner-back" class="history-back" type="button">‹&nbsp; Back</button>
      <p class="step">BRING THE BILL</p>
      <div class="section-heading"><div><h2 id="scan-title">Scan your receipt</h2><p class="scanner-copy">Keep the whole receipt in frame, with readable prices.</p></div><span class="privacy">Processed privately</span></div>
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
            <button id="save-history" class="primary history-save hidden" type="button">Save to History</button>
            <p id="save-message" class="save-message" aria-live="polite"></p>
          </section>
          <details id="raw-detections" class="raw-detections hidden"><summary>Detected OCR text</summary><ol id="detections" class="detections"></ol></details>
        </div>
      </div>
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
const historyBack = document.querySelector<HTMLButtonElement>('#history-back')!;
const historyStatus = document.querySelector<HTMLDivElement>('#history-status')!;
const historyList = document.querySelector<HTMLDivElement>('#history-list')!;

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
  currentHistoryId = null;
  currentHistoryImage = undefined;
  saveMessage.textContent = '';
}

function renderResult(result: ReceiptOcrResponse, restoredReview?: ReviewModel): void {
  status.textContent = result.needsReview ? 'Review recommended' : 'Receipt read successfully';
  status.className = `status ${result.needsReview ? 'warning' : 'success'}`;
  summary.classList.remove('hidden');
  summary.innerHTML = `<strong>${result.ocr.detections.length} text regions</strong><span>${Math.round(result.ocr.confidence * 100)}% confidence · Pass ${result.ocr.passUsed} · ${Math.round(result.timingsMs.total ?? 0)} ms${result.cacheHit ? ' · cached' : ''}</span>`;
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
splitNav.addEventListener('click', () => scannerSection.scrollIntoView({ behavior: 'smooth' }));
scanHero.addEventListener('click', () => input.click());
uploadHero.addEventListener('click', () => input.click());
manualHero.addEventListener('click', () => scannerSection.scrollIntoView({ behavior: 'smooth' }));
scannerBack.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
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

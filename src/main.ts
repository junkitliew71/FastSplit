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
import { deleteLocalHistory, getLocalHistory, listLocalHistory, saveLocalHistory } from './local-history.ts';
import { deletePaymentQr, loadPaymentQr, savePaymentQr, type PaymentQrRecord } from './payment-qr.ts';
import { deletePaymentPhone, loadPaymentPhone, savePaymentPhone } from './payment-phone.ts';
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

const receiptLogo = `
  <span class="receipt-logo" aria-hidden="true"><img src="${import.meta.env.BASE_URL}fastsplit-icon.png" alt=""></span>`;

const cameraIcon = `
  <svg class="camera-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8.5 6.5 10 4.5h4l1.5 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3.5Z"/>
    <circle cx="12" cy="13" r="3.5"/>
  </svg>`;

const homeUrl = import.meta.env.BASE_URL;

app.innerHTML = `
  <section id="auth-gate" class="auth-gate hidden" aria-labelledby="auth-title">
    <div class="auth-card">
      <a class="brand auth-brand" href="${homeUrl}" aria-label="FastSplit home">${receiptLogo}<b>FastSplit</b></a>
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
    <a class="brand" href="${homeUrl}" aria-label="FastSplit home">${receiptLogo}<b>FastSplit</b></a>
    <div class="topbar-actions">
      <div class="lang" aria-label="Language"><button id="lang-en" class="active" type="button">EN</button><button id="lang-zh" type="button">中文</button></div>
      <button id="split-nav" class="header-link" type="button">Split a bill</button>
      <button id="history-nav" class="history-nav hidden" type="button">↶&nbsp; History</button>
      <div id="account-chip" class="account-chip hidden"><span id="account-avatar"></span><span id="account-name"></span><button id="logout-button" type="button">Log out</button></div>
    </div>
  </header>
  <main id="app-main">
    <div id="scan-view">
    <section class="hero">
      <span class="hero-aurora hero-aurora-one" aria-hidden="true"></span>
      <span class="hero-aurora hero-aurora-two" aria-hidden="true"></span>
      <div class="hero-grid" aria-hidden="true"></div>
      <div class="hero-copy">
        <p class="hero-overline"><span></span> THE BEAUTIFUL WAY TO SPLIT A BILL</p>
        <h1>Split the bill.<br><em>Pay for what you ate.</em></h1>
        <p class="intro">Add your receipt, choose who had what, and share the totals.</p>
        <div class="hero-actions">
          <button id="scan-hero" class="hero-primary" type="button">${cameraIcon}<span>Scan receipt</span><b aria-hidden="true">↗</b></button>
          <button id="upload-hero" class="hero-secondary" type="button">⇧&nbsp; Upload receipt</button>
        </div>
        <button id="manual-hero" class="manual-link" type="button">⌕&nbsp; Enter manually&nbsp; →</button>
        <div class="hero-proof" aria-label="FastSplit benefits">
          <span><b>✦ AI-powered</b><small>Reads every item</small></span>
          <span><b>♢ Private</b><small>Your bill stays yours</small></span>
          <span><b>✓ Exact</b><small>Every cent allocated</small></span>
        </div>
      </div>
      <div class="motion-stage" aria-label="Animated FastSplit preview">
        <span class="orbit orbit-outer" aria-hidden="true"><i></i><i></i></span>
        <span class="orbit orbit-inner" aria-hidden="true"></span>
        <article class="demo-phone">
          <div class="demo-status"><span>9:41</span><i></i><b>●●●</b></div>
          <div class="demo-head"><span class="demo-mark">${cameraIcon}</span><div><small>FASTSPLIT</small><b id="demo-title">Reading receipt</b></div><span class="demo-live"><i></i> LIVE</span></div>
          <div class="demo-screens">
            <section class="demo-screen active" data-demo-screen="receipt">
              <div class="demo-receipt"><div class="demo-merchant"><span>JS</span><div><b>Jatújak # Siam</b><small>Table 12 · 3 diners</small></div></div><p><span>Chicken Rice</span><b>18.90</b></p><p class="highlight"><span>Prawn Cake</span><b>32.00</b></p><p><span>Honey Lemon Soda</span><b>12.50</b></p><p class="muted"><span>Service + SST</span><b>19.65</b></p><div class="demo-total"><span>TOTAL</span><strong>RM183.35</strong></div><i class="scan-beam"></i></div>
              <div class="demo-progress"><i></i><small>Reading item 4 of 7</small></div>
            </section>
            <section class="demo-screen" data-demo-screen="assign">
              <div class="demo-dish"><small>CURRENT DISH · 05 / 07</small><span>🍤</span><h3>Prawn Cake</h3><strong>RM32.00</strong></div>
              <div class="demo-people"><p class="selected"><span>JK</span><b>Jun Kit</b><i>✓</i></p><p><span>KY</span><b>Kelly</b><i>＋</i></p><p><span>MW</span><b>Mei Wei</b><i>＋</i></p></div>
            </section>
            <section class="demo-screen" data-demo-screen="settle">
              <div class="demo-check">✓</div><small>BILL BALANCED</small><h3>Everyone’s square.</h3>
              <div class="demo-tng"><span>PAY TO · TNG</span><strong>012 345 6789</strong><b>Copy</b></div>
              <div class="demo-splits"><p><span>JK</span><b>RM61.20</b></p><p><span>KY</span><b>RM64.00</b></p><p><span>MW</span><b>RM58.15</b></p></div>
            </section>
          </div>
          <div class="demo-dock"><i class="active"></i><i></i><i></i></div>
        </article>
        <div class="float-card float-items"><span>✦</span><div><small>ITEMS FOUND</small><b>7 / 7</b></div></div>
        <div class="float-card float-total"><span>✓</span><div><small>TOTAL VERIFIED</small><b>RM183.35</b></div></div>
        <div class="float-card float-pay"><span>▣</span><div><small>PAYMENT READY</small><b>Touch ’n Go</b></div></div>
      </div>
      <details id="payment-qr-settings" class="payment-qr-settings">
        <summary><span class="payment-qr-symbol">▦</span><span><strong>Payment details</strong><small>Add your TNG number or payment QR to bill shares</small></span><b id="payment-qr-state">Set up →</b></summary>
        <div class="payment-qr-body">
          <div class="payment-phone-settings">
            <label for="payment-phone-input"><strong>TNG phone number</strong><span>Saved only on this device · added to the top of shared bills</span></label>
            <input id="payment-phone-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="e.g. 0123456789" maxlength="24" />
            <div class="payment-phone-actions"><button id="payment-phone-save" class="secondary" type="button">Save number</button><button id="payment-phone-delete" class="qr-delete hidden" type="button">Remove</button></div>
            <p id="payment-phone-feedback" class="save-message" aria-live="polite"></p>
          </div>
          <div class="payment-divider"><span>or use a QR image</span></div>
          <div id="payment-qr-empty" class="payment-qr-empty"><strong>Upload your payment QR</strong><span>DuitNow, bank or e-wallet QR · saved only on this device</span></div>
          <img id="payment-qr-preview" class="payment-qr-preview hidden" alt="Your payment QR code" />
          <input id="payment-qr-input" class="hidden" type="file" accept="image/png,image/jpeg,image/webp" />
          <div class="payment-qr-actions"><button id="payment-qr-upload" class="secondary" type="button">Upload QR image</button><button id="payment-qr-delete" class="qr-delete hidden" type="button">Remove</button></div>
          <p id="payment-qr-feedback" class="save-message" aria-live="polite"></p>
        </div>
      </details>
      <div class="how-it-works" aria-label="How FastSplit works">
        <div data-demo-target="receipt"><span>01</span><strong>Add receipt</strong><small>Take a photo or upload one</small></div>
        <div data-demo-target="assign"><span>02</span><strong>Add diners</strong><small>Add everyone sharing the bill</small></div>
        <div data-demo-target="settle"><span>03</span><strong>Share totals</strong><small>Send a clear text breakdown</small></div>
      </div>
    </section>
    <section class="scanner hidden" aria-labelledby="scan-title">
      <button id="scanner-back" class="history-back" type="button">‹&nbsp; Back</button>
      <nav id="wizard" class="wizard" aria-label="Bill steps">
        <button class="active" data-step="1" data-mobile-label="Scan" type="button"><span>1</span>Receipt</button>
        <button data-step="2" data-mobile-label="People" type="button"><span>2</span>People</button>
        <button data-step="3" data-mobile-label="Assign" type="button"><span>3</span>Split</button>
        <button data-step="4" data-mobile-label="Summary" type="button"><span>4</span>Summary</button>
      </nav>
      <div id="receipt-step" class="workflow-step">
      <p class="step">BRING THE BILL</p>
      <div class="section-heading"><div><h2 id="scan-title">Scan your receipt</h2><p class="scanner-copy">Keep the whole receipt in frame, with readable prices.</p></div><span class="privacy">Processed privately</span></div>
      <label class="dropzone" id="dropzone">
        <input id="receipt-input" type="file" accept="image/*" capture="environment" />
        <input id="upload-input" type="file" accept="image/*" />
        <span class="camera">${cameraIcon}</span><strong>Take a photo or choose a receipt</strong>
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
          <button id="scan-button" class="primary scan-button"><span class="scan-button-label">Read receipt</span><span class="scan-button-percent" aria-hidden="true"></span><i class="scan-button-progress" aria-hidden="true"></i></button>
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
        <label class="manual-restaurant"><span>Restaurant</span><input id="manual-restaurant" placeholder="Restaurant name"></label>
        <div id="manual-items" class="manual-items"></div>
        <button id="manual-add-item" class="secondary" type="button">＋ Add item</button>
        <div class="manual-totals">
          <label><span>Service charge</span><input id="manual-service" type="number" min="0" step="0.01" value="0.00"></label>
          <label><span>SST / GST</span><input id="manual-tax" type="number" min="0" step="0.01" value="0.00"></label>
          <label><span>Discount</span><input id="manual-discount" type="number" min="0" step="0.01" value="0.00"></label>
          <label><span>Rounding</span><input id="manual-rounding" type="number" step="0.01" value="0.00"></label>
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
        <section id="payment-qr-share" class="payment-qr-share hidden" aria-labelledby="payment-qr-share-title">
          <div><p class="step">PAYMENT</p><h3 id="payment-qr-share-title">Pay with TNG or QR</h3><strong id="payment-phone-share" class="payment-phone-share-value hidden"></strong><span id="payment-share-note">Payment details will be included when you share.</span></div>
          <img id="payment-qr-share-image" class="hidden" alt="Payment QR code" />
          <a id="payment-qr-download" class="qr-download" download="fastsplit-payment-qr.png">Save QR image</a>
        </section>
        <button id="share-result" class="primary share-result" type="button">⌯&nbsp; Share result</button>
        <p id="history-saved-message" class="save-message" aria-live="polite"></p>
        <p id="share-message" class="save-message" aria-live="polite"></p>
        <button id="start-over" class="primary" type="button">Split another bill</button>
      </section>
    </section>
    </div>
    <section id="history-view" class="history-view hidden" aria-labelledby="history-title">
      <button id="history-back" class="history-back" type="button">← Back to receipt</button>
      <p class="eyebrow">YOUR SAVED RECEIPTS</p>
      <h2 id="history-title">Receipt history</h2>
      <p id="history-description" class="intro">Records are kept on this browser for 72 hours, then deleted automatically.</p>
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
const historyDescription = document.querySelector<HTMLParagraphElement>('#history-description')!;
const historySavedMessage = document.querySelector<HTMLParagraphElement>('#history-saved-message')!;
const langEn = document.querySelector<HTMLButtonElement>('#lang-en')!;
const langZh = document.querySelector<HTMLButtonElement>('#lang-zh')!;
const paymentQrSettings = document.querySelector<HTMLDetailsElement>('#payment-qr-settings')!;
const paymentQrState = document.querySelector<HTMLElement>('#payment-qr-state')!;
const paymentQrEmpty = document.querySelector<HTMLElement>('#payment-qr-empty')!;
const paymentQrInput = document.querySelector<HTMLInputElement>('#payment-qr-input')!;
const paymentQrUpload = document.querySelector<HTMLButtonElement>('#payment-qr-upload')!;
const paymentQrDelete = document.querySelector<HTMLButtonElement>('#payment-qr-delete')!;
const paymentQrPreview = document.querySelector<HTMLImageElement>('#payment-qr-preview')!;
const paymentQrFeedback = document.querySelector<HTMLParagraphElement>('#payment-qr-feedback')!;
const paymentQrShare = document.querySelector<HTMLElement>('#payment-qr-share')!;
const paymentQrShareImage = document.querySelector<HTMLImageElement>('#payment-qr-share-image')!;
const paymentQrDownload = document.querySelector<HTMLAnchorElement>('#payment-qr-download')!;
const paymentPhoneInput = document.querySelector<HTMLInputElement>('#payment-phone-input')!;
const paymentPhoneSave = document.querySelector<HTMLButtonElement>('#payment-phone-save')!;
const paymentPhoneDelete = document.querySelector<HTMLButtonElement>('#payment-phone-delete')!;
const paymentPhoneFeedback = document.querySelector<HTMLParagraphElement>('#payment-phone-feedback')!;
const paymentPhoneShare = document.querySelector<HTMLElement>('#payment-phone-share')!;
const paymentShareNote = document.querySelector<HTMLElement>('#payment-share-note')!;

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

const demoScreens = Array.from(document.querySelectorAll<HTMLElement>('[data-demo-screen]'));
const demoTargets = Array.from(document.querySelectorAll<HTMLElement>('[data-demo-target]'));
const demoTitle = document.querySelector<HTMLElement>('#demo-title')!;
const demoDots = Array.from(document.querySelectorAll<HTMLElement>('.demo-dock i'));
const demoSteps = ['receipt', 'assign', 'settle'] as const;
const demoTitles = { receipt: 'Reading receipt', assign: 'Assigning dishes', settle: 'Ready to settle' };
let demoStepIndex = 0;
let demoTimer = 0;

function showDemoStep(step: typeof demoSteps[number]): void {
  demoStepIndex = demoSteps.indexOf(step);
  demoScreens.forEach((screen) => screen.classList.toggle('active', screen.dataset.demoScreen === step));
  demoTargets.forEach((target) => target.classList.toggle('demo-active', target.dataset.demoTarget === step));
  demoDots.forEach((dot, index) => dot.classList.toggle('active', index === demoStepIndex));
  demoTitle.textContent = demoTitles[step];
}

function restartDemo(): void {
  window.clearInterval(demoTimer);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  demoTimer = window.setInterval(() => showDemoStep(demoSteps[(demoStepIndex + 1) % demoSteps.length]!), 3100);
}

demoTargets.forEach((target) => target.addEventListener('click', () => {
  const step = target.dataset.demoTarget as typeof demoSteps[number];
  showDemoStep(step);
  restartDemo();
}));
showDemoStep('receipt');
restartDemo();

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
let scanProgress = 0;
let paymentQr: PaymentQrRecord | null = null;
let paymentQrObjectUrl = '';
let paymentPhone = '';
type Locale = 'en' | 'zh';
let locale: Locale = localStorage.getItem('fastsplit:language') === 'zh' ? 'zh' : 'en';

const copy = {
  en: {
    splitNav: 'Split a bill', history: '↶\u00a0 History', hero: 'Split the bill.<br><em>Pay for what you ate.</em>',
    intro: 'Add your receipt, choose who had what, and share the totals.', scan: 'Scan receipt', upload: '⇧\u00a0 Upload receipt', manual: '⌕\u00a0 Enter manually\u00a0 →',
    historyTitle: 'Receipt history', historyBack: '← Back to receipt', historyDescription: 'Records are kept on this browser for 72 hours, then deleted automatically.',
    emptyHistory: 'No saved receipts yet. Finish splitting a bill and it will appear here.', loadingHistory: 'Loading your receipts…', view: 'View receipt', remove: 'Delete',
    expires: 'Expires in', saved: 'Saved to History for 72 hours.', receipt: 'Receipt', review: 'Review', people: 'People', split: 'Split', summary: 'Summary',
  },
  zh: {
    splitNav: '分摊账单', history: '↶\u00a0 历史记录', hero: '轻松分账。<br><em>只付自己吃的。</em>',
    intro: '添加收据、选择每个人吃了什么，然后分享账单。', scan: '扫描收据', upload: '⇧\u00a0 上传收据', manual: '⌕\u00a0 手动输入\u00a0 →',
    historyTitle: '收据历史记录', historyBack: '← 返回账单', historyDescription: '记录会保存在这个浏览器 72 小时，之后自动删除。',
    emptyHistory: '还没有保存的收据。完成一次分账后，记录会出现在这里。', loadingHistory: '正在读取历史记录…', view: '查看账单', remove: '删除',
    expires: '剩余', saved: '已保存到历史记录，有效期 72 小时。', receipt: '收据', review: '检查', people: '人员', split: '分账', summary: '结果',
  },
} as const;

function c(key: keyof typeof copy.en): string {
  return copy[locale][key];
}

function applyLanguage(): void {
  const zh = locale === 'zh';
  const setText = (selector: string, en: string, chinese: string): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.textContent = zh ? chinese : en;
  };
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  langEn.classList.toggle('active', locale === 'en');
  langZh.classList.toggle('active', locale === 'zh');
  splitNav.textContent = c('splitNav');
  historyNav.innerHTML = c('history');
  hero.querySelector('h1')!.innerHTML = c('hero');
  document.querySelector<HTMLElement>('#auth-title')!.innerHTML = zh ? '一起分账。<br><em>轻松结清。</em>' : 'Split together.<br><em>Settle simply.</em>';
  hero.querySelector<HTMLParagraphElement>('.intro')!.textContent = c('intro');
  scanHero.innerHTML = `${cameraIcon}<span>${c('scan')}</span><b aria-hidden="true">↗</b>`;
  uploadHero.innerHTML = c('upload');
  manualHero.innerHTML = c('manual');
  historyBack.textContent = c('historyBack');
  document.querySelector<HTMLElement>('#history-title')!.textContent = c('historyTitle');
  historyDescription.textContent = c('historyDescription');
  const wizardLabels = [c('receipt'), c('people'), c('split'), c('summary')];
  const mobileLabels = zh ? ['扫描', '人员', '分配', '结果'] : ['Scan', 'People', 'Assign', 'Summary'];
  wizard.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button, index) => {
    const number = button.querySelector('span')?.outerHTML ?? `<span>${index + 1}</span>`;
    button.innerHTML = `${number}${wizardLabels[index] ?? ''}`;
    button.dataset.mobileLabel = mobileLabels[index] ?? '';
  });
  const staticCopy: Array<[string, string, string]> = [
    ['#auth-gate .eyebrow', 'WELCOME TO FASTSPLIT', '欢迎使用 FASTSPLIT'],
    ['#auth-gate .intro', 'Sign in to keep your account ready across devices, or continue as a guest to split a bill now.', '登录即可跨设备使用账户，或以访客身份立即开始分账。'],
    ['#google-login', 'Continue with Google', '使用 Google 继续'],
    ['#guest-login', 'Continue as Guest', '以访客身份继续'],
    ['#logout-button', 'Log out', '登出'],
    ['#payment-qr-settings summary strong', 'Payment details', '收款资料'],
    ['#payment-qr-settings summary small', 'Add your TNG number or payment QR to bill shares', '分享账单时附上 TNG 电话号码或收款码'],
    ['.payment-phone-settings label strong', 'TNG phone number', 'TNG 电话号码'],
    ['.payment-phone-settings label span', 'Saved only on this device · added to the top of shared bills', '仅保存在此设备 · 会显示在分享账单最上方'],
    ['#payment-phone-save', 'Save number', '保存号码'],
    ['#payment-phone-delete', 'Remove', '移除'],
    ['.payment-divider span', 'or use a QR image', '或者使用二维码图片'],
    ['#payment-qr-empty strong', 'Upload your payment QR', '上传你的收款二维码'],
    ['#payment-qr-empty span', 'DuitNow, bank or e-wallet QR · saved only on this device', '支持 DuitNow、银行或电子钱包二维码 · 仅保存在此设备'],
    ['.how-it-works > div:nth-child(1) strong', 'Add receipt', '添加收据'],
    ['.how-it-works > div:nth-child(1) small', 'Take a photo or upload one', '拍照或上传收据'],
    ['.how-it-works > div:nth-child(2) strong', 'Add diners', '添加用餐者'],
    ['.how-it-works > div:nth-child(2) small', 'Add everyone sharing the bill', '添加所有参与分账的人'],
    ['.how-it-works > div:nth-child(3) strong', 'Share totals', '分享金额'],
    ['.how-it-works > div:nth-child(3) small', 'Send a clear text breakdown', '发送清楚的文字账单明细'],
    ['#scanner-back', '‹  Back', '‹  返回'],
    ['#receipt-step > .step', 'BRING THE BILL', '添加账单'],
    ['#scan-title', 'Scan your receipt', '扫描收据'],
    ['#receipt-step .section-heading .scanner-copy', 'Keep the whole receipt in frame, with readable prices.', '请确保整张收据完整入镜，并能清楚看见价格。'],
    ['#receipt-step .privacy', 'Processed privately', '私密处理'],
    ['#dropzone strong', 'Take a photo or choose a receipt', '拍照或选择收据'],
    ['#dropzone > small', 'JPG, PNG, WebP · large photos are resized before upload', '支持 JPG、PNG、WebP · 大图会在上传前自动缩小'],
    ['.scan-tips span:nth-child(1)', '✓ Show all four receipt edges', '✓ 显示收据四个边角'],
    ['.scan-tips span:nth-child(2)', '✓ Avoid shadows and glare', '✓ 避免阴影和反光'],
    ['.scan-tips span:nth-child(3)', '✓ Keep prices sharp and readable', '✓ 确保价格清晰可读'],
    ['#scan-button .scan-button-label', 'Read receipt', '读取收据'],
    ['#cancel-button', 'Choose another', '选择其他收据'],
    ['#status', 'Ready to scan', '准备扫描'],
    ['#review .step', '02 · REVIEW RECEIPT', '02 · 检查收据'],
    ['#review-title', 'Check the receipt', '检查收据内容'],
    ['#editing-banner span', 'Select a field to correct', '选择要更正的字段'],
    ['#undo-mapping', 'Undo last mapping', '撤销上次配对'],
    ['#clear-field', 'Clear field', '清除字段'],
    ['#confirm-review', 'Confirm receipt →', '确认收据 →'],
    ['#save-history', 'Save to History', '保存到历史记录'],
    ['#raw-detections summary', 'Detected OCR text', '检测到的 OCR 文字'],
    ['#people-step > .step', 'WHO IS SHARING?', '谁一起分账？'],
    ['#people-step > h2', 'Add people', '添加人员'],
    ['#people-step > .scanner-copy', 'Add everyone at the table before assigning the food.', '分配餐点前，先添加所有一起用餐的人。'],
    ['#people-form button', '+ Add person', '+ 添加人员'],
    ['#manual-step > .step', 'ENTER THE BILL', '输入账单'],
    ['#manual-step > h2', 'Enter receipt manually', '手动输入收据'],
    ['#manual-step > .scanner-copy', 'Add each item exactly as it appears on the bill.', '按照账单内容逐项添加。'],
    ['.manual-restaurant > span', 'Restaurant', '餐厅'],
    ['.manual-totals label:nth-child(1) span', 'Service charge', '服务费'],
    ['.manual-totals label:nth-child(2) span', 'SST / GST', 'SST / GST 税费'],
    ['.manual-totals label:nth-child(3) span', 'Discount', '折扣'],
    ['.manual-totals label:nth-child(4) span', 'Rounding', '舍入调整'],
    ['#manual-add-item', '＋ Add item', '＋ 添加项目'],
    ['#manual-continue', 'Confirm receipt →', '确认收据 →'],
    ['#split-step > .step', 'WHO HAD WHAT?', '谁吃了什么？'],
    ['#split-step > h2', 'Split the items', '分配账单项目'],
    ['#split-step > .scanner-copy', 'Select one or more people for every item. Shared items are divided equally.', '为每个项目选择一人或多人，共享项目会平均分摊。'],
    ['#final-step > .step', 'ALL SQUARE', '账目结清'],
    ['#final-step > h2', 'Good food. Fair split.', '吃得开心，分得公平。'],
    ['#payment-qr-share .step', 'PAYMENT', '付款'],
    ['#payment-qr-share-title', 'Pay with TNG or QR', '使用 TNG 或二维码付款'],
    ['#payment-qr-download', 'Save QR image', '保存二维码图片'],
    ['#payment-qr-delete', 'Remove', '移除'],
    ['#start-over', 'Split another bill', '分摊另一张账单'],
    ['#history-view .eyebrow', 'YOUR SAVED RECEIPTS', '已保存的收据'],
    ['#app-footer span', 'Made for meals, not maths.', '专注聚餐，不为算数烦恼。'],
  ];
  staticCopy.forEach(([selector, en, chinese]) => setText(selector, en, chinese));
  personName.placeholder = zh ? '姓名' : 'Name';
  manualRestaurant.placeholder = zh ? '餐厅名称' : 'Restaurant name';
  paymentPhoneInput.placeholder = zh ? '例如：0123456789' : 'e.g. 0123456789';
  if (currentIdentity?.mode === 'guest') accountName.textContent = zh ? '访客模式' : 'Guest Mode';
  manualItems.querySelectorAll<HTMLElement>('.manual-item').forEach((row) => {
    const labels = row.querySelectorAll<HTMLLabelElement>('label');
    const names = zh ? ['餐点名称', '数量', '单价', '总计'] : ['Food name', 'Quantity', 'Unit price', 'Total'];
    labels.forEach((label, index) => { if (label.firstChild) label.firstChild.textContent = names[index] ?? ''; });
    const nameInput = row.querySelector<HTMLInputElement>('[data-field="name"]');
    if (nameInput) nameInput.placeholder = zh ? '例如：鸡饭' : 'e.g. Chicken rice';
    const remove = row.querySelector<HTMLButtonElement>('[data-remove-manual]');
    if (remove) { remove.textContent = zh ? '删除' : 'Delete'; remove.setAttribute('aria-label', zh ? '删除项目' : 'Delete item'); }
  });
  if (!historyView.classList.contains('hidden')) void showHistory();
  if (reviewModel) {
    if (currentResult) renderReview();
    renderPeople();
    if (currentStep === 3) renderAssignments();
    if (currentStep === 4) renderFinalSummary();
  }
  renderPaymentQr();
}

function setLanguage(next: Locale): void {
  locale = next;
  localStorage.setItem('fastsplit:language', next);
  applyLanguage();
}

function beginFlow(): void {
  hero.classList.add('hidden');
  scannerSection.classList.remove('hidden');
  goToStep(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToStep(step: number): void {
  currentStep = step;
  receiptStep.classList.toggle('hidden', step !== 1 || manualMode);
  peopleStep.classList.toggle('hidden', step !== 2);
  splitStep.classList.toggle('hidden', step !== 3);
  finalStep.classList.toggle('hidden', step !== 4);
  manualStep.classList.toggle('hidden', !manualMode || step !== 1);
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
  goToStep(1);
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
  historySavedMessage.textContent = '';
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
      ? (locale === 'zh' ? `扫描完成——请检查 ${incompleteItems} 个项目。点击字段后，再点击正确的收据文字。` : `Scan complete — please check ${incompleteItems} ${incompleteItems === 1 ? 'item' : 'items'}. Tap a field, then tap the correct receipt text.`)
      : (locale === 'zh' ? '扫描完成——继续前请检查标记的总额。' : 'Scan complete — please check the highlighted totals before continuing.')
    : (locale === 'zh' ? `收据已完成——找到 ${result.parsed.items.length} 个项目。` : `Receipt ready — ${result.parsed.items.length} ${result.parsed.items.length === 1 ? 'item' : 'items'} found.`);
  status.className = `status ${result.needsReview ? 'warning' : 'success'}`;
  summary.classList.remove('hidden');
  summary.innerHTML = locale === 'zh'
    ? `<strong>找到 ${result.parsed.items.length} 个项目 · ${result.ocr.detections.length} 个可选收据字段</strong><span>扫描置信度 ${Math.round(result.ocr.confidence * 100)}% · ${Math.round(result.timingsMs.total ?? 0)} ms${result.cacheHit ? ' · 使用近期扫描结果' : ''}</span>`
    : `<strong>${result.parsed.items.length} items found · ${result.ocr.detections.length} selectable receipt fields</strong><span>${Math.round(result.ocr.confidence * 100)}% scan confidence · ${Math.round(result.timingsMs.total ?? 0)} ms${result.cacheHit ? ' · reused recent scan' : ''}</span>`;
  boxes.replaceChildren();
  detections.replaceChildren();
  currentResult = result;
  reviewModel = restoredReview ? cloneReviewModel(restoredReview) : createReviewModel(result);
  activeTarget = null;
  mappingHistory = [];
  review.classList.add('hidden');
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
  goToStep(2);
}

function renderReview(): void {
  if (!reviewModel) return;
  const itemCards = reviewModel.items.map((item, index) => {
    const itemNumber = String(index + 1).padStart(2, '0');
    const fields: Array<[string, TargetKey]> = [
      [locale === 'zh' ? '餐点名称' : 'Food name', `item:${item.id}:foodName`],
      [locale === 'zh' ? '数量' : 'Quantity', `item:${item.id}:quantity`],
      [locale === 'zh' ? '单价' : 'Unit price', `item:${item.id}:unitPrice`],
      [locale === 'zh' ? '项目总额' : 'Item total', `item:${item.id}:total`],
    ];
    const validation = item.validation.checked
      ? `<span class="math-check ${item.validation.valid ? 'valid' : 'invalid'}">${item.quantity ?? '—'} × ${formatMoney(item.unitPriceCents)} ${item.validation.valid ? '=' : '≠'} ${formatMoney(item.totalCents)} ${item.validation.valid ? '✓' : `(${formatDifference(item.validation.differenceCents)})`}</span>`
      : `<span class="math-check pending">${locale === 'zh' ? '请填写数量、单价和总额' : 'Complete quantity, unit price and total'}</span>`;
    return `<article class="item-card">
      <div class="item-card-title"><strong>${locale === 'zh' ? '项目' : 'Item'} ${itemNumber}</strong>${validation}</div>
      <div class="field-grid">${fields.map(([label, target]) => mappingField(label, target)).join('')}</div>
    </article>`;
  }).join('');
  const summaryTargets: Array<[string, TargetKey]> = [
    [locale === 'zh' ? '小计' : 'Subtotal', 'summary:subtotal'], [locale === 'zh' ? '服务费' : 'Service charge', 'summary:serviceCharge'],
    ['SST / GST', 'summary:tax'], [locale === 'zh' ? '折扣' : 'Discount', 'summary:discount'],
    [locale === 'zh' ? '舍入调整' : 'Rounding', 'summary:rounding'], [locale === 'zh' ? '账单总额' : 'Grand total', 'summary:grandTotal'],
  ];
  const overall = reviewModel.validation;
  const overallText = overall.needsReview
    ? (locale === 'zh' ? '金额需要检查' : 'Amounts need review')
    : overall.subtotalValid === true && overall.grandTotalValid === true ? (locale === 'zh' ? '收据金额吻合 ✓' : 'Receipt balances ✓') : (locale === 'zh' ? '请填写总额以进行验证' : 'Complete totals to validate');
  reviewFields.innerHTML = `${itemCards}
    <article class="item-card totals-card"><div class="item-card-title"><strong>${locale === 'zh' ? '收据总额' : 'Receipt totals'}</strong><span class="math-check ${overall.needsReview ? 'invalid' : 'pending'}">${overallText}</span></div>
    <div class="field-grid">${summaryTargets.map(([label, target]) => mappingField(label, target)).join('')}</div></article>`;
  const issues = reviewIssues(reviewModel);
  reviewHealth.className = `review-health ${issues.length ? 'needs-attention' : 'ready'}`;
  reviewHealth.innerHTML = issues.length
    ? `<strong>${locale === 'zh' ? `还有 ${issues.length} 项需要检查` : `${issues.length} ${issues.length === 1 ? 'check' : 'checks'} remaining`}</strong><span>${escapeHtml(issues.slice(0, 3).join(' · '))}${issues.length > 3 ? ` · +${issues.length - 3} ${locale === 'zh' ? '项' : 'more'}` : ''}</span>`
    : (locale === 'zh' ? '<strong>可以继续 ✓</strong><span>项目和收据总额均已填写完成。</span>' : '<strong>Ready to continue ✓</strong><span>Items and receipt total are complete.</span>');
  confirmReviewButton.textContent = issues.length ? (locale === 'zh' ? `检查后继续（${issues.length}）→` : `Continue after review (${issues.length}) →`) : (locale === 'zh' ? '确认收据 →' : 'Confirm receipt →');
  editingBanner.innerHTML = activeTarget
    ? `<strong>${locale === 'zh' ? '正在编辑' : 'EDITING'}</strong><span>${escapeHtml(targetLabel(activeTarget, reviewModel))}</span><small>${locale === 'zh' ? '点击收据上的 OCR 方框' : 'Tap an OCR box on the receipt'}${activeTarget.endsWith(':foodName') ? (locale === 'zh' ? ' · 可点击多个方框组合名称' : ' · tap more boxes to combine the name') : ''}</small>`
    : (locale === 'zh' ? '<span>先选择字段，再点击收据上的 OCR 文字</span>' : '<span>Select a field, then tap OCR text on the receipt</span>');
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
  historyStatus.textContent = c('loadingHistory');
  historyList.replaceChildren();
  try {
    if (currentIdentity?.mode !== 'authenticated') {
      const records = listLocalHistory(localStorage);
      historyStatus.textContent = records.length ? '' : c('emptyHistory');
      historyList.innerHTML = records.map((record) => historyCard(record.id, record.restaurant, record.grandTotalCents, new Date(record.updatedAt), new Date(record.expiresAt))).join('');
      return;
    }
    const records = await listReceiptHistory(currentIdentity.uid);
    historyStatus.textContent = records.length ? '' : c('emptyHistory');
    historyList.innerHTML = records.map((record) => historyCard(record.id, record.restaurant, record.grandTotalCents, record.updatedAt, null)).join('');
  } catch (error) {
    historyStatus.textContent = friendlyHistoryError(error);
  }
}

function historyCard(id: string, restaurant: string, total: number | null, updatedAt: Date | null, expiresAt: Date | null): string {
  const savedText = updatedAt ? updatedAt.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-MY') : '';
  const expiryText = expiresAt ? `<span>${c('expires')} ${formatTimeRemaining(expiresAt.getTime() - Date.now())}</span>` : '';
  return `<article class="history-card" data-history-id="${escapeHtml(id)}">
    <div><strong>${escapeHtml(restaurant)}</strong><span>${escapeHtml(savedText)}</span>${expiryText}</div>
    <div class="history-amount">${formatMoney(total)}</div>
    <button data-action="open" type="button">${c('view')}</button>
    <button data-action="delete" class="danger-link" type="button">${c('remove')}</button>
  </article>`;
}

function formatTimeRemaining(milliseconds: number): string {
  const hours = Math.max(1, Math.ceil(milliseconds / 3_600_000));
  if (locale === 'zh') return hours >= 24 ? `${Math.ceil(hours / 24)} 天` : `${hours} 小时`;
  return hours >= 24 ? `${Math.ceil(hours / 24)}d` : `${hours}h`;
}

async function openHistoryReceipt(id: string): Promise<void> {
  if (currentIdentity?.mode !== 'authenticated') {
    const record = getLocalHistory(localStorage, id);
    if (!record) { await showHistory(); return; }
    reset();
    currentHistoryId = record.id;
    currentResult = structuredClone(record.ocrResult);
    reviewModel = cloneReviewModel(record.reviewModel);
    people = structuredClone(record.people);
    assignments = new Map(record.assignments.map((item) => [item.itemId, new Set(item.personIds)]));
    scanView.classList.remove('hidden');
    historyView.classList.add('hidden');
    hero.classList.add('hidden');
    scannerSection.classList.remove('hidden');
    renderFinalSummary();
    goToStep(4);
    historySavedMessage.textContent = locale === 'zh' ? '这是已保存的分账记录。' : 'Viewing a saved split.';
    return;
  }
  historyStatus.textContent = locale === 'zh' ? '正在打开收据…' : 'Opening receipt…';
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
  saveMessage.textContent = locale === 'zh' ? '已从历史记录打开，保存时会更新这张收据。' : 'Opened from History. Saving will update this receipt.';
  peopleStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function removeHistoryReceipt(id: string): Promise<void> {
  if (currentIdentity?.mode !== 'authenticated') {
    const record = getLocalHistory(localStorage, id);
    if (!record || !window.confirm(locale === 'zh' ? `删除“${record.restaurant}”的记录？` : `Delete “${record.restaurant}”?`)) return;
    deleteLocalHistory(localStorage, id);
    if (currentHistoryId === id) reset();
    await showHistory();
    return;
  }
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
  row.innerHTML = `<label class="manual-name">${locale === 'zh' ? '餐点名称' : 'Food name'}<input data-field="name" placeholder="${locale === 'zh' ? '例如：鸡饭' : 'e.g. Chicken rice'}"></label>
    <label>${locale === 'zh' ? '数量' : 'Quantity'}<input data-field="quantity" type="number" min="0.01" step="any" value="1"></label>
    <label>${locale === 'zh' ? '单价' : 'Unit price'}<input data-field="unitPrice" type="number" min="0" step="0.01" placeholder="0.00"></label>
    <label>${locale === 'zh' ? '总计' : 'Total'}<input data-field="total" type="number" min="0" step="0.01" placeholder="0.00"></label>
    <button type="button" data-remove-manual aria-label="${locale === 'zh' ? '删除项目' : 'Delete item'}">${locale === 'zh' ? '删除' : 'Delete'}</button>`;
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
  manualCalculated.innerHTML = `<span>${locale === 'zh' ? '计算后的账单总额' : 'Calculated bill total'}</span><strong>${formatMoney(grand)}</strong>`;
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
  if (!items.length) { manualCalculated.textContent = locale === 'zh' ? '请至少添加一个包含名称和数量的项目。' : 'Add at least one item with a name and quantity.'; return; }
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
  currentResult = { parsed: { restaurantName: { value: manualRestaurant.value.trim() || (locale === 'zh' ? '手动输入的收据' : 'Manual receipt') } } } as ReceiptOcrResponse;
  goToStep(2);
}

function renderPeople(): void {
  peopleList.innerHTML = people.length
    ? people.map((person, index) => `<div class="person-row" data-person-id="${person.id}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(person.name)}</strong><button type="button" aria-label="${locale === 'zh' ? '移除' : 'Remove'} ${escapeHtml(person.name)}">${locale === 'zh' ? '移除' : 'Remove'}</button></div>`).join('')
    : locale === 'zh'
      ? '<div class="friendly-empty"><strong>还没有添加人员</strong><span>先添加自己，再添加一起分账的朋友。</span></div>'
      : '<div class="friendly-empty"><strong>No one added yet</strong><span>Add yourself first, then everyone sharing the bill.</span></div>';
  peopleContinue.disabled = people.length === 0;
  peopleContinue.textContent = locale === 'zh'
    ? people.length ? `与 ${people.length} 人继续 →` : '请至少添加一人'
    : people.length ? `Continue with ${people.length} ${people.length === 1 ? 'person' : 'people'} →` : 'Add at least one person';
}

function renderAssignments(): void {
  if (!reviewModel) return;
  assignmentList.innerHTML = reviewModel.items.map((item, index) => {
    const selected = assignments.get(item.id) ?? new Set<string>();
    return `<article class="assignment-card"><div><small>${locale === 'zh' ? '项目' : 'ITEM'} ${String(index + 1).padStart(2, '0')}</small><strong>${escapeHtml(item.name || (locale === 'zh' ? '未命名项目' : 'Unnamed item'))}</strong><span>${formatMoney(item.totalCents)}</span></div><div class="person-options">${people.map((person) => `<label><input type="checkbox" data-item-id="${item.id}" data-person-id="${person.id}" ${selected.has(person.id) ? 'checked' : ''}><span>${escapeHtml(person.name)}</span></label>`).join('')}</div></article>`;
  }).join('');
  updateAssignmentProgress();
}

function updateAssignmentProgress(): void {
  if (!reviewModel) return;
  const assigned = reviewModel.items.filter((item) => (assignments.get(item.id)?.size ?? 0) > 0).length;
  const total = reviewModel.items.length;
  const remaining = total - assigned;
  assignmentProgress.className = `assignment-progress ${remaining === 0 ? 'ready' : ''}`;
  assignmentProgress.innerHTML = locale === 'zh'
    ? `<strong>已分配 ${assigned}/${total} 个项目</strong><span>${remaining === 0 ? '所有项目都已分配 ✓' : `还有 ${remaining} 个项目未分配`}</span><i style="--progress:${total ? assigned / total * 100 : 0}%"></i>`
    : `<strong>${assigned} of ${total} items assigned</strong><span>${remaining === 0 ? 'Everyone’s items are covered ✓' : `${remaining} ${remaining === 1 ? 'item still needs' : 'items still need'} someone`}</span><i style="--progress:${total ? assigned / total * 100 : 0}%"></i>`;
  splitContinue.textContent = locale === 'zh' ? (remaining === 0 ? '查看结果 →' : `继续查看（${remaining} 项未分配）→`) : (remaining === 0 ? 'Review summary →' : `Review with ${remaining} unassigned →`);
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
  finalTotal.innerHTML = `<span>${locale === 'zh' ? '每个人应付金额已计算完成。' : 'Everyone’s share, sorted.'}</span><strong>${formatMoney(grand)}</strong><small>${locale === 'zh' ? `${people.length} 人 · ${reviewModel.items.length} 个项目` : `${people.length} people · ${reviewModel.items.length} items`}</small>`;
  personTotals.innerHTML = shares.map((person) => `<article><span>${escapeHtml(person.name.charAt(0).toUpperCase())}</span><strong>${escapeHtml(person.name)}</strong><b>${formatMoney(person.amountCents)}</b></article>`).join('');
  allocationCheck.innerHTML = `<div><span>${locale === 'zh' ? '账单总额' : 'Bill total'}</span><strong>${formatMoney(grand)}</strong></div><div><span>${locale === 'zh' ? '已分配' : 'Allocated'}</span><strong>${formatMoney(allocated)}</strong></div><div class="${allocated === grand ? 'balanced' : 'unbalanced'}"><span>${allocated === grand ? `✓ ${locale === 'zh' ? '差额' : 'Difference'}` : `△ ${locale === 'zh' ? '差额' : 'Difference'}`}</span><strong>${formatMoney(grand - allocated)}</strong></div>`;
  renderPaymentQr();
}

function renderPaymentQr(): void {
  if (paymentQrObjectUrl) URL.revokeObjectURL(paymentQrObjectUrl);
  paymentQrObjectUrl = paymentQr ? URL.createObjectURL(paymentQr.blob) : '';
  paymentQrState.textContent = paymentQr || paymentPhone ? (locale === 'zh' ? '已准备 ✓' : 'Ready ✓') : (locale === 'zh' ? '设置 →' : 'Set up →');
  paymentQrEmpty.classList.toggle('hidden', Boolean(paymentQr));
  paymentQrPreview.classList.toggle('hidden', !paymentQr);
  paymentQrDelete.classList.toggle('hidden', !paymentQr);
  paymentQrUpload.textContent = paymentQr
    ? (locale === 'zh' ? '更换二维码图片' : 'Replace QR image')
    : (locale === 'zh' ? '上传二维码图片' : 'Upload QR image');
  paymentPhoneInput.value = paymentPhone;
  paymentPhoneDelete.classList.toggle('hidden', !paymentPhone);
  paymentPhoneShare.textContent = paymentPhone ? `TNG: ${paymentPhone}` : '';
  paymentPhoneShare.classList.toggle('hidden', !paymentPhone);
  paymentQrShare.classList.toggle('hidden', !paymentQr && !paymentPhone);
  paymentQrShareImage.classList.toggle('hidden', !paymentQr);
  paymentQrDownload.classList.toggle('hidden', !paymentQr);
  paymentShareNote.textContent = paymentQr
    ? (locale === 'zh' ? '分享时会附上付款资料和收款二维码。' : 'Payment details and the QR image will be included when you share.')
    : (locale === 'zh' ? '分享时会把 TNG 电话号码放在账单最上方。' : 'The TNG number will appear at the top of shared bills.');
  shareResult.textContent = paymentQr || paymentPhone
    ? (locale === 'zh' ? '⌯  分享账单和付款资料' : '⌯  Share bill + payment details')
    : (locale === 'zh' ? '⌯  分享结果' : '⌯  Share result');
  if (!paymentQr || !paymentQrObjectUrl) return;
  paymentQrPreview.src = paymentQrObjectUrl;
  paymentQrShareImage.src = paymentQrObjectUrl;
  paymentQrDownload.href = paymentQrObjectUrl;
  paymentQrDownload.download = paymentQr.name || 'fastsplit-payment-qr.png';
}

async function setPaymentQr(file: File): Promise<void> {
  paymentQrFeedback.textContent = '';
  if (!file.type.startsWith('image/')) {
    paymentQrFeedback.textContent = locale === 'zh' ? '请选择 PNG、JPG 或 WebP 图片。' : 'Choose a PNG, JPG or WebP image.';
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    paymentQrFeedback.textContent = locale === 'zh' ? '二维码图片必须小于 8 MB。' : 'QR image must be smaller than 8 MB.';
    return;
  }
  paymentQrUpload.disabled = true;
  paymentQrFeedback.textContent = locale === 'zh' ? '正在将二维码保存在此设备…' : 'Saving QR on this device…';
  try {
    await savePaymentQr(file);
    paymentQr = await loadPaymentQr() ?? null;
    renderPaymentQr();
    paymentQrFeedback.textContent = locale === 'zh' ? '收款二维码已保存，之后分享账单时会自动附上。' : 'Payment QR saved. It will be attached to future bill shares.';
    paymentQrSettings.open = true;
  } catch {
    paymentQrFeedback.textContent = locale === 'zh' ? '无法保存二维码，请尝试较小的图片。' : 'Could not save this QR image. Try a smaller image.';
  } finally {
    paymentQrUpload.disabled = false;
    paymentQrInput.value = '';
  }
}

function saveCompletedSplit(): void {
  if (!reviewModel || !currentResult || currentIdentity?.mode === 'authenticated') return;
  const saved = saveLocalHistory(localStorage, {
    restaurant: currentResult.parsed.restaurantName.value || (locale === 'zh' ? '未命名收据' : 'Unnamed receipt'),
    grandTotalCents: reviewModel.summary.grandTotal.valueCents,
    reviewModel: cloneReviewModel(reviewModel),
    ocrResult: structuredClone(currentResult),
    people: structuredClone(people),
    assignments: [...assignments].map(([itemId, personIds]) => ({ itemId, personIds: [...personIds] })),
  }, currentHistoryId);
  currentHistoryId = saved.id;
  historySavedMessage.textContent = c('saved');
}

function buildShareText(): string {
  if (!reviewModel || !currentResult) return '';
  const shares = calculateShares();
  const grand = reviewModel.summary.grandTotal.valueCents ?? shares.reduce((sum, person) => sum + person.amountCents, 0);
  const restaurant = currentResult.parsed.restaurantName.value || 'FastSplit bill';
  const foodAmounts = new Map(people.map((person) => [person.id, 0]));
  const itemLines = new Map(people.map((person) => [person.id, [] as string[]]));

  for (const item of reviewModel.items) {
    const owners = [...(assignments.get(item.id) ?? [])];
    if (!owners.length || item.totalCents === null) continue;
    const base = Math.floor(item.totalCents / owners.length);
    let remainder = item.totalCents - base * owners.length;
    owners.forEach((personId) => {
      const amount = base + (remainder-- > 0 ? 1 : 0);
      foodAmounts.set(personId, (foodAmounts.get(personId) ?? 0) + amount);
      const shared = owners.length > 1 ? (locale === 'zh' ? '（共享）' : ' (shared)') : '';
      const name = item.name || (locale === 'zh' ? '未命名项目' : 'Unnamed item');
      itemLines.get(personId)?.push(`  - ${name}${shared}: ${formatMoney(amount)}`);
    });
  }

  const weights = people.map((person) => foodAmounts.get(person.id) ?? 0);
  const charges = [
    { label: locale === 'zh' ? '服务费' : 'Service charge', value: reviewModel.summary.serviceCharge.valueCents ?? 0 },
    { label: locale === 'zh' ? 'SST / GST 税费' : 'SST / GST', value: reviewModel.summary.tax.valueCents ?? 0 },
    { label: locale === 'zh' ? '折扣' : 'Discount', value: -Math.abs(reviewModel.summary.discount.valueCents ?? 0) },
    { label: locale === 'zh' ? '舍入调整' : 'Rounding', value: reviewModel.summary.rounding.valueCents ?? 0 },
  ].filter((charge) => charge.value !== 0)
    .map((charge) => ({ ...charge, allocations: allocateByWeight(charge.value, weights) }));

  return [
    ...(paymentPhone ? [`TNG: ${paymentPhone}`, locale === 'zh' ? '复制以上号码并粘贴到 TNG 付款。' : 'Copy the number above and paste it into TNG to pay.', ''] : []),
    `FastSplit · ${restaurant}`,
    `${locale === 'zh' ? '账单总额' : 'Bill total'}: ${formatMoney(grand)}`,
    '',
    ...shares.flatMap((person) => {
      const personIndex = people.findIndex((candidate) => candidate.id === person.id);
      const lines = itemLines.get(person.id) ?? [];
      let detailedTotal = foodAmounts.get(person.id) ?? 0;
      for (const charge of charges) {
        const amount = charge.allocations[personIndex] ?? 0;
        if (amount === 0) continue;
        detailedTotal += amount;
        lines.push(`  - ${charge.label}: ${formatSignedMoney(amount)}`);
      }
      const adjustment = person.amountCents - detailedTotal;
      if (adjustment !== 0) {
        lines.push(`  - ${locale === 'zh' ? '其他调整' : 'Other adjustment'}: ${formatSignedMoney(adjustment)}`);
      }
      return [
        `${person.name}: ${formatMoney(person.amountCents)}`,
        ...(lines.length ? lines : [`  - ${locale === 'zh' ? '没有分配项目' : 'No items assigned'}: ${formatMoney(0)}`]),
        '',
      ];
    }),
    locale === 'zh' ? '使用 FastSplit，公平分账。' : 'Split fairly with FastSplit.',
  ].join('\n');
}

function allocateByWeight(totalCents: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const denominator = weightTotal || weights.length;
  let remaining = totalCents;
  return weights.map((weight, index) => {
    const portion = index === weights.length - 1
      ? remaining
      : Math.round(totalCents * (weightTotal ? weight : 1) / denominator);
    remaining -= portion;
    return portion;
  });
}

function formatSignedMoney(cents: number): string {
  return cents < 0 ? `-${formatMoney(Math.abs(cents))}` : formatMoney(cents);
}

async function shareBillResult(): Promise<void> {
  const text = buildShareText();
  if (!text) return;
  shareMessage.textContent = '';
  try {
    if (paymentQr) {
      const qrFile = new File([paymentQr.blob], paymentQr.name || 'fastsplit-payment-qr.png', { type: paymentQr.blob.type || 'image/png' });
      const shareWithQr: ShareData = { title: 'FastSplit bill', text, files: [qrFile] };
      if (navigator.share && navigator.canShare?.(shareWithQr)) {
        await navigator.share(shareWithQr);
        shareMessage.textContent = locale === 'zh' ? '账单文字和收款二维码已分享。' : 'Bill text and payment QR shared.';
        return;
      }
    }
    if (navigator.share) {
      await navigator.share({ title: 'FastSplit bill', text });
      shareMessage.textContent = paymentQr
        ? (locale === 'zh' ? '此浏览器只能分享账单文字，请使用“保存二维码图片”另行发送。' : 'This browser shared the bill text only. Use “Save QR image” to send the QR separately.')
        : (locale === 'zh' ? '已打开分享选单。' : 'Share sheet opened.');
    } else {
      await navigator.clipboard.writeText(text);
      shareMessage.textContent = paymentQr
        ? (locale === 'zh' ? '账单文字已复制，请保存上方二维码并在聊天软件中附上。' : 'Bill copied as text. Save the QR image above and attach it in your messaging app.')
        : (locale === 'zh' ? '账单文字已复制，请粘贴到 WhatsApp 或聊天软件。' : 'Bill copied as text. Paste it into WhatsApp or your messaging app.');
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    try {
      await navigator.clipboard.writeText(text);
      shareMessage.textContent = paymentQr
        ? (locale === 'zh' ? '账单文字已复制，请保存上方二维码并在聊天软件中附上。' : 'Bill copied as text. Save the QR image above and attach it in your messaging app.')
        : (locale === 'zh' ? '账单文字已复制，请粘贴到 WhatsApp 或聊天软件。' : 'Bill copied as text. Paste it into WhatsApp or your messaging app.');
    } catch {
      shareMessage.textContent = locale === 'zh' ? '无法打开分享功能，请重试。' : 'Could not open sharing. Please try again.';
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
  status.textContent = locale === 'zh' ? '正在优化图片…' : 'Improving image…';
  try {
    prepared = await prepareReceiptImage(file);
    preview.src = prepared.previewUrl;
    imageInfo.textContent = `${prepared.width} × ${prepared.height} · ${(prepared.uploadedBytes / 1024 / 1024).toFixed(2)} MB ${locale === 'zh' ? '上传大小' : 'upload'}`;
    dropzone.classList.add('hidden');
    workspace.classList.remove('hidden');
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : (locale === 'zh' ? '无法处理图片。' : 'Could not prepare image.');
  }
}

function startScanProgress(): void {
  stopScanProgress();
  const messages = [
    locale === 'zh' ? '正在安全上传收据…' : 'Uploading receipt securely…',
    locale === 'zh' ? '正在读取文字和价格…' : 'Reading printed text and prices…',
    locale === 'zh' ? '正在重建收据项目…' : 'Reconstructing receipt rows…',
    locale === 'zh' ? '正在核对项目和总额…' : 'Checking items against the totals…',
  ];
  let index = 0;
  scanProgress = 8;
  scanButton.style.setProperty('--scan-progress', `${scanProgress}%`);
  scanButton.querySelector<HTMLElement>('.scan-button-label')!.textContent = messages[index] ?? 'Reading receipt…';
  scanButton.querySelector<HTMLElement>('.scan-button-percent')!.textContent = `${scanProgress}%`;
  status.textContent = messages[index] ?? 'Reading receipt…';
  scanProgressTimer = window.setInterval(() => {
    scanProgress = Math.min(scanProgress + (scanProgress < 55 ? 9 : scanProgress < 80 ? 5 : 2), 94);
    index = Math.min(Math.floor(scanProgress / 25), messages.length - 1);
    status.textContent = messages[index] ?? 'Reading receipt…';
    scanButton.style.setProperty('--scan-progress', `${scanProgress}%`);
    scanButton.querySelector<HTMLElement>('.scan-button-label')!.textContent = messages[index] ?? 'Reading receipt…';
    scanButton.querySelector<HTMLElement>('.scan-button-percent')!.textContent = `${scanProgress}%`;
  }, 650);
}

function stopScanProgress(): void {
  if (scanProgressTimer !== null) window.clearInterval(scanProgressTimer);
  scanProgressTimer = null;
}

function resetScanButton(): void {
  scanProgress = 0;
  scanButton.classList.remove('is-scanning');
  scanButton.style.removeProperty('--scan-progress');
  scanButton.querySelector<HTMLElement>('.scan-button-label')!.textContent = locale === 'zh' ? '读取收据' : 'Read receipt';
  scanButton.querySelector<HTMLElement>('.scan-button-percent')!.textContent = '';
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
  scanButton.classList.add('is-scanning');
  status.className = 'status loading';
  startScanProgress();
  try {
    const result = await scanReceipt(prepared.blob, controller.signal);
    scanProgress = 100;
    scanButton.style.setProperty('--scan-progress', '100%');
    scanButton.querySelector<HTMLElement>('.scan-button-label')!.textContent = locale === 'zh' ? '收据已完成' : 'Receipt ready';
    scanButton.querySelector<HTMLElement>('.scan-button-percent')!.textContent = '100%';
    renderResult(result);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    status.className = 'status error';
    status.textContent = error instanceof Error ? error.message : (locale === 'zh' ? '无法清楚读取这张收据。' : 'Could not read this receipt clearly.');
  } finally {
    stopScanProgress();
    scanButton.disabled = false;
    window.setTimeout(resetScanButton, 500);
    controller = null;
  }
});

saveHistoryButton.addEventListener('click', async () => {
  if (currentIdentity?.mode !== 'authenticated' || !currentResult || !reviewModel) return;
  saveHistoryButton.disabled = true;
  saveMessage.textContent = currentHistoryId
    ? (locale === 'zh' ? '正在更新收据…' : 'Updating receipt…')
    : (locale === 'zh' ? '正在保存收据和图片…' : 'Saving receipt and image…');
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
    saveMessage.textContent = locale === 'zh' ? '已永久保存到历史记录。' : 'Saved permanently to History.';
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

confirmReviewButton.addEventListener('click', () => goToStep(2));
peopleForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = personName.value.trim();
  if (!name) return;
  if (people.some((person) => person.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) {
    peopleFeedback.textContent = locale === 'zh' ? `${name} 已经在名单中。` : `${name} is already on the list.`;
    personName.select();
    return;
  }
  people.push({ id: crypto.randomUUID(), name });
  peopleFeedback.textContent = locale === 'zh' ? `已添加 ${name}。` : `${name} added.`;
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
peopleContinue.addEventListener('click', () => { renderAssignments(); goToStep(3); });
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
  if (missing && !window.confirm(locale === 'zh' ? '还有项目未分配，仍然继续吗？' : 'Some items are not assigned. Continue anyway?')) return;
  renderFinalSummary();
  goToStep(4);
  saveCompletedSplit();
});
startOver.addEventListener('click', () => { reset(); scannerSection.classList.add('hidden'); hero.classList.remove('hidden'); });
shareResult.addEventListener('click', () => void shareBillResult());
paymentQrUpload.addEventListener('click', () => paymentQrInput.click());
paymentQrInput.addEventListener('change', () => {
  const file = paymentQrInput.files?.[0];
  if (file) void setPaymentQr(file);
});
paymentQrDelete.addEventListener('click', async () => {
  if (!window.confirm(locale === 'zh' ? '要移除此设备上保存的收款二维码吗？' : 'Remove the payment QR saved on this device?')) return;
  paymentQrDelete.disabled = true;
  try {
    await deletePaymentQr();
    paymentQr = null;
    renderPaymentQr();
    paymentQrFeedback.textContent = locale === 'zh' ? '收款二维码已移除。' : 'Payment QR removed.';
  } catch {
    paymentQrFeedback.textContent = locale === 'zh' ? '无法移除二维码图片。' : 'Could not remove the QR image.';
  } finally {
    paymentQrDelete.disabled = false;
  }
});
paymentPhoneSave.addEventListener('click', () => {
  const saved = savePaymentPhone(localStorage, paymentPhoneInput.value);
  if (!saved) {
    paymentPhoneFeedback.textContent = locale === 'zh' ? '请输入 8 至 15 位的有效电话号码。' : 'Enter a valid phone number with 8 to 15 digits.';
    return;
  }
  paymentPhone = saved;
  renderPaymentQr();
  paymentPhoneFeedback.textContent = locale === 'zh' ? 'TNG 电话号码已保存，之后分享账单时会自动显示。' : 'TNG number saved. It will appear on future shared bills.';
});
paymentPhoneDelete.addEventListener('click', () => {
  deletePaymentPhone(localStorage);
  paymentPhone = '';
  renderPaymentQr();
  paymentPhoneFeedback.textContent = locale === 'zh' ? 'TNG 电话号码已移除。' : 'TNG number removed.';
});
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

langEn.addEventListener('click', () => setLanguage('en'));
langZh.addEventListener('click', () => setLanguage('zh'));

// FastSplit now opens directly without an authentication gate.
enterApplication(enableGuestMode(localStorage));
paymentPhone = loadPaymentPhone(localStorage);
applyLanguage();
void loadPaymentQr().then((saved) => {
  paymentQr = saved ?? null;
  renderPaymentQr();
}).catch(() => {
  paymentQrFeedback.textContent = locale === 'zh' ? '此浏览器无法使用收款二维码储存功能。' : 'Payment QR storage is unavailable in this browser.';
});

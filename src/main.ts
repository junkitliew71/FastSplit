import './style.css';
import { scanReceipt } from './api.ts';
import { prepareReceiptImage, type PreparedImage } from './image.ts';
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
          <ol id="detections" class="detections"></ol>
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

let prepared: PreparedImage | null = null;
let controller: AbortController | null = null;

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
}

function renderResult(result: ReceiptOcrResponse): void {
  status.textContent = result.needsReview ? 'Review recommended' : 'Receipt read successfully';
  status.className = `status ${result.needsReview ? 'warning' : 'success'}`;
  summary.classList.remove('hidden');
  summary.innerHTML = `<strong>${result.ocr.detections.length} text regions</strong><span>${Math.round(result.ocr.confidence * 100)}% confidence · Pass ${result.ocr.passUsed} · ${Math.round(result.timingsMs.total ?? 0)} ms${result.cacheHit ? ' · cached' : ''}</span>`;
  boxes.replaceChildren();
  detections.replaceChildren();

  for (const item of result.ocr.detections) {
    const box = document.createElement('button');
    box.className = 'ocr-box';
    box.style.left = `${item.bbox.x1 * 100}%`;
    box.style.top = `${item.bbox.y1 * 100}%`;
    box.style.width = `${(item.bbox.x2 - item.bbox.x1) * 100}%`;
    box.style.height = `${(item.bbox.y2 - item.bbox.y1) * 100}%`;
    box.title = `${item.text} · ${Math.round(item.confidence * 100)}%`;
    boxes.append(box);

    const row = document.createElement('li');
    row.innerHTML = `<span>${escapeHtml(item.text)}</span><small>${Math.round(item.confidence * 100)}%</small>`;
    detections.append(row);
  }
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

# FastSplit

FastSplit is a mobile-friendly receipt scanner and bill-splitting web application. This repository currently contains the Phase 2 server-side OCR foundation.

## Development

```bash
pnpm install
pnpm dev
```

The frontend runs at `http://localhost:5173`; the OCR API runs at `http://localhost:8787`.

## OCR API

`POST /api/ocr/receipt` accepts `multipart/form-data` with an image field named `receipt`. The server returns OCR text, confidence, word bounding boxes with normalized coordinates, image-quality indicators, pass selection, review status, and development timings.

The Tesseract worker is loaded once during server startup and reused. A lightweight first pass runs on every request. An enhanced grayscale/normalized/sharpened second pass runs only when the first pass has low confidence, too few text regions, or marginal confidence on a low-contrast image.

## Commands

- `pnpm dev` — frontend and OCR server in watch mode
- `pnpm build` — typecheck and production frontend build
- `pnpm start` — run the server (serves `dist` when `NODE_ENV=production`)
- `pnpm lint` — ESLint
- `pnpm test` — unit tests

Copy `.env.example` to `.env` and provide the Firebase Web App values to enable Google sign-in. These client configuration values are read through `VITE_FIREBASE_*`; Firebase Admin credentials are not used or exposed. Guest Mode remains available when Firebase is not configured.

## Permanent receipt history

Authenticated users can save reviewed receipts to Cloud Firestore. Compressed receipt images are stored in Firebase Storage, never as base64 in Firestore. Saved receipts remain until their owner confirms deletion. Guest Mode stays available but does not persist receipt history.

Create a Firestore database and a Storage bucket in Firebase Console, then publish [`firestore.rules`](./firestore.rules) and [`storage.rules`](./storage.rules). Both rule sets restrict receipts and images to their authenticated Firebase UID owner.

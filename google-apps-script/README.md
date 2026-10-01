# FastSplit Google receipt scanner

1. Create a standalone project at https://script.google.com/.
2. Replace `Code.gs` with the checked-in `Code.gs` file.
3. In **Project Settings → Script Properties**, add `GEMINI_API_KEY` with the Google AI Studio key. Optionally add `GEMINI_MODEL`.
4. Deploy as a Web App, execute as yourself, and allow access to anyone using FastSplit.
5. Copy the `/exec` URL into the GitHub Actions repository variable `VITE_GOOGLE_SCRIPT_URL` and redeploy Pages.

Never commit the API key or place it in `VITE_*`; Vite values are public browser code.

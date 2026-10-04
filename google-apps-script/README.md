# FastSplit Google receipt scanner

1. Create a standalone project at https://script.google.com/.
2. Replace `Code.gs` with the checked-in `Code.gs` file.
3. In **Project Settings → Script Properties**, add `GEMINI_API_KEY` with the Google AI Studio key.
4. By default, FastSplit uses the free-tier models in this order: `gemini-2.5-flash`, then `gemini-3.1-flash-lite`. If the first model is rate-limited, unavailable, or returns invalid JSON, the next model is tried automatically.
5. Optionally add `GEMINI_MODELS` as a comma-separated ordered list to change the fallback chain. The older single `GEMINI_MODEL` setting remains supported as the first model.
6. Deploy as a Web App, execute as yourself, and allow access to anyone using FastSplit.
7. Copy the `/exec` URL into the GitHub Actions repository variable `VITE_GOOGLE_SCRIPT_URL` and redeploy Pages.

Never commit the API key or place it in `VITE_*`; Vite values are public browser code.

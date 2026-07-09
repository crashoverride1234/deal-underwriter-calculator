# Deal Underwriter Calculator (PWA)

Real-estate deal underwriting app: **Step 1** ARV desktop appraisal (subject +
comps adjustment grid + market absorption meter) → **Step 2** fix&flip / rental
deal calculator with stress-test sliders. Vanilla JS, no build system, no
framework. Deployed to GitHub Pages from `main`.

## Files

- `engine.js` — pure calculation core (UMD: browser global `UnderwriterEngine`
  + Node module). ALL business math lives here, no DOM:
  `underwrite()`, `appraise()`, `marketAbsorption()`, `calcAmortizedPayment()`.
- `app.js` — DOM wiring only. Charts update in place (never destroy/recreate
  per keystroke). Dynamic icons are inline SVG constants — Lucide's
  `createIcons()` runs once at load and replaces `<i>` tags with static SVGs,
  so swapping `data-lucide` afterwards does nothing.
- `index.html` — both pages; CDN deps pinned + deferred
  (`chart.js@4.4.3`, `lucide@0.462.0`).
- `sw.js` — service worker. **RULE: bump `CACHE_NAME` on every deployable
  change.** Same-origin = network-first; CDN = cache-first; live API hosts and
  `*.workers.dev` = network-only (never cached).
- `tests.js` — engine unit tests: `node tests.js`, or open `test.html` in a
  browser. Every engine change needs tests; UI-only changes need browser
  verification instead.
- `worker/` — Cloudflare Worker proxy for keyless property auto-fill
  (realtor.com GraphQL; optional RentCast/Melissa via Worker secrets).
- `serve.ps1` / `launcher.ps1` — dev HTTP server (port 8080) and the desktop
  shortcut launcher (starts server hidden + opens Edge `--app` window).

## Workflows

- **Run locally**: preview config in `.claude/launch.json` (name
  `underwriter`, port 8080). GOTCHA: if port 8080 won't bind, an orphaned
  `serve.ps1` is holding it (HttpListener registers via http.sys, so the
  listener shows as PID 4/System) — kill powershell processes whose command
  line contains `serve.ps1`.
- **Test**: `node tests.js` (36 tests as of 2026-07). Must pass before deploy.
- **Deploy app**: commit + push to `main` → GitHub Pages redeploys in ~20s.
  Verify by polling the live URL for a marker string with no-cache headers.
- **Deploy worker**: `npx wrangler deploy` from `worker/`.
- Project norm: verify features end-to-end in the browser preview (including
  live API calls) BEFORE pushing; then push and confirm the Pages deploy.

## External data sources (all live-verified July 2026)

- **Address autocomplete** (keyless, queried in parallel, merged best-first):
  realtor.com geo-suggest (`parser-external.geo.moveaws.com/suggest`,
  CORS-open, canonical suffixed addresses, carries `mpr_id`) → US Census
  geocoder (JSONP only — no CORS) → Photon/OSM (CORS-open, weak US
  house-number coverage).
- **Property record ladder** (in `lookupSubjectProperty`): localStorage cache
  → Worker `/property` (realtor.com GraphQL — `operationName` is REQUIRED in
  the POST body or it 400s) → RentCast direct (CORS-open, key in browser,
  50/mo free, only HTTP-200s billed, lat/long radius fallback) → Worker
  `/rentcast` → Melissa direct (~1,000 credits/mo) → Worker `/melissa`.
- **Dead ends — do not retry**: Zillow & Redfin unofficial APIs
  (TLS-fingerprint WAF blocks even server-side); realtor.com detail endpoints
  are CORS-blocked from browsers (that's why the Worker exists).

## Conventions

- Percent inputs are whole numbers (80 = 80%); the engine divides by 100.
- Missing comp data must produce NO adjustment, not a phantom one.
- localStorage keys: `underwriter-appraisal-v1`, `underwriter-rentcast-key`,
  `underwriter-melissa-key`, `underwriter-worker-url`,
  `underwriter-property-cache-v1`.
- Never commit `worker/.wrangler/` (gitignored) or any secrets; the repo is
  public. Keep the deployed Worker URL out of repo files.

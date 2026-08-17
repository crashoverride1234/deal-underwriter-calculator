# Deal Underwriter Calculator (PWA)

Real-estate deal underwriting app: **Step 1** subject property info (address +
physical details) → **Step 2** ARV estimation (adjustment grid + comps +
market absorption meter) → **Step 3** fix&flip / rental deal calculator with
stress-test sliders. Vanilla JS, no build system, no framework. Deployed to
GitHub Pages from `main`.

## Files

- `engine.js` — pure calculation core (UMD: browser global `UnderwriterEngine`
  + Node module). ALL business math lives here, no DOM:
  `underwrite()`, `appraise()`, `marketAbsorption()`, `calcAmortizedPayment()`,
  `classifyCondition()`, `projectPropertyTax()` (TX post-sale reassessment:
  effective rate from the record × buyer's basis; flip basis = purchase,
  rental basis = max(purchase, ARV); homesteaded seller ⇒ floor),
  `maxOffer()` (binary-search inversion of underwrite(): flip target =
  net profit $, rental targets = cash flow / DSCR / CoC, rounds DOWN to
  $100; reports unachievable and price-independent-unbounded cases) +
  `ruleOfThumbOffer()`/`suggestedRulePct()` (70%-rule flexed 65–75 by
  absorption score), `estimateRehab()`/`capexFlags()` (tiered $/sqft scope
  + DFW year-built era advisories), `marketTrend()` (1004MC-style
  0–3/4–6/7–12-month sold buckets, ±3% = flat), `rentFromComps()` (median
  $/sqft × subject sqft). underwrite() also models draw-based vs Dutch
  interest (`interestOnDraws`; holdback averages half-drawn) and emits
  flip `peakCashExposure` (cash + ⅓ holdback fronted between draws).
- `app.js` — DOM wiring only. Charts update in place (never destroy/recreate
  per keystroke). Dynamic icons are inline SVG constants — Lucide's
  `createIcons()` runs once at load and replaces `<i>` tags with static SVGs,
  so swapping `data-lucide` afterwards does nothing.
- `index.html` — all three pages; CDN deps pinned + deferred
  (`chart.js@4.4.3`, `lucide@0.462.0`).
- `sw.js` — service worker. **RULE: bump `CACHE_NAME` on every deployable
  change.** Same-origin = network-first; CDN = cache-first; live API hosts and
  `*.workers.dev` = network-only (never cached).
- `tests.js` — engine unit tests: `node tests.js`, or open `test.html` in a
  browser. Every engine change needs tests; UI-only changes need browser
  verification instead.
- `worker/` — Cloudflare Worker proxy for keyless property auto-fill
  (realtor.com GraphQL; optional RentCast/Melissa via Worker secrets).
- `native/` — Capacitor 8 iOS/Android store apps wrapping the same web files
  (see `native/README.md`). `build-www.mjs` stages `www/` (vendors the CDN
  libs, strips the SW); native-only behavior sits at the bottom of `app.js`
  guarded by `window.Capacitor`. Binaries build in GitHub Actions
  (`.github/workflows/native-builds.yml`) — iOS cannot build on Windows.
- `serve.ps1` / `launcher.ps1` — dev HTTP server (port 8080) and the desktop
  shortcut launcher (starts server hidden + opens Edge `--app` window).

## Workflows

- **Run locally**: preview config in `.claude/launch.json` (name
  `underwriter`, port 8080). GOTCHA: if port 8080 won't bind, an orphaned
  `serve.ps1` is holding it (HttpListener registers via http.sys, so the
  listener shows as PID 4/System) — kill powershell processes whose command
  line contains `serve.ps1`.
- **Test**: `node tests.js` (72 tests as of 2026-08-16). Must pass before deploy.
- **Deploy app**: commit + push to `main` → GitHub Pages redeploys in ~20s.
  Verify by polling the live URL for a marker string with no-cache headers.
- **Deploy worker**: `npx wrangler deploy` from `worker/`.
- **Native builds**: push to `main` (or Actions → "Native builds" → run) and
  download the artifacts. Store signing/submission: `native/README.md`.
- Project norm: verify features end-to-end in the browser preview (including
  live API calls) BEFORE pushing; then push and confirm the Pages deploy.

## External data sources (all live-verified July 2026)

- **Address autocomplete** (keyless, queried in parallel, merged best-first):
  realtor.com geo-suggest (`parser-external.geo.moveaws.com/suggest`,
  CORS-open, canonical suffixed addresses, carries `mpr_id`) → US Census
  geocoder (JSONP only — no CORS) → Photon/OSM (CORS-open, weak US
  house-number coverage).
- **Property record ladder** (in `fetchPropertyRecord`, shared by the subject
  page and every comp card's address autocomplete): localStorage cache
  → browser-pasted keys as deliberate overrides (RentCast direct with
  variant + lat/long-radius retries, then Melissa direct) → Worker `/lookup`,
  which runs the canonical server-side order in ONE round trip:
  TAD parcels (keyless Tarrant FeatureServer, gated by county bbox + a
  SITUS street-number guard against wrong-parcel geocodes; no tax bill, so
  a hit is merged with the keyless realtor rung; saves RentCast quota in
  the home county) → RentCast (secret) → Melissa (secret) → realtor.com
  GraphQL (keyless;
  `operationName` is REQUIRED in the POST body or it 400s). Providers whose
  secret is unset are skipped. RentCast: 50/mo free, only HTTP-200s billed.
  Melissa: ~1,000 credits/mo free. Worker also keeps `/property`, `/rentcast`,
  `/melissa`, `/health` as individual debug routes, plus `/market` (keyless
  realtor solds/actives/pendings — auto-fills the absorption meter, feeds
  trend buckets + the competition readout; auto-runs with comp suggestion)
  and `/rent` (RentCast rent AVM secret + HUD SAFMR via `HUD_API_KEY`
  secret, DFW metro METRO19100M19100, + keyless realtor active rentals;
  button-triggered on the calculator because the rent AVM bills a credit).
- **Comp suggestions** (`/comps` route, auto-runs on ARV-page entry after any
  subject-page visit — wipes prior comps, auto-fills the top 4 into the
  cards, offers "Restore previous comps" if the search fails; no manual
  button since 2026-08): realtor.com
  `home_search` sold listings (keyless; `nearby.coordinates` is GeoJSON
  [lon, lat], radius pattern "1mi", filters verified live 2026-07-23) merged
  with RentCast AVM `/avm/value` comparables (1 billed request per call,
  correlation-ranked), deduped by street address; client ranks 0–100 by
  similarity to the live subject. TX non-disclosure: prices are list-at-sale
  proxies — the UI says to verify against MLS. NTREIS BBO (Trestle) remains
  the endgame for true sold prices. Listing REMARKS survive closing (unlike
  photos; verified 2026-08-13) and ride on candidates as `remarks` —
  realtor.com strips `description.text` for bare datacenter requests, so the
  worker sends full browser-shaped headers (Origin/Referer/Accept-Language);
  engine `classifyCondition()` reads renovated/average/dated from that text
  (renovation language > distress language > partial updates), auto-applied
  comps carry `conditionEvidence`, and no-signal comps get
  `conditionUnverified` + a visible warning until the user sets Condition.
- **Site map & influence scan**: Leaflet 1.9.4 (pinned unpkg CDN) + Esri
  World Imagery tiles (keyless) on the subject page; Overpass API
  (`overpass-api.de`, keyless, CORS-open) reads nearest major road / rail /
  power line / commercial / park-green-space and parcel-mapped pools within
  ~400 m. Subject scan + per-comp scan buttons; comp coords ride along on
  records/candidates (`lat`/`lon`). OSM absence ≠ absence in reality.
  **Comps map** (ARV page, below the comp cards, shipped 2026-08-16):
  `updateCompsMap()` in app.js draws an "S" subject pin + numbered comp
  pins (gray = unpriced/out of blend) with label/price/distance popups.
  Two signatures gate the work per keystroke: coordinates-only `posSig`
  rebuilds the pin set + re-fits; content-only `sig` restyles pins IN
  PLACE (`setIcon`/`setPopupContent`) so pan/zoom and an open popup
  survive typing. Typing in a comp label CLEARS `comp.lat/lon` (mirrors
  the subject field — a pin must never assert coords the text didn't
  produce; label-only comps get a "no map location" note). ARV entry
  calls `invalidateSize()` unconditionally — Leaflet's window-resize
  handler fires while the page is display:none and caches a 0×0 size that
  nothing else heals (same trap as the calculator chart).
  The subject scan also runs a **public-records pass** (all verified live
  2026-08-14): FEMA NFHL flood zone browser-direct from Esri's Living Atlas
  mirror (`USA_Flood_Hazard_Areas_view` FeatureServer, CORS-open; hazard
  polygons only, so 0 features = nothing mapped; hazards.fema.gov itself is
  a DEAD END — no CORS for browsers, 403/525 for Workers; engine
  `readFloodZone()`), USDA SSURGO shrink-swell browser-direct
  (sdmdataaccess `Tabular/post.rest`, CORS-open; dominant component `lep_r`;
  engine `readShrinkSwell()`, ≥6% = the DFW clay warning), and city permit
  history (`PERMIT_SOURCES` per-city table — Dallas Socrata `e7gq-4sah` is
  the only live keyless feed; Fort Worth's BLDS feed died in 2015 and its
  ArcGIS org has no permits layer — do not re-research, just add cities
  when feeds appear), plus hail history via worker `/hail` (IEM lsr.py CSV,
  WFO=FWD, geojson removed upstream; ~1 MB parsed + cached per isolate-day;
  engine `readHailHistory()`, 3+ ≥1.0" reports in 3 mi/5 yr = hail alley).
  ARV page also runs a protest check (`protestOpportunity()`: assessed vs
  min(user-entered purchase price, blended ARV) — the price only counts
  once typed for THIS subject (`purchaseEnteredForSubject`); savings at the
  derived rate, May-15 deadline note; the printable evidence packet renders
  into hidden `#protest-packet` + `body.protest-print` print CSS +
  `window.print()` — deliberately NOT window.open (popup blockers); button
  hidden on native). Remaining senses (all verified live 2026-08-14, all
  browser-direct via shared `arcgisPointQuery()`): TEA school district +
  A–F rating (SY25-26 polygons + the DATED txschools ratings view —
  auto-rediscovered from the TEA org service list when republished;
  `suggestSchoolRatings()` seeds the qualitative School District rating
  across district lines, only when still 'similar', evidence on hover);
  TxDOT AADT (busiest counted road within ½ mi); crime density
  (`CRIME_SOURCES` per-city — Dallas Socrata within_circle only; FW's
  fresh table stores coords as TEXT and its point layer is CORS-blocked +
  stale, dead end); ACS tract income + rent burden via Esri Living Atlas
  (api.census.gov itself now REQUIRES a key — keyless claim retired
  2026-08-14; no national median-gross-rent layer exists).
- **AI vision** (worker `/vision`, Workers AI `[ai]` binding in wrangler.toml,
  free daily allocation): llava-1.5-7b judges adjacency from imagery — Esri
  keyless `export` snapshot (~150 m box) for pool / road-adjacency / rail /
  commercial / green, plus an optional street photo (host-allowlisted:
  maps.googleapis.com, ap.rdcpix.com) for power lines / street character.
  GOTCHA: llava ignores multi-question formats — one question per AI.run
  call, parallel. Front view = Google Street View Static behind an optional
  browser key (`underwriter-gmaps-key`); realtor.com photos are DEAD (nulled
  once listings close, verified 2026-07-23).
- **Dead ends — do not retry**: Zillow & Redfin unofficial APIs
  (TLS-fingerprint WAF blocks even server-side); realtor.com detail endpoints
  are CORS-blocked from browsers (that's why the Worker exists).

## Conventions

- Percent inputs are whole numbers (80 = 80%); the engine divides by 100.
- Missing comp data must produce NO adjustment, not a phantom one.
- Appraisal model semantics (all deliberate, all tested): time adjustment
  first, % adjustments (condition/qualitative) apply to the time-adjusted
  basis; renovated comps take no age adjustment (effective age); the sqft
  line nets out bedroom/bath footprints (`DEFAULTS.bedroomFootprintSqft`);
  story premium fires only single-story-vs-multi (stairs, not floor count);
  appreciation and storyAdj may be negative; the engine emits per-comp
  `overlaps` advisories for likely double-counts (condition+curbAppeal,
  lot size+lotUsability).
- Every open starts a BLANK underwriting (deliberate, 2026-08): subject
  fields, market inputs, and comps never restore and index.html carries no
  demo values; only the adjustment-grid settings + qualitative weights
  persist (`underwriter-appraisal-v1` is settings-only now) plus API keys.
- localStorage keys: `underwriter-appraisal-v1`, `underwriter-rentcast-key`,
  `underwriter-melissa-key`, `underwriter-worker-url`,
  `underwriter-property-cache-v3`.
- Never commit `worker/.wrangler/` (gitignored) or any secrets; the repo is
  public. The deployed Worker URL is deliberately baked into `app.js` as
  `DEFAULT_WORKER_URL` (zero-setup auto-fill was chosen over URL secrecy;
  Workers free tier has a hard daily cap, so no billing risk — rotate the
  worker name if abuse ever shows up).

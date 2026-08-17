# Handoff — Deal Underwriter Calculator

Written 2026-08-16 for whichever AI agent (or human) picks this project up
next. It captures the state and agreements that are NOT recoverable from the
code or git history. Read this first, then `CLAUDE.md` (the architecture +
conventions doc, kept current), then the code.

Repo: https://github.com/crashoverride1234/deal-underwriter-calculator (public, `main` deploys)
Live app: https://crashoverride1234.github.io/deal-underwriter-calculator/
Tests in a browser: https://crashoverride1234.github.io/deal-underwriter-calculator/test.html
Data proxy (Cloudflare Worker): https://underwriter-proxy.jamesthorneiii.workers.dev (`/health` shows which providers are live)

---

## 1. What this is

A real-estate deal-underwriting PWA for the Dallas–Fort Worth market:
Step 1 subject property (address autocomplete → keyless auto-fill from
county/realtor.com/RentCast records, satellite site map, public-records
"senses": flood, soil, permits, hail, schools, traffic, crime, ACS) →
Step 2 ARV (auto-suggested comps, appraiser-style adjustment grid,
qualitative ratings, market absorption meter, tax-protest packet, and — as of
today — a comps location map) → Step 3 flip / rental calculator with
stress-test sliders, max-offer back-solver, TX tax reassessment, rent ladder.

Vanilla JS, no build system, no framework. `engine.js` is the pure math core
(UMD, unit-tested); `app.js` is DOM wiring; `index.html` holds all three
pages; `sw.js` is the service worker; `worker/` is the Cloudflare proxy;
`native/` wraps the same files as Capacitor iOS/Android apps built in
GitHub Actions.

## 2. Who the user is

James — a DFW real-estate investor/agent with an active NTREIS MLS
subscription (Matrix). Builds this for his own underwriting first but judges
every feature by "would a non-technical user tolerate this?" Strong
preference for **keyless, zero-setup UX** — he pushed back on API-key signup
friction until keyless paths existed, which is why the Worker proxy is baked
in as the default. Whether he is broker of record (vs sponsored agent) is
unconfirmed — it determines who can sign an NTREIS/Trestle data license.

## 3. How he wants work delivered (important)

- **Every turn ends deployed and live**, not just coded. Cadence per feature:
  implement → verify end-to-end in a browser preview against LIVE APIs (real
  DFW addresses; hand-check the math) → `node tests.js` (72/72 must pass) →
  bump `CACHE_NAME` in `sw.js` → commit + push to `main` → poll the live URL
  for a marker string with no-cache headers to confirm the Pages deploy → tell
  him concretely what to tap/test, with the numbers you verified.
- Any action items for HIM must be a single self-contained numbered list:
  one step per line, direct hyperlinks, exact button/field names, costs
  inline, and pre-written wording for any email/question he has to send.
- Every engine change needs a test in `tests.js`; UI-only changes need
  browser verification instead.
- He tests immediately on desktop and iPhone (Safari → Add to Home Screen)
  after each message.

## 4. Environment / tooling on his PC (Windows 11)

- Node v24 (winget; if `node` isn't found in a fresh shell, refresh PATH from
  Machine+User env). `gh` CLI at `C:\Program Files\GitHub CLI\gh.exe`.
- Local dev server: `serve.ps1` on port 8080 (honors `$env:PORT`);
  `launcher.ps1` is the desktop-shortcut launcher. If 8080 won't bind, an
  orphaned `serve.ps1` holds it (HttpListener shows as PID 4/System) — kill
  powershell processes whose command line contains `serve.ps1`.
- Worker deploys: `npx wrangler deploy` from `worker/` (wrangler is
  OAuth-authed on this PC). Secrets: `echo <key> | npx wrangler secret put NAME`.
- Native binaries build ONLY in GitHub Actions ("Native builds" workflow);
  iOS cannot build on Windows. `native/build-www.mjs` hard-fails on any
  unvendored `<script>`/`<link>` in index.html — new CDN deps must be vendored
  (Leaflet already is).
- Git line endings: files are LF in the repo, Windows warns about CRLF —
  harmless, ignore.

## 5. State as of 2026-08-16

**Just shipped (commit `231866a`)**: comps location map on the ARV page —
Leaflet + Esri imagery below the comp cards, "S" subject pin + numbered comp
pins (gray = unpriced/out of blend), popups with label / price / distance,
in-place pin restyling so typing never closes a popup, label typing clears
stale coordinates, unconditional `invalidateSize()` on ARV entry. Verified
live with 3529 Rogers Ave, Fort Worth (auto-suggest placed 4 comps).
Details + gotchas are recorded in `CLAUDE.md` under "Site map & influence
scan".

**Recent feature run (all live)**: school ratings / traffic / crime / ACS
panel; TAD parcel rung + hail history + printable tax-protest packet; flood /
soil / permit chips; rent ladder + live market scan + rehab pack; max-offer
back-solver; TX post-sale tax reassessment; comp condition read from listing
remarks; blank start on every open; auto-suggested comps on ARV entry.

**Keys / secrets status**:
- Worker `RENTCAST_API_KEY` — SET and live (50 lookups/mo free; only
  HTTP-200s billed; app-side localStorage cache keeps repeats free).
- Worker `MELISSA_API_KEY` — NOT set (user never supplied one; ~1,000 free
  credits/mo if he signs up). Ladder falls through fine without it.
- Worker `HUD_API_KEY` — NOT set; the `/rent` route's Section-8 SAFMR rung
  is coded but dormant. Free token at huduser.gov.
- Workers AI (`[ai]` binding) — live, free daily allocation, used by
  `/vision` (llava) for imagery adjacency reads.
- Google Street View — optional browser-pasted key only (`underwriter-gmaps-key`).
- iOS TestFlight lane in CI is built but no-ops until 4 repo secrets exist:
  `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID` (he HAS an
  Apple Developer account; runbook in `native/README.md`). Play Console
  account still unconfirmed.

**Never commit**: `worker/.wrangler/`, any secret. The repo is public. The
Worker URL is deliberately public in `app.js` (`DEFAULT_WORKER_URL`) — free
tier hard cap means no billing risk; rotate the worker name if abused.

## 6. Open threads / backlog (highest value first)

1. **Shipped-but-shallow polish owed** (from the 2026-08-14 feature-radar
   review): rent-comp rows not rendered in the ladder; `conditionEvidence`
   has no tooltip; market scan missing actives-DOM + trend→variance wiring;
   TAD school/exemption codes unused; per-comp scans lack the public-records
   pass; rehab contingency toggle.
2. Multi-year rental projections with depreciation from the land/improvement
   split; exit-strategy comparator; saved-deal archive (substrate for comp
   alerts + budget-vs-actual); Texas seller-net sheet; BRRRR seasoning.
3. **NTREIS BBO / Trestle** = the endgame for TRUE sold prices (TX is
   non-disclosure; today's comp prices are list-at-sale proxies and the UI
   says to verify against MLS). Path: register as Technology Provider →
   NTREIS BBO connection → 4-party DLA → RESO Web API; ~$100/mo Trestle +
   NTREIS license. When credentials arrive, swap the `/comps` and `/market`
   data source in the Worker.
4. Store submission: Play Console ($25 one-time; personal accounts need a
   12-tester/14-day closed test), signed AAB / TestFlight secrets, a
   privacy-policy URL (offer to generate one on Pages), a proper adaptive
   app icon.
5. Optional: purge an old wrangler account-cache file (account id + email,
   no secrets) from public git history — offered, low stakes.

## 7. Dead ends — do NOT re-research

- Zillow & Redfin unofficial APIs (TLS-fingerprint WAF blocks even
  server-side); Zillow official = partners only; Redfin has no API.
- realtor.com detail endpoints are CORS-blocked from browsers (hence the
  Worker); `operationName` is REQUIRED in the GraphQL POST body or it 400s;
  listing photos are nulled once a listing closes (remarks survive).
- hazards.fema.gov (no CORS; 403/525 for Workers) — use Esri Living Atlas
  NFHL mirror instead. api.census.gov now requires a key — use Esri Living
  Atlas ACS layers. Fort Worth permits (BLDS died 2015) and Fort Worth crime
  point layer (CORS-blocked + stale) — dead; only Dallas Socrata feeds are
  live for permits/crime.
- llava ignores multi-question prompts — one question per `AI.run` call.
- Property-data market survey (July 2026): ATTOM (~$95/mo ≈ 5k calls) is the
  first paid pick if revenue ever exists; Smarty has NO unlimited plan;
  exhaust RentCast + Melissa free tiers first.

## 8. Conventions that bite

- Percent inputs are whole numbers (80 = 80%); the engine divides by 100.
- Missing comp data must produce NO adjustment / NO phantom output.
- Charts and maps update IN PLACE — never destroy/recreate per keystroke.
- Lucide `createIcons()` runs once at load; swapping `data-lucide` later
  does nothing — dynamic icons are inline SVG constants.
- Every open starts BLANK (no restored subject/comps); only adjustment-grid
  settings + API keys persist in localStorage.
- Bump `sw.js` `CACHE_NAME` on EVERY deployable change (currently `v34`).

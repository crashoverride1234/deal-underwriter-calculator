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
  DFW addresses; hand-check the math) → `node tests.js` (99/99) AND `node worker/tests.mjs` (83/83) →
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

## 5. State as of 2026-08-27

**THE MLS FEED IS LIVE (2026-08-27).** NTREIS credentials are set and the app
is serving REAL closed sale prices, closed lease rents and true days-on-market.
Verified end to end on 3529 Rogers Ave, Fort Worth 76109: 12 closed comps in
zip, 128 closed sales + 34 actives + 10 pendings on the market scan (median
DOM 34), 40 closed leases on the rent ladder. The proof it was worth doing:
realtor.com had 3412 Rogers Ave at $649,000 LIST; the recorded NTREIS close
was $550,000 — a 15% overstatement that would have gone straight into an ARV.

NTREIS-specific truths, all read off their metadata rather than guessed
(re-run `/mls/probe` after any schema change — it emits a ready-to-paste
field map): they have MIGRATED TO RESO field names; the Property resource has
ONE class called `Property`; status and type are CODED (`CLS`/`ACT`/`ACTUC`/
`PND`, `RESI`/`RLSE`) and sending labels matches nothing; there is NO
UnparsedAddress (compose from components), NO ConcessionsAmount (only a Y/N
flag), NO PropertyCondition, and annual tax is `UnexemptTaxes`.
`BathroomsTotalDecimal` is deliberately unbound — NTREIS writes "2 full + 1
half" as 2.1, not 2.5. DMQL2 has no radius operator, but Latitude/Longitude
accept the `value+`/`value-` suffixes (negatives included), so comps are
bounded by a real BOUNDING BOX around the subject and trimmed to a circle —
verified crossing ZIP boundaries, which postcode filtering could never do.
Postcode is only the fallback when a row has no coordinates, and a search
with neither is REFUSED rather than returning closings from anywhere in
North Texas. All of this is in `worker/wrangler.toml`
with the reasoning inline.

Operationally: NTREIS allows ONE session per login and Workers isolates share
no state, so the fetch handler releases the session via `ctx.waitUntil` on
every request — without that, cold isolates fail at random with ReplyCode
20022. Concurrent calls get 20512 "too many outstanding requests", so every
RETS operation goes through a serial queue.

Earlier the same day: the rework itself — a licensed RESO Web API / classic
RETS feed became the PRIMARY source for property records, comps, market scan
and rent, with realtor.com / RentCast / Melissa / TAD demoted to automatic
fallbacks. Every route degrades cleanly on auth failure, empty result or
timeout. New: `/mls/probe` diagnostic, `worker/tests.mjs` (79 tests),
seller-concessions netting in `appraise()` (URAR grid line 1), closed-lease
preference in `rentFromComps()`, structured `PropertyCondition` over remarks
prose in `classifyCondition()`, median-DOM in `marketTrend()`, per-comp price
provenance badges, and a licence guard that withholds MLS-sourced line items
from the tax-protest packet. Details in `CLAUDE.md` under "MLS feed".

**Previously shipped (commit `231866a`)**: comps location map on the ARV page —
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
- Worker MLS — LIVE. `MLS_RETS_USERNAME` / `MLS_RETS_PASSWORD` are set as
  secrets; everything non-secret is in `worker/wrangler.toml`. GOTCHA that
  cost a debugging round: `keep_vars = true` means a var DELETED from that
  file stays on the deployed worker forever — only an explicit `""` clears
  it. Second gotcha: secrets are baked into a VERSION, so a secret added
  after the last deploy needs a redeploy before the running worker sees it.
  Diagnostics: `/mls/probe`, and `/mls/probe?logout=1` clears a stuck session.
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
3. **MLS feed — BUILT 2026-08-27. NTREIS confirmed as CLASSIC RETS.**
   James pasted a real NTREIS login response on 2026-08-27:
   `https://ntrdd.mlsmatrix.com/rets/Login.ashx` (CoreLogic Matrix,
   ReplyCode 0, user id redacted), capabilities Login / Logout / Search /
   GetMetadata / GetObject / Update / PostObject. So the RETS transport is
   the live path, not the RESO one. That paste immediately caught a real
   bug — NTREIS packs every capability `key=value` onto ONE space-separated
   line, and the line-based parser read the whole block as a single key and
   found no Search URL. Fixed and pinned by tests using the verbatim
   response. Still needed from him: the RETS username/password as worker
   secrets, then `/mls/probe` output so the field map can be written (a
   RETS server does NOT use RESO Data Dictionary names — the probe reads
   METADATA-TABLE and suggests the map).

   Original licensing notes: The whole rung
   ships: both transports (RESO Web API + classic RETS), all four routes
   (`/lookup`, `/comps`, `/market`, `/rent`), the `/mls/probe` diagnostic,
   47 unit tests, and the licence-compliance guards. It is INERT until the
   Worker secrets exist — see `worker/.dev.vars.example` and the "MLS feed"
   sections of `worker/README.md` and `CLAUDE.md`.
   What is still needed from James is paperwork, not code:
   - NTREIS calls the back-office product **"Broker RETS Access for In-House
     Office Use"** (they do NOT use the term "BBO"). Request the agreement
     from **dataaccess@ntreis.net**, describing the intended use; credentials
     then come from **rets@ntreis.net**. NTREIS runs its own RETS server
     (matrixrets.ntreis.net, RETS 1.8) on a Matrix backend — which is why the
     classic-RETS transport exists alongside the RESO one.
   - IDX **cannot** carry sold prices or full remarks, and VOW blacklists
     selling price in Texas. Back-office is the only product that works.
   - The **Designated Broker must sign** — a sponsored agent cannot hold data
     access alone. Confirm who that is.
   - Trestle is the other path (published evidence of carrying NTREIS;
     "IDX Plus" = on-market + 7 yrs of Sold incl. selling info). Trestle's own
     2026 fee is $30/mo for a broker data feed, on top of NTREIS's.
   - Open question that decides everything: Rule 15.03(b) grants the
     valuation right to a licensee "acting as agent for an owner(s),
     buyer(s) or tenant(s)". Underwriting for one's OWN account as a
     principal may fall outside it. Ask NTREIS in writing.
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
- Bump `sw.js` `CACHE_NAME` on EVERY deployable change (currently `v42`).
- Two test suites now: `node tests.js` (85) AND `node worker/tests.mjs` (83).
- MLS credentials NEVER go in the browser — Worker secrets only. There is
  deliberately no paste-a-key field for them, unlike RentCast/Melissa.

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
  0–3/4–6/7–12-month sold buckets, ±3% = flat; also `medianDom` per bucket
  and trailing-year, null unless the feed carries days-on-market),
  `rentFromComps()` (median $/sqft × subject sqft; CLOSED leases displace
  asking rents outright rather than averaging with them — `basis` says
  which). `classifyCondition(text, propertyCondition)` prefers a structured
  MLS PropertyCondition over mining the remarks prose, and reports which it
  used via `from: 'field' | 'remarks'`. underwrite() also models draw-based vs Dutch
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
- `worker/` — Cloudflare Worker proxy. Holds the licensed **MLS feed** (the
  primary source; see "MLS feed" below), keyless property auto-fill
  (realtor.com GraphQL), and optional RentCast/Melissa via Worker secrets.
  `worker/tests.mjs` (`node worker/tests.mjs`) unit-tests the MLS transport:
  normalizers against synthetic RESO and RETS payloads, MD5 against the RFC
  1321 vectors, HTTP Digest against the RFC 2617 worked example, and the
  capability parser against NTREIS's verbatim login response. That is the
  only verification possible without licensed credentials. Extra named
  exports at the bottom of `worker.js` exist for that harness; Cloudflare
  only consumes the default.
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
- **Test**: `node tests.js` (85 tests as of 2026-08-27) AND `node worker/tests.mjs`
  (79 MLS-transport tests). Both must pass before deploy.
- **Deploy app**: commit + push to `main` → GitHub Pages redeploys in ~20s.
  Verify by polling the live URL for a marker string with no-cache headers.
- **Deploy worker**: `npx wrangler deploy` from `worker/`.
- **Native builds**: push to `main` (or Actions → "Native builds" → run) and
  download the artifacts. Store signing/submission: `native/README.md`.
- Project norm: verify features end-to-end in the browser preview (including
  live API calls) BEFORE pushing; then push and confirm the Pages deploy.

## MLS feed — the primary source (added 2026-08-27)

Everything in the next section exists because the app had no MLS licence.
With one configured, those sources become the FALLBACK and the feed answers
with the actual transaction record. All of it lives in `worker/worker.js`
under "MLS feed", gated by `mlsConfigured(env)` — **inert until the secrets
exist**, so an unconfigured worker behaves exactly as it did before.

- **Two transports.** `reso` = RESO Web API (OData v4 + OAuth2
  client_credentials bearer; Trestle/Cotality, Bridge, MLS Grid, Spark).
  `rets` = classic RETS 1.7.2/1.8 (Login handshake → DMQL2 →
  COMPACT-DECODED). "A RETS feed" means either one in 2026, hence both.
- **NTREIS is the RETS one** (confirmed from a real login response
  2026-08-26): CoreLogic Matrix at `https://ntrdd.mlsmatrix.com/rets/`,
  capabilities Login/Logout/Search/GetMetadata/GetObject/Update/PostObject.
  Two things that response proved and that a naive client gets wrong:
  the capability URLs are **absolute**, and every `key=value` sits on **ONE
  line separated by spaces** rather than one per line as the spec's examples
  show. `retsCapabilities()` handles both shapes, and an EMPTY value
  (`MemberName=`) must not swallow the pair after it — NTREIS sends two.
- **Credentials are Worker secrets ONLY.** A data licence forbids shipping
  them to a browser, so unlike RentCast/Melissa there is deliberately no
  client-side paste path. Full annotated list: `worker/.dev.vars.example`.
- **Field names default to RESO Data Dictionary 2.0**; `MLS_FIELD_MAP` (JSON)
  overrides any single entry. `/mls/probe` reports the server's actual field
  list so the map is written from evidence, not guesswork.
- **Routes**: `/lookup` gains an MLS rung that OVERLAYS every rung below it
  (a listing knows the house; it rarely knows the tax roll or owner) while
  obeying the same "no tax bill ⇒ don't end the ladder" invariant TAD obeys.
  `/comps` returns MLS closed sales and drops the proxies entirely once 3+
  are found — a verified close price and a list-at-sale guess are different
  KINDS of number and must not be ranked in one list. `/market` gets true
  closes + real statuses + a separate Active-Under-Contract bucket. `/rent`
  gets closed LEASES (transacted rents, free) and skips the billable
  RentCast AVM when it has 3+. Every route falls back on auth failure,
  empty result, or timeout, and surfaces the reason in `providerErrors`.
- **`priceTruth`** (`closed` | `mixed` | `proxy` | `none`) rides on `/comps`
  and `/market`; the client's "TX non-disclosure, verify against MLS" hedge
  is now conditional on it instead of being blanket-true.
- **Gotchas** (all researched against primary sources 2026-08-27):
  Trestle `$top` defaults to **10**, caps at 1,000. NO `$select` is sent by
  default — naming a field the feed doesn't publish rejects the whole query.
  Lat/Lon are NOT index-accelerated (only ListingId/ListingKey/
  ModificationTimestamp/PhotosChangeTimestamp/PhotosCount/PostalCode/
  StandardStatus are), so a geo filter is the query most likely to 504 — a
  timeout auto-retries narrowed by PostalCode. `geo.distance()` works on
  Trestle's `X_Location` GeographyPoint but is a vendor extension, so the
  portable lat/lon bounding box + haversine trim is the default and
  `MLS_GEO_FIELD` opts into the former. `BathroomsTotalInteger` is a SIMPLE
  SUM (2 full + 1 half = 3, not 2.5) — prefer `BathroomsTotalDecimal`, then
  the components. `Levels` beats `StoriesTotal` (the latter counts the
  BUILDING, wrong for a condo unit). `ConcessionsAmount` is back-office
  payload only and ~40% populated: null means "not reported", never $0, so
  the separate `Concessions` Yes/No flag rides along as
  `concessionsReported`. StandardStatus enum members are compact
  (`ActiveUnderContract`) unless `PrettyEnums=true` — both spellings are
  queried, each status group is its own fault-tolerant query, and values are
  prettified for DISPLAY only, never for filtering. Classic RETS is one
  session per login (a second Login silently kills the first, ReplyCode
  20022) so logins are single-flighted; `/mls/probe?logout=1` clears a stuck
  one. Workers has no cookie jar — the RETS session cookie is replayed by
  hand — and no DOMParser, so COMPACT-DECODED is parsed with regex.
  `redirect: 'manual'` on every RETS call: Workers replays Authorization and
  Cookie across a redirect, including to another host.
- **RETS auth**: Basic is tried first and a 401 carrying a Digest challenge
  is negotiated automatically (Matrix commonly rejects Basic); the challenge
  and its nonce-count live on the session and every request signs
  path **and query** (a Search.ashx call is almost entirely query). A
  mid-session 401 means a stale nonce — the session is dropped and the
  search retried once. `RETS-UA-Authorization` follows RETS 1.7.2 §3.10
  exactly: `MD5( MD5(product:UA-password) : request-id : session-id :
  version )` with an empty request-id, so `a1:::version` at login and
  `a1::sessionId:version` afterwards. Reply codes 20041/20037 mean the
  server wants that header.
- **MD5 is implemented in `worker.js`**, not taken from
  `crypto.subtle.digest('MD5')`. That call works on Cloudflare (non-standard
  extension) but on no other runtime including Node, so the auth paths would
  have been untestable. Verified against all RFC 1321 vectors, the RFC 2617
  worked example, and 700 random inputs cross-checked against Node crypto.
- **NTREIS/Matrix specifics** (live-probed 2026-08-27): Matrix advertises
  ONLY Digest — no Basic scheme is offered on any capability endpoint, and
  each endpoint issues its OWN challenge, so Authorization goes on every
  request. The nonce is base64 of a server timestamp and ages out;
  `stale=true` means re-digest with the new nonce, NOT re-login (re-login
  on a one-session server can collide with the session already held). The
  residential class is **`Listing`**, not `RES` — NTREIS's own published
  example is `CLASS=Listing&searchtype=Property`; resources map
  Property→Listing/Cross Property, Media→Media, Agent→Agent, Office→Office,
  OpenHouse→Open House. Matrix accepts RETS/1.5, 1.7.2 and 1.8 and echoes
  the version back, defaulting to 1.7.2 on anything unrecognized. Offset is
  1-based; `<MAXROWS/>` marks a capped result set. Without an explicit
  `Format` the server returns STANDARD-XML, which this parser cannot read.
  If UA auth ever fails with 20037, note clients disagree on whether
  version-info is `RETS/1.7.2` or `1.7.2` — we send the full header form.
  `Count` is sent as 0 (CoreLogic asks clients not to make Matrix count in
  production); `Select` is auto-built from `MLS_FIELD_MAP` once that map is
  substantial, pinning the schema against future NTREIS field additions.
  NTREIS also asks for no large pulls 08:00–18:00 Mon–Fri, incremental
  searches ≥15 min apart, and excluding their test area (MLSAreaMajor 1001,
  which "can cause your RETS download to fail") plus 1000 (outside the US) —
  that is what `MLS_RETS_QUERY_EXTRA=(MLSAreaMajor=~1000,1001)` is for.
- **DMQL2 punctuation is overloaded and silently inverts intent.** Between
  parenthesized criteria a comma means AND; INSIDE a value list it means OR.
  `(Status=|A,S)` is "A or S"; `(Status=|A),(Status=|S)` is "A and S" —
  always empty, no error. The pipe is a value PREFIX, not a separator; the
  tilde negates. The trailing `+` ("or later") must reach the server as
  `%2B` — URLSearchParams does that; a raw `+` decodes to a space and
  becomes a syntax error. Date floors are widened a day because the server
  keeps GMT while NTREIS data is Central.
- **Query with CODES, not labels.** `Format=COMPACT-DECODED` decodes only
  the RESPONSE. A query still needs the coded lookup value, so on Matrix
  `Closed` matches nothing where `S` works. This is the single most common
  way a RETS query returns zero rows and looks like a quiet market —
  `/mls/probe` reads METADATA-LOOKUP_TYPE for the status field and prints
  the value=label pairs to copy into `MLS_STATUS_*`.
- **The TRAILING `<RETS-STATUS/>` wins over the envelope.** Matrix
  routinely returns `<RETS ReplyCode="0">` and then contradicts it with a
  trailing 20201 (no records) or 20208 (truncated). Reading only the envelope
  reports an empty result set as a clean success. 20201 is an empty answer,
  20208 still carries good rows plus a truncation flag, and `<MAXROWS/>`
  marks the same thing.
- **RETS field names are NOT RESO names** — this is the one that would
  otherwise waste a day. `StandardNames` defaults to **0** (the server's own
  SystemNames), and `/mls/probe` reads METADATA-RESOURCE / METADATA-CLASS /
  METADATA-TABLE and emits a **`suggestedFieldMap`** ready to paste into
  `MLS_FIELD_MAP`, plus `unmatchedFields` for what it could not bind.
  Matching is exact against StandardName then SystemName — never fuzzy,
  because a fuzzy match would silently bind the wrong column to a price.
  `?class=X` inspects a different class (the lease one, say).
- **Licence compliance is a design constraint, not a footnote.** NTREIS
  Rule 15.03(b) bars a licensee from supplying confidential MLS information
  as supporting documentation to a third party, and Rule 8.08 Note 2 makes
  Texas sale prices confidential. The tax-protest packet therefore WITHHOLDS
  the line items of any MLS-sourced comp (`mlsSourcedCompLabels()` in
  app.js) while keeping the derived value conclusion, which is permitted,
  and explains the omission in the printed packet. Rule 17.01 forbids
  blending MLS with non-MLS data, and 16.06/17.23/19.16 permit augmentation
  only when the non-MLS source is clearly identified and visually separated
  — hence the per-candidate source badges and the proxies being dropped
  wholesale once the feed delivers. `MLS_ATTRIBUTION` carries the licence's
  own required wording through `/health` and `/comps` to the UI.
  MLS-sourced records in the browser cache expire after 12 h
  (`MLS_CACHE_TTL_MS`); non-MLS records still never expire.

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
- Appraisal model semantics (all deliberate, all tested): SELLER CONCESSIONS
  come off the price FIRST (URAR grid line 1) giving a cash-equivalent
  basis, then the time adjustment, then % adjustments
  (condition/qualitative) on the time-adjusted basis. Only an MLS feed knows
  concessions; absent ⇒ 0 ⇒ every number is bit-identical to the
  pre-concessions engine (tested). `pricePerSqft` is quoted cash-equivalent.
  Renovated comps take no age adjustment (effective age); the sqft
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
  `underwriter-property-cache-v4` (v4: entries carry `_cachedAt`; MLS-sourced
  records expire after 12 h for licence retention, everything else never
  does). There is deliberately NO localStorage key for MLS credentials.
- Never commit `worker/.wrangler/` (gitignored) or any secrets; the repo is
  public. The deployed Worker URL is deliberately baked into `app.js` as
  `DEFAULT_WORKER_URL` (zero-setup auto-fill was chosen over URL secrecy;
  Workers free tier has a hard daily cap, so no billing risk — rotate the
  worker name if abuse ever shows up).

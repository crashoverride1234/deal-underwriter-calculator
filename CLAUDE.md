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
  $100; reports unachievable and price-independent-unbounded cases),
  `breakEven()` (same bisection, solving for the sale price / rent that nets
  zero, plus the rent a 1.25 lender DSCR needs; rounds UP so the answer never
  undershoots), `bracketingDefects()` (does the comp set SURROUND the subject),
  `neighborhoodTaxRate()` (median effective rate off the comps' own bills —
  closed prices only, null under 3, so a MUD/PID district is distinguishable
  from a bad assessment) +
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
- `backtest.mjs` — accuracy harness: `node backtest.mjs --n 40`. Scores the
  engine against real closed NTREIS sales with an AS-OF reconstruction (the
  comp window is anchored at the test sale's close date, a 7-day reporting lag
  is excluded, rows whose `ModificationTimestamp` is later than the anchor are
  rejected because MLS rows mutate after closing, and the subject is removed
  from its own comps by id, parcel AND street line). Reports the IAAO panel,
  not MdAPE alone — COD under 5 is a sales-chasing red flag, not a win.
  Also reports comp-adjustment asymmetry POOLED across every comp of every
  sale, anchored on each sale's known close price — the only exogenous
  reference there is, and the only scale at which four-comp blends resolve
  anything.
  `--compare-condition` / `--compare-comps` / `--compare-rate` run a PAIRED
  test: the same sales through both variants, sign test plus a deterministic
  bootstrap. Paired is the point — between-property variance dominates two
  independent MdAPEs, so at the low-hundreds sample this tool will ever have,
  only the paired design can resolve a real change. Results append to
  `backtest-results.json` (gitignored) so runs accumulate.
  **Any accuracy claim about this app must come from here.** In-sample metrics
  on a small local model roughly halve the true error.
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
- **Test**: `node tests.js` (158 tests as of 2026-08-28) AND `node worker/tests.mjs`
  (106 MLS-transport tests). Both must pass before deploy.
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
- **Routes**: `/lookup` LEADS with the MLS rung — see "The subject ladder"
  under Conventions. A listing knows the house; it rarely knows the tax roll
  or the owner, so it folds with TAD rather than replacing it the way
  `/comps` drops its proxies.
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
  residential class probes as **`Property`** (`MLS_RETS_CLASS = "Property"`
  in wrangler.toml) — the Property resource publishes exactly ONE class. The
  2015 guide's `CLASS=Listing` and the older `RES` are both wrong for this
  account; `/mls/probe` lists the real classes, so check it before trusting
  any of them. Other resources map Media→Media, Agent→Agent, Office→Office,
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
- **Geography on RETS is a bounding box, not a postcode.** DMQL2 has no
  radius operator, but Latitude/Longitude are ordinary numeric fields and the
  `value+` / `value-` suffixes work on them — including on negative
  longitudes — so four criteria bracket the subject and `mlsSearch()` trims
  the box to a circle with haversine. Do NOT use the range form
  (`Latitude=32.69-32.73`): the minus is simultaneously separator, "or less"
  suffix and sign, which makes a negative longitude range genuinely
  ambiguous. Postal boundaries follow mail routes, so a comp 0.1 mi away
  across the street can be in another ZIP while a poor one two miles off
  shares yours — postcode is only the fallback for rows with no coordinates.
  `mlsComps()` widens the radius (2x, then 4x) when the first box holds
  fewer than 5, and keeps the earlier result if the wider pass fails.
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

- **Photos: shipped to the HUMAN, never to a model** (`/mls/photo`,
  `openPhotoViewer()` in app.js). RETS GetObject serves photos for CLOSED
  listings on NTREIS (verified live on a July-2026 close — unlike realtor.com,
  which nulls them). The research settled the direction: CV condition scoring
  measures 0.3–0.4 MAPE points at ~60% accuracy while human labels beat CV,
  so the viewer shows the roll and three buttons; a press becomes the comp's
  condition with evidence "photos — your read", outranking the remarks
  classifier and clearing `conditionUnverified` (which narrows the
  `valuationInterval()` band). Facts that cost a round each: GetObject
  addresses by `ListingKeyNumeric` (the MLS number is rejected); object 0 is
  an alias of 1, so the viewer pages 1..PhotosCount; METADATA-OBJECT
  (`/mls/probe?objects=1`) says the real types are Photo/LargePhoto/XXLarge/
  HighRes but only **HighRes returns full resolution** (~93 KB, 1024px) — the
  other three all serve the same ~11 KB small image, and an UNKNOWN Type is
  silently substituted rather than rejected, hence the whitelist. Matrix can
  return its error XML with HTTP 200, so the body's content type decides.
  Licence: on-screen only, browser-private cache 12 h, never in the protest
  packet, no localStorage.

## Conventions

- Percent inputs are whole numbers (80 = 80%); the engine divides by 100.
- Missing comp data must produce NO adjustment, not a phantom one.
- **A blank input restores the OLD constant, bit-for-bit.** Three flip numbers
  became overridable on 2026-08-28 (`monthlyTaxesIns` on the flip leg,
  `sellingCostPercent`, `arvCapPercent`), and each is guarded by `has()` rather
  than `||` so an explicit **0 is honoured as an answer** while blank falls back
  to `DEFAULTS`. That is what let 127 existing tests pass untouched, and it is
  the pattern any future defaulted input must follow. Do NOT "simplify" these
  to `num(x) || DEFAULT` — that silently turns a deliberate zero into the
  default.
- **The flip pro-forma pays taxes and insurance.** `engine.js` used to read
  `strategy === 'flip' ? flipBaselineMonthlyCarry : monthlyTaxesIns`, discarding
  the user's figure on the flip leg for a flat $300/mo, while
  `updateTaxProjection()` was already deriving the correct FLIP-basis reassessed
  bill and rendering an adopt button into a container `switchStrategy()` hid on
  flip. A $400k DFW flip at 2.3% effective is ~$767/mo of tax alone. The
  carrying-cost section is deliberately visible for BOTH strategies now — if you
  ever re-hide it, the engine silently reverts to the placeholder.
- **"DSCR" is two different numbers and they land on opposite sides of 1.25.**
  `dscrRatio` is NOI (net of vacancy and the opex slider) over debt service —
  the commercial 5+ unit convention, useful as the analyst's coverage.
  `lenderDscr` is gross scheduled rent over PITIA, which is what a 1–4 unit
  DSCR lender actually underwrites, and it is `null` when there is no note.
  On the default rental these read 0.57 and 1.38: the card that claims lender
  approval MUST use `lenderDscr`. Insurance has its own input for the same
  reason — PITIA needs it, and the tax adopt-button writes taxes+HOA only, so
  folding insurance into that field let one click zero it out of the deal.
- **`breakEven()` bisects the real model; it is not `costs / (1 - rate)`.**
  Selling costs scale WITH the sale price, so the answer is costs grossed up by
  the exit rate — and on a hard-money deal the loan is itself a function of ARV,
  so a closed form would quietly ignore that coupling. It solves on the RAW
  price with `variancePercent: 0`, because the stress slider is a test applied
  to a price, not part of the price being solved for. The chart's grey segment
  is `arv − netProfit` (costs recovered at sale) and has never been this number
  — it is labelled accordingly, so don't "fix" it back.
- **Bracketing is a separate question from comp agreement.**
  `valuationInterval()` measures how much comps disagree with each other and
  `scoreComp()` rates them one at a time; neither can see a set that agrees
  closely and sits entirely on one side of the subject, which is a narrow band
  around an EXTRAPOLATION. `bracketingDefects()` fills that gap, and an EXACT
  match brackets a feature on its own (that is the ideal comp, not a gap). Read
  `appraisalComps`, never `lastAppraisal.comps` — `appraise()` emits no
  sqft/beds/yearBuilt.
- **Cite live rules, and date them.** Fannie ELIMINATED the 15%/25% net/gross
  adjustment guidelines in Selling Guide B4-1.3-09 (2025-06-04), so the >25%
  warning is framed as a hint ("being argued into place"), not policy. Fannie
  B4-1.1-04 names crime-rate references an Unacceptable Appraisal Practice, so
  the crime and ACS chips carry `.no-print` — private underwriting input is
  fine, but a licensed agent putting them in a document handed to a third party
  is fair-housing exposure. FHA's day-91 / 2× resale rules are printed with
  their date because FHA is publicly pursuing repeal.
- **Comp selection is filtered at the SOURCE, not sorted out afterwards.**
  The MLS query carries sub-type, a ±35% size band and ±1 bedroom alongside
  the geographic box, because the row cap is spent on whatever the server
  returns first — an unfiltered query fills it with a studio condo and a
  mansion and the best comps are never fetched at all. `mlsComps()` widens
  geography before it loosens the material bands.
- **That rule applies to LEASES too — `mlsLeases()` was the one call site that
  never got it** (fixed 2026-08-28). It passed neither sub-type nor size/bed
  bands, so a 1-mile 40-row newest-first pull could fill with apartments and
  townhomes and `rentFromComps()` would median their $/sqft into rent → NOI →
  DSCR → cash-on-cash. It now carries the same bands and **widens once** if the
  tight box holds fewer than 3 closed leases, so a thin market never ends up
  worse than it was before the filter existed. Lease sub-types live in their own
  `MLS_LEASE_SUBTYPES` var, NOT `MLS_SUBTYPES`: the lease class may publish a
  different lookup, and DMQL2 answers an unknown code with an empty result set
  rather than an error — a wrong guess would look like a quiet rental market and
  fall through to a billed RentCast AVM. Unset means "don't filter", never
  "guess". Confirm the coded value with `/mls/probe` before setting it.
- **`mlsDom()` measures list-to-CONTRACT.** Its fallback used to run to the
  CLOSE date, which overstates marketing time by the whole financing period
  (measured ~30-day median lag on this feed) — while the UI copy described time
  to go under contract. It now prefers `PurchaseContractDate` (100% populated on
  NTREIS) and only falls back to close date when that is absent.
- **The subject lookup is filtered at the source too, and its address guard
  fails CLOSED.** `mlsRecord()` shipped asking RETS for nothing but status +
  property type — the OData `contains()/startswith()` filter was skipped for
  RETS (correctly, DMQL2 has neither) and nothing replaced it — then picked
  the first row whose address matched. That guard read `f.address`
  (`UnparsedAddress`), which NTREIS does not publish, so the candidate was
  always empty; `streetMatch()` fails OPEN on an unparseable side, so row 0 of
  an unfiltered whole-MLS query was accepted as the subject. Net effect: every
  address returned the same listing, and because the MLS rung carries
  `UnexemptTaxes` it satisfied the "has a tax bill" test and ended the ladder
  before any other provider could correct it. Three rules fall out. DMQL2
  filters on the PARSED components (`(StreetNumber=900),(StreetName=ROSEDALE*)`
  — prefix, since StreetName holds neither the directional nor the suffix),
  with a second pass on house number alone because DMQL2 string comparison is
  case-sensitive on some servers. Any row's street line must come from
  `mlsStreetAddress()`, never the raw field. And `streetMatchStrict()` is used
  wherever the address is the ONLY thing tying a row to the subject —
  `streetMatch()`'s fail-open is correct ONLY where parcel geometry or a
  resolved `mpr_id` already established the property (TAD, realtor enrich).
  Verified live: 5/5 Dallas addresses return their own record, exact sqft and
  year. `dmqlToken()` strips DMQL2 punctuation from any interpolated value —
  a stray comma or pipe silently rewrites the query rather than erroring.
- **The subject ladder LEADS with the feed, and exhausts every free rung
  before a billable one.** `/lookup` is a FOLD over an authority-ordered
  stack, not a chain of early returns: MLS (address-confirmed) → RentCast →
  Melissa → TAD → realtor.com → MLS (proximity-only). `mergeRecords()` never
  overwrites, so the ORDER of that array is the whole specification.
  Three things it fixes, all measured live 2026-08-28 before the change:
  (1) TAD + realtor returned FIRST in Tarrant and the MLS rung never ran at
  all — 3425 Cloer Drive came back 2042 sqft / built 2024 against the feed's
  1306 / 1948, and the roll's own `DEED_DATE` showed TAD had not seen the
  2026 sale, so the feed was right and the county was stale.
  (2) The stop gate was `if (merged.annualTaxes) return`, written twice —
  HALF the test, because `projectPropertyTax()` and `protestOpportunity()`
  both compute annual ÷ assessed and bail unless BOTH are > 0. NTREIS
  publishes no assessed-value field at all (443 fields probed; only
  `UnexemptTaxes`, `TaxBlock`, `TaxLot`, `TaxLegalDescription`,
  `SpecialTaxingEntities`, `RoadAssessmentYN`), so every non-Tarrant MLS hit
  ended the ladder with both tax features dark. The gate is now
  `recordIsComplete()` over `LADDER_COMPLETE_FIELDS = ['assessedValue',
  'annualTaxes']`.
  (3) The keyless realtor.com rung ran AFTER billable RentCast, even though
  it carries assessed value and the tax bill TOGETHER when it answers
  (measured 3/3 Dallas). That ordering — not the MLS gate — was the real
  credit leak. Measured after: 9/9 addresses MLS-led with sqft matching the
  feed exactly, `assessedValue` missing on 0 (was 5), `lastSalePrice` missing
  on 0 (was 3), RentCast reached only on the 2 addresses realtor.com has no
  record for at all.
  Unlike `/comps`, which DROPS its proxies wholesale once the feed delivers,
  `/lookup` folds: `mlsToRecord()` hard-nulls `assessedValue`, `ownerNames`,
  `ownerMailing`, `legal` and `apn`, so the feed and the county roll are
  complements. "Enough" is therefore a MATCH STANDARD, not a row count —
  `mlsAnsweredSubject()` requires `matchedBy === 'address'`
  (`streetMatchStrict`) plus the `hasData()` bar; a `'proximity'` row is
  demoted to LAST in the stack, where it fills blanks but can never overwrite
  the roll with a neighbour's square footage. An unconfigured worker folds to
  a byte-identical result (tested), which keeps the "inert until the secrets
  exist" invariant.
- **The time adjustment is DERIVED and anchored on the CONTRACT date.** The
  `/trend` route does a WIDE pull — same geography, deliberately NO size or
  bedroom bands, 18 months — because a banded sample confounds price movement
  with composition drift. `deriveTimeAdjustment()` aggregates to MONTHLY
  MEDIANS of $/sqft before fitting: on a real 300-sale Fort Worth pull the raw
  scatter fitted −25%/yr at R² 0.019, which the t-test waved through purely
  because n was large. It then judges the CONFIDENCE INTERVAL, not a bare
  t-statistic — a CI from −26% to +51% is an honest shrug, and applying its
  midpoint to a year-old comp turns that shrug into dollars. Measured across
  three DFW submarkets the reading is flat to slightly soft, so the old
  hard-coded +2%/yr default was adding several points of upward adjustment to
  every older comp. `compMonthsAgo()` ages comps from `PurchaseContractDate`
  (100% populated on NTREIS; measured median lag to close is 30 days), because
  close-date anchoring is late by that much on every comp in the same
  direction. Measured effect: small but consistently favourable —
  over-by-20% fell 27.3% → 23.9%, paired z=1.68, not significant on n=88.
- **The retail over-valuation is the CONDITION LINE, not comp selection**
  (`compAdjustmentAsymmetry()`, `pooledRetention()`, added 2026-08-28). The
  hypothesis under test was CoreLogic's (Mayer & Nothaft): 69% of
  appraiser-picked comps sit ABOVE the subject and premium comps get adjusted
  down more gently than discount comps get adjusted up. Measured on the live
  feed, **the selection half does not replicate and cannot** — 47.7% of retail
  comps sit above the known close price against CoreLogic's 69%, because
  `scoreComp()` ranks on size, distance, age and rooms and never reads price
  at all. The adjustment half is real (retail pooled, 528 comps: retention
  1.022 above against 0.498 below) but it is **one line's doing**.
  `conditionAdjPct` is `{renovated: 0, average: 10, dated: 20}` — a RATCHET
  with no negative arm, so a comp inferior to the subject is lifted while a
  comp SUPERIOR to it can never be marked down. 42% of blended comps read
  average or dated. Paired `--compare-condition` at n=110: turning it off moves
  median ratio 1.081 → 1.034 and median signed error 8.11% → 3.42%, sign test
  **z=2.4, B better**. On the retail stratum alone (n=97) ratio 1.068 → 1.015
  and signed error 6.78% → 1.49%, but z=1.8 — **the level shift is large and
  consistent; the per-deal accuracy gain is not significant.** Read that as a
  UNITS MISMATCH before reading it as a bug: the engine emits ARV with the
  subject assumed renovated (`index.html` says so out loud) and the back-test
  scores it against as-is close prices, so the gap IS the after-repair premium.
  The open item is that `appraise()` has no `subject.condition` input at all,
  so a user underwriting as-is value has no way to say so.
- **That diagnostic must never derive its own reference, and its null is not
  zero.** Two traps, both measured, both pinned in `tests.js`. (1) A reference
  built from the comps is circular: `deriveMarketRates()` takes the GLA rate
  from the same median $/sqft on **127 of 180 real comp sets (70.6%)**, so fed
  a market where every house trades at exactly $200/sqft — asymmetry
  impossible by construction — the statistic returns retentionAbove **0.634**
  against CoreLogic's published **0.64**. It would have read as a replication
  of the literature while measuring `GLA_FRACTION_OF_PPSF`. The ARV is
  disqualified too (`sum(w*(A-ARV)) = 0` identically; it put 29% of comps above
  the subject where the truth was 46%). So `opts.reference` is REQUIRED with no
  fallback, which is what confines the slopes to `backtest.mjs`. (2) A
  self-consistent grid traces `y = -x/(1+x)`, which is convex, so a perfect
  grid still reads a retentionGap near **+0.33** — read the number against that
  floor, never against zero.
- **A per-deal asymmetry warning was built, measured and WITHDRAWN.** "Every
  comp in this blend was adjusted upward" separated by +4.3 points of median
  signed error on one 156-sale sample and by **+0.3 on an independent
  132-sale one**, while firing on a third of all deals. Two draws from the same
  feed disagreeing that far is sampling noise. Slope-based rules were worse —
  a retention gap over 0.40 fired on deals averaging 3.5% error against 5.8%
  for the rest, i.e. BACKWARDS. `slopesAreCalibrated: false` and nothing is
  rendered; four comps cannot support a two-sided regression, so pool them
  with `pooledRetention()` across hundreds of sales instead. This is the
  `tierIsCalibrated` lesson applied before shipping rather than after.
  Also checked and eliminated: the `1 - grossAdjPct/50` weight function does
  tilt toward expensive comps (within-sale corr(price, weight) = +0.48) but
  moves the conclusion by a median of −0.01%, so it is not the cause.
- **Confidence is a STATED INTERVAL, not a label** (`valuationInterval()`).
  Measured error varies six-fold across DFW submarkets (Pleasant Grove 31%
  MdAPE vs Fort Worth southeast 5.6%) and the old spread-only label could not
  tell them apart. Width comes from comp disagreement, mean gross adjustment,
  local $/sqft dispersion (INTERQUARTILE — max-minus-min is set by whichever
  single house is weirdest), comp count, unverified-condition share, and
  whether a market trend was measurable at all. Every contributor is NAMED in
  the UI, because "low confidence" is a shrug and "local $/sqft varies by 33%"
  is actionable. MEASURED n=84: the band WIDTH is about right — 77.4% coverage
  against a 68% target — but the high/medium/low TIERS RANK BACKWARDS (deals
  labelled low came in at 7.4% MdAPE against 10.4% for high and medium).
  Something in the width drivers correlates with dense, data-rich
  neighbourhoods where the engine does well. So `tierIsCalibrated: false` and
  the UI shows the ± width rather than a word: a label that misranks is worse
  than no label. Re-tune the multipliers from `backtest.mjs` coverage before
  presenting a tier again.
- **The GLA adjustment is DERIVED from the comps** (`deriveMarketRates()`),
  not a static default. The old fixed $50/sqft was a national rule of thumb;
  in a $317/sqft Fort Worth street the derived rate is $142, and the gap
  under-corrected every size difference by tens of thousands in the same
  direction. Regression slope when it is explanatory (R² ≥ 0.35) and lands
  in 20–90% of median $/sqft, else 45% of median — because a slope fitted to
  a street where bigger houses are also nicer measures size PLUS everything
  correlated with size. Typing in the field marks it overridden and the
  derivation reports rather than overwrites.
- **The sale price overrules the marketing copy on condition**
  (`reconcileCondition()`). "Sold as-is" is boilerplate that appears on
  renovated flips, and a condition uplift is the largest single line in the
  grid — observed live adding $140,700 to a comp that had sold at $373/sqft
  in a $317/sqft market. A "dated" read on a comp selling ABOVE market rate
  (or "renovated" far BELOW) is dropped to unverified. It never substitutes
  the opposite condition: a price gap can be lot, street or motivation.
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
  `underwriter-property-cache-v5` (v4 added `_cachedAt`; v5 evicted records
  poisoned by the wrong-subject bug). MLS-sourced records expire after 12 h
  for licence retention, everything else never does; `recordIsMlsSourced()`
  reads `extra.mlsNumber` OR `extra.mls.matchedBy`, so the clock does not hang
  on a single field-map entry, and `sweepExpiredMlsRecords()` runs at load so
  an address never looked up again still ages out. There is deliberately NO
  localStorage key for MLS credentials.
- Never commit `worker/.wrangler/` (gitignored) or any secrets; the repo is
  public. The deployed Worker URL is deliberately baked into `app.js` as
  `DEFAULT_WORKER_URL` (zero-setup auto-fill was chosen over URL secrecy;
  Workers free tier has a hard daily cap, so no billing risk — rotate the
  worker name if abuse ever shows up).

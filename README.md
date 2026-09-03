# Deal Underwriter Calculator

**A real-estate deal underwriter for Dallas–Fort Worth investors.** Type an address, get the property record, the comps, an after-repair value with a stated error band, and a fix-and-flip or rental pro-forma you can stress-test with sliders. No build step, no framework, no sign-up.

[![Live app](https://img.shields.io/badge/live%20app-GitHub%20Pages-2ea44f)](https://crashoverride1234.github.io/deal-underwriter-calculator/)
[![Native builds](https://github.com/crashoverride1234/deal-underwriter-calculator/actions/workflows/native-builds.yml/badge.svg)](https://github.com/crashoverride1234/deal-underwriter-calculator/actions/workflows/native-builds.yml)
[![Tests](https://img.shields.io/badge/tests-166%20engine%20%2B%20106%20worker-blue)](#tests)
[![Vanilla JS](https://img.shields.io/badge/vanilla%20JS-no%20build%20step-yellow)](#under-the-hood)

> In the app it calls itself **Antigravity Underwriter**. Same thing. I am an investor and agent in DFW, not a career developer, and this is my first public project. I built it because I wanted my own underwriting to be faster and more honest than a spreadsheet, and I would genuinely love feedback: on the math, on the UX, on the code, on this README. [Open an issue](https://github.com/crashoverride1234/deal-underwriter-calculator/issues) for anything at all.

---

## Try it in 60 seconds

1. Open **https://crashoverride1234.github.io/deal-underwriter-calculator/**
2. On **1 · Subject Property**, start typing a DFW address and pick it from the suggestions. The record auto-fills: square footage, beds and baths, year built, lot, garage, pool, assessed value, tax bill, last sale.
3. Press **Scan Site** if you want the flood zone, soil, hail history, school rating, traffic, and nearby influences.
4. Go to **2 · ARV Estimation**. Comps are searched and filled in automatically, the adjustment grid runs, and you get an indicated value with a ± band.
5. Go to **3 · Deal Calculator**, pick Fix & Flip or Rental, and drag the stress-test sliders.

On a phone: open the same link in Safari or Chrome and choose **Add to Home Screen**. It installs as an app and remembers your settings.

Every open starts blank on purpose. Only your adjustment weights and any optional API keys persist between sessions.

---

## What it does

**1 · Subject Property.** Address autocomplete from three keyless services, then a property record assembled from an authority-ordered stack of sources (MLS listing when the address matches, then county roll, then public portals). A satellite map, an optional Street View photo, and a site scan that reads OpenStreetMap features within about 400 m plus public records: FEMA flood zone, USDA shrink-swell soil, NWS hail reports, TEA school district and rating, TxDOT traffic counts, ACS tract income, and Dallas permits and crime density.

**2 · ARV Estimation.** Closed sales are pulled around the subject, ranked 0–100 for similarity, and the best four are placed into comp cards. An appraiser-style adjustment grid runs on them: seller concessions come off first, then a time adjustment derived from the local trend, then dollar and percentage lines for size, rooms, lot, garage, age, pool, stories, condition, and six qualitative ratings. You get a weighted indicated value, a value range, a ± confidence width with its top driver named, a comps map, a market-absorption meter, a trend readout, and a printable tax-protest packet when the county assessment exceeds the evidence.

**3 · Deal Calculator.** Fix & Flip (all cash, hard money, private money) or Rental (all cash, DSCR purchase, or cash buy then DSCR refinance). Draw-based versus Dutch interest, loan-to-cost and loan-to-ARV caps with the binding constraint reported, Texas post-sale tax reassessment, a rent ladder, a rehab scope estimator with year-built capex flags, a max-offer back-solver, a break-even line, a deal scorecard, and two stress sliders (rehab hold buffer and ARV variance) that move every number at once.

The calculator opens with example numbers ($200,000 purchase, $320,000 ARV, $45,000 rehab, $2,200 rent). They are placeholders, not market data. Replace them.

---

## Where it works

The math works anywhere. The data does not, and I would rather tell you exactly where it degrades than let you find out.

| Feature | Dallas–Fort Worth | Rest of Texas | Elsewhere |
|---|---|---|---|
| Address autocomplete | ✅ | ✅ | ✅ |
| Property record auto-fill | ✅ MLS + county + portal | ✅ portal (no MLS) | ✅ portal (no MLS) |
| Comp prices | ✅ **recorded MLS closings** | ⚠️ list-at-sale proxies | ⚠️ list-at-sale proxies |
| Market scan (actives, pendings, solds, days on market) | ✅ MLS | ⚠️ portal counts | ⚠️ portal counts |
| Rent from closed leases | ✅ MLS | ❌ asking rents only | ❌ asking rents only |
| Flood, soil, OpenStreetMap influences, ACS income | ✅ | ✅ | ✅ |
| School district and rating | ✅ TEA | ✅ TEA | ❌ |
| Traffic counts | ✅ TxDOT | ✅ TxDOT | ❌ |
| Hail history | ✅ Fort Worth NWS office | ❌ | ❌ |
| Permits and crime density | Dallas city limits only | ❌ | ❌ |
| County parcel rung | Tarrant County only | ❌ | ❌ |
| Tax reassessment and protest check | ✅ Texas model | ✅ Texas model | ⚠️ Texas assumptions |
| Deal calculator, max offer, break-even, stress test | ✅ | ✅ | ✅ |

"MLS" above means the NTREIS feed (North Texas). Texas is a non-disclosure state, so without a licensed feed every comp price anyone can show you is a list-at-sale proxy. The UI labels which kind of number you are looking at, and the hedge disappears only when the prices are recorded closings. The difference is not academic: one house I checked was $649,000 on the portal and $550,000 in the recorded close.

---

## Where the numbers come from

| Source | Feeds | Access | Runs in |
|---|---|---|---|
| **NTREIS MLS** (classic RETS on CoreLogic Matrix) | closed sales, closed leases, days on market, concessions, listing photos, subject record | licensed feed, credentials as Worker secrets only | Worker |
| realtor.com geo-suggest and GraphQL | address suggestions, property record, sold and active listings, active rentals | keyless, **unofficial** | browser + Worker |
| US Census geocoder, Photon/OSM | address suggestions | keyless | browser |
| Tarrant Appraisal District parcels | county roll in Tarrant County | keyless | Worker |
| RentCast, Melissa | property record and rent AVM fallbacks | optional keys (free tiers) | Worker or browser |
| HUD Small Area FMR | Section 8 rent for the bedroom count | optional key, currently not set | Worker |
| Overpass (OpenStreetMap) | roads, rail, power lines, commercial, parks, pools near the subject | keyless | browser |
| FEMA NFHL via Esri Living Atlas | flood zone | keyless | browser |
| USDA SSURGO | shrink-swell soil (the DFW clay warning) | keyless | browser |
| NWS storm reports via Iowa Environmental Mesonet | hail history | keyless | Worker |
| TEA, TxDOT, Dallas open data, Esri ACS layers | schools, traffic, permits, crime, tract income | keyless | browser |
| Esri World Imagery | satellite map and the tile the vision model reads | keyless | browser + Worker |
| Cloudflare Workers AI (llava 1.5 7B) | yes/no/unsure adjacency reads from imagery | free daily allocation | Worker |
| Google Street View Static | front photo | your own key, stored on your device | browser |

**Whose backend you are using.** The hosted app talks to a small Cloudflare Worker I run (`worker/` in this repo). It exists because realtor.com blocks browsers with CORS, because MLS credentials must never reach a browser, and because a few feeds are too large to pull client-side. The MLS feed behind it is my own NTREIS subscription, and the hosted instance is my personal underwriting tool that I have left open so people can try it. It runs on Cloudflare's free tier with a hard daily cap, so if it goes quiet, that is why. If you want to build on this, deploy your own Worker (five minutes, instructions below) and point the app at it by changing one constant.

**What costs money.** Nothing, for you. The only metered calls are the RentCast rent estimate (billed to my free quota, and skipped whenever the feed has three or more closed leases) and Street View, which needs your own Google key.

---

## How accurate is it, and how I know

I did not want to guess, so the repo carries a back-test harness that scores the engine against real closed sales it has never seen. `backtest.mjs` rebuilds the comp set that existed on each sale's close date, excludes a 7-day reporting lag, throws out rows the MLS modified after that date (records get backfilled after closing), removes the test property from its own comps by listing id, parcel and street line, and then asks the engine for a value knowing only what it would know before an offer.

Measured 2026-08-27, 108 closed sales across 12 DFW submarkets, $50k–$500k:

| Sales | n | Median error | Median ratio (estimate ÷ actual) |
|---|---|---|---|
| All | 108 | 13.0% | 1.11 |
| Retail sales | 92 | **10.6%** | **1.06** |
| Distressed sales | 16 | 37.8% | 1.38 |

In plain English: on an ordinary retail sale the estimate lands within about 10% of the actual price half the time, and it leans high by around 6% at the median. The lean has a known cause. The engine values the subject **in after-repair condition** and the test scores it against as-is close prices, so the gap is largely the renovation premium. Distressed sales are supposed to come in far below an after-repair value, so the 37.8% there is the model doing its job, not failing.

Things the back-test taught me that changed the product:

- **Error varies six-fold by neighbourhood** (about 5.6% in southeast Fort Worth, about 31% in Pleasant Grove). One metro-wide number hides that, so the app states a ± band per deal and names what is widening it.
- **The high/medium/low confidence label ranked backwards** on 84 sales. Deals labelled "low" were more accurate than deals labelled "high". The band width itself was about right (77% coverage against a 68% target), so the app shows the width and no longer shows the word.
- **The old fixed $50/sqft size adjustment was wrong** in a $317/sqft street. The rate is now derived from the comps.
- **The old +2%/yr time adjustment was wrong too.** Three DFW submarkets measured flat to slightly soft. The trend is now fitted on monthly medians and applied only when its confidence interval clears zero.
- **A per-deal "every comp was adjusted upward" warning was built, measured on two independent samples, and withdrawn** because the two samples disagreed by more than the effect.

The full methodology is in `backtest.mjs` and the results discussion in `CLAUDE.md`. Running the harness needs a Worker with a licensed feed, so these numbers are reproducible by anyone with MLS access, not by anyone at all. Treat them as a dated measurement on a small sample, not a guarantee.

---

## What this is not

- **Not an appraisal.** Nothing here is a USPAP appraisal or a broker price opinion, and no licensed appraiser is behind it. The ARV is a model output. Do not hand the ARV page, the PDF export, or the protest packet to anyone as if it were an appraisal.
- **Not financial, legal, or tax advice.** It is a calculator with opinions about where its inputs should come from. Your decisions are yours.
- **Not a national product.** See the table above. The tax model assumes Texas reappraisal after sale. Rehab tiers and capex flags are tuned to DFW housing stock.
- **Built on some unofficial data.** realtor.com endpoints have no API contract and could change or block traffic any day. Everything degrades to manual entry when a source disappears.
- **Careful with MLS data.** Texas sale prices are confidential under NTREIS rules. The app carries the licence attribution on every MLS-sourced list, withholds MLS comp line items from the printed protest packet while keeping the value conclusion, expires MLS records from the browser cache after 12 hours, and shows listing photos only on screen. If you connect your own feed, its licence is your responsibility.
- **Careful with the crime and income chips.** They are visible on screen for private underwriting and excluded from every print surface. Fannie Mae's Selling Guide names crime-rate references an unacceptable appraisal practice, and a licensed agent putting them in a client document is fair-housing exposure.

---

## Privacy

There are no accounts and nothing is saved server-side. Your deals live in the page until you close it. API keys you paste and the adjustment weights live in your browser's localStorage. Address lookups pass through the Worker to the upstream providers listed above, so those providers see the address you typed. MLS-sourced records expire from your device after 12 hours. Listing photos are cached privately in your browser for 12 hours and never sent to any model.

---

## Under the hood

Vanilla JavaScript, three pages in one HTML file, no bundler, no framework. Three pinned CDN libraries (Chart.js, Lucide, Leaflet).

```
index.html      all three pages
style.css
engine.js       pure calculation core, UMD, no DOM       ~1,800 lines
app.js          DOM wiring only                          ~4,900 lines
sw.js           service worker (PWA offline shell)
tests.js        engine unit tests (166)                  node tests.js  or  open test.html
backtest.mjs    accuracy harness against real closings   needs a Worker with an MLS feed
worker/         Cloudflare Worker: MLS client, property ladder, keyless proxies   ~3,800 lines
worker/tests.mjs  MLS transport tests (106)              node worker/tests.mjs
native/         Capacitor 8 iOS/Android shells around the same files
CLAUDE.md       the deep architecture and conventions doc
HANDOFF.md      the briefing for whoever (or whatever) picks the project up next
```

**The engine** (`engine.js`) is where all the business math lives, and it is the part I am proudest of. A few of its design decisions:

- `underwrite()` prices flips and rentals under five financing structures from one input object, models draw-based versus Dutch interest, and reports peak cash exposure.
- `maxOffer()` and `breakEven()` are bisections over the full deal model rather than closed-form formulas, because on a hard-money deal the loan is itself a function of ARV and a closed form would quietly ignore that.
- Two DSCRs, on purpose: NOI over debt service (the analyst's coverage) and gross rent over PITIA (what a 1–4 unit DSCR lender actually underwrites). On the default rental they read 0.57 and 1.38, on opposite sides of the 1.25 cutoff. The card that claims lender approval uses the lender's.
- `appraise()` follows URAR grid order: concessions off the price first, then time, then percentage adjustments on the time-adjusted basis. A blank field produces no adjustment, never a phantom one.
- The $/sqft rate and the time adjustment are derived from the comps and a wide trend pull. Typing in either field marks it overridden, and the derivation then reports instead of overwriting.
- `reconcileCondition()` lets the sale price overrule the marketing copy. "Sold as-is" on a house that traded above market rate does not get a fixer uplift.
- `valuationInterval()` states the ARV as a band built from six named drivers, and `bracketingDefects()` separately asks whether the comps surround the subject at all, because a tight set that sits entirely on one side is a narrow band around an extrapolation.
- The back-test statistics (IAAO ratio-study panel, a paired sign test, a deterministic bootstrap) live inside the engine, so the app and the accuracy tooling cannot drift apart.
- A blank input restores the old constant bit-for-bit, and an explicit 0 is honoured as an answer.

**The Worker** (`worker/worker.js`) is a dependency-free Cloudflare Worker with a full classic-RETS client and a RESO Web API client. Some of what it took to make NTREIS work, written down because almost none of it is public anywhere: capability URLs arrive on one space-separated line; queries need coded values (`CLS`, not `Closed`) or they silently match nothing; a comma means AND between criteria and OR inside a value list; the trailing `<RETS-STATUS/>` overrides the envelope's reply code; the server allows one session per login so every operation is serialised and the session is released in `finally`; and MD5 is implemented by hand because `crypto.subtle` MD5 is a Cloudflare-only extension and the Digest auth path had to be testable under Node. The MD5 is checked against every RFC 1321 vector and the Digest against the RFC 2617 worked example. The whole MLS rung is inert until credentials exist, so an unconfigured Worker behaves like a plain keyless proxy.

Geography on the feed is a real bounding box trimmed to a circle, not a ZIP code. Comps are filtered at the source (sub-type, ±35% size, ±1 bedroom) because the row cap is spent on whatever the server returns first. The subject lookup is a fold over an authority-ordered stack where nothing overwrites, so the order of the list is the whole specification.

---

## Run it locally

It is a static site. Any HTTP server works:

```bash
python -m http.server 8080
```

or, on Windows, `.\serve.ps1` (a tiny PowerShell server on port 8080) and `.\launcher.ps1` (starts the server hidden and opens an Edge app window). Then open `http://localhost:8080/`. Any localhost port is accepted by the shared Worker's CORS allowlist.

Node 22 or newer for the scripts. There is no root `package.json` and nothing to install.

### Tests

```bash
node tests.js
```

```bash
node worker/tests.mjs
```

Both must pass before anything ships. Nothing in CI runs them yet, which is on the list. The engine suite also runs in a browser at `test.html`, and the live copy is at https://crashoverride1234.github.io/deal-underwriter-calculator/test.html.

### Back-test

```bash
node backtest.mjs --metro --n 108 --price-min 50000 --price-max 500000
```

Needs `UNDERWRITER_WORKER` pointing at a Worker whose `/health` reports a live MLS feed. `--compare-condition`, `--compare-comps`, `--compare-time` and `--compare-rate` run paired A/B tests on the same sales. Results append to a gitignored `backtest-results.json`. NTREIS asks for no large pulls during business hours, so it paces itself and is meant to run overnight.

---

## Deploy your own

**The app** is static. Push to any GitHub Pages branch, or any static host. Bump `CACHE_NAME` in `sw.js` on every deploy so installed copies pick up the change.

**The Worker**, from `worker/`:

```bash
npx wrangler deploy
```

Use wrangler rather than pasting into the dashboard: `wrangler.toml` carries the non-secret feed configuration and the Workers AI binding, and a dashboard paste would deploy without them. Then change `DEFAULT_WORKER_URL` near the top of the data-proxy section of `app.js` to your Worker's URL, and set `ALLOWED_ORIGINS` on the Worker to your site's origin.

Optional secrets, each set with `npx wrangler secret put NAME`:

| Secret | Unlocks |
|---|---|
| `MLS_RETS_USERNAME`, `MLS_RETS_PASSWORD` | the NTREIS feed (non-secret half is already in `wrangler.toml`) |
| `MLS_API_BASE`, `MLS_TOKEN_URL`, `MLS_CLIENT_ID`, `MLS_CLIENT_SECRET` | a RESO Web API feed instead (Trestle, Bridge, MLS Grid, Spark) |
| `RENTCAST_API_KEY` | RentCast record and rent fallbacks |
| `MELISSA_API_KEY` | Melissa record fallback |
| `HUD_API_KEY` | HUD Small Area FMR on the rent ladder |

For a different MLS, `GET /mls/probe` on your Worker reads the server's own metadata and emits a ready-to-paste field map. Full walkthrough, gotchas, and the reasoning behind every setting: [`worker/README.md`](worker/README.md) and [`worker/wrangler.toml`](worker/wrangler.toml).

Connecting a feed is paperwork before it is code. For NTREIS the product is back-office RETS access, the designated broker signs, and IDX or VOW feeds cannot carry sold prices in Texas.

---

## Native apps

`native/` wraps the identical web files in Capacitor 8 shells. GitHub Actions builds an installable Android debug APK, an unsigned release bundle, and an unsigned iOS app on every push, and the artifacts are on the [Actions tab](https://github.com/crashoverride1234/deal-underwriter-calculator/actions/workflows/native-builds.yml). Neither app is in a store yet. The runbook for signing and submission is in [`native/README.md`](native/README.md). For day-to-day phone use, Add to Home Screen from the browser is what I do.

---

## Contributing

Yes please. Issues, questions, disagreements about the math, and pull requests are all welcome. A few conventions that will save you a round trip:

- Percent inputs are whole numbers (80 means 80%). The engine divides by 100.
- Missing comp data must produce no adjustment, not a phantom one.
- A blank input restores the old default bit-for-bit. An explicit 0 means zero. Guard with `has()`, never `||`.
- Every engine change needs a test in `tests.js`. UI-only changes need browser verification instead.
- Charts and maps update in place. Never destroy and recreate per keystroke.
- Bump `CACHE_NAME` in `sw.js` on every deployable change.
- Never commit `worker/.wrangler/`, `.dev.vars`, or any credential. The repo is public.
- Cite live rules and date them. Regulations in this space move.

`CLAUDE.md` is the deep document: architecture, every convention, every measured finding, every dead end so nobody re-researches Zillow's API. `HANDOFF.md` is the briefing for whoever picks the project up next. Both are written as instructions to AI coding agents, which is how most of this code was written: I directed, reviewed, tested against real DFW addresses, and pushed; the agents typed. I am telling you that up front because you will notice, and because the engineering judgment and the measurement discipline are the parts I actually want feedback on.

---

## Status and known gaps

Alpha. One maintainer, first commit July 2026. It is what I use to underwrite my own deals, and it is deployed and live after every change.

Known gaps, honestly:

- No save, share, or history. Every open starts blank.
- No as-is valuation. The ARV is always after-repair, and the condition line only adjusts comps upward. That is the measured source of the upward lean.
- Confidence tiers were withdrawn; the ± band is shown instead. Re-tuning the width multipliers from back-test coverage is open.
- Permits and crime are Dallas-only. Fort Worth's feeds are dead ends, not oversights.
- The rent ladder does not yet render the individual lease comps behind the number.
- Nothing in CI runs the unit tests.
- Some on-screen copy is a version behind the data (the absorption meter still credits realtor.com when the feed answered).
- The data-sources settings panel is hidden in the current build, so pointing the app at your own Worker means editing the constant in `app.js`.

---

## Feedback I would especially love

- **Appraisers:** is the grid order right, are the derivations defensible, what would you never do that it does?
- **Investors and agents:** which number did you not trust, and what would have made you trust it?
- **Lenders:** does the DSCR card match how you underwrite?
- **Developers:** the RETS client, the bisection solvers, and the back-test design are the pieces I am least sure a professional would build the same way.
- **Anyone:** is this README clear? Where did you get lost?

Open an issue, or start a discussion. Thank you for reading this far.

---

## Attribution and licence

MLS data: *Information deemed reliable but not guaranteed. Data provided by NTREIS.* Map data © OpenStreetMap contributors (ODbL). Imagery and Living Atlas layers © Esri and its data providers. Flood data from FEMA, soils from USDA NRCS, school data from the Texas Education Agency, traffic from TxDOT, storm reports from the National Weather Service via the Iowa Environmental Mesonet, geocoding from the US Census Bureau and Komoot Photon, open data from the City of Dallas. Built with Chart.js, Lucide, Leaflet, Capacitor, and Cloudflare Workers. realtor.com is used through unofficial endpoints for personal, low-volume use.

**Code licence: not chosen yet.** I have not picked one, which means the default is all rights reserved until I do. If you want to use any of this for something, open an issue and ask, and I will very likely say yes and pick a licence while I am at it.

# Property Data Proxy — Cloudflare Worker

Gives the underwriter app **keyless property auto-fill** (beds, baths, sqft,
lot, year built, garage, pool, stories) by proxying realtor.com's property
API, holds a licensed **MLS feed** (RESO Web API / classic RETS) as the primary
source of comps and sale prices, and can hold your RentCast / Melissa keys
**server-side** so they never appear in the app or the browser.

Free plan limits: 100,000 requests/day — thousands of times more than this
app will ever use.

## Deploy (~5 minutes, no tools needed)

1. Create a free Cloudflare account at **dash.cloudflare.com** (skip any
   domain setup — not needed for Workers).
2. In the dashboard: **Workers & Pages → Create → Create Worker**.
   Give it a name like `underwriter-proxy` and click **Deploy** (the
   hello-world it deploys is a placeholder).
3. Click **Edit code**, delete the placeholder, paste the entire contents of
   [`worker.js`](worker.js), then **Deploy**.
4. Copy the worker URL — it looks like
   `https://underwriter-proxy.<your-subdomain>.workers.dev`.
5. In the underwriter app → **Property Data Sources** → paste that URL into
   the **Cloudflare Worker URL** field. The app runs a health check and
   shows what the worker can do.

That's it — address auto-fill now works with **zero API keys** via
realtor.com data.

## Optional: hold API keys server-side

In the worker's page: **Settings → Variables and Secrets → Add**:

| Type   | Name               | Value                    |
|--------|--------------------|--------------------------|
| Secret | `RENTCAST_API_KEY` | your RentCast key        |
| Secret | `MELISSA_API_KEY`  | your Melissa license key |

With these set, the app's lookup ladder can also use RentCast/Melissa
through the worker without any key pasted into the browser.

## The MLS feed (RESO Web API / classic RETS)

This is the **primary** data source once it's configured: real closed sale
prices, real closed lease rents, real days-on-market and seller concessions,
instead of the list-at-sale proxies every other source can offer in a
non-disclosure state. Everything above becomes the fallback.

**MLS credentials must only ever live here, as Worker secrets.** A data
licence forbids shipping them to a browser, which is why — unlike RentCast
and Melissa — there is deliberately no paste-a-key field in the app.

The whole rung is inert until a complete credential set exists. An
unconfigured worker behaves exactly as it did before.

### Setting it up

1. Set the secrets (see [`.dev.vars.example`](.dev.vars.example) for the full
   annotated list). Minimum for a RESO Web API feed:

   ```
   echo <value> | npx wrangler secret put MLS_API_BASE
   echo <value> | npx wrangler secret put MLS_TOKEN_URL
   echo <value> | npx wrangler secret put MLS_CLIENT_ID
   echo <value> | npx wrangler secret put MLS_CLIENT_SECRET
   ```

   ...or for classic RETS: `MLS_RETS_LOGIN_URL`, `MLS_RETS_USERNAME`,
   `MLS_RETS_PASSWORD` (+ `MLS_RETS_UA` / `MLS_RETS_UA_PASSWORD` if the MLS
   registered a User-Agent for you).

   On an aggregator like Trestle — which serves 90+ MLSs behind one
   credential — **always** also set `MLS_ORIGINATING_SYSTEM` (e.g. `NTREIS`),
   or results will mix markets.

2. Run the diagnostic:

   ```
   curl "https://<your-worker>.workers.dev/mls/probe"
   ```

   It reports which transport authenticated, how far the handshake got, the
   field names the server *actually* publishes (`fieldsSeen`), which of the
   fields this app wants are missing (`missingExpectedFields`), and the
   normalized record they map to. Field names only; add `?sample=1` for one
   full row (that row is licensed content — treat it accordingly).

3. If `missingExpectedFields` is non-empty, write the corrections into
   `MLS_FIELD_MAP` as JSON and re-probe:

   ```
   echo '{"sqft":"SqFtTotal","remarks":"PublicRemarksLong"}' | npx wrangler secret put MLS_FIELD_MAP
   ```

Field names default to the RESO Data Dictionary 2.0, so a conforming feed
needs no map at all.

### What changes once it's live

| Route     | With the feed | Without |
|-----------|---------------|---------|
| `/lookup` | MLS facts overlay every rung; true last-sale price and date | unchanged ladder |
| `/comps`  | Closed sales with `priceType: "closed"`, concessions, DOM; proxies dropped once 3+ are found | realtor.com + RentCast proxies |
| `/market` | True closes, real statuses, a separate Active-Under-Contract bucket | realtor.com scrape |
| `/rent`   | Closed leases (free, and transacted); the billable RentCast AVM is skipped | RentCast AVM + asking rents |

`/health` reports `mls: { name, transport, attribution }` so the app can show
the feed's state and render the licence's required attribution.

### Gotchas worth knowing

- **`$top` defaults to 10** on Trestle and caps at 1,000. Never rely on the default.
- **No `$select` is sent by default.** Naming a field the feed doesn't publish
  rejects the entire query, and this code can't know a given MLS's field set
  in advance. Set `MLS_SELECT` only after `/mls/probe` proves the list.
- **Latitude/Longitude are not index-accelerated** on Trestle; `PostalCode`
  and `StandardStatus` are. A geo filter is the query most likely to return
  HTTP 504, so a timeout automatically retries narrowed by postcode.
- **`BathroomsTotalInteger` is a simple sum** (2 full + 1 half = 3, *not*
  2.5). The normalizer prefers `BathroomsTotalDecimal`, then computes from the
  full/half components, and only then falls back to the integer.
- **`ConcessionsAmount` rides the back-office payload**, so an IDX-only feed
  won't carry it at all, and it is sparsely populated even where licensed. A
  null means "not reported", never "$0" — the app surfaces the separate
  `Concessions` Yes/No flag for exactly that case.
- **Classic RETS is one session per login** on most servers, and a second
  Login silently kills the first. Logins are single-flighted here; if a
  session gets stuck, `GET /mls/probe?logout=1` closes it.
- The classic-RETS transport is **unverified against a live server** — it was
  written from the spec. `/mls/probe` exercises the whole handshake and
  reports exactly where it stops.

## Optional: restrict who can call it

By default only these origins are allowed:

- `https://crashoverride1234.github.io`
- `http://localhost:8080` / `http://127.0.0.1:8080`

To change, add a **plaintext variable** `ALLOWED_ORIGINS` with a
comma-separated list of origins.

## Test it

```
curl https://<your-worker>.workers.dev/health
curl "https://<your-worker>.workers.dev/property?mpr_id=8032812365"
```

The second command should return a JSON record for 5500 Grand Lake Dr,
San Antonio (beds 3, baths 2, sqft 1878...).

## Known risks

- realtor.com is an **unofficial** data source: it may block Cloudflare
  egress IPs or change its API at any time (verified working from
  residential IPs, July 2026). If `/property` starts returning 502s, the
  RentCast/Melissa paths still work.
- Anything proxied here is subject to the upstream site's terms of service;
  this is a personal-use tool, keep volumes low.

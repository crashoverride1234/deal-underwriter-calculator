# Property Data Proxy — Cloudflare Worker

Gives the underwriter app **keyless property auto-fill** (beds, baths, sqft,
lot, year built, garage, pool, stories) by proxying realtor.com's property
API, and can optionally hold your RentCast / Melissa keys **server-side** so
they never appear in the app or the browser.

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

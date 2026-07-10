/**
 * Antigravity Underwriter — property data proxy (Cloudflare Worker)
 *
 * Gives the static PWA keyless property auto-fill by proxying sources a
 * browser can't reach directly, and optionally holding paid-API keys
 * server-side as Worker secrets so they never ship in client code.
 *
 * Routes (all GET):
 *   /health                        → { ok, providers } — connectivity check
 *   /property?mpr_id=<id>          → realtor.com GraphQL (keyless), normalized
 *   /property?address=<street...>  → same, resolving the address to an
 *                                    mpr_id via realtor.com geo-suggest first
 *   /rentcast?address=... | ?latitude=&longitude=&radius=&limit=
 *                                  → RentCast with RENTCAST_API_KEY secret
 *   /melissa?ff=<address>          → Melissa with MELISSA_API_KEY secret
 *
 * Optional configuration:
 *   Secrets:  RENTCAST_API_KEY, MELISSA_API_KEY (routes 501 when unset)
 *   Vars:     ALLOWED_ORIGINS — comma-separated origin allowlist override
 *
 * Responses: 200 normalized record · 404 no record · 501 provider not
 * configured · 403 origin not allowed · 502 upstream failure
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://crashoverride1234.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  // Capacitor native apps (see native/): iOS serves the bundle from
  // capacitor://localhost, Android from https://localhost
  'capacitor://localhost',
  'https://localhost'
];

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Query shape verified live against frontdoor/graphql on 2026-07-08;
// operationName is REQUIRED (its absence returns "Required parameter is missing")
const REALTOR_QUERY = `query GetHome($property_id: ID!) {
  home(property_id: $property_id) {
    property_id
    status
    list_price
    last_sold_price
    last_sold_date
    description { beds baths baths_full baths_half sqft lot_sqft year_built garage stories pool type }
    location {
      address { line city state_code postal_code coordinate { lat lon } }
      county { name }
    }
  }
}`;

function allowedOrigins(env) {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

// Local development runs on arbitrary ports (dev servers with autoPort);
// any localhost origin is as trusted as the machine it runs on
function isOriginAllowed(origin, origins) {
  if (origins.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}

const numOrNull = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ---- Normalizers: every provider maps to one record shape ----

function realtorToRecord(home) {
  const d = home.description || {};
  const addr = (home.location && home.location.address) || {};
  let baths = numOrNull(d.baths);
  if (baths === null && (d.baths_full != null || d.baths_half != null)) {
    baths = (d.baths_full || 0) + 0.5 * (d.baths_half || 0) || null;
  }
  const formatted = addr.line
    ? `${addr.line}, ${addr.city}, ${addr.state_code} ${addr.postal_code || ''}`.trim()
    : null;
  return {
    sqft: numOrNull(d.sqft),
    beds: numOrNull(d.beds),
    baths,
    lot: numOrNull(d.lot_sqft),
    year: numOrNull(d.year_built),
    garage: numOrNull(d.garage),
    pool: (d.pool === true || d.pool === false) ? d.pool : null,
    stories: numOrNull(d.stories),
    formattedAddress: formatted,
    source: 'realtor.com',
    extra: {
      propertyType: d.type || null,
      status: home.status || null,
      listPrice: home.list_price || null,
      lastSoldDate: home.last_sold_date || null,
      county: home.location && home.location.county ? home.location.county.name : null,
      lat: addr.coordinate ? addr.coordinate.lat : null,
      lon: addr.coordinate ? addr.coordinate.lon : null
    }
  };
}

function rentcastToRecord(p) {
  const f = p.features || {};
  const garage = (f.garageSpaces != null) ? f.garageSpaces : (f.garage === true ? 1 : (f.garage === false ? 0 : null));
  return {
    sqft: p.squareFootage != null ? p.squareFootage : null,
    beds: p.bedrooms != null ? p.bedrooms : null,
    baths: p.bathrooms != null ? p.bathrooms : null,
    lot: p.lotSize != null ? p.lotSize : null,
    year: p.yearBuilt != null ? p.yearBuilt : null,
    garage,
    pool: (f.pool === true || f.pool === false) ? f.pool : null,
    stories: f.floorCount != null ? f.floorCount : null,
    formattedAddress: p.formattedAddress || null,
    source: 'RentCast'
  };
}

function melissaToRecord(r) {
  const room = r.IntRoomInfo || {};
  const size = r.PropertySize || {};
  const use = r.PropertyUseInfo || {};
  const parking = r.Parking || {};
  const amenities = r.ExtAmenities || {};
  const poolRaw = amenities.PoolCode || amenities.Pool || '';
  return {
    sqft: numOrNull(size.AreaBuilding),
    beds: numOrNull(room.BedroomsCount),
    baths: numOrNull(room.BathCount),
    lot: numOrNull(size.AreaLotSF),
    year: numOrNull(use.YearBuilt),
    garage: numOrNull(parking.ParkingSpaceCount),
    pool: poolRaw && poolRaw !== '0' ? true : null,
    stories: numOrNull((r.IntStructInfo || {}).StoriesCount),
    formattedAddress: null,
    source: 'Melissa'
  };
}

const hasData = (rec) => rec && (rec.sqft !== null || rec.beds !== null);

// ---- Providers ----

// Resolve a free-form address to realtor.com's property id via geo-suggest
async function resolveMprId(address) {
  const res = await fetch(
    `https://parser-external.geo.moveaws.com/suggest?input=${encodeURIComponent(address)}&client_id=rdc-home&limit=1&area_types=address`,
    { headers: { 'Accept': 'application/json', 'User-Agent': BROWSER_UA } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const first = (data.autocomplete || [])[0];
  return first && first.mpr_id ? String(first.mpr_id) : null;
}

async function handleRealtor(params, cors) {
  let mprId = params.get('mpr_id');
  if (!mprId && params.get('address')) {
    mprId = await resolveMprId(params.get('address'));
    if (!mprId) return json({ error: 'no record' }, 404, cors);
  }
  if (!mprId || !/^\d+$/.test(mprId)) {
    return json({ error: 'mpr_id (numeric) or address is required' }, 400, cors);
  }
  const res = await fetch('https://www.realtor.com/frontdoor/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'rdc-client-name': 'RDC_WEB_DETAILS_PAGE',
      'rdc-client-version': '3.x.x',
      'User-Agent': BROWSER_UA
    },
    body: JSON.stringify({
      operationName: 'GetHome',
      query: REALTOR_QUERY,
      variables: { property_id: String(mprId) }
    })
  });
  if (!res.ok) {
    return json({ error: `realtor.com upstream HTTP ${res.status}` }, 502, cors);
  }
  const data = await res.json();
  const home = data && data.data && data.data.home;
  if (!home) return json({ error: 'no record' }, 404, cors);
  const rec = realtorToRecord(home);
  return hasData(rec) ? json(rec, 200, cors) : json({ error: 'no usable fields' }, 404, cors);
}

async function handleRentcast(params, env, cors) {
  if (!env.RENTCAST_API_KEY) return json({ error: 'RENTCAST_API_KEY not configured' }, 501, cors);
  const allowed = ['address', 'latitude', 'longitude', 'radius', 'limit'];
  const upstream = new URLSearchParams();
  for (const k of allowed) {
    if (params.get(k)) upstream.set(k, params.get(k));
  }
  if (![...upstream.keys()].length) return json({ error: 'address or latitude/longitude required' }, 400, cors);
  const res = await fetch(`https://api.rentcast.io/v1/properties?${upstream}`, {
    headers: { 'X-Api-Key': env.RENTCAST_API_KEY, 'Accept': 'application/json' }
  });
  if (res.status === 404) return json({ error: 'no record' }, 404, cors);
  if (!res.ok) return json({ error: `RentCast upstream HTTP ${res.status}` }, 502, cors);
  const data = await res.json();
  const p = Array.isArray(data) ? data[0] : data;
  if (!p) return json({ error: 'no record' }, 404, cors);
  const rec = rentcastToRecord(p);
  return hasData(rec) ? json(rec, 200, cors) : json({ error: 'no usable fields' }, 404, cors);
}

async function handleMelissa(params, env, cors) {
  if (!env.MELISSA_API_KEY) return json({ error: 'MELISSA_API_KEY not configured' }, 501, cors);
  const ff = params.get('ff');
  if (!ff) return json({ error: 'ff (free-form address) required' }, 400, cors);
  const res = await fetch(
    `https://property.melissadata.net/v4/WEB/LookupProperty?id=${encodeURIComponent(env.MELISSA_API_KEY)}&ff=${encodeURIComponent(ff)}&format=json&cols=GrpAll`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) return json({ error: `Melissa upstream HTTP ${res.status}` }, 502, cors);
  const data = await res.json();
  if (data.TransmissionResults && /GE0[1-9]/.test(data.TransmissionResults)) {
    return json({ error: 'Melissa key rejected' }, 502, cors);
  }
  const r = (data.Records || [])[0];
  if (!r) return json({ error: 'no record' }, 404, cors);
  const rec = melissaToRecord(r);
  return hasData(rec) ? json(rec, 200, cors) : json({ error: 'no usable fields' }, 404, cors);
}

// ---- Entry ----

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const origins = allowedOrigins(env);

    // Browsers send Origin; requests without one (curl, health checks) pass
    if (origin && !isOriginAllowed(origin, origins)) {
      return json({ error: 'origin not allowed' }, 403, corsHeaders(origins[0]));
    }
    const cors = corsHeaders(origin || origins[0]);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return json({ error: 'GET only' }, 405, cors);
    }

    try {
      switch (url.pathname) {
        case '/health':
          return json({
            ok: true,
            providers: {
              realtor: true,
              rentcast: Boolean(env.RENTCAST_API_KEY),
              melissa: Boolean(env.MELISSA_API_KEY)
            }
          }, 200, cors);
        case '/property':
          return await handleRealtor(url.searchParams, cors);
        case '/rentcast':
          return await handleRentcast(url.searchParams, env, cors);
        case '/melissa':
          return await handleMelissa(url.searchParams, env, cors);
        default:
          return json({ error: 'unknown route' }, 404, cors);
      }
    } catch (err) {
      return json({ error: 'worker error: ' + (err && err.message ? err.message : 'unknown') }, 502, cors);
    }
  }
};

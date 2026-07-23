/**
 * Antigravity Underwriter — property data proxy (Cloudflare Worker)
 *
 * Gives the static PWA keyless property auto-fill by proxying sources a
 * browser can't reach directly, and optionally holding paid-API keys
 * server-side as Worker secrets so they never ship in client code.
 *
 * Routes (all GET):
 *   /health                        → { ok, providers } — connectivity check
 *   /lookup?address=...[&mpr_id=][&latitude=&longitude=]
 *                                  → unified ladder: RentCast (secret) →
 *                                    Melissa (secret) → realtor.com (keyless);
 *                                    first hit wins, source labeled
 *   /comps?address=... | latitude=&longitude=
 *          [&sqft=&beds=&baths=&radius=&months=&limit=]
 *                                  → comp candidates near the subject:
 *                                    realtor.com sold search (keyless) merged
 *                                    with RentCast AVM comparables (secret,
 *                                    correlation-ranked), deduped by address
 *   /vision?latitude=&longitude=[&photo=<https url, allowlisted hosts>]
 *                                  → Workers AI vision verdicts: satellite
 *                                    (pool / road adjacency / rail /
 *                                    commercial / green) + optional street
 *                                    photo (power lines / road character)
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
    details { category text }
    tax_history { year tax assessment { total land building } }
    location {
      address { line city state_code postal_code coordinate { lat lon } }
      county { name }
      neighborhoods { name }
    }
  }
}`;

// Sold-comp search; filter set verified live 2026-07-23 (nearby.coordinates
// is GeoJSON [lon, lat], radius needs the "1mi" pattern, sold_date.min is
// yyyy-mm-dd). TX is non-disclosure: last_sold_price is usually null, so
// list price at sale is the standard proxy.
const REALTOR_SEARCH_QUERY = `query CompSearch($query: HomeSearchCriteria!, $limit: Int, $sort: [SearchAPISort]) {
  home_search(query: $query, limit: $limit, sort: $sort) {
    total
    results {
      property_id
      status
      list_price
      last_sold_price
      last_sold_date
      description { beds baths sqft lot_sqft year_built type garage stories }
      location { address { line city state_code postal_code coordinate { lat lon } } }
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
  // Mine the details categories for labeled facts; subdivision falls back
  // to the first (most specific) neighborhood name when no explicit line
  const DETAIL_PATTERNS = {
    subdivision: /^Subdivision:?\s*(.+)/i,
    zoning: /^Zoning:?\s*(.+)/i,
    roof: /^Roofing:?\s*(.+)/i,
    foundation: /^Foundation:?\s*(.+)/i,
    heating: /^Heating features:?\s*(.+)/i,
    cooling: /^Cooling features:?\s*(.+)/i
  };
  const mined = {};
  for (const detail of home.details || []) {
    for (const line of detail.text || []) {
      for (const [key, re] of Object.entries(DETAIL_PATTERNS)) {
        if (mined[key] === undefined) {
          const m = re.exec(line);
          if (m) mined[key] = m[1].trim();
        }
      }
    }
  }
  if (mined.subdivision === undefined) {
    const hoods = (home.location && home.location.neighborhoods) || [];
    if (hoods.length && hoods[0].name) mined.subdivision = hoods[0].name;
  }
  // Latest assessment/tax year on record
  const taxYears = (home.tax_history || []).filter(t => t && t.year);
  taxYears.sort((a, b) => b.year - a.year);
  const latestTax = taxYears[0] || null;
  const assessment = latestTax && latestTax.assessment ? latestTax.assessment : null;
  return {
    sqft: numOrNull(d.sqft),
    beds: numOrNull(d.beds),
    baths,
    lot: numOrNull(d.lot_sqft),
    year: numOrNull(d.year_built),
    garage: numOrNull(d.garage),
    pool: (d.pool === true || d.pool === false) ? d.pool : null,
    stories: numOrNull(d.stories),
    subdivision: mined.subdivision || null,
    hoa: null,
    propType: d.type || null,
    county: home.location && home.location.county ? home.location.county.name : null,
    zoning: mined.zoning || null,
    apn: null,
    legal: null,
    garageType: null,
    foundation: mined.foundation || null,
    roof: mined.roof || null,
    exterior: null,
    heating: mined.heating || null,
    cooling: mined.cooling || null,
    assessedValue: assessment ? numOrNull(assessment.total) : null,
    assessedLand: assessment ? numOrNull(assessment.land) : null,
    assessedImprov: assessment ? numOrNull(assessment.building) : null,
    annualTaxes: latestTax ? numOrNull(latestTax.tax) : null,
    lastSaleDate: home.last_sold_date || null,
    lastSalePrice: numOrNull(home.last_sold_price),
    listPrice: numOrNull(home.list_price),
    listingStatus: home.status || null,
    hoaFee: null,
    ownerNames: null,
    ownerType: null,
    ownerOccupied: null,
    ownerMailing: null,
    lat: addr.coordinate ? addr.coordinate.lat : null,
    lon: addr.coordinate ? addr.coordinate.lon : null,
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

function latestByYear(byYear) {
  const years = Object.keys(byYear || {}).map(Number).filter(Number.isFinite);
  return years.length ? byYear[String(Math.max(...years))] : null;
}

function rentcastToRecord(p) {
  const f = p.features || {};
  const garage = (f.garageSpaces != null) ? f.garageSpaces : (f.garage === true ? 1 : (f.garage === false ? 0 : null));
  const assessment = latestByYear(p.taxAssessments);
  const taxes = latestByYear(p.propertyTaxes);
  const owner = p.owner || {};
  return {
    sqft: p.squareFootage != null ? p.squareFootage : null,
    beds: p.bedrooms != null ? p.bedrooms : null,
    baths: p.bathrooms != null ? p.bathrooms : null,
    lot: p.lotSize != null ? p.lotSize : null,
    year: p.yearBuilt != null ? p.yearBuilt : null,
    garage,
    pool: (f.pool === true || f.pool === false) ? f.pool : null,
    stories: f.floorCount != null ? f.floorCount : null,
    subdivision: p.subdivision || null,
    hoa: (p.hoa && p.hoa.fee > 0) ? true : null,
    propType: p.propertyType || null,
    county: p.county || null,
    zoning: p.zoning || null,
    apn: p.assessorID || null,
    legal: p.legalDescription || null,
    garageType: f.garageType || null,
    foundation: f.foundationType || null,
    roof: f.roofType || null,
    exterior: f.exteriorType || null,
    heating: f.heatingType || (f.heating === true ? 'Yes' : null),
    cooling: f.coolingType || (f.cooling === true ? 'Yes' : null),
    assessedValue: assessment ? assessment.value : null,
    assessedLand: assessment ? assessment.land : null,
    assessedImprov: assessment ? assessment.improvements : null,
    annualTaxes: taxes ? taxes.total : null,
    lastSaleDate: p.lastSaleDate || null,
    lastSalePrice: p.lastSalePrice != null ? p.lastSalePrice : null,
    listPrice: null,
    listingStatus: null,
    hoaFee: (p.hoa && p.hoa.fee > 0) ? p.hoa.fee : null,
    ownerNames: Array.isArray(owner.names) && owner.names.length ? owner.names.join(', ') : null,
    ownerType: owner.type || null,
    ownerOccupied: (p.ownerOccupied === true || p.ownerOccupied === false) ? p.ownerOccupied : null,
    ownerMailing: owner.mailingAddress && owner.mailingAddress.formattedAddress ? owner.mailingAddress.formattedAddress : null,
    lat: p.latitude != null ? p.latitude : null,
    lon: p.longitude != null ? p.longitude : null,
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
  const legal = r.Legal || {};
  const parcel = r.Parcel || {};
  const sale = r.SaleInfo || {};
  const tax = r.Tax || {};
  const primOwner = r.PrimaryOwner || {};
  const ownerAddr = r.OwnerAddress || {};
  const ext = r.ExtStructInfo || {};
  const mailing = [ownerAddr.Address, ownerAddr.City, ownerAddr.State, ownerAddr.Zip]
    .filter(Boolean).join(', ') || null;
  return {
    sqft: numOrNull(size.AreaBuilding),
    beds: numOrNull(room.BedroomsCount),
    baths: numOrNull(room.BathCount),
    lot: numOrNull(size.AreaLotSF),
    year: numOrNull(use.YearBuilt),
    garage: numOrNull(parking.ParkingSpaceCount),
    pool: poolRaw && poolRaw !== '0' ? true : null,
    stories: numOrNull((r.IntStructInfo || {}).StoriesCount),
    subdivision: legal.Subdivision || null,
    hoa: null,
    propType: use.PropertyUseGroup || null,
    county: parcel.County || null,
    zoning: use.ZoningCode || null,
    apn: parcel.FormattedAPN || parcel.UnformattedAPN || null,
    legal: legal.LegalDescription || null,
    garageType: parking.GarageType || null,
    foundation: (r.IntStructInfo || {}).Foundation || null,
    roof: ext.RoofMaterial || ext.RoofCover || null,
    exterior: ext.Exterior1Code || null,
    heating: (r.UtilitiesInfo || {}).HVACHeatingDetail || null,
    cooling: (r.UtilitiesInfo || {}).HVACCoolingDetail || null,
    assessedValue: numOrNull(tax.AssessedValueTotal),
    assessedLand: numOrNull(tax.AssessedValueLand),
    assessedImprov: numOrNull(tax.AssessedValueImprovements),
    annualTaxes: numOrNull(tax.TaxBilledAmount),
    lastSaleDate: sale.DeedLastSaleDate || null,
    lastSalePrice: numOrNull(sale.DeedLastSalePrice),
    listPrice: null,
    listingStatus: null,
    hoaFee: null,
    ownerNames: primOwner.Name1Full || null,
    ownerType: primOwner.Type || null,
    ownerOccupied: null,
    ownerMailing: mailing,
    formattedAddress: null,
    source: 'Melissa'
  };
}

const hasData = (rec) => rec && (rec.sqft !== null || rec.beds !== null);

// ---- Providers ----

// Resolve a free-form address via realtor.com geo-suggest: property id + centroid
async function resolveGeo(address) {
  const res = await fetch(
    `https://parser-external.geo.moveaws.com/suggest?input=${encodeURIComponent(address)}&client_id=rdc-home&limit=1&area_types=address`,
    { headers: { 'Accept': 'application/json', 'User-Agent': BROWSER_UA } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const first = (data.autocomplete || [])[0];
  if (!first) return null;
  return {
    mprId: first.mpr_id ? String(first.mpr_id) : null,
    lat: first.centroid ? first.centroid.lat : null,
    lon: first.centroid ? first.centroid.lon : null
  };
}

async function resolveMprId(address) {
  const geo = await resolveGeo(address);
  return geo ? geo.mprId : null;
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Record-or-null fetchers (throw on upstream failure) — shared by the
// individual routes and the unified /lookup ladder

async function realtorRecord(mprId) {
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
  if (!res.ok) throw new Error(`realtor.com upstream HTTP ${res.status}`);
  const data = await res.json();
  const home = data && data.data && data.data.home;
  if (!home) return null;
  const rec = realtorToRecord(home);
  return hasData(rec) ? rec : null;
}

async function rentcastRecord(upstreamParams, env) {
  const res = await fetch(`https://api.rentcast.io/v1/properties?${upstreamParams}`, {
    headers: { 'X-Api-Key': env.RENTCAST_API_KEY, 'Accept': 'application/json' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`RentCast upstream HTTP ${res.status}`);
  const data = await res.json();
  const p = Array.isArray(data) ? data[0] : data;
  if (!p) return null;
  const rec = rentcastToRecord(p);
  return hasData(rec) ? rec : null;
}

async function melissaRecord(ff, env) {
  const res = await fetch(
    `https://property.melissadata.net/v4/WEB/LookupProperty?id=${encodeURIComponent(env.MELISSA_API_KEY)}&ff=${encodeURIComponent(ff)}&format=json&cols=GrpAll`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) throw new Error(`Melissa upstream HTTP ${res.status}`);
  const data = await res.json();
  if (data.TransmissionResults && /GE0[1-9]/.test(data.TransmissionResults)) {
    throw new Error('Melissa key rejected');
  }
  const r = (data.Records || [])[0];
  if (!r) return null;
  const rec = melissaToRecord(r);
  return hasData(rec) ? rec : null;
}

// Unified provider ladder: RentCast (primary) → Melissa (secondary) →
// realtor.com (tertiary, keyless). Providers without a configured secret
// are skipped; the first record wins and carries its source label.
async function handleLookup(params, env, cors) {
  const address = params.get('address');
  if (!address) return json({ error: 'address is required' }, 400, cors);
  const providerErrors = [];

  if (env.RENTCAST_API_KEY) {
    try {
      let rec = await rentcastRecord(new URLSearchParams({ address }), env);
      if (!rec && params.get('latitude') && params.get('longitude')) {
        rec = await rentcastRecord(new URLSearchParams({
          latitude: params.get('latitude'), longitude: params.get('longitude'),
          radius: '0.05', limit: '1'
        }), env);
      }
      if (rec) return json(rec, 200, cors);
    } catch (e) { providerErrors.push('RentCast: ' + e.message); }
  }

  if (env.MELISSA_API_KEY) {
    try {
      const rec = await melissaRecord(address, env);
      if (rec) return json(rec, 200, cors);
    } catch (e) { providerErrors.push('Melissa: ' + e.message); }
  }

  try {
    let mprId = params.get('mpr_id');
    if (!mprId || !/^\d+$/.test(mprId)) mprId = await resolveMprId(address);
    if (mprId && /^\d+$/.test(mprId)) {
      const rec = await realtorRecord(mprId);
      if (rec) return json(rec, 200, cors);
    }
  } catch (e) { providerErrors.push('realtor.com: ' + e.message); }

  return json({ error: 'no record', providerErrors }, 404, cors);
}

// Comp candidates near a point: realtor.com sold listings (keyless) merged
// with RentCast AVM comparables (correlation-ranked). Dedupe favors the
// first-seen entry (realtor solds carry true sale dates) and grafts
// RentCast's correlation onto duplicates.
async function handleComps(params, env, cors) {
  let lat = parseFloat(params.get('latitude'));
  let lon = parseFloat(params.get('longitude'));
  const address = params.get('address') || '';
  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && address) {
    const geo = await resolveGeo(address);
    if (geo && geo.lat != null) { lat = geo.lat; lon = geo.lon; }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'latitude/longitude or a resolvable address is required' }, 400, cors);
  }
  const radius = Math.min(5, parseFloat(params.get('radius')) || 1);
  const months = Math.min(24, parseInt(params.get('months'), 10) || 12);
  const limit = Math.min(20, parseInt(params.get('limit'), 10) || 12);
  const providerErrors = [];
  const candidates = [];

  try {
    const minDate = new Date(Date.now() - months * 30.44 * 86400000).toISOString().slice(0, 10);
    const res = await fetch('https://www.realtor.com/frontdoor/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'rdc-client-name': 'RDC_WEB_DETAILS_PAGE',
        'rdc-client-version': '3.x.x',
        'User-Agent': BROWSER_UA
      },
      body: JSON.stringify({
        operationName: 'CompSearch',
        query: REALTOR_SEARCH_QUERY,
        variables: {
          query: {
            status: ['sold'],
            type: ['single_family'],
            sold_date: { min: minDate },
            nearby: { coordinates: [lon, lat], radius: `${radius}mi` }
          },
          limit,
          sort: [{ field: 'sold_date', direction: 'desc' }]
        }
      })
    });
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    const data = await res.json();
    const results = data && data.data && data.data.home_search ? (data.data.home_search.results || []) : [];
    for (const r of results) {
      const d = r.description || {};
      const addr = (r.location && r.location.address) || {};
      const coord = addr.coordinate || {};
      if (!addr.line) continue;
      candidates.push({
        address: addr.line,
        city: addr.city || null,
        state: addr.state_code || null,
        zip: addr.postal_code || null,
        lat: coord.lat != null ? coord.lat : null,
        lon: coord.lon != null ? coord.lon : null,
        price: numOrNull(r.last_sold_price) || numOrNull(r.list_price),
        priceType: r.last_sold_price ? 'sold' : 'list',
        soldDate: r.last_sold_date || null,
        sqft: numOrNull(d.sqft),
        beds: numOrNull(d.beds),
        baths: numOrNull(d.baths),
        lotSqft: numOrNull(d.lot_sqft),
        yearBuilt: numOrNull(d.year_built),
        garage: numOrNull(d.garage),
        stories: numOrNull(d.stories),
        propType: d.type || null,
        distanceMi: (coord.lat != null && coord.lon != null)
          ? Math.round(milesBetween(lat, lon, coord.lat, coord.lon) * 100) / 100 : null,
        correlation: null,
        source: 'realtor.com'
      });
    }
  } catch (e) { providerErrors.push('realtor.com: ' + e.message); }

  if (env.RENTCAST_API_KEY) {
    try {
      const q = new URLSearchParams({
        latitude: String(lat), longitude: String(lon),
        propertyType: 'Single Family',
        compCount: '10', maxRadius: String(radius), daysOld: String(months * 30)
      });
      if (params.get('sqft')) q.set('squareFootage', params.get('sqft'));
      if (params.get('beds')) q.set('bedrooms', params.get('beds'));
      if (params.get('baths')) q.set('bathrooms', params.get('baths'));
      const res = await fetch(`https://api.rentcast.io/v1/avm/value?${q}`, {
        headers: { 'X-Api-Key': env.RENTCAST_API_KEY, 'Accept': 'application/json' }
      });
      if (!res.ok && res.status !== 404) throw new Error(`upstream HTTP ${res.status}`);
      const data = res.ok ? await res.json() : {};
      for (const c of data.comparables || []) {
        candidates.push({
          address: c.addressLine1 || (c.formattedAddress || '').split(',')[0],
          city: c.city || null,
          state: c.state || null,
          zip: c.zipCode || null,
          lat: c.latitude != null ? c.latitude : null,
          lon: c.longitude != null ? c.longitude : null,
          price: numOrNull(c.price),
          priceType: 'list',
          soldDate: c.removedDate || c.listedDate || null,
          sqft: numOrNull(c.squareFootage),
          beds: numOrNull(c.bedrooms),
          baths: numOrNull(c.bathrooms),
          lotSqft: numOrNull(c.lotSize),
          yearBuilt: numOrNull(c.yearBuilt),
          garage: null,
          stories: null,
          propType: c.propertyType || null,
          distanceMi: c.distance != null ? Math.round(c.distance * 100) / 100 : null,
          correlation: c.correlation != null ? c.correlation : null,
          source: 'RentCast'
        });
      }
    } catch (e) { providerErrors.push('RentCast: ' + e.message); }
  }

  const byKey = new Map();
  for (const c of candidates) {
    const key = (c.address || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, c);
    } else {
      if (existing.correlation == null && c.correlation != null) existing.correlation = c.correlation;
      if (existing.price == null && c.price != null) { existing.price = c.price; existing.priceType = c.priceType; }
      if (existing.source.indexOf(c.source) === -1) existing.source += ' + ' + c.source;
    }
  }
  return json({
    subject: { latitude: lat, longitude: lon },
    candidates: [...byKey.values()],
    providerErrors
  }, 200, cors);
}

// ---- Vision: the app "looks" at imagery instead of measuring distances ----
// Workers AI (free daily allocation). Satellite snapshot answers parcel
// adjacency questions; an optional street-level photo answers what's
// visible from the curb.

const VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';

// llava answers single questions reliably but ignores multi-line answer
// formats, so each aspect is its own (parallel) model call
const SATELLITE_QUESTIONS = {
  pool: 'Is there a swimming pool on the property at the exact center of this satellite image? Answer with only one word: yes, no, or unsure.',
  road: 'Is the property at the exact center of this satellite image directly adjacent to a major road with multiple lanes of traffic or a painted center divider line? Answer with only one word: yes, no, or unsure.',
  rail: 'Are railroad tracks visible in this satellite image near the center property? Answer with only one word: yes, no, or unsure.',
  commercial: 'Are commercial buildings with large flat roofs or big parking lots directly adjacent to the property at the center of this satellite image? Answer with only one word: yes, no, or unsure.',
  green: 'Does the property at the exact center of this satellite image back onto a park, golf course, greenbelt, or open green space? Answer with only one word: yes, no, or unsure.'
};

const PHOTO_QUESTIONS = {
  powerlines: 'Are overhead power lines or utility poles visible near the house in this photo? Answer with only one word: yes, no, or unsure.',
  road: 'Does the street in front of this house appear busy or multi-lane, with a painted center line or wide pavement? Answer with only one word: yes, no, or unsure.'
};

const VISION_PHOTO_HOSTS = ['maps.googleapis.com', 'ap.rdcpix.com'];

async function askVision(env, imageArray, question) {
  try {
    const res = await env.AI.run(VISION_MODEL, {
      image: imageArray,
      prompt: question,
      max_tokens: 12
    });
    const text = (res && (res.description || res.response)) || '';
    const m = /(yes|no|unsure)/i.exec(text);
    return m ? m[1].toLowerCase() : 'unsure';
  } catch (e) {
    return 'unsure';
  }
}

async function visionVerdicts(env, imageBytes, questions) {
  const imageArray = [...new Uint8Array(imageBytes)];
  const keys = Object.keys(questions);
  const answers = await Promise.all(keys.map(k => askVision(env, imageArray, questions[k])));
  const out = {};
  keys.forEach((k, i) => { out[k] = answers[i]; });
  return out;
}

async function handleVision(params, env, cors) {
  if (!env.AI) return json({ error: 'Workers AI binding not configured' }, 501, cors);
  const lat = parseFloat(params.get('latitude'));
  const lon = parseFloat(params.get('longitude'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'latitude and longitude are required' }, 400, cors);
  }
  const result = { satellite: null, photo: null, errors: [] };

  // ~150 m box centered on the parcel; Esri export is keyless
  const d = 0.0007;
  const satUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'
    + `?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&bboxSR=4326&size=512,512&format=jpg&f=image`;
  try {
    const img = await fetch(satUrl);
    if (!img.ok) throw new Error(`imagery HTTP ${img.status}`);
    result.satellite = await visionVerdicts(env, await img.arrayBuffer(), SATELLITE_QUESTIONS);
  } catch (e) { result.errors.push('satellite: ' + e.message); }

  // Optional street-level photo (host-allowlisted so this isn't an open proxy)
  const photoUrl = params.get('photo');
  if (photoUrl) {
    try {
      const u = new URL(photoUrl);
      if (u.protocol !== 'https:' || !VISION_PHOTO_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) {
        throw new Error('photo host not allowed');
      }
      const img = await fetch(photoUrl);
      if (!img.ok) throw new Error(`photo HTTP ${img.status}`);
      result.photo = await visionVerdicts(env, await img.arrayBuffer(), PHOTO_QUESTIONS);
    } catch (e) { result.errors.push('photo: ' + e.message); }
  }
  return json(result, 200, cors);
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
  try {
    const rec = await realtorRecord(mprId);
    return rec ? json(rec, 200, cors) : json({ error: 'no record' }, 404, cors);
  } catch (e) {
    return json({ error: e.message }, 502, cors);
  }
}

async function handleRentcast(params, env, cors) {
  if (!env.RENTCAST_API_KEY) return json({ error: 'RENTCAST_API_KEY not configured' }, 501, cors);
  const allowed = ['address', 'latitude', 'longitude', 'radius', 'limit'];
  const upstream = new URLSearchParams();
  for (const k of allowed) {
    if (params.get(k)) upstream.set(k, params.get(k));
  }
  if (![...upstream.keys()].length) return json({ error: 'address or latitude/longitude required' }, 400, cors);
  try {
    const rec = await rentcastRecord(upstream, env);
    return rec ? json(rec, 200, cors) : json({ error: 'no record' }, 404, cors);
  } catch (e) {
    return json({ error: e.message }, 502, cors);
  }
}

async function handleMelissa(params, env, cors) {
  if (!env.MELISSA_API_KEY) return json({ error: 'MELISSA_API_KEY not configured' }, 501, cors);
  const ff = params.get('ff');
  if (!ff) return json({ error: 'ff (free-form address) required' }, 400, cors);
  try {
    const rec = await melissaRecord(ff, env);
    return rec ? json(rec, 200, cors) : json({ error: 'no record' }, 404, cors);
  } catch (e) {
    return json({ error: e.message }, 502, cors);
  }
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
              melissa: Boolean(env.MELISSA_API_KEY),
              vision: Boolean(env.AI)
            }
          }, 200, cors);
        case '/lookup':
          return await handleLookup(url.searchParams, env, cors);
        case '/comps':
          return await handleComps(url.searchParams, env, cors);
        case '/vision':
          return await handleVision(url.searchParams, env, cors);
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

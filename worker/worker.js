/**
 * Antigravity Underwriter — property data proxy (Cloudflare Worker)
 *
 * Gives the static PWA keyless property auto-fill by proxying sources a
 * browser can't reach directly, and optionally holding paid-API keys
 * server-side as Worker secrets so they never ship in client code.
 *
 * Routes (all GET):
 *   /health                        → { ok, providers, mls } — connectivity
 *   /mls/probe[?latitude=&longitude=][&sample=1]
 *                                  → MLS feed diagnostic: which transport
 *                                    authenticated, how far the handshake
 *                                    got, the field names the server really
 *                                    publishes, and the normalized record
 *                                    they map to. Field NAMES only unless
 *                                    sample=1 (listing content is licensed)
 *   /lookup?address=...[&mpr_id=][&latitude=&longitude=]
 *                                  → unified ladder: MLS feed (licensed,
 *                                    PRIMARY — overlays every rung below it)
 *                                    → TAD parcels (keyless, Tarrant County
 *                                    only, enriched with the keyless
 *                                    realtor.com rung for the tax bill) →
 *                                    RentCast (secret) → Melissa (secret) →
 *                                    realtor.com (keyless); source labeled
 *   /hail?latitude=&longitude=[&radius=]
 *                                  → NWS local storm reports (IEM CSV,
 *                                    keyless): hail counts/magnitudes near
 *                                    the point, trailing 5 years; the ~1 MB
 *                                    upstream CSV is cached per isolate-day
 *   /comps?address=... | latitude=&longitude=
 *          [&sqft=&beds=&baths=&radius=&months=&limit=]
 *                                  → comp candidates near the subject: MLS
 *                                    CLOSED sales first (real prices); below
 *                                    3 of those, realtor.com sold search
 *                                    (keyless) merges with RentCast AVM
 *                                    comparables (secret, correlation-ranked)
 *                                    as list-price proxies. Deduped by
 *                                    address; response carries priceTruth
 *   /market?latitude=&longitude= | address=... [&radius=]
 *                                  → live market scan: recent solds (12mo),
 *                                    actives and pendings near the point —
 *                                    MLS when licensed (true close prices +
 *                                    real DOM + a separate Active Under
 *                                    Contract bucket), realtor.com keyless
 *                                    otherwise. Feeds absorption auto-fill,
 *                                    trend buckets, competition
 *   /rent?latitude=&longitude=[&zip=&sqft=&beds=&baths=]
 *                                  → rent ladder: MLS CLOSED leases first
 *                                    (transacted rents, free) → RentCast rent
 *                                    AVM (secret, billable — skipped when the
 *                                    feed already answered) + HUD SAFMR by
 *                                    zip (HUD_API_KEY secret, DFW metro) +
 *                                    realtor.com active rentals (keyless)
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
 *   Secrets:  RENTCAST_API_KEY, MELISSA_API_KEY, HUD_API_KEY (routes skip
 *             the provider when unset)
 *   MLS feed (all optional; the whole rung is inert until they exist —
 *   see the "MLS feed" section below for the full list and defaults):
 *     RESO Web API — MLS_API_BASE, MLS_TOKEN_URL, MLS_CLIENT_ID,
 *                    MLS_CLIENT_SECRET, MLS_SCOPE, MLS_TOKEN_AUTH,
 *                    MLS_STATIC_TOKEN
 *     classic RETS — MLS_RETS_LOGIN_URL, MLS_RETS_USERNAME,
 *                    MLS_RETS_PASSWORD, MLS_RETS_UA, MLS_RETS_UA_PASSWORD,
 *                    MLS_RETS_VERSION, MLS_RETS_CLASS
 *     shaping      — MLS_SYSTEM_NAME, MLS_ORIGINATING_SYSTEM,
 *                    MLS_PROPERTY_TYPES, MLS_SUBTYPES, MLS_LEASE_TYPES,
 *                    MLS_FIELD_MAP (JSON), MLS_ATTRIBUTION, MLS_TRANSPORT
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
      description { text beds baths sqft lot_sqft year_built type garage stories }
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

// Unified provider ladder: MLS feed (primary, licensed) → RentCast →
// Melissa → realtor.com (keyless). Providers without a configured secret are
// skipped. MLS facts overlay whichever rung answers, because a listing knows
// the house but rarely knows the tax roll or the owner of record.
async function handleLookup(params, env, cors) {
  const address = params.get('address');
  if (!address) return json({ error: 'address is required' }, 400, cors);
  const providerErrors = [];

  // Tarrant County parcels are free from TAD's public FeatureServer — in
  // the home county this rung replaces a billable RentCast call WHEN the
  // keyless realtor enrich can supply the tax bill TAD doesn't carry.
  // A tax-less TAD record must NOT short-circuit the keyed rungs: the
  // client caches records per address with no TTL, so returning a degraded
  // record here would starve the tax-reassessment and protest features for
  // that address permanently. TAD is instead held as a gap-filler for
  // whichever later rung hits, and only returned bare when everything
  // else missed (still better than a 404).
  const lat0 = parseFloat(params.get('latitude'));
  const lon0 = parseFloat(params.get('longitude'));
  let tad = null;
  if (inTarrant(lat0, lon0)) {
    try { tad = await tadRecord(lat0, lon0, address); }
    catch (e) { providerErrors.push('TAD: ' + e.message); }
  }
  if (tad) {
    try {
      let mprId = params.get('mpr_id');
      if (!mprId || !/^\d+$/.test(mprId)) mprId = await resolveMprId(address);
      if (mprId && /^\d+$/.test(mprId)) {
        const rr = await realtorRecord(mprId);
        // Same wrong-house guard as the TAD rung itself: an mpr_id resolved
        // from a bare address string can be a different property entirely
        if (rr && streetMatch(address, rr.formattedAddress)) {
          const merged = mergeRecords(tad, rr);
          if (merged.annualTaxes) return json(merged, 200, cors);
          tad = merged; // keep the extra fields; still hunting a tax bill
        }
      }
    } catch (e) { providerErrors.push('realtor enrich: ' + e.message); }
  }

  // ---- MLS rung (primary) ----
  // A licensed feed is the only source that knows what the house actually
  // SOLD for — every rung below it is a proxy. It rarely carries the tax roll
  // or an owner record though, so it does NOT end the ladder on its own: it
  // overlays whatever fills those gaps, the mirror image of how TAD fills
  // from underneath.
  let mlsRec = null;
  if (mlsConfigured(env)) {
    try { mlsRec = await mlsRecord(env, address, lat0, lon0); }
    catch (e) { providerErrors.push(mlsSystemName(env) + ': ' + e.message); }
  }
  if (mlsRec) {
    const merged = tad ? mergeRecords(mlsRec, tad) : mlsRec;
    // Same invariant the TAD rung obeys: a record with no tax bill must never
    // end the ladder — the client caches per address with no TTL, so a
    // degraded record would starve tax reassessment and the protest packet
    // for that address permanently. With a tax bill in hand there is nothing
    // left to hunt, and skipping the rest saves a billable RentCast call.
    if (merged.annualTaxes) return json(merged, 200, cors);
  }
  // MLS facts win, the answering provider fills, TAD fills last.
  const respond = (rec) => {
    let out = rec;
    if (mlsRec) out = out ? mergeRecords(mlsRec, out) : mlsRec;
    if (tad && out && out !== tad) out = mergeRecords(out, tad);
    return json(out || tad, 200, cors);
  };

  if (env.RENTCAST_API_KEY) {
    try {
      let rec = await rentcastRecord(new URLSearchParams({ address }), env);
      if (!rec && params.get('latitude') && params.get('longitude')) {
        rec = await rentcastRecord(new URLSearchParams({
          latitude: params.get('latitude'), longitude: params.get('longitude'),
          radius: '0.05', limit: '1'
        }), env);
      }
      if (rec) return respond(rec);
    } catch (e) { providerErrors.push('RentCast: ' + e.message); }
  }

  if (env.MELISSA_API_KEY) {
    try {
      const rec = await melissaRecord(address, env);
      if (rec) return respond(rec);
    } catch (e) { providerErrors.push('Melissa: ' + e.message); }
  }

  try {
    let mprId = params.get('mpr_id');
    if (!mprId || !/^\d+$/.test(mprId)) mprId = await resolveMprId(address);
    if (mprId && /^\d+$/.test(mprId)) {
      const rec = await realtorRecord(mprId);
      if (rec) return respond(rec);
    }
  } catch (e) { providerErrors.push('realtor.com: ' + e.message); }

  if (mlsRec || tad) return respond(null); // listing/parcel truth beats a 404
  return json({ error: 'no record', providerErrors }, 404, cors);
}

// Separate query for /market and /rent so an unproven field can never break
// the battle-tested /comps query. list_date + flags split actives/pendings.
const MARKET_QUERY = `query MarketScan($query: HomeSearchCriteria!, $limit: Int, $sort: [SearchAPISort]) {
  home_search(query: $query, limit: $limit, sort: $sort) {
    total
    results {
      property_id
      status
      list_price
      last_sold_price
      last_sold_date
      list_date
      flags { is_pending is_contingent }
      description { sqft beds baths type }
      location { address { line postal_code coordinate { lat lon } } }
    }
  }
}`;

async function realtorSearch(queryVars) {
  const res = await fetch('https://www.realtor.com/frontdoor/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'rdc-client-name': 'RDC_WEB_DETAILS_PAGE',
      'rdc-client-version': '3.x.x',
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://www.realtor.com',
      'Referer': 'https://www.realtor.com/'
    },
    body: JSON.stringify({ operationName: 'MarketScan', query: MARKET_QUERY, variables: queryVars })
  });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const data = await res.json();
  if (data.errors && data.errors.length) throw new Error('GraphQL: ' + JSON.stringify(data.errors[0]).slice(0, 120));
  const hs = data && data.data && data.data.home_search;
  return { total: (hs && hs.total) || 0, results: (hs && hs.results) || [] };
}

// Live market scan: what's sold (12mo), what's listed, what's pending near
// the point — feeds the absorption meter, trend buckets and the competition
// panel without an MLS hot sheet.
async function handleMarket(params, env, cors) {
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
  const minDate = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10);
  const nearby = { coordinates: [lon, lat], radius: `${radius}mi` };
  const providerErrors = [];

  // ---- MLS rung: the real hot sheet ----
  // Closed / active / pending straight from the source, with true close
  // prices and real days-on-market. The scrape below can only approximate
  // this, and can't see "Active Under Contract" at all.
  if (mlsConfigured(env)) {
    try {
      const scan = await mlsMarket(env, lat, lon, radius, params.get('zip') || '');
      if (scan.solds.length || scan.actives.length || scan.pendings.length) {
        return json({
          subject: { latitude: lat, longitude: lon, radiusMi: radius },
          totals: { sold12mo: scan.solds.length, forSale: scan.actives.length + scan.pendings.length },
          solds: scan.solds, actives: scan.actives, pendings: scan.pendings,
          source: mlsSystemName(env), priceTruth: 'closed',
          attribution: env.MLS_ATTRIBUTION || null,
          providerErrors: providerErrors.concat((scan.errors || []).map(e => mlsSystemName(env) + ' ' + e))
        }, 200, cors);
      }
    } catch (e) { providerErrors.push(mlsSystemName(env) + ': ' + e.message); }
  }

  const [soldRes, saleRes] = await Promise.all([
    realtorSearch({
      query: { status: ['sold'], type: ['single_family'], sold_date: { min: minDate }, nearby },
      limit: 200, sort: [{ field: 'sold_date', direction: 'desc' }]
    }).catch(e => { providerErrors.push('sold: ' + e.message); return null; }),
    realtorSearch({
      query: { status: ['for_sale'], type: ['single_family'], nearby },
      limit: 200, sort: [{ field: 'list_date', direction: 'desc' }]
    }).catch(e => { providerErrors.push('for_sale: ' + e.message); return null; })
  ]);

  const mapRow = (r) => {
    const d = r.description || {};
    const addr = (r.location && r.location.address) || {};
    return {
      address: addr.line || null,
      price: numOrNull(r.last_sold_price) || numOrNull(r.list_price),
      listPrice: numOrNull(r.list_price),
      soldDate: r.last_sold_date || null,
      listDate: r.list_date || null,
      sqft: numOrNull(d.sqft),
      beds: numOrNull(d.beds)
    };
  };
  const solds = soldRes ? soldRes.results.map(mapRow) : [];
  const actives = [];
  const pendings = [];
  if (saleRes) {
    for (const r of saleRes.results) {
      const f = r.flags || {};
      (f.is_pending || f.is_contingent ? pendings : actives).push(mapRow(r));
    }
  }
  return json({
    subject: { latitude: lat, longitude: lon, radiusMi: radius },
    totals: { sold12mo: soldRes ? soldRes.total : null, forSale: saleRes ? saleRes.total : null },
    solds, actives, pendings,
    source: 'realtor.com', priceTruth: 'proxy',
    providerErrors
  }, 200, cors);
}

// Rent ladder: RentCast rent AVM (secret) + HUD SAFMR (secret; DFW is a
// mandatory Small-Area-FMR metro so payment standards are zip-level) +
// realtor.com active rentals (keyless). Providers without secrets are
// skipped, never fatal.
const HUD_DFW_METRO = 'METRO19100M19100'; // Dallas–Fort Worth–Arlington
let hudSafmrCache = null; // per-isolate cache — the table changes annually

async function handleRent(params, env, cors) {
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
  const zip = (params.get('zip') || '').trim();
  const providerErrors = [];
  const out = { rentcast: null, hud: null, rentals: [], mls: null, providerErrors };

  // ---- MLS rung: closed leases are transacted rents, and cost nothing ----
  // A RentCast rent-AVM call bills a credit, so the real thing is fetched
  // first and the model is only paid for when the lease market is too thin
  // to read. Engine rentFromComps() prefers status:'closed' rows outright.
  let mlsClosedLeases = 0;
  if (mlsConfigured(env)) {
    try {
      const leases = await mlsLeases(env, lat, lon, 1, zip);
      for (const err of leases.errors || []) providerErrors.push(mlsSystemName(env) + ' ' + err);
      mlsClosedLeases = leases.filter(l => l.status === 'closed').length;
      out.mls = {
        name: mlsSystemName(env), leases: leases.length, closed: mlsClosedLeases,
        attribution: env.MLS_ATTRIBUTION || null
      };
      out.rentals = Array.from(leases);
    } catch (e) { providerErrors.push(mlsSystemName(env) + ': ' + e.message); }
  }
  const MLS_LEASES_ENOUGH = 3;
  const thinLeaseMarket = mlsClosedLeases < MLS_LEASES_ENOUGH;

  const jobs = [];

  if (thinLeaseMarket && env.RENTCAST_API_KEY) {
    const q = new URLSearchParams({
      latitude: String(lat), longitude: String(lon), propertyType: 'Single Family', compCount: '8'
    });
    if (params.get('sqft')) q.set('squareFootage', params.get('sqft'));
    if (params.get('beds')) q.set('bedrooms', params.get('beds'));
    if (params.get('baths')) q.set('bathrooms', params.get('baths'));
    jobs.push(fetch(`https://api.rentcast.io/v1/avm/rent/long-term?${q}`, {
      headers: { 'X-Api-Key': env.RENTCAST_API_KEY, 'Accept': 'application/json' }
    }).then(async res => {
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      const d = res.ok ? await res.json() : {};
      if (d.rent > 0) {
        out.rentcast = {
          rent: d.rent, low: numOrNull(d.rentRangeLow), high: numOrNull(d.rentRangeHigh),
          comparables: (d.comparables || []).map(c => ({
            address: c.addressLine1 || (c.formattedAddress || '').split(',')[0],
            rent: numOrNull(c.price), sqft: numOrNull(c.squareFootage),
            beds: numOrNull(c.bedrooms), distanceMi: c.distance != null ? Math.round(c.distance * 100) / 100 : null,
            correlation: c.correlation != null ? c.correlation : null
          }))
        };
      }
    }).catch(e => providerErrors.push('RentCast: ' + e.message)));
  }

  if (env.HUD_API_KEY && zip) {
    jobs.push((async () => {
      try {
        if (!hudSafmrCache) {
          const res = await fetch(`https://www.huduser.gov/hudapi/public/fmr/data/${HUD_DFW_METRO}`, {
            headers: { 'Authorization': `Bearer ${env.HUD_API_KEY}`, 'Accept': 'application/json' }
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          hudSafmrCache = (d && d.data && d.data.basicdata) || [];
        }
        const row = hudSafmrCache.find(r => String(r.zip_code) === zip);
        if (row) {
          out.hud = {
            zip, year: row.year || null,
            byBedroom: {
              0: numOrNull(row['Efficiency']), 1: numOrNull(row['One-Bedroom']),
              2: numOrNull(row['Two-Bedroom']), 3: numOrNull(row['Three-Bedroom']),
              4: numOrNull(row['Four-Bedroom'])
            }
          };
        }
      } catch (e) { providerErrors.push('HUD: ' + e.message); }
    })());
  }

  // Scraped ASKING rents are the weakest rung — skipped entirely once the
  // feed has produced enough closed leases, and concatenated (never
  // assigned) so they can't clobber them when it hasn't.
  if (thinLeaseMarket) jobs.push(realtorSearch({
    query: { status: ['for_rent'], type: ['single_family'], nearby: { coordinates: [lon, lat], radius: '1mi' } },
    limit: 20, sort: [{ field: 'list_date', direction: 'desc' }]
  }).then(r => {
    out.rentals = out.rentals.concat(r.results.map(x => {
      const d = x.description || {};
      const addr = (x.location && x.location.address) || {};
      return {
        address: addr.line || null, rent: numOrNull(x.list_price),
        sqft: numOrNull(d.sqft), beds: numOrNull(d.beds), baths: numOrNull(d.baths),
        status: 'active'
      };
    }).filter(x => x.rent > 0));
  }).catch(e => providerErrors.push('realtor rentals: ' + e.message)));

  await Promise.all(jobs);
  return json(out, 200, cors);
}

// ---- TAD (Tarrant Appraisal District) parcel rung ----
// Public keyless ArcGIS FeatureServer, verified live 2026-08-14. Point-in-
// parcel query; a SITUS street-number mismatch with the requested address
// is treated as a miss so a geocode landing on the neighbor's parcel can
// never fill the wrong house's data.
const TAD_PARCELS_URL = 'https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcels/FeatureServer/0/query';

// Tarrant's TIGER extent is ~(-97.549..-97.033, 32.548..32.991); a small pad
// keeps edge parcels in without sending Irving/Grand Prairie (Dallas Co.)
// on guaranteed-miss TAD round trips.
function inTarrant(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= 32.52 && lat <= 33.01 && lon >= -97.60 && lon <= -97.02;
}

// Do two address strings plausibly name the same house? Leading street
// numbers must agree numerically, a fractional address ("2115 1/2 Lipscomb")
// only matches a candidate carrying the same fraction (the main house's
// parcel must never fill the half-address), and the first street-name token
// (directionals stripped) must agree when both sides have one. Unparseable
// input doesn't block — this is a wrong-house guard, not a validator.
const DIRECTIONALS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NORTH', 'SOUTH', 'EAST', 'WEST'];

function streetMatch(reqAddress, candAddress) {
  const parse = (s) => {
    const m = /^(\d+)\s*(\d+\/\d+)?\s+(.+)$/.exec(String(s || '').toUpperCase().trim());
    if (!m) return null;
    const toks = m[3].replace(/[^A-Z0-9/ ]/g, ' ').split(/\s+/)
      .filter(t => t && DIRECTIONALS.indexOf(t) === -1);
    return { no: parseInt(m[1], 10), frac: m[2] || null, name: toks[0] || '' };
  };
  const a = parse(reqAddress);
  const b = parse(candAddress);
  if (!a || !b) return true;
  if (a.no !== b.no) return false;
  if ((a.frac || b.frac) && a.frac !== b.frac) return false;
  if (a.name && b.name && a.name !== b.name) return false;
  return true;
}

async function tadRecord(lat, lon, address) {
  const q = new URLSearchParams({
    geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    outFields: 'SITUS_ADDR,OWNER_NAME,OWNER_ADDR,OWNER_CITY,OWNER_ZIP,ACCOUNT,LEGAL_1,LEGAL_2,'
      + 'SubdivisionName,SCHOOL,DEED_DATE,GARAGE_CAP,BEDROOMS,BATHROOMS,YEAR_BUILT,LIVING_ARE,'
      + 'SW_POOL,LAND_SQFT,LAND_ACRES,CENTRAL_HE,CENTRAL_AI,LAND_VALUE,IMPR_VALUE,TOTAL_VALU,'
      + 'APPRAISEDV,EXEMPTION_',
    returnGeometry: 'false', f: 'json'
  });
  const res = await fetch(`${TAD_PARCELS_URL}?${q}`);
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error('ArcGIS: ' + (data.error.message || 'query error'));
  const a = data.features && data.features[0] && data.features[0].attributes;
  if (!a) return null;
  const trim = (s) => { const t = s == null ? '' : String(s).trim(); return t || null; };
  // Wrong-parcel guard: number + street-name + fraction must plausibly agree
  if (!streetMatch(address, trim(a.SITUS_ADDR))) return null;
  if (!numOrNull(a.LIVING_ARE)) return null; // vacant/unimproved parcel — not a usable SFR record
  return {
    sqft: numOrNull(a.LIVING_ARE),
    beds: numOrNull(a.BEDROOMS),   // TAD stores 0 for unknown — numOrNull maps it to null
    baths: numOrNull(a.BATHROOMS),
    lot: numOrNull(a.LAND_SQFT) || (numOrNull(a.LAND_ACRES) ? Math.round(a.LAND_ACRES * 43560) : null),
    year: numOrNull(a.YEAR_BUILT),
    garage: numOrNull(a.GARAGE_CAP),
    pool: trim(a.SW_POOL) === 'Y' ? true : null, // blank ≠ proven no-pool
    stories: null,
    subdivision: trim(a.SubdivisionName),
    hoa: null,
    propType: null,
    county: 'Tarrant',
    zoning: null,
    apn: trim(a.ACCOUNT),
    legal: [trim(a.LEGAL_1), trim(a.LEGAL_2)].filter(Boolean).join(' ') || null,
    garageType: null,
    foundation: null,
    roof: null,
    exterior: null,
    heating: trim(a.CENTRAL_HE) === 'Y' ? 'Central' : null,
    cooling: trim(a.CENTRAL_AI) === 'Y' ? 'Central' : null,
    assessedValue: numOrNull(a.TOTAL_VALU) || numOrNull(a.APPRAISEDV),
    assessedLand: numOrNull(a.LAND_VALUE),
    assessedImprov: numOrNull(a.IMPR_VALUE),
    annualTaxes: null,   // TAD publishes value, not the bill — realtor enrich fills it
    lastSaleDate: numOrNull(a.DEED_DATE) ? new Date(a.DEED_DATE).toISOString().slice(0, 10) : null,
    lastSalePrice: null, // TX non-disclosure
    listPrice: null,
    listingStatus: null,
    hoaFee: null,
    ownerNames: trim(a.OWNER_NAME),
    ownerType: null,
    ownerOccupied: null,
    ownerMailing: [trim(a.OWNER_ADDR), trim(a.OWNER_CITY), trim(a.OWNER_ZIP)].filter(Boolean).join(', ') || null,
    lat, lon,
    formattedAddress: null, // keep the client's canonical picked address
    source: 'TAD (Tarrant)',
    extra: { school: trim(a.SCHOOL), exemptions: trim(a.EXEMPTION_), lat, lon }
  };
}

// Fill a primary record's gaps from another provider (never overwrite).
// formattedAddress is deliberately excluded: the client keeps its canonical
// picked address, and a filler must never rewrite the subject's identity.
function mergeRecords(primary, filler) {
  const out = { ...primary };
  for (const [k, v] of Object.entries(filler || {})) {
    if (k === 'source' || k === 'extra' || k === 'formattedAddress') continue;
    if ((out[k] === null || out[k] === undefined || out[k] === '') && v !== null && v !== undefined && v !== '') {
      out[k] = v;
    }
  }
  out.extra = { ...((filler && filler.extra) || {}), ...(primary.extra || {}) };
  out.source = `${primary.source} + ${(filler && filler.source) || 'unknown'}`;
  return out;
}

// ============================================================================
// ---- MLS feed (RESO Web API / classic RETS) — the PRIMARY data source ----
// ============================================================================
// Everything else in this file is a proxy for MLS data the app couldn't get:
// realtor.com list prices standing in for Texas's non-disclosure sold prices,
// an AVM standing in for closed leases, scraped counts standing in for real
// absorption. With a licensed feed configured, those become the FALLBACK and
// this rung answers with the actual transaction record.
//
// Two transports, because "a RETS feed" means either one in practice:
//   reso — RESO Web API (OData v4 + OAuth2 bearer). What Trestle/CoreLogic,
//          Bridge, MLS Grid and Spark all serve today.
//   rets — classic RETS 1.7.2/1.8 (Login handshake + DMQL2 + COMPACT-DECODED).
//
// Credentials live ONLY here, as Worker secrets. An MLS data license forbids
// shipping them to a browser, so unlike RentCast/Melissa there is deliberately
// no client-side paste path for these.
//
// Every rung is a no-op until the secrets exist: mlsConfigured() gates all of
// it, so an unconfigured worker behaves exactly as it did before.

// Field names default to the RESO Data Dictionary. MLS_FIELD_MAP (JSON) can
// override any single entry for a feed with local names — that is the one
// knob needed to adapt to a non-standard server, and /mls/probe reports the
// server's actual field list so the override can be written from evidence.
const MLS_DEFAULT_FIELDS = {
  key: 'ListingKey',
  mlsNumber: 'ListingId',
  address: 'UnparsedAddress',
  streetNumber: 'StreetNumberNumeric',
  streetName: 'StreetName',
  city: 'City',
  state: 'StateOrProvince',
  postal: 'PostalCode',
  county: 'CountyOrParish',
  lat: 'Latitude',
  lon: 'Longitude',
  // LivingArea, not BuildingAreaTotal: BuildingAreaTotal can include garage
  // and unfinished space, which would silently inflate every $/sqft read
  sqft: 'LivingArea',
  sqftAlt: 'AboveGradeFinishedArea',
  beds: 'BedroomsTotal',
  bathsDecimal: 'BathroomsTotalDecimal',
  bathsFull: 'BathroomsFull',
  bathsHalf: 'BathroomsHalf',
  // BathroomsTotalInteger is a SIMPLE SUM (2 full + 1 half = 3, not 2.5) —
  // last resort only, never ahead of the decimal or the component fields
  bathsTotal: 'BathroomsTotalInteger',
  lotSqft: 'LotSizeSquareFeet',
  lotAcres: 'LotSizeAcres',
  year: 'YearBuilt',
  garage: 'GarageSpaces',
  stories: 'StoriesTotal',
  levels: 'Levels',
  pool: 'PoolPrivateYN',
  poolFeatures: 'PoolFeatures',
  subdivision: 'SubdivisionName',
  propType: 'PropertyType',
  propSubType: 'PropertySubType',
  listPrice: 'ListPrice',
  originalListPrice: 'OriginalListPrice',
  closePrice: 'ClosePrice',
  closeDate: 'CloseDate',
  listDate: 'OnMarketDate',
  contractDate: 'ListingContractDate',
  dom: 'DaysOnMarket',
  cdom: 'CumulativeDaysOnMarket',
  status: 'StandardStatus',
  mlsStatus: 'MlsStatus',
  concessions: 'ConcessionsAmount',
  concessionsYN: 'Concessions',
  concessionsComments: 'ConcessionsComments',
  remarks: 'PublicRemarks',
  condition: 'PropertyCondition',
  taxAnnual: 'TaxAnnualAmount',
  taxAssessed: 'TaxAssessedValue',
  parcel: 'ParcelNumber',
  hoaFee: 'AssociationFee',
  hoaFreq: 'AssociationFeeFrequency',
  hoaYN: 'AssociationYN',
  roof: 'Roof',
  foundation: 'FoundationDetails',
  heating: 'Heating',
  cooling: 'Cooling',
  exterior: 'ConstructionMaterials',
  zoning: 'Zoning',
  modified: 'ModificationTimestamp',
  originatingSystem: 'OriginatingSystemName'
};

// RESO StandardStatus values, grouped the way underwriting cares: what sold,
// what a new listing competes against, and what is already spoken for.
//
// SPELLING TRAP: the Data Dictionary writes 'Active Under Contract' with
// spaces, but an OData enum MEMBER name has none, and servers differ on which
// form a $filter accepts (Trestle serves the compact form unless you ask for
// PrettyEnums=true). Both spellings ship by default and each status group is
// queried independently, so a server that rejects one literal loses that
// bucket rather than the whole scan. MLS_STATUS_* overrides per feed.
const MLS_STATUS = {
  closed: ['Closed'],
  active: ['Active'],
  pending: ['Pending', 'ActiveUnderContract']
};

function mlsStatuses(env, group) {
  const raw = (env['MLS_STATUS_' + group.toUpperCase()] || '').trim();
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : MLS_STATUS[group];
}

// Compact enum members read badly in a UI ('ActiveUnderContract'). Split on
// case boundaries for display only — never for filtering.
function mlsPrettyStatus(v) {
  const s = mlsFlat(v);
  if (!s || /\s/.test(s)) return s;
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function mlsFields(env) {
  let override = {};
  if (env.MLS_FIELD_MAP) {
    try { override = JSON.parse(env.MLS_FIELD_MAP); }
    catch (e) { /* a malformed override must never break the whole feed */ }
  }
  return { ...MLS_DEFAULT_FIELDS, ...override };
}

function mlsTransport(env) {
  const explicit = (env.MLS_TRANSPORT || '').trim().toLowerCase();
  if (explicit === 'reso' || explicit === 'rets') return explicit;
  if (env.MLS_API_BASE || env.MLS_STATIC_TOKEN) return 'reso';
  if (env.MLS_RETS_LOGIN_URL) return 'rets';
  return null;
}

function mlsConfigured(env) {
  const t = mlsTransport(env);
  if (t === 'reso') {
    return Boolean(env.MLS_API_BASE && (env.MLS_STATIC_TOKEN || (env.MLS_CLIENT_ID && env.MLS_CLIENT_SECRET)));
  }
  if (t === 'rets') {
    return Boolean(env.MLS_RETS_LOGIN_URL && env.MLS_RETS_USERNAME && env.MLS_RETS_PASSWORD);
  }
  return false;
}

function mlsSystemName(env) {
  return (env.MLS_SYSTEM_NAME || '').trim() || 'MLS';
}

// Subrequest budget guard: a hung feed must degrade to the keyless fallback,
// never hold the whole response open until the platform kills it.
const MLS_TIMEOUT_MS = 8000;

function mlsSignal(ms) {
  try { return AbortSignal.timeout(ms || MLS_TIMEOUT_MS); }
  catch (e) { return undefined; } // older runtime: no timeout, still functional
}

// ---- RESO Web API transport (OData v4) ----

// Per-isolate token cache. Isolates are short-lived and there is no shared
// state, so at worst this re-authenticates once per cold start.
let mlsTokenCache = null; // { token, expiresAt, clientId }

async function mlsBearer(env) {
  if (env.MLS_STATIC_TOKEN) return env.MLS_STATIC_TOKEN.trim();
  const now = Date.now();
  // Keyed by client id so rotating the credential can never be served a
  // stale token out of a still-warm isolate. Refreshed five minutes early:
  // a token that expires mid-flight costs a whole request round trip.
  if (mlsTokenCache && mlsTokenCache.clientId === env.MLS_CLIENT_ID
      && mlsTokenCache.expiresAt > now + 300000) {
    return mlsTokenCache.token;
  }
  if (!env.MLS_TOKEN_URL) throw new Error('MLS_TOKEN_URL not configured');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: (env.MLS_SCOPE || 'api').trim()
  });
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  };
  // Both styles are in the wild: Trestle documents credentials in the body,
  // other IdPs want HTTP Basic. MLS_TOKEN_AUTH picks.
  if ((env.MLS_TOKEN_AUTH || 'body').trim().toLowerCase() === 'basic') {
    headers['Authorization'] = 'Basic ' + btoa(`${env.MLS_CLIENT_ID}:${env.MLS_CLIENT_SECRET}`);
  } else {
    body.set('client_id', env.MLS_CLIENT_ID);
    body.set('client_secret', env.MLS_CLIENT_SECRET);
  }

  const res = await fetch(env.MLS_TOKEN_URL.trim(), {
    method: 'POST', headers, body, signal: mlsSignal()
  });
  const text = await res.text();
  if (!res.ok) {
    // The IdP's error body names the actual problem (bad scope, wrong grant,
    // revoked client) — surfacing it is the difference between a 10-second
    // fix and a support ticket. Never echo the credentials themselves.
    throw new Error(`token HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error('token response was not JSON: ' + text.slice(0, 120)); }
  if (!data.access_token) throw new Error('token response carried no access_token');
  mlsTokenCache = {
    token: data.access_token,
    clientId: env.MLS_CLIENT_ID,
    expiresAt: Date.now() + (Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600) * 1000
  };
  return mlsTokenCache.token;
}

// GET an OData resource. Retries once on 401 (expired token beats the cache)
// and once on 400 with $orderby stripped (a feed that doesn't publish the
// sort field rejects the whole query rather than ignoring the clause).
async function resoGet(env, resource, params, attempt) {
  const base = (env.MLS_API_BASE || '').trim().replace(/\/+$/, '');
  const token = await mlsBearer(env);
  const url = `${base}/${resource}?${params}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'User-Agent': (env.MLS_USER_AGENT || 'AntigravityUnderwriter/1.0').trim()
    },
    signal: mlsSignal()
  });
  if (res.ok) return await res.json();

  const body = await res.text();
  if (res.status === 401 && !attempt) {
    mlsTokenCache = null;
    return await resoGet(env, resource, params, 1);
  }
  if (res.status === 400 && !attempt && /\$orderby=/.test(params)) {
    const stripped = params.replace(/&?\$orderby=[^&]*/g, '');
    return await resoGet(env, resource, stripped, 1);
  }
  throw new Error(`RESO HTTP ${res.status}: ${body.slice(0, 200)}`);
}

// ---- Geography: RESO Web API has no portable radius operator ----
// geo.distance() is optional in OData and most MLS feeds don't implement it,
// so the query asks for a lat/lon BOUNDING BOX (universally filterable) and
// the true great-circle distance is applied here with milesBetween(). The box
// is the circle's circumscribing square, so it over-fetches by ~27% and the
// distance filter trims the corners — never the reverse.
function mlsBbox(lat, lon, radiusMi) {
  const dLat = radiusMi / 69;
  const cos = Math.cos(lat * Math.PI / 180);
  const dLon = radiusMi / (69 * (Math.abs(cos) > 0.01 ? Math.abs(cos) : 0.01));
  return {
    latMin: lat - dLat, latMax: lat + dLat,
    lonMin: lon - dLon, lonMax: lon + dLon
  };
}

const odataStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const odataDay = (ms) => new Date(ms).toISOString().slice(0, 10); // Edm.Date

// numOrNull() rejects anything <= 0, which is right for prices and areas and
// WRONG for a western longitude. Coordinates get their own reader: finite and
// non-zero, since 0/0 is the null-island sentinel a feed emits for "unknown".
const mlsCoord = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

function mlsOrFilter(field, values) {
  const list = (values || []).filter(Boolean);
  if (!list.length) return null;
  return '(' + list.map(v => `${field} eq ${odataStr(v)}`).join(' or ') + ')';
}

/**
 * One search against the feed, transport-agnostic at the call site.
 * opts: { statuses[], propertyTypes[], subTypes[], lat, lon, radiusMi,
 *         sinceDays, dateField, limit, orderby, extraFilter }
 * Returns raw provider rows (already distance-trimmed when coordinates were
 * supplied) with a `_distanceMi` annotation.
 */
async function mlsSearch(env, opts) {
  const f = mlsFields(env);
  const rows = mlsTransport(env) === 'rets'
    ? await retsSearch(env, opts, f)
    : await resoSearch(env, opts, f);

  // Distance trim + annotate. A row with no coordinates is KEPT (the bbox
  // already bounded it if it had any) but never claims a distance it can't
  // prove — the client's ranking treats null distance as middling, not near.
  const { lat, lon } = opts;
  const haveSubject = Number.isFinite(lat) && Number.isFinite(lon);
  const radius = opts.radiusMi;
  const out = [];
  for (const r of rows) {
    const rLat = mlsCoord(r[f.lat]);
    const rLon = mlsCoord(r[f.lon]);
    if (haveSubject && rLat != null && rLon != null) {
      const d = milesBetween(lat, lon, rLat, rLon);
      if (radius && d > radius) continue;
      r._distanceMi = Math.round(d * 100) / 100;
    } else {
      r._distanceMi = null;
    }
    out.push(r);
  }
  if (opts.orderby === 'closeDateDesc') {
    out.sort((a, b) => String(b[f.closeDate] || '').localeCompare(String(a[f.closeDate] || '')));
  }
  return opts.limit ? out.slice(0, opts.limit) : out;
}

async function resoSearch(env, opts, f) {
  const clauses = [];
  const status = mlsOrFilter(f.status, opts.statuses);
  if (status) clauses.push(status);
  const ptype = mlsOrFilter(f.propType, opts.propertyTypes);
  if (ptype) clauses.push(ptype);
  const sub = mlsOrFilter(f.propSubType, opts.subTypes);
  if (sub) clauses.push(sub);
  // Multi-MLS aggregators (Trestle serves dozens) must be pinned to the one
  // system the license covers, or the results mix markets.
  if (env.MLS_ORIGINATING_SYSTEM) {
    clauses.push(`${f.originatingSystem} eq ${odataStr(env.MLS_ORIGINATING_SYSTEM.trim())}`);
  }
  if (opts.sinceDays > 0) {
    const field = opts.dateField || f.closeDate;
    clauses.push(`${field} ge ${odataDay(Date.now() - opts.sinceDays * 86400000)}`);
  }
  const haveGeo = Number.isFinite(opts.lat) && Number.isFinite(opts.lon) && opts.radiusMi > 0;
  if (haveGeo && !opts.postalOnly) {
    // A GeographyPoint column (Trestle publishes X_Location) supports a true
    // radius; without one, a lat/lon box on plain decimals works everywhere.
    // MLS_GEO_FIELD opts into the former once /mls/probe confirms the column.
    const geoField = (env.MLS_GEO_FIELD || '').trim();
    if (geoField) {
      const meters = Math.round(opts.radiusMi * 1609.344);
      clauses.push(`geo.distance(${geoField}, geography'POINT(${opts.lon} ${opts.lat})') le ${meters}`);
    } else {
      const b = mlsBbox(opts.lat, opts.lon, opts.radiusMi);
      clauses.push(`${f.lat} ge ${b.latMin.toFixed(6)}`, `${f.lat} le ${b.latMax.toFixed(6)}`);
      clauses.push(`${f.lon} ge ${b.lonMin.toFixed(6)}`, `${f.lon} le ${b.lonMax.toFixed(6)}`);
    }
  }
  // Coordinates are not index-accelerated on Trestle; PostalCode is. This is
  // the narrowed retry a gateway timeout falls back to (see below).
  if (opts.postalOnly && opts.zip) clauses.push(`${f.postal} eq ${odataStr(opts.zip)}`);
  if (opts.extraFilter) clauses.push(opts.extraFilter);

  const params = new URLSearchParams();
  if (clauses.length) params.set('$filter', clauses.join(' and '));
  // Deliberately NO $select by default: naming a field the feed doesn't
  // publish rejects the entire query, and this app cannot know a given MLS's
  // field set in advance. MLS_SELECT exists for payload tuning once known.
  if (env.MLS_SELECT) params.set('$select', env.MLS_SELECT.trim());
  // Over-fetch: the bbox is wider than the circle, so ask for headroom and
  // let the distance trim cut it back to `limit`. Trestle caps $top at 1000
  // and defaults to 10 — never rely on the default.
  params.set('$top', String(Math.min(200, Math.max(opts.limit || 20, (opts.limit || 20) * 3))));
  if (opts.orderby === 'closeDateDesc') params.set('$orderby', `${f.closeDate} desc`);
  if (opts.orderby === 'listDateDesc') params.set('$orderby', `${f.modified} desc`);
  // Feed-specific query switches (Trestle: PrettyEnums=true) without needing
  // a code change per MLS
  for (const [k, v] of new URLSearchParams(env.MLS_QUERY_EXTRA || '')) params.set(k, v);

  const resource = (env.MLS_RESOURCE || 'Property').trim();
  try {
    const data = await resoGet(env, resource, params.toString());
    return Array.isArray(data && data.value) ? data.value : [];
  } catch (e) {
    // 504 = "your query took too long". Coordinates are not index-accelerated,
    // so the fix is to drop the box and lean on PostalCode, which is. Better a
    // zip-shaped comp set than none — and the distance trim still applies.
    if (/HTTP 50[34]/.test(e.message) && haveGeo && opts.zip && !opts.postalOnly) {
      return await resoSearch(env, { ...opts, postalOnly: true }, f);
    }
    throw e;
  }
}

// ---- Classic RETS 1.x transport ----
// Unverified against a live server (no credentials at build time); /mls/probe
// exercises the whole handshake and reports exactly where it stops.

// RFC 1321 MD5, implemented here rather than through
// crypto.subtle.digest('MD5'). That call works on Cloudflare — MD5 is a
// non-standard extension they add — but on no other runtime, including the
// Node one these tests run under, so the digest paths would have been
// untestable. RETS offers no alternative digest to substitute: both HTTP
// Digest auth and RETS-UA-Authorization specify MD5 outright. A few dozen
// lines buys a single code path that is verifiable against RFC test vectors.
const MD5_K = new Int32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

function md5Hex(input) {
  const msg = new TextEncoder().encode(String(input));
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
  const M = new Int32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setInt32(0, a0, true); odv.setInt32(4, b0, true);
  odv.setInt32(8, c0, true); odv.setInt32(12, d0, true);
  return [...out].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The RETS spec shows the capability block as one KEY=VALUE per line, but
// real servers don't all agree. NTREIS's Matrix server (ntrdd.mlsmatrix.com,
// captured live 2026-08-26) puts every pair on ONE line separated by spaces:
//   <RETS-RESPONSE> MemberName= User=REDACTED_NID,... Login=https://... </RETS-RESPONSE>
// A line-based parser reads that as a single key whose value is the entire
// rest of the block, finds no Search URL, and every later request dies with a
// misleading "no Search capability" error. So: parse per line when the block
// really is multi-line (that form allows spaces inside a value, e.g. a
// MemberName), and fall back to token-splitting when it isn't.
// ---- HTTP Digest auth (RFC 2617 / RFC 7616) ----
// Matrix RETS servers commonly answer Basic with a 401 + a Digest challenge.
// Without this the login simply cannot succeed, and there is no alternative
// digest to substitute: MD5 is what the scheme specifies.

function parseDigestChallenge(header) {
  if (!header || !/^\s*digest\s/i.test(header)) return null;
  const out = {};
  // Values may be quoted (realm="x") or bare (qop=auth, stale=true)
  const re = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let m;
  while ((m = re.exec(header)) !== null) {
    out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  }
  return out.nonce ? out : null;
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the Authorization value for a Digest challenge.
 * `uri` must be the request's path AND query exactly as sent — a digest over
 * the path alone fails on any Search.ashx call, which is all of them.
 */
async function digestAuthHeader(challenge, opts) {
  const { username, password, method, uri } = opts;
  const realm = challenge.realm || '';
  const nonce = challenge.nonce;
  const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
  // A server may offer several qop values; 'auth' is the only one that
  // applies here ('auth-int' would need the entity body hashed too)
  const qop = (challenge.qop || '').split(',').map(s => s.trim()).includes('auth') ? 'auth' : null;
  const cnonce = randomHex(8);
  const nc = String(opts.nc || 1).padStart(8, '0');

  let ha1 = md5Hex(`${username}:${realm}:${password}`);
  if (algorithm === 'MD5-SESS') ha1 = md5Hex(`${ha1}:${nonce}:${cnonce}`);
  const ha2 = md5Hex(`${method}:${uri}`);
  const response = qop
    ? md5Hex(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5Hex(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return 'Digest ' + parts.join(', ');
}

// Path + query of a URL, which is what the digest is computed over.
function digestUri(url) {
  const u = new URL(url);
  return u.pathname + u.search;
}

function retsCapabilities(xml) {
  const caps = {};
  const block = /<RETS-RESPONSE>([\s\S]*?)<\/RETS-RESPONSE>/i.exec(xml);
  const body = block ? block[1] : xml;
  const lines = body.split(/\r?\n/).filter(l => l.indexOf('=') !== -1);

  if (lines.length > 1) {
    for (const line of lines) {
      const m = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) caps[m[1]] = m[2];
    }
    return caps;
  }

  // Single-line form: one KEY=VALUE per whitespace-delimited token. The
  // lookahead is what stops an EMPTY value (NTREIS sends "MemberName=" and
  // "Broker=") from consuming the pair that follows it — without it,
  // MemberName swallows User and Broker swallows MetadataVersion.
  // A value containing spaces is unrepresentable in this form anyway, and
  // none of the capability URLs have any.
  const re = /([A-Za-z][A-Za-z0-9_-]*)[ \t]*=[ \t]*(?![A-Za-z][A-Za-z0-9_-]*[ \t]*=)(\S*)/g;
  let m;
  while ((m = re.exec(body)) !== null) caps[m[1]] = m[2];
  return caps;
}

// The REAL reply code. Matrix routinely returns an envelope of
// <RETS ReplyCode="0"> and then contradicts it with a trailing
// <RETS-STATUS ReplyCode="20201"/> ("no records") or 20208 ("truncated").
// The spec is explicit that when both are present the TRAILER wins — reading
// only the envelope reports an empty or capped result set as a clean success.
function retsReplyCode(xml) {
  const trailer = /<RETS-STATUS\b[^>]*\bReplyCode\s*=\s*"(\d+)"/i.exec(xml || '');
  if (trailer) return parseInt(trailer[1], 10);
  const envelope = /ReplyCode\s*=\s*"(\d+)"/i.exec(xml || '');
  return envelope ? parseInt(envelope[1], 10) : null;
}

function retsReplyText(xml) {
  const trailer = /<RETS-STATUS\b[^>]*\bReplyText\s*=\s*"([^"]*)"/i.exec(xml || '');
  if (trailer) return trailer[1];
  return (/ReplyText\s*=\s*"([^"]*)"/i.exec(xml || '') || [, ''])[1];
}

// Worker fetch does NOT persist cookies between calls, so the RETS session
// cookie is captured at login and replayed by hand on every later request.
function retsCookie(res) {
  let raw = '';
  try {
    if (typeof res.headers.getSetCookie === 'function') raw = res.headers.getSetCookie().join('; ');
  } catch (e) { /* older runtime */ }
  if (!raw) raw = res.headers.get('set-cookie') || '';
  return raw.split(/,(?=[^;]+=)/)
    .map(c => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

// Combine two Cookie header strings, later values winning on name collision.
// Order matters here: the load balancer re-issues AWSALB on most responses
// and the fresher one is the one that keeps requests on the same backend.
function mergeCookies(older, newer) {
  const jar = new Map();
  for (const src of [older, newer]) {
    for (const pair of String(src || '').split(';')) {
      const t = pair.trim();
      if (!t) continue;
      const eq = t.indexOf('=');
      if (eq > 0) jar.set(t.slice(0, eq), t.slice(eq + 1));
    }
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

let retsSessionCache = null; // { caps, cookie, sessionId, digest, base, expiresAt }

// Single-flight guard. RETS servers commonly permit ONE session per login,
// and a second Login silently invalidates the first (ReplyCode 20022,
// "Additional login not permitted"). The market scan fires three searches
// concurrently — without this they would race three logins and knock each
// other out, producing an intermittent failure that looks like a bad password.
let retsLoginInFlight = null;

async function retsLogin(env) {
  if (retsSessionCache && retsSessionCache.expiresAt > Date.now()) return retsSessionCache;
  if (retsLoginInFlight) return await retsLoginInFlight;
  retsLoginInFlight = retsLoginOnce(env);
  try { return await retsLoginInFlight; }
  finally { retsLoginInFlight = null; }
}

/**
 * Headers for one RETS request. Every RETS call needs the same four things,
 * and two of them (the Authorization scheme and the UA digest's session-id
 * slot) depend on session state — which is exactly why building them by hand
 * at three call sites is how they drift apart.
 */
async function retsHeaders(env, method, url, session) {
  const version = (env.MLS_RETS_VERSION || 'RETS/1.7.2').trim();
  const ua = (env.MLS_RETS_UA || 'AntigravityUnderwriter/1.0').trim();
  const digest = session && session.digest;

  let authorization;
  if (digest) {
    // Each request needs a fresh nonce-count against the same server nonce
    digest.nc = (digest.nc || 0) + 1;
    authorization = await digestAuthHeader(digest, {
      username: env.MLS_RETS_USERNAME,
      password: env.MLS_RETS_PASSWORD,
      method,
      uri: digestUri(url),
      nc: digest.nc
    });
  } else {
    authorization = 'Basic ' + btoa(`${env.MLS_RETS_USERNAME}:${env.MLS_RETS_PASSWORD}`);
  }

  const headers = {
    'RETS-Version': version,
    'User-Agent': ua,
    'Accept': '*/*',
    'Authorization': authorization
  };
  if (session && session.cookie) headers['Cookie'] = session.cookie;

  // RETS-UA-Authorization, only when the MLS issued a User-Agent password.
  // RETS 1.7.2 section 3.10:
  //   a1       = MD5( product : UserAgent-Password )
  //   response = MD5( a1 : RETS-Request-ID : session-id : version-info )
  // We send no RETS-Request-ID header, so that slot is empty — hence the
  // doubled colon. session-id is empty until the server sets the cookie,
  // which is why this is recomputed per request rather than once at login.
  if (env.MLS_RETS_UA_PASSWORD) {
    const a1 = md5Hex(`${ua}:${env.MLS_RETS_UA_PASSWORD}`);
    const sid = (session && session.sessionId) || '';
    headers['RETS-UA-Authorization'] = 'Digest ' + md5Hex(`${a1}::${sid}:${version}`);
  }
  return headers;
}

async function retsLoginOnce(env) {
  const loginUrl = env.MLS_RETS_LOGIN_URL.trim();
  // redirect:'manual' — Workers replays Authorization and Cookie headers
  // across a redirect, including to a different host. An MLS login credential
  // must never be handed to whatever a 302 happens to point at.
  const opts = { redirect: 'manual', signal: mlsSignal() };

  let digest = null;
  let cookie = '';
  let res = await fetch(loginUrl, { headers: await retsHeaders(env, 'GET', loginUrl, null), ...opts });

  // Matrix rejects Basic and answers with a Digest challenge (verified live
  // against ntrdd.mlsmatrix.com: realm="MATRIX", algorithm=MD5, qop="auth").
  // Negotiate it rather than reporting a dead end.
  if (res.status === 401) {
    const challenge = parseDigestChallenge(res.headers.get('www-authenticate'));
    if (!challenge) {
      throw new Error('RETS login 401 and the server offered no Digest challenge — '
        + 'the username/password is being rejected outright.');
    }
    digest = challenge;
    // NTREIS sits behind an AWS load balancer that plants stickiness cookies
    // (AWSALB/AWSALBCORS) on the CHALLENGE. Dropping them lets the
    // authenticated retry land on a different backend from the one that
    // issued the nonce.
    cookie = retsCookie(res);
    res = await fetch(loginUrl, {
      headers: await retsHeaders(env, 'GET', loginUrl, { digest, cookie }), ...opts
    });
    if (res.status === 401) {
      throw new Error('RETS login 401 after a Digest handshake — username/password rejected, '
        + 'or the MLS requires a registered User-Agent (MLS_RETS_UA) and UA password.');
    }
  }

  const xml = await res.text();
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`RETS login redirected (HTTP ${res.status}) — set MLS_RETS_LOGIN_URL to the final URL; `
      + 'credentials are deliberately not replayed across a redirect.');
  }
  if (!res.ok) throw new Error(`RETS login HTTP ${res.status}: ${xml.slice(0, 200)}`);
  const code = retsReplyCode(xml);
  if (code === 20022) {
    throw new Error('RETS login ReplyCode 20022 (additional login not permitted) — another session is '
      + 'already open on this account. Wait for it to time out, or call /mls/probe?logout=1 to close it.');
  }
  if (code === 20041 || code === 20037) {
    throw new Error(`RETS login ReplyCode ${code} — this server requires RETS-UA-Authorization. `
      + 'Set MLS_RETS_UA to the User-Agent string the MLS registered for you, and MLS_RETS_UA_PASSWORD '
      + 'to the User-Agent password they issued.');
  }
  if (code !== null && code !== 0) {
    throw new Error(`RETS login ReplyCode ${code}: ${(/ReplyText\s*=\s*"([^"]*)"/i.exec(xml) || [, ''])[1]}`);
  }
  const caps = retsCapabilities(xml);
  // Merge the login response's cookies over any carried from the challenge:
  // the RETS session id arrives here, the load-balancer stickiness arrived
  // there, and later requests need both.
  cookie = mergeCookies(cookie, retsCookie(res));
  const sessionId = (/RETS-Session-ID\s*=\s*([^;\s]+)/i.exec(cookie) || [, ''])[1] || '';
  retsSessionCache = {
    caps, cookie, sessionId, digest,
    base: new URL(loginUrl).origin,
    // RETS sessions time out server-side; re-login well inside any sane window
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  return retsSessionCache;
}

function retsAbsolute(session, capUrl) {
  if (!capUrl) return null;
  return /^https?:\/\//i.test(capUrl) ? capUrl : session.base + (capUrl.startsWith('/') ? '' : '/') + capUrl;
}

// GetMetadata: how a classic RETS server tells you what it actually has.
// Essential rather than optional here — a RETS server does NOT use RESO Data
// Dictionary names, so without this the default field map is guesswork.
// COMPACT metadata is the same DELIMITER/COLUMNS/DATA table as a search
// result, so parseCompactDecoded reads it unchanged.
async function retsGetMetadata(env, type, id) {
  const session = await retsLogin(env);
  const url = retsAbsolute(session, session.caps.GetMetadata);
  if (!url) throw new Error('RETS login returned no GetMetadata capability URL');
  const q = new URLSearchParams({ Type: type, ID: id, Format: 'COMPACT' });
  const full = `${url}?${q}`;
  const res = await fetch(full, {
    headers: await retsHeaders(env, 'GET', full, session),
    redirect: 'manual', signal: mlsSignal()
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`GetMetadata HTTP ${res.status}: ${xml.slice(0, 200)}`);
  const code = retsReplyCode(xml);
  if (code !== null && code !== 0) {
    throw new Error(`GetMetadata ReplyCode ${code}: ${(/ReplyText\s*=\s*"([^"]*)"/i.exec(xml) || [, ''])[1]}`);
  }
  return parseCompactDecoded(xml);
}

// Candidate names per logical field, best first. Covers RESO Data Dictionary
// 2.0, the older RETS standard names, and the common Matrix system-name
// spellings — because the same concept is called ClosePrice, SellingPrice or
// L_SoldPrice depending on which of the three you are talking to.
const MLS_FIELD_CANDIDATES = {
  mlsNumber: ['ListingId', 'ListingID', 'MLSNumber', 'MLS_Number', 'L_DisplayId'],
  address: ['UnparsedAddress', 'FullStreetAddress', 'StreetAddress', 'PropertyAddress', 'Address'],
  city: ['City', 'PostalCity', 'L_City'],
  state: ['StateOrProvince', 'State', 'StateProvince'],
  postal: ['PostalCode', 'ZipCode', 'Zip', 'L_Zip'],
  county: ['CountyOrParish', 'County', 'CountyName'],
  lat: ['Latitude', 'GeoLatitude', 'L_Latitude'],
  lon: ['Longitude', 'GeoLongitude', 'L_Longitude'],
  sqft: ['LivingArea', 'SqFtTotal', 'LivingAreaSquareFeet', 'TotalSqFt', 'SquareFootage'],
  beds: ['BedroomsTotal', 'Beds', 'BedroomsCount', 'TotalBedrooms'],
  bathsDecimal: ['BathroomsTotalDecimal', 'BathsTotal', 'TotalBaths', 'BathsFullCalc'],
  bathsFull: ['BathroomsFull', 'BathsFull', 'FullBaths'],
  bathsHalf: ['BathroomsHalf', 'BathsHalf', 'HalfBaths'],
  lotSqft: ['LotSizeSquareFeet', 'LotSqFt', 'LotSizeArea'],
  lotAcres: ['LotSizeAcres', 'Acres', 'LotSizeAcreage'],
  year: ['YearBuilt', 'YearBuiltActual', 'L_YearBuilt'],
  garage: ['GarageSpaces', 'GarageCapacity', 'ParkingGarageSpaces'],
  stories: ['StoriesTotal', 'Stories', 'NumberOfStories'],
  levels: ['Levels', 'StoriesType'],
  pool: ['PoolPrivateYN', 'PoolYN', 'Pool', 'HasPool'],
  subdivision: ['SubdivisionName', 'Subdivision', 'LegalSubdivision'],
  propType: ['PropertyType', 'PropertyClass'],
  propSubType: ['PropertySubType', 'PropertySubtype', 'SubType'],
  listPrice: ['ListPrice', 'CurrentPrice', 'L_AskingPrice'],
  originalListPrice: ['OriginalListPrice', 'OriginalPrice'],
  closePrice: ['ClosePrice', 'SellingPrice', 'SoldPrice', 'SalePrice', 'L_SoldPrice'],
  closeDate: ['CloseDate', 'SellingDate', 'SoldDate', 'SaleDate', 'ClosedDate'],
  listDate: ['OnMarketDate', 'ListingDate', 'ListDate'],
  contractDate: ['ListingContractDate', 'ContractDate'],
  dom: ['DaysOnMarket', 'DOM', 'MarketTime'],
  cdom: ['CumulativeDaysOnMarket', 'CDOM'],
  status: ['StandardStatus', 'Status', 'ListingStatus'],
  mlsStatus: ['MlsStatus', 'MLSStatus'],
  concessions: ['ConcessionsAmount', 'SellerConcessionsAmount', 'ConcessionAmount'],
  concessionsYN: ['Concessions', 'SellerConcessionsYN'],
  concessionsComments: ['ConcessionsComments', 'ConcessionComments'],
  remarks: ['PublicRemarks', 'Remarks', 'MarketingRemarks', 'PropertyDescription'],
  condition: ['PropertyCondition', 'Condition'],
  taxAnnual: ['TaxAnnualAmount', 'Taxes', 'TaxAmount', 'AnnualTaxes'],
  taxAssessed: ['TaxAssessedValue', 'AssessedValue'],
  parcel: ['ParcelNumber', 'APN', 'TaxParcelID', 'ParcelID'],
  hoaFee: ['AssociationFee', 'HOAFee', 'AssocFee'],
  hoaFreq: ['AssociationFeeFrequency', 'HOAFrequency', 'AssocFeeFreq'],
  hoaYN: ['AssociationYN', 'HOAYN', 'HasHOA'],
  roof: ['Roof', 'RoofType', 'Roofing'],
  foundation: ['FoundationDetails', 'Foundation', 'FoundationType'],
  heating: ['Heating', 'HeatingType', 'HeatingCooling'],
  cooling: ['Cooling', 'CoolingType', 'AirConditioning'],
  exterior: ['ConstructionMaterials', 'ExteriorFinish', 'Construction'],
  zoning: ['Zoning', 'ZoningCode'],
  modified: ['ModificationTimestamp', 'LastChangeTimestamp', 'ModifiedDate']
};

/**
 * Read a RETS METADATA-TABLE and propose the MLS_FIELD_MAP that would make
 * this app work against it. Matching is exact (case-insensitive) against the
 * server's own StandardName first, then SystemName — a fuzzy match here would
 * silently bind the wrong column to a price, so anything unmatched is
 * reported as unmatched and left for a human.
 */
function suggestFieldMapFromMetadata(rows) {
  const byStandard = new Map();
  const bySystem = new Map();
  for (const r of rows) {
    const sys = r.SystemName || r.systemname;
    const std = r.StandardName || r.standardname;
    if (sys) bySystem.set(String(sys).toLowerCase(), sys);
    if (std) byStandard.set(String(std).toLowerCase(), sys || std);
  }
  const map = {};
  const unmatched = [];
  for (const [key, candidates] of Object.entries(MLS_FIELD_CANDIDATES)) {
    let hit = null;
    for (const c of candidates) {
      const k = c.toLowerCase();
      if (byStandard.has(k)) { hit = byStandard.get(k); break; }
      if (bySystem.has(k)) { hit = bySystem.get(k); break; }
    }
    if (hit) map[key] = hit; else unmatched.push(key);
  }
  return { map, unmatched };
}

// Escape hatch for a stuck one-session-per-login server (see ReplyCode 20022).
// Not called on the normal path: sessions are cached and reused, and logging
// out after every search would throw away the cache for no benefit.
async function retsLogout(env) {
  const session = retsSessionCache;
  if (!session) return 'no cached session';
  const url = retsAbsolute(session, session.caps.Logout);
  retsSessionCache = null;
  if (!url) return 'server published no Logout capability; local session dropped';
  const res = await fetch(url, {
    headers: await retsHeaders(env, 'GET', url, session),
    redirect: 'manual',
    signal: mlsSignal()
  });
  return `logout HTTP ${res.status}`;
}

// COMPACT-DECODED is a tab-delimited table wrapped in XML. Workers have no
// DOMParser, so the three tags that matter are pulled with regex — which is
// safe here precisely because the payload is NOT nested markup.
function parseCompactDecoded(xml) {
  const delimHex = (/<DELIMITER[^>]*value\s*=\s*"?(\w+)"?/i.exec(xml) || [, '09'])[1];
  const delim = String.fromCharCode(parseInt(delimHex, 16));
  const colsRaw = (/<COLUMNS>([\s\S]*?)<\/COLUMNS>/i.exec(xml) || [, ''])[1];
  const columns = colsRaw.split(delim).map(s => s.trim());
  const rows = [];
  const re = /<DATA>([\s\S]*?)<\/DATA>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const cells = m[1].split(delim);
    const row = {};
    columns.forEach((name, i) => {
      if (!name) return;
      const v = (cells[i] || '').trim();
      if (v !== '') row[name] = v;
    });
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

/**
 * The Select= column list, or null to ask for every field.
 * Derived from the configured field map so it can never drift out of sync
 * with what the normalizers actually read. An explicit MLS_RETS_SELECT wins.
 */
function retsSelectList(env) {
  const explicit = (env.MLS_RETS_SELECT || '').trim();
  if (explicit) return explicit;
  let override;
  try { override = JSON.parse(env.MLS_FIELD_MAP || '{}'); }
  catch (e) { return null; }
  const names = [...new Set(Object.values(override).filter(v => typeof v === 'string' && v))];
  // Below a handful of mapped fields the map is clearly partial and the
  // defaults still carry most columns — asking for only those would starve
  // the normalizers of everything the map doesn't mention.
  return names.length >= 10 ? names.join(',') : null;
}

// DMQL2 has no geography. Date and status are expressible; the spatial cut is
// done here from the returned Latitude/Longitude columns (see mlsSearch).
function retsDmql(env, opts, f) {
  const parts = [];
  // DMQL2 overloads its punctuation viciously. Between parenthesized criteria
  // a comma means AND; INSIDE a value list it means OR. So the status set is
  // one criterion with a pipe-prefixed value list — (Status=|A,S) is "A or S",
  // whereas (Status=|A),(Status=|S) is "A and S", i.e. always empty.
  if (opts.statuses && opts.statuses.length) {
    parts.push(`(${f.status}=|${opts.statuses.join(',')})`);
  }
  if (opts.sinceDays > 0) {
    const field = opts.dateField || f.closeDate;
    // The trailing + is DMQL2's "or later". It reaches the server as %2B —
    // URLSearchParams encodes it — and a raw + would decode to a space and
    // become a syntax error.
    // One extra day of slack because the RETS server keeps GMT while the data
    // is Central: without it the most recent closings fall outside the window.
    const since = Date.now() - (opts.sinceDays + 1) * 86400000;
    parts.push(`(${field}=${odataDay(since)}+)`);
  }
  if (env.MLS_RETS_QUERY_EXTRA) parts.push(env.MLS_RETS_QUERY_EXTRA.trim());
  // A DMQL2 query cannot be empty; a wide-open date range is the safe filler
  return parts.length ? parts.join(',') : `(${f.modified}=1980-01-01+)`;
}

async function retsSearch(env, opts, f) {
  const session = await retsLogin(env);
  const searchUrl = retsAbsolute(session, session.caps.Search);
  if (!searchUrl) throw new Error('RETS login returned no Search capability URL');
  const q = new URLSearchParams({
    SearchType: (env.MLS_RETS_RESOURCE || 'Property').trim(),
    // NTREIS/Matrix names the residential class 'Listing', not 'RES' — their
    // own published example is CLASS=Listing&searchtype=Property. /mls/probe
    // lists the real classes; check it before trusting this default.
    Class: (env.MLS_RETS_CLASS || 'Listing').trim(),
    QueryType: 'DMQL2',
    // Without an explicit Format the spec says the server returns
    // STANDARD-XML, which this parser does not read
    Format: 'COMPACT-DECODED',
    // 0 = the server's own SystemNames, which is what /mls/probe reads out of
    // METADATA-TABLE and what its suggested MLS_FIELD_MAP binds to. Flipping
    // this to 1 without also rewriting the field map returns columns under
    // their StandardNames and every mapped field reads null.
    StandardNames: (env.MLS_RETS_STANDARD_NAMES || '0').trim(),
    // CoreLogic asks clients not to make Matrix count matches in production;
    // the row cap is detected from <MAXROWS/> instead, which costs nothing.
    Count: '0',
    Limit: String(Math.min(500, Math.max(50, (opts.limit || 20) * 10))),
    Query: retsDmql(env, opts, f)
  });
  // Pin the schema. NTREIS warns that omitting Select returns every field, so
  // a future field addition on their side can change the payload underneath
  // you. Once MLS_FIELD_MAP exists we know exactly which columns are read, so
  // Select is built from it — before that, ask for everything, because the
  // probe needs the full list to suggest the map in the first place.
  const selected = retsSelectList(env);
  if (selected) q.set('Select', selected);
  const full = `${searchUrl}?${q}`;
  const res = await fetch(full, {
    headers: await retsHeaders(env, 'GET', full, session),
    redirect: 'manual', signal: mlsSignal()
  });
  // A mid-session 401 is usually just an aged nonce (Matrix's nonce is a
  // base64 timestamp). RFC 7616: stale=true means re-compute with the new
  // nonce and DO NOT re-prompt. Taking that path matters on a
  // one-session-per-login server, where a needless re-login can collide with
  // the session we already hold.
  if (res.status === 401 && !opts._retried) {
    const challenge = parseDigestChallenge(res.headers.get('www-authenticate'));
    if (challenge && String(challenge.stale).toLowerCase() === 'true' && session.digest) {
      session.digest = { ...challenge, nc: 0 };
      return await retsSearch(env, { ...opts, _retried: true }, f);
    }
    retsSessionCache = null; // genuinely unauthenticated: start over
    return await retsSearch(env, { ...opts, _retried: true }, f);
  }
  const xml = await res.text();
  if (!res.ok) throw new Error(`RETS search HTTP ${res.status}: ${xml.slice(0, 200)}`);
  const code = retsReplyCode(xml);
  // 20201 "no records found" is an answer, not a failure. 20208 means the
  // result set was CAPPED — the rows that did come back are good, so parse
  // them and let the MAXROWS flag below record the truncation.
  if (code === 20201) return Object.assign([], { truncated: false });
  if (code !== null && code !== 0 && code !== 20208) {
    throw new Error(`RETS search ReplyCode ${code}: ${retsReplyText(xml)}`);
  }
  const rows = parseCompactDecoded(xml);
  // <MAXROWS/> means the server capped the result set. The comp search asks
  // for far more rows than it needs, so this is informational rather than a
  // problem — but silently returning a truncated market scan would be a lie.
  rows.truncated = /<MAXROWS\s*\/?>/i.test(xml) || code === 20208;
  return rows;
}

// ---- Normalizers ----

// RESO's Levels lookup, verbatim, plus the obvious informal spellings. The
// engine only cares whether the comp is single-storey (stairs vs no stairs),
// so anything multi-level maps to a number > 1 and the exact value barely
// matters — but an unknown value must map to null, never a default of 1.
const MLS_LEVEL_WORDS = {
  'one': 1, 'single': 1, 'one story': 1, 'one level': 1,
  'one and one half': 1.5, 'one and a half': 1.5, 'one and one-half': 1.5,
  'two': 2, 'two story': 2, 'bi-level': 2, 'bi level': 2,
  'tri-level': 3, 'tri level': 3, 'three': 3, 'three or more': 3,
  'quad-level': 4, 'quad level': 4, 'four': 4
};

function mlsFlat(v) {
  // RESO multi-value fields arrive as arrays; RETS sends comma-joined text
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || null;
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
}

function mlsBool(v) {
  if (v === true || v === false) return v;
  const s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  if (s === 'true' || s === 'y' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'n' || s === 'no' || s === '0') return false;
  return null;
}

// Levels FIRST, StoriesTotal second: StoriesTotal describes the whole
// BUILDING, so for a condo or townhome unit it reports the tower's floor
// count instead of the unit's — which would fire the story premium against
// the wrong thing. Levels describes the dwelling being sold.
function mlsStories(row, f) {
  const levels = mlsFlat(row[f.levels]);
  if (levels) {
    const key = levels.toLowerCase().split(/[,;]/)[0].trim();
    if (MLS_LEVEL_WORDS[key]) return MLS_LEVEL_WORDS[key];
  }
  return numOrNull(row[f.stories]);
}

// The adjustment grid wants a DECIMAL bath count (2.5). RESO publishes three
// candidates and only two of them mean that:
//   BathroomsTotalDecimal — exactly what we want
//   BathroomsFull/Half    — compute it
//   BathroomsTotalInteger — a SIMPLE SUM: 2 full + 1 half = 3, NOT 2.5.
// Reading the integer first would systematically over-count half baths across
// every comp in the grid, so it is the last resort and only when nothing
// better exists at all.
function mlsBaths(row, f) {
  const dec = numOrNull(row[f.bathsDecimal]);
  if (dec) return dec;
  const full = numOrNull(row[f.bathsFull]);
  const half = numOrNull(row[f.bathsHalf]);
  if (full !== null || half !== null) return (full || 0) + 0.5 * (half || 0) || null;
  return numOrNull(row[f.bathsTotal]);
}

function mlsLotSqft(row, f) {
  const sq = numOrNull(row[f.lotSqft]);
  if (sq) return sq;
  const acres = numOrNull(row[f.lotAcres]);
  return acres ? Math.round(acres * 43560) : null;
}

// The record's hoaFee is MONTHLY (the client adds it straight to a monthly
// carry), but RESO publishes the fee at whatever cadence the HOA bills.
const MLS_FEE_PER_YEAR = {
  monthly: 12, 'semi-monthly': 24, 'bi-monthly': 6, quarterly: 4,
  'semi-annually': 2, 'semi-annual': 2, annually: 1, annual: 1, yearly: 1,
  weekly: 52, 'bi-weekly': 26, 'one time': 0, 'not applicable': 0
};

function mlsMonthlyHoa(row, f) {
  const fee = numOrNull(row[f.hoaFee]);
  if (!fee) return null;
  const freq = (mlsFlat(row[f.hoaFreq]) || '').toLowerCase();
  const perYear = MLS_FEE_PER_YEAR[freq];
  if (perYear === 0) return null;            // one-time capital fee is not carry
  if (!perYear) return Math.round(fee / 12); // unlabeled: RESO's own default is annual
  return Math.round(fee * perYear / 12);
}

// ConcessionsAmount rides the back-office payload and is only ~40% populated
// even where it is licensed, so a null means "not reported", NEVER "$0". The
// Concessions picklist (Yes / No / Call Listing Agent) is the separate signal
// for whether concessions existed at all — a 'Yes' with no amount is exactly
// the case an underwriter has to go chase, and it must not read as a clean sale.
function mlsConcessionsReported(row, f) {
  const flag = (mlsFlat(row[f.concessionsYN]) || '').toLowerCase();
  if (flag.startsWith('y')) return 'yes';
  if (flag.startsWith('n')) return 'no';
  if (flag.startsWith('call')) return 'ask';
  return null;
}

// DaysOnMarket is "as defined by the MLS business rules" and is often absent.
// CloseDate − OnMarketDate is arithmetic, so it fills the gap without
// pretending to be the MLS's own number.
function mlsDom(row, f) {
  const published = numOrNull(row[f.dom]);
  if (published) return published;
  const on = Date.parse(mlsFlat(row[f.listDate]) || mlsFlat(row[f.contractDate]) || '');
  const close = Date.parse(mlsFlat(row[f.closeDate]) || '');
  if (!Number.isFinite(on) || !Number.isFinite(close) || close < on) return null;
  return Math.round((close - on) / 86400000) || null;
}

function mlsPool(row, f) {
  const yn = mlsBool(row[f.pool]);
  if (yn !== null) return yn;
  const features = mlsFlat(row[f.poolFeatures]);
  if (!features) return null;
  return !/^none$/i.test(features);
}

function mlsFormattedAddress(row, f) {
  const line = mlsFlat(row[f.address]);
  const city = mlsFlat(row[f.city]);
  const state = mlsFlat(row[f.state]);
  const zip = mlsFlat(row[f.postal]);
  if (!line) return null;
  // UnparsedAddress sometimes already carries city/state; don't double it
  if (city && new RegExp(`,\\s*${city.replace(/[.*+?^${}()|[\]\\]/g, '\\// ---- Hail history (NWS local storm reports via IEM) ----')}`, 'i').test(line)) return line;
  return [line, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// One MLS row → the record shape every provider in this worker emits.
function mlsToRecord(row, env) {
  const f = mlsFields(env);
  const closePrice = numOrNull(row[f.closePrice]);
  const closeDate = mlsFlat(row[f.closeDate]);
  return {
    sqft: numOrNull(row[f.sqft]) || numOrNull(row[f.sqftAlt]),
    beds: numOrNull(row[f.beds]),
    baths: mlsBaths(row, f),
    lot: mlsLotSqft(row, f),
    year: numOrNull(row[f.year]),
    garage: numOrNull(row[f.garage]),
    pool: mlsPool(row, f),
    stories: mlsStories(row, f),
    subdivision: mlsFlat(row[f.subdivision]),
    hoa: mlsBool(row[f.hoaYN]) === true ? true : (numOrNull(row[f.hoaFee]) ? true : null),
    propType: mlsFlat(row[f.propSubType]) || mlsFlat(row[f.propType]),
    county: mlsFlat(row[f.county]),
    zoning: mlsFlat(row[f.zoning]),
    apn: mlsFlat(row[f.parcel]),
    legal: null,
    garageType: null,
    foundation: mlsFlat(row[f.foundation]),
    roof: mlsFlat(row[f.roof]),
    exterior: mlsFlat(row[f.exterior]),
    heating: mlsFlat(row[f.heating]),
    cooling: mlsFlat(row[f.cooling]),
    // An MLS carries the tax figures the listing agent entered, not the
    // appraisal district's roll — it fills a gap, it doesn't beat TAD
    assessedValue: numOrNull(row[f.taxAssessed]),
    assessedLand: null,
    assessedImprov: null,
    annualTaxes: numOrNull(row[f.taxAnnual]),
    // THE payload: a real closed price, not a list-price proxy
    lastSaleDate: closeDate,
    lastSalePrice: closePrice,
    listPrice: numOrNull(row[f.listPrice]),
    listingStatus: mlsPrettyStatus(row[f.status]) || mlsFlat(row[f.mlsStatus]),
    hoaFee: mlsMonthlyHoa(row, f),
    ownerNames: null,
    ownerType: null,
    ownerOccupied: null,
    ownerMailing: null,
    lat: mlsCoord(row[f.lat]),
    lon: mlsCoord(row[f.lon]),
    formattedAddress: mlsFormattedAddress(row, f),
    source: mlsSystemName(env),
    extra: {
      mlsNumber: mlsFlat(row[f.mlsNumber]),
      status: mlsPrettyStatus(row[f.status]),
      closeDate,
      closePrice,
      listPrice: numOrNull(row[f.listPrice]),
      originalListPrice: numOrNull(row[f.originalListPrice]),
      concessions: numOrNull(row[f.concessions]),
      concessionsReported: mlsConcessionsReported(row, f),
      concessionsComments: mlsFlat(row[f.concessionsComments]),
      dom: mlsDom(row, f),
      cdom: numOrNull(row[f.cdom]),
      propertyCondition: mlsFlat(row[f.condition]),
      priceTruth: closePrice ? 'closed' : 'list',
      lat: mlsCoord(row[f.lat]),
      lon: mlsCoord(row[f.lon])
    }
  };
}

// One MLS row → the /comps candidate shape, plus the fields only a real feed
// can supply: a verified close price, concessions, DOM and listing status.
function mlsToCandidate(row, env) {
  const f = mlsFields(env);
  const closePrice = numOrNull(row[f.closePrice]);
  const listPrice = numOrNull(row[f.listPrice]);
  return {
    address: mlsFlat(row[f.address]) || [mlsFlat(row[f.streetNumber]), mlsFlat(row[f.streetName])].filter(Boolean).join(' ') || null,
    city: mlsFlat(row[f.city]),
    state: mlsFlat(row[f.state]),
    zip: mlsFlat(row[f.postal]),
    lat: mlsCoord(row[f.lat]),
    lon: mlsCoord(row[f.lon]),
    price: closePrice || listPrice,
    // 'closed' means the number is what changed hands. The client drops the
    // "verify against MLS" hedge only for these.
    priceType: closePrice ? 'closed' : 'list',
    soldDate: mlsFlat(row[f.closeDate]),
    sqft: numOrNull(row[f.sqft]) || numOrNull(row[f.sqftAlt]),
    beds: numOrNull(row[f.beds]),
    baths: mlsBaths(row, f),
    lotSqft: mlsLotSqft(row, f),
    yearBuilt: numOrNull(row[f.year]),
    garage: numOrNull(row[f.garage]),
    stories: mlsStories(row, f),
    propType: mlsFlat(row[f.propSubType]) || mlsFlat(row[f.propType]),
    remarks: mlsFlat(row[f.remarks]),
    distanceMi: row._distanceMi != null ? row._distanceMi : null,
    correlation: null,
    source: mlsSystemName(env),
    // ---- MLS-only additions ----
    mlsNumber: mlsFlat(row[f.mlsNumber]),
    listPrice,
    originalListPrice: numOrNull(row[f.originalListPrice]),
    concessions: numOrNull(row[f.concessions]),
    concessionsReported: mlsConcessionsReported(row, f),
    concessionsComments: mlsFlat(row[f.concessionsComments]),
    dom: mlsDom(row, f),
    cdom: numOrNull(row[f.cdom]),
    listingStatus: mlsPrettyStatus(row[f.status]) || mlsFlat(row[f.mlsStatus]),
    propertyCondition: mlsFlat(row[f.condition])
  };
}

const MLS_RESIDENTIAL = () => ['Residential'];

function mlsPropertyTypes(env) {
  const raw = (env.MLS_PROPERTY_TYPES || '').trim();
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : MLS_RESIDENTIAL();
}

function mlsSubTypes(env) {
  const raw = (env.MLS_SUBTYPES || '').trim();
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function mlsLeaseTypes(env) {
  const raw = (env.MLS_LEASE_TYPES || '').trim();
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : ['Residential Lease'];
}

/**
 * Subject-property record from the feed. Address-first (an exact listing beats
 * a nearby one), falling back to the nearest listing within ~250 ft when the
 * address string doesn't match the MLS's own formatting.
 * Returns null on a miss so the caller falls through the ladder.
 */
async function mlsRecord(env, address, lat, lon) {
  const f = mlsFields(env);
  const anyStatus = [].concat(mlsStatuses(env, 'closed'), mlsStatuses(env, 'active'), mlsStatuses(env, 'pending'));

  if (address) {
    const houseNum = (/\b(\d+)\b/.exec(address) || [, ''])[1];
    const street = address.replace(/^\s*\d+\s+/, '').split(',')[0].trim();
    if (houseNum && street) {
      // contains() rather than eq: UnparsedAddress formatting (unit numbers,
      // directional prefixes, "Rd" vs "Road") rarely matches a typed string
      const filter = `contains(${f.address},${odataStr(street.split(/\s+/)[0])}) and startswith(${f.address},${odataStr(houseNum)})`;
      try {
        const rows = await mlsSearch(env, {
          statuses: anyStatus, propertyTypes: mlsPropertyTypes(env),
          extraFilter: mlsTransport(env) === 'rets' ? null : filter,
          limit: 25, orderby: 'closeDateDesc'
        });
        const hit = rows.find(r => streetMatch(address, mlsFlat(r[f.address])));
        if (hit) return mlsToRecord(hit, env);
      } catch (e) {
        // contains/startswith are optional OData functions; a feed that
        // rejects them still answers the coordinate query below
        if (!/HTTP 400/.test(e.message)) throw e;
      }
    }
  }

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const rows = await mlsSearch(env, {
      statuses: anyStatus, propertyTypes: mlsPropertyTypes(env),
      lat, lon, radiusMi: 0.05, limit: 10, orderby: 'closeDateDesc'
    });
    // Same wrong-house guard the TAD rung uses: a geocode landing on the
    // neighbour's roof must not fill this property's data
    const hit = address
      ? rows.find(r => streetMatch(address, mlsFlat(r[f.address])))
      : rows[0];
    if (hit) return mlsToRecord(hit, env);
  }
  return null;
}

/** Closed sales near a point → /comps candidates, freshest first. */
async function mlsComps(env, lat, lon, radiusMi, months, limit, zip) {
  const rows = await mlsSearch(env, {
    statuses: mlsStatuses(env, 'closed'),
    propertyTypes: mlsPropertyTypes(env),
    subTypes: mlsSubTypes(env),
    lat, lon, radiusMi, zip,
    sinceDays: Math.round(months * 30.44),
    limit, orderby: 'closeDateDesc'
  });
  return rows.map(r => mlsToCandidate(r, env)).filter(c => c.address);
}

/**
 * Live market scan straight from the source: closed / active / pending.
 * Three queries instead of realtor.com's two, because an MLS separates
 * "Active Under Contract" from "Pending" and both are off the market.
 */
async function mlsMarket(env, lat, lon, radiusMi, zip) {
  const f = mlsFields(env);
  const types = mlsPropertyTypes(env);
  const subTypes = mlsSubTypes(env);
  const mapRow = (r) => ({
    address: mlsFlat(r[f.address]),
    price: numOrNull(r[f.closePrice]) || numOrNull(r[f.listPrice]),
    listPrice: numOrNull(r[f.listPrice]),
    soldDate: mlsFlat(r[f.closeDate]),
    listDate: mlsFlat(r[f.listDate]) || mlsFlat(r[f.contractDate]),
    sqft: numOrNull(r[f.sqft]) || numOrNull(r[f.sqftAlt]),
    beds: numOrNull(r[f.beds]),
    // DOM is the field the scraped path could never supply — it is what
    // turns "months of inventory" into a holding-period estimate
    dom: mlsDom(r, f),
    concessions: numOrNull(r[f.concessions])
  });
  // Each status group is its own query and its own failure. The pending
  // bucket is the fragile one — its enum literal spelling differs per server
  // — and losing it must cost the pending count, not the whole scan.
  const errors = [];
  const group = (name, extra) => mlsSearch(env, {
    statuses: mlsStatuses(env, name), propertyTypes: types, subTypes,
    lat, lon, radiusMi, zip, limit: 200, ...extra
  }).catch(e => { errors.push(name + ': ' + e.message); return []; });

  const [closed, active, pending] = await Promise.all([
    group('closed', { sinceDays: 366, orderby: 'closeDateDesc' }),
    group('active'),
    group('pending')
  ]);
  // Every group failing is a real outage, not a quiet empty market — say so
  // and let the caller fall back to the keyless scan.
  if (errors.length === 3) throw new Error(errors.join(' · '));
  return {
    solds: closed.map(mapRow),
    actives: active.map(mapRow),
    pendings: pending.map(mapRow),
    errors
  };
}

/**
 * Closed residential LEASES near the point — transacted rents, which is what
 * a rent estimate actually wants. Active rentals ride along as a thinner
 * signal so a quiet lease market still produces something.
 */
async function mlsLeases(env, lat, lon, radiusMi, zip) {
  const f = mlsFields(env);
  const leaseTypes = mlsLeaseTypes(env);
  const mapRow = (r, status) => ({
    address: mlsFlat(r[f.address]),
    rent: numOrNull(r[f.closePrice]) || numOrNull(r[f.listPrice]),
    sqft: numOrNull(r[f.sqft]) || numOrNull(r[f.sqftAlt]),
    beds: numOrNull(r[f.beds]),
    baths: mlsBaths(r, f),
    status,
    closeDate: mlsFlat(r[f.closeDate]),
    distanceMi: r._distanceMi
  });
  // Closed leases are the prize; a failure on the active side must not cost
  // them (and vice versa). Errors are collected rather than swallowed — a
  // silently empty lease market and a broken credential look identical to
  // the user otherwise.
  const errors = [];
  const [closed, active] = await Promise.all([
    mlsSearch(env, { statuses: mlsStatuses(env, 'closed'), propertyTypes: leaseTypes, lat, lon, radiusMi, zip, sinceDays: 366, limit: 40, orderby: 'closeDateDesc' })
      .catch(e => { errors.push('closed leases: ' + e.message); return []; }),
    mlsSearch(env, { statuses: mlsStatuses(env, 'active'), propertyTypes: leaseTypes, lat, lon, radiusMi, zip, limit: 25 })
      .catch(e => { errors.push('active rentals: ' + e.message); return []; })
  ]);
  const rows = [].concat(
    closed.map(r => mapRow(r, 'closed')),
    active.map(r => mapRow(r, 'active'))
  ).filter(x => x.rent > 0);
  rows.errors = errors;
  return rows;
}

// ---- /mls/probe: the one-round-trip field-mapping diagnostic ----
// Reports which transport authenticated, how far the handshake got, and what
// the server actually publishes — so a field-name override can be written
// from evidence instead of guesswork. Field NAMES only unless ?sample=1,
// because listing content is licensed data and this is a debug route.
async function handleMlsProbe(params, env, cors) {
  const transport = mlsTransport(env);
  const out = {
    configured: mlsConfigured(env),
    transport,
    systemName: mlsSystemName(env),
    env: {
      MLS_API_BASE: Boolean(env.MLS_API_BASE),
      MLS_TOKEN_URL: Boolean(env.MLS_TOKEN_URL),
      MLS_CLIENT_ID: Boolean(env.MLS_CLIENT_ID),
      MLS_CLIENT_SECRET: Boolean(env.MLS_CLIENT_SECRET),
      MLS_STATIC_TOKEN: Boolean(env.MLS_STATIC_TOKEN),
      MLS_RETS_LOGIN_URL: Boolean(env.MLS_RETS_LOGIN_URL),
      MLS_RETS_USERNAME: Boolean(env.MLS_RETS_USERNAME),
      MLS_RETS_UA_PASSWORD: Boolean(env.MLS_RETS_UA_PASSWORD),
      MLS_ORIGINATING_SYSTEM: env.MLS_ORIGINATING_SYSTEM || null,
      MLS_PROPERTY_TYPES: mlsPropertyTypes(env),
      MLS_LEASE_TYPES: mlsLeaseTypes(env),
      MLS_FIELD_MAP_OVERRIDES: Object.keys((() => {
        try { return JSON.parse(env.MLS_FIELD_MAP || '{}'); } catch (e) { return { INVALID_JSON: 1 }; }
      })())
    },
    auth: { ok: false, error: null },
    fieldsSeen: null,
    missingExpectedFields: null,
    sample: null,
    steps: []
  };
  if (!out.configured) {
    out.auth.error = 'no MLS secrets configured — set MLS_API_BASE + MLS_CLIENT_ID/MLS_CLIENT_SECRET (RESO) '
      + 'or MLS_RETS_LOGIN_URL + MLS_RETS_USERNAME/MLS_RETS_PASSWORD (classic RETS)';
    return json(out, 200, cors);
  }

  if (transport === 'rets' && params.get('logout') === '1') {
    try { out.steps.push('logout: ' + await retsLogout(env)); }
    catch (e) { out.steps.push('logout failed: ' + e.message); }
    return json(out, 200, cors);
  }

  try {
    if (transport === 'reso') {
      await mlsBearer(env);
      out.steps.push('token acquired');
      out.auth.ok = true;
    } else {
      const s = await retsLogin(env);
      out.steps.push('login ok; capabilities: ' + Object.keys(s.caps).join(', '));
      out.auth.ok = true;
    }
  } catch (e) {
    out.auth.error = e.message;
    return json(out, 200, cors);
  }

  // ---- Classic RETS: metadata discovery ----
  // A RETS server does not speak RESO Data Dictionary, so enumerate what it
  // really has and propose the MLS_FIELD_MAP that binds this app to it. This
  // runs BEFORE the sample search, because on RETS that search cannot work
  // until the class and field names are right.
  if (transport === 'rets') {
    try {
      const resources = await retsGetMetadata(env, 'METADATA-RESOURCE', '0');
      out.resources = resources.map(r => ({
        id: r.ResourceID, standardName: r.StandardName, keyField: r.KeyField,
        className: r.ClassCount ? undefined : undefined
      })).filter(r => r.id);
      out.steps.push('resources: ' + out.resources.map(r => r.id).join(', '));
    } catch (e) {
      out.steps.push('METADATA-RESOURCE failed: ' + e.message);
    }

    const resource = (env.MLS_RETS_RESOURCE || 'Property').trim();
    try {
      const classes = await retsGetMetadata(env, 'METADATA-CLASS', resource);
      out.classes = classes.map(c => ({
        className: c.ClassName, standardName: c.StandardName,
        description: c.Description || c.VisibleName
      })).filter(c => c.className);
      out.steps.push(`classes on ${resource}: ` + out.classes.map(c => c.className).join(', '));
    } catch (e) {
      out.steps.push('METADATA-CLASS failed: ' + e.message);
    }

    // Field list for one class. Defaults to the configured search class; pass
    // ?class=XXX to inspect another (the residential-lease one, say).
    const cls = (params.get('class') || env.MLS_RETS_CLASS || 'RES').trim();
    try {
      const table = await retsGetMetadata(env, 'METADATA-TABLE', `${resource}:${cls}`);
      out.steps.push(`table ${resource}:${cls} → ${table.length} fields`);
      const suggestion = suggestFieldMapFromMetadata(table);
      out.suggestedFieldMap = suggestion.map;
      out.unmatchedFields = suggestion.unmatched;
      out.fieldsSeen = table
        .map(r => r.SystemName + (r.StandardName ? ` (${r.StandardName})` : ''))
        .filter(Boolean).sort();
      if (params.get('sample') === '1') out.tableSample = table.slice(0, 5);

      // The status LOOKUP VALUES, which are the single most common way a
      // RETS query silently returns nothing. Format=COMPACT-DECODED changes
      // only the RESPONSE — a query must still use the coded value, so on a
      // Matrix server "Closed" matches nothing and "S" is what works. These
      // go straight into MLS_STATUS_CLOSED / _ACTIVE / _PENDING.
      const statusField = suggestion.map.status || mlsFields(env).status;
      const statusRow = table.find(r => r.SystemName === statusField);
      const lookupName = statusRow && (statusRow.LookupName || statusRow.LookUpName);
      if (lookupName) {
        try {
          const lookup = await retsGetMetadata(env, 'METADATA-LOOKUP_TYPE', `${resource}:${lookupName}`);
          out.statusValues = lookup
            .map(r => ({ value: r.Value, label: r.LongValue || r.ShortValue }))
            .filter(r => r.value);
          out.steps.push(`status lookup ${lookupName}: `
            + out.statusValues.map(v => `${v.value}=${v.label}`).join(', '));
        } catch (e) {
          out.steps.push(`METADATA-LOOKUP_TYPE ${lookupName} failed: ` + e.message);
        }
      } else {
        out.steps.push(`no LookupName on the status field (${statusField}) — `
          + 'set MLS_STATUS_* from the metadata browser by hand');
      }
    } catch (e) {
      out.steps.push(`METADATA-TABLE ${resource}:${cls} failed: ` + e.message);
    }
    return json(out, 200, cors);
  }

  // One row, no filters beyond the licensed system, to enumerate real fields
  try {
    const lat = parseFloat(params.get('latitude'));
    const lon = parseFloat(params.get('longitude'));
    const rows = await mlsSearch(env, {
      statuses: mlsStatuses(env, 'closed'),
      propertyTypes: mlsPropertyTypes(env),
      subTypes: mlsSubTypes(env),
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      radiusMi: Number.isFinite(lat) ? 2 : undefined,
      zip: params.get('zip') || undefined,
      sinceDays: 366, limit: 1, orderby: 'closeDateDesc'
    });
    out.steps.push(`search returned ${rows.length} row(s)`);
    if (rows.length) {
      const row = rows[0];
      out.fieldsSeen = Object.keys(row).filter(k => k !== '_distanceMi').sort();
      const f = mlsFields(env);
      const wanted = ['address', 'lat', 'lon', 'sqft', 'beds', 'bathsTotal', 'year', 'closePrice',
        'closeDate', 'listPrice', 'status', 'remarks', 'dom', 'concessions', 'condition',
        'subdivision', 'lotSqft', 'garage', 'pool', 'propSubType'];
      out.missingExpectedFields = wanted
        .filter(k => row[f[k]] === undefined)
        .map(k => `${k} → ${f[k]}`);
      out.normalized = { record: mlsToRecord(row, env), candidate: mlsToCandidate(row, env) };
      if (params.get('sample') === '1') out.sample = row;
    }
  } catch (e) {
    out.steps.push('search failed: ' + e.message);
  }
  return json(out, 200, cors);
}

// ---- Hail history (NWS local storm reports via IEM) ----
// lsr.py only speaks CSV now (geojson removed upstream); the 5-year WFO-FWD
// pull is ~1 MB, so it's parsed once and cached per isolate-day and clients
// get a tiny distance-filtered summary.
let lsrCache = null; // { fetchedAt, rows: [{lat, lon, mag, date}] }

function csvFields(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function handleHail(params, env, cors) {
  const lat = parseFloat(params.get('latitude'));
  const lon = parseFloat(params.get('longitude'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'latitude/longitude required' }, 400, cors);
  }
  const radiusMi = Math.min(10, parseFloat(params.get('radius')) || 3);
  if (!lsrCache || Date.now() - lsrCache.fetchedAt > 86400000) {
    const now = new Date();
    const start = new Date(now.getTime() - 5 * 365.25 * 86400000);
    const iso = (d) => d.toISOString().slice(0, 16) + 'Z';
    const q = new URLSearchParams({ wfo: 'FWD', fmt: 'csv', sts: iso(start), ets: iso(now) });
    const res = await fetch('https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py?' + q);
    if (!res.ok) return json({ error: `IEM upstream HTTP ${res.status}` }, 502, cors);
    // Header: VALID,VALID2,LAT,LON,MAG,WFO,TYPECODE,TYPETEXT,CITY,...
    // VALID/VALID2 are UTC; DFW hail peaks in the evening, so ~38% of
    // reports land past midnight UTC — dates must be read in Central time
    // or the chip cites storm dates that match no claim or news report.
    const centralDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const lines = (await res.text()).split('\n');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const f = csvFields(lines[i]);
      if (f.length < 8 || f[6] !== 'H') continue;
      const la = parseFloat(f[2]);
      const lo = parseFloat(f[3]);
      const mag = parseFloat(f[4]);
      const v = f[0] || ''; // YYYYMMDDHHMM (UTC)
      if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(mag) || v.length < 12) continue;
      const utc = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12)));
      rows.push({ lat: la, lon: lo, mag, date: centralDay.format(utc) });
    }
    // A 5-year WFO-FWD pull is never legitimately empty (thousands of hail
    // rows) — zero parsed rows is an upstream anomaly and must not be
    // cached, or every scan for a day gets a confident false "no hail".
    if (!rows.length) return json({ error: 'IEM returned no parseable rows' }, 502, cors);
    lsrCache = { fetchedAt: Date.now(), rows };
  }
  const events = lsrCache.rows
    .map(r => ({ ...r, miles: milesBetween(lat, lon, r.lat, r.lon) }))
    .filter(r => r.miles <= radiusMi)
    .sort((a, b) => b.mag - a.mag);
  const severe = events.filter(e => e.mag >= 1);
  return json({
    radiusMi,
    years: 5,
    count: events.length,
    countSevere: severe.length,
    maxMag: events.length ? events[0].mag : null,
    latest: events.length ? events.reduce((m, e) => (e.date > m ? e.date : m), '') : null,
    events: events.slice(0, 5).map(e => ({ date: e.date, mag: e.mag, miles: Math.round(e.miles * 10) / 10 }))
  }, 200, cors);
}

// Comp candidates near a point. MLS closed sales first — those are the only
// prices that are facts. When the feed can't fill the set, realtor.com sold
// listings (keyless) merge with RentCast AVM comparables (correlation-ranked)
// as list-price PROXIES, and the response says which kind the caller got.
// Dedupe favors the first-seen entry and grafts RentCast's correlation on.
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

  // ---- MLS rung: actual closed sales ----
  let mlsCount = 0;
  if (mlsConfigured(env)) {
    try {
      const found = await mlsComps(env, lat, lon, radius, months, limit, params.get('zip') || '');
      mlsCount = found.length;
      candidates.push(...found);
    } catch (e) { providerErrors.push(mlsSystemName(env) + ': ' + e.message); }
  }

  // A verified close price and a list-at-sale proxy are different KINDS of
  // number. Once the feed has produced a workable set, the proxies are left
  // out entirely rather than ranked alongside — mixing them would launder
  // guesses into the same list as facts. Below the threshold every source
  // runs and each candidate carries its own priceType.
  const MLS_ENOUGH = 3;
  const useProxies = mlsCount < MLS_ENOUGH;

  if (useProxies) try {
    const minDate = new Date(Date.now() - months * 30.44 * 86400000).toISOString().slice(0, 10);
    const res = await fetch('https://www.realtor.com/frontdoor/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'rdc-client-name': 'RDC_WEB_DETAILS_PAGE',
        'rdc-client-version': '3.x.x',
        'User-Agent': BROWSER_UA,
        // Fuller browser-shaped headers: realtor.com serves description.text
        // to residential clients but strips it for bare datacenter requests
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.realtor.com',
        'Referer': 'https://www.realtor.com/'
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
        // Listing remarks survive closing (verified live 2026-08-13) even
        // though photos don't — the client reads condition language from them
        remarks: d.text || null,
        distanceMi: (coord.lat != null && coord.lon != null)
          ? Math.round(milesBetween(lat, lon, coord.lat, coord.lon) * 100) / 100 : null,
        correlation: null,
        source: 'realtor.com'
      });
    }
  } catch (e) { providerErrors.push('realtor.com: ' + e.message); }

  if (useProxies && env.RENTCAST_API_KEY) {
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
          remarks: null,
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
      if (!existing.remarks && c.remarks) existing.remarks = c.remarks;
      if (existing.price == null && c.price != null) { existing.price = c.price; existing.priceType = c.priceType; }
      if (existing.source.indexOf(c.source) === -1) existing.source += ' + ' + c.source;
    }
  }
  const list = [...byKey.values()];
  const priced = list.filter(c => c.price != null);
  return json({
    subject: { latitude: lat, longitude: lon },
    candidates: list,
    // The client's "verify against MLS" hedge is honest for a proxy and
    // condescending for a closed sale — it keys off this.
    priceTruth: !priced.length ? 'none'
      : priced.every(c => c.priceType === 'closed') ? 'closed'
      : priced.some(c => c.priceType === 'closed') ? 'mixed' : 'proxy',
    mls: {
      configured: mlsConfigured(env),
      name: mlsSystemName(env),
      used: mlsCount,
      attribution: env.MLS_ATTRIBUTION || null
    },
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
              mls: mlsConfigured(env),
              realtor: true,
              rentcast: Boolean(env.RENTCAST_API_KEY),
              melissa: Boolean(env.MELISSA_API_KEY),
              vision: Boolean(env.AI)
            },
            mls: mlsConfigured(env) ? {
              name: mlsSystemName(env),
              transport: mlsTransport(env),
              attribution: env.MLS_ATTRIBUTION || null
            } : null
          }, 200, cors);
        case '/mls/probe':
          return await handleMlsProbe(url.searchParams, env, cors);
        case '/lookup':
          return await handleLookup(url.searchParams, env, cors);
        case '/comps':
          return await handleComps(url.searchParams, env, cors);
        case '/market':
          return await handleMarket(url.searchParams, env, cors);
        case '/rent':
          return await handleRent(url.searchParams, env, cors);
        case '/hail':
          return await handleHail(url.searchParams, env, cors);
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

// ---- Named exports: MLS unit-test surface (worker/tests.mjs) ----
// Cloudflare only consumes the default export above; these are inert at the
// edge. They exist because the MLS rung cannot be exercised against a live
// feed without licensed credentials, so the pure parts — field mapping,
// unit conversion, COMPACT-DECODED parsing, the geo box — are verified
// against synthetic RESO and RETS payloads instead.
export {
  MLS_DEFAULT_FIELDS, MLS_STATUS,
  mlsFields, mlsTransport, mlsConfigured, mlsSystemName, mlsStatuses, mlsPrettyStatus,
  mlsConcessionsReported, mlsDom,
  mlsBbox, mlsCoord, mlsFlat, mlsBool, mlsBaths, mlsStories, mlsLotSqft,
  mlsMonthlyHoa, mlsPool, mlsFormattedAddress,
  mlsToRecord, mlsToCandidate,
  parseCompactDecoded, retsCapabilities, retsReplyCode, retsDmql, retsAbsolute, retsSelectList,
  parseDigestChallenge, digestAuthHeader, digestUri, md5Hex, mergeCookies, retsCookie, retsReplyText,
  suggestFieldMapFromMetadata, MLS_FIELD_CANDIDATES,
  odataStr, odataDay, mlsOrFilter,
  mergeRecords, milesBetween, streetMatch
};

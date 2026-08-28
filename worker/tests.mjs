/**
 * Unit tests for the Worker's MLS rung.
 * Run:  node worker/tests.mjs        (exit code 0 = all pass)
 *
 * The MLS feed cannot be exercised without licensed credentials, so this
 * covers everything that does NOT need the network: field mapping, unit
 * conversion (acres→sqft, HOA cadence→monthly, Levels→stories), the
 * bounding-box geography, RETS COMPACT-DECODED parsing, and the exact shape
 * contract the rest of the worker depends on. Live-feed behaviour is checked
 * with /mls/probe once credentials exist.
 */
import * as W from './worker.js';

const results = [];
function test(name, fn) {
    try { fn(); results.push({ name, pass: true }); }
    catch (e) { results.push({ name, pass: false, error: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(actual, expected, label) {
    if (actual !== expected) throw new Error(`${label || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) {
        throw new Error(`${label || 'value'}: expected ${expected} (±${tol}), got ${actual}`);
    }
}

// A RESO Property row shaped the way a Data Dictionary 2.0 feed serves one.
const RESO_CLOSED = {
    ListingKey: 'NTREIS-20780001',
    ListingId: '20780001',
    UnparsedAddress: '3529 Rogers Ave, Fort Worth, TX 76109',
    City: 'Fort Worth', StateOrProvince: 'TX', PostalCode: '76109', CountyOrParish: 'Tarrant',
    Latitude: 32.7211, Longitude: -97.3792,
    LivingArea: 1842, BedroomsTotal: 3,
    BathroomsTotalInteger: 2, BathroomsFull: 2, BathroomsHalf: 0,
    LotSizeAcres: 0.191, YearBuilt: 1948, GarageSpaces: 2,
    Levels: ['One'], PoolPrivateYN: false,
    SubdivisionName: 'Bluebonnet Hills',
    PropertyType: 'Residential', PropertySubType: 'Single Family Residence',
    ListPrice: 585000, OriginalListPrice: 599000,
    ClosePrice: 572500, CloseDate: '2026-06-18',
    OnMarketDate: '2026-04-30', DaysOnMarket: 22, CumulativeDaysOnMarket: 22,
    StandardStatus: 'Closed', MlsStatus: 'Closed',
    ConcessionsAmount: 8500, ConcessionsComments: 'Seller paid buyer closing costs',
    PublicRemarks: 'Completely remodeled in 2024 — down to the studs.',
    PropertyCondition: 'Updated/Remodeled',
    TaxAnnualAmount: 11240, TaxAssessedValue: 498000, ParcelNumber: '00123456',
    AssociationFee: 300, AssociationFeeFrequency: 'Annually', AssociationYN: true,
    Roof: ['Composition'], FoundationDetails: ['Slab'],
    Heating: ['Central', 'Natural Gas'], Cooling: ['Central Air'],
    ConstructionMaterials: ['Brick'],
    OriginatingSystemName: 'NTREIS',
    ModificationTimestamp: '2026-06-19T14:02:11Z'
};

const ENV = { MLS_API_BASE: 'https://x/odata', MLS_CLIENT_ID: 'a', MLS_CLIENT_SECRET: 'b', MLS_SYSTEM_NAME: 'NTREIS' };

// ---- Configuration gating ----

test('mls: unconfigured worker reports no transport and stays inert', () => {
    eq(W.mlsTransport({}), null, 'transport');
    eq(W.mlsConfigured({}), false, 'configured');
    eq(W.mlsSystemName({}), 'MLS', 'default label');
});

test('mls: transport is inferred from whichever credential set exists', () => {
    eq(W.mlsTransport({ MLS_API_BASE: 'x' }), 'reso');
    eq(W.mlsTransport({ MLS_RETS_LOGIN_URL: 'x' }), 'rets');
    eq(W.mlsTransport({ MLS_RETS_LOGIN_URL: 'x', MLS_TRANSPORT: 'reso' }), 'reso', 'explicit wins');
});

test('mls: half a credential set is NOT configured — never a partial auth attempt', () => {
    eq(W.mlsConfigured({ MLS_API_BASE: 'x' }), false, 'base without client');
    eq(W.mlsConfigured({ MLS_API_BASE: 'x', MLS_CLIENT_ID: 'a' }), false, 'no secret');
    eq(W.mlsConfigured(ENV), true, 'complete RESO set');
    eq(W.mlsConfigured({ MLS_API_BASE: 'x', MLS_STATIC_TOKEN: 't' }), true, 'static token is enough');
    eq(W.mlsConfigured({ MLS_RETS_LOGIN_URL: 'x', MLS_RETS_USERNAME: 'u' }), false, 'RETS without password');
});

test('mls: a malformed MLS_FIELD_MAP degrades to defaults, never throws', () => {
    const f = W.mlsFields({ MLS_FIELD_MAP: '{not json' });
    eq(f.closePrice, 'ClosePrice', 'defaults survive a bad override');
});

test('mls: MLS_FIELD_MAP overrides one field and leaves the rest alone', () => {
    const f = W.mlsFields({ MLS_FIELD_MAP: '{"sqft":"SqFtTotal","remarks":"PublicRemarksLong"}' });
    eq(f.sqft, 'SqFtTotal');
    eq(f.remarks, 'PublicRemarksLong');
    eq(f.beds, 'BedroomsTotal', 'untouched default');
});

// ---- Record normalization ----

test('mls record: maps a closed RESO row onto the shared record shape', () => {
    const r = W.mlsToRecord(RESO_CLOSED, ENV);
    eq(r.sqft, 1842); eq(r.beds, 3); eq(r.baths, 2);
    eq(r.year, 1948); eq(r.garage, 2); eq(r.stories, 1); eq(r.pool, false);
    eq(r.subdivision, 'Bluebonnet Hills');
    eq(r.county, 'Tarrant'); eq(r.apn, '00123456');
    eq(r.propType, 'Single Family Residence');
    eq(r.source, 'NTREIS');
});

test('mls record: THE payload — the close price lands as the last sale, not the list price', () => {
    const r = W.mlsToRecord(RESO_CLOSED, ENV);
    eq(r.lastSalePrice, 572500, 'ClosePrice, not ListPrice');
    eq(r.lastSaleDate, '2026-06-18');
    eq(r.listPrice, 585000, 'list price kept separately');
    eq(r.extra.priceTruth, 'closed');
    eq(r.extra.concessions, 8500);
    eq(r.extra.dom, 22);
});

test('mls record: lot acres convert to square feet (the record shape is sqft)', () => {
    eq(W.mlsToRecord(RESO_CLOSED, ENV).lot, Math.round(0.191 * 43560));
});

test('mls record: an explicit LotSizeSquareFeet beats the acres conversion', () => {
    const r = W.mlsToRecord({ ...RESO_CLOSED, LotSizeSquareFeet: 8400 }, ENV);
    eq(r.lot, 8400);
});

test('mls record: HOA fee is normalized to MONTHLY, because the client adds it to monthly carry', () => {
    eq(W.mlsToRecord(RESO_CLOSED, ENV).hoaFee, 25, '$300/yr → $25/mo');
    eq(W.mlsToRecord({ ...RESO_CLOSED, AssociationFee: 60, AssociationFeeFrequency: 'Monthly' }, ENV).hoaFee, 60);
    eq(W.mlsToRecord({ ...RESO_CLOSED, AssociationFee: 450, AssociationFeeFrequency: 'Quarterly' }, ENV).hoaFee, 150);
    eq(W.mlsToRecord({ ...RESO_CLOSED, AssociationFee: 1200, AssociationFeeFrequency: 'Semi-Annually' }, ENV).hoaFee, 200);
});

test('mls record: a ONE TIME association fee is not monthly carry', () => {
    eq(W.mlsToRecord({ ...RESO_CLOSED, AssociationFee: 2500, AssociationFeeFrequency: 'One Time' }, ENV).hoaFee, null);
});

test('mls record: an unlabeled association fee is read as annual (the RESO default)', () => {
    eq(W.mlsToRecord({ ...RESO_CLOSED, AssociationFee: 600, AssociationFeeFrequency: undefined }, ENV).hoaFee, 50);
});

test('mls record: multi-value RESO arrays flatten to the text the form expects', () => {
    const r = W.mlsToRecord(RESO_CLOSED, ENV);
    eq(r.heating, 'Central, Natural Gas');
    eq(r.roof, 'Composition');
    eq(r.foundation, 'Slab');
    eq(r.exterior, 'Brick');
});

test('mls record: baths fall back to full + half when no total is published', () => {
    const row = { ...RESO_CLOSED };
    delete row.BathroomsTotalInteger;
    row.BathroomsFull = 2; row.BathroomsHalf = 1;
    eq(W.mlsToRecord(row, ENV).baths, 2.5);
});

test('mls record: missing facts are null, never zero — no phantom adjustments downstream', () => {
    const r = W.mlsToRecord({ UnparsedAddress: '1 Main St', StandardStatus: 'Closed' }, ENV);
    eq(r.sqft, null); eq(r.beds, null); eq(r.baths, null); eq(r.lot, null);
    eq(r.year, null); eq(r.garage, null); eq(r.stories, null); eq(r.pool, null);
    eq(r.lastSalePrice, null); eq(r.annualTaxes, null); eq(r.hoaFee, null);
    eq(r.lat, null); eq(r.lon, null);
});

test('mls record: emits every key the shared record shape declares', () => {
    const KEYS = ['sqft', 'beds', 'baths', 'lot', 'year', 'garage', 'pool', 'stories', 'subdivision',
        'hoa', 'propType', 'county', 'zoning', 'apn', 'legal', 'garageType', 'foundation', 'roof',
        'exterior', 'heating', 'cooling', 'assessedValue', 'assessedLand', 'assessedImprov',
        'annualTaxes', 'lastSaleDate', 'lastSalePrice', 'listPrice', 'listingStatus', 'hoaFee',
        'ownerNames', 'ownerType', 'ownerOccupied', 'ownerMailing', 'lat', 'lon',
        'formattedAddress', 'source'];
    const r = W.mlsToRecord(RESO_CLOSED, ENV);
    const missing = KEYS.filter(k => !(k in r));
    assert(missing.length === 0, 'missing record keys: ' + missing.join(', '));
});

test('mls record: a western longitude survives (numOrNull would have eaten it)', () => {
    const r = W.mlsToRecord(RESO_CLOSED, ENV);
    near(r.lon, -97.3792, 1e-9, 'longitude');
    near(r.lat, 32.7211, 1e-9, 'latitude');
    eq(W.mlsCoord(0), null, '0/0 is the unknown sentinel, not a location');
});

test('mls record: an UnparsedAddress that already carries the city is not doubled', () => {
    eq(W.mlsToRecord(RESO_CLOSED, ENV).formattedAddress, '3529 Rogers Ave, Fort Worth, TX 76109');
    const bare = W.mlsToRecord({ ...RESO_CLOSED, UnparsedAddress: '3529 Rogers Ave' }, ENV);
    eq(bare.formattedAddress, '3529 Rogers Ave, Fort Worth, TX 76109', 'city/state appended when absent');
});

test('mls record: Levels text becomes a story count the appraisal grid can use', () => {
    eq(W.mlsToRecord({ ...RESO_CLOSED, Levels: ['Two'] }, ENV).stories, 2);
    eq(W.mlsToRecord({ ...RESO_CLOSED, Levels: 'One and One Half' }, ENV).stories, 1.5);
    eq(W.mlsToRecord({ ...RESO_CLOSED, Levels: ['Tri-Level'] }, ENV).stories, 3);
    eq(W.mlsToRecord({ ...RESO_CLOSED, Levels: ['Three Or More'] }, ENV).stories, 3);
});

test('mls record: Levels BEATS StoriesTotal — StoriesTotal counts the building, not the unit', () => {
    // A 3rd-floor condo in an 8-storey tower: StoriesTotal says 8, and the
    // single-storey premium would fire against the wrong thing
    const condo = { ...RESO_CLOSED, StoriesTotal: 8, Levels: ['One'] };
    eq(W.mlsToRecord(condo, ENV).stories, 1, 'the dwelling has one level');
});

test('mls record: StoriesTotal fills in only when Levels is absent or unmapped', () => {
    const noLevels = { ...RESO_CLOSED, StoriesTotal: 2 };
    delete noLevels.Levels;
    eq(W.mlsToRecord(noLevels, ENV).stories, 2, 'falls back');
    eq(W.mlsToRecord({ ...RESO_CLOSED, StoriesTotal: 2, Levels: ['Multi/Split'] }, ENV).stories, 2,
        'unmapped Levels defers rather than guessing');
    const neither = { ...RESO_CLOSED };
    delete neither.Levels;
    eq(W.mlsToRecord(neither, ENV).stories, null, 'no signal = null, never a default of 1');
});

test('mls record: baths NEVER read BathroomsTotalInteger over the real decimal count', () => {
    // BathroomsTotalInteger is a simple sum: 2 full + 1 half = 3. Reading it
    // as a decimal count would over-state half baths on every comp.
    const row = { ...RESO_CLOSED, BathroomsTotalInteger: 3, BathroomsFull: 2, BathroomsHalf: 1 };
    eq(W.mlsToRecord(row, ENV).baths, 2.5, 'computed from the components');
    eq(W.mlsToRecord({ ...row, BathroomsTotalDecimal: 2.5 }, ENV).baths, 2.5, 'decimal field preferred');
    const onlyInteger = { ...RESO_CLOSED, BathroomsTotalInteger: 2 };
    delete onlyInteger.BathroomsFull; delete onlyInteger.BathroomsHalf;
    eq(W.mlsToRecord(onlyInteger, ENV).baths, 2, 'last resort beats nothing at all');
});

test('mls: concessions REPORTED but unpublished is not the same as no concessions', () => {
    const noAmount = { ...RESO_CLOSED, Concessions: 'Yes' };
    delete noAmount.ConcessionsAmount;
    const c = W.mlsToCandidate(noAmount, ENV);
    eq(c.concessions, null, 'null amount is never silently $0');
    eq(c.concessionsReported, 'yes', 'but the flag says to go chase it');
    eq(W.mlsToCandidate({ ...RESO_CLOSED, Concessions: 'No' }, ENV).concessionsReported, 'no');
    eq(W.mlsToCandidate({ ...RESO_CLOSED, Concessions: 'Call Listing Agent' }, ENV).concessionsReported, 'ask');
    const silent = { ...RESO_CLOSED };
    delete silent.Concessions;
    eq(W.mlsToCandidate(silent, ENV).concessionsReported, null, 'field absent = unknown');
});

test('mls: days on market falls back to CloseDate minus OnMarketDate', () => {
    const noDom = { ...RESO_CLOSED, OnMarketDate: '2026-04-30', CloseDate: '2026-06-18' };
    delete noDom.DaysOnMarket;
    eq(W.mlsToCandidate(noDom, ENV).dom, 49, 'derived from the dates');
    eq(W.mlsToCandidate(RESO_CLOSED, ENV).dom, 22, "the MLS's own number wins when present");
    const undated = { ...RESO_CLOSED };
    delete undated.DaysOnMarket; delete undated.OnMarketDate; delete undated.ListingContractDate;
    eq(W.mlsToCandidate(undated, ENV).dom, null, 'no dates, no number');
});

test('mls: compact enum members are prettified for display, never for filtering', () => {
    eq(W.mlsToCandidate({ ...RESO_CLOSED, StandardStatus: 'ActiveUnderContract' }, ENV).listingStatus,
        'Active Under Contract');
    eq(W.mlsToCandidate({ ...RESO_CLOSED, StandardStatus: 'Active Under Contract' }, ENV).listingStatus,
        'Active Under Contract', 'an already-pretty value is left alone');
    // The FILTER still emits the literals as configured — prettifying a filter
    // would send a value the server's enumeration does not contain
    assert(W.mlsOrFilter('StandardStatus', W.MLS_STATUS.pending).includes("'ActiveUnderContract'"),
        'both spellings are queried');
});

test('mls: status groups are env-overridable for a feed with local spellings', () => {
    eq(W.mlsStatuses({}, 'closed')[0], 'Closed');
    const custom = W.mlsStatuses({ MLS_STATUS_PENDING: 'Pending, Under Contract' }, 'pending');
    eq(custom.length, 2);
    eq(custom[1], 'Under Contract');
});

test('mls record: pool reads the YN flag, then features, then gives up', () => {
    eq(W.mlsToRecord({ ...RESO_CLOSED, PoolPrivateYN: true }, ENV).pool, true);
    const byFeature = { ...RESO_CLOSED };
    delete byFeature.PoolPrivateYN;
    eq(W.mlsToRecord({ ...byFeature, PoolFeatures: ['In Ground', 'Heated'] }, ENV).pool, true);
    eq(W.mlsToRecord({ ...byFeature, PoolFeatures: ['None'] }, ENV).pool, false);
    eq(W.mlsToRecord(byFeature, ENV).pool, null, 'no signal = null');
});

test('mls record: RETS string values parse the same as RESO typed ones', () => {
    // COMPACT-DECODED delivers everything as text; the normalizer must not care
    const asText = {};
    for (const [k, v] of Object.entries(RESO_CLOSED)) {
        asText[k] = Array.isArray(v) ? v.join(',') : String(v);
    }
    const r = W.mlsToRecord(asText, ENV);
    eq(r.sqft, 1842); eq(r.beds, 3); eq(r.baths, 2);
    eq(r.lastSalePrice, 572500);
    eq(r.pool, false, '"false" is a boolean, not a truthy string');
    near(r.lon, -97.3792, 1e-9, 'longitude from text');
});

// ---- Candidate normalization ----

test('mls candidate: a closed sale is labeled closed — that is what drops the UI hedge', () => {
    const c = W.mlsToCandidate(RESO_CLOSED, ENV);
    eq(c.price, 572500);
    eq(c.priceType, 'closed');
    eq(c.soldDate, '2026-06-18');
    eq(c.source, 'NTREIS');
});

test('mls candidate: an unsold listing falls back to list price and says so', () => {
    const row = { ...RESO_CLOSED, StandardStatus: 'Active' };
    delete row.ClosePrice; delete row.CloseDate;
    const c = W.mlsToCandidate(row, ENV);
    eq(c.price, 585000);
    eq(c.priceType, 'list', 'never claims a close price it does not have');
    eq(c.soldDate, null);
});

test('mls candidate: carries the fields only a real feed knows', () => {
    const c = W.mlsToCandidate(RESO_CLOSED, ENV);
    eq(c.mlsNumber, '20780001');
    eq(c.concessions, 8500);
    eq(c.concessionsComments, 'Seller paid buyer closing costs');
    eq(c.dom, 22);
    eq(c.listingStatus, 'Closed');
    eq(c.propertyCondition, 'Updated/Remodeled');
    eq(c.originalListPrice, 599000);
    eq(c.remarks, 'Completely remodeled in 2024 — down to the studs.');
});

test('mls candidate: emits every key the /comps candidate shape declares', () => {
    const KEYS = ['address', 'city', 'state', 'zip', 'lat', 'lon', 'price', 'priceType', 'soldDate',
        'sqft', 'beds', 'baths', 'lotSqft', 'yearBuilt', 'garage', 'stories', 'propType',
        'remarks', 'distanceMi', 'correlation', 'source'];
    const c = W.mlsToCandidate(RESO_CLOSED, ENV);
    const missing = KEYS.filter(k => !(k in c));
    assert(missing.length === 0, 'missing candidate keys: ' + missing.join(', '));
    eq(c.correlation, null, 'correlation is a RentCast concept; MLS leaves it null');
});

test('mls candidate: distance comes from the search annotation, never invented', () => {
    eq(W.mlsToCandidate(RESO_CLOSED, ENV).distanceMi, null, 'unannotated row claims nothing');
    eq(W.mlsToCandidate({ ...RESO_CLOSED, _distanceMi: 0.41 }, ENV).distanceMi, 0.41);
});

// ---- Geography ----

test('mls geo: the bounding box circumscribes the radius, never clips it', () => {
    const b = W.mlsBbox(32.75, -97.33, 1);
    near((b.latMax - b.latMin) / 2 * 69, 1, 0.01, 'north-south half-height = 1 mi');
    // At 32.75°N a degree of longitude is ~58 mi, so the box must be WIDER
    // in degrees than it is tall, or the east-west edge would cut the circle
    assert((b.lonMax - b.lonMin) > (b.latMax - b.latMin), 'box widens with latitude');
    const eastWestMi = (b.lonMax - b.lonMin) / 2 * 69 * Math.cos(32.75 * Math.PI / 180);
    near(eastWestMi, 1, 0.02, 'east-west half-width = 1 mi');
});

test('mls geo: OData string literals escape embedded apostrophes', () => {
    eq(W.odataStr("O'Brien Ln"), "'O''Brien Ln'");
});

test('mls geo: close-date filters use the bare Edm.Date literal OData wants', () => {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(W.odataDay(Date.parse('2026-06-18T00:00:00Z'))), 'no time component');
});

test('mls geo: multi-value status filters become an OR group, not an unsupported IN', () => {
    eq(W.mlsOrFilter('StandardStatus', ['Active Under Contract', 'Pending']),
        "(StandardStatus eq 'Active Under Contract' or StandardStatus eq 'Pending')");
    eq(W.mlsOrFilter('StandardStatus', []), null, 'empty list contributes no clause');
});

// ---- Classic RETS parsing ----

const RETS_LOGIN_XML = `<?xml version="1.0"?>
<RETS ReplyCode="0" ReplyText="Operation Successful">
<RETS-RESPONSE>
Info=USERID;Character;jthorne
Login=/rets/Login
Search=/rets/Search
GetMetadata=/rets/GetMetadata
Logout=/rets/Logout
</RETS-RESPONSE>
</RETS>`;

test('rets: capability URLs are read out of the login response', () => {
    const caps = W.retsCapabilities(RETS_LOGIN_XML);
    eq(caps.Search, '/rets/Search');
    eq(caps.Logout, '/rets/Logout');
    eq(W.retsReplyCode(RETS_LOGIN_XML), 0);
});

// Verbatim from NTREIS's Matrix server, captured live 2026-08-26. Every
// key=value sits on ONE line separated by spaces, not one per line as the
// RETS spec's examples show — a line-based parser reads the whole block as a
// single key, finds no Search URL, and every later request dies with a
// misleading "no Search capability" error.
const NTREIS_LOGIN_XML = '<RETS ReplyCode="0" ReplyText="Operation Success.">\n'
    + '<RETS-RESPONSE> MemberName= User=REDACTED_NID,NULL,NULL,REDACTED_NID Broker= '
    + 'MetadataVersion=1.00.05364 MetadataTimestamp=2026-08-26T14:21:52Z '
    + 'MinMetadataTimestamp=2026-08-26T14:21:52Z '
    + 'Login=https://ntrdd.mlsmatrix.com/rets/Login.ashx '
    + 'Logout=https://ntrdd.mlsmatrix.com/rets/Logout.ashx '
    + 'Search=https://ntrdd.mlsmatrix.com/rets/Search.ashx '
    + 'GetMetadata=https://ntrdd.mlsmatrix.com/rets/GetMetadata.ashx '
    + 'GetObject=https://ntrdd.mlsmatrix.com/rets/GetObject.ashx '
    + 'Update=https://ntrdd.mlsmatrix.com/rets/Update.ashx '
    + 'PostObject=https://ntrdd.mlsmatrix.com/rets/PostObject.ashx </RETS-RESPONSE>\n</RETS>';

test('rets: NTREIS Matrix puts every capability on ONE line — all of them are still read', () => {
    const caps = W.retsCapabilities(NTREIS_LOGIN_XML);
    eq(caps.Search, 'https://ntrdd.mlsmatrix.com/rets/Search.ashx');
    eq(caps.GetMetadata, 'https://ntrdd.mlsmatrix.com/rets/GetMetadata.ashx');
    eq(caps.Logout, 'https://ntrdd.mlsmatrix.com/rets/Logout.ashx');
    eq(caps.GetObject, 'https://ntrdd.mlsmatrix.com/rets/GetObject.ashx');
    eq(W.retsReplyCode(NTREIS_LOGIN_XML), 0);
});

test('rets: an EMPTY capability value does not swallow the pair after it', () => {
    const caps = W.retsCapabilities(NTREIS_LOGIN_XML);
    eq(caps.MemberName, '', 'MemberName= is empty');
    eq(caps.User, 'REDACTED_NID,NULL,NULL,REDACTED_NID', 'and User survives it');
    eq(caps.Broker, '', 'Broker= is empty');
    eq(caps.MetadataVersion, '1.00.05364', 'and MetadataVersion survives it');
});

test('rets: the multi-line form still allows spaces inside a value', () => {
    const caps = W.retsCapabilities('<RETS-RESPONSE>\nMemberName=Jane Q Realtor\nSearch=/rets/Search\n</RETS-RESPONSE>');
    eq(caps.MemberName, 'Jane Q Realtor', 'a spaced value is not truncated');
    eq(caps.Search, '/rets/Search');
});

test('rets: absolute capability URLs are used as-is, relative ones resolve against the login host', () => {
    const session = { base: 'https://ntrdd.mlsmatrix.com', caps: W.retsCapabilities(NTREIS_LOGIN_XML) };
    eq(W.retsAbsolute(session, session.caps.Search), 'https://ntrdd.mlsmatrix.com/rets/Search.ashx');
    eq(W.retsAbsolute(session, '/rets/Search'), 'https://ntrdd.mlsmatrix.com/rets/Search');
    eq(W.retsAbsolute(session, null), null);
});

test('rets: a non-zero ReplyCode is surfaced, not swallowed', () => {
    eq(W.retsReplyCode('<RETS ReplyCode="20036" ReplyText="Miscellaneous error"/>'), 20036);
    eq(W.retsReplyCode('no xml here'), null);
});

test('rets: the TRAILING RETS-STATUS wins over the envelope', () => {
    // Matrix routinely returns a success envelope and then contradicts it in
    // the trailer. Reading only the envelope reports an empty result set as a
    // clean success and a capped one as complete.
    const noRecords = '<RETS ReplyCode="0" ReplyText="Operation Success.">\n'
        + '<DELIMITER value="09"/>\n'
        + '<RETS-STATUS ReplyCode="20201" ReplyText="No Records Found."/>\n</RETS>';
    eq(W.retsReplyCode(noRecords), 20201, 'the trailer is the truth');
    eq(W.retsReplyText(noRecords), 'No Records Found.');

    const truncated = '<RETS ReplyCode="0" ReplyText="Operation Success.">\n'
        + '<MAXROWS/>\n<RETS-STATUS ReplyCode="20208" ReplyText="Maximum records exceeded."/>\n</RETS>';
    eq(W.retsReplyCode(truncated), 20208);
});

test('rets: with no trailer the envelope still answers', () => {
    eq(W.retsReplyCode('<RETS ReplyCode="0" ReplyText="Operation Success.">x</RETS>'), 0);
    eq(W.retsReplyText('<RETS ReplyCode="0" ReplyText="Operation Success.">x</RETS>'), 'Operation Success.');
});

test('rets: the DMQL status set is ONE criterion, not several ANDed together', () => {
    // (Status=|A,S) is "A or S". (Status=|A),(Status=|S) is "A and S", which
    // is always empty — the comma means OR inside a value and AND between
    // criteria, and getting it backwards returns zero rows with no error.
    const q = W.retsDmql({}, { statuses: ['A', 'S'] }, W.mlsFields({}));
    assert(q.includes('=|A,S)'), 'single pipe-prefixed value list: ' + q);
    assert(!/\)\s*,\s*\(StandardStatus/.test(q), 'not ANDed: ' + q);
});

test('rets: coordinates produce a real bounding box, not a postcode', () => {
    // Postal boundaries follow mail routes: a comp 0.1 mi away across the
    // street can be in another ZIP. The box is drawn around the subject.
    const q = W.retsDmql({}, {
        statuses: ['CLS'], sinceDays: 180, lat: 32.71, lon: -97.375, radiusMi: 1, zip: '76109'
    }, W.mlsFields({}));
    assert(/\(Latitude=32\.\d+\+\)/.test(q), 'latitude floor: ' + q);
    assert(/\(Latitude=32\.\d+-\)/.test(q), 'latitude ceiling: ' + q);
    assert(/\(Longitude=-97\.\d+\+\)/.test(q), 'negative longitude floor: ' + q);
    assert(/\(Longitude=-97\.\d+-\)/.test(q), 'negative longitude ceiling: ' + q);
    assert(!q.includes('PostalCode'), 'the postcode is NOT also applied — it would '
        + 'clip the box back to one ZIP and undo the point: ' + q);
});

test('rets: the box brackets the subject and widens with the radius', () => {
    const build = (r) => W.retsDmql({}, { statuses: ['CLS'], lat: 32.71, lon: -97.375, radiusMi: r }, W.mlsFields({}));
    const nums = (q, field) => [...q.matchAll(/\((Latitude|Longitude)=(-?[\d.]+)[+-]\)/g)]
        .filter(m => m[1] === field).map(m => parseFloat(m[2]));
    const [latMin, latMax] = nums(build(1), 'Latitude');
    assert(latMin < 32.71 && latMax > 32.71, `subject inside the box: ${latMin}..${latMax}`);
    const [lonMin, lonMax] = nums(build(1), 'Longitude');
    assert(lonMin < -97.375 && lonMax > -97.375, `subject inside E/W: ${lonMin}..${lonMax}`);
    const [wideMin, wideMax] = nums(build(3), 'Latitude');
    assert(wideMax - wideMin > latMax - latMin, 'a 3 mi box is wider than a 1 mi box');
});

test('rets: no coordinates falls back to the postcode rather than going global', () => {
    const q = W.retsDmql({}, { statuses: ['CLS'], zip: '76109' }, W.mlsFields({}));
    assert(q.includes('(PostalCode=76109)'), 'coarse fallback: ' + q);
    assert(!q.includes('Latitude'), 'no box without coordinates: ' + q);
});

test('rets: the postcode fallback carries NO pipe — it is a character field', () => {
    // (PostalCode=|76109) queries a lookup the field does not have, and
    // matches nothing without raising an error. Confirmed live.
    const q = W.retsDmql({}, { statuses: ['CLS'], zip: '76109' }, W.mlsFields({}));
    assert(!q.includes('PostalCode=|'), 'no lookup pipe on a string field: ' + q);
});

test('rets: the date floor widens by a day for the GMT/Central skew', () => {
    const q = W.retsDmql({}, { statuses: ['S'], sinceDays: 30, dateField: 'L_ClosingDate' }, W.mlsFields({}));
    const day = /\(L_ClosingDate=(\d{4}-\d{2}-\d{2})\+\)/.exec(q);
    assert(day, 'date criterion present: ' + q);
    const daysBack = Math.round((Date.now() - Date.parse(day[1] + 'T00:00:00Z')) / 86400000);
    assert(daysBack >= 30 && daysBack <= 32, 'about 31 days back, got ' + daysBack);
});

test('rets: the DMQL trailing + survives URL encoding as %2B', () => {
    // A raw + decodes to a space in a query string and becomes a syntax error
    const q = W.retsDmql({}, { statuses: ['S'], sinceDays: 30 }, W.mlsFields({}));
    const encoded = new URLSearchParams({ Query: q }).toString();
    assert(encoded.includes('%2B'), 'plus encoded: ' + encoded);
    assert(!/[^%]\+/.test(encoded.replace(/^Query=/, '')), 'no raw plus: ' + encoded);
});

test('rets: Select is built from the field map, and omitted while the map is thin', () => {
    eq(W.retsSelectList({}), null, 'no map = ask for everything (the probe needs it)');
    eq(W.retsSelectList({ MLS_FIELD_MAP: '{"sqft":"LM_Int4_3","beds":"LM_Int1_1"}' }), null,
        'a 2-field map is partial — selecting only those would starve the normalizers');
    const full = {};
    for (let i = 0; i < 12; i++) full['f' + i] = 'COL_' + i;
    const sel = W.retsSelectList({ MLS_FIELD_MAP: JSON.stringify(full) });
    assert(sel && sel.split(',').length === 12, 'full map pins the schema: ' + sel);
    eq(W.retsSelectList({ MLS_RETS_SELECT: 'A,B,C' }), 'A,B,C', 'an explicit list always wins');
});

test('rets: a broken MLS_FIELD_MAP does not produce a broken Select', () => {
    eq(W.retsSelectList({ MLS_FIELD_MAP: '{not json' }), null);
});

test('rets: COMPACT-DECODED parses to rows without a DOM parser', () => {
    const TAB = String.fromCharCode(9);
    const xml = `<RETS ReplyCode="0">
<DELIMITER value="09"/>
<COLUMNS>${TAB}ListingId${TAB}ClosePrice${TAB}LivingArea${TAB}</COLUMNS>
<DATA>${TAB}20780001${TAB}572500${TAB}1842${TAB}</DATA>
<DATA>${TAB}20780002${TAB}499000${TAB}1610${TAB}</DATA>
</RETS>`;
    const rows = W.parseCompactDecoded(xml);
    eq(rows.length, 2);
    eq(rows[0].ListingId, '20780001');
    eq(rows[0].ClosePrice, '572500');
    eq(rows[1].LivingArea, '1610');
});

test('rets: empty cells are omitted so absent data reads as absent, not empty string', () => {
    const TAB = String.fromCharCode(9);
    const xml = `<DELIMITER value="09"/>
<COLUMNS>${TAB}ListingId${TAB}ClosePrice${TAB}</COLUMNS>
<DATA>${TAB}20780003${TAB}${TAB}</DATA>`;
    const rows = W.parseCompactDecoded(xml);
    eq(rows.length, 1);
    eq(rows[0].ListingId, '20780003');
    assert(!('ClosePrice' in rows[0]), 'blank cell must not become ""');
});

test('rets: a non-tab DELIMITER is honored', () => {
    const PIPE = String.fromCharCode(0x7c);
    const xml = `<DELIMITER value="7C"/>
<COLUMNS>${PIPE}ListingId${PIPE}ClosePrice${PIPE}</COLUMNS>
<DATA>${PIPE}A1${PIPE}100${PIPE}</DATA>`;
    const rows = W.parseCompactDecoded(xml);
    eq(rows[0].ListingId, 'A1');
    eq(rows[0].ClosePrice, '100');
});

test('rets: a zero-result search parses to an empty list, not a crash', () => {
    eq(W.parseCompactDecoded('<RETS ReplyCode="20201" ReplyText="No Records Found"/>').length, 0);
});

test('rets: DMQL2 combines status and a close-date floor', () => {
    const q = W.retsDmql({}, { statuses: ['Closed'], sinceDays: 180 }, W.mlsFields({}));
    assert(q.includes('(StandardStatus=|Closed)'), 'status clause: ' + q);
    assert(/\(CloseDate=\d{4}-\d{2}-\d{2}\+\)/.test(q), 'open-ended date range: ' + q);
});

test('rets: DMQL2 is never emitted empty (an empty query is a protocol error)', () => {
    const q = W.retsDmql({}, {}, W.mlsFields({}));
    assert(q.length > 0 && q.includes('='), 'fallback query: ' + q);
});

// ---- MD5 and HTTP Digest auth ----
// Implemented in-worker rather than via crypto.subtle.digest('MD5') — that
// call exists only on Cloudflare, so the digest paths would otherwise be
// untestable anywhere. Verified against the published RFC vectors.

test('md5: every RFC 1321 test vector matches', () => {
    eq(W.md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
    eq(W.md5Hex('a'), '0cc175b9c0f1b6a831c399e269772661');
    eq(W.md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
    eq(W.md5Hex('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
    eq(W.md5Hex('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b');
    eq(W.md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
        'd174ab98d277d9f5a5611c2c9f419d9f');
    eq(W.md5Hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890'),
        '57edf4a22be3c955ac49da2e2107b67a');
});

test('md5: block-boundary lengths pad correctly (55, 56, 64 bytes)', () => {
    // 56 is the length at which the padding spills into a second block —
    // the classic off-by-one in a hand-rolled MD5
    eq(W.md5Hex('a'.repeat(55)), 'ef1772b6dff9a122358552954ad0df65');
    eq(W.md5Hex('a'.repeat(56)), '3b0c8ac703f828b04c6c197006d17218');
    eq(W.md5Hex('a'.repeat(64)), '014842d480b571495a4a0363793f7367');
});

test('md5: multi-byte UTF-8 hashes its bytes, not its code units', () => {
    // Cross-checked against Node's own crypto.createHash('md5'). A password
    // or realm with an accent in it must not silently hash differently here
    // than it does on the server.
    eq(W.md5Hex('é'), '66ddcd97cfdeabb2f6fb8a999b4bc76f');           // 2 bytes
    eq(W.md5Hex('naïve café'), '8feed1b062e175e77b3769d990f9e527');
    eq(W.md5Hex('日本語'), '00110af8b4393ef3f72c50be5b332bec');        // 3 bytes each
});

test('digest: the RFC 2617 worked example reproduces exactly', () => {
    const c = W.parseDigestChallenge(
        'Digest realm="testrealm@host.com", qop="auth,auth-int", '
        + 'nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"');
    eq(c.realm, 'testrealm@host.com');
    eq(c.nonce, 'dcd98b7102dd2f0e8b11d0f600bfb0c093');
    const ha1 = W.md5Hex('Mufasa:testrealm@host.com:Circle Of Life');
    const ha2 = W.md5Hex('GET:/dir/index.html');
    eq(ha1, '939e7578ed9e3c518a452acee763bce9', 'HA1');
    eq(ha2, '39aff3a2bab6126f332b942af96d3366', 'HA2');
    eq(W.md5Hex(ha1 + ':' + c.nonce + ':00000001:0a4f113b:auth:' + ha2),
        '6629fae49393a05397450978507c4ef1', 'response');
});

test('digest: the header carries every field a qop=auth challenge requires', async () => {
    const c = W.parseDigestChallenge(
        'Digest realm="r", qop="auth", nonce="n1", opaque="op", algorithm=MD5');
    const h = await W.digestAuthHeader(c, {
        username: 'u', password: 'p', method: 'GET', uri: '/rets/Search.ashx?x=1', nc: 3
    });
    assert(h.startsWith('Digest '), 'scheme');
    for (const f of ['username="u"', 'realm="r"', 'nonce="n1"', 'uri="/rets/Search.ashx?x=1"',
        'opaque="op"', 'algorithm=MD5', 'qop=auth', 'nc=00000003']) {
        assert(h.includes(f), 'missing ' + f + ' in: ' + h);
    }
    assert(/cnonce="[0-9a-f]{16}"/.test(h), 'a client nonce is generated');
    assert(/response="[0-9a-f]{32}"/.test(h), 'response digest present');
});

test('digest: without qop the response omits nc/cnonce (RFC 2069 form)', async () => {
    const c = W.parseDigestChallenge('Digest realm="r", nonce="n1"');
    const h = await W.digestAuthHeader(c, { username: 'u', password: 'p', method: 'GET', uri: '/x' });
    assert(!h.includes('qop='), 'no qop');
    assert(!h.includes('nc='), 'no nonce count');
    assert(!h.includes('cnonce='), 'no client nonce');
    eq(/response="([0-9a-f]{32})"/.exec(h)[1],
        W.md5Hex(W.md5Hex('u:r:p') + ':n1:' + W.md5Hex('GET:/x')), 'legacy response form');
});

test('digest: auth-int is never selected — only auth is implemented', async () => {
    const c = W.parseDigestChallenge('Digest realm="r", qop="auth-int", nonce="n1"');
    const h = await W.digestAuthHeader(c, { username: 'u', password: 'p', method: 'GET', uri: '/x' });
    assert(!h.includes('qop='), 'auth-int alone falls back to the qop-less form');
});

test('digest: the URI signed is path AND query — a Search.ashx call is all query', () => {
    eq(W.digestUri('https://ntrdd.mlsmatrix.com/rets/Search.ashx?SearchType=Property&Class=RES'),
        '/rets/Search.ashx?SearchType=Property&Class=RES');
    eq(W.digestUri('https://ntrdd.mlsmatrix.com/rets/Login.ashx'), '/rets/Login.ashx');
});

test('digest: a non-Digest or malformed challenge yields null, not a broken header', () => {
    eq(W.parseDigestChallenge('Basic realm="x"'), null);
    eq(W.parseDigestChallenge(''), null);
    eq(W.parseDigestChallenge(null), null);
    eq(W.parseDigestChallenge('Digest realm="x"'), null, 'no nonce = unusable challenge');
});

test('rets: the UA-Authorization digest matches the RETS 1.7.2 section 3.10 formula', () => {
    // MD5( MD5(product:UA-password) : request-id : session-id : version )
    // with an empty request-id, which is the doubled colon
    const a1 = W.md5Hex('MyApp/1.0:uapass');
    eq(W.md5Hex(a1 + '::sess123:RETS/1.7.2'),
        W.md5Hex(W.md5Hex('MyApp/1.0:uapass') + '::' + 'sess123' + ':' + 'RETS/1.7.2'));
    // and at login, before any session cookie exists, the session slot is empty too
    assert(W.md5Hex(a1 + ':::RETS/1.7.2') !== W.md5Hex(a1 + '::sess123:RETS/1.7.2'),
        'the empty-session form differs from the with-session form');
});

// ---- Cookie handling ----
// Workers has no cookie jar, so the RETS session is carried by hand. NTREIS
// sits behind an AWS load balancer that plants stickiness cookies on the 401
// CHALLENGE, before the session cookie exists — losing either one sends the
// authenticated request to a different backend from the one holding the nonce.

test('cookies: the challenge jar and the login jar are merged, freshest winning', () => {
    const fromChallenge = 'AWSALB=oldvalue; AWSALBCORS=oldvalue';
    const fromLogin = 'RETS-Session-ID=abc123; AWSALB=newvalue';
    const merged = W.mergeCookies(fromChallenge, fromLogin);
    assert(merged.includes('RETS-Session-ID=abc123'), 'session id kept: ' + merged);
    assert(merged.includes('AWSALB=newvalue'), 'fresher stickiness wins: ' + merged);
    assert(!merged.includes('AWSALB=oldvalue'), 'and the stale one is gone: ' + merged);
    assert(merged.includes('AWSALBCORS=oldvalue'),
        'a cookie only the challenge set still survives: ' + merged);
});

test('cookies: merging with nothing is a no-op, not a crash', () => {
    eq(W.mergeCookies('', 'A=1'), 'A=1');
    eq(W.mergeCookies('A=1', ''), 'A=1');
    eq(W.mergeCookies(null, undefined), '');
});

test('cookies: Set-Cookie attributes are stripped, only name=value is replayed', () => {
    // A real NTREIS 401 sets: AWSALB=...; Expires=...; Path=/; SameSite=None; Secure
    const res = {
        headers: {
            getSetCookie: () => [
                'AWSALB=7x/qeAsa+7pLQl5h; Expires=Thu, 03 Sep 2026 19:57:08 GMT; Path=/',
                'AWSALBCORS=7x/qeAsa+7pLQl5h; Path=/; SameSite=None; Secure'
            ],
            get: () => null
        }
    };
    const jar = W.retsCookie(res);
    assert(jar.includes('AWSALB=7x/qeAsa+7pLQl5h'), 'value preserved verbatim: ' + jar);
    assert(!/Expires|Path|SameSite|Secure/.test(jar), 'attributes stripped: ' + jar);
});

test('cookies: a runtime without getSetCookie still reads the combined header', () => {
    const res = {
        headers: {
            get: (n) => n === 'set-cookie'
                ? 'RETS-Session-ID=s1; Path=/,AWSALB=v2; Path=/'
                : null
        }
    };
    const jar = W.retsCookie(res);
    assert(jar.includes('RETS-Session-ID=s1'), jar);
    assert(jar.includes('AWSALB=v2'), jar);
});

test('digest: the live NTREIS challenge parses (captured 2026-08-27)', () => {
    const c = W.parseDigestChallenge(
        'Digest realm="MATRIX", nonce="MjAyNi0wOC0yNyAyMDo1NzowOC40NTc", '
        + 'opaque="0000000000000000", stale=false, algorithm=MD5, qop="auth"');
    eq(c.realm, 'MATRIX');
    eq(c.nonce, 'MjAyNi0wOC0yNyAyMDo1NzowOC40NTc');
    eq(c.opaque, '0000000000000000');
    eq(c.algorithm, 'MD5');
    eq(c.qop, 'auth');
    eq(c.stale, 'false', 'a bare unquoted value parses too');
});

// ---- RETS metadata → suggested field map ----
// A classic RETS server does NOT speak RESO Data Dictionary. The probe reads
// METADATA-TABLE and proposes the MLS_FIELD_MAP that binds this app to
// whatever the server actually calls things.

// Shaped like a Matrix METADATA-TABLE COMPACT response: system names on the
// left, the older RETS standard names in the StandardName column.
const MATRIX_TABLE = [
    { SystemName: 'L_DisplayId', StandardName: 'ListingID', LongName: 'MLS Number' },
    { SystemName: 'L_Address', StandardName: 'FullStreetAddress', LongName: 'Address' },
    { SystemName: 'L_City', StandardName: 'City', LongName: 'City' },
    { SystemName: 'L_State', StandardName: 'StateOrProvince', LongName: 'State' },
    { SystemName: 'L_Zip', StandardName: 'PostalCode', LongName: 'Zip Code' },
    { SystemName: 'LMD_MP_Latitude', StandardName: 'Latitude', LongName: 'Latitude' },
    { SystemName: 'LMD_MP_Longitude', StandardName: 'Longitude', LongName: 'Longitude' },
    { SystemName: 'LM_Int4_3', StandardName: 'LivingArea', LongName: 'SqFt Total' },
    { SystemName: 'LM_Int1_1', StandardName: 'Beds', LongName: 'Bedrooms' },
    { SystemName: 'LM_Int1_2', StandardName: 'BathsFull', LongName: 'Full Baths' },
    { SystemName: 'LM_Int1_3', StandardName: 'BathsHalf', LongName: 'Half Baths' },
    { SystemName: 'L_AskingPrice', StandardName: 'ListPrice', LongName: 'List Price' },
    { SystemName: 'L_SoldPrice', StandardName: 'SellingPrice', LongName: 'Sold Price' },
    { SystemName: 'L_ClosingDate', StandardName: 'SellingDate', LongName: 'Close Date' },
    { SystemName: 'L_Status', StandardName: 'Status', LongName: 'Status' },
    { SystemName: 'L_Remarks', StandardName: 'PublicRemarks', LongName: 'Public Remarks' },
    { SystemName: 'LM_Int2_1', StandardName: 'YearBuilt', LongName: 'Year Built' },
    { SystemName: 'L_UpdateDate', StandardName: 'ModificationTimestamp', LongName: 'Last Change' },
    { SystemName: 'LM_Char10_9', StandardName: '', LongName: 'Some Local Field' }
];

test('rets metadata: the suggested map binds RETS-era names this app never guesses', () => {
    const { map } = W.suggestFieldMapFromMetadata(MATRIX_TABLE);
    // The whole point: RESO calls it ClosePrice, this server calls it SellingPrice
    eq(map.closePrice, 'L_SoldPrice', 'sold price found via the SellingPrice standard name');
    eq(map.closeDate, 'L_ClosingDate');
    eq(map.beds, 'LM_Int1_1', 'RETS "Beds", not RESO "BedroomsTotal"');
    eq(map.status, 'L_Status', 'RETS "Status", not RESO "StandardStatus"');
    eq(map.address, 'L_Address', 'RETS "FullStreetAddress", not RESO "UnparsedAddress"');
    eq(map.sqft, 'LM_Int4_3');
    eq(map.remarks, 'L_Remarks');
});

test('rets metadata: it maps to the SYSTEM name, since that is what a search returns', () => {
    const { map } = W.suggestFieldMapFromMetadata(MATRIX_TABLE);
    // Matched via StandardName but bound to SystemName — a StandardNames=0
    // search returns L_SoldPrice columns, not SellingPrice ones
    eq(map.listPrice, 'L_AskingPrice');
    eq(map.lat, 'LMD_MP_Latitude');
});

test('rets metadata: what it cannot find is REPORTED, never fuzzy-matched', () => {
    const { map, unmatched } = W.suggestFieldMapFromMetadata(MATRIX_TABLE);
    assert(unmatched.includes('concessions'), 'this server has no concessions field');
    assert(unmatched.includes('dom'), 'and no days-on-market');
    assert(!('concessions' in map), 'an unmatched key must not appear in the map at all');
    // 'LM_Char10_9' has no standard name and matches no candidate — binding it
    // to anything would be worse than leaving the gap visible
    assert(!Object.values(map).includes('LM_Char10_9'), 'no wild guesses');
});

test('rets metadata: a RESO-conformant table maps straight through', () => {
    const reso = [
        { SystemName: 'ClosePrice', StandardName: 'ClosePrice' },
        { SystemName: 'BedroomsTotal', StandardName: 'BedroomsTotal' },
        { SystemName: 'StandardStatus', StandardName: 'StandardStatus' }
    ];
    const { map } = W.suggestFieldMapFromMetadata(reso);
    eq(map.closePrice, 'ClosePrice');
    eq(map.beds, 'BedroomsTotal');
    eq(map.status, 'StandardStatus');
});

test('rets metadata: every logical field the normalizers read has a candidate list', () => {
    // A field with no candidates could never be auto-mapped, and the gap
    // would only show up as a silently null column in production
    const NEEDED = ['address', 'lat', 'lon', 'sqft', 'beds', 'bathsFull', 'bathsHalf', 'year',
        'closePrice', 'closeDate', 'listPrice', 'status', 'remarks', 'lotAcres', 'lotSqft',
        'garage', 'pool', 'subdivision', 'propType', 'postal', 'city', 'county'];
    const missing = NEEDED.filter(k => !W.MLS_FIELD_CANDIDATES[k]);
    assert(missing.length === 0, 'no candidate list for: ' + missing.join(', '));
});

test('rets metadata: an empty or garbage table suggests nothing rather than guessing', () => {
    const { map, unmatched } = W.suggestFieldMapFromMetadata([]);
    eq(Object.keys(map).length, 0);
    assert(unmatched.length > 20, 'everything is reported unmatched');
});

// ---- Shape contract with the rest of the worker ----

test('mls + TAD: mergeRecords keeps MLS facts and fills only its gaps', () => {
    const mls = W.mlsToRecord(RESO_CLOSED, ENV);
    const tad = {
        sqft: 1700, beds: 3, annualTaxes: 11901, assessedLand: 95000,
        assessedImprov: 403000, apn: 'TAD-999', source: 'TAD'
    };
    const merged = W.mergeRecords(mls, tad);
    eq(merged.sqft, 1842, 'MLS living area wins over the parcel roll');
    eq(merged.apn, '00123456', 'MLS parcel number is not overwritten');
    eq(merged.assessedLand, 95000, 'TAD fills what MLS never carries');
    eq(merged.annualTaxes, 11240, 'MLS had a tax figure; TAD does not clobber it');
    eq(merged.source, 'NTREIS + TAD');
});

test('mls + TAD: the land/improvement split arrives only from the parcel roll', () => {
    const mls = W.mlsToRecord(RESO_CLOSED, ENV);
    eq(mls.assessedLand, null, 'a listing never publishes the split');
    const merged = W.mergeRecords(mls, { assessedLand: 95000, assessedImprov: 403000, source: 'TAD' });
    eq(merged.assessedLand, 95000);
});

// ---- Address lookup: the subject must be the house that was asked for ----
// Regression suite for the bug where /lookup returned the SAME NTREIS listing
// (3101 Long Prairie Road) for every address typed. Three defects stacked:
// the RETS record query carried no address criteria at all, the wrong-house
// guard read UnparsedAddress (which NTREIS does not publish, so it was always
// empty), and the guard failed OPEN on an empty candidate — so "first row of
// an unfiltered search" was accepted as the subject property.

test('address: strict match rejects a candidate that will not parse', () => {
    // The exact shape of the bug: NTREIS rows have no UnparsedAddress, so the
    // candidate arrived empty and the open guard waved it through.
    eq(W.streetMatchStrict('900 W Rosedale St, Fort Worth, TX 76104', ''), false, 'empty');
    eq(W.streetMatchStrict('900 W Rosedale St', undefined), false, 'undefined');
    eq(W.streetMatchStrict('900 W Rosedale St', 'Rosedale St'), false, 'no house number');
});

test('address: strict match still accepts the same house written differently', () => {
    assert(W.streetMatchStrict('900 W Rosedale St, Fort Worth, TX 76104',
        '900 Rosedale Street, Fort Worth, Texas 76104'), 'suffix + directional differ');
    assert(W.streetMatchStrict('3529 W Rogers Ave S', '3529 Rogers Ave'), 'directionals stripped');
});

test('address: strict match rejects a different house', () => {
    eq(W.streetMatchStrict('900 W Rosedale St, Fort Worth, TX 76104',
        '3101 Long Prairie Road, Flower Mound, Texas 75022'), false, 'the bug, verbatim');
    eq(W.streetMatchStrict('900 Rosedale St', '902 Rosedale St'), false, 'neighbour');
    eq(W.streetMatchStrict('900 Rosedale St', '900 Magnolia Ave'), false, 'same number, other street');
});

test('address: the open matcher stays open — its callers rely on it', () => {
    // TAD and the realtor enrich rung have already established the property
    // by geometry or by a resolved mpr_id; an unparseable line there means
    // "cannot disprove", and tightening it would discard good records.
    eq(W.streetMatch('900 W Rosedale St', ''), true, 'still fails open');
    eq(W.streetMatch('900 Rosedale St', '902 Rosedale St'), false, 'but still catches a real mismatch');
});

test('address: a NTREIS-shaped row composes a line the strict matcher accepts', () => {
    // The composed line is the ONLY usable street line on this feed. Reading
    // the raw address field instead is what produced the empty candidate.
    const f = W.mlsFields({});
    const row = {
        StreetNumber: '900', StreetDirPrefix: 'W', StreetName: 'Rosedale',
        StreetSuffix: 'St', City: 'Fort Worth', StateOrProvince: 'TX', PostalCode: '76104'
    };
    eq(W.mlsFlat(row[f.address]), null, 'no UnparsedAddress on this feed');
    eq(W.mlsStreetAddress(row, f), '900 W Rosedale St', 'composed line');
    assert(W.streetMatchStrict('900 W Rosedale St, Fort Worth, TX 76104',
        W.mlsStreetAddress(row, f)), 'composed line confirms the subject');
});

test('rets: a record lookup filters on the address, not just status', () => {
    const q = W.retsDmql({}, {
        statuses: ['CLS', 'ACT'], streetNumber: '900', streetName: 'ROSEDALE', zip: '76104'
    }, W.mlsFields({}));
    assert(q.includes('(StreetNumber=900)'), 'exact house number: ' + q);
    assert(q.includes('(StreetName=ROSEDALE*)'), 'street name prefix: ' + q);
    assert(q.includes('(PostalCode=76104)'), 'postcode narrows it further: ' + q);
});

test('rets: without address criteria a record query would scan the whole feed', () => {
    // Documents why the criteria above are not optional: this is exactly the
    // query the old code sent, and its first row is an arbitrary listing.
    const q = W.retsDmql({}, { statuses: ['CLS', 'ACT', 'PND'] }, W.mlsFields({}));
    eq(q, '(StandardStatus=|CLS,ACT,PND)', 'status alone bounds nothing');
});

test('rets: address values are stripped of DMQL2 punctuation', () => {
    // A value carrying a comma, pipe or paren does not fail — it silently
    // changes the query into a different one, which is far worse.
    eq(W.dmqlToken('O\'Connor'), 'OCONNOR');
    eq(W.dmqlToken('Foo,Bar|(Baz)'), 'FOOBARBAZ');
    eq(W.dmqlToken('rosedale'), 'ROSEDALE', 'upper-cased');
    eq(W.dmqlToken(null), '', 'null is not the string "null"');
    const q = W.retsDmql({}, { statuses: ['CLS'], streetName: 'A,B)|(C' }, W.mlsFields({}));
    assert(q.includes('(StreetName=ABC*)'), 'sanitized into one criterion: ' + q);
});

test('address: a typed line yields the house number and street the query needs', () => {
    const p = W.parseStreetLine('900 W Rosedale St, Fort Worth, TX 76104');
    eq(p.no, 900, 'house number');
    eq(p.name, 'ROSEDALE', 'directional dropped, suffix not reached');
    eq(W.parseStreetLine('Rosedale St'), null, 'no house number = not an address line');
});

test('address: the postcode regex actually matches five digits', () => {
    // It read /(d{5})/ — five literal letter d's — so the coordinate rung
    // never narrowed by postcode and the typo was invisible.
    eq((/\b(\d{5})\b/.exec('900 W Rosedale St, Fort Worth, TX 76104') || [, ''])[1], '76104');
    eq((/(d{5})/.exec('900 W Rosedale St, Fort Worth, TX 76104') || [, ''])[1], '', 'the old form');
});

// ---- Report ----

const failed = results.filter(r => !r.pass);
for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '\n      ' + r.error}`);
}
console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
process.exit(failed.length ? 1 : 0);

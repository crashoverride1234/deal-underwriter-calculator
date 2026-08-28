/**
 * Back-test the valuation engine against real closed sales.
 *
 *   node backtest.mjs --lat 32.7085 --lon -97.3706 --radius 3 --months 18 --n 60
 *
 * Every accuracy figure the app might claim has to come from here. Until it
 * does, the engine's accuracy is unknown — and in-sample metrics on a small
 * local model roughly HALVE the true error, so a number produced any other
 * way is not conservative, it is wrong.
 *
 * WHAT MAKES THIS HONEST
 *
 * For each test sale closing at time t, the worker reconstructs the comp set
 * that existed AT t:
 *   - the close-date window is anchored at t, not today
 *   - sales inside a 7-day reporting lag before t are excluded, because the
 *     feed would not have carried them yet
 *   - rows whose ModificationTimestamp is later than t are rejected outright:
 *     MLS records mutate after closing (concessions, DOM and remarks are
 *     routinely backfilled), so today's row is not the row that existed then
 *   - the test property is removed from its own comparables by listing id,
 *     parcel AND normalized street line, because a relist, an expired listing
 *     and both legs of a flip are separate keys for one house
 *
 * The engine never sees the test sale's price. It sees size, beds, baths,
 * year, lot, garage and location — exactly what it would know about a subject
 * being underwritten before an offer.
 *
 * NTREIS asks for no large pulls 08:00-18:00 Mon-Fri, so this paces itself and
 * is meant to run overnight. Results append to backtest-results.json, so runs
 * accumulate rather than replacing one another.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const Engine = createRequire(import.meta.url)('./engine.js');

const WORKER = process.env.UNDERWRITER_WORKER
  || 'https://underwriter-proxy.jamesthorneiii.workers.dev';
const ORIGIN = 'https://crashoverride1234.github.io';
const RESULTS_FILE = new URL('./backtest-results.json', import.meta.url);

// ---- args ----
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes('--' + name);

/**
 * Submarkets across the metroplex, not one affluent Fort Worth circle.
 * The first measurement of this engine looked respectable because it was
 * taken in 76109 at $317/sqft — which is neither where the volume is nor a
 * fair test of a model that has to work in Pleasant Grove and Saginaw too.
 * Comp density, price level and housing heterogeneity all differ enormously
 * across these, and an average that hides that is not worth having.
 */
const DFW_AREAS = [
  { name: 'FW east/Handley',   lat: 32.7460, lon: -97.2100 },
  { name: 'FW north/Saginaw',  lat: 32.8600, lon: -97.3600 },
  { name: 'FW southeast',      lat: 32.6700, lon: -97.2700 },
  { name: 'Arlington',         lat: 32.7350, lon: -97.1080 },
  { name: 'Grand Prairie',     lat: 32.7200, lon: -97.0000 },
  { name: 'Irving',            lat: 32.8300, lon: -96.9500 },
  { name: 'Dallas/Oak Cliff',  lat: 32.7300, lon: -96.8400 },
  { name: 'Dallas/Pleasant Gr',lat: 32.7350, lon: -96.6800 },
  { name: 'Mesquite',          lat: 32.7700, lon: -96.6000 },
  { name: 'Garland',           lat: 32.9100, lon: -96.6300 },
  { name: 'DeSoto/Duncanville',lat: 32.6200, lon: -96.8700 },
  { name: 'Denton',            lat: 33.2100, lon: -97.1300 }
];

const CFG = {
  lat: parseFloat(arg('lat', '32.7085')),
  lon: parseFloat(arg('lon', '-97.3706')),
  radius: parseFloat(arg('radius', '3')),      // sample area, miles
  months: parseInt(arg('months', '18'), 10),   // how far back to draw test sales
  n: parseInt(arg('n', '40'), 10),             // how many to score
  compRadius: parseFloat(arg('comp-radius', '1')),
  compMonths: parseInt(arg('comp-months', '12'), 10),
  pace: parseInt(arg('pace', '1500'), 10),     // ms between MLS calls
  label: arg('label', 'baseline'),
  // The buy box actually underwritten, so the measurement is of the deals
  // that get done rather than of whatever happened to close nearby
  priceMin: parseFloat(arg('price-min', '0')),
  priceMax: parseFloat(arg('price-max', '0')),
  metro: flag('metro')
};

// The settings the app itself defaults to, so the harness scores the model
// that actually ships rather than a tuned variant of it.
const SETTINGS = {
  bedAdj: 5000, bathAdj: 5000, garageAdjPerSpace: 10000,
  lotAdjPerSqft: 3, poolAdj: 20000, yearAdjPerYear: 500, storyAdj: 0,
  conditionAdjPct: { renovated: 0, average: 10, dated: 20 },
  annualAppreciationPct: 2,
  qualitativeAdjPct: {}
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(path) {
  const res = await fetch(WORKER + path, { headers: { Accept: 'application/json', Origin: ORIGIN } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path.split('?')[0]}`);
  return res.json();
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Score one test sale. Returns null when the reconstructed comp set is too
 * thin to appraise from — those are reported as coverage, not folded into the
 * error, because "declined to price" is a different outcome from "priced
 * badly" and averaging them together hides both.
 */
async function scoreSale(sale, variant) {
  const q = new URLSearchParams({
    latitude: String(sale.lat),
    longitude: String(sale.lon),
    radius: String(CFG.compRadius),
    months: String(CFG.compMonths),
    limit: '25',
    sqft: String(sale.sqft),
    // as-of reconstruction + self-exclusion
    asOf: sale.closeDate,
    excludeKeys: sale.mlsNumber || '',
    excludeParcels: sale.parcel || '',
    excludeAddresses: sale.address || ''
  });
  if (sale.beds) q.set('beds', String(sale.beds));
  if (sale.zip) q.set('zip', sale.zip);

  const data = await api('/comps?' + q);
  const pool = (data.candidates || []).filter(c =>
    c.source !== 'realtor.com' && c.price > 0 && c.sqft > 0);

  // Belt and braces: the worker already excludes the subject, but a stray
  // identity here would be sales chasing and would flatter every metric.
  const clean = pool.filter(c => norm(c.address) !== norm(sale.address));
  if (clean.length < 3) return { skipped: 'thin comp set (' + clean.length + ')' };

  const priced = clean.map(c => ({ label: c.address, salePrice: c.price, sqft: c.sqft }));
  const derived = Engine.deriveMarketRates(priced);
  const outliers = new Map(Engine.pricePerSqftOutliers(priced).map(o => [o.label, o]));

  const subject = {
    sqft: sale.sqft, beds: sale.beds, baths: sale.baths,
    yearBuilt: sale.yearBuilt, garageSpaces: sale.garage,
    stories: sale.stories, lotSqft: sale.lotSqft,
    pool: sale.pool ? 'yes' : 'no'
  };

  const ranked = clean
    .map(c => {
      const o = outliers.get(c.address);
      const withFlags = { ...c, ppsfOutlier: Boolean(o && o.outlier), ppsfDeviationPct: o ? o.deviationPct : null };
      // Comps are aged against the TEST SALE's close date, not today
      return { ...withFlags, score: Engine.scoreComp(subject, withFlags, sale.closeDate) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, variant.topN);

  if (ranked.length < 3) return { skipped: 'thin ranked set' };

  let unverified = 0;
  const comps = ranked.map(c => {
    const months = Math.max(0, Math.round(
      (Date.parse(sale.closeDate) - Date.parse(c.soldDate || sale.closeDate)) / (86400000 * 30.44)));
    const textRead = variant.noCondition
      ? null
      : Engine.classifyCondition(c.remarks, c.propertyCondition);
    const read = Engine.reconcileCondition(textRead, c.ppsfDeviationPct);
    const trusted = Boolean(read && read.trusted);
    if (!trusted) unverified++;
    return {
      label: c.address, salePrice: c.price, concessions: c.concessions || 0,
      sqft: c.sqft, beds: c.beds, baths: c.baths, lotSqft: c.lotSqft,
      garageSpaces: c.garage, yearBuilt: c.yearBuilt, stories: c.stories,
      pool: c.pool ? 'yes' : 'no',
      condition: trusted ? read.condition : 'renovated',
      monthsAgo: Math.min(24, months),
      ratings: {}
    };
  });

  const settings = {
    ...SETTINGS,
    pricePerSqftAdj: variant.fixedPpsf != null
      ? variant.fixedPpsf
      : (derived ? derived.pricePerSqftAdj : 50)
  };

  const a = Engine.appraise({ subject, comps, settings });
  if (!(a.arv > 0)) return { skipped: 'no ARV' };

  // Does the test sale read as a retail transaction, or as a distressed /
  // investor one? Its own remarks and days-on-market are the only signals
  // available, and both are already in hand from the sample.
  const own = Engine.classifyCondition(sale.remarks, sale.propertyCondition);
  const looksDistressed = Boolean(own && own.condition === 'dated');
  const veryFast = Number.isFinite(sale.dom) && sale.dom >= 0 && sale.dom <= 7;

  return {
    id: sale.mlsNumber || sale.address,
    address: sale.address,
    estimate: a.arv,
    actual: sale.closePrice,
    closeDate: sale.closeDate,
    // strata
    compsUsed: comps.length,
    poolSize: clean.length,
    derivedPpsf: derived ? derived.pricePerSqftAdj : null,
    derivedMethod: derived ? derived.method : null,
    conditionUnverified: unverified,
    anyUnverified: unverified > 0,
    sqft: sale.sqft,
    yearBuilt: sale.yearBuilt,
    subdivision: sale.subdivision,
    area: sale.area,
    spreadPct: Math.round(a.spreadPct * 10) / 10,
    confidence: a.confidence,
    subjectLooksDistressed: looksDistressed,
    subjectVeryFast: veryFast,
    subjectDom: sale.dom
  };
}

function stratify(rows, name, bucket) {
  const groups = new Map();
  for (const r of rows) {
    const k = bucket(r);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [k, g] of [...groups].sort()) {
    if (g.length < 5) continue; // a stratum under 5 says nothing
    out.push({ stratum: name + ': ' + k, ...Engine.backtestMetrics(g) });
  }
  return out;
}

function report(title, rows) {
  const m = Engine.backtestMetrics(rows);
  if (!m) { console.log('\n' + title + ': no scorable results'); return null; }
  console.log('\n' + '='.repeat(66));
  console.log(title + '  —  n = ' + m.n);
  console.log('='.repeat(66));
  const line = (k, v, note) => console.log('  ' + k.padEnd(26) + String(v).padStart(9) + (note ? '   ' + note : ''));
  line('Median ratio', m.medianRatio, m.medianRatio >= 0.90 && m.medianRatio <= 1.10 ? 'IAAO ok' : 'OUTSIDE 0.90-1.10');
  line('MdAPE %', m.mdape);
  line('PE10 %', m.pe10, m.pe10 >= 50 ? 'at/above AVM floor' : 'below the 50% floor');
  line('PE20 %', m.pe20);
  line('COD', m.cod, m.cod < 5 ? 'SUSPICIOUS - check for sales chasing' : (m.cod <= 15 ? 'IAAO ok' : 'above 15'));
  line('PRD', m.prd, m.prd == null ? '' : (m.prd >= 0.98 && m.prd <= 1.03 ? 'IAAO ok' : 'outside 0.98-1.03'));
  line('PRB', m.prb, m.prb == null ? '' : (Math.abs(m.prb) <= 0.05 ? 'IAAO ok' : 'price-tier drift'));
  line('Over by >20% %', m.overBy20Pct, m.overBy20Pct <= 10 ? 'within tail limit' : 'ABOVE 10% - over-valuing');
  line('Under by >20% %', m.underBy20Pct);
  line('Median signed err %', m.medianSignedError);
  console.log('  ' + `(median CI half-width ~${m.medianCiPercentilePoints} percentile points at this n)`);
  return m;
}

// ---- run ----

const VARIANTS = flag('compare-comps')
  ? [
      { name: 'A: 4 comps', topN: 4 },
      { name: 'B: 6 comps', topN: 6 }
    ]
  : flag('compare-condition')
  ? [
      { name: 'A: condition adjustment ON', topN: 4 },
      { name: 'B: condition adjustment OFF', topN: 4, noCondition: true }
    ]
  : flag('compare-rate')
  ? [
      { name: 'A: derived $/sqft', topN: 4 },
      { name: 'B: fixed $50/sqft (the old default)', topN: 4, fixedPpsf: 50 }
    ]
  : [{ name: CFG.label, topN: parseInt(arg('top', '4'), 10) }];

console.log('Back-test — ' + WORKER);
console.log(`sample: ${CFG.radius} mi around ${CFG.lat},${CFG.lon}, closed in the last ${CFG.months} months`);
console.log(`scoring ${CFG.n} sales; comps reconstructed as-of each close date`);
console.log('variants: ' + VARIANTS.map(v => v.name).join('  |  '));

const health = await api('/health');
if (!health.mls) {
  console.error('\nMLS feed is not live on the worker — a back-test needs real closed sales.');
  process.exit(1);
}
console.log('feed: ' + health.mls.name + ' (' + health.mls.transport + ')\n');

const areas = CFG.metro ? DFW_AREAS : [{ name: 'custom', lat: CFG.lat, lon: CFG.lon }];
const perArea = Math.max(1, Math.ceil(CFG.n / areas.length));
const universe = [];

for (const area of areas) {
  const q = new URLSearchParams({
    latitude: String(area.lat), longitude: String(area.lon),
    radius: String(CFG.radius), months: String(CFG.months), limit: '300'
  });
  if (CFG.priceMin) q.set('priceMin', String(CFG.priceMin));
  if (CFG.priceMax) q.set('priceMax', String(CFG.priceMax));
  try {
    const s2 = await api('/backtest/sample?' + q);
    // Spread within the area rather than taking its most recent closings — a
    // block of same-month sales measures one moment, not a market
    const pool = s2.sales || [];
    const stride = Math.max(1, Math.floor(pool.length / perArea));
    let taken = 0;
    for (let i = 0; i < pool.length && taken < perArea; i += stride) {
      universe.push({ ...pool[i], area: area.name });
      taken++;
    }
    console.log('  ' + area.name.padEnd(22) + String(pool.length).padStart(4) + ' available, took ' + taken);
  } catch (e) {
    console.log('  ' + area.name.padEnd(22) + 'sample failed: ' + e.message);
  }
  await sleep(CFG.pace);
}

const chosen = universe.slice(0, CFG.n);
console.log('\nscoring ' + chosen.length + ' sales across ' + areas.length
  + ' submarket' + (areas.length === 1 ? '' : 's') + '\n');

const byVariant = new Map(VARIANTS.map(v => [v.name, []]));
const skipped = [];

for (let i = 0; i < chosen.length; i++) {
  const sale = chosen[i];
  const tag = `[${String(i + 1).padStart(3)}/${chosen.length}] ${(sale.address || '').slice(0, 30).padEnd(30)}`;
  try {
    for (const v of VARIANTS) {
      const r = await scoreSale(sale, v);
      if (r.skipped) {
        if (v === VARIANTS[0]) skipped.push({ address: sale.address, why: r.skipped });
        continue;
      }
      byVariant.get(v.name).push(r);
      if (v === VARIANTS[0]) {
        const err = 100 * (r.estimate - r.actual) / r.actual;
        console.log(tag + ' actual $' + r.actual.toLocaleString().padStart(9)
          + '  est $' + r.estimate.toLocaleString().padStart(9)
          + '  ' + (err >= 0 ? '+' : '') + err.toFixed(1) + '%'
          + '  (' + r.compsUsed + ' comps, $' + r.derivedPpsf + '/sf)');
      }
      await sleep(CFG.pace);
    }
  } catch (e) {
    skipped.push({ address: sale.address, why: e.message });
    console.log(tag + ' skipped: ' + e.message);
    await sleep(CFG.pace);
  }
}

const primary = byVariant.get(VARIANTS[0].name);
const headline = report('OVERALL — ' + VARIANTS[0].name, primary);

if (primary.length >= 10) {
  console.log('\n' + '-'.repeat(66));
  console.log('STRATA (any group under 5 omitted)');
  console.log('-'.repeat(66));
  const strata = [
    ...stratify(primary, 'condition', r => r.anyUnverified ? 'some unverified' : 'all verified'),
    ...stratify(primary, 'price', r => r.actual < 400000 ? 'under 400k' : r.actual < 700000 ? '400-700k' : 'over 700k'),
    ...stratify(primary, 'size', r => r.sqft < 1600 ? 'under 1600sf' : r.sqft < 2200 ? '1600-2200sf' : 'over 2200sf'),
    ...stratify(primary, 'pool', r => r.poolSize < 8 ? 'thin pool' : 'full pool'),
    ...stratify(primary, 'area', r => r.area || null),
    ...stratify(primary, 'test sale', r => r.subjectLooksDistressed ? 'reads distressed' : 'reads retail'),
    ...stratify(primary, 'test DOM', r => r.subjectVeryFast ? 'sold in <=7 days' : 'normal marketing time')
  ];
  for (const s of strata) {
    console.log('  ' + s.stratum.padEnd(30)
      + ('n=' + s.n).padStart(6)
      + ('  MdAPE ' + s.mdape + '%').padStart(16)
      + ('  PE10 ' + s.pe10 + '%').padStart(14)
      + ('  over20 ' + s.overBy20Pct + '%').padStart(16));
  }
}

if (VARIANTS.length > 1) {
  const [a, b] = VARIANTS;
  const cmp = Engine.pairedComparison(byVariant.get(a.name), byVariant.get(b.name));
  console.log('\n' + '='.repeat(66));
  console.log('PAIRED COMPARISON — same test sales, both variants');
  console.log('='.repeat(66));
  if (!cmp) {
    console.log('  no overlapping pairs');
  } else {
    console.log('  A = ' + a.name);
    console.log('  B = ' + b.name);
    console.log('  pairs                 ' + String(cmp.n).padStart(6));
    console.log('  B closer / A closer   ' + String(cmp.bWins + ' / ' + cmp.aWins).padStart(6));
    console.log('  median improvement    ' + String(cmp.medianImprovementPct + '%').padStart(6)
      + '   95% CI [' + cmp.ci95[0] + '%, ' + cmp.ci95[1] + '%]');
    console.log('  sign test z           ' + String(cmp.signTestZ == null ? 'n/a' : cmp.signTestZ).padStart(6));
    console.log('  VERDICT               ' + cmp.verdict);
  }
}

if (skipped.length) {
  console.log('\nskipped ' + skipped.length + ' of ' + chosen.length
    + ' (' + Math.round(100 * skipped.length / chosen.length) + '% — coverage, not error):');
  const why = {};
  for (const s of skipped) why[s.why] = (why[s.why] || 0) + 1;
  for (const [k, v] of Object.entries(why)) console.log('  ' + String(v).padStart(4) + '  ' + k);
}

// Accumulate rather than overwrite — the value of this file grows with runs
const history = existsSync(RESULTS_FILE) ? JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) : { runs: [] };
history.runs.push({
  ranAt: new Date().toISOString(),
  config: CFG,
  variants: VARIANTS.map(v => v.name),
  headline,
  results: Object.fromEntries([...byVariant]),
  skipped
});
writeFileSync(RESULTS_FILE, JSON.stringify(history, null, 1));
console.log('\nappended to backtest-results.json (' + history.runs.length + ' runs on file)');

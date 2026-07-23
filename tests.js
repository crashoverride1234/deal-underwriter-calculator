/**
 * Unit tests for the underwriting engine.
 * Run headless:   node tests.js        (exit code 0 = all pass)
 * Run in browser: open test.html
 */
'use strict';

const isNode = typeof module === 'object' && module.exports;
const Engine = isNode ? require('./engine.js') : window.UnderwriterEngine;

const results = [];

function test(name, fn) {
    try {
        fn();
        results.push({ name, pass: true });
    } catch (e) {
        results.push({ name, pass: false, error: e.message });
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function assertNear(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) {
        throw new Error(`${label || 'value'}: expected ${expected} (±${tol}), got ${actual}`);
    }
}

// ---- Shared baseline scenarios ----

const FLIP_BASE = {
    strategy: 'flip', purchasePrice: 200000, buyingCosts: 4000, arv: 320000,
    rehabBudget: 45000, holdingPeriod: 6, financingType: 'cash',
    ltvPercent: 85, interestRate: 10.5, lenderPointsPercent: 2, lenderFees: 1500,
    rehabBufferMonths: 0, variancePercent: 0
};

const RENTAL_BASE = {
    strategy: 'rental', purchasePrice: 200000, buyingCosts: 4000, arv: 320000,
    rehabBudget: 45000, holdingPeriod: 6, financingType: 'cash',
    ltvPercent: 75, interestRate: 7.5, lenderPointsPercent: 1, lenderFees: 1500,
    rehabBufferMonths: 0, variancePercent: 0,
    monthlyRent: 2200, vacancyPercent: 8, operatingExpensesPercent: 40, monthlyTaxesIns: 350
};

// ---- Payment math ----

test('amortized payment: $100k @ 6% / 30yr ≈ $599.55', () => {
    assertNear(Engine.calcAmortizedPayment(100000, 6, 30), 599.55, 0.01);
});

test('amortized payment: 0% interest is simple division', () => {
    assertNear(Engine.calcAmortizedPayment(120000, 0, 30), 120000 / 360, 1e-9);
});

test('amortized payment: zero/negative principal returns 0', () => {
    assert(Engine.calcAmortizedPayment(0, 6) === 0);
    assert(Engine.calcAmortizedPayment(-5000, 6) === 0);
});

test('interest-only payment: $100k @ 12% = $1000/mo', () => {
    assertNear(Engine.calcInterestOnlyPayment(100000, 12), 1000, 1e-9);
});

// ---- Input sanitization ----

test('garbage and negative inputs are sanitized to 0', () => {
    const m = Engine.underwrite({ ...FLIP_BASE, purchasePrice: 'abc', rehabBudget: -500 });
    assert(m.totalProjectCosts >= 0, 'costs should not go negative');
    assertNear(m.purchasePrice, 0, 1e-9, 'purchasePrice');
    assertNear(m.rehabBudget, 0, 1e-9, 'rehabBudget');
});

// ---- Fix & Flip ----

test('flip / all cash: baseline deal', () => {
    const m = Engine.underwrite(FLIP_BASE);
    assertNear(m.totalHoldingCarryingCosts, 300 * 6, 1e-9, 'carry');        // $300/mo baseline
    assertNear(m.totalProjectCosts, 250800, 1e-6, 'totalProjectCosts');
    assertNear(m.sellingRefiCosts, 320000 * 0.08, 1e-6, 'sellingCosts');
    assertNear(m.netProfit, 43600, 1e-6, 'netProfit');
    assertNear(m.cashInvested, 250800, 1e-6, 'cashInvested');
    assertNear(m.roi, (43600 / 250800) * 100, 1e-6, 'roi');
    assertNear(m.annualizedRoi, m.roi * 2, 1e-6, 'annualizedRoi');          // 6mo hold → ×2
});

test('flip / hard money: LTC sizing, points, interest-only carry', () => {
    const m = Engine.underwrite({ ...FLIP_BASE, financingType: 'hard_money' });
    assertNear(m.loanAmount, 245000 * 0.85, 1e-6, 'loanAmount');            // 208,250
    assertNear(m.pointsCost, 208250 * 0.02, 1e-6, 'points');
    assertNear(m.financeFees, 1500 + 4165, 1e-6, 'financeFees');
    assertNear(m.monthlyFinancingCost, 208250 * 0.105 / 12, 1e-6, 'ioPayment');
    assertNear(m.totalProjectCosts, 267398.125, 0.01, 'totalProjectCosts');
    assertNear(m.netProfit, 27001.875, 0.01, 'netProfit');
    assertNear(m.cashInvested, 59148.125, 0.01, 'cashInvested');
});

test('flip / hard money: loan is capped at 75% of ARV', () => {
    const m = Engine.underwrite({ ...FLIP_BASE, financingType: 'hard_money', arv: 200000 });
    assertNear(m.loanAmount, 200000 * 0.75, 1e-6, 'cappedLoan');
});

test('flip: -25% ARV variance turns the deal into a loss', () => {
    const m = Engine.underwrite({ ...FLIP_BASE, variancePercent: -25 });
    assertNear(m.arv, 240000, 1e-6, 'adjustedArv');
    assertNear(m.netProfit, 240000 - 250800 - 240000 * 0.08, 1e-6, 'netProfit');
    assert(m.netProfit < 0, 'should be unprofitable');
});

test('flip: rehab buffer extends carrying costs', () => {
    const m = Engine.underwrite({ ...FLIP_BASE, rehabBufferMonths: 3 });
    assertNear(m.holdingPeriod, 9, 1e-9, 'holdingPeriod');
    assertNear(m.totalHoldingCarryingCosts, 300 * 9, 1e-9, 'carry');
});

test('flip: financed cash-invested never reported below 0', () => {
    // Tiny deal, huge loan cap: loan exceeds total costs
    const m = Engine.underwrite({
        ...FLIP_BASE, purchasePrice: 50000, rehabBudget: 10000,
        arv: 500000, financingType: 'hard_money', ltvPercent: 100
    });
    assert(m.cashInvested >= 0, 'flip cash invested must be >= 0');
});

// ---- Rental / Buy & Hold ----

test('rental / all cash: NOI, CoC, DSCR is Infinite (no debt)', () => {
    const m = Engine.underwrite(RENTAL_BASE);
    assertNear(m.netOperatingIncome, 2200 - 176 - 880 - 350, 1e-9, 'NOI');  // 794
    assert(m.monthlyDebtService === 0, 'no debt service');
    assert(m.dscrRatio === Infinity, 'DSCR must be Infinity with no debt');
    const expectedCash = 200000 + 45000 + 4000 + 350 * 6;                   // carry = taxes/ins
    assertNear(m.cashInvested, expectedCash, 1e-6, 'cashInvested');
    assertNear(m.cocReturn, (794 * 12 / expectedCash) * 100, 1e-6, 'cocReturn');
});

test('rental: taxes/ins of 0 stays 0 (regression: old "|| 250" fallback)', () => {
    const m = Engine.underwrite({ ...RENTAL_BASE, monthlyTaxesIns: 0 });
    assertNear(m.monthlyHoldingCost, 0, 1e-9, 'holding cost should be 0, not 250');
    assertNear(m.netOperatingIncome, 2200 - 176 - 880, 1e-9, 'NOI');
});

test('rental / DSCR purchase: loan sizing, debt service, negative cash flow', () => {
    const m = Engine.underwrite({ ...RENTAL_BASE, financingType: 'dscr_purchase' });
    assertNear(m.loanAmount, 150000, 1e-6, 'loanAmount');                   // 75% LTV
    const pmt = Engine.calcAmortizedPayment(150000, 7.5, 30);
    assertNear(pmt, 1048.82, 0.01, 'amortized payment');
    assertNear(m.monthlyDebtService, pmt, 1e-9, 'debtService');
    assertNear(m.monthlyCashFlow, 794 - pmt, 1e-9, 'cashFlow');
    assert(m.monthlyCashFlow < 0, 'this deal should be cash flow negative');
    assertNear(m.dscrRatio, 794 / pmt, 1e-9, 'dscr');
    assert(m.dscrRatio < 1.25, 'should fail lender DSCR threshold');
    const expectedCash = (200000 - 150000) + 45000 + 4000 + (1500 + 1500) + (350 + pmt) * 6;
    assertNear(m.cashInvested, expectedCash, 0.01, 'cashInvested');
});

test('rental / BRRRR: refi against ARV, cash left in deal', () => {
    const m = Engine.underwrite({ ...RENTAL_BASE, financingType: 'dscr_refi' });
    assertNear(m.loanAmount, 320000 * 0.75, 1e-6, 'refiLoan');              // 240,000
    assert(m.monthlyFinancingCost === 0, 'no debt service during cash rehab phase');
    assertNear(m.sellingRefiCosts, 240000 * 0.02, 1e-6, 'refiClosingCosts');
    // preRefiCash 251,100 + closing 4,800 - loan 240,000
    assertNear(m.cashInvested, 15900, 1e-6, 'cashLeftInDeal');
    assertNear(m.monthlyDebtService, Engine.calcAmortizedPayment(240000, 7.5, 30), 1e-9, 'postRefiPayment');
});

test('rental / BRRRR: high appraisal produces cash-out (negative cash left)', () => {
    const m = Engine.underwrite({ ...RENTAL_BASE, financingType: 'dscr_refi', arv: 400000 });
    assertNear(m.loanAmount, 300000, 1e-6, 'refiLoan');
    assertNear(m.cashInvested, 251100 + 6000 - 300000, 1e-6, 'cashOut');    // -42,900
    assert(m.cashInvested < 0, 'refi proceeds should exceed cash spent');
});

test('rental: infinite CoC when no cash left and positive cash flow', () => {
    const m = Engine.underwrite({
        ...RENTAL_BASE, financingType: 'dscr_refi', arv: 400000,
        monthlyRent: 6000, operatingExpensesPercent: 10
    });
    assert(m.cashInvested < 0, 'precondition: cash-out deal');
    assert(m.monthlyCashFlow > 0, 'precondition: positive cash flow');
    assert(m.cocReturn === Infinity, 'CoC should be Infinite');
});

test('rental: appraisal variance flows into refi loan sizing', () => {
    const m = Engine.underwrite({ ...RENTAL_BASE, financingType: 'dscr_refi', variancePercent: -10 });
    assertNear(m.arv, 288000, 1e-6, 'adjustedArv');
    assertNear(m.loanAmount, 288000 * 0.75, 1e-6, 'refiLoan');
});

// ---- Desktop Appraisal (sales comparison) ----

const APPRAISE_BASE = {
    subject: { sqft: 1500, beds: 3, baths: 2 },
    settings: {
        pricePerSqftAdj: 50, bedAdj: 5000, bathAdj: 7500,
        conditionAdjPct: { renovated: 0, average: 8, dated: 15 },
        annualAppreciationPct: 6
    }
};
const IDENTICAL_COMP = { label: 'twin', salePrice: 300000, sqft: 1500, beds: 3, baths: 2, condition: 'renovated', monthsAgo: 0 };

test('appraise: identical comp needs no adjustments, full weight', () => {
    const a = Engine.appraise({ ...APPRAISE_BASE, comps: [IDENTICAL_COMP] });
    assertNear(a.comps[0].netAdjustment, 0, 1e-9, 'netAdjustment');
    assertNear(a.comps[0].adjustedValue, 300000, 1e-9, 'adjustedValue');
    assertNear(a.comps[0].weight, 1, 1e-9, 'weight');
    assert(!a.comps[0].flagged, 'should not be flagged');
    assertNear(a.arv, 300000, 1e-9, 'arv');
});

test('appraise: sqft, bed, condition and time adjustments are itemized', () => {
    const comp = { salePrice: 280000, sqft: 1400, beds: 2, baths: 2, condition: 'average', monthsAgo: 6 };
    const a = Engine.appraise({ ...APPRAISE_BASE, comps: [comp] });
    const adj = a.comps[0].adjustments;
    // GLA nets out the missing bedroom's ~120 sqft footprint: 100 - 120 = -20
    assertNear(adj.sqft, ((1500 - 1400) - 120) * 50, 1e-9, 'sqft adj (net of bedroom footprint)'); // -1,000
    assertNear(adj.beds, 5000, 1e-9, 'bed adj');
    assertNear(adj.baths, 0, 1e-9, 'bath adj');
    // Condition applies to the time-adjusted basis, not the stale nominal price
    const basis = 280000 * (1 + 0.06 * 0.5);                               // 288,400
    assertNear(adj.condition, basis * 0.08, 1e-9, 'condition adj on basis'); // +23,072
    assertNear(adj.time, 280000 * 0.06 * 0.5, 1e-9, 'time adj');           // +8,400
    assertNear(a.comps[0].adjustedValue, 280000 - 1000 + 5000 + 23072 + 8400, 1e-9, 'adjustedValue');
    assertNear(a.comps[0].grossAdjPct, ((1000 + 5000 + 23072 + 8400) / 280000) * 100, 1e-9, 'grossAdjPct');
});

test('appraise: heavily-adjusted comps get less weight in the blend', () => {
    const adjustedComp = { salePrice: 280000, sqft: 1400, beds: 2, baths: 2, condition: 'average', monthsAgo: 6 };
    const a = Engine.appraise({ ...APPRAISE_BASE, comps: [IDENTICAL_COMP, adjustedComp] });
    const adjusted = 280000 - 1000 + 5000 + 23072 + 8400;                  // 315,472
    const w2 = 1 - (((1000 + 5000 + 23072 + 8400) / 280000) * 100) / 50;
    const expected = Math.round(((300000 * 1 + adjusted * w2) / (1 + w2)) / 1000) * 1000;
    assertNear(a.arv, expected, 1e-9, 'weighted arv');
    assert(a.arv > 300000 && a.arv < adjusted, 'blend must land between the comps');
    assert(a.comps[1].weight < a.comps[0].weight, 'adjusted comp weighs less');
});

test('appraise: comps over 25% gross adjustment are flagged', () => {
    const weak = { salePrice: 200000, sqft: 1000, beds: 3, baths: 2, condition: 'dated', monthsAgo: 0 };
    const a = Engine.appraise({ ...APPRAISE_BASE, comps: [weak] });
    // sqft +25,000 (12.5%) + dated +30,000 (15%) = 27.5% gross
    assertNear(a.comps[0].grossAdjPct, 27.5, 1e-9, 'grossAdjPct');
    assert(a.comps[0].flagged, 'must be flagged');
    assertNear(a.comps[0].weight, 1 - 27.5 / 50, 1e-9, 'weight');
});

test('appraise: weight never drops below the 0.1 floor', () => {
    const extreme = { salePrice: 100000, sqft: 600, beds: 3, baths: 2, condition: 'dated', monthsAgo: 0 };
    const a = Engine.appraise({ ...APPRAISE_BASE, comps: [extreme] });
    assert(a.comps[0].grossAdjPct > 50, 'precondition: gross > 50%');
    assertNear(a.comps[0].weight, 0.1, 1e-9, 'weight floor');
});

test('appraise: no comps (or zero-price comps) yields zero ARV, low confidence', () => {
    const empty = Engine.appraise({ ...APPRAISE_BASE, comps: [] });
    assert(empty.arv === 0 && empty.confidence === 'low', 'empty comps');
    const zeros = Engine.appraise({ ...APPRAISE_BASE, comps: [{ salePrice: 0, sqft: 1500 }] });
    assert(zeros.arv === 0, 'zero-price comps are filtered out');
});

test('appraise: ARV is rounded to the nearest $1,000', () => {
    const comp = { salePrice: 299499, sqft: 1500, beds: 3, baths: 2, condition: 'renovated', monthsAgo: 0 };
    const a = Engine.appraise({ ...APPRAISE_BASE, comps: [comp] });
    assertNear(a.arv, 299000, 1e-9, 'rounded arv');
});

test('appraise: confidence requires 3+ agreeing comps for HIGH', () => {
    const three = Engine.appraise({ ...APPRAISE_BASE, comps: [IDENTICAL_COMP, { ...IDENTICAL_COMP }, { ...IDENTICAL_COMP }] });
    assert(three.confidence === 'high', '3 identical comps → high');
    const two = Engine.appraise({ ...APPRAISE_BASE, comps: [IDENTICAL_COMP, { ...IDENTICAL_COMP }] });
    assert(two.confidence === 'medium', '2 comps cap at medium');
});

test('appraise: time adjustment scales with months since sale', () => {
    const yearOld = { salePrice: 300000, sqft: 1500, beds: 3, baths: 2, condition: 'renovated', monthsAgo: 12 };
    const a = Engine.appraise({ ...APPRAISE_BASE, comps: [yearOld] });
    assertNear(a.comps[0].adjustments.time, 300000 * 0.06, 1e-9, '12mo at 6%/yr = +6%');
});

// ---- Expanded appraiser adjustment grid ----

const APPRAISE_FULL = {
    subject: { sqft: 1500, beds: 3, baths: 2, lotSqft: 8000, garageSpaces: 2, yearBuilt: 1990, pool: 'yes', stories: 1 },
    settings: {
        ...APPRAISE_BASE.settings,
        lotAdjPerSqft: 1.5, garageAdjPerSpace: 7500, poolAdj: 15000,
        yearAdjPerYear: 500, storyAdj: 5000,
        qualitativeAdjPct: { schools: 4, curbAppeal: 2, locationInfluence: 5 }
    }
};
const FULL_TWIN = {
    salePrice: 300000, sqft: 1500, beds: 3, baths: 2, lotSqft: 8000, garageSpaces: 2,
    yearBuilt: 1990, pool: 'yes', stories: 1, condition: 'renovated', monthsAgo: 0
};

test('appraise: lot, garage, pool, age and story adjustments are itemized', () => {
    // Average condition so the age line fires (renovated resets effective age)
    const comp = { ...FULL_TWIN, lotSqft: 6000, garageSpaces: 1, yearBuilt: 1980, pool: 'no', stories: 2, condition: 'average' };
    const a = Engine.appraise({ ...APPRAISE_FULL, comps: [comp] });
    const adj = a.comps[0].adjustments;
    assertNear(adj.lot, (8000 - 6000) * 1.5, 1e-9, 'lot adj');             // +3,000
    assertNear(adj.garage, 7500, 1e-9, 'garage adj');
    assertNear(adj.year, (1990 - 1980) * 500, 1e-9, 'age adj');            // +5,000
    assertNear(adj.pool, 15000, 1e-9, 'pool adj (subject has, comp lacks)');
    assertNear(adj.stories, 5000, 1e-9, 'multi-story comp vs single-story premium');
    assertNear(adj.condition, 300000 * 0.08, 1e-9, 'average condition (0 months → basis = price)');
    assertNear(a.comps[0].netAdjustment, 3000 + 7500 + 5000 + 15000 + 5000 + 24000, 1e-9, 'net');
});

test('appraise: renovated comp takes NO age adjustment (effective age reset)', () => {
    const oldButRenovated = { ...FULL_TWIN, yearBuilt: 1975 };              // condition: 'renovated'
    const a = Engine.appraise({ ...APPRAISE_FULL, comps: [oldButRenovated] });
    assertNear(a.comps[0].adjustments.year, 0, 1e-9, 'renovation resets effective age');
    assertNear(a.arv, 300000, 1e-9, 'otherwise-identical comp appraises clean');
});

test('appraise: GLA nets out room footprints — no bedroom double-count', () => {
    // Comp is exactly one bedroom-footprint smaller: the sqft line goes to 0
    // and the full bedroom value is carried once, by the bed adjustment
    const comp = { salePrice: 300000, sqft: 1380, beds: 2, baths: 2, condition: 'renovated', monthsAgo: 0 };
    const a = Engine.appraise({ ...APPRAISE_BASE, comps: [comp] });
    assertNear(a.comps[0].adjustments.sqft, 0, 1e-9, '120 sqft deficit = the bedroom itself');
    assertNear(a.comps[0].adjustments.beds, 5000, 1e-9, 'bedroom paid once');
    assertNear(a.comps[0].netAdjustment, 5000, 1e-9, 'net is just the bedroom');
});

test('appraise: story premium prices stairs, not floor count', () => {
    const threeStoryComp = { ...FULL_TWIN, stories: 3 };
    const oneAndAHalf = { ...FULL_TWIN, stories: 1.5 };
    const a = Engine.appraise({ ...APPRAISE_FULL, comps: [threeStoryComp, oneAndAHalf] });
    assertNear(a.comps[0].adjustments.stories, 5000, 1e-9, '1-vs-3 = full premium');
    assertNear(a.comps[1].adjustments.stories, 5000, 1e-9, '1-vs-1.5 = same premium (stairs are stairs)');
    // Multi-vs-multi is a wash
    const subj2Story = { ...APPRAISE_FULL.subject, stories: 2 };
    const b = Engine.appraise({ ...APPRAISE_FULL, subject: subj2Story, comps: [threeStoryComp] });
    assertNear(b.comps[0].adjustments.stories, 0, 1e-9, '2-vs-3 stories = no adjustment');
});

test('appraise: overlap advisories flag likely double-counts per comp', () => {
    const doubled = {
        ...FULL_TWIN, lotSqft: 6000, condition: 'dated',
        ratings: { curbAppeal: 'inferior', lotUsability: 'inferior' }
    };
    const a = Engine.appraise({ ...APPRAISE_FULL, comps: [doubled] });
    assert(a.comps[0].overlaps.length === 2, `expected 2 overlaps, got ${a.comps[0].overlaps.length}`);
    assert(a.comps[0].overlaps[0].includes('curb appeal'), 'condition+curb appeal flagged');
    assert(a.comps[0].overlaps[1].includes('lot usability'), 'lot size+usability flagged');
    const clean = Engine.appraise({ ...APPRAISE_FULL, comps: [FULL_TWIN] });
    assert(clean.comps[0].overlaps.length === 0, 'twin has no overlap advisories');
});

test('appraise: pool and story adjustments reverse direction correctly', () => {
    const comp = { ...FULL_TWIN, pool: 'yes', stories: 1 };
    const subjNoPool2Story = { ...APPRAISE_FULL.subject, pool: 'no', stories: 2 };
    const a = Engine.appraise({ ...APPRAISE_FULL, subject: subjNoPool2Story, comps: [comp] });
    const adj = a.comps[0].adjustments;
    assertNear(adj.pool, -15000, 1e-9, 'comp has pool, subject does not → down');
    assertNear(adj.stories, -5000, 1e-9, '1-story comp is superior under 1-story premium → down');
});

test('appraise: qualitative ratings adjust by % of sale price, signed', () => {
    const comp = { ...FULL_TWIN, ratings: { schools: 'inferior', curbAppeal: 'superior', locationInfluence: 'similar' } };
    const a = Engine.appraise({ ...APPRAISE_FULL, comps: [comp] });
    const adj = a.comps[0].adjustments;
    assertNear(adj.schools, 300000 * 0.04, 1e-9, 'inferior schools → +4%');
    assertNear(adj.curbAppeal, -(300000 * 0.02), 1e-9, 'superior curb appeal → -2%');
    assertNear(adj.locationInfluence, 0, 1e-9, 'similar → 0');
});

test('appraise: percentage adjustments use the time-adjusted basis', () => {
    const comp = { ...FULL_TWIN, monthsAgo: 12, ratings: { schools: 'inferior' } };
    const a = Engine.appraise({ ...APPRAISE_FULL, comps: [comp] });
    const basis = 300000 * 1.06;                       // 6%/yr × 12 months
    assertNear(a.comps[0].adjustments.time, 18000, 1e-9, 'time establishes the basis');
    assertNear(a.comps[0].adjustments.schools, basis * 0.04, 1e-9, 'qualitative % on basis, not nominal'); // 12,720
});

test('appraise: missing comp data means no adjustment (not a phantom one)', () => {
    // Comp saved before the new fields existed — no lot/garage/year/pool/stories
    const legacyComp = { salePrice: 300000, sqft: 1500, beds: 3, baths: 2, condition: 'renovated', monthsAgo: 0 };
    const a = Engine.appraise({ ...APPRAISE_FULL, comps: [legacyComp] });
    const adj = a.comps[0].adjustments;
    assertNear(adj.lot, 0, 1e-9, 'no lot data → 0');
    assertNear(adj.garage, 0, 1e-9, 'no garage data → 0');
    assertNear(adj.year, 0, 1e-9, 'no year data → 0');
    assertNear(adj.pool, 0, 1e-9, 'unknown pool → 0');
    assertNear(adj.stories, 0, 1e-9, 'unknown stories → 0');
    assertNear(a.arv, 300000, 1e-9, 'twin still appraises at sale price');
});

// ---- Market absorption ----

test('absorption: strong sales pace + pendings reads HOT', () => {
    const m = Engine.marketAbsorption({ activeListings: 42, pendingListings: 28, soldLast90Days: 51 });
    const soldPerMonth = 51 / 3;
    const moi = 42 / soldPerMonth;
    assertNear(m.soldPerMonth, soldPerMonth, 1e-9, 'soldPerMonth');
    assertNear(m.monthsOfInventory, moi, 1e-9, 'MOI');
    const expectedScore = Math.min(100, 100 * (1 - moi / 12) + Math.min((28 / 42) * 20, 20));
    assertNear(m.score, expectedScore, 1e-9, 'score');
    assert(m.temperature === 'hot', `expected hot, got ${m.temperature}`);
});

test('absorption: heavy inventory with slow sales reads COLD', () => {
    const m = Engine.marketAbsorption({ activeListings: 100, pendingListings: 2, soldLast90Days: 15 });
    assertNear(m.monthsOfInventory, 100 / 5, 1e-9, 'MOI = 20 months');
    assert(m.score < 20, `score should be cold-range, got ${m.score}`);
    assert(m.temperature === 'cold', `expected cold, got ${m.temperature}`);
});

test('absorption: 6 months of inventory with no pendings is BALANCED', () => {
    const m = Engine.marketAbsorption({ activeListings: 30, pendingListings: 0, soldLast90Days: 15 });
    assertNear(m.monthsOfInventory, 6, 1e-9, 'MOI');
    assertNear(m.score, 50, 1e-9, 'score');
    assert(m.temperature === 'balanced', `expected balanced, got ${m.temperature}`);
});

test('absorption: no data yields unknown, not a fake reading', () => {
    const m = Engine.marketAbsorption({ activeListings: 0, pendingListings: 0, soldLast90Days: 0 });
    assert(m.temperature === 'unknown', 'unknown temperature');
    assertNear(m.score, 50, 1e-9, 'neutral needle position');
});

test('absorption: listings but zero sales reads infinite inventory / cold', () => {
    const m = Engine.marketAbsorption({ activeListings: 20, pendingListings: 0, soldLast90Days: 0 });
    assert(m.monthsOfInventory === Infinity, 'MOI is Infinity');
    assert(m.temperature === 'cold', `expected cold, got ${m.temperature}`);
});

test('appraise: blank subject sqft/beds/baths produce NO phantom adjustments', () => {
    const a = Engine.appraise({
        subject: { sqft: '', beds: '', baths: '' },
        comps: [{ salePrice: 300000, sqft: 1500, beds: 3, baths: 2, condition: 'renovated', monthsAgo: 0 }],
        settings: { pricePerSqftAdj: 50, bedAdj: 5000, bathAdj: 7500, conditionAdjPct: { renovated: 0 }, annualAppreciationPct: 0 }
    });
    const c = a.comps[0];
    assert(c.adjustments.sqft === 0, 'no sqft phantom');
    assert(c.adjustments.beds === 0, 'no beds phantom');
    assert(c.adjustments.baths === 0, 'no baths phantom');
    assertNear(c.adjustedValue, 300000, 1e-9, 'comp stays unadjusted');
});

test('appraise: comp with a blank baths field gets no bath adjustment', () => {
    const a = Engine.appraise({
        subject: { sqft: 1500, beds: 3, baths: 2 },
        comps: [{ salePrice: 300000, sqft: 1500, beds: 3, baths: '', condition: 'renovated', monthsAgo: 0 }],
        settings: { pricePerSqftAdj: 50, bedAdj: 5000, bathAdj: 7500, conditionAdjPct: { renovated: 0 }, annualAppreciationPct: 0 }
    });
    assert(a.comps[0].adjustments.baths === 0, 'blank comp baths = no adjustment');
});

test('appraise: negative appreciation adjusts old comps DOWN (declining market)', () => {
    const a = Engine.appraise({
        subject: { sqft: 1500, beds: 3, baths: 2 },
        comps: [{ salePrice: 300000, sqft: 1500, beds: 3, baths: 2, condition: 'renovated', monthsAgo: 12 }],
        settings: { pricePerSqftAdj: 50, bedAdj: 5000, bathAdj: 7500, conditionAdjPct: { renovated: 0 }, annualAppreciationPct: -6 }
    });
    assertNear(a.comps[0].adjustments.time, -18000, 1e-9, '-6%/yr × 12 months on $300k');
});

// ---- Report ----

const failed = results.filter(r => !r.pass);

if (isNode) {
    for (const r of results) {
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '\n      ' + r.error}`);
    }
    console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
    process.exit(failed.length ? 1 : 0);
} else if (typeof window !== 'undefined' && typeof window.renderTestResults === 'function') {
    window.renderTestResults(results);
}

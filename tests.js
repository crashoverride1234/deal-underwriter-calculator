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

// ---- classifyCondition: listing-remarks condition read ----

test('classify: full-scope renovation language reads renovated', () => {
    assert(Engine.classifyCondition('Completely remodeled in 2024 with designer finishes').condition === 'renovated');
    assert(Engine.classifyCondition('This home has been PROFESSIONALLY RENOVATED top to bottom').condition === 'renovated');
    assert(Engine.classifyCondition('Stunning home, recently updated throughout').condition === 'renovated');
    assert(Engine.classifyCondition('Taken down to the studs and reimagined').condition === 'renovated');
});

test('classify: distress / as-is language reads dated', () => {
    assert(Engine.classifyCondition('Sold as-is. Investor special!').condition === 'dated');
    assert(Engine.classifyCondition('Needs some TLC but great location').condition === 'dated');
    assert(Engine.classifyCondition('Great bones, bring your vision').condition === 'dated');
    assert(Engine.classifyCondition('Handyman opportunity, needs work').condition === 'dated');
});

test('classify: partial-update mentions read average', () => {
    assert(Engine.classifyCondition('Updated kitchen with granite counters').condition === 'average');
    assert(Engine.classifyCondition('New roof (2023) and new water heater').condition === 'average');
});

test('classify: flip resale — renovation language outranks as-is boilerplate', () => {
    const r = Engine.classifyCondition('Completely renovated! Seller never occupied, sold as-is.');
    assert(r.condition === 'renovated', 'remodel beats boilerplate as-is');
});

test('classify: no signal or missing text returns null, never a guess', () => {
    assert(Engine.classifyCondition('Charming home near parks and top schools') === null);
    assert(Engine.classifyCondition('') === null);
    assert(Engine.classifyCondition(null) === null);
    assert(Engine.classifyCondition(undefined) === null);
});

// ---- protestOpportunity: assessed vs evidence ----

test('protest: over-assessment prices the savings at the derived rate', () => {
    const p = Engine.protestOpportunity({ assessedValue: 320000, annualTaxes: 7040, evidenceValue: 285000 });
    assert(p.overAssessedBy === 35000, 'over-assessed delta');
    assert(p.estAnnualSavings === 770, '35k × 2.2%');
    assertNear(p.effectiveRatePct, 2.2, 1e-9, 'derived rate');
});

test('protest: at/under assessment or missing data is null — no manufactured grievances', () => {
    assert(Engine.protestOpportunity({ assessedValue: 280000, annualTaxes: 6000, evidenceValue: 280000 }) === null, 'equal = no case');
    assert(Engine.protestOpportunity({ assessedValue: 280000, annualTaxes: 6000, evidenceValue: 300000 }) === null, 'under-assessed = no case');
    assert(Engine.protestOpportunity({ assessedValue: 0, annualTaxes: 6000, evidenceValue: 250000 }) === null);
    assert(Engine.protestOpportunity({ assessedValue: 280000, annualTaxes: '', evidenceValue: 250000 }) === null);
});

// ---- readHailHistory ----

test('hail history: 3+ severe reports read as hail alley, 1-2 informational, 0 clean', () => {
    const alley = Engine.readHailHistory({ count: 9, countSevere: 4, radiusMi: 3, maxMag: 2.5, latest: '2025-05-28' });
    assert(alley.severity === 'bad' && alley.label.includes('4 reports') && alley.label.includes('2.5"'), 'hail alley');
    assert(Engine.readHailHistory({ count: 2, countSevere: 1, radiusMi: 3 }).severity === 'info', 'one severe = info');
    assert(Engine.readHailHistory({ count: 3, countSevere: 0, radiusMi: 3 }).severity === 'good', 'small hail only = clean');
    assert(Engine.readHailHistory(null) === null && Engine.readHailHistory({}) === null, 'no data = no read');
});

// ---- readFloodZone / readShrinkSwell: site-record classification ----

test('flood zone: A/V zones read as mandatory-insurance SFHA, X reads clean', () => {
    const ae = Engine.readFloodZone('AE');
    assert(ae.severity === 'bad' && ae.sfha === true, 'AE is an SFHA');
    assert(Engine.readFloodZone('VE').sfha === true, 'VE is an SFHA');
    assert(Engine.readFloodZone('AO', '').sfha === true, 'AO is an SFHA');
    const x = Engine.readFloodZone('X', 'AREA OF MINIMAL FLOOD HAZARD');
    assert(x.severity === 'good' && x.sfha === false, 'plain X is clean');
});

test('flood zone: shaded X reads as a disclosure item; D undetermined; blank is null', () => {
    const shaded = Engine.readFloodZone('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD');
    assert(shaded.severity === 'info', 'shaded X is informational');
    assert(Engine.readFloodZone('D').severity === 'info', 'zone D undetermined');
    assert(Engine.readFloodZone('') === null && Engine.readFloodZone(null) === null, 'no zone = no read');
});

test('shrink-swell: LEP bands map to high/moderate/low; missing is null', () => {
    const high = Engine.readShrinkSwell(9.1, 'Sanger');
    assert(high.severity === 'bad' && high.level === 'high', '9.1% is high');
    assert(high.label.indexOf('Sanger') === 0, 'soil name leads the label');
    assert(Engine.readShrinkSwell('4.5').level === 'moderate', '4.5% is moderate');
    assert(Engine.readShrinkSwell(1.2).level === 'low', '1.2% is low');
    assert(Engine.readShrinkSwell(null) === null && Engine.readShrinkSwell('') === null, 'no LEP = no read');
});

// ---- marketTrend: 1004MC-style trailing buckets ----

test('market trend: buckets fill by sale age and direction reads newest vs oldest median', () => {
    const asOf = '2026-08-14';
    const t = Engine.marketTrend([
        { soldDate: '2026-07-20', price: 320000 }, { soldDate: '2026-06-25', price: 324000 },
        { soldDate: '2026-04-01', price: 310000 },
        { soldDate: '2025-11-15', price: 300000 }, { soldDate: '2025-10-01', price: 298000 }
    ], asOf);
    assert(t.buckets[0].count === 2 && t.buckets[1].count === 1 && t.buckets[2].count === 2, 'bucket counts');
    assertNear(t.buckets[0].medianPrice, 322000, 1e-9, 'newest median');
    assertNear(t.buckets[2].medianPrice, 299000, 1e-9, 'oldest median');
    assert(t.direction === 'rising', `+7.7% should read rising, got ${t.direction}`);
});

test('market trend: small deltas read flat; no data reads null, not a fake verdict', () => {
    const asOf = '2026-08-14';
    const flat = Engine.marketTrend([
        { soldDate: '2026-07-20', price: 302000 },
        { soldDate: '2025-10-01', price: 300000 }
    ], asOf);
    assert(flat.direction === 'flat', 'within ±3% is flat');
    const none = Engine.marketTrend([], asOf);
    assert(none.direction === null && none.changePct === null, 'no solds = no verdict');
    const one = Engine.marketTrend([{ soldDate: '2026-07-20', price: 300000 }], asOf);
    assert(one.direction === null, 'a single bucket cannot make a trend');
});

// ---- rentFromComps ----

test('rent from comps: median $/sqft scaled to the subject, rounded to $25', () => {
    const r = Engine.rentFromComps({ sqft: 2000 }, [
        { rent: 2000, sqft: 1600 }, { rent: 2600, sqft: 2000 }, { rent: 2200, sqft: 1800 }
    ]);
    assertNear(r.ppsfMedian, 1.25, 1e-9, 'median $/sqft');
    assert(r.estimate === 2500, 'scaled to subject sqft');
    assert(r.used === 3);
});

test('rent from comps: falls back to median rent without subject sqft; null with nothing usable', () => {
    const r = Engine.rentFromComps({}, [{ rent: 1900 }, { rent: 2100 }, { rent: 2300 }]);
    assert(r.estimate === 2100, 'plain median fallback');
    assert(Engine.rentFromComps({ sqft: 1500 }, []) === null);
    assert(Engine.rentFromComps({ sqft: 1500 }, [{ rent: 0, sqft: 1000 }]) === null);
});

// ---- Rehab reality: estimator, capex flags, draw interest, peak cash ----

test('rehab estimate: sqft × $/sqft + contingency; null when a driver is missing', () => {
    const r = Engine.estimateRehab({ sqft: 1500, perSqft: 42, contingencyPct: 10 });
    assert(r.base === 63000 && r.contingency === 6300 && r.total === 69300, 'medium tier math');
    assert(Engine.estimateRehab({ sqft: 0, perSqft: 42, contingencyPct: 10 }) === null);
    assert(Engine.estimateRehab({ sqft: 1500, perSqft: '', contingencyPct: 10 }) === null);
});

test('capex flags: year-built eras fire the right advisories', () => {
    const all = Engine.capexFlags({ yearBuilt: 1970 });
    assert(all.length === 3, '1970 hits sewer + aluminum + foundation');
    assert(all.find(f => f.key === 'castIronSewer').addToBudget === 15000);
    assert(Engine.capexFlags({ yearBuilt: 1980 }).map(f => f.key).join() === 'foundationWatch', '1980 = foundation only');
    assert(Engine.capexFlags({ yearBuilt: 2005 }).length === 0, 'modern build = clean');
    assert(Engine.capexFlags({}).length === 0, 'no year = no flags');
});

test('draw-based interest carries less than Dutch full-balance interest', () => {
    const dutch = Engine.underwrite({ ...FLIP_BASE, financingType: 'hard_money' });
    const draws = Engine.underwrite({ ...FLIP_BASE, financingType: 'hard_money', interestOnDraws: 'yes' });
    // loan = min(85% × 245k, 75% × 320k) = 208,250; holdback = 45,000
    assertNear(dutch.monthlyFinancingCost, 208250 * 0.105 / 12, 1e-6, 'Dutch: full note');
    assertNear(draws.monthlyFinancingCost, (208250 - 22500) * 0.105 / 12, 1e-6, 'draws: holdback half-drawn on average');
    assert(draws.netProfit > dutch.netProfit, 'cheaper carry raises profit');
});

test('peak cash exposure: cash flip = cash invested; financed adds a fronted draw phase', () => {
    const cash = Engine.underwrite({ ...FLIP_BASE });
    assertNear(cash.peakCashExposure, cash.cashInvested, 1e-9, 'no holdback on a cash deal');
    const hard = Engine.underwrite({ ...FLIP_BASE, financingType: 'hard_money' });
    assertNear(hard.peakCashExposure, hard.cashInvested + 15000, 1e-9, 'one third of the 45k holdback fronted');
});

// ---- maxOffer: back-solve the purchase price from targets ----

test('maxOffer: flip target profit is met at the answer and broken just above it', () => {
    const r = Engine.maxOffer({ ...FLIP_BASE }, { targetProfit: 40000 });
    assert(r.achievable && !r.unbounded, 'achievable and bounded');
    assert(r.maxPrice % 100 === 0, 'rounded to $100');
    assert(r.metricsAtMax.netProfit >= 40000, 'meets the target at the max price');
    const above = Engine.underwrite({ ...FLIP_BASE, purchasePrice: r.maxPrice + 500 });
    assert(above.netProfit < 40000, 'fails just above the max price');
});

test('maxOffer: financed flip prices the full loan model, not an approximation', () => {
    const cash = Engine.maxOffer({ ...FLIP_BASE }, { targetProfit: 30000 });
    const hard = Engine.maxOffer({ ...FLIP_BASE, financingType: 'hard_money' }, { targetProfit: 30000 });
    assert(hard.achievable, 'hard money achievable');
    assert(hard.metricsAtMax.netProfit >= 30000, 'meets target under hard money');
    assert(hard.maxPrice < cash.maxPrice, 'points + carry cost lowers the max offer vs cash');
});

test('maxOffer: rental cash-on-cash floor binds an all-cash buy', () => {
    const r = Engine.maxOffer({ ...RENTAL_BASE }, { minCoC: 8 });
    assert(r.achievable && !r.unbounded, 'achievable and bounded');
    assert(r.metricsAtMax.cocReturn >= 8, 'CoC met at max');
    const above = Engine.underwrite({ ...RENTAL_BASE, purchasePrice: r.maxPrice + 2000 });
    assert(above.cocReturn < 8, 'CoC broken just above the max');
});

test('maxOffer: absurd target reports unachievable, price-independent targets report unbounded', () => {
    assert(Engine.maxOffer({ ...FLIP_BASE }, { targetProfit: 10000000 }).achievable === false);
    // All-cash rental judged only on cash flow: price never touches the metric
    const u = Engine.maxOffer({ ...RENTAL_BASE }, { targetCashFlow: 100 });
    assert(u.unbounded === true, 'unbounded when no provided target depends on price');
});

test('rule of thumb: ARV × rule% − rehab, with the market-flexed suggestion ladder', () => {
    assert(Engine.ruleOfThumbOffer(300000, 40000, 70) === 170000);
    assert(Engine.suggestedRulePct(85) === 75, 'hot');
    assert(Engine.suggestedRulePct(65) === 72, 'warm');
    assert(Engine.suggestedRulePct(50) === 70, 'balanced');
    assert(Engine.suggestedRulePct(25) === 68, 'cool');
    assert(Engine.suggestedRulePct(5) === 65, 'cold');
    assert(Engine.suggestedRulePct(null) === 70, 'unknown market falls back to 70');
});

// ---- projectPropertyTax: TX post-sale reassessment ----

test('tax projection: effective rate from record applied to the new basis', () => {
    const p = Engine.projectPropertyTax({ assessedValue: 300000, annualTaxes: 6000, newBasis: 450000 });
    assertNear(p.effectiveRatePct, 2.0, 1e-9, 'effective rate');
    assert(p.projectedAnnual === 9000, 'projected annual');
    assert(p.projectedMonthly === 750, 'projected monthly');
    assert(p.deltaAnnual === 3000, 'delta vs seller bill');
});

test('tax projection: basis below assessment projects a DECREASE (protest candidate)', () => {
    const p = Engine.projectPropertyTax({ assessedValue: 400000, annualTaxes: 8800, newBasis: 350000 });
    assert(p.projectedAnnual === 7700, 'projected annual down');
    assert(p.deltaAnnual === -1100, 'negative delta');
});

test('tax projection: any missing input yields null, never a phantom', () => {
    assert(Engine.projectPropertyTax({ assessedValue: 0, annualTaxes: 6000, newBasis: 400000 }) === null);
    assert(Engine.projectPropertyTax({ assessedValue: 300000, annualTaxes: '', newBasis: 400000 }) === null);
    assert(Engine.projectPropertyTax({ assessedValue: 300000, annualTaxes: 6000, newBasis: 0 }) === null);
    assert(Engine.projectPropertyTax({}) === null);
});

test('tax projection: garbage inputs are sanitized like every other engine input', () => {
    assert(Engine.projectPropertyTax({ assessedValue: 'abc', annualTaxes: 6000, newBasis: 400000 }) === null);
    const p = Engine.projectPropertyTax({ assessedValue: '300000', annualTaxes: '6000', newBasis: '400000' });
    assert(p !== null && p.projectedAnnual === 8000, 'numeric strings accepted');
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

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

function eq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

// ---- Seller concessions (MLS-only field; URAR grid line 1) ----

test('appraise: concessions come off the price BEFORE the time adjustment', () => {
    const a = Engine.appraise({
        subject: { sqft: 1500, beds: 3, baths: 2 },
        comps: [{ salePrice: 300000, concessions: 10000, sqft: 1500, beds: 3, baths: 2, condition: 'renovated', monthsAgo: 12 }],
        settings: { pricePerSqftAdj: 50, bedAdj: 5000, bathAdj: 7500, conditionAdjPct: { renovated: 0 }, annualAppreciationPct: 6 }
    });
    const c = a.comps[0];
    assertNear(c.adjustments.concessions, -10000, 1e-9, 'concession line');
    assertNear(c.cashEquivalent, 290000, 1e-9, 'cash-equivalent price');
    // 6%/yr × 12 months on the CASH-EQUIVALENT $290k, not the $300k contract
    assertNear(c.adjustments.time, 17400, 1e-9, 'time runs off cash-equivalent');
    assertNear(c.adjustedValue, 300000 - 10000 + 17400, 1e-9, 'net of both lines');
});

test('appraise: percentage adjustments read the concession-netted basis', () => {
    const a = Engine.appraise({
        subject: { sqft: 1500, beds: 3, baths: 2 },
        comps: [{ salePrice: 300000, concessions: 20000, sqft: 1500, beds: 3, baths: 2, condition: 'dated', monthsAgo: 0 }],
        settings: { pricePerSqftAdj: 50, bedAdj: 5000, bathAdj: 7500, conditionAdjPct: { dated: 10 }, annualAppreciationPct: 0 }
    });
    // 10% of $280k, not of $300k
    assertNear(a.comps[0].adjustments.condition, 28000, 1e-9, 'condition % off cash-equivalent');
});

test('appraise: no concessions field leaves every number exactly as before', () => {
    const settings = { pricePerSqftAdj: 50, bedAdj: 5000, bathAdj: 7500, conditionAdjPct: { renovated: 0 }, annualAppreciationPct: 6 };
    const subject = { sqft: 1500, beds: 3, baths: 2 };
    const comp = { salePrice: 300000, sqft: 1500, beds: 3, baths: 2, condition: 'renovated', monthsAgo: 12 };
    const a = Engine.appraise({ subject, comps: [comp], settings });
    const b = Engine.appraise({ subject, comps: [{ ...comp, concessions: 0 }], settings });
    assert(a.comps[0].adjustments.concessions === 0 && b.comps[0].adjustments.concessions === 0, 'zero line');
    assertNear(a.comps[0].adjustedValue, 318000, 1e-9, 'unchanged from the pre-concessions engine');
    assertNear(a.comps[0].adjustedValue, b.comps[0].adjustedValue, 1e-9, 'absent === zero');
    assertNear(a.comps[0].pricePerSqft, 200, 1e-9, '$/sqft unchanged when nothing is conceded');
});

test('appraise: concessions can never exceed the sale price', () => {
    const a = Engine.appraise({
        subject: { sqft: 1500 },
        comps: [{ salePrice: 100000, concessions: 250000, sqft: 1500, condition: 'renovated', monthsAgo: 0 }],
        settings: { pricePerSqftAdj: 50, conditionAdjPct: { renovated: 0 }, annualAppreciationPct: 0 }
    });
    assertNear(a.comps[0].cashEquivalent, 0, 1e-9, 'floored at zero, never negative');
    assertNear(a.comps[0].adjustments.concessions, -100000, 1e-9, 'clamped to the price');
});

test('appraise: $/sqft is quoted cash-equivalent, not contract price', () => {
    const a = Engine.appraise({
        subject: { sqft: 2000 },
        comps: [{ salePrice: 400000, concessions: 20000, sqft: 2000, condition: 'renovated', monthsAgo: 0 }],
        settings: { pricePerSqftAdj: 50, conditionAdjPct: { renovated: 0 }, annualAppreciationPct: 0 }
    });
    assertNear(a.comps[0].pricePerSqft, 190, 1e-9, '$380k / 2000 sqft');
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

test('classify: a structured MLS PropertyCondition outranks the remarks read', () => {
    // The agent coded "Fixer"; the marketing copy still gushes. The field wins.
    const r = Engine.classifyCondition('Beautifully updated throughout!', 'Fixer');
    assert(r.condition === 'dated', `expected dated, got ${r.condition}`);
    assert(r.from === 'field', 'evidence attributed to the field');
    assert(r.evidence === 'Fixer', 'evidence quotes the coded value');
});

test('classify: multi-value PropertyCondition takes the strongest signal', () => {
    assert(Engine.classifyCondition(null, 'Updated/Remodeled, Resale').condition === 'renovated');
    assert(Engine.classifyCondition(null, 'Resale').condition === 'average');
    assert(Engine.classifyCondition(null, 'New Construction').condition === 'renovated');
});

test('classify: an unrecognized PropertyCondition falls through to remarks', () => {
    const r = Engine.classifyCondition('Sold as-is, investor special', 'Unknown');
    assert(r.condition === 'dated' && r.from === 'remarks', 'remarks still read');
    assert(Engine.classifyCondition(null, 'Unknown') === null, 'no field signal, no text = null');
});

test('classify: remarks-only reads are attributed to remarks', () => {
    assert(Engine.classifyCondition('Completely remodeled in 2024').from === 'remarks');
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

test('market trend: days-on-market medians ride along when the feed carries them', () => {
    const asOf = '2026-08-14';
    const t = Engine.marketTrend([
        { soldDate: '2026-07-20', price: 320000, dom: 9 }, { soldDate: '2026-06-25', price: 324000, dom: 15 },
        { soldDate: '2025-11-15', price: 300000, dom: 61 }
    ], asOf);
    assertNear(t.buckets[0].medianDom, 12, 1e-9, 'newest bucket DOM median');
    assertNear(t.buckets[2].medianDom, 61, 1e-9, 'oldest bucket DOM median');
    assertNear(t.medianDom, 15, 1e-9, 'trailing-year DOM median');
});

test('market trend: scraped solds with no DOM leave the DOM read null, never zero', () => {
    const t = Engine.marketTrend([
        { soldDate: '2026-07-20', price: 320000 }, { soldDate: '2025-11-15', price: 300000 }
    ], '2026-08-14');
    assert(t.medianDom === null, 'no DOM data = null');
    assert(t.buckets.every(b => b.medianDom === null), 'no phantom zeros in the buckets');
});

// ---- deriveMarketRates: the adjustment rate comes from the market ----
// The static $50/sqft default was a national rule of thumb. In a $300/sqft
// market it under-corrects every size difference by tens of thousands, always
// in the same direction, and no amount of careful ranking recovers from that.

test('derive: a real Fort Worth 76109 set yields a rate near half its $/sqft', () => {
    // Verbatim from the live NTREIS feed, 2026-08-27
    const r = Engine.deriveMarketRates([
        { salePrice: 775000, sqft: 2304 }, { salePrice: 495000, sqft: 1845 },
        { salePrice: 667500, sqft: 2278 }, { salePrice: 415000, sqft: 2204 },
        { salePrice: 426500, sqft: 1314 }, { salePrice: 550000, sqft: 2474 },
        { salePrice: 1275000, sqft: 3130 }, { salePrice: 1015000, sqft: 3197 },
        { salePrice: 1175000, sqft: 3583 }, { salePrice: 1550000, sqft: 3069 }
    ]);
    assert(r.medianPricePerSqft > 300 && r.medianPricePerSqft < 340, 'median $/sqft: ' + r.medianPricePerSqft);
    assert(r.pricePerSqftAdj > 120 && r.pricePerSqftAdj < 180,
        'derived GLA rate should land near half the market rate, got ' + r.pricePerSqftAdj);
    assert(r.pricePerSqftAdj > 50 * 2, 'and far above the old $50 default');
    assert(r.used === 10);
});

test('derive: too few usable comps returns null rather than inventing a rate', () => {
    assert(Engine.deriveMarketRates([]) === null);
    assert(Engine.deriveMarketRates([{ salePrice: 400000, sqft: 2000 }]) === null);
    assert(Engine.deriveMarketRates(null) === null);
    // priced but sizeless comps teach nothing about the value of a square foot
    assert(Engine.deriveMarketRates([
        { salePrice: 400000 }, { salePrice: 500000 }, { salePrice: 600000 }
    ]) === null);
});

test('derive: a clean linear market is read by regression, not the fallback', () => {
    // Same $/sqft throughout with a fixed lot component: slope is exactly 200
    const comps = [1200, 1500, 1800, 2100, 2400, 2700].map(sqft => ({
        salePrice: 100000 + sqft * 200, sqft
    }));
    const r = Engine.deriveMarketRates(comps);
    assert(r.method === 'regression', 'expected regression, got ' + r.method);
    assertNear(r.pricePerSqftAdj, 200, 1, 'slope recovered');
    assert(r.rSquared > 0.99, 'a perfect line: ' + r.rSquared);
});

test('derive: a slope inflated by confounders is REJECTED for the fraction', () => {
    // Bigger houses here are also newer and nicer, so the slope measures
    // "size plus everything correlated with size" and overstates the value of
    // a square foot. The band catches it.
    const comps = [
        { salePrice: 300000, sqft: 1500 }, { salePrice: 350000, sqft: 1600 },
        { salePrice: 420000, sqft: 1700 }, { salePrice: 900000, sqft: 2400 },
        { salePrice: 1100000, sqft: 2600 }, { salePrice: 1400000, sqft: 2900 }
    ];
    const r = Engine.deriveMarketRates(comps);
    assert(r.method === 'fraction', 'a runaway slope must not be trusted: ' + JSON.stringify(r));
    assert(r.pricePerSqftAdj <= r.medianPricePerSqft * 0.9, 'clamped under the ceiling');
});

test('derive: a negative or nonsense slope never escapes as a rate', () => {
    // Price falling as size rises — condition, not area, separated these sales
    const comps = [
        { salePrice: 900000, sqft: 1200 }, { salePrice: 800000, sqft: 1500 },
        { salePrice: 700000, sqft: 1800 }, { salePrice: 600000, sqft: 2100 },
        { salePrice: 500000, sqft: 2400 }, { salePrice: 400000, sqft: 2700 }
    ];
    const r = Engine.deriveMarketRates(comps);
    assert(r.method === 'fraction', 'negative slope rejected');
    assert(r.pricePerSqftAdj > 0, 'and the rate is still positive: ' + r.pricePerSqftAdj);
});

test('derive: the rate is always inside a defensible band of the median', () => {
    const comps = [1000, 1400, 1800, 2200, 2600, 3000].map((sqft, i) => ({
        salePrice: [250000, 700000, 400000, 1200000, 500000, 900000][i], sqft
    }));
    const r = Engine.deriveMarketRates(comps);
    assert(r.pricePerSqftAdj >= r.medianPricePerSqft * 0.20, 'not below the floor');
    assert(r.pricePerSqftAdj <= r.medianPricePerSqft * 0.90, 'not above the ceiling');
});

// ---- Time adjustment: derived, and anchored where the price was agreed ----

test('time: the price was agreed at CONTRACT, about a month before closing', () => {
    // Measured across 298 NTREIS sales: median contract-to-close lag 30 days.
    // Anchoring on the close date is late by that much on every comp, always
    // in the same direction.
    const agreed = Engine.priceAgreedAt({ closeDate: '2026-06-30', contractDate: '2026-05-30' });
    eq(new Date(agreed).toISOString().slice(0, 10), '2026-05-30');
});

test('time: a missing contract date falls back to close minus a typical lag', () => {
    const agreed = Engine.priceAgreedAt({ closeDate: '2026-06-30' });
    eq(new Date(agreed).toISOString().slice(0, 10), '2026-05-31', '30 days before closing');
});

test('time: an implausible lag is pre-construction, not a market observation', () => {
    // Real row from the feed: contracted 2023-10-17, closed 2026-07-31
    const agreed = Engine.priceAgreedAt({ closeDate: '2026-07-31', contractDate: '2023-10-17' });
    eq(new Date(agreed).toISOString().slice(0, 10), '2026-07-01', 'ignored, typical lag used');
});

test('time: comp age is measured to the valuation date, never negative', () => {
    assertNear(Engine.compMonthsAgo({ closeDate: '2026-02-27', contractDate: '2026-01-28' }, '2026-07-28'),
        6, 0.2, 'six months since the price was agreed');
    eq(Engine.compMonthsAgo({ closeDate: '2027-01-01' }, '2026-01-01'), 0, 'a future comp is not negative');
});

test('time: a clean 8%/yr market is recovered from noisy sales', () => {
    const asOf = '2026-08-27';
    const g = Math.log(1.08) / 12;
    const sales = [];
    for (let i = 0; i < 300; i++) {
        const monthsAgo = (i % 18) + 0.5;
        const sqft = 1400 + ((i * 37) % 900);
        const ppsf = 200 * Math.exp(-g * monthsAgo) * (1 + (((i * 7919) % 100) - 50) / 500);
        const close = new Date(Date.parse(asOf) - monthsAgo * 30.44 * 86400000).toISOString().slice(0, 10);
        sales.push({ price: Math.round(ppsf * sqft), sqft, closeDate: close, contractDate: close });
    }
    const t = Engine.deriveTimeAdjustment(sales, asOf);
    assert(t.usable === true, 'a real trend is usable: ' + JSON.stringify(t));
    assertNear(t.annualPct, 8, 1.5, 'rate recovered');
    assert(t.ci95[0] < 8 && t.ci95[1] > 8, 'interval brackets the truth');
});

test('time: a wide confidence interval is reported FLAT, not as its midpoint', () => {
    // The failure this guards against, seen live: 300 real Fort Worth sales
    // fitted -25%/yr at an R-squared of 0.019 because the raw scatter let a
    // few unusual houses set the slope. Applying that midpoint to a year-old
    // comp would have turned pure noise into tens of thousands of dollars.
    const asOf = '2026-08-27';
    const sales = [];
    for (let i = 0; i < 300; i++) {
        const monthsAgo = (i % 18) + 0.5;
        const sqft = 1400 + ((i * 37) % 900);
        // price per foot swings wildly and independently of time
        const ppsf = 200 * (1 + (((i * 104729) % 100) - 50) / 60);
        const close = new Date(Date.parse(asOf) - monthsAgo * 30.44 * 86400000).toISOString().slice(0, 10);
        sales.push({ price: Math.round(ppsf * sqft), sqft, closeDate: close, contractDate: close });
    }
    const t = Engine.deriveTimeAdjustment(sales, asOf);
    assert(t.usable === false, 'must not be trusted: ' + JSON.stringify(t));
    eq(t.annualPct, 0, 'applied rate is zero');
    assert(t.rawAnnualPct !== 0, 'while still reporting what it fitted, for the record');
});

test('time: too little history returns null rather than a rate', () => {
    assert(Engine.deriveTimeAdjustment([], '2026-08-27') === null);
    const twoMonths = [];
    for (let i = 0; i < 40; i++) {
        twoMonths.push({ price: 300000, sqft: 1500, closeDate: '2026-08-0' + (1 + i % 9) });
    }
    assert(Engine.deriveTimeAdjustment(twoMonths, '2026-08-27') === null, 'one month is not a trend');
});

// ---- valuationInterval: the uncertainty gets stated, not hidden ----

test('interval: a tight comp set earns a narrow band and high confidence', () => {
    const r = Engine.valuationInterval(
        { arv: 400000, spreadPct: 3.2, comps: [6, 8, 5, 9, 7].map(g => ({ grossAdjPct: g })) },
        { pricePerSqftSpreadPct: 18, unverifiedComps: 0 });
    eq(r.confidence, 'high');
    assert(r.sigmaPct <= 8, 'narrow: ' + r.sigmaPct);
    assert(r.low < 400000 && r.high > 400000, 'brackets the estimate');
});

test('interval: a messy set widens and NAMES every reason', () => {
    // Pleasant Grove measured 31% MdAPE against Fort Worth southeast at 5.6%.
    // The engine can see why; it should say so instead of presenting both the
    // same way.
    const r = Engine.valuationInterval(
        { arv: 400000, spreadPct: 14, comps: [28, 31, 22].map(g => ({ grossAdjPct: g })) },
        { pricePerSqftSpreadPct: 62, unverifiedComps: 2, trendUnusable: true });
    eq(r.confidence, 'low');
    assert(r.sigmaPct >= 25, 'wide: ' + r.sigmaPct);
    assert(r.drivers.length >= 4, 'reasons given: ' + JSON.stringify(r.drivers));
    assert(r.drivers.some(d => /\$\/sqft varies/.test(d)), 'local dispersion named');
    assert(r.drivers.some(d => /unverified condition/.test(d)), 'condition named');
});

test('interval: the band never claims more precision than an appraiser does', () => {
    // A flawless-looking comp set is still a house, not a share price
    const r = Engine.valuationInterval(
        { arv: 500000, spreadPct: 0, comps: [{ grossAdjPct: 1 }, { grossAdjPct: 1 }, { grossAdjPct: 1 },
            { grossAdjPct: 1 }, { grossAdjPct: 1 }, { grossAdjPct: 1 }] },
        { pricePerSqftSpreadPct: 5, unverifiedComps: 0 });
    assert(r.sigmaPct >= 6, 'floored at 6%: ' + r.sigmaPct);
});

test('interval: thin evidence widens the band on its own', () => {
    const base = { arv: 400000, spreadPct: 5 };
    const many = Engine.valuationInterval({ ...base, comps: Array.from({ length: 6 }, () => ({ grossAdjPct: 8 })) }, {});
    const few = Engine.valuationInterval({ ...base, comps: [{ grossAdjPct: 8 }, { grossAdjPct: 8 }, { grossAdjPct: 8 }] }, {});
    assert(few.sigmaPct > many.sigmaPct, 'three comps is less certain than six');
    assert(few.drivers.some(d => /only 3 comps/.test(d)));
});

test('interval: the tier is flagged uncalibrated until it earns its ranking', () => {
    // Measured on 84 closed sales: the band WIDTH is about right (77.4%
    // coverage against a 68% target) but the tiers rank backwards — deals
    // labelled low came in at 7.4% MdAPE against 10.4% for high. The engine
    // says so rather than letting the UI present a misleading word.
    const r = Engine.valuationInterval({ arv: 400000, spreadPct: 5, comps: [{ grossAdjPct: 8 }] }, {});
    eq(r.tierIsCalibrated, false, 'the tier must not be presented as trustworthy');
    assert(typeof r.sigmaPct === 'number', 'the width itself is measured and usable');
});

test('interval: no ARV means no interval, not a band around zero', () => {
    assert(Engine.valuationInterval({ arv: 0, comps: [] }, {}) === null);
    assert(Engine.valuationInterval(null, {}) === null);
});

// ---- backtestMetrics: the panel, because MdAPE alone hides failures ----

test('backtest: a perfect estimator scores perfectly on every statistic', () => {
    const rows = [300000, 450000, 600000, 800000, 1000000, 250000].map(v => ({ estimate: v, actual: v }));
    const m = Engine.backtestMetrics(rows);
    assertNear(m.medianRatio, 1, 1e-9);
    assertNear(m.mdape, 0, 1e-9);
    assert(m.pe10 === 100 && m.pe20 === 100);
    assertNear(m.cod, 0, 1e-9);
    assertNear(m.prd, 1, 1e-9);
    assert(m.overBy20Pct === 0 && m.underBy20Pct === 0);
});

test('backtest: a uniform bias moves the ratio but NOT the dispersion', () => {
    // This is why median ratio and COD are both reported: one catches level,
    // the other catches spread, and a model can fail either independently.
    const rows = [300000, 450000, 600000, 800000].map(v => ({ estimate: v * 1.1, actual: v }));
    const m = Engine.backtestMetrics(rows);
    assertNear(m.medianRatio, 1.1, 1e-9, 'level is off by 10%');
    assertNear(m.cod, 0, 1e-9, 'but every estimate is off by the SAME 10%');
    assertNear(m.mdape, 10, 1e-9);
    assertNear(m.medianSignedError, 10, 1e-9, 'signed error exposes the direction');
});

test('backtest: the over/under split is asymmetric, as an underwriter needs', () => {
    const rows = [
        { estimate: 130, actual: 100 },  // +30% — bought a bad deal
        { estimate: 125, actual: 100 },  // +25%
        { estimate: 100, actual: 100 },
        { estimate: 70, actual: 100 }    // −30% — only passed on a good one
    ];
    const m = Engine.backtestMetrics(rows);
    eq(m.overBy20Pct, 50, 'half the set over-valued by >20%');
    eq(m.underBy20Pct, 25);
});

test('backtest: PRB catches price-tier drift that MdAPE cannot see', () => {
    // Over-values cheap houses, under-values expensive ones. The absolute
    // errors are symmetric so MdAPE looks respectable and the model is broken.
    const rows = [
        { estimate: 120000, actual: 100000 }, { estimate: 230000, actual: 200000 },
        { estimate: 420000, actual: 400000 }, { estimate: 780000, actual: 800000 },
        { estimate: 1450000, actual: 1600000 }, { estimate: 2750000, actual: 3200000 }
    ];
    const m = Engine.backtestMetrics(rows);
    assert(m.prb !== null, 'PRB computed');
    assert(m.prb < -0.05, 'negative drift with price is detected: ' + m.prb);
});

test('backtest: the median CI width shrinks with n and is reported honestly', () => {
    const make = (n) => Array.from({ length: n }, (_, i) => ({ estimate: 100 + i, actual: 100 }));
    // 98/sqrt(n) percentile points — at n=100 the median is only pinned
    // between the 40th and 60th percentile of the error distribution
    assertNear(Engine.backtestMetrics(make(100)).medianCiPercentilePoints, 9.8, 0.1);
    assertNear(Engine.backtestMetrics(make(400)).medianCiPercentilePoints, 4.9, 0.1);
});

test('backtest: no usable pairs returns null rather than a flattering zero', () => {
    assert(Engine.backtestMetrics([]) === null);
    assert(Engine.backtestMetrics([{ estimate: 0, actual: 100 }]) === null);
    assert(Engine.backtestMetrics(null) === null);
});

// ---- pairedComparison: the small-sample workhorse ----

test('paired: a consistent improvement is detected on a handful of sales', () => {
    // Between-property variance dominates two independent MdAPEs; comparing
    // per-sale differences sees the same effect with far fewer rows.
    const a = [], b = [];
    for (let i = 0; i < 20; i++) {
        const actual = 300000 + i * 10000;
        a.push({ id: 'p' + i, estimate: actual * 1.12, actual });  // 12% off
        b.push({ id: 'p' + i, estimate: actual * 1.04, actual });  // 4% off
    }
    const r = Engine.pairedComparison(a, b);
    eq(r.n, 20);
    eq(r.bWins, 20, 'B closer on every single sale');
    assert(r.significant === true, 'sign test fires');
    assert(r.verdict === 'B is better', r.verdict);
    assert(r.medianImprovementPct > 7, 'about 8 points better: ' + r.medianImprovementPct);
});

test('paired: noise is reported as no difference, not as a win', () => {
    const a = [], b = [];
    for (let i = 0; i < 20; i++) {
        const actual = 400000;
        // alternating, equal magnitude — genuinely a coin flip
        a.push({ id: 'p' + i, estimate: actual * (i % 2 ? 1.05 : 0.95), actual });
        b.push({ id: 'p' + i, estimate: actual * (i % 2 ? 0.95 : 1.05), actual });
    }
    const r = Engine.pairedComparison(a, b);
    assert(r.significant === false, 'must not claim a winner');
    assert(/no significant difference|too few/.test(r.verdict), r.verdict);
});

test('paired: too few decisive pairs refuses to call it', () => {
    const a = [{ id: 'x', estimate: 110, actual: 100 }, { id: 'y', estimate: 120, actual: 100 }];
    const b = [{ id: 'x', estimate: 105, actual: 100 }, { id: 'y', estimate: 115, actual: 100 }];
    const r = Engine.pairedComparison(a, b);
    eq(r.n, 2);
    assert(r.significant === false);
    assert(r.verdict === 'too few decisive pairs to call', r.verdict);
});

test('paired: only sales scored by BOTH variants are compared', () => {
    const a = [{ id: 'x', estimate: 110, actual: 100 }, { id: 'orphan', estimate: 200, actual: 100 }];
    const b = [{ id: 'x', estimate: 105, actual: 100 }];
    eq(Engine.pairedComparison(a, b).n, 1, 'the unpaired sale is dropped, not counted');
});

test('paired: the bootstrap interval is deterministic across runs', () => {
    const a = [], b = [];
    for (let i = 0; i < 15; i++) {
        const actual = 350000 + i * 5000;
        a.push({ id: 'p' + i, estimate: actual * 1.10, actual });
        b.push({ id: 'p' + i, estimate: actual * 1.03, actual });
    }
    const r1 = Engine.pairedComparison(a, b);
    const r2 = Engine.pairedComparison(a, b);
    eq(r1.ci95[0], r2.ci95[0], 'same inputs, same interval — a result must reproduce');
    eq(r1.ci95[1], r2.ci95[1]);
});

// ---- scoreComp: the ranking, now shared with the back-test ----

test('score: a near-twin beats a bigger, closer house', () => {
    // The failure that started the rework: a 1,845 sqft comp lost to a 2,304
    // sqft one because 70 of 100 points were location and time.
    const subject = { sqft: 1842, beds: 3, baths: 2, yearBuilt: 1948 };
    const twin = { sqft: 1845, beds: 3, baths: 2, yearBuilt: 1939, distanceMi: 0.79, soldDate: '2026-06-26' };
    const bigger = { sqft: 2304, beds: 3, baths: 3, yearBuilt: 1940, distanceMi: 0.53, soldDate: '2026-06-26' };
    const asOf = '2026-08-27';
    assert(Engine.scoreComp(subject, twin, asOf) > Engine.scoreComp(subject, bigger, asOf),
        'the three-foot twin must win despite being further away');
});

test('score: comps are aged against the as-of date, not today', () => {
    const subject = { sqft: 1800, beds: 3, baths: 2, yearBuilt: 1950 };
    const comp = { sqft: 1800, beds: 3, baths: 2, yearBuilt: 1950, distanceMi: 0.5, soldDate: '2024-01-15' };
    // Fresh relative to a 2024 test sale; stale relative to today
    assert(Engine.scoreComp(subject, comp, '2024-03-01') > Engine.scoreComp(subject, comp, '2026-08-27'),
        'a back-test must not penalise a comp for being old NOW');
});

test('score: a condo is gated out of a house comp set at any distance', () => {
    const subject = { sqft: 1800, beds: 3, baths: 2, yearBuilt: 1950 };
    const base = { sqft: 1800, beds: 3, baths: 2, yearBuilt: 1950, distanceMi: 0.05, soldDate: '2026-06-01' };
    const condo = { ...base, propType: 'Condominium' };
    assert(Engine.scoreComp(subject, condo) < Engine.scoreComp(subject, base) * 0.5, 'heavily gated');
});

test('score: a price-per-foot outlier is halved — different segment, not a comp', () => {
    const subject = { sqft: 1800, beds: 3, baths: 2, yearBuilt: 1950 };
    const base = { sqft: 1800, beds: 3, baths: 2, yearBuilt: 1950, distanceMi: 0.4, soldDate: '2026-06-01' };
    assertNear(Engine.scoreComp(subject, { ...base, ppsfOutlier: true }),
        Engine.scoreComp(subject, base) * 0.5, 1.5, 'halved');
});

// ---- reconcileCondition: the sale price overrules the marketing copy ----

test('reconcile: "as-is" is NOT dated when the comp sold above the market rate', () => {
    // Live case, 2026-08-27: 3217 Chaparral Lane sold at $373/sqft in a
    // $317/sqft market. "as-is" in the remarks made the grid call it dated
    // and add $140,700 — the largest line in the whole appraisal.
    const read = Engine.classifyCondition('Charming home sold as-is');
    assert(read.condition === 'dated', 'the text read stands on its own');
    const r = Engine.reconcileCondition(read, 17.7);
    assert(r.trusted === false, 'but the price contradicts it');
    assert(/ABOVE the market rate/.test(r.conflict), 'and says why: ' + r.conflict);
});

test('reconcile: "as-is" IS dated when the price agrees', () => {
    const read = Engine.classifyCondition('Investor special, needs work');
    const r = Engine.reconcileCondition(read, -32);
    assert(r.trusted === true, 'selling 32% under the market rate corroborates it');
    assert(r.condition === 'dated');
    assert(!r.conflict);
});

test('reconcile: a "renovated" read selling far under the market is also flagged', () => {
    const read = Engine.classifyCondition('Completely remodeled throughout');
    assert(Engine.reconcileCondition(read, -5).trusted === true, 'slightly under is normal');
    const r = Engine.reconcileCondition(read, -30);
    assert(r.trusted === false, '30% under the market rate is not a renovated house');
    assert(/BELOW the market rate/.test(r.conflict));
});

test('reconcile: it never silently substitutes the opposite condition', () => {
    // A price gap can be lot, street or motivation rather than condition —
    // the honest move is "unverified", not a confident flip to the other side
    const read = Engine.classifyCondition('Sold as-is');
    const r = Engine.reconcileCondition(read, 20);
    assert(r.condition === 'dated', 'the original read is preserved for display');
    assert(r.trusted === false, 'but not trusted, so the caller leaves it unverified');
});

test('reconcile: with no price signal the text read is used unchanged', () => {
    const read = Engine.classifyCondition('Sold as-is');
    assert(Engine.reconcileCondition(read, null).trusted === true);
    assert(Engine.reconcileCondition(read, undefined).trusted === true);
    assert(Engine.reconcileCondition(null, 20) === null, 'no read, nothing to reconcile');
});

test('reconcile: an "average" read is left alone — it carries a small adjustment', () => {
    const read = Engine.classifyCondition('Updated kitchen with granite');
    assert(read.condition === 'average');
    assert(Engine.reconcileCondition(read, 30).trusted === true);
    assert(Engine.reconcileCondition(read, -30).trusted === true);
});

// ---- pricePerSqftOutliers: say the segment mismatch out loud ----

test('outliers: the new-build at $505/sqft in a $270 street is flagged', () => {
    const rows = Engine.pricePerSqftOutliers([
        { label: 'A', salePrice: 495000, sqft: 1845 },   // $268
        { label: 'B', salePrice: 550000, sqft: 2474 },   // $222
        { label: 'C', salePrice: 775000, sqft: 2304 },   // $336
        { label: 'D', salePrice: 1550000, sqft: 3069 }   // $505 — different segment
    ]);
    const d = rows.find(r => r.label === 'D');
    assert(d.outlier === true, 'the $505/sqft new build is flagged: ' + JSON.stringify(d));
    assert(rows.find(r => r.label === 'A').outlier === false, 'the near-twin is not');
    assert(d.pricePerSqft === 505, 'reports the actual figure');
});

test('outliers: too small a set makes no claims', () => {
    assert(Engine.pricePerSqftOutliers([{ label: 'A', salePrice: 400000, sqft: 2000 }]).length === 0);
    assert(Engine.pricePerSqftOutliers([]).length === 0);
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
    assert(r.basis === 'listed', 'no closed leases = listed basis');
    assert(Engine.rentFromComps({ sqft: 1500 }, []) === null);
    assert(Engine.rentFromComps({ sqft: 1500 }, [{ rent: 0, sqft: 1000 }]) === null);
});

test('rent from comps: closed MLS leases DISPLACE asking rents, never average with them', () => {
    const r = Engine.rentFromComps({}, [
        { rent: 2000, status: 'closed' }, { rent: 2100, status: 'closed' }, { rent: 2200, status: 'closed' },
        { rent: 3400 }, { rent: 3600 }, { rent: 3800 } // wishful asks, must not count
    ]);
    assert(r.estimate === 2100, `closed median only, got ${r.estimate}`);
    assert(r.used === 3, 'only the closed leases were used');
    assert(r.basis === 'closed', 'basis labeled closed');
});

test('rent from comps: closed-lease $/sqft also scales to the subject', () => {
    const r = Engine.rentFromComps({ sqft: 2000 }, [
        { rent: 2000, sqft: 1600, status: 'closed' }, { rent: 2600, sqft: 2000, status: 'closed' },
        { rent: 2200, sqft: 1800, status: 'closed' }, { rent: 9000, sqft: 1800 }
    ]);
    assertNear(r.ppsfMedian, 1.25, 1e-9, 'closed-only median $/sqft');
    assert(r.estimate === 2500 && r.basis === 'closed');
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

// ---- Flip carrying costs, exit stack, and the ARV cap ----

test('flip carry: a supplied taxes figure is used; blank falls back to the baseline', () => {
    const blank = Engine.underwrite(FLIP_BASE);
    eq(blank.baselineMonthlyCarry, Engine.DEFAULTS.flipBaselineMonthlyCarry, 'blank uses baseline');
    const supplied = Engine.underwrite({ ...FLIP_BASE, monthlyTaxesIns: 767 });
    eq(supplied.baselineMonthlyCarry, 767, 'supplied figure wins');
    // 6 months × ($767 − $300) of carry that used to be silently discarded
    assertNear(supplied.totalHoldingCarryingCosts - blank.totalHoldingCarryingCosts,
        (767 - 300) * 6, 0.01, 'extra carry');
    assertNear(blank.netProfit - supplied.netProfit, (767 - 300) * 6, 0.01, 'profit falls by the carry');
});

test('flip carry: an explicit zero is honoured, not treated as missing', () => {
    const m = Engine.underwrite({ ...FLIP_BASE, monthlyTaxesIns: 0 });
    eq(m.baselineMonthlyCarry, 0, 'explicit 0 means 0');
    eq(m.totalHoldingCarryingCosts, 0, 'cash deal with no carry costs nothing to hold');
});

test('flip carry: insurance alone also displaces the baseline', () => {
    const m = Engine.underwrite({ ...FLIP_BASE, monthlyInsurance: 210 });
    eq(m.baselineMonthlyCarry, 210, 'insurance-only still counts as supplied');
});

test('selling cost: percent overrides the 8% default; blank is bit-identical', () => {
    const def = Engine.underwrite(FLIP_BASE);
    eq(def.sellingCostRatio, Engine.DEFAULTS.flipSellingCostRate, 'blank keeps the constant');
    assertNear(def.sellingRefiCosts, 320000 * 0.08, 0.01, 'default exit stack');
    const agent = Engine.underwrite({ ...FLIP_BASE, sellingCostPercent: 5.5 });
    assertNear(agent.sellingRefiCosts, 320000 * 0.055, 0.01, 'agent exit stack');
    assertNear(agent.netProfit - def.netProfit, 320000 * 0.025, 0.01, 'the gap is pure profit');
});

test('selling cost: zero percent is honoured (a private off-market sale)', () => {
    const m = Engine.underwrite({ ...FLIP_BASE, sellingCostPercent: 0 });
    eq(m.sellingRefiCosts, 0, 'no exit stack');
});

test('hard money: the ARV cap binds and reports the shortfall it creates', () => {
    // 85% of ($260k + $90k) = $297.5k asked, but 75% of a $320k ARV is $240k
    const capped = Engine.underwrite({
        ...FLIP_BASE, financingType: 'hard_money',
        purchasePrice: 260000, rehabBudget: 90000
    });
    eq(capped.bindingConstraint, 'ltarv', 'the ARV ceiling is what sized the loan');
    assertNear(capped.loanAmount, 240000, 1, 'loan sized by ARV cap');
    assertNear(capped.capShortfall, (260000 + 90000) * 0.85 - 240000, 1, 'shortfall stated');
    // The same deal where cost is the binding side reports no shortfall
    const byCost = Engine.underwrite({ ...FLIP_BASE, financingType: 'hard_money' });
    eq(byCost.bindingConstraint, 'ltc', 'cost binds on a normal deal');
    eq(byCost.capShortfall, 0, 'nothing withheld');
});

test('hard money: the ARV cap percentage is overridable', () => {
    const m = Engine.underwrite({
        ...FLIP_BASE, financingType: 'hard_money',
        purchasePrice: 260000, rehabBudget: 90000, arvCapPercent: 70
    });
    assertNear(m.loanAmount, 320000 * 0.70, 1, 'a 70% lender lends less');
});

// ---- DSCR: the analyst ratio and the lender ratio are different numbers ----

test('lender DSCR is gross rent over PITIA, not NOI over debt service', () => {
    const m = Engine.underwrite({
        ...RENTAL_BASE, financingType: 'dscr_purchase',
        monthlyTaxesIns: 400, monthlyInsurance: 150
    });
    const pi = Engine.calcAmortizedPayment(200000 * 0.75, 7.5);
    assertNear(m.pitia, pi + 550, 0.01, 'PITIA = P&I + taxes + insurance');
    assertNear(m.lenderDscr, 2200 / (pi + 550), 0.0001, 'gross rent over PITIA');
    // The analyst ratio strips vacancy and opex first, so it is much lower —
    // this gap is the whole point of reporting both.
    assert(m.dscrRatio < m.lenderDscr, 'NOI coverage sits below the lender ratio');
    assertNear(m.dscrRatio, m.netOperatingIncome / m.monthlyDebtService, 0.0001, 'analyst ratio unchanged');
});

test('lender DSCR is null when there is no note to cover', () => {
    const m = Engine.underwrite({ ...RENTAL_BASE, financingType: 'cash' });
    eq(m.lenderDscr, null, 'an all-cash hold has no lender ratio');
    eq(m.dscrRatio, Infinity, 'analyst coverage is still unbounded');
});

test('insurance is a real cost: it leaves NOI and cash flow, not just a label', () => {
    const without = Engine.underwrite(RENTAL_BASE);
    const withIns = Engine.underwrite({ ...RENTAL_BASE, monthlyInsurance: 175 });
    assertNear(without.netOperatingIncome - withIns.netOperatingIncome, 175, 0.01, 'NOI drops');
    assertNear(without.monthlyCashFlow - withIns.monthlyCashFlow, 175, 0.01, 'cash flow drops');
    eq(withIns.monthlyOwnershipCost, 525, 'taxes + insurance reported together');
    // Folding it into the old single field gives the identical answer
    const folded = Engine.underwrite({ ...RENTAL_BASE, monthlyTaxesIns: 525 });
    assertNear(folded.monthlyCashFlow, withIns.monthlyCashFlow, 0.01, 'split or folded, same total');
});

// ---- Break-even ----

test('break-even flip: selling the answer nets exactly zero', () => {
    const b = Engine.breakEven(FLIP_BASE);
    assert(b.salePrice > 0, 'a break-even price exists');
    const at = Engine.underwrite({ ...FLIP_BASE, arv: b.salePrice, variancePercent: 0 });
    assert(at.netProfit >= 0 && at.netProfit < 400, 'nets ~zero at the answer, rounded up to $100');
    const under = Engine.underwrite({ ...FLIP_BASE, arv: b.salePrice - 2000, variancePercent: 0 });
    assert(under.netProfit < 0, 'below it the deal loses money');
});

test('break-even flip: it is NOT total costs — the exit stack is grossed up', () => {
    const m = Engine.underwrite(FLIP_BASE);
    const b = Engine.breakEven(FLIP_BASE);
    // The naive answer everyone reaches for first
    assert(b.salePrice > m.totalProjectCosts, 'must clear costs AND the cost of selling');
    assertNear(b.salePrice, m.totalProjectCosts / (1 - 0.08), 150, 'grossed up by the exit rate');
});

test('break-even flip: a cheaper exit stack lowers the price you must hit', () => {
    const def = Engine.breakEven(FLIP_BASE);
    const agent = Engine.breakEven({ ...FLIP_BASE, sellingCostPercent: 5 });
    assert(agent.salePrice < def.salePrice, 'self-listing lowers the bar');
});

test('break-even rental: the rent floors for cash flow and for the lender', () => {
    const inputs = { ...RENTAL_BASE, financingType: 'dscr_purchase', monthlyInsurance: 150 };
    const b = Engine.breakEven(inputs);
    assert(b.monthlyRent > 0, 'a cash-flow break-even rent exists');
    const at = Engine.underwrite({ ...inputs, monthlyRent: b.monthlyRent });
    assert(at.monthlyCashFlow >= 0, 'flat or better at the answer');
    const under = Engine.underwrite({ ...inputs, monthlyRent: b.monthlyRent - 25 });
    assert(under.monthlyCashFlow < 0, 'below it the hold bleeds');
    eq(b.dscrFloor, 1.25, 'default lender floor');
    const atDscr = Engine.underwrite({ ...inputs, monthlyRent: b.rentAtDscrFloor });
    assert(atDscr.lenderDscr >= 1.25, 'the DSCR floor is met at its answer');
});

test('break-even rental: no note means no DSCR floor to report', () => {
    const b = Engine.breakEven(RENTAL_BASE);
    eq(b.rentAtDscrFloor, null, 'nothing to cover');
    eq(b.dscrFloor, null, 'and no floor is claimed');
});

// ---- Bracketing ----

test('bracketing: a set that surrounds the subject reports no defect', () => {
    const subject = { sqft: 1500, beds: 3, lotSqft: 7000, yearBuilt: 1980 };
    const comps = [
        { salePrice: 300000, sqft: 1400, beds: 3, lotSqft: 6500, yearBuilt: 1975 },
        { salePrice: 330000, sqft: 1600, beds: 4, lotSqft: 7500, yearBuilt: 1990 }
    ];
    eq(Engine.bracketingDefects(subject, comps).length, 0, 'bracketed on every line');
});

test('bracketing: comps all smaller than the subject is an extrapolation warning', () => {
    const subject = { sqft: 2400, beds: 3, lotSqft: 7000, yearBuilt: 1980 };
    const comps = [
        { salePrice: 300000, sqft: 1400, beds: 3, lotSqft: 6500, yearBuilt: 1975 },
        { salePrice: 310000, sqft: 1550, beds: 3, lotSqft: 7500, yearBuilt: 1990 }
    ];
    const d = Engine.bracketingDefects(subject, comps);
    const sqftDefect = d.find(x => x.dimension === 'sqft');
    assert(sqftDefect, 'the size gap is caught');
    eq(sqftDefect.side, 'below', 'every comp sits below');
    eq(sqftDefect.nearest, 1550, 'the closest comp is named');
    assert(/extrapolated/.test(sqftDefect.message), 'the message says why it matters');
    assert(!d.find(x => x.dimension === 'lotSqft'), 'lot size IS bracketed and stays quiet');
});

test('bracketing: unpriced comps and missing fields never manufacture a defect', () => {
    const subject = { sqft: 2400, beds: 3 };
    // Only one priced comp — too thin to conclude anything
    eq(Engine.bracketingDefects(subject, [
        { salePrice: 300000, sqft: 1400 }, { salePrice: '', sqft: 1200 }
    ]).length, 0, 'one priced comp proves nothing');
    // Subject size unknown: nothing to bracket against
    eq(Engine.bracketingDefects({ beds: 3 }, [
        { salePrice: 300000, sqft: 1400 }, { salePrice: 310000, sqft: 1500 }
    ]).length, 0, 'no subject value, no claim');
    eq(Engine.bracketingDefects(null, null).length, 0, 'garbage in, silence out');
});

// ---- Comp adjustment asymmetry ----

const ASYM_SETTINGS = {
    pricePerSqftAdj: 100, bedAdj: 5000, bathAdj: 5000, lotAdjPerSqft: 3,
    garageAdjPerSpace: 10000, poolAdj: 20000, yearAdjPerYear: 500, storyAdj: 0,
    conditionAdjPct: { renovated: 0, average: 10, dated: 20 },
    annualAppreciationPct: 0, qualitativeAdjPct: {}
};
const asym = (subject, comps, opts, settings) => Engine.compAdjustmentAsymmetry(
    Engine.appraise({ subject, comps, settings: settings || ASYM_SETTINGS }), opts);

test('asymmetry: the sign structure needs no reference and is always reported', () => {
    const subject = { sqft: 1500, beds: 3, baths: 2 };
    const comps = [
        { label: 'a', salePrice: 300000, sqft: 1500, beds: 3, baths: 2 },
        { label: 'b', salePrice: 360000, sqft: 1800, beds: 3, baths: 2 },
        { label: 'c', salePrice: 250000, sqft: 1250, beds: 3, baths: 2 }
    ];
    const r = asym(subject, comps);
    eq(r.n, 3, 'every priced comp counted');
    eq(r.compsAdjustedUp, 1, 'the small comp is adjusted up');
    eq(r.compsAdjustedDown, 1, 'the large comp is adjusted down');
    eq(r.allCompsAdjustedUp, false, 'so the blend is not one-directional');
    eq(r.warnings, undefined, 'the function raises no warnings at all');
    // The CoreLogic measurement proper is withheld without an exogenous anchor
    eq(r.reference, null, 'no reference was supplied');
    eq(r.above, null, 'so no above-side slope is claimed');
    eq(r.below, null, 'nor a below-side one');
    eq(r.retentionGap, null, 'nor a divergence between them');
});

test('asymmetry: a DOWNWARD adjustment stays negative (num() clamps at zero)', () => {
    // Regression test. num() is Math.max(0, n) by design, so reading a net
    // adjustment through it would report that no comp is ever adjusted down,
    // inverting the entire diagnostic. Every comp here is superior to the
    // subject, so the whole blend must read negative.
    const subject = { sqft: 1000 };
    const comps = [
        { label: 'a', salePrice: 300000, sqft: 1500 },
        { label: 'b', salePrice: 320000, sqft: 1600 },
        { label: 'c', salePrice: 340000, sqft: 1700 }
    ];
    const r = asym(subject, comps);
    assert(r.weightedMeanAdjPct < 0, 'adjusted DOWN on net, not clamped to 0');
    eq(r.compsAdjustedDown, 3, 'all three counted as downward');
    eq(r.allCompsAdjustedUp, false, 'and nothing reported as adjusted up');
});

test('asymmetry: a blend adjusted entirely upward is reported, never graded', () => {
    const subject = { sqft: 2000 };
    const comps = [
        { label: 'a', salePrice: 300000, sqft: 1500 },
        { label: 'b', salePrice: 310000, sqft: 1550 },
        { label: 'c', salePrice: 290000, sqft: 1450 }
    ];
    const r = asym(subject, comps);
    eq(r.allCompsAdjustedUp, true, 'every comp adjusted up');
    eq(r.arvAboveEveryComp, true, 'and the ARV clears every raw sale price');
    eq(r.compsAdjustedUp, 3, 'all three counted upward');
    eq(r.compsAdjustedDown, 0, 'none the other way');
    // MEASURED and withdrawn: as a per-deal warning this separated by +4.3
    // points of median signed error on one 156-sale sample and by +0.3 on an
    // independent 132-sale one. It stays an arithmetic fact for backtest.mjs
    // to stratify on, and never a verdict on the deal in front of you.
    eq(r.warnings, undefined, 'but the blend is never graded on it');
});

test('asymmetry: no skew warning is raised, because the skew did not replicate', () => {
    // Every comp priced far above the subject reference. CoreLogic found 69%
    // of comps above; MEASURED here against the known close price the median
    // set is 50% above and the mean 46%, and scoreComp() never reads price at
    // all. The share is reported; nothing is claimed from it.
    const subject = { sqft: 1500 };
    const comps = [
        { label: 'a', salePrice: 400000, sqft: 1500 },
        { label: 'b', salePrice: 420000, sqft: 1500 },
        { label: 'c', salePrice: 440000, sqft: 1500 }
    ];
    const r = asym(subject, comps, { reference: 300000 });
    eq(r.shareAbovePct, 100, 'every comp sits above the reference');
    eq(r.warnings, undefined, 'and that on its own claims nothing');
});

test('asymmetry: retention slopes match the hand-computed through-origin fit', () => {
    const subject = { sqft: 1500, beds: 3, baths: 2 };
    const comps = [
        { label: 'a', salePrice: 300000, sqft: 1500, beds: 3, baths: 2 },
        { label: 'b', salePrice: 360000, sqft: 1800, beds: 3, baths: 2 },
        { label: 'c', salePrice: 250000, sqft: 1250, beds: 3, baths: 2 },
        { label: 'd', salePrice: 330000, sqft: 1650, beds: 3, baths: 2 }
    ];
    const r = asym(subject, comps, { reference: 300000 });
    eq(r.reference, 300000, 'the supplied reference is used verbatim');
    // b: x=+0.2  y=-30000/360000   d: x=+0.1  y=-15000/330000
    // slope = (0.2*-0.08333 + 0.1*-0.045454) / (0.04 + 0.01) = -0.4242
    assertNear(r.above.slope, -0.424, 0.001, 'above-side slope');
    assertNear(r.above.retention, 0.576, 0.001, 'retention = 1 + slope');
    // c alone: slope = (-0.16667*0.1)/(0.027778) = -0.6
    assertNear(r.below.slope, -0.6, 0.001, 'below-side slope');
    eq(r.below.n, 1, 'one comp below the reference');
    eq(r.below.leverage, 1, 'a single comp IS the slope, and says so');
    eq(r.slopesAreCalibrated, false, 'and they never grade a single deal');
});

test('asymmetry: a comp priced at the reference counts, but takes no side', () => {
    const subject = { sqft: 1500 };
    const comps = [
        { label: 'a', salePrice: 300000, sqft: 1500 },  // exactly the reference
        { label: 'b', salePrice: 360000, sqft: 1800 },
        { label: 'c', salePrice: 250000, sqft: 1250 }
    ];
    const r = asym(subject, comps, { reference: 300000 });
    eq(r.n, 3, 'all three are in the measurement');
    eq(r.nAbove, 1, 'one above');
    eq(r.nBelow, 1, 'one below');
});

test('asymmetry: NULL MARKET — uniform $/sqft must not read as CoreLogic', () => {
    // The failure mode this function was nearly shipped with. Every house
    // trades at exactly $200/sqft and the grid applies one honest rate, so
    // asymmetry is impossible by construction. Paired with a reference built
    // from the comps' own median $/sqft — which is where deriveMarketRates()
    // gets the GLA rate for 70.6% of real comp sets — the statistic returns
    // retentionAbove 0.634 against CoreLogic's published 0.64, and would read
    // as a replication of the literature while measuring nothing but
    // GLA_FRACTION_OF_PPSF. Pinned so the artefact can never be mistaken for
    // a finding, and so no future change reinstates a derived reference.
    const subject = { sqft: 1500 };
    const comps = [1100, 1250, 1400, 1600, 1750, 1900].map((sf, i) =>
        ({ label: 'c' + i, salePrice: sf * 200, sqft: sf }));
    const derived = Engine.deriveMarketRates(comps);
    eq(derived.method, 'fraction', 'the fraction branch, as on 7 real sets in 10');
    eq(derived.pricePerSqftAdj, 90, '0.45 x $200/sqft');
    const a = Engine.appraise({ subject, comps,
        settings: { ...ASYM_SETTINGS, pricePerSqftAdj: derived.pricePerSqftAdj } });

    // The artefact, reproduced exactly, ONLY because the reference is derived
    const derivedRef = derived.medianPricePerSqft * 1500;
    const bad = Engine.compAdjustmentAsymmetry(a, { reference: derivedRef });
    assertNear(bad.above.retention, 0.634, 0.005, 'a null market reads as CoreLogic');

    // ...and the function refuses to produce it on its own initiative
    const safe = Engine.compAdjustmentAsymmetry(a);
    eq(safe.above, null, 'no reference is derived from the comps, ever');
    eq(safe.reference, null, 'and none is invented');
});

test('asymmetry: retentionGap has a convexity floor, not a zero null', () => {
    // A self-consistent grid traces y = -x/(1+x), which is convex, so a
    // straight line through the origin reads shallower than -1 above and
    // steeper below. Every comp here reconciles to the identical $300,000 —
    // a flawless grid — and it STILL shows a positive gap. Pinned so the
    // real-data gap is never read against zero.
    const subject = { sqft: 1500 };
    const comps = [
        { label: 'a', salePrice: 360000, sqft: 1800 },
        { label: 'b', salePrice: 330000, sqft: 1650 },
        { label: 'c', salePrice: 250000, sqft: 1250 },
        { label: 'd', salePrice: 270000, sqft: 1350 }
    ];
    const a = Engine.appraise({ subject, comps,
        settings: { ...ASYM_SETTINGS, pricePerSqftAdj: 200 } });
    a.comps.forEach(c => eq(Math.round(c.adjustedValue), 300000, 'every comp lands on one value'));
    const r = Engine.compAdjustmentAsymmetry(a, { reference: 300000 });
    assert(Math.abs(r.above.retention) < 0.25, 'above side retains almost nothing');
    assert(Math.abs(r.below.retention) < 0.25, 'below side retains almost nothing');
    assertNear(r.retentionGap, 0.328, 0.01, 'yet the gap is +0.33 on a perfect grid');
});

test('asymmetry: thin sets and garbage produce no claim', () => {
    eq(Engine.compAdjustmentAsymmetry(null, null), null, 'garbage in, silence out');
    eq(Engine.compAdjustmentAsymmetry({ comps: [] }, {}), null, 'no comps, no claim');
    // Two comps: the sign structure is honest, the regression is withheld
    const r = asym({ sqft: 1500 }, [
        { label: 'a', salePrice: 300000, sqft: 1400 },
        { label: 'b', salePrice: 310000, sqft: 1450 }
    ], { reference: 300000 });
    eq(r.n, 2, 'both comps counted in the sign structure');
    eq(r.above, null, 'but two comps do not support a two-sided fit');
});

test('asymmetry: pooling is what makes the regression answerable', () => {
    // Four comps cannot support a two-sided fit; several hundred can. Planted
    // asymmetry: comps above the reference keep ALL of their premium, comps
    // below are pulled fully onto it.
    // Planted in the estimator's own coordinates so the answer is exact:
    // above-side y = 0 (slope 0, retention 1), below-side y = -x (slope -1,
    // retention 0). Building the below leg as "adjust onto the reference"
    // instead would land at -0.21, which is the convexity floor above, not 0.
    const points = [];
    const ref = 300000;
    for (let i = 0; i < 60; i++) {
        points.push({ price: ref * (1 + 0.1 + i * 0.002), net: 0, reference: ref });
        const price = ref * (1 - 0.1 - i * 0.002);
        const x = (price - ref) / ref;
        points.push({ price, net: -x * price, reference: ref });
    }
    const p = Engine.pooledRetention(points);
    assertNear(p.above.retention, 1, 0.001, 'premium comps keep their premium');
    assertNear(p.below.retention, 0, 0.001, 'discount comps are pulled all the way up');
    eq(p.n, 120, 'every comp pooled');
    eq(Engine.pooledRetention(points.slice(0, 10)), null, 'under 20 comps it refuses');
});

// ---- Neighbourhood effective tax rate ----

test('neighbourhood tax rate: median of the comps\' own bills', () => {
    const comps = [
        { taxAnnual: 6000, price: 300000, priceType: 'closed' },  // 2.0%
        { taxAnnual: 6600, price: 300000, priceType: 'closed' },  // 2.2%
        { taxAnnual: 9300, price: 300000, priceType: 'closed' }   // 3.1%
    ];
    const r = Engine.neighborhoodTaxRate(comps);
    eq(r.n, 3, 'all three usable');
    assertNear(r.medianRatePct, 2.2, 0.001, 'median rate');
});

test('neighbourhood tax rate: refuses to call two houses a market', () => {
    eq(Engine.neighborhoodTaxRate([
        { taxAnnual: 6000, price: 300000, priceType: 'closed' },
        { taxAnnual: 6600, price: 300000, priceType: 'closed' }
    ]), null, 'under 3 usable comps yields nothing');
    eq(Engine.neighborhoodTaxRate(null), null, 'garbage in, silence out');
});

test('neighbourhood tax rate: list-price proxies and impossible rates are dropped', () => {
    const comps = [
        { taxAnnual: 6000, price: 300000, priceType: 'closed' },
        { taxAnnual: 6600, price: 300000, priceType: 'closed' },
        { taxAnnual: 6300, price: 300000, priceType: 'closed' },
        // A guess in the denominator would put a guess in the answer
        { taxAnnual: 30000, price: 300000, priceType: 'list' },
        // 0.1% and 9% are data errors (partial year, exempt, mismatched row)
        { taxAnnual: 300, price: 300000, priceType: 'closed' },
        { taxAnnual: 27000, price: 300000, priceType: 'closed' }
    ];
    const r = Engine.neighborhoodTaxRate(comps);
    eq(r.n, 3, 'only the three sane closed rows count');
    assertNear(r.medianRatePct, 2.1, 0.001, 'outliers never move the median');
});

// ---- Comp selection tolerances ----

const TOL_SUBJECT = { sqft: 1500, yearBuilt: 1970, beds: 3, baths: 2, lotSqft: 7000 };

test('comp tolerance: a comp inside every band raises no flag', () => {
    const r = Engine.compTolerance(TOL_SUBJECT,
        { sqft: 1800, yearBuilt: 1976, beds: 4, baths: 2.5, lotSqft: 9000, monthsAgo: 4, distanceMi: 0.6 }, {});
    eq(r.count, 0, 'nothing outside');
    eq(r.outside.length, 0);
    eq(r.fields.sqft.outside, false, '1,800 is 20% over a 1,500 subject — inside ±25%');
    eq(r.fields.yearBuilt.outside, false, '1976 is six years off 1970 — inside ±8');
    assert(/within/.test(r.fields.sqft.note), 'the note says within: ' + r.fields.sqft.note);
    eq(r.fields.distanceMi.short, '0.60 mi from subject', 'distance line reads even when inside');
});

test('comp tolerance: the user\'s own examples flag', () => {
    const r = Engine.compTolerance(TOL_SUBJECT, { sqft: 2100, yearBuilt: 1985 }, {});
    eq(r.fields.sqft.outside, true, '2,100 is 40% over — outside ±25%');
    eq(r.fields.yearBuilt.outside, true, '1985 is fifteen years off — outside ±8');
    eq(r.outside.join(','), 'sqft,yearBuilt');
    eq(r.count, 2);
    assertNear(r.fields.sqft.pct, 40, 1e-9, 'pct');
    eq(r.fields.yearBuilt.delta, 15, 'delta is signed comp minus subject');
    assert(/outside/.test(r.fields.sqft.note) && /40%/.test(r.fields.sqft.note), r.fields.sqft.note);
    assert(/1985/.test(r.fields.yearBuilt.short) && /\+15/.test(r.fields.yearBuilt.short), r.fields.yearBuilt.short);
});

test('comp tolerance: the limit itself is inside, one past it is outside', () => {
    const at = Engine.compTolerance(TOL_SUBJECT,
        { sqft: 1875, yearBuilt: 1978, beds: 4, baths: 3, lotSqft: 10500, monthsAgo: 6, distanceMi: 1 }, {});
    eq(at.count, 0, 'exactly on every band: ' + at.outside.join(','));
    const past = Engine.compTolerance(TOL_SUBJECT,
        { sqft: 1876, yearBuilt: 1979, beds: 5, baths: 3.5, lotSqft: 10600, monthsAgo: 7, distanceMi: 1.01 }, {});
    eq(past.outside.slice().sort().join(','), 'baths,beds,distanceMi,lotSqft,monthsAgo,sqft,yearBuilt');
    eq(past.count, 7);
});

test('comp tolerance: the verdict is made at the precision the note prints', () => {
    // 105 / 1500 * 100 is 7.000000000000001 in IEEE doubles (300 / 1500 * 100
    // happens to land on 20 exactly) — a naive comparison against a 7% band
    // would flag a comp sitting precisely on the line
    assert(105 / 1500 * 100 > 7, 'the premise: float noise pushes 7% past 7');
    eq(Engine.compTolerance(TOL_SUBJECT, { sqft: 1605 }, { sqftPct: 7 }).fields.sqft.outside, false, 'exactly 7% is inside a 7% band');
    eq(Engine.compTolerance(TOL_SUBJECT, { sqft: 1606 }, { sqftPct: 7 }).fields.sqft.outside, true, 'one foot past it is outside');
    // A comp 25.4% over prints "25.4%" and reads outside; one 25.04% over
    // prints "25%" and therefore reads INSIDE — the tooltip and the colour
    // must never contradict each other at the edge of the band
    const over = Engine.compTolerance(TOL_SUBJECT, { sqft: 1881 }, {});
    eq(over.fields.sqft.outside, true, '25.4% is outside');
    assert(/25\.4% larger/.test(over.fields.sqft.note) && /\+25\.4%/.test(over.fields.sqft.short),
        over.fields.sqft.note + ' | ' + over.fields.sqft.short);
    const hair = Engine.compTolerance(TOL_SUBJECT, { sqft: 1875.6 }, {});
    eq(hair.fields.sqft.outside, false, '25.04% rounds to the printed 25%, which is inside');
    assert(/ 25% larger/.test(hair.fields.sqft.note) && /within/.test(hair.fields.sqft.note), hair.fields.sqft.note);
    // 2.2 − 1.2 is 1.0000000000000002 — a bath count difference of exactly one
    eq(Engine.compTolerance({ baths: 1.2 }, { baths: 2.2 }, {}).fields.baths.outside, false, 'rooms round to the half');
    // Distance prints at two decimals and is judged there too
    eq(Engine.compTolerance({}, { distanceMi: 1.004 }, {}).fields.distanceMi.outside, false, '1.004 prints as 1.00 mi');
    eq(Engine.compTolerance({}, { distanceMi: 1.006 }, {}).fields.distanceMi.outside, true, '1.006 prints as 1.01 mi');
    eq(Engine.compTolerance({}, { distanceMi: 1.004 }, {}).fields.distanceMi.note, '1.00 mi from the subject (within 1 mi)');
});

test('comp tolerance: smaller and older flag just like larger and newer', () => {
    const r = Engine.compTolerance(TOL_SUBJECT, { sqft: 1100, yearBuilt: 1958, beds: 1 }, {});
    eq(r.outside.join(','), 'sqft,yearBuilt,beds');
    assert(/smaller/.test(r.fields.sqft.note) && /older/.test(r.fields.yearBuilt.note),
        r.fields.sqft.note + ' | ' + r.fields.yearBuilt.note);
    assert(/−26\.7%/.test(r.fields.sqft.short), 'short form carries the sign: ' + r.fields.sqft.short);
    assert(/−12 yrs/.test(r.fields.yearBuilt.short), r.fields.yearBuilt.short);
});

test('comp tolerance: a blank on either side is no verdict, not a flag', () => {
    const r = Engine.compTolerance({ sqft: '', yearBuilt: 1970, beds: 3 },
        { sqft: 2100, yearBuilt: '', beds: undefined, monthsAgo: '', distanceMi: null }, {});
    eq(r.fields.sqft, null, 'subject sqft blank');
    eq(r.fields.yearBuilt, null, 'comp year blank');
    eq(r.fields.beds, null, 'comp beds missing');
    eq(r.fields.monthsAgo, null, 'blank recency is unknown, not zero');
    eq(r.fields.distanceMi, null, 'no coordinates, no distance');
    eq(r.count, 0);
    eq(Engine.compTolerance({ sqft: 0 }, { sqft: 1500 }, {}).fields.sqft, null, 'a zero subject has no percent');
    eq(Engine.compTolerance({ sqft: 'abc' }, { sqft: 1500 }, {}).fields.sqft, null, 'garbage is blank');
    eq(Engine.compTolerance(null, null, null).count, 0, 'nothing at all is fine');
});

test('comp tolerance: blank setting restores the default, explicit 0 is honoured', () => {
    const blank = Engine.compTolerance(TOL_SUBJECT, { yearBuilt: 1975 }, { yearBuiltYears: '' });
    eq(blank.fields.yearBuilt.limit, Engine.DEFAULTS.compTolerances.yearBuiltYears, 'blank → default');
    eq(blank.fields.yearBuilt.outside, false);
    const zero = Engine.compTolerance(TOL_SUBJECT, { yearBuilt: 1971 }, { yearBuiltYears: 0 });
    eq(zero.fields.yearBuilt.limit, 0, 'an explicit zero is an answer');
    eq(zero.fields.yearBuilt.outside, true, 'one year off is outside a zero band');
    eq(Engine.compTolerance(TOL_SUBJECT, { yearBuilt: 1970 }, { yearBuiltYears: 0 }).fields.yearBuilt.outside,
        false, 'the same year still fits a zero band');
    const wide = Engine.compTolerance(TOL_SUBJECT, { sqft: 2100 }, { sqftPct: '45' });
    eq(wide.fields.sqft.outside, false, 'a string setting is read the way the inputs deliver it');
    eq(Engine.compTolerance(TOL_SUBJECT, { sqft: 1600 }, { sqftPct: -5 }).fields.sqft.limit, 0, 'negative clamps to zero');
    eq(Engine.compTolerance(TOL_SUBJECT, { sqft: 1600 }, { sqftPct: 'x' }).fields.sqft.limit, 25, 'garbage setting → default');
});

test('comp tolerance: it never touches the appraisal', () => {
    const subject = { ...TOL_SUBJECT, stories: 1 };
    const comp = { label: 'A', salePrice: 300000, sqft: 2100, beds: 3, baths: 2, lotSqft: 7000,
        garageSpaces: 2, yearBuilt: 1985, stories: 1, condition: 'renovated', monthsAgo: 9 };
    const before = Engine.appraise({ subject, comps: [comp], settings: {} }).arv;
    const snapshot = JSON.stringify(comp);
    Engine.compTolerance(subject, comp, {});
    eq(JSON.stringify(comp), snapshot, 'pure — the comp is not mutated');
    const after = Engine.appraise({ subject, comps: [comp], settings: {} }).arv;
    eq(after, before, 'no price effect');
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

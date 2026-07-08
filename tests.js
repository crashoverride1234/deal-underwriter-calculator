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

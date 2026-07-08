/**
 * Underwriter Engine — pure calculation core, no DOM dependencies.
 * Works in the browser (window.UnderwriterEngine) and Node (module.exports)
 * so the same math can be unit-tested from tests.js.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.UnderwriterEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DEFAULTS = {
        flipBaselineMonthlyCarry: 300,   // taxes/ins/utilities during a flip hold
        hardMoneyArvCapRatio: 0.75,      // hard money loans capped at 75% of ARV
        flipSellingCostRate: 0.08,       // agent commissions + title ~8% of sale price
        refiClosingCostRate: 0.02,       // BRRRR refinance closing costs ~2% of loan
        amortYears: 30
    };

    // Coerce any input to a finite non-negative number
    function num(v, fallback = 0) {
        const n = typeof v === 'number' ? v : parseFloat(v);
        return Number.isFinite(n) ? Math.max(0, n) : fallback;
    }

    // Monthly principal & interest for a fully amortizing loan
    function calcAmortizedPayment(principal, annualRate, years = DEFAULTS.amortYears) {
        if (principal <= 0 || years <= 0) return 0;
        const n = years * 12;
        if (annualRate <= 0) return principal / n;
        const r = (annualRate / 100) / 12;
        const growth = Math.pow(1 + r, n);
        return principal * (r * growth) / (growth - 1);
    }

    // Monthly interest-only payment
    function calcInterestOnlyPayment(principal, annualRate) {
        if (principal <= 0 || annualRate <= 0) return 0;
        return (principal * (annualRate / 100)) / 12;
    }

    /**
     * Underwrite a deal.
     *
     * inputs: {
     *   strategy: 'flip' | 'rental',
     *   purchasePrice, buyingCosts, arv, rehabBudget, holdingPeriod (months),
     *   financingType: 'cash' | 'hard_money' | 'private_money' | 'dscr_purchase' | 'dscr_refi',
     *   ltvPercent, interestRate, lenderPointsPercent, lenderFees,
     *   rehabBufferMonths, variancePercent,          // stress-test adjustments
     *   monthlyRent, vacancyPercent, operatingExpensesPercent, monthlyTaxesIns  // rental only
     * }
     */
    function underwrite(inputs) {
        const strategy = inputs.strategy === 'rental' ? 'rental' : 'flip';
        const purchasePrice = num(inputs.purchasePrice);
        const buyingCosts = num(inputs.buyingCosts);
        const rawArv = num(inputs.arv);
        const rehabBudget = num(inputs.rehabBudget);
        const baseHold = num(inputs.holdingPeriod);
        const financingType = inputs.financingType || 'cash';
        const ltvRatio = num(inputs.ltvPercent) / 100;
        const interestRate = num(inputs.interestRate);
        const pointsRatio = num(inputs.lenderPointsPercent) / 100;
        const lenderFees = num(inputs.lenderFees);
        const rehabBuffer = num(inputs.rehabBufferMonths);
        // Variance may legitimately be negative (market drop) — don't clamp to 0
        const varianceRaw = parseFloat(inputs.variancePercent);
        const variancePercent = Number.isFinite(varianceRaw) ? varianceRaw : 0;

        const monthlyRent = num(inputs.monthlyRent);
        const vacancyRatio = num(inputs.vacancyPercent) / 100;
        const opExRatio = num(inputs.operatingExpensesPercent) / 100;
        const monthlyTaxesIns = num(inputs.monthlyTaxesIns);

        const holdingPeriod = baseHold + rehabBuffer;
        const arv = rawArv * (1 + variancePercent / 100);
        const isFinanced = financingType !== 'cash';
        const isHardMoney = financingType === 'hard_money' || financingType === 'private_money';

        // 1. Loan sizing & upfront financing costs
        let loanAmount = 0;
        if (isHardMoney) {
            // Sized on Loan-to-Cost (purchase + rehab), capped at a % of ARV
            loanAmount = Math.min((purchasePrice + rehabBudget) * ltvRatio, arv * DEFAULTS.hardMoneyArvCapRatio);
        } else if (financingType === 'dscr_purchase') {
            loanAmount = purchasePrice * ltvRatio;
        } else if (financingType === 'dscr_refi') {
            // BRRRR: buy with cash, refinance later against stabilized ARV
            loanAmount = arv * ltvRatio;
        }
        const pointsCost = isFinanced ? loanAmount * pointsRatio : 0;
        const financeFees = isFinanced ? lenderFees + pointsCost : 0;

        // 2. Monthly carrying costs during the hold
        const baselineMonthlyCarry = strategy === 'flip' ? DEFAULTS.flipBaselineMonthlyCarry : monthlyTaxesIns;
        let monthlyFinancingCost = 0;
        if (isHardMoney) {
            monthlyFinancingCost = calcInterestOnlyPayment(loanAmount, interestRate);
        } else if (financingType === 'dscr_purchase') {
            monthlyFinancingCost = calcAmortizedPayment(loanAmount, interestRate);
        }
        // dscr_refi: acquisition is all cash, so no debt service during rehab

        const monthlyHoldingCost = baselineMonthlyCarry + monthlyFinancingCost;
        const totalHoldingCarryingCosts = monthlyHoldingCost * holdingPeriod;

        // 3. Total capital & out-of-pocket cash
        const totalProjectCosts = purchasePrice + rehabBudget + buyingCosts + totalHoldingCarryingCosts + financeFees;

        let cashInvested = 0;
        let sellingRefiCosts = 0;

        if (strategy === 'flip') {
            sellingRefiCosts = arv * DEFAULTS.flipSellingCostRate;
            cashInvested = Math.max(0, totalProjectCosts - loanAmount);
        } else if (financingType === 'dscr_refi') {
            const refiClosingCosts = loanAmount * DEFAULTS.refiClosingCostRate;
            sellingRefiCosts = refiClosingCosts;
            const preRefiCash = purchasePrice + rehabBudget + buyingCosts + totalHoldingCarryingCosts;
            // Can go negative: refinance proceeds exceed cash spent (cash-out)
            cashInvested = preRefiCash + refiClosingCosts - loanAmount;
        } else {
            // Cash or DSCR purchase rental
            cashInvested = (purchasePrice - loanAmount) + rehabBudget + buyingCosts + financeFees + totalHoldingCarryingCosts;
        }

        const result = {
            strategy, financingType, holdingPeriod, arv,
            loanAmount, pointsCost, financeFees,
            monthlyFinancingCost, monthlyHoldingCost, totalHoldingCarryingCosts,
            totalProjectCosts, cashInvested, sellingRefiCosts,
            purchasePrice, rehabBudget, buyingCosts
        };

        // 4. Strategy-specific return metrics
        if (strategy === 'flip') {
            const netProfit = arv - totalProjectCosts - sellingRefiCosts;
            const roi = cashInvested > 0 ? (netProfit / cashInvested) * 100 : 0;
            result.netProfit = netProfit;
            result.roi = roi;
            result.annualizedRoi = holdingPeriod > 0 ? roi * (12 / holdingPeriod) : 0;
        } else {
            const vacancyLoss = monthlyRent * vacancyRatio;
            const maintenanceMgmt = monthlyRent * opExRatio;
            const netOperatingIncome = monthlyRent - vacancyLoss - maintenanceMgmt - monthlyTaxesIns;

            let monthlyDebtService = 0;
            if (financingType === 'dscr_purchase') {
                monthlyDebtService = monthlyFinancingCost;
            } else if (financingType === 'dscr_refi') {
                monthlyDebtService = calcAmortizedPayment(loanAmount, interestRate);
            }

            const monthlyCashFlow = netOperatingIncome - monthlyDebtService;
            result.grossRent = monthlyRent;
            result.vacancyLoss = vacancyLoss;
            result.maintenanceMgmt = maintenanceMgmt;
            result.monthlyTaxesIns = monthlyTaxesIns;
            result.netOperatingIncome = netOperatingIncome;
            result.monthlyDebtService = monthlyDebtService;
            result.monthlyCashFlow = monthlyCashFlow;
            result.cocReturn = cashInvested > 0
                ? (monthlyCashFlow * 12 / cashInvested) * 100
                : (monthlyCashFlow > 0 ? Infinity : 0);
            result.dscrRatio = monthlyDebtService > 0 ? netOperatingIncome / monthlyDebtService : Infinity;
        }

        return result;
    }

    /**
     * Desktop appraisal via the sales comparison approach.
     * Each comp's sale price is adjusted toward the subject's post-rehab
     * (renovated) state; comps needing fewer adjustments weigh more.
     *
     * inputs: {
     *   subject: { sqft, beds, baths },
     *   comps: [{ label, salePrice, sqft, beds, baths,
     *             condition: 'renovated'|'average'|'dated', monthsAgo }],
     *   settings: { pricePerSqftAdj, bedAdj, bathAdj,
     *               conditionAdjPct: { renovated, average, dated },
     *               annualAppreciationPct }
     * }
     */
    function appraise(inputs) {
        const subject = inputs.subject || {};
        const settings = inputs.settings || {};
        const sSqft = num(subject.sqft);
        const sBeds = num(subject.beds);
        const sBaths = num(subject.baths);
        const adjPerSqft = num(settings.pricePerSqftAdj);
        const bedAdj = num(settings.bedAdj);
        const bathAdj = num(settings.bathAdj);
        const condPct = settings.conditionAdjPct || {};
        const apprPct = num(settings.annualAppreciationPct);

        const comps = (Array.isArray(inputs.comps) ? inputs.comps : [])
            .map(c => {
                const salePrice = num(c.salePrice);
                const adjustments = {
                    sqft: (sSqft - num(c.sqft)) * adjPerSqft,
                    beds: (sBeds - num(c.beds)) * bedAdj,
                    baths: (sBaths - num(c.baths)) * bathAdj,
                    condition: salePrice * num(condPct[c.condition || 'renovated']) / 100,
                    time: salePrice * (apprPct / 100) * (num(c.monthsAgo) / 12)
                };
                const netAdjustment = Object.values(adjustments).reduce((a, b) => a + b, 0);
                const grossAdj = Object.values(adjustments).reduce((a, b) => a + Math.abs(b), 0);
                const grossAdjPct = salePrice > 0 ? (grossAdj / salePrice) * 100 : 0;
                return {
                    label: c.label || '',
                    salePrice,
                    adjustments,
                    netAdjustment,
                    grossAdjPct,
                    adjustedValue: salePrice + netAdjustment,
                    pricePerSqft: num(c.sqft) > 0 ? salePrice / num(c.sqft) : 0,
                    // Perfect comp = weight 1, fading linearly; floor keeps every comp counted
                    weight: Math.max(0.1, 1 - grossAdjPct / 50),
                    flagged: grossAdjPct > 25 // appraisal convention: >25% gross = weak comp
                };
            })
            .filter(c => c.salePrice > 0);

        if (comps.length === 0) {
            return { comps: [], arv: 0, low: 0, high: 0, spreadPct: 0, confidence: 'low', subjectPricePerSqft: 0 };
        }

        const weightSum = comps.reduce((s, c) => s + c.weight, 0);
        const weighted = comps.reduce((s, c) => s + c.adjustedValue * c.weight, 0) / weightSum;
        const arv = Math.round(weighted / 1000) * 1000;

        const values = comps.map(c => c.adjustedValue);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const sd = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
        const spreadPct = mean > 0 ? (sd / mean) * 100 : 0;
        const confidence = (comps.length >= 3 && spreadPct < 5) ? 'high' : (spreadPct < 10 ? 'medium' : 'low');

        return {
            comps, arv,
            low: Math.round(Math.min.apply(null, values) / 1000) * 1000,
            high: Math.round(Math.max.apply(null, values) / 1000) * 1000,
            spreadPct, confidence,
            subjectPricePerSqft: sSqft > 0 ? arv / sSqft : 0
        };
    }

    return { DEFAULTS, num, calcAmortizedPayment, calcInterestOnlyPayment, underwrite, appraise };
}));

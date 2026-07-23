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
        amortYears: 30,
        // GLA a room typically occupies — netted out of the sqft adjustment so
        // a bedroom/bath difference isn't paid twice (once as generic area,
        // once as the flat room value)
        bedroomFootprintSqft: 120,
        bathFootprintSqft: 50
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

    // Distinguish "field not provided" from a legitimate 0 — a missing data
    // point on either side of a comparison means no adjustment (appraiser rule)
    function has(v) {
        return v !== undefined && v !== null && v !== '';
    }

    // Normalize the many ways a pool/no-pool answer arrives; null = unknown
    function boolish(v) {
        if (v === true || v === 'yes' || v === 'true' || v === 1 || v === '1') return true;
        if (v === false || v === 'no' || v === 'false' || v === 0 || v === '0') return false;
        return null;
    }

    /**
     * Desktop appraisal via the sales comparison approach.
     * Each comp's sale price is adjusted toward the subject's post-rehab
     * (renovated) state; comps needing fewer adjustments weigh more.
     *
     * inputs: {
     *   subject: { sqft, beds, baths, lotSqft, garageSpaces, yearBuilt, pool, stories },
     *   comps: [{ label, salePrice, sqft, beds, baths, lotSqft, garageSpaces,
     *             yearBuilt, pool, stories,
     *             condition: 'renovated'|'average'|'dated', monthsAgo,
     *             ratings: { <factor>: 'superior'|'similar'|'inferior' } }],
     *   settings: { pricePerSqftAdj, bedAdj, bathAdj, lotAdjPerSqft,
     *               garageAdjPerSpace, poolAdj, yearAdjPerYear, storyAdj,
     *               conditionAdjPct: { renovated, average, dated },
     *               annualAppreciationPct,
     *               qualitativeAdjPct: { lotPlacement, lotUsability, schools,
     *                                    curbAppeal, floorplan, locationInfluence } }
     * }
     *
     * Rating semantics (comp relative to subject): an INFERIOR comp sold for
     * less than the subject deserves, so its price adjusts UP; SUPERIOR down.
     *
     * Sequencing follows appraiser practice: the time adjustment establishes a
     * current-market basis first, and every percentage adjustment (condition,
     * qualitative) applies to that basis, not the stale nominal price.
     *
     * storyAdj > 0 encodes a single-story premium — what the market actually
     * prices is stairs vs no stairs, so the adjustment fires only when exactly
     * one side is single-story (2-vs-3 story is a wash). Negative storyAdj
     * encodes a multi-story-premium market.
     *
     * Age uses EFFECTIVE age: a renovated comp takes no year adjustment
     * (renovation resets it); average/dated comps keep their vintage penalty.
     */
    function appraise(inputs) {
        const subject = inputs.subject || {};
        const settings = inputs.settings || {};
        const sSqft = num(subject.sqft);
        const sBeds = num(subject.beds);
        const sBaths = num(subject.baths);
        const sPool = boolish(subject.pool);
        const adjPerSqft = num(settings.pricePerSqftAdj);
        const bedAdj = num(settings.bedAdj);
        const bathAdj = num(settings.bathAdj);
        const lotAdj = num(settings.lotAdjPerSqft);
        const garageAdj = num(settings.garageAdjPerSpace);
        const poolAdj = num(settings.poolAdj);
        const yearAdj = num(settings.yearAdjPerYear);
        // Story premium may legitimately be negative (2-story premium markets)
        const storyAdjRaw = parseFloat(settings.storyAdj);
        const storyAdj = Number.isFinite(storyAdjRaw) ? storyAdjRaw : 0;
        const condPct = settings.conditionAdjPct || {};
        // Appreciation may legitimately be negative (declining market): comps
        // that sold before a downturn must be adjustable DOWN, so no num() clamp
        const apprRaw = parseFloat(settings.annualAppreciationPct);
        const apprPct = Number.isFinite(apprRaw) ? apprRaw : 0;
        const qualPct = settings.qualitativeAdjPct || {};

        const bedFt = settings.bedroomFootprintSqft !== undefined
            ? num(settings.bedroomFootprintSqft) : DEFAULTS.bedroomFootprintSqft;
        const bathFt = settings.bathFootprintSqft !== undefined
            ? num(settings.bathFootprintSqft) : DEFAULTS.bathFootprintSqft;
        const isSingleStory = (v) => num(v) === 1; // 1.5+ has stairs

        const comps = (Array.isArray(inputs.comps) ? inputs.comps : [])
            .map(c => {
                const salePrice = num(c.salePrice);
                const cPool = boolish(c.pool);
                const compCondition = c.condition || 'renovated';
                const ratings = c.ratings || {};

                // A blank field on either side means NO adjustment for that
                // factor, never a phantom against 0
                const sqftOk = has(subject.sqft) && has(c.sqft);
                const bedsOk = has(subject.beds) && has(c.beds);
                const bathsOk = has(subject.baths) && has(c.baths);

                // Time first: percentage adjustments below apply to the
                // time-adjusted (current market) basis, per appraiser practice
                const timeAdj = salePrice * (apprPct / 100) * (num(c.monthsAgo) / 12);
                const basis = salePrice + timeAdj;

                // GLA netted of room footprints: the area a bedroom/bath
                // occupies is paid once, inside the flat room adjustment
                let sqftDiff = sqftOk ? (sSqft - num(c.sqft)) : 0;
                if (sqftOk && bedsOk) sqftDiff -= (sBeds - num(c.beds)) * bedFt;
                if (sqftOk && bathsOk) sqftDiff -= (sBaths - num(c.baths)) * bathFt;

                const adjustments = {
                    sqft: sqftDiff * adjPerSqft,
                    beds: bedsOk ? (sBeds - num(c.beds)) * bedAdj : 0,
                    baths: bathsOk ? (sBaths - num(c.baths)) * bathAdj : 0,
                    lot: (has(subject.lotSqft) && has(c.lotSqft))
                        ? (num(subject.lotSqft) - num(c.lotSqft)) * lotAdj : 0,
                    garage: (has(subject.garageSpaces) && has(c.garageSpaces))
                        ? (num(subject.garageSpaces) - num(c.garageSpaces)) * garageAdj : 0,
                    // Effective age: renovation resets it, so renovated comps
                    // take no vintage penalty (their condition line is 0 too)
                    year: (num(subject.yearBuilt) > 0 && num(c.yearBuilt) > 0 && compCondition !== 'renovated')
                        ? (num(subject.yearBuilt) - num(c.yearBuilt)) * yearAdj : 0,
                    pool: (sPool !== null && cPool !== null && sPool !== cPool)
                        ? (sPool ? poolAdj : -poolAdj) : 0,
                    // Single-story premium: fires only when exactly one side
                    // is single-story — the market prices stairs, not floors
                    stories: (has(subject.stories) && has(c.stories))
                        ? (isSingleStory(subject.stories) && !isSingleStory(c.stories) ? storyAdj
                            : (!isSingleStory(subject.stories) && isSingleStory(c.stories) ? -storyAdj : 0))
                        : 0,
                    condition: basis * num(condPct[compCondition]) / 100,
                    time: timeAdj
                };
                // Qualitative grid: % of the time-adjusted basis, signed by rating
                Object.keys(qualPct).forEach(key => {
                    const r = ratings[key];
                    const sign = r === 'inferior' ? 1 : (r === 'superior' ? -1 : 0);
                    adjustments[key] = sign * basis * num(qualPct[key]) / 100;
                });

                // Likely double-counts the user should sanity-check by hand
                const overlaps = [];
                if (compCondition !== 'renovated' && ratings.curbAppeal === 'inferior') {
                    overlaps.push('condition uplift + inferior curb appeal');
                }
                if (adjustments.lot !== 0 && (ratings.lotUsability === 'inferior' || ratings.lotUsability === 'superior')) {
                    overlaps.push('lot size $ + lot usability %');
                }

                const netAdjustment = Object.values(adjustments).reduce((a, b) => a + b, 0);
                const grossAdj = Object.values(adjustments).reduce((a, b) => a + Math.abs(b), 0);
                const grossAdjPct = salePrice > 0 ? (grossAdj / salePrice) * 100 : 0;
                return {
                    label: c.label || '',
                    salePrice,
                    adjustments,
                    overlaps,
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

    /**
     * Market absorption / velocity readout.
     * inputs: { activeListings, pendingListings, soldLast90Days }
     *
     * Months of Inventory (MOI) = actives / monthly sales pace. Standard
     * read: under ~3 months is a seller's market, 3–6 balanced, 6+ a
     * buyer's market. Pendings-to-actives adds a leading-indicator boost.
     * Returns a 0–100 heat score and a temperature bucket for the gauge.
     */
    function marketAbsorption(inputs) {
        const actives = num(inputs.activeListings);
        const pendings = num(inputs.pendingListings);
        const sold90 = num(inputs.soldLast90Days);

        if (actives <= 0 && pendings <= 0 && sold90 <= 0) {
            return {
                soldPerMonth: 0, monthsOfInventory: 0, absorptionRatePct: 0,
                pendingRatio: 0, score: 50, temperature: 'unknown'
            };
        }

        const soldPerMonth = sold90 / 3;
        const monthsOfInventory = soldPerMonth > 0
            ? actives / soldPerMonth
            : (actives > 0 ? Infinity : 0);
        const absorptionRatePct = actives > 0
            ? (soldPerMonth / actives) * 100
            : (soldPerMonth > 0 ? Infinity : 0);
        const pendingRatio = actives > 0
            ? pendings / actives
            : (pendings > 0 ? Infinity : 0);

        // 0 MOI → 100, 12+ MOI → 0; pendings can add up to +20 (leading demand)
        const moiCapped = Number.isFinite(monthsOfInventory) ? Math.min(monthsOfInventory, 12) : 12;
        let score = 100 * (1 - moiCapped / 12);
        score += Math.min((Number.isFinite(pendingRatio) ? pendingRatio : 1) * 20, 20);
        score = Math.max(0, Math.min(100, score));

        const temperature = score >= 80 ? 'hot'
            : score >= 60 ? 'warm'
            : score >= 40 ? 'balanced'
            : score >= 20 ? 'cool'
            : 'cold';

        return { soldPerMonth, monthsOfInventory, absorptionRatePct, pendingRatio, score, temperature };
    }

    return { DEFAULTS, num, calcAmortizedPayment, calcInterestOnlyPayment, underwrite, appraise, marketAbsorption };
}));

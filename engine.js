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
        bathFootprintSqft: 50,
        // Rehab scope tiers, $/sqft (DFW-typical midpoints of the practitioner
        // ranges: cosmetic 10–20, medium 35–50, full gut 50–80)
        rehabTiers: { cosmetic: 15, medium: 42, gut: 65 }
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
        // Insurance is broken out so a DSCR lender's PITIA can be assembled
        // honestly; when it's absent the taxes+insurance field still carries
        // the whole burden exactly as it always has.
        const monthlyInsurance = num(inputs.monthlyInsurance);
        // The exit stack is the investor's, not a national average — a
        // licensed agent self-listing runs several points under the 8%
        // default. Blank restores the old constant bit-for-bit.
        const sellingCostRatio = has(inputs.sellingCostPercent)
            ? num(inputs.sellingCostPercent) / 100
            : DEFAULTS.flipSellingCostRate;
        // What ownership costs every month regardless of debt. Insurance
        // defaults to 0, so a caller that still folds it into monthlyTaxesIns
        // gets the identical total it always did.
        const monthlyOwnershipCost = monthlyTaxesIns + monthlyInsurance;

        const holdingPeriod = baseHold + rehabBuffer;
        const arv = rawArv * (1 + variancePercent / 100);
        const isFinanced = financingType !== 'cash';
        const isHardMoney = financingType === 'hard_money' || financingType === 'private_money';

        // 1. Loan sizing & upfront financing costs
        let loanAmount = 0;
        // Which constraint actually sized the loan. When the ARV ceiling wins,
        // the loan silently shrinks and the shortfall lands on the investor's
        // cash — the most common reason a fix&flip loan funds under plan.
        let bindingConstraint = null;
        let capShortfall = 0;
        const arvCapRatio = has(inputs.arvCapPercent)
            ? num(inputs.arvCapPercent) / 100
            : DEFAULTS.hardMoneyArvCapRatio;
        if (isHardMoney) {
            // Sized on Loan-to-Cost (purchase + rehab), capped at a % of ARV
            const byCost = (purchasePrice + rehabBudget) * ltvRatio;
            const byArv = arv * arvCapRatio;
            loanAmount = Math.min(byCost, byArv);
            bindingConstraint = byArv < byCost ? 'ltarv' : 'ltc';
            capShortfall = Math.max(0, byCost - byArv);
        } else if (financingType === 'dscr_purchase') {
            loanAmount = purchasePrice * ltvRatio;
        } else if (financingType === 'dscr_refi') {
            // BRRRR: buy with cash, refinance later against stabilized ARV
            loanAmount = arv * ltvRatio;
        }
        const pointsCost = isFinanced ? loanAmount * pointsRatio : 0;
        const financeFees = isFinanced ? lenderFees + pointsCost : 0;

        // 2. Monthly carrying costs during the hold
        // A flip carries taxes and insurance exactly like a rental does, and
        // projectPropertyTax() already derives the reassessed FLIP-basis bill.
        // Honour that figure whenever it's supplied; the flat baseline is only
        // the fallback for a blank field, so a deal that provides nothing is
        // still costed exactly as it was before.
        const baselineMonthlyCarry = strategy === 'flip'
            ? (has(inputs.monthlyTaxesIns) || has(inputs.monthlyInsurance)
                ? monthlyOwnershipCost : DEFAULTS.flipBaselineMonthlyCarry)
            : monthlyOwnershipCost;
        // Hard-money rehab funds are a HOLDBACK drawn as work completes
        const rehabHoldback = isHardMoney ? Math.min(rehabBudget, loanAmount) : 0;
        const interestOnDraws = inputs.interestOnDraws === true || inputs.interestOnDraws === 'yes' || inputs.interestOnDraws === 'draws';
        let monthlyFinancingCost = 0;
        if (isHardMoney) {
            // Most fix&flip lenders charge interest only on the drawn balance;
            // "Dutch" lenders accrue on the full note from day one. Even-draw
            // approximation: the holdback averages half-drawn across the hold.
            monthlyFinancingCost = calcInterestOnlyPayment(
                interestOnDraws ? loanAmount - rehabHoldback / 2 : loanAmount, interestRate);
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
            sellingRefiCosts = arv * sellingCostRatio;
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
            purchasePrice, rehabBudget, buyingCosts,
            baselineMonthlyCarry, sellingCostRatio,
            bindingConstraint, capShortfall, arvCapRatio
        };

        // 4. Strategy-specific return metrics
        if (strategy === 'flip') {
            const netProfit = arv - totalProjectCosts - sellingRefiCosts;
            const roi = cashInvested > 0 ? (netProfit / cashInvested) * 100 : 0;
            result.netProfit = netProfit;
            result.roi = roi;
            result.annualizedRoi = holdingPeriod > 0 ? roi * (12 / holdingPeriod) : 0;
            // Draws REIMBURSE: the investor fronts each rehab phase (≈⅓ of
            // the holdback) before money comes back, so peak cash-in-deal
            // runs above the out-of-pocket total — the number that actually
            // bounces flippers mid-project.
            result.peakCashExposure = cashInvested + rehabHoldback / 3;
        } else {
            const vacancyLoss = monthlyRent * vacancyRatio;
            const maintenanceMgmt = monthlyRent * opExRatio;
            const netOperatingIncome = monthlyRent - vacancyLoss - maintenanceMgmt - monthlyOwnershipCost;

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
            result.monthlyInsurance = monthlyInsurance;
            result.monthlyOwnershipCost = monthlyOwnershipCost;
            result.netOperatingIncome = netOperatingIncome;
            result.monthlyDebtService = monthlyDebtService;
            result.monthlyCashFlow = monthlyCashFlow;
            result.cocReturn = cashInvested > 0
                ? (monthlyCashFlow * 12 / cashInvested) * 100
                : (monthlyCashFlow > 0 ? Infinity : 0);
            // Two different ratios that both get called "DSCR", kept separate
            // because they land on opposite sides of a 1.25 cutoff.
            // dscrRatio is the ANALYST's coverage — NOI (net of vacancy and
            // opex) over debt service, the commercial 5+ unit convention.
            result.dscrRatio = monthlyDebtService > 0 ? netOperatingIncome / monthlyDebtService : Infinity;
            // lenderDscr is what a 1–4 unit DSCR lender actually underwrites:
            // gross scheduled rent over PITIA. No vacancy, no opex, no
            // management — those are the investor's problem, not the note's.
            // PITIA is only meaningful once there IS a P&I payment.
            const pitia = monthlyDebtService + monthlyOwnershipCost;
            result.pitia = pitia;
            result.lenderDscr = monthlyDebtService > 0
                ? (pitia > 0 ? monthlyRent / pitia : Infinity)
                : null;
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

                // URAR grid order: the "Sale or Financing Concessions" line
                // comes off the contract price BEFORE "Date of Sale/Time", so
                // everything below reads a CASH-EQUIVALENT basis. Only an MLS
                // feed knows concessions; scraped sources leave it 0, which
                // makes cashEquivalent === salePrice and changes nothing.
                const concessions = Math.min(num(c.concessions), salePrice);
                const cashEquivalent = salePrice - concessions;

                // Time next: percentage adjustments below apply to the
                // time-adjusted (current market) basis, per appraiser practice
                const timeAdj = cashEquivalent * (apprPct / 100) * (num(c.monthsAgo) / 12);
                const basis = cashEquivalent + timeAdj;

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
                    concessions: -concessions,
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
                    concessions,
                    cashEquivalent,
                    adjustments,
                    overlaps,
                    netAdjustment,
                    grossAdjPct,
                    adjustedValue: salePrice + netAdjustment,
                    // $/sqft off the cash-equivalent price: a $15k concession
                    // baked into the contract price overstates what the
                    // market actually paid per foot
                    pricePerSqft: num(c.sqft) > 0 ? cashEquivalent / num(c.sqft) : 0,
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

    // ---- Property-tax protest check ----
    // TX owners protest when the assessment exceeds their evidence of value
    // (purchase price and/or the comp grid — the app's adjustment table IS
    // hearing evidence). Savings use the record-derived effective rate.
    // Null unless genuinely over-assessed — no manufactured grievances.
    function protestOpportunity(inputs) {
        const assessed = num(inputs.assessedValue);
        const annualTaxes = num(inputs.annualTaxes);
        const evidence = num(inputs.evidenceValue);
        if (assessed <= 0 || annualTaxes <= 0 || evidence <= 0) return null;
        if (evidence >= assessed) return null;
        const rate = annualTaxes / assessed;
        return {
            overAssessedBy: Math.round(assessed - evidence),
            estAnnualSavings: Math.round((assessed - evidence) * rate),
            effectiveRatePct: rate * 100
        };
    }

    // ---- Hail-history read (NWS local storm reports) ----
    // severe = reports ≥1.0" within the radius over the trailing 5 years.
    // 3+ is hail-alley territory: roof-age scrutiny, ACV schedules, and
    // %-of-dwelling wind/hail deductibles all follow from it.
    function readHailHistory(summary) {
        if (!summary || !Number.isFinite(Number(summary.count))) return null;
        const severe = num(summary.countSevere);
        const radius = num(summary.radiusMi) || 3;
        const max = Number(summary.maxMag);
        const latest = summary.latest || null;
        if (severe >= 3) {
            return {
                severity: 'bad',
                label: `Hail alley: ${severe} reports ≥1.0" within ${radius} mi in 5 yrs`
                    + `${Number.isFinite(max) ? ` (max ${max}"` + (latest ? `, latest ${latest}` : '') + ')' : ''}`
                    + ' — verify roof age vs storm dates; expect %-of-dwelling hail deductibles'
            };
        }
        if (severe >= 1) {
            return {
                severity: 'info',
                label: `Hail: ${severe} report${severe === 1 ? '' : 's'} ≥1.0" within ${radius} mi in 5 yrs`
                    + `${latest ? ` (latest ${latest})` : ''} — check the roof's age against the storm dates`
            };
        }
        return { severity: 'good', label: `Hail: no ≥1.0" reports within ${radius} mi in the last 5 yrs` };
    }

    // ---- Flood-zone read (FEMA NFHL) ----
    // A*/V* zones are Special Flood Hazard Areas: flood insurance is
    // MANDATORY on any federally backed loan — a hold carry cost AND a drag
    // on every financed exit buyer. Shaded X (0.2% annual chance) is a
    // disclosure item; plain X is clean. Returns null when no zone given.
    function readFloodZone(zone, subtype) {
        if (!zone) return null;
        const z = String(zone).toUpperCase().trim();
        const sub = String(subtype || '').toUpperCase();
        if (z.charAt(0) === 'A' || z.charAt(0) === 'V') {
            return {
                severity: 'bad', sfha: true,
                label: `Flood zone ${z} — Special Flood Hazard Area: flood insurance mandatory for any financed buyer`
            };
        }
        if (z === 'X' || z === 'B' || z === 'C') {
            const shaded = z === 'B' || sub.includes('0.2') || sub.includes('LEVEE');
            return shaded
                ? { severity: 'info', sfha: false, label: `Flood zone ${z} (0.2% annual chance) — insurance optional but cheap; disclose it` }
                : { severity: 'good', sfha: false, label: `Flood zone ${z} — minimal flood hazard` };
        }
        if (z === 'D') return { severity: 'info', sfha: false, label: 'Flood zone D — risk undetermined (no flood study)' };
        return { severity: 'info', sfha: false, label: `Flood zone ${z}` };
    }

    // ---- Expansive-soil read (USDA SSURGO linear extensibility) ----
    // lep_r is the shrink-swell percentage of the dominant soil component;
    // ~6%+ is the expansive clay that moves DFW foundations. Null when the
    // survey has no number — never a guess.
    function readShrinkSwell(lepR, soilName) {
        const lep = parseFloat(lepR);
        if (!Number.isFinite(lep)) return null;
        const name = soilName ? `${soilName} soil: ` : '';
        if (lep >= 6) {
            return { severity: 'bad', level: 'high', label: `${name}HIGH shrink-swell clay (LEP ${lep}%) — budget a foundation inspection; piers run $1k–3.5k each` };
        }
        if (lep >= 3) {
            return { severity: 'info', level: 'moderate', label: `${name}moderate shrink-swell (LEP ${lep}%) — watch drainage and slab watering` };
        }
        return { severity: 'good', level: 'low', label: `${name}low shrink-swell (LEP ${lep}%)` };
    }

    // ---- Market trend (1004MC-style trailing buckets) ----
    // Buckets the trailing year's solds 0–3 / 4–6 / 7–12 months back and
    // reads direction the way an appraiser's market-conditions grid does:
    // newest non-empty bucket's median vs the oldest one, ±3% = flat.
    // asOf is injectable so tests are deterministic.
    function marketTrend(solds, asOf) {
        const now = asOf ? new Date(asOf).getTime() : Date.now();
        const median = (arr) => {
            if (!arr.length) return null;
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        const buckets = [
            { key: '0-3', label: '0–3 mo', max: 3, prices: [], doms: [] },
            { key: '4-6', label: '4–6 mo', max: 6, prices: [], doms: [] },
            { key: '7-12', label: '7–12 mo', max: 12, prices: [], doms: [] }
        ];
        (solds || []).forEach(s => {
            if (!s || !s.soldDate || !(num(s.price) > 0)) return;
            const months = (now - new Date(s.soldDate).getTime()) / (86400000 * 30.44);
            if (!Number.isFinite(months) || months < 0 || months > 12) return;
            const bucket = buckets.find(b => months < b.max) || buckets[2];
            bucket.prices.push(num(s.price));
            // Days on market only exists on a real MLS row; scraped solds
            // leave it undefined and the DOM read stays null
            if (num(s.dom) > 0) bucket.doms.push(num(s.dom));
        });
        const out = buckets.map(b => ({
            key: b.key, label: b.label, count: b.prices.length,
            medianPrice: median(b.prices), medianDom: median(b.doms)
        }));
        const newest = out.find(b => b.medianPrice != null);
        const oldest = [...out].reverse().find(b => b.medianPrice != null);
        let direction = null;
        let changePct = null;
        if (newest && oldest && newest !== oldest) {
            changePct = ((newest.medianPrice - oldest.medianPrice) / oldest.medianPrice) * 100;
            direction = changePct > 3 ? 'rising' : changePct < -3 ? 'falling' : 'flat';
        }
        // Trailing-year DOM across every bucket — the holding-period sanity
        // check a flip pro-forma needs, and null unless the feed carries it
        const allDoms = buckets.reduce((a, b) => a.concat(b.doms), []);
        return { buckets: out, direction, changePct, medianDom: median(allDoms) };
    }

    // ---- Derived market rates ----
    /**
     * Read the adjustment rates out of the comp set instead of trusting a
     * static default. The default $/sqft was 50 — a national-ish rule of
     * thumb. In a Fort Worth market trading around $300/sqft that under-
     * corrects every size difference by tens of thousands, always in the same
     * direction, and no amount of careful ranking recovers from it.
     *
     * GLA rate: the slope of price against size across the comps, which is
     * literally "what the market paid for the next square foot". Regression
     * is the right statistic but it is noisy on a handful of mixed sales, so
     * it is only trusted when there are enough points and the answer lands in
     * a defensible band; otherwise a fraction of the median $/sqft is used.
     * That fraction is the appraisal convention — extra space is worth less
     * per foot than the first foot, because land, kitchen and baths are
     * already paid for.
     *
     * Returns null when there is nothing to learn from, so callers keep their
     * own settings rather than adopting a fabricated number.
     */
    var GLA_FRACTION_OF_PPSF = 0.45;   // contributory value of extra space
    var GLA_MIN_FRACTION = 0.20;       // a slope below this is noise
    var GLA_MAX_FRACTION = 0.90;       // above this is a size-confounded fit

    function deriveMarketRates(comps) {
        const usable = (comps || []).filter(c =>
            c && num(c.salePrice) > 0 && num(c.sqft) > 0);
        if (usable.length < 3) return null;

        const prices = usable.map(c => num(c.salePrice));
        const sqfts = usable.map(c => num(c.sqft));
        const ppsfs = usable.map((c, i) => prices[i] / sqfts[i]).sort((a, b) => a - b);
        const mid = Math.floor(ppsfs.length / 2);
        const medianPpsf = ppsfs.length % 2 ? ppsfs[mid] : (ppsfs[mid - 1] + ppsfs[mid]) / 2;

        const floor = medianPpsf * GLA_MIN_FRACTION;
        const ceiling = medianPpsf * GLA_MAX_FRACTION;
        let pricePerSqftAdj = medianPpsf * GLA_FRACTION_OF_PPSF;
        let method = 'fraction';
        let rSquared = null;

        // Least-squares slope of price on sqft
        if (usable.length >= 6) {
            const n = usable.length;
            const meanX = sqfts.reduce((a, b) => a + b, 0) / n;
            const meanY = prices.reduce((a, b) => a + b, 0) / n;
            let sxy = 0, sxx = 0, syy = 0;
            for (let i = 0; i < n; i++) {
                const dx = sqfts[i] - meanX;
                const dy = prices[i] - meanY;
                sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
            }
            if (sxx > 0 && syy > 0) {
                const slope = sxy / sxx;
                rSquared = (sxy * sxy) / (sxx * syy);
                // Trust the slope only where it is both explanatory and sane.
                // A negative or wild slope means size is not what separated
                // these sales — condition or street did — and the fraction is
                // the honest fallback.
                if (rSquared >= 0.35 && slope >= floor && slope <= ceiling) {
                    pricePerSqftAdj = slope;
                    method = 'regression';
                }
            }
        }

        return {
            pricePerSqftAdj: Math.round(Math.min(Math.max(pricePerSqftAdj, floor), ceiling)),
            medianPricePerSqft: Math.round(medianPpsf),
            method,
            rSquared: rSquared === null ? null : Math.round(rSquared * 100) / 100,
            used: usable.length
        };
    }

    /**
     * How far each comp's $/sqft sits from the set's median. An appraiser
     * rejects the new-build at $505/sqft in a $270/sqft street on sight; this
     * is the number that lets the UI say the same thing out loud instead of
     * silently blending it in.
     */
    function pricePerSqftOutliers(comps, tolerancePct) {
        const usable = (comps || []).filter(c => c && num(c.salePrice) > 0 && num(c.sqft) > 0);
        if (usable.length < 3) return [];
        const ppsfs = usable.map(c => num(c.salePrice) / num(c.sqft)).sort((a, b) => a - b);
        const mid = Math.floor(ppsfs.length / 2);
        const median = ppsfs.length % 2 ? ppsfs[mid] : (ppsfs[mid - 1] + ppsfs[mid]) / 2;
        const tol = (tolerancePct === undefined ? 35 : tolerancePct) / 100;
        return usable.map(c => {
            const ppsf = num(c.salePrice) / num(c.sqft);
            const deviation = (ppsf - median) / median;
            return {
                label: c.label || c.address || '',
                pricePerSqft: Math.round(ppsf),
                deviationPct: Math.round(deviation * 1000) / 10,
                outlier: Math.abs(deviation) > tol
            };
        });
    }

    /**
     * Cross-check a condition read from listing prose against what the comp
     * actually sold for per square foot.
     *
     * The text is a WEAK signal. "Sold as-is" is boilerplate that appears on
     * renovated flips as often as on tear-downs, and reading it as "dated"
     * triggers the largest single line in the grid — a full condition uplift.
     * Observed live: a comp that sold at $373/sqft in a $317/sqft market was
     * called dated on the strength of "as-is" and adjusted UP by $140,700.
     *
     * Price per square foot is a STRONG signal. A dated house does not sell
     * meaningfully above the market rate, and a renovated one does not sell
     * far below it. Where the two disagree, believe the money, drop the text
     * read, and tell the caller so a human can look — never silently swap in
     * the opposite condition, because the price gap might be lot size, street
     * or motivation rather than condition.
     */
    function reconcileCondition(read, ppsfDeviationPct) {
        const dev = parseFloat(ppsfDeviationPct);
        if (!read) return null;
        if (!Number.isFinite(dev)) return { ...read, trusted: true };

        // "dated" ADDS value in the grid, so a comp already selling above the
        // market rate cannot be the fixer the remarks imply
        if (read.condition === 'dated' && dev > 8) {
            return {
                ...read,
                trusted: false,
                conflict: `remarks read "${read.evidence}" as dated, but it sold `
                    + `${Math.round(dev)}% ABOVE the market rate per sqft — treating condition as unverified`
            };
        }
        // "renovated" takes no uplift, so a comp selling far below the market
        // rate is suspicious in the other direction
        if (read.condition === 'renovated' && dev < -25) {
            return {
                ...read,
                trusted: false,
                conflict: `remarks read "${read.evidence}" as renovated, but it sold `
                    + `${Math.abs(Math.round(dev))}% BELOW the market rate per sqft — treating condition as unverified`
            };
        }
        return { ...read, trusted: true };
    }

    // ---- Time adjustment, derived ----
    /**
     * When was this sale's PRICE agreed? Not the close date — the contract
     * date. The lag between them runs about a month in DFW (measured: median
     * 30 days across 298 NTREIS sales), and anchoring the time adjustment on
     * the close date is therefore late by that much on every comp, in the same
     * direction, which is how a small bias becomes a systematic one.
     *
     * Falls back to close date minus a typical lag when the feed has no
     * contract date, and ignores implausible lags — a contract signed two
     * years before closing is pre-construction, not a market observation.
     */
    var TYPICAL_CONTRACT_LAG_DAYS = 30;
    var MAX_PLAUSIBLE_LAG_DAYS = 180;

    function priceAgreedAt(sale) {
        const close = Date.parse(sale && (sale.closeDate || sale.soldDate) || '');
        if (!Number.isFinite(close)) return null;
        const contract = Date.parse((sale && sale.contractDate) || '');
        if (Number.isFinite(contract)) {
            const lagDays = (close - contract) / 86400000;
            if (lagDays >= 0 && lagDays <= MAX_PLAUSIBLE_LAG_DAYS) return contract;
        }
        return close - TYPICAL_CONTRACT_LAG_DAYS * 86400000;
    }

    /** Months between a comp's agreed price and the valuation date. */
    function compMonthsAgo(sale, asOf) {
        const agreed = priceAgreedAt(sale);
        if (agreed === null) return 0;
        const at = asOf ? new Date(asOf).getTime() : Date.now();
        const months = (at - agreed) / (86400000 * 30.44);
        return months > 0 ? months : 0;
    }

    /**
     * Fit the market's own rate of change from a WIDE local sample.
     *
     * Two deliberate choices. It regresses on price PER SQUARE FOOT, because a
     * series of raw prices confounds appreciation with composition drift — if
     * the houses that sold this quarter were bigger, raw prices rise without
     * the market moving. And it trusts the slope only when it is
     * statistically distinguishable from zero (|t| > 2), because a flat market
     * fitted on noisy data will always produce SOME slope, and applying it to
     * a twelve-month-old comp turns noise into dollars.
     *
     * Returns null when it cannot support a number, so the caller keeps its
     * own setting rather than adopting a fabricated one.
     */
    function deriveTimeAdjustment(sales, asOf) {
        const at = asOf ? new Date(asOf).getTime() : Date.now();
        const pts = [];
        for (const s of sales || []) {
            const price = num(s && s.price);
            const sqft = num(s && s.sqft);
            if (!(price > 0) || !(sqft > 0)) continue;
            const agreed = priceAgreedAt(s);
            if (agreed === null) continue;
            const monthsAgo = (at - agreed) / (86400000 * 30.44);
            if (monthsAgo < 0 || monthsAgo > 36) continue;
            pts.push({ x: monthsAgo, y: Math.log(price / sqft) });
        }
        if (pts.length < 20) return null;

        // Aggregate to MONTHLY MEDIANS before fitting. Fitting the raw scatter
        // lets a handful of unusual houses set the slope: on a real 300-sale
        // Fort Worth pull that produced -25%/yr at an R-squared of 0.019 — a
        // number the t-test waved through purely because n was large. Time
        // explains very little of any single house's price, so the signal only
        // emerges once house-to-house variation is averaged away.
        const buckets = new Map();
        for (const p of pts) {
            const m = Math.floor(p.x);
            if (!buckets.has(m)) buckets.set(m, []);
            buckets.get(m).push(p.y);
        }
        const monthly = [];
        for (const [m, ys] of buckets) {
            if (ys.length < 3) continue;   // a month with two sales is not a datum
            const sorted = [...ys].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            monthly.push({
                x: m + 0.5,
                y: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
                w: ys.length
            });
        }
        if (monthly.length < 6) return null;   // fewer than six months is not a trend

        const totalW = monthly.reduce((a, p) => a + p.w, 0);
        const n = monthly.length;
        const mx = monthly.reduce((a, p) => a + p.w * p.x, 0) / totalW;
        const my = monthly.reduce((a, p) => a + p.w * p.y, 0) / totalW;
        let sxy = 0, sxx = 0, syy = 0;
        for (const p of monthly) {
            sxy += p.w * (p.x - mx) * (p.y - my);
            sxx += p.w * (p.x - mx) * (p.x - mx);
            syy += p.w * (p.y - my) * (p.y - my);
        }
        if (!(sxx > 0) || !(syy > 0)) return null;

        const slope = sxy / sxx;                 // log($/sqft) per month BACK
        const rSquared = (sxy * sxy) / (sxx * syy);
        const residualVar = Math.max(0, (syy - slope * sxy) / Math.max(1, n - 2));
        const seSlope = Math.sqrt(residualVar / sxx);

        // x counts months BACKWARD, so a rising market has a negative slope
        const toAnnual = (s) => (Math.exp(-s * 12) - 1) * 100;
        const annualPct = toAnnual(slope);

        // Judge on the CONFIDENCE INTERVAL, not a bare t-statistic. What
        // matters is not "is the slope exactly zero" — with enough points it
        // never is — but "is the range of rates this data supports narrow
        // enough to spend money on". A CI running from -18% to +4% is an
        // honest shrug, and applying its midpoint to a year-old comp would
        // turn that shrug into dollars.
        const ciLo = toAnnual(slope + 1.96 * seSlope);
        const ciHi = toAnnual(slope - 1.96 * seSlope);
        const lo = Math.min(ciLo, ciHi);
        const hi = Math.max(ciLo, ciHi);
        const excludesZero = lo > 0 || hi < 0;
        const tightEnough = (hi - lo) <= 12;      // percentage points per year
        const plausible = annualPct >= -20 && annualPct <= 30;
        const usable = excludesZero && tightEnough && plausible;

        return {
            annualPct: Math.round((usable ? annualPct : 0) * 10) / 10,
            rawAnnualPct: Math.round(annualPct * 10) / 10,
            ci95: [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10],
            usable,
            rSquared: Math.round(rSquared * 1000) / 1000,
            months: n,
            used: pts.length,
            // A flat reading is a real answer, and a common one — say so
            // rather than letting the caller mistake it for a failure
            verdict: usable
                ? (annualPct > 0 ? 'rising' : 'falling')
                : !plausible
                    ? 'fitted rate is implausible — treated as flat'
                    : !excludesZero
                        ? 'trend not distinguishable from flat'
                        : 'trend too uncertain to apply — treated as flat'
        };
    }

    // ---- Comp similarity ----
    /**
     * Score one candidate 0–100 against the subject.
     *
     * Lives here rather than in the DOM layer so the back-test scores comps
     * exactly the way the app does — a harness that ranked differently from
     * production would be measuring a model nobody runs.
     *
     * asOf lets the back-test age comps against the test sale's close date
     * instead of today, which is the whole point of an as-of reconstruction.
     *
     * The weighting used to be 40 location + 30 time + 30 similarity. Inside
     * a one-mile, twelve-month search that is almost all constant: every
     * candidate banked 45–55 points before similarity was consulted, so 30
     * points had to separate a three-foot twin from a house 25% bigger. It
     * couldn't, and the twin lost. Similarity now carries the set.
     */
    function scoreComp(subject, c, asOf) {
        const s = subject || {};
        const sSqft = num(s.sqft);
        const sBeds = num(s.beds);
        const sBaths = num(s.baths);
        const sYear = num(s.yearBuilt);
        const sGarage = num(s.garageSpaces);
        const sSingleStory = num(s.stories) === 1;
        const now = asOf ? new Date(asOf).getTime() : Date.now();

        let score = 0;

        // 1. Size — 32 pts. The dominant material fact: a $/sqft model breaks
        //    down across size classes, and every dollar of the GLA adjustment
        //    downstream is an admission that this comp was the wrong size.
        if (sSqft > 0 && c.sqft) {
            score += 32 * Math.max(0, 1 - (Math.abs(c.sqft - sSqft) / sSqft) / 0.30);
        } else {
            score += 8; // unknown size can't be trusted to the top
        }

        // 2. Location — 26 pts, fading to 0 at 2 miles
        score += (c.distanceMi != null)
            ? 26 * Math.max(0, 1 - c.distanceMi / 2)
            : 8; // unknown location = middling, never top-tier

        // 3. Time — 18 pts, fading to 0 at 12 months
        if (c.soldDate) {
            const months = (now - new Date(c.soldDate).getTime()) / (86400000 * 30.44);
            score += 18 * Math.max(0, 1 - months / 12);
        } else {
            score += 5;
        }

        // 4. Vintage — 12 pts. In a street of 1930s bungalows a 2018 new build
        //    is a different product, not a comp with an age adjustment.
        if (sYear && c.yearBuilt) score += 12 * Math.max(0, 1 - Math.abs(c.yearBuilt - sYear) / 25);

        // 5. Room count — 12 pts (beds 7, baths 5)
        if (sBeds && c.beds != null) score += 7 * Math.max(0, 1 - Math.abs(c.beds - sBeds) / 2);
        if (sBaths && c.baths != null) score += 5 * Math.max(0, 1 - Math.abs(c.baths - sBaths) / 2);

        // 6. Common-sense gates — material wrongness caps what proximity buys
        let gate = 1;
        if (sSqft > 0 && c.sqft) {
            const dev = Math.abs(c.sqft - sSqft) / sSqft;
            if (dev > 0.5) gate *= 0.25;       // different class of house
            else if (dev > 0.3) gate *= 0.55;  // stretch comp at best
        }
        if (sBeds && c.beds != null && Math.abs(c.beds - sBeds) >= 2) gate *= 0.6;
        if (sYear && c.yearBuilt && Math.abs(c.yearBuilt - sYear) > 40) gate *= 0.5;
        if (sGarage > 0 && c.garage != null && Math.abs(c.garage - sGarage) >= 2) gate *= 0.85;
        if (c.stories != null && (c.stories === 1) !== sSingleStory) gate *= 0.9;
        // A different KIND of dwelling is not a comp at any distance. The
        // worker filters sub-type server-side, but a fallback source may not.
        if (c.propType && /condo|townh|duplex|triplex|quad|mobile|manufactur|apartment/i.test(c.propType)) {
            gate *= 0.35;
        }
        // Segment mismatch: a price per foot far off the rest of the set means
        // a new build or a teardown, not a house the grid can adjust into place.
        if (c.ppsfOutlier) gate *= 0.5;

        return Math.max(0, Math.round(score * gate));
    }

    // ---- Valuation interval ----
    /**
     * How wide is the uncertainty on this particular ARV?
     *
     * The old confidence label read only the spread of the adjusted comp
     * values, so Pleasant Grove and Fort Worth southeast presented identically
     * while their measured errors differed six-fold (31% vs 5.6% MdAPE). The
     * engine can see why: the dispersion of the local price per square foot,
     * how hard the comps had to be adjusted, how many there are, and how many
     * carry a condition nobody could verify.
     *
     * This produces a RANGE rather than a decoration on a point estimate.
     * That is the honest home for everything the model cannot explain — a comp
     * set 35% apart in $/sqft should widen the band, not nudge the number.
     *
     * The multipliers below are deliberate, not fitted: the back-test measures
     * the coverage they actually deliver, and they should be re-tuned from
     * that rather than from intuition.
     */
    function valuationInterval(appraisal, context) {
        const a = appraisal || {};
        const ctx = context || {};
        const arv = num(a.arv);
        if (!(arv > 0)) return null;

        const comps = Array.isArray(a.comps) ? a.comps : [];
        const drivers = [];

        // 1. Disagreement between the adjusted comps — the base signal
        let sigma = num(a.spreadPct);
        if (sigma > 0) drivers.push(`comps disagree by ${sigma.toFixed(1)}%`);

        // 2. How hard the grid had to work. A set needing 25% gross adjustment
        //    is being argued into place, and every adjustment carries its own
        //    error on top of the comp's.
        const grossAdjs = comps.map(c => num(c.grossAdjPct)).filter(g => g > 0);
        if (grossAdjs.length) {
            const meanGross = grossAdjs.reduce((x, y) => x + y, 0) / grossAdjs.length;
            const penalty = Math.max(0, meanGross - 10) * 0.35;
            if (penalty > 0.5) {
                sigma += penalty;
                drivers.push(`comps needed ${meanGross.toFixed(0)}% gross adjustment`);
            }
        }

        // 3. Local price dispersion. A street trading between $190 and $500 a
        //    foot is telling you it is several markets wearing one postcode.
        const ppsfSpread = num(ctx.pricePerSqftSpreadPct);
        if (ppsfSpread > 25) {
            const penalty = (ppsfSpread - 25) * 0.12;
            sigma += penalty;
            drivers.push(`local $/sqft varies by ${ppsfSpread.toFixed(0)}%`);
        }

        // 4. Thin evidence
        const n = comps.length;
        if (n > 0 && n < 5) {
            sigma += (5 - n) * 1.6;
            drivers.push(`only ${n} comp${n === 1 ? '' : 's'} in the blend`);
        }

        // 5. Condition nobody could verify — the honest place for it
        const unverified = num(ctx.unverifiedComps);
        if (unverified > 0 && n > 0) {
            const penalty = 2.2 * (unverified / n) * 6;
            sigma += penalty;
            drivers.push(`${unverified} of ${n} comps have unverified condition`);
        }

        // 6. No supportable time adjustment means every older comp carries an
        //    unknown amount of market movement
        if (ctx.trendUnusable) {
            sigma += 2.5;
            drivers.push('no measurable market trend to age comps by');
        }

        // Floor: even a flawless comp set cannot pin a house to the dollar.
        // Published appraiser performance is ~60% within 10%, so a band
        // narrower than this would be claiming more than the profession does.
        sigma = Math.max(6, Math.min(35, sigma));

        const band = arv * sigma / 100;
        return {
            arv,
            low: Math.round((arv - band) / 1000) * 1000,
            high: Math.round((arv + band) / 1000) * 1000,
            sigmaPct: Math.round(sigma * 10) / 10,
            // Tiers follow Freddie's HVE convention for forecast deviation.
            // MEASURED 2026-08-27, n=84: the BAND WIDTH is roughly right
            // (77.4% coverage against a 68% target) but these TIERS RANK
            // BACKWARDS — deals labelled 'low' came in at 7.4% MdAPE against
            // 10.4% for 'high' and 'medium'. Something in the width drivers
            // correlates with data-rich neighbourhoods where the engine does
            // WELL, so the word is presently worse than no word. It is kept
            // here for the back-test to keep scoring, and the UI deliberately
            // shows the ± width instead until the ranking is earned.
            confidence: sigma <= 13 ? 'high' : sigma <= 20 ? 'medium' : 'low',
            tierIsCalibrated: false,
            drivers
        };
    }

    // ---- Back-test scoring ----
    /**
     * Accuracy statistics for a set of {estimate, actual} pairs.
     *
     * Reports the whole panel, never MdAPE alone, because each one catches a
     * failure the others miss. Two in particular:
     *
     *   COD below 5 is a RED FLAG, not a win — in ratio-study practice it
     *   means the estimates are chasing the sales they are being scored
     *   against, which is exactly what happens if an adjustment rate was
     *   fitted on a comp set containing the test property.
     *
     *   PRB catches systematic drift by price tier — over-valuing cheap
     *   houses and under-valuing expensive ones nets out to a flattering
     *   MdAPE while being wrong in both directions.
     *
     * The one-sided tail matters more here than the two-sided error: an
     * underwriter's loss is asymmetric, because over-valuing buys a bad deal
     * while under-valuing only passes on a good one.
     */
    // ---- Neighbourhood effective tax rate ----
    // projectPropertyTax() already derives the SUBJECT's rate from its own
    // bill, so the carry is right either way. What this adds is the peer
    // comparison that explains a 3.1% rate: in DFW a MUD or PID district
    // routinely adds a point or more, and it is invisible on the tax roll of
    // a comp that sits in another district. Without it, a high rate reads as
    // an assessment error worth protesting when it is simply the address.
    // Refuses under 3 usable comps rather than calling two houses a market.
    function neighborhoodTaxRate(comps) {
        if (!Array.isArray(comps)) return null;
        const rates = comps
            .filter(c => c && num(c.taxAnnual) > 0 && num(c.price || c.salePrice) > 0
                // Only a verified close price makes the ratio meaningful; a
                // list-price proxy would put a guess in the denominator.
                && (c.priceType === undefined || c.priceType === 'closed'))
            .map(c => num(c.taxAnnual) / num(c.price || c.salePrice) * 100)
            // A bill that implies under 0.5% or over 5% is a data error
            // (partial-year, exempt, or a mismatched row), not a district.
            .filter(r => r >= 0.5 && r <= 5)
            .sort((a, b) => a - b);
        if (rates.length < 3) return null;
        const mid = Math.floor(rates.length / 2);
        const median = rates.length % 2
            ? rates[mid]
            : (rates[mid - 1] + rates[mid]) / 2;
        return { medianRatePct: median, n: rates.length, low: rates[0], high: rates[rates.length - 1] };
    }

    // ---- Bracketing audit ----
    // valuationInterval() measures how much the comps disagree with EACH
    // OTHER, and scoreComp() rates each comp on its own. Neither asks the
    // question an appraiser asks first: does the set SURROUND the subject?
    // Four comps that agree closely and are all smaller than the subject
    // produce a narrow band around an EXTRAPOLATED number — a confident
    // answer to the wrong question, and the one failure mode the stated
    // interval structurally cannot see.
    function bracketingDefects(subject, comps) {
        const out = [];
        if (!subject || !Array.isArray(comps)) return out;
        const priced = comps.filter(c => c && num(c.salePrice) > 0);
        if (priced.length < 2) return out;
        const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
        const DIMS = [
            { key: 'sqft', label: 'living area', fmt: (v) => fmtInt(v) + ' sqft' },
            { key: 'yearBuilt', label: 'year built', fmt: (v) => String(Math.round(v)) },
            { key: 'lotSqft', label: 'lot size', fmt: (v) => fmtInt(v) + ' sqft' },
            { key: 'beds', label: 'bedroom count', fmt: (v) => String(num(v)) }
        ];
        DIMS.forEach(d => {
            if (!has(subject[d.key])) return;
            const s = num(subject[d.key]);
            const vals = priced.filter(c => has(c[d.key])).map(c => num(c[d.key]));
            if (vals.length < 2) return;
            const above = vals.filter(v => v > s).length;
            const below = vals.filter(v => v < s).length;
            if (above > 0 && below > 0) return;
            // An EXACT match brackets the feature on its own — that is the
            // ideal comp, not a gap. Only a set that sits entirely to one
            // side, with nothing landing on the subject, is extrapolating.
            if (vals.some(v => v === s)) return;
            const side = above === 0 ? 'smaller than' : 'larger than';
            const yearSide = above === 0 ? 'older than' : 'newer than';
            const nearest = above === 0 ? Math.max(...vals) : Math.min(...vals);
            out.push({
                dimension: d.key,
                side: above === 0 ? 'below' : 'above',
                subject: s,
                nearest,
                message: 'Every comp is ' + (d.key === 'yearBuilt' ? yearSide : side)
                    + ' the subject on ' + d.label
                    + ' (subject ' + d.fmt(s) + ', closest comp ' + d.fmt(nearest) + ').'
                    + ' The value is extrapolated on this line rather than bracketed,'
                    + ' and the stated range does not widen to account for it.'
            });
        });
        return out;
    }

    function backtestMetrics(pairs) {
        const rows = (pairs || []).filter(p =>
            p && num(p.estimate) > 0 && num(p.actual) > 0);
        const n = rows.length;
        if (!n) return null;

        const median = (arr) => {
            if (!arr.length) return null;
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };

        const ratios = rows.map(p => num(p.estimate) / num(p.actual));
        const errs = rows.map(p => (num(p.estimate) - num(p.actual)) / num(p.actual));
        const absErrs = errs.map(Math.abs);

        const medianRatio = median(ratios);
        // IAAO coefficient of dispersion: average absolute deviation from the
        // MEDIAN ratio, as a percentage of it
        const cod = 100 * (ratios.reduce((s, r) => s + Math.abs(r - medianRatio), 0) / n) / medianRatio;

        // Price-related differential: mean ratio over sales-weighted mean
        // ratio. Above 1 means cheap properties are being over-valued.
        const meanRatio = ratios.reduce((a, b) => a + b, 0) / n;
        const sumActual = rows.reduce((s, p) => s + num(p.actual), 0);
        const sumEstimate = rows.reduce((s, p) => s + num(p.estimate), 0);
        const weightedMeanRatio = sumEstimate / sumActual;
        const prd = weightedMeanRatio > 0 ? meanRatio / weightedMeanRatio : null;

        // Price-related bias: regression of percentage ratio difference on
        // log2 of value. The coefficient reads as "ratio change per doubling
        // of price", so ±0.05 is the accepted band.
        let prb = null;
        if (n >= 5) {
            const xs = [], ys = [];
            for (const p of rows) {
                const est = num(p.estimate), act = num(p.actual);
                const ratio = est / act;
                // Independent variable uses the ratio-adjusted value so the
                // dependent variable is not regressed on part of itself
                const value = (act * medianRatio + est) / 2;
                if (value > 0) {
                    xs.push(Math.log(value) / Math.LN2);
                    ys.push((ratio - medianRatio) / medianRatio);
                }
            }
            if (xs.length >= 5) {
                const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
                const my = ys.reduce((a, b) => a + b, 0) / ys.length;
                let sxy = 0, sxx = 0;
                for (let i = 0; i < xs.length; i++) {
                    sxy += (xs[i] - mx) * (ys[i] - my);
                    sxx += (xs[i] - mx) * (xs[i] - mx);
                }
                if (sxx > 0) prb = sxy / sxx;
            }
        }

        const within = (t) => 100 * rows.filter((_, i) => absErrs[i] <= t).length / n;

        return {
            n,
            medianRatio: Math.round(medianRatio * 10000) / 10000,
            mdape: Math.round(median(absErrs) * 10000) / 100,
            pe10: Math.round(within(0.10) * 10) / 10,
            pe20: Math.round(within(0.20) * 10) / 10,
            cod: Math.round(cod * 100) / 100,
            prd: prd === null ? null : Math.round(prd * 10000) / 10000,
            prb: prb === null ? null : Math.round(prb * 10000) / 10000,
            // The asymmetric tail an underwriter actually cares about
            overBy20Pct: Math.round(1000 * rows.filter((_, i) => errs[i] > 0.20).length / n) / 10,
            underBy20Pct: Math.round(1000 * rows.filter((_, i) => errs[i] < -0.20).length / n) / 10,
            medianSignedError: Math.round(median(errs) * 10000) / 100,
            // Half-width of the 95% CI for a median, in PERCENTILE points of
            // the error distribution. At n=100 the median is only pinned to
            // the 40th-60th percentile — the number that stops a 40-deal
            // MdAPE from being quoted as if it meant something.
            medianCiPercentilePoints: Math.round(10 * 98 / Math.sqrt(n)) / 10
        };
    }

    /**
     * Compare two model variants scored on the SAME test sales.
     *
     * The reason this exists: between-property variance dominates two
     * independent MdAPEs, so comparing them needs an order of magnitude more
     * sales than comparing per-sale differences does. A tool that will only
     * ever accumulate low hundreds of test sales cannot afford the former.
     *
     * Reports a sign test (distribution-free, works on tiny samples) and a
     * bootstrap CI on the median improvement.
     */
    function pairedComparison(pairsA, pairsB, opts) {
        const key = (p) => String(p.id || p.address || '');
        const mapB = new Map((pairsB || []).map(p => [key(p), p]));
        const both = [];
        for (const a of pairsA || []) {
            const b = mapB.get(key(a));
            if (!b || !(num(a.actual) > 0)) continue;
            const errA = Math.abs(num(a.estimate) - num(a.actual)) / num(a.actual);
            const errB = Math.abs(num(b.estimate) - num(b.actual)) / num(b.actual);
            both.push({ id: key(a), errA, errB, diff: errA - errB });
        }
        const n = both.length;
        if (!n) return null;

        const bWins = both.filter(d => d.diff > 0).length;
        const aWins = both.filter(d => d.diff < 0).length;
        const ties = n - bWins - aWins;

        const median = (arr) => {
            const s = [...arr].sort((x, y) => x - y);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        const diffs = both.map(d => d.diff);

        // Deterministic bootstrap: a fixed stride walk rather than a random
        // resample, so the same inputs always produce the same interval and a
        // back-test result can be reproduced exactly.
        const iterations = (opts && opts.iterations) || 2000;
        const medians = [];
        for (let i = 0; i < iterations; i++) {
            const sample = [];
            for (let j = 0; j < n; j++) {
                sample.push(diffs[(i * 7919 + j * 104729) % n]);
            }
            medians.push(median(sample));
        }
        medians.sort((x, y) => x - y);
        const lo = medians[Math.floor(iterations * 0.025)];
        const hi = medians[Math.floor(iterations * 0.975)];

        // Two-sided sign test, normal approximation with continuity correction
        const decisive = bWins + aWins;
        let z = null, significant = false;
        if (decisive >= 8) {
            z = (Math.abs(bWins - decisive / 2) - 0.5) / (Math.sqrt(decisive) / 2);
            significant = z > 1.96;
        }

        return {
            n, bWins, aWins, ties,
            medianImprovementPct: Math.round(median(diffs) * 10000) / 100,
            ci95: [Math.round(lo * 10000) / 100, Math.round(hi * 10000) / 100],
            signTestZ: z === null ? null : Math.round(z * 100) / 100,
            significant,
            // The interval straddling zero is the honest "cannot tell yet"
            verdict: !significant
                ? (decisive < 8 ? 'too few decisive pairs to call' : 'no significant difference')
                : (bWins > aWins ? 'B is better' : 'A is better')
        };
    }

    // ---- Rent from comps ----
    // Median $/sqft across usable rent comps × the subject's sqft (plain
    // median rent when the subject sqft is unknown). Rounded to $25;
    // null when nothing usable — no phantom rent.
    function rentFromComps(subject, comps) {
        const usable = (comps || []).filter(c => c && num(c.rent) > 0);
        if (!usable.length) return null;
        // A CLOSED lease is a transacted rent; an active listing is an ask.
        // When the feed carries closed leases the asks are dropped outright
        // rather than averaged in — mixing them biases the read upward.
        const closed = usable.filter(c => c.status === 'closed');
        const pool = closed.length ? closed : usable;
        const basis = closed.length ? 'closed' : 'listed';
        const median = (arr) => {
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        const sqft = num(subject && subject.sqft);
        const withSqft = pool.filter(c => num(c.sqft) > 0);
        let ppsfMedian = null;
        let estimate;
        if (sqft > 0 && withSqft.length) {
            ppsfMedian = median(withSqft.map(c => num(c.rent) / num(c.sqft)));
            estimate = ppsfMedian * sqft;
        } else {
            estimate = median(pool.map(c => num(c.rent)));
        }
        return { estimate: Math.round(estimate / 25) * 25, ppsfMedian, used: pool.length, basis };
    }

    // ---- Rehab reality helpers ----
    // Tiered scope estimate: sqft × $/sqft plus a contingency line. Returns
    // null when either driver is missing — no phantom budgets.
    function estimateRehab(inputs) {
        const sqft = num(inputs.sqft);
        const perSqft = num(inputs.perSqft);
        const contingencyRatio = num(inputs.contingencyPct) / 100;
        if (sqft <= 0 || perSqft <= 0) return null;
        const base = Math.round(sqft * perSqft);
        const contingency = Math.round(base * contingencyRatio);
        return { base, contingency, total: base + contingency };
    }

    // DFW-stock big-ticket advisories from year built — the budget-killers a
    // walkthrough checks and a spreadsheet forgets. addToBudget 0 = advisory
    // only (foundation risk isn't a number until an inspector counts piers).
    function capexFlags(inputs) {
        const yearBuilt = num(inputs.yearBuilt);
        if (yearBuilt <= 0) return [];
        const flags = [];
        if (yearBuilt <= 1975) {
            flags.push({
                key: 'castIronSewer', addToBudget: 15000,
                label: 'Cast-iron sewer era (≤1975): under-slab failures run $9k–28k in DFW (slab tunneling) — order a sewer scope (~$189) or budget the repipe.'
            });
        }
        if (yearBuilt >= 1965 && yearBuilt <= 1973) {
            flags.push({
                key: 'aluminumWiring', addToBudget: 9000,
                label: 'Aluminum branch-wiring era (1965–73): $2k–12k to remediate; many insurers surcharge or refuse it.'
            });
        }
        if (yearBuilt <= 1985) {
            flags.push({
                key: 'foundationWatch', addToBudget: 0,
                label: 'DFW expansive-clay vintage: check for stair-step brick cracks and doors out of square — piers run $1k–3.5k each, 10–40 typical.'
            });
        }
        return flags;
    }

    // ---- Max-offer back-solver ----
    // Inverts underwrite(): given the deal's other inputs and the investor's
    // floor targets, finds the highest purchase price that still meets every
    // target under the chosen financing. Profit and cash flow fall as price
    // rises (bigger loan, bigger points, bigger carry), so a binary search
    // converges and reuses the full deal model rather than approximating it.
    // Targets: flip → { targetProfit }; rental → any of
    // { targetCashFlow, minDscr, minCoC } (omitted targets aren't enforced).
    // Returns { achievable, unbounded, maxPrice, metricsAtMax }; maxPrice is
    // rounded DOWN to $100 so the answer never overshoots the target.
    function maxOffer(inputs, targets) {
        const t = targets || {};
        const has = (v) => v !== undefined && v !== null && v !== '';
        const strategy = inputs.strategy === 'rental' ? 'rental' : 'flip';
        const meets = (m) => {
            if (strategy === 'flip') return m.netProfit >= num(t.targetProfit);
            if (has(t.targetCashFlow) && !(m.monthlyCashFlow >= num(t.targetCashFlow))) return false;
            if (has(t.minDscr) && !(m.dscrRatio >= num(t.minDscr))) return false;
            if (has(t.minCoC) && !(m.cocReturn >= num(t.minCoC))) return false;
            return true;
        };
        const probe = (price) => meets(underwrite({ ...inputs, purchasePrice: price }));
        if (!probe(0)) return { achievable: false, unbounded: false, maxPrice: 0, metricsAtMax: null };
        let lo = 0;
        let hi = (num(inputs.arv) + num(inputs.rehabBudget)) * 3 + 500000;
        if (probe(hi)) {
            // Every provided target is price-independent here (e.g. all-cash
            // rental judged only on cash flow) — price doesn't bind.
            return { achievable: true, unbounded: true, maxPrice: null, metricsAtMax: null };
        }
        for (let i = 0; i < 60; i++) {
            const mid = (lo + hi) / 2;
            if (probe(mid)) lo = mid; else hi = mid;
        }
        const maxPrice = Math.floor(lo / 100) * 100;
        return {
            achievable: true, unbounded: false, maxPrice,
            metricsAtMax: underwrite({ ...inputs, purchasePrice: maxPrice })
        };
    }

    // ---- Break-even solver ----
    // The number the investor negotiates against, and the first one a partner
    // or lender asks for. Selling costs scale WITH the sale price, so the flip
    // answer is never "total costs" — it is costs grossed up by the exit
    // stack. On a hard-money deal the loan is itself a function of ARV, so
    // this re-runs the whole model by bisection rather than solving a closed
    // form that would quietly ignore that coupling.
    // Returns nulls, never guesses, when a leg does not apply.
    function breakEven(inputs) {
        const strategy = inputs.strategy === 'rental' ? 'rental' : 'flip';
        const out = {
            strategy, salePrice: null, salePriceVsArv: null,
            monthlyRent: null, rentAtDscrFloor: null, dscrFloor: null
        };
        // Finds the LOWEST value in [lo, hi] that satisfies probe(), assuming
        // probe is monotonic — false below the threshold, true above it.
        const lowestPassing = (probe, lo, hi) => {
            if (probe(lo)) return lo;
            if (!probe(hi)) return null;
            for (let i = 0; i < 60; i++) {
                const mid = (lo + hi) / 2;
                if (probe(mid)) hi = mid; else lo = mid;
            }
            return hi;
        };
        if (strategy === 'flip') {
            const rawArv = num(inputs.arv);
            const ceiling = (rawArv + num(inputs.rehabBudget) + num(inputs.purchasePrice)) * 4 + 500000;
            // Solve on the RAW sale price: the variance slider is a stress
            // test on top of a price, not part of the price being solved for.
            const v = lowestPassing(
                (price) => underwrite({ ...inputs, arv: price, variancePercent: 0 }).netProfit >= 0,
                0, ceiling);
            if (v !== null) {
                out.salePrice = Math.ceil(v / 100) * 100;
                if (rawArv > 0) out.salePriceVsArv = (out.salePrice - rawArv) / rawArv * 100;
            }
        } else {
            const ceiling = Math.max(num(inputs.monthlyRent) * 5, 25000);
            const cf = lowestPassing(
                (rent) => underwrite({ ...inputs, monthlyRent: rent }).monthlyCashFlow >= 0,
                0, ceiling);
            if (cf !== null) out.monthlyRent = Math.ceil(cf);
            // Only meaningful where a lender ratio exists at all — an all-cash
            // hold has no note to cover.
            const floor = has(inputs.minDscr) ? num(inputs.minDscr) : 1.25;
            const probeDscr = underwrite({ ...inputs, monthlyRent: ceiling });
            if (probeDscr.lenderDscr !== null && probeDscr.lenderDscr !== undefined) {
                out.dscrFloor = floor;
                const r = lowestPassing(
                    (rent) => {
                        const d = underwrite({ ...inputs, monthlyRent: rent }).lenderDscr;
                        return d !== null && d !== undefined && d >= floor;
                    }, 0, ceiling);
                if (r !== null) out.rentAtDscrFloor = Math.ceil(r);
            }
        }
        return out;
    }

    // The classic quick screen (MAO = ARV × rule% − rehab) and the flex the
    // pros apply to the rule: hot absorption supports a richer percentage,
    // a cold market demands a thinner one.
    function ruleOfThumbOffer(arv, rehabBudget, rulePct) {
        return Math.round(num(arv) * num(rulePct) / 100 - num(rehabBudget));
    }

    function suggestedRulePct(absorptionScore) {
        if (absorptionScore === null || absorptionScore === undefined || absorptionScore === '') return 70;
        const s = Number(absorptionScore);
        if (!Number.isFinite(s)) return 70;
        if (s >= 80) return 75;
        if (s >= 60) return 72;
        if (s >= 40) return 70;
        if (s >= 20) return 68;
        return 65;
    }

    // ---- Texas post-sale property-tax reassessment ----
    // TX appraisal districts chase the sale price and the seller's homestead
    // cap/exemptions do not transfer, so the seller's tax bill systematically
    // understates what the buyer will pay. Derive the effective rate from the
    // record (annualTaxes / assessedValue) and apply it to the buyer's new
    // basis. Returns null when any input is missing — never a phantom
    // projection. NOTE: the derived rate still embeds the seller's own
    // exemptions, so for a homesteaded seller the projection is a FLOOR —
    // callers should say so.
    function projectPropertyTax(inputs) {
        const assessed = num(inputs.assessedValue);
        const currentAnnual = num(inputs.annualTaxes);
        const basis = num(inputs.newBasis);
        if (assessed <= 0 || currentAnnual <= 0 || basis <= 0) return null;
        const projectedAnnual = Math.round(basis * currentAnnual / assessed);
        return {
            effectiveRatePct: (currentAnnual / assessed) * 100,
            projectedAnnual,
            projectedMonthly: Math.round(projectedAnnual / 12),
            deltaAnnual: projectedAnnual - Math.round(currentAnnual)
        };
    }

    // ---- Listing-remarks condition read ----
    // Maps listing-remarks language onto the appraisal's condition buckets.
    // Returns { condition: 'renovated'|'average'|'dated', evidence } or null
    // when the text carries no usable signal — callers keep their own default
    // and should surface that the condition is unverified.
    // Priority is deliberate: full-scope renovation language beats distress
    // language (flip resales routinely say "completely remodeled … sold
    // as-is"), and distress beats partial-update mentions.
    const RENOVATED_RX = /(?:fully|completely|totally|entirely|newly|recently|professionally|beautifully|extensively|tastefully|meticulously)[\s-]*(?:remodel|renovat|updat|restor)\w*|(?:complete|total|full|extensive)\s+(?:remodel|renovation|rehab|makeover|transformation)|reimagined|down to the studs|studs[\s-]?out|like[\s-]new condition/;
    const DATED_RX = /\bas[\s-]?is\b|fixer[\s-]?upper|\bhandyman\b|investor special|needs?\s+(?:some\s+)?(?:work|updating|updates|repairs?|renovation|rehab|tlc)|\btlc\b|sweat equity|bring your (?:vision|toolbox|contractor|ideas)|original condition|renovation[\s-]ready|great bones|(?:full|tons|lots) of potential|cash[\s-]?only|sold for lot value/;
    const PARTIAL_RX = /(?:remodel|renovat|updat|restor)\w*|new (?:roof|hvac|a\/?c|floor\w*|windows|kitchen|carpet|paint|appliances|water heater|plumbing|electrical)/;

    // A structured MLS PropertyCondition beats mining marketing prose — it's
    // the listing agent's own coded answer. Matched on substrings because the
    // enumeration differs per MLS ("Updated/Remodeled", "Fixer", "Resale"...).
    const FIELD_RENOVATED_RX = /new construction|updated|remodel|renovat|rebuilt/;
    const FIELD_DATED_RX = /fixer|tear[\s-]?down|needs? (?:work|repair)|unlivable|shell|to be (?:built|restored)/;
    const FIELD_AVERAGE_RX = /average|resale|pre[\s-]?owned|good condition|well maintained/;

    function classifyCondition(text, structured) {
        if (structured) {
            const f = String(structured).toLowerCase();
            // Order mirrors the remarks path: full-scope beats distress beats
            // "average", so a "Updated/Remodeled, Resale" multi-value reads
            // renovated rather than average
            if (FIELD_RENOVATED_RX.test(f)) return { condition: 'renovated', evidence: String(structured), from: 'field' };
            if (FIELD_DATED_RX.test(f)) return { condition: 'dated', evidence: String(structured), from: 'field' };
            if (FIELD_AVERAGE_RX.test(f)) return { condition: 'average', evidence: String(structured), from: 'field' };
        }
        if (!text) return null;
        const t = String(text).toLowerCase();
        const reno = t.match(RENOVATED_RX);
        if (reno) return { condition: 'renovated', evidence: reno[0], from: 'remarks' };
        const dated = t.match(DATED_RX);
        if (dated) return { condition: 'dated', evidence: dated[0], from: 'remarks' };
        const partial = t.match(PARTIAL_RX);
        if (partial) return { condition: 'average', evidence: partial[0], from: 'remarks' };
        return null;
    }

    return { DEFAULTS, num, calcAmortizedPayment, calcInterestOnlyPayment, underwrite, appraise, marketAbsorption, classifyCondition, projectPropertyTax, maxOffer, ruleOfThumbOffer, suggestedRulePct, estimateRehab, capexFlags, marketTrend, rentFromComps, readFloodZone, readShrinkSwell, protestOpportunity, readHailHistory,
        deriveMarketRates, pricePerSqftOutliers, reconcileCondition,
        backtestMetrics, pairedComparison, scoreComp,
        deriveTimeAdjustment, compMonthsAgo, priceAgreedAt, valuationInterval,
        breakEven, bracketingDefects, neighborhoodTaxRate };
}));

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
            // Draws REIMBURSE: the investor fronts each rehab phase (≈⅓ of
            // the holdback) before money comes back, so peak cash-in-deal
            // runs above the out-of-pocket total — the number that actually
            // bounces flippers mid-project.
            result.peakCashExposure = cashInvested + rehabHoldback / 3;
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

    return { DEFAULTS, num, calcAmortizedPayment, calcInterestOnlyPayment, underwrite, appraise, marketAbsorption, classifyCondition, projectPropertyTax, maxOffer, ruleOfThumbOffer, suggestedRulePct, estimateRehab, capexFlags, marketTrend, rentFromComps, readFloodZone, readShrinkSwell, protestOpportunity, readHailHistory };
}));

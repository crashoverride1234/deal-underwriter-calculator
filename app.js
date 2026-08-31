// Application State
let currentStrategy = 'flip'; // 'flip' or 'rental'
let chart = null;
let chartMode = null;         // which strategy the current chart instance was built for
let lastFinancingType = null; // so loan defaults only apply when the type actually changes

const Engine = window.UnderwriterEngine;

// DOM Elements
const purchasePriceInput = document.getElementById('purchase-price');
const buyingCostsInput = document.getElementById('buying-costs');
const arvInput = document.getElementById('arv');
const rehabBudgetInput = document.getElementById('rehab-budget');
const holdingPeriodInput = document.getElementById('holding-period');
const holdingPeriodLabel = document.getElementById('holding-period-label');
const financingTypeSelect = document.getElementById('financing-type');
const financingParamsDiv = document.getElementById('financing-params');
const ltvLabel = document.getElementById('ltv-label');
const loanLtvInput = document.getElementById('loan-ltv');
const interestRateInput = document.getElementById('interest-rate');
const lenderPointsInput = document.getElementById('lender-points');
const lenderFeesInput = document.getElementById('lender-fees');

// Rental Operations Elements
const rentalOperationsSection = document.getElementById('rental-operations-section');
const monthlyRentInput = document.getElementById('monthly-rent');
const vacancyRateInput = document.getElementById('vacancy-rate');
const operatingExpensesInput = document.getElementById('operating-expenses');
const monthlyTaxesInsInput = document.getElementById('monthly-taxes-ins');
const taxReassessNote = document.getElementById('tax-reassess-note');
const maoTargetProfitInput = document.getElementById('mao-target-profit');
const maoTargetCfInput = document.getElementById('mao-target-cf');
const maoMinDscrInput = document.getElementById('mao-min-dscr');
const maoMinCocInput = document.getElementById('mao-min-coc');
const maoProfitGroup = document.getElementById('mao-profit-group');
const maoResult = document.getElementById('mao-result');
const breakevenResult = document.getElementById('breakeven-result');
const monthlyInsuranceInput = document.getElementById('monthly-insurance');
const sellingCostPercentInput = document.getElementById('selling-cost-percent');
const sellingCostNote = document.getElementById('selling-cost-note');
const sellingCostGroup = document.getElementById('selling-cost-group');
const arvCapPercentInput = document.getElementById('arv-cap-percent');
const arvCapGroup = document.getElementById('arv-cap-group');
const arvCapNote = document.getElementById('arv-cap-note');
const carrySectionLabel = document.getElementById('carry-section-label');
const carryTotalNote = document.getElementById('carry-total-note');
const summaryTotalCarry = document.getElementById('summary-total-carry');
const summaryCarryLabel = document.getElementById('summary-carry-label');
const rehabTierSelect = document.getElementById('rehab-tier');
const rehabPerSqftInput = document.getElementById('rehab-per-sqft');
const rehabContingencyInput = document.getElementById('rehab-contingency');
const rehabEstimateNote = document.getElementById('rehab-estimate-note');
const capexFlagsEl = document.getElementById('capex-flags');
const drawsGroup = document.getElementById('draws-group');
const interestAccrualSelect = document.getElementById('interest-accrual');
const summaryPeakRow = document.getElementById('summary-peak-row');
const summaryPeakCash = document.getElementById('summary-peak-cash');

// Stress Test Elements
const rehabBufferSlider = document.getElementById('rehab-buffer-slider');
const rehabBufferVal = document.getElementById('rehab-buffer-val');
const varianceSlider = document.getElementById('variance-slider');
const varianceVal = document.getElementById('variance-val');
const sliderVarianceLabel = document.getElementById('slider-variance-label');

// Summary & Scorecard Elements
const scorecardBanner = document.getElementById('deal-scorecard');
const scorecardIcon = document.getElementById('scorecard-icon');
const scorecardText = document.getElementById('scorecard-text');
const scorecardSubtext = document.getElementById('scorecard-subtext');
const metricsContainer = document.getElementById('metrics-container');

const summaryTotalCapital = document.getElementById('summary-total-capital');
const summaryCashInvested = document.getElementById('summary-cash-invested');
const summaryLoanAmount = document.getElementById('summary-loan-amount');
const summaryMonthlyHoldingCost = document.getElementById('summary-monthly-holding-cost');
const summaryTotalFinanceCosts = document.getElementById('summary-total-finance-costs');
const summarySellingCosts = document.getElementById('summary-selling-costs');
const summaryLeverageLabel = document.getElementById('summary-leverage-label');

// Inline SVGs for icons that change at runtime (Lucide's createIcons replaces
// <i> tags with static SVGs, so swapping data-lucide afterwards has no effect)
const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
    arrowUp: `<svg ${SVG_ATTRS}><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`,
    arrowDown: `<svg ${SVG_ATTRS}><path d="m7 7 10 10"/><path d="M17 7v10H7"/></svg>`,
    check: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`,
    warning: `<svg ${SVG_ATTRS}><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    cross: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`
};

// Financing Options per strategy
const FINANCING_OPTIONS = {
    flip: [
        { value: 'cash', text: 'All Cash' },
        { value: 'hard_money', text: 'Hard Money Loan' },
        { value: 'private_money', text: 'Private Money Loan' }
    ],
    rental: [
        { value: 'cash', text: 'All Cash' },
        { value: 'dscr_purchase', text: 'DSCR Purchase Loan' },
        { value: 'dscr_refi', text: 'Cash Buy -> DSCR Refi (BRRRR)' }
    ]
};

// Typical loan terms + labels, applied once when the user picks a new financing type
const LOAN_TYPE_CONFIG = {
    hard_money: { ltv: 85, rate: 10.5, points: 2.0, ltvLabel: 'Loan-to-Cost (LTC)', summaryLabel: 'Hard/Private Loan:' },
    private_money: { ltv: 85, rate: 10.5, points: 2.0, ltvLabel: 'Loan-to-Cost (LTC)', summaryLabel: 'Hard/Private Loan:' },
    dscr_purchase: { ltv: 75, rate: 7.5, points: 1.0, ltvLabel: 'Loan-to-Value (LTV)', summaryLabel: 'DSCR Purchase Loan:' },
    dscr_refi: { ltv: 75, rate: 7.5, points: 1.0, ltvLabel: 'Refi LTV', summaryLabel: 'DSCR Refi Loan:' }
};

// Metric card templates; values are filled in by reference on every recalc
const METRIC_CARDS = {
    flip: [
        { key: 'netProfit', title: 'Net Profit' },
        { key: 'cashInvested', title: 'Out-of-Pocket Cash' },
        { key: 'roi', title: 'Project ROI' },
        { key: 'annualizedRoi', title: 'Annualized ROI' }
    ],
    rental: [
        { key: 'monthlyCashFlow', title: 'Monthly Cash Flow' },
        { key: 'cashInvested', title: 'Cash Left in Deal' },
        { key: 'cocReturn', title: 'Cash-on-Cash Return' },
        { key: 'dscrRatio', title: 'DSCR Ratio' }
    ]
};
let metricRefs = {}; // key -> { card, value, trendIcon, trendText, trend }

// Build the four KPI cards once per strategy; recalcs only touch text/classes
function buildMetricCards(strategy) {
    metricsContainer.innerHTML = '';
    metricRefs = {};
    METRIC_CARDS[strategy].forEach(def => {
        const card = document.createElement('div');
        card.className = 'metric-card';
        card.innerHTML = `
            <div class="metric-title">${def.title}</div>
            <div class="metric-value">&nbsp;</div>
            <div class="metric-trend"><span class="trend-icon"></span><span class="trend-text"></span></div>
        `;
        metricsContainer.appendChild(card);
        metricRefs[def.key] = {
            card,
            value: card.querySelector('.metric-value'),
            trend: card.querySelector('.metric-trend'),
            trendIcon: card.querySelector('.trend-icon'),
            trendText: card.querySelector('.trend-text')
        };
    });
}

function setMetric(key, { value, cardClass, trendClass, trendIcon = '', trendText = '' }) {
    const ref = metricRefs[key];
    if (!ref) return;
    ref.value.textContent = value;
    ref.card.className = `metric-card ${cardClass}`;
    ref.trend.className = `metric-trend ${trendClass}`;
    if (ref.trendIcon.innerHTML !== trendIcon) ref.trendIcon.innerHTML = trendIcon;
    ref.trendText.textContent = trendText;
}

function setScorecard(state, icon, text, subtext) {
    scorecardBanner.className = `scorecard-banner ${state}`;
    scorecardIcon.innerHTML = icon;
    scorecardText.textContent = text;
    scorecardSubtext.textContent = subtext;
}

// Switch active investment strategy
function switchStrategy(strategy) {
    currentStrategy = strategy;

    document.getElementById('strategy-flip-btn').classList.toggle('active', strategy === 'flip');
    document.getElementById('strategy-rental-btn').classList.toggle('active', strategy === 'rental');

    if (strategy === 'flip') {
        holdingPeriodLabel.textContent = 'Project Hold Period';
        sliderVarianceLabel.textContent = 'ARV Market Variance';
        rentalOperationsSection.classList.add('hidden');
        // A flip carries taxes and insurance through the hold exactly like a
        // rental does — the section stays visible, only its framing changes.
        carrySectionLabel.textContent = 'Monthly Carrying Costs (during the flip)';
        summaryCarryLabel.textContent = 'Total Carry (hold period):';
    } else {
        holdingPeriodLabel.textContent = 'Rehab/Stabilization Hold';
        sliderVarianceLabel.textContent = 'Appraised Value Variance';
        rentalOperationsSection.classList.remove('hidden');
        carrySectionLabel.textContent = 'Monthly Ownership Costs';
        summaryCarryLabel.textContent = 'Total Carry (stabilization):';
    }
    // Selling costs are a flip exit; a rental's refi closing costs are derived
    sellingCostGroup.classList.toggle('hidden', strategy === 'rental');
    maoProfitGroup.classList.toggle('hidden', strategy === 'rental');
    document.querySelectorAll('.mao-rental').forEach(el => el.classList.toggle('hidden', strategy !== 'rental'));

    buildMetricCards(strategy);
    populateFinancingDropdown();

    // Reset stress-test sliders
    rehabBufferSlider.value = 0;
    rehabBufferVal.textContent = '+0 months';
    varianceSlider.value = 0;
    varianceVal.textContent = '0%';

    calculateDeal();
}

function populateFinancingDropdown() {
    financingTypeSelect.innerHTML = '';
    FINANCING_OPTIONS[currentStrategy].forEach(opt => {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.text;
        financingTypeSelect.appendChild(el);
    });
    lastFinancingType = financingTypeSelect.value; // 'cash'
    refreshFinancingUI();
}

// Called on user dropdown change: apply that loan type's typical terms once
function handleFinancingChange() {
    const type = financingTypeSelect.value;
    if (type !== lastFinancingType) {
        const config = LOAN_TYPE_CONFIG[type];
        if (config) {
            loanLtvInput.value = config.ltv;
            interestRateInput.value = config.rate;
            lenderPointsInput.value = config.points;
        }
        lastFinancingType = type;
    }
    refreshFinancingUI();
    calculateDeal();
}

function refreshFinancingUI() {
    const type = financingTypeSelect.value;
    // Draw-vs-Dutch interest only exists where the rehab rides in the loan
    drawsGroup.classList.toggle('hidden', type !== 'hard_money' && type !== 'private_money');
    // The ARV ceiling only exists on a hard/private money note
    arvCapGroup.classList.toggle('hidden', type !== 'hard_money' && type !== 'private_money');
    if (type === 'cash') {
        financingParamsDiv.classList.add('hidden');
        summaryLeverageLabel.textContent = 'Financed Loan Amount:';
    } else {
        financingParamsDiv.classList.remove('hidden');
        const config = LOAN_TYPE_CONFIG[type];
        if (config) {
            ltvLabel.textContent = config.ltvLabel;
            summaryLeverageLabel.textContent = config.summaryLabel;
        }
    }
}

// Gather raw input values; the engine sanitizes them
function readInputs() {
    return {
        strategy: currentStrategy,
        purchasePrice: purchasePriceInput.value,
        buyingCosts: buyingCostsInput.value,
        arv: arvInput.value,
        rehabBudget: rehabBudgetInput.value,
        holdingPeriod: holdingPeriodInput.value,
        financingType: financingTypeSelect.value,
        ltvPercent: loanLtvInput.value,
        interestRate: interestRateInput.value,
        lenderPointsPercent: lenderPointsInput.value,
        lenderFees: lenderFeesInput.value,
        rehabBufferMonths: rehabBufferSlider.value,
        variancePercent: varianceSlider.value,
        monthlyRent: monthlyRentInput.value,
        vacancyPercent: vacancyRateInput.value,
        operatingExpensesPercent: operatingExpensesInput.value,
        monthlyTaxesIns: monthlyTaxesInsInput.value,
        monthlyInsurance: monthlyInsuranceInput.value,
        sellingCostPercent: sellingCostPercentInput.value,
        arvCapPercent: arvCapPercentInput.value,
        minDscr: maoMinDscrInput.value,
        interestOnDraws: interestAccrualSelect.value
    };
}

function calculateDeal() {
    const m = Engine.underwrite(readInputs());
    if (m.strategy === 'flip') {
        updateFlipUI(m);
    } else {
        updateRentalUI(m);
    }
    updateSummary(m);
    updateFlipAdvisories(m);
    updateTaxProjection();
    updateMaxOffer();
    updateBreakEven();
    updateHoaGate();
    updateProtestNote(); // purchase price is protest evidence
}

// Max-offer back-solver: the daily question is "what do I offer", so run
// the model in reverse — floor targets in, highest workable price out —
// with the 70%-rule screen beside it, flexed by live market temperature.
// The floor, stated as a number. The chart has always drawn a break-even
// segment but never labelled it, and it approximated the figure by ignoring
// that selling costs scale WITH the sale price.
function updateBreakEven() {
    const inputs = readInputs();
    const b = Engine.breakEven(inputs);
    breakevenResult.innerHTML = '';
    const line = (text, cls) => {
        const d = document.createElement('div');
        if (cls) d.className = cls;
        d.textContent = text;
        breakevenResult.appendChild(d);
        return d;
    };
    if (b.strategy === 'flip') {
        if (b.salePrice === null) {
            line('Break-even sale price: not reachable at any price with these costs.');
            return;
        }
        line('Break-even sale price', 'mao-label');
        line(formatCurrency(b.salePrice), 'mao-price');
        const arv = Engine.num(arvInput.value);
        if (arv > 0) {
            const cushion = arv - b.salePrice;
            const pct = Math.abs(b.salePriceVsArv);
            line(cushion >= 0
                ? `${formatCurrency(cushion)} below your ${formatCurrency(arv)} ARV `
                  + `— the market can fall ${pct.toFixed(1)}% before this deal loses money.`
                : `${formatCurrency(-cushion)} ABOVE your ${formatCurrency(arv)} ARV `
                  + `— you must beat your own ARV by ${pct.toFixed(1)}% just to break even.`,
                cushion >= 0 ? '' : 'mao-warn');
        }
    } else {
        if (b.monthlyRent === null) {
            line('Break-even rent: not reachable at any rent with these costs.');
            return;
        }
        line('Break-even rent', 'mao-label');
        line(formatCurrency(b.monthlyRent) + '/mo', 'mao-price');
        const actual = Engine.num(monthlyRentInput.value);
        if (actual > 0) {
            const cushion = actual - b.monthlyRent;
            line(cushion >= 0
                ? `${formatCurrency(cushion)}/mo of cushion above break-even.`
                : `${formatCurrency(-cushion)}/mo SHORT of break-even.`,
                cushion >= 0 ? '' : 'mao-warn');
        }
        if (b.rentAtDscrFloor !== null) {
            line(`A ${b.dscrFloor} DSCR needs ${formatCurrency(b.rentAtDscrFloor)}/mo `
                + `(gross rent ÷ PITIA — the ratio the lender actually runs).`);
        }
    }
}

function updateMaxOffer() {
    const arv = Engine.num(arvInput.value);
    if (arv <= 0) {
        maoResult.textContent = 'Set an ARV above (or send one over from the ARV page) and the max offer computes here.';
        return;
    }
    const inputs = readInputs();
    const targets = currentStrategy === 'rental'
        ? { targetCashFlow: maoTargetCfInput.value, minDscr: maoMinDscrInput.value, minCoC: maoMinCocInput.value }
        : { targetProfit: maoTargetProfitInput.value };
    const r = Engine.maxOffer(inputs, targets);

    maoResult.innerHTML = '';
    if (!r.achievable) {
        maoResult.textContent = 'No purchase price meets these targets — even at $0 the other costs eat the return. Ease a target or rework the deal.';
        return;
    }
    if (r.unbounded) {
        maoResult.textContent = 'These targets never bind the price (all-cash cash flow doesn\'t move with it) — set a cash-on-cash floor to get a max offer.';
        return;
    }

    const price = document.createElement('div');
    price.className = 'mao-price';
    price.textContent = formatCurrency(r.maxPrice);
    maoResult.appendChild(price);

    const m = r.metricsAtMax;
    const at = document.createElement('div');
    at.textContent = currentStrategy === 'rental'
        ? `at that price: ${formatCurrency(m.monthlyCashFlow)}/mo cash flow · `
          + `${Number.isFinite(m.dscrRatio) ? m.dscrRatio.toFixed(2) + ' DSCR' : 'no debt'} · `
          + `${Number.isFinite(m.cocReturn) ? m.cocReturn.toFixed(1) + '% CoC' : '∞ CoC'}`
        : `at that price: ${formatCurrency(m.netProfit)} profit · ${m.roi.toFixed(1)}% ROI`;
    maoResult.appendChild(at);

    if (currentStrategy === 'flip') {
        const abs = Engine.marketAbsorption({
            activeListings: mktActivesInput.value,
            pendingListings: mktPendingsInput.value,
            soldLast90Days: mktSold90Input.value
        });
        const known = abs.temperature !== 'unknown';
        const pct = Engine.suggestedRulePct(known ? abs.score : null);
        const rule = document.createElement('div');
        rule.textContent = `${pct}%-rule check: ${formatCurrency(Engine.ruleOfThumbOffer(arv, rehabBudgetInput.value, pct))} `
            + `(${pct}% of ARV − rehab${known ? `, ${abs.temperature} market` : ', default — fill the market meter to flex it'})`;
        maoResult.appendChild(rule);
    }

    const cur = Engine.num(purchasePriceInput.value);
    if (cur > 0) {
        const verdict = document.createElement('div');
        const under = r.maxPrice - cur;
        verdict.className = 'mao-verdict ' + (under >= 0 ? 'good' : 'bad');
        verdict.textContent = under >= 0
            ? (under === 0 ? '✓ current price sits exactly at your max'
                           : `✓ current price is ${formatCurrency(under)} under your max`)
            : `✗ current price exceeds your max by ${formatCurrency(-under)}`;
        maoResult.appendChild(verdict);
    }

    if (cur !== r.maxPrice) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = `Use ${formatCurrency(r.maxPrice)} as Purchase Price`;
        btn.addEventListener('click', () => {
            purchasePriceInput.value = r.maxPrice;
            purchaseEnteredForSubject = true; // deliberate act — counts as evidence
            calculateDeal();
        });
        maoResult.appendChild(btn);
    }
}

// ==================== Property-Tax Protest Check ====================
// The appraisal grid is literally protest evidence: when the county's
// assessed value exceeds the user's evidence of value (purchase price or
// the comp-derived value, whichever is LOWER), surface the case and print
// the packet. TX deadline: May 15 or 30 days after the appraisal notice.

const protestNote = document.getElementById('protest-note');

// The purchase price only counts as protest evidence if the user typed it
// for THIS subject — the calculator field survives subject switches (and
// ships a demo default), and a stale price must never end up in a packet
// handed to a review board.
let purchaseEnteredForSubject = false;

function updateProtestNote() {
    const arv = lastAppraisal && lastAppraisal.arv > 0 ? lastAppraisal.arv : 0;
    const price = purchaseEnteredForSubject ? Engine.num(purchasePriceInput.value) : 0;
    const candidates = [arv, price].filter(v => v > 0);
    const evidence = candidates.length ? Math.min(...candidates) : 0;
    const p = Engine.protestOpportunity({
        assessedValue: subjectAssessedValueInput.value,
        annualTaxes: subjectAnnualTaxesInput.value,
        evidenceValue: evidence
    });
    if (!p) {
        protestNote.classList.add('hidden');
        protestNote.innerHTML = '';
        return;
    }
    const basis = (price > 0 && price <= arv) || arv <= 0 ? 'purchase price' : 'comp-grid value';
    protestNote.innerHTML = '';
    protestNote.append('Protest check: county assessed '
        + `${formatCurrency(Engine.num(subjectAssessedValueInput.value))} vs your ${basis} ${formatCurrency(evidence)} — `);
    const fig = document.createElement('span');
    fig.className = 'tax-figure';
    fig.textContent = `over-assessed by ${formatCurrency(p.overAssessedBy)} ≈ ${formatCurrency(p.estAnnualSavings)}/yr`;
    protestNote.appendChild(fig);
    protestNote.append(` at the ${p.effectiveRatePct.toFixed(2)}% rate. Deadline: May 15 (or 30 days after the notice).`);
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'margin-left: 0.4rem; padding: 0.15rem 0.6rem; font-size: 0.72rem;';
        btn.textContent = 'Print protest packet';
        btn.addEventListener('click', () => printProtestPacket(p, evidence, basis));
        protestNote.appendChild(btn);
    }
    protestNote.classList.remove('hidden');
}

// Which comps on the grid carry a price that came out of the MLS feed.
// Only the app's own provenance is knowable here — a price the user copied
// out of Matrix by hand looks identical to one they got off a sign, which is
// why the packet says so rather than claiming the filter is complete.
function mlsSourcedCompLabels() {
    const set = new Set();
    appraisalComps.forEach(c => {
        if (c.priceType === 'closed' && c.priceSource) set.add(normalizeAddr(c.label));
    });
    set.delete('');
    return set;
}

// Printable evidence packet: built into a hidden div and printed via the
// app's existing window.print() pattern (a body class flips the print CSS
// to show ONLY the packet — no popups, so no popup blockers). All user
// data goes in via textContent — nothing user-typed touches innerHTML.
function printProtestPacket(p, evidence, basis) {
    const packet = document.getElementById('protest-packet');
    packet.innerHTML = '';
    const el = (tag, text, parent) => {
        const e = document.createElement(tag);
        if (text) e.textContent = text;
        (parent || packet).appendChild(e);
        return e;
    };
    el('h1', 'Property Tax Protest — Evidence Summary');
    el('div', subjectAddressInput.value.trim()).className = 'big';
    const apn = subjectApnInput.value.trim();
    el('div', `${apn ? 'Account/APN: ' + apn + ' · ' : ''}Prepared ${new Date().toLocaleDateString()}`).className = 'muted';

    el('h2', 'The case');
    el('div', `County assessed value: ${formatCurrency(Engine.num(subjectAssessedValueInput.value))}`);
    el('div', `Owner's evidence of market value (${basis === 'comp-grid value'
        ? 'comparable grid, adjusted to renovated standard — an upper bound; the as-is value runs lower by remaining repair costs'
        : basis}): ${formatCurrency(evidence)}`);
    el('div', `Over-assessment: ${formatCurrency(p.overAssessedBy)} — estimated tax impact ${formatCurrency(p.estAnnualSavings)}/yr at the ${p.effectiveRatePct.toFixed(2)}% effective rate.`).className = 'big';

    // The adjustment grid only prints when it SUPPORTS the case — a grid
    // indicating more than the assessment would contradict the price
    // evidence on the same page (that deal is an equity protest, not value)
    const assessedNow = Engine.num(subjectAssessedValueInput.value);
    const gridComps = (lastAppraisal && lastAppraisal.arv > 0 && lastAppraisal.arv < assessedNow
        && lastAppraisal.comps) || [];
    // MLS sale prices are CONFIDENTIAL under the NTREIS rules (Texas
    // non-disclosure), and a licensee may not hand them to an unauthorized
    // party as supporting documentation — an ARB panel is exactly that.
    // The derived value conclusion IS permitted, so the packet keeps the
    // conclusion and withholds the licensed line items rather than
    // withholding the whole case.
    const restricted = mlsSourcedCompLabels();
    const printable = gridComps.filter(c => !restricted.has(normalizeAddr(c.label)));
    const withheld = gridComps.length - printable.length;

    if (printable.length) {
        el('h2', 'Comparable sales (adjusted to renovated standard)');
        const table = el('table');
        const thead = el('thead', null, table);
        const hrow = el('tr', null, thead);
        ['Comparable', 'Sale price', 'Net adj.', 'Adjusted value', 'Weight'].forEach(h => el('th', h, hrow));
        const tbody = el('tbody', null, table);
        printable.forEach((c, i) => {
            const row = el('tr', null, tbody);
            el('td', c.label || `Comp ${i + 1}`, row);
            el('td', formatCurrency(c.salePrice), row);
            el('td', (c.netAdjustment >= 0 ? '+' : '') + formatCurrency(c.netAdjustment), row);
            el('td', formatCurrency(c.adjustedValue), row);
            el('td', '×' + c.weight.toFixed(2), row);
        });
    }
    if (gridComps.length) {
        el('div', `Indicated value from the grid: ${formatCurrency(lastAppraisal.arv)} `
            + `(range ${formatCurrency(lastAppraisal.low)}–${formatCurrency(lastAppraisal.high)}).`);
    }
    if (withheld > 0) {
        el('h2', 'Withheld comparables');
        el('div', `${withheld} of the ${gridComps.length} comparables behind the value above came from the MLS feed. `
            + 'Their sale prices are confidential MLS data and are deliberately not itemized here: a licensee may use them '
            + 'to derive an opinion of value and state that conclusion, but may not supply MLS sale prices to a third '
            + 'party as supporting documentation. To put those sales in front of the panel, ask the appraisal district '
            + 'to obtain them from NTREIS directly, or re-source them from records you may disclose.').className = 'muted';
    }

    el('h2', 'Notes');
    el('div', (withheld === gridComps.length && gridComps.length
        ? 'The value above is the licensee\'s own opinion derived from comparable sales. '
        : 'Texas is a non-disclosure state: itemized prices above are list-at-sale proxies unless verified against MLS. ')
        + 'Verify each comparable in NTREIS Matrix before the hearing. Protest deadline is May 15 or 30 days after '
        + 'the appraisal notice, whichever is later.').className = 'muted';

    document.body.classList.add('protest-print');
    const cleanup = () => document.body.classList.remove('protest-print');
    window.addEventListener('afterprint', cleanup, { once: true });
    // Backstop scheduled BEFORE print(): a throwing print() (job conflict,
    // sandbox) must not leave the class stuck — Export PDF would then print
    // the stale packet instead of the app.
    setTimeout(cleanup, 2500);
    try { window.print(); } catch (e) { cleanup(); }
}

// Rehab scope estimator + DFW big-ticket capex flags. The estimate line
// reads the subject's sqft; the flags read its year built. One-click
// buttons push numbers into the rehab budget — nothing applies silently.
const capexAdded = new Set();
let lastCapexYear = null;

function updateRehabEstimator() {
    const sqft = Engine.num(subjectSqftInput.value);
    const est = Engine.estimateRehab({
        sqft, perSqft: rehabPerSqftInput.value, contingencyPct: rehabContingencyInput.value
    });
    rehabEstimateNote.innerHTML = '';
    if (!est) {
        rehabEstimateNote.textContent = sqft > 0
            ? 'Set a $/sqft to estimate the rehab from scope.'
            : 'Fill the subject\'s living area on step 1 and the scope estimator prices the rehab from sqft.';
        rehabEstimateNote.classList.remove('hidden');
    } else {
        rehabEstimateNote.append(
            `${sqft.toLocaleString()} sqft × ${formatCurrency(Engine.num(rehabPerSqftInput.value))}/sqft `
            + `+ ${Engine.num(rehabContingencyInput.value)}% contingency = `
        );
        const fig = document.createElement('span');
        fig.className = 'tax-figure';
        fig.textContent = formatCurrency(est.total);
        rehabEstimateNote.appendChild(fig);
        rehabEstimateNote.append(' (10% when inspected, 20% sight-unseen)');
        if (Engine.num(rehabBudgetInput.value) !== est.total) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.textContent = 'Use as Rehab Budget';
            btn.addEventListener('click', () => {
                rehabBudgetInput.value = est.total;
                calculateDeal();
                updateRehabEstimator();
            });
            rehabEstimateNote.appendChild(btn);
        }
        rehabEstimateNote.classList.remove('hidden');
    }

    // Big-ticket era advisories from the subject's year built
    const year = Engine.num(subjectYearInput.value);
    if (year !== lastCapexYear) { capexAdded.clear(); lastCapexYear = year; }
    capexFlagsEl.innerHTML = '';
    Engine.capexFlags({ yearBuilt: year }).forEach(f => {
        const row = document.createElement('div');
        row.className = 'appraisal-warning';
        row.append(`⚠ ${f.label}`);
        if (f.addToBudget > 0) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.style.cssText = 'margin-left: 0.4rem; padding: 0.12rem 0.55rem; font-size: 0.7rem;';
            if (capexAdded.has(f.key)) {
                btn.disabled = true;
                btn.textContent = `+${formatCurrency(f.addToBudget)} added ✓`;
            } else {
                btn.textContent = `+${formatCurrency(f.addToBudget)} to rehab`;
                btn.addEventListener('click', () => {
                    rehabBudgetInput.value = Engine.num(rehabBudgetInput.value) + f.addToBudget;
                    capexAdded.add(f.key);
                    calculateDeal();
                    updateRehabEstimator();
                });
            }
            row.appendChild(btn);
        }
        capexFlagsEl.appendChild(row);
    });
}

// TX reassessment: the seller's tax bill understates the buyer's — the
// county chases the sale price and homestead exemptions don't transfer.
// Live projection under the taxes input; one click adopts it. Flip basis is
// the purchase price (what you carry during the hold); rental basis is the
// stabilized value (the county will find the renovation).
function updateTaxProjection() {
    const price = Engine.num(purchasePriceInput.value);
    const basis = currentStrategy === 'rental'
        ? Math.max(price, Engine.num(arvInput.value))
        : price;
    const proj = Engine.projectPropertyTax({
        assessedValue: subjectAssessedValueInput.value,
        annualTaxes: subjectAnnualTaxesInput.value,
        newBasis: basis
    });
    if (!proj) {
        taxReassessNote.classList.add('hidden');
        taxReassessNote.innerHTML = '';
        return;
    }
    const sellerAnnual = Engine.num(subjectAnnualTaxesInput.value);
    const hoaMonthly = Math.round(Engine.num(subjectHoaFeeInput.value));
    const target = proj.projectedMonthly + hoaMonthly;
    const inUse = Math.abs(Engine.num(monthlyTaxesInsInput.value) - target) <= 1;
    const down = proj.deltaAnnual < 0;

    taxReassessNote.innerHTML = '';
    taxReassessNote.append(
        `TX reassessment — seller pays ${formatCurrency(sellerAnnual)}/yr; at your `
        + `${formatCurrency(basis)} ${currentStrategy === 'rental' ? 'stabilized basis' : 'purchase'} expect `
    );
    const fig = document.createElement('span');
    fig.className = 'tax-figure' + (down ? ' down' : '');
    fig.textContent = `${formatCurrency(proj.projectedAnnual)}/yr`
        + ` (${proj.effectiveRatePct.toFixed(2)}% eff. rate → ${formatCurrency(target)}/mo${hoaMonthly ? ' incl. HOA' : ''})`;
    taxReassessNote.appendChild(fig);
    if (down) {
        taxReassessNote.append('. Assessed above your basis — protest candidate.');
    } else if (subjectOwnerOccupiedInput.value === 'yes') {
        taxReassessNote.append('. Seller looks homesteaded, so treat this as a floor.');
    } else {
        taxReassessNote.append('.');
    }
    if (inUse) {
        const ok = document.createElement('span');
        ok.className = 'tax-applied';
        ok.textContent = ' ✓ in use';
        taxReassessNote.appendChild(ok);
    } else {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = `Use ${formatCurrency(target)}/mo`;
        btn.addEventListener('click', () => {
            monthlyTaxesInsInput.value = target;
            calculateDeal();
        });
        taxReassessNote.appendChild(btn);
    }
    // Explain an unexpected rate before the user protests an address rather
    // than an assessment. Only meaningful against verified closed prices.
    const nb = compsMeta.taxRate;
    if (nb && compsMeta.priceTruth === 'closed') {
        const gap = proj.effectiveRatePct - nb.medianRatePct;
        const line = document.createElement('div');
        line.className = 'comp-adj-foot';
        if (Math.abs(gap) < 0.25) {
            line.textContent = `Nearby closed sales carry a median ${nb.medianRatePct.toFixed(2)}% `
                + `effective rate across ${nb.n} comps — this property is in line with its neighbours.`;
        } else if (gap > 0) {
            line.textContent = `This rate runs ${gap.toFixed(2)} points ABOVE the `
                + `${nb.medianRatePct.toFixed(2)}% median of ${nb.n} nearby closed sales. In DFW that `
                + `usually means a MUD or PID district rather than a bad assessment — check the tax `
                + `bill's line items before budgeting a protest win.`;
        } else {
            line.textContent = `This rate runs ${Math.abs(gap).toFixed(2)} points BELOW the `
                + `${nb.medianRatePct.toFixed(2)}% median of ${nb.n} nearby closed sales — confirm no `
                + `exemption is still riding on the seller's bill.`;
        }
        taxReassessNote.appendChild(line);
    }

    // This figure is taxes (+ HOA) only — it has never included insurance.
    // Insurance now has its own field precisely so adopting this can't quietly
    // zero it out, but a blank one still understates PITIA and the carry.
    if (!hasValue(monthlyInsuranceInput.value)) {
        const ins = document.createElement('span');
        ins.className = 'tax-hint';
        ins.textContent = ' Insurance is separate and currently blank —'
            + ' add it or the carry and any DSCR are understated.';
        taxReassessNote.appendChild(ins);
    }
    taxReassessNote.classList.remove('hidden');
}

// Formatting helpers
function formatCurrency(val) {
    if (!Number.isFinite(val)) return '$0';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    }).format(val);
}

function formatPercent(val) {
    if (val === Infinity) return 'Infinite';
    if (!Number.isFinite(val)) return '0.0%';
    return val.toFixed(1) + '%';
}

// Shared financial summary card
function updateSummary(m) {
    summaryTotalCapital.textContent = formatCurrency(m.totalProjectCosts + m.sellingRefiCosts);
    summaryCashInvested.textContent = formatCurrency(m.cashInvested);
    // Flips only: what the investor fronts at the worst moment (draw reimbursement lag)
    summaryPeakRow.classList.toggle('hidden', m.peakCashExposure === undefined);
    if (m.peakCashExposure !== undefined) summaryPeakCash.textContent = formatCurrency(m.peakCashExposure);
    summaryLoanAmount.textContent = formatCurrency(m.loanAmount);
    summaryMonthlyHoldingCost.textContent = formatCurrency(m.monthlyHoldingCost);
    // The monthly figure was always shown; the total it compounds to never was
    summaryTotalCarry.textContent = formatCurrency(m.totalHoldingCarryingCosts);
    summaryTotalFinanceCosts.textContent = formatCurrency(m.financeFees);
    summarySellingCosts.textContent = formatCurrency(m.sellingRefiCosts);

    // Say out loud which carry figure is being used, and where it came from
    const usingBaseline = m.strategy === 'flip'
        && !hasValue(monthlyTaxesInsInput.value) && !hasValue(monthlyInsuranceInput.value);
    carryTotalNote.classList.toggle('hidden', !usingBaseline);
    if (usingBaseline) {
        carryTotalNote.textContent = `Using the $${Engine.DEFAULTS.flipBaselineMonthlyCarry}/mo `
            + `placeholder — enter this property's real taxes and insurance, or use the `
            + `projection above, and the profit figure will account for them.`;
    }

    // The ARV ceiling, stated only when it is the constraint that actually bound
    const capBinds = m.bindingConstraint === 'ltarv' && m.capShortfall > 0;
    arvCapNote.classList.toggle('hidden', !capBinds);
    if (capBinds) {
        arvCapNote.textContent = `This lender's ${(m.arvCapRatio * 100).toFixed(0)}% of-ARV ceiling is `
            + `sizing the loan, not your LTC. It funds ${formatCurrency(m.capShortfall)} less than `
            + `the LTC alone would, and that shortfall is cash you bring to closing.`;
    }

    // What the exit stack is costing, in dollars rather than a percentage
    if (m.strategy === 'flip') {
        const pct = (m.sellingCostRatio * 100).toFixed(2).replace(/\.?0+$/, '');
        sellingCostNote.textContent = `${pct}% of ARV = ${formatCurrency(m.sellingRefiCosts)}`
            + (hasValue(sellingCostPercentInput.value) ? '' : ' (default — set your real stack)');
    } else {
        sellingCostNote.textContent = '';
    }
}

// A blank field is "not supplied"; a typed 0 is a real answer
function hasValue(v) {
    return v !== undefined && v !== null && String(v).trim() !== '';
}

// FHA's anti-flipping rule governs WHO can buy the house back from you, which
// on a starter-price DFW flip is a large slice of the buyer pool. Both tests
// run off fields already on the calculator. Rule text is dated deliberately —
// FHA has been publicly pursuing repeal, so this must not read as timeless.
function updateFlipAdvisories(m) {
    const el = document.getElementById('flip-advisories');
    if (!el) return;
    el.innerHTML = '';
    if (!m || m.strategy !== 'flip') return;
    const notes = [];
    if (m.holdingPeriod > 0 && m.holdingPeriod < 3) {
        notes.push(`Hold is ${m.holdingPeriod} month${m.holdingPeriod === 1 ? '' : 's'}: `
            + `an FHA buyer cannot sign a contract until day 91 of your ownership. `
            + `Selling faster than that means cash and conventional buyers only.`);
    }
    const purchase = Engine.num(purchasePriceInput.value);
    if (purchase > 0 && m.arv >= purchase * 2) {
        notes.push(`Resale at ${formatCurrency(m.arv)} is ${(m.arv / purchase).toFixed(1)}× your `
            + `${formatCurrency(purchase)} purchase. On an FHA sale between days 91 and 180 that `
            + `triggers a second independent appraisal, and if it lands more than 5% below your `
            + `price the LOWER value governs the loan.`);
    }
    if (!notes.length) return;
    notes.forEach(t => {
        const d = document.createElement('div');
        d.className = 'appraisal-warning';
        d.textContent = '⚠ ' + t;
        el.appendChild(d);
    });
    const foot = document.createElement('div');
    foot.className = 'comp-adj-foot';
    foot.textContent = 'FHA 24 CFR 203.37a as it stands in 2026 — FHA has proposed relaxing it, so re-check before relying on it.';
    el.appendChild(foot);
}

// An HOA can forbid the exit the deal is underwritten on. A leasing cap is
// binary — the rental thesis survives it or it doesn't — and it is knowable
// during the option period for the price of the resale certificate, which
// Texas Property Code §207.003 caps at $375. Nothing in the engine reads the
// HOA flag, so this is the one place it gets to matter.
function updateHoaGate() {
    const gate = document.getElementById('hoa-gate');
    if (!gate) return;
    const show = subjectHoaInput.value === 'yes' && currentStrategy === 'rental';
    gate.classList.toggle('hidden', !show);
    if (!show) { gate.innerHTML = ''; return; }
    gate.innerHTML = '';
    const head = document.createElement('div');
    head.textContent = '⚠ This property has an HOA and you are underwriting a rental. '
        + 'Pull the resale certificate in the option period (§207.003 caps it at $375) '
        + 'and confirm before the option expires:';
    gate.appendChild(head);
    const ul = document.createElement('ul');
    ul.className = 'hoa-gate-list';
    [
        'Is there a leasing cap, and is it currently full? (a full cap can mean a multi-year wait)',
        'Minimum lease term — a 6 or 12 month floor kills short and mid-term plans',
        'Any outright short-term-rental prohibition',
        'Owner-occupancy waiting period before you may lease at all',
        'Transfer and capitalization fees due at closing, and who pays them',
        'Special assessments already voted or pending'
    ].forEach(t => {
        const li = document.createElement('li');
        li.textContent = t;
        ul.appendChild(li);
    });
    gate.appendChild(ul);
}

// Fix & Flip dashboard
function updateFlipUI(m) {
    const profitClass = m.netProfit >= 25000 ? 'success' : (m.netProfit > 0 ? 'warning' : 'danger');
    const roiClass = m.roi >= 20 ? 'success' : (m.roi > 5 ? 'warning' : 'danger');

    setMetric('netProfit', {
        value: formatCurrency(m.netProfit),
        cardClass: profitClass,
        trendClass: m.netProfit >= 0 ? 'trend-up' : 'trend-down',
        trendIcon: m.netProfit >= 0 ? ICONS.arrowUp : ICONS.arrowDown,
        trendText: m.netProfit >= 0 ? 'Profit Margin' : 'Loss'
    });
    setMetric('cashInvested', {
        value: formatCurrency(m.cashInvested),
        cardClass: 'info',
        trendClass: 'trend-neutral',
        trendText: 'Total Liquidity Used'
    });
    setMetric('roi', {
        value: formatPercent(m.roi),
        cardClass: roiClass,
        trendClass: m.roi >= 10 ? 'trend-up' : 'trend-down',
        trendText: 'Return on Cash Spent'
    });
    setMetric('annualizedRoi', {
        value: formatPercent(m.annualizedRoi),
        cardClass: roiClass,
        trendClass: 'trend-neutral',
        trendText: 'Time-to-Cash Factor'
    });

    // ROI alone will call a $9,000 profit "excellent" on a thin cash stake.
    // Fix&flip lenders decline that file against a gross-margin floor and a
    // dollar floor, and it leaves no room for the overrun the buffer slider
    // exists to model — so all three have to clear, and a failure says which.
    const grossMargin = m.arv > 0 ? (m.netProfit / m.arv) * 100 : 0;
    const MIN_PROFIT = 15000;
    const MIN_MARGIN = 10;
    if (m.netProfit < 0) {
        setScorecard('fail', ICONS.cross, 'WARNING: Unprofitable Deal',
            'Carrying costs and fees exceed returns. Review purchase price or rehab costs.');
    } else if (m.netProfit < MIN_PROFIT) {
        setScorecard('warning', ICONS.warning, 'CAUTION: Thin Dollar Profit',
            `${formatCurrency(m.netProfit)} of profit is under the ${formatCurrency(MIN_PROFIT)} `
            + `most fix&flip lenders want to see, and a ${formatCurrency(m.rehabBudget * 0.1)} `
            + `rehab overrun would take most of it.`);
    } else if (grossMargin < MIN_MARGIN) {
        setScorecard('warning', ICONS.warning, 'CAUTION: Thin Margin on Exit',
            `Profit is ${grossMargin.toFixed(1)}% of the ${formatCurrency(m.arv)} exit — `
            + `under ${MIN_MARGIN}%, the deal depends on the ARV being right. `
            + `Check the break-even sale price against your comps.`);
    } else if (m.roi < 12) {
        setScorecard('warning', ICONS.warning, 'CAUTION: Tight Margins',
            'ROI is below 12%. Small rehab overrun will wipe out profit.');
    } else {
        setScorecard('success', ICONS.check, 'EXCELLENT: Strong Flip Deal',
            `${formatCurrency(m.netProfit)} profit — ${formatPercent(m.roi)} ROI on cash, `
            + `${grossMargin.toFixed(1)}% margin on the exit.`);
    }

    updateFlipChart(m);
}

// Rental dashboard
function updateRentalUI(m) {
    const cashFlowClass = m.monthlyCashFlow >= 250 ? 'success' : (m.monthlyCashFlow > 0 ? 'warning' : 'danger');
    const cocClass = m.cocReturn >= 8 ? 'success' : (m.cocReturn > 3 ? 'warning' : 'danger');
    const noDebt = m.lenderDscr === null;
    // Two different ratios, both called "DSCR". lenderHealthy is the one that
    // decides whether the loan gets written; dscrHealthy is whether the
    // property covers its debt after vacancy and operating expenses.
    const lenderHealthy = !noDebt && m.lenderDscr >= 1.25;
    const dscrHealthy = m.dscrRatio >= 1.25;

    setMetric('monthlyCashFlow', {
        value: formatCurrency(m.monthlyCashFlow),
        cardClass: cashFlowClass,
        trendClass: m.monthlyCashFlow >= 0 ? 'trend-up' : 'trend-down',
        trendIcon: m.monthlyCashFlow >= 0 ? ICONS.arrowUp : ICONS.arrowDown,
        trendText: 'Net Cash Income'
    });
    setMetric('cashInvested', {
        value: formatCurrency(m.cashInvested),
        cardClass: 'info',
        trendClass: 'trend-neutral',
        trendText: m.cashInvested < 0 ? 'Cash-Out Refinance!' : 'Trapped Capital'
    });
    setMetric('cocReturn', {
        value: formatPercent(m.cocReturn),
        cardClass: cocClass,
        trendClass: m.cocReturn >= 6 ? 'trend-up' : 'trend-down',
        trendText: 'Annual Dividend Return'
    });
    // This card claims lender approval, so it must show the ratio a 1–4 unit
    // DSCR lender actually underwrites: gross scheduled rent ÷ PITIA. The
    // NOI-over-debt-service figure is the commercial 5+ unit convention and
    // sits far lower — reporting it under a "Lender Approved (1.25+)" label
    // failed deals the lender would have written, and vice versa.
    setMetric('dscrRatio', {
        value: noDebt ? 'N/A' : m.lenderDscr.toFixed(2),
        cardClass: noDebt ? 'info' : (lenderHealthy ? 'success' : 'danger'),
        trendClass: noDebt ? 'trend-neutral' : (lenderHealthy ? 'trend-up' : 'trend-down'),
        trendText: noDebt ? 'No Debt — All Cash'
            : (lenderHealthy ? 'Rent ÷ PITIA — clears 1.25' : 'Rent ÷ PITIA — under 1.25')
    });

    if (m.monthlyCashFlow < 0) {
        setScorecard('fail', ICONS.cross, 'WARNING: Negative Cash Flow',
            'Property costs exceed net operating rent. Review expenses, price, or interest rate.');
    } else if (!noDebt && !lenderHealthy) {
        setScorecard('warning', ICONS.warning, 'CAUTION: Low Debt Coverage',
            `Lender DSCR is ${m.lenderDscr.toFixed(2)} (rent ÷ PITIA); most 1–4 unit `
            + `DSCR programs want 1.20–1.25. After vacancy and operating expenses the `
            + `property covers its debt ${m.dscrRatio.toFixed(2)}×.`);
    } else if (m.cocReturn > 10) {
        setScorecard('success', ICONS.check, 'EXCELLENT: High Yield Rental',
            `High Cash-on-Cash yield of ${formatPercent(m.cocReturn)}. `
            + (noDebt ? 'No debt to cover.' : `Lender DSCR ${m.lenderDscr.toFixed(2)}.`));
    } else {
        setScorecard('success', ICONS.check, 'SOLID: Balanced Rental',
            noDebt ? 'No debt to cover. Positive net cash flow.'
                : `Lender DSCR ${m.lenderDscr.toFixed(2)} clears underwriting, and after `
                  + `vacancy and expenses the property still covers debt ${m.dscrRatio.toFixed(2)}×.`);
    }

    updateRentalChart(m);
}

// ---- Charts: create the instance once per strategy, then update data in place ----

const CHART_GRID = 'rgba(255, 255, 255, 0.05)';
const CHART_TICKS = '#9ca3af';

function dollarsK(value) {
    return (value < 0 ? '-$' : '$') + Math.abs(value / 1000) + 'k';
}

function ensureChart(mode, config) {
    if (typeof Chart === 'undefined') return false; // CDN unavailable — skip charts
    if (chart && chartMode === mode) return true;
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('underwriterChart').getContext('2d'), config);
    chartMode = mode;
    return true;
}

function flipChartConfig() {
    return {
        type: 'bar',
        data: {
            labels: ['Total Deal Costs', 'ARV Value & Profit Margin'],
            datasets: [
                { label: 'Purchase Price', data: [0, 0], backgroundColor: '#6366f1' },
                { label: 'Rehab Budget', data: [0, 0], backgroundColor: '#06b6d4' },
                { label: 'Carrying, Buying & Financing', data: [0, 0], backgroundColor: '#f59e0b' },
                { label: 'Selling Costs', data: [0, 0], backgroundColor: '#a855f7' },
                { label: 'Net Profit Margin', data: [0, 0], backgroundColor: '#10b981' },
                // This segment is everything the sale has to give back before
                // a dollar is profit. It is NOT the break-even price — that is
                // costs grossed up by the exit rate, and it is stated as a
                // number under the max offer instead of guessed at from a bar.
                { label: 'Costs Recovered at Sale', data: [0, 0], backgroundColor: '#374151' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    grid: { color: CHART_GRID },
                    ticks: { color: CHART_TICKS, font: { family: 'Outfit', weight: 600 } }
                },
                y: {
                    stacked: true,
                    grid: { color: CHART_GRID },
                    ticks: { color: CHART_TICKS, callback: dollarsK }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: '#f3f4f6', font: { size: 10, family: 'Inter' }, boxWidth: 10 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.dataset.label + ': ' + formatCurrency(ctx.raw)
                    }
                }
            }
        }
    };
}

function updateFlipChart(m) {
    if (!ensureChart('flip', flipChartConfig())) return;
    const otherCosts = m.totalProjectCosts - m.purchasePrice - m.rehabBudget;
    const ds = chart.data.datasets;
    ds[0].data = [m.purchasePrice, 0];
    ds[1].data = [m.rehabBudget, 0];
    ds[2].data = [otherCosts, 0];
    ds[3].data = [m.sellingRefiCosts, 0];
    ds[4].data = [0, m.netProfit];
    ds[4].label = m.netProfit >= 0 ? 'Net Profit Margin' : 'Loss Margin';
    ds[4].backgroundColor = m.netProfit >= 0 ? '#10b981' : '#ef4444';
    ds[5].data = [0, m.arv - Math.max(0, m.netProfit)];
    chart.update('none');
}

function rentalChartConfig() {
    return {
        type: 'bar',
        data: {
            labels: ['Gross Rent', 'Vacancy Loss', 'Op Expenses', 'Tax & Ins', 'Mortgage P&I', 'Net Cash Flow'],
            datasets: [{
                label: 'Financial Flow',
                data: [0, 0, 0, 0, 0, 0],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#f43f5e', '#818cf8', '#06b6d4'],
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: CHART_GRID },
                    ticks: { color: CHART_TICKS, font: { family: 'Outfit', size: 9, weight: 600 } }
                },
                y: {
                    grid: { color: CHART_GRID },
                    ticks: { color: CHART_TICKS, callback: (v) => '$' + v }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (ctx) => formatCurrency(ctx.raw) }
                }
            }
        }
    };
}

function updateRentalChart(m) {
    if (!ensureChart('rental', rentalChartConfig())) return;
    const ds = chart.data.datasets[0];
    ds.data = [
        m.grossRent,
        -m.vacancyLoss,
        -m.maintenanceMgmt,
        -m.monthlyTaxesIns,
        -m.monthlyDebtService,
        m.monthlyCashFlow
    ];
    ds.backgroundColor[5] = m.monthlyCashFlow >= 0 ? '#06b6d4' : '#ef4444';
    chart.update('none');
}

// ---- Event wiring ----

rehabBufferSlider.addEventListener('input', (e) => {
    const months = parseInt(e.target.value, 10);
    rehabBufferVal.textContent = `+${months} month${months !== 1 ? 's' : ''}`;
    calculateDeal();
});

varianceSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    varianceVal.textContent = (val > 0 ? '+' : '') + val + '%';
    calculateDeal();
});

[
    purchasePriceInput, buyingCostsInput, arvInput, rehabBudgetInput,
    holdingPeriodInput, loanLtvInput, interestRateInput, lenderPointsInput,
    lenderFeesInput, monthlyRentInput, vacancyRateInput, operatingExpensesInput,
    monthlyTaxesInsInput, monthlyInsuranceInput, sellingCostPercentInput,
    arvCapPercentInput
].forEach(input => input.addEventListener('input', calculateDeal));

financingTypeSelect.addEventListener('change', handleFinancingChange);
document.getElementById('strategy-flip-btn').addEventListener('click', () => switchStrategy('flip'));
document.getElementById('strategy-rental-btn').addEventListener('click', () => switchStrategy('rental'));
document.getElementById('export-pdf-btn').addEventListener('click', () => window.print());

// ==================== ARV Desktop Appraisal (Page 1) ====================

const subjectPage = document.getElementById('subject-page');
const arvPage = document.getElementById('arv-page');
const calculatorPage = document.getElementById('calculator-page');
const pageSubjectBtn = document.getElementById('page-subject-btn');
const pageArvBtn = document.getElementById('page-arv-btn');
const pageCalculatorBtn = document.getElementById('page-calculator-btn');
const continueToArvBtn = document.getElementById('continue-to-arv-btn');
const strategySelector = document.getElementById('strategy-selector');
const calcAddressNote = document.getElementById('calc-address-note');

const subjectAddressInput = document.getElementById('subject-address');
const subjectSubdivisionInput = document.getElementById('subject-subdivision');
const subjectSqftInput = document.getElementById('subject-sqft');
const subjectBedsInput = document.getElementById('subject-beds');
const subjectBathsFullInput = document.getElementById('subject-baths-full');
const subjectBathsHalfInput = document.getElementById('subject-baths-half');
const subjectLotInput = document.getElementById('subject-lot');
const subjectYearInput = document.getElementById('subject-year');
const subjectGarageInput = document.getElementById('subject-garage');
const subjectStoriesInput = document.getElementById('subject-stories');
const subjectPoolInput = document.getElementById('subject-pool');
const subjectHoaInput = document.getElementById('subject-hoa');
const subjectPropTypeInput = document.getElementById('subject-prop-type');
const subjectCountyInput = document.getElementById('subject-county');
const subjectZoningInput = document.getElementById('subject-zoning');
const subjectApnInput = document.getElementById('subject-apn');
const subjectLegalInput = document.getElementById('subject-legal');
const subjectGarageTypeInput = document.getElementById('subject-garage-type');
const subjectFoundationInput = document.getElementById('subject-foundation');
const subjectRoofInput = document.getElementById('subject-roof');
const subjectExteriorInput = document.getElementById('subject-exterior');
const subjectHeatingInput = document.getElementById('subject-heating');
const subjectCoolingInput = document.getElementById('subject-cooling');
const subjectAssessedValueInput = document.getElementById('subject-assessed-value');
const subjectAssessedLandInput = document.getElementById('subject-assessed-land');
const subjectAssessedImprovInput = document.getElementById('subject-assessed-improv');
const subjectAnnualTaxesInput = document.getElementById('subject-annual-taxes');
const subjectLastSaleDateInput = document.getElementById('subject-last-sale-date');
const subjectLastSalePriceInput = document.getElementById('subject-last-sale-price');
const subjectListPriceInput = document.getElementById('subject-list-price');
const subjectListingStatusInput = document.getElementById('subject-listing-status');
const subjectHoaFeeInput = document.getElementById('subject-hoa-fee');
const subjectOwnerNamesInput = document.getElementById('subject-owner-names');
const subjectOwnerTypeInput = document.getElementById('subject-owner-type');
const subjectOwnerOccupiedInput = document.getElementById('subject-owner-occupied');
const subjectOwnerMailingInput = document.getElementById('subject-owner-mailing');
const adjPriceSqftInput = document.getElementById('adj-price-sqft');
const adjBedInput = document.getElementById('adj-bed');
const adjBathInput = document.getElementById('adj-bath');
const adjCondAvgInput = document.getElementById('adj-cond-avg');
const adjCondDatedInput = document.getElementById('adj-cond-dated');
const adjAppreciationInput = document.getElementById('adj-appreciation');
const adjLotInput = document.getElementById('adj-lot');
const adjGarageInput = document.getElementById('adj-garage');
const adjPoolInput = document.getElementById('adj-pool');
const adjYearInput = document.getElementById('adj-year');
const adjStoryInput = document.getElementById('adj-story');
const qualSettingsContainer = document.getElementById('qual-settings');

const lookupBtn = document.getElementById('lookup-address-btn');
const lookupStatus = document.getElementById('lookup-status');
const subjectAttributionBox = document.getElementById('subject-attribution');
const rentcastKeyInput = document.getElementById('rentcast-api-key');
const melissaKeyInput = document.getElementById('melissa-api-key');
const workerUrlInput = document.getElementById('worker-url');

const mktActivesInput = document.getElementById('mkt-actives');
const mktPendingsInput = document.getElementById('mkt-pendings');
const mktSold90Input = document.getElementById('mkt-sold90');
const absorptionBadge = document.getElementById('absorption-badge');
const absorptionScoreNote = document.getElementById('absorption-score-note');
const absorptionNeedle = document.getElementById('absorption-needle');
const statMoi = document.getElementById('stat-moi');
const statAbsorption = document.getElementById('stat-absorption');
const statPendingRatio = document.getElementById('stat-pending-ratio');

const compsContainer = document.getElementById('comps-container');
const subjectSummaryEl = document.getElementById('subject-summary');
const addCompBtn = document.getElementById('add-comp-btn');
const arvEstimateValue = document.getElementById('arv-estimate-value');
const arvPpsfNote = document.getElementById('arv-ppsf-note');
const arvRangeValue = document.getElementById('arv-range-value');
const arvConfidenceCard = document.getElementById('arv-confidence-card');
const arvConfidenceValue = document.getElementById('arv-confidence-value');
const arvSpreadNote = document.getElementById('arv-spread-note');
const compResultsBody = document.getElementById('comp-results-body');
const appraisalWarnings = document.getElementById('appraisal-warnings');

// Human names for the engine's adjustment keys, so the per-comp breakdown
// reads like an appraiser's grid rather than a variable dump.
const ADJ_LABELS = {
    sqft: 'Living area', beds: 'Bedrooms', baths: 'Bathrooms', lot: 'Lot size',
    garage: 'Garage', year: 'Age / year built', pool: 'Pool', stories: 'Stories',
    condition: 'Condition', concessions: 'Seller concessions', time: 'Market time',
    lotPlacement: 'Lot placement', lotUsability: 'Lot usability', schools: 'Schools',
    curbAppeal: 'Curb appeal', floorplan: 'Floorplan', locationInfluence: 'Location influence'
};
const useArvBtn = document.getElementById('use-arv-btn');

const APPRAISAL_STORAGE_KEY = 'underwriter-appraisal-v1';
const RENTCAST_KEY_STORAGE = 'underwriter-rentcast-key';
const MELISSA_KEY_STORAGE = 'underwriter-melissa-key';
const WORKER_URL_STORAGE = 'underwriter-worker-url';
const MAX_COMPS = 6;

// Appraiser-style qualitative grid: each factor is rated per comp relative
// to the subject (superior / similar / inferior) at a % of comp sale price
const QUALITATIVE_FACTORS = [
    { key: 'lotPlacement', label: 'Lot Placement', pct: 3 },
    { key: 'lotUsability', label: 'Lot Usability', pct: 3 },
    { key: 'schools', label: 'School District', pct: 4 },
    { key: 'curbAppeal', label: 'Curb Appeal', pct: 3 },
    { key: 'floorplan', label: 'Floorplan / Function', pct: 3 },
    { key: 'locationInfluence', label: 'Adverse Location (road / rail / power)', pct: 5 }
];

function defaultRatings() {
    const r = {};
    QUALITATIVE_FACTORS.forEach(f => { r[f.key] = 'similar'; });
    return r;
}

function compTemplate() {
    return {
        label: '', salePrice: 300000, sqft: 1500, beds: 3, baths: 2,
        lotSqft: 7000, garageSpaces: 2, yearBuilt: 1980, pool: 'no', stories: '1',
        condition: 'renovated', monthsAgo: 0, ratings: defaultRatings(),
        // Seller concessions ARE engine math (URAR grid line 1 — netted off
        // the price before the time adjustment). Only an MLS feed publishes
        // the number; a proxy source leaves it blank and nothing changes.
        concessions: '', mlsNumber: '', priceType: '',
        listingKey: '', photosCount: '',
        // Informational detail fields (auto-filled from the comp's address,
        // not used by the engine math)
        subdivision: '', propType: '', county: '', zoning: '', apn: '',
        garageType: '', foundation: '', roof: '', exterior: '', heating: '', cooling: '',
        assessedValue: '', annualTaxes: '', lastSaleDate: '', lastSalePrice: '', hoaFee: '',
        ownerNames: '', ownerType: '', ownerOccupied: '', ownerMailing: '',
        lat: '', lon: '', siteScan: ''
    };
}

// A slot that renders as a card but stays out of the blend until priced
// (the engine drops zero-price comps, and blank fields adjust nothing)
function emptyCompSlot() {
    return {
        ...compTemplate(),
        salePrice: '', sqft: '', beds: '', baths: '',
        lotSqft: '', garageSpaces: '', yearBuilt: ''
    };
}

// Every open starts a blank underwriting: no demo comps, no restored
// property — the address autocomplete + auto-suggest rebuild a deal in
// seconds, so carrying stale property data across sessions costs more
// than it saves (deliberate, 2026-08).
let appraisalComps = Array.from({ length: 4 }, () => emptyCompSlot());
let lastAppraisal = null;
const qualSettingInputs = {}; // factor key -> generated % input

// Full/half baths combine into one decimal total for the engine and comps
// (e.g. 2 full + 1 half = 2.5) — matches how comps already store baths.
function totalBaths(fullInput, halfInput) {
    return Engine.num(fullInput.value) + Engine.num(halfInput.value) * 0.5;
}

function splitBaths(total) {
    const rounded = Math.round(Engine.num(total) * 2) / 2;
    const full = Math.floor(rounded);
    return { full, half: rounded - full >= 0.5 ? 1 : 0 };
}

// Only the appraisal MODEL settings persist across opens (adjustment grid
// % values + qualitative weights — market-area tuning, not property data).
// Subject fields, market inputs, and comps deliberately start blank every
// open; older saved blobs carried them and are simply ignored on restore.
const SETTINGS_STATE_FIELDS = {
    pricePerSqft: adjPriceSqftInput, bed: adjBedInput, bath: adjBathInput,
    condAvg: adjCondAvgInput, condDated: adjCondDatedInput, appreciation: adjAppreciationInput,
    lot: adjLotInput, garage: adjGarageInput, pool: adjPoolInput, year: adjYearInput, story: adjStoryInput
};

function saveAppraisalState() {
    try {
        const qual = {};
        QUALITATIVE_FACTORS.forEach(f => {
            if (qualSettingInputs[f.key]) qual[f.key] = qualSettingInputs[f.key].value;
        });
        const dump = fields => Object.fromEntries(Object.entries(fields).map(([k, input]) => [k, input.value]));
        localStorage.setItem(APPRAISAL_STORAGE_KEY, JSON.stringify({
            settings: { ...dump(SETTINGS_STATE_FIELDS), qual }
        }));
    } catch (e) { /* storage full/blocked — appraisal still works, just not persisted */ }
}

function restoreAppraisalState() {
    try {
        const raw = localStorage.getItem(APPRAISAL_STORAGE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        const set = (input, v) => { if (v !== undefined && v !== null) input.value = v; };

        if (s.settings) {
            Object.entries(SETTINGS_STATE_FIELDS).forEach(([k, input]) => set(input, s.settings[k]));
            if (s.settings.qual) {
                QUALITATIVE_FACTORS.forEach(f => {
                    if (qualSettingInputs[f.key] && s.settings.qual[f.key] !== undefined) {
                        qualSettingInputs[f.key].value = s.settings.qual[f.key];
                    }
                });
            }
        }
    } catch (e) { /* corrupted state — fall back to defaults */ }
}

// Generate the qualitative % weight rows (slider + number) from one source of truth
function renderQualSettings() {
    qualSettingsContainer.innerHTML = '';
    QUALITATIVE_FACTORS.forEach(f => {
        const div = document.createElement('div');
        div.className = 'weight-row';
        div.innerHTML = `
            <div class="weight-head">
                <label for="qual-${f.key}"></label>
                <div class="input-wrapper has-suffix">
                    <input type="number" id="qual-${f.key}" min="0" max="25" step="0.5" value="${f.pct}">
                    <span class="input-suffix">%</span>
                </div>
            </div>
            <input type="range" data-for="qual-${f.key}" min="0" max="15" step="0.5" value="${f.pct}">
            <div class="weight-impact" data-impact="${f.key}">—</div>`;
        div.querySelector('label').textContent = f.label;
        const input = div.querySelector('input[type="number"]');
        input.addEventListener('input', recalcAppraisal);
        qualSettingInputs[f.key] = input;
        qualSettingsContainer.appendChild(div);
    });
}

// ---- Weight sliders: every range[data-for] mirrors its number input ----
// Sliders give feel, the number inputs keep paired-sales precision; either
// side drives the other and both feed the same recalc + persistence path.
function initWeightSliders() {
    document.querySelectorAll('input[type="range"][data-for]').forEach(slider => {
        const num = document.getElementById(slider.dataset.for);
        if (!num) return;
        slider.addEventListener('input', () => {
            num.value = slider.value;
            num.dispatchEvent(new Event('input', { bubbles: true }));
        });
        num.addEventListener('input', () => { slider.value = num.value; });
    });
    syncWeightSliders();
}

function syncWeightSliders() {
    document.querySelectorAll('input[type="range"][data-for]').forEach(slider => {
        const num = document.getElementById(slider.dataset.for);
        if (num) slider.value = num.value;
    });
}

// Under each weight: what that factor is doing to the current comp set
// ("3-car subject vs 2-car comps" shows up here as a live +$ on those comps)
function updateWeightImpacts(a) {
    const totals = {};
    a.comps.forEach(c => {
        Object.entries(c.adjustments).forEach(([k, v]) => {
            if (!totals[k]) totals[k] = { count: 0, sum: 0 };
            if (v) { totals[k].count++; totals[k].sum += v; }
        });
    });
    document.querySelectorAll('.weight-impact[data-impact]').forEach(el => {
        const t = totals[el.dataset.impact];
        if (!t || !t.count) {
            el.textContent = 'no effect on current comps';
            el.classList.remove('active');
        } else {
            const avg = t.sum / t.count;
            el.textContent = `${t.count} of ${a.comps.length} comps · avg ${avg >= 0 ? '+' : '−'}${formatCurrency(Math.abs(avg))}`;
            el.classList.add('active');
        }
    });
}

const CONDITION_OPTIONS = [
    { value: 'renovated', text: 'Renovated' },
    { value: 'average', text: 'Average' },
    { value: 'dated', text: 'Dated' }
];

// Price provenance for one comp card: whether the number in the Sale Price
// field is a recorded closing or a list-at-sale proxy, plus the concession
// the grid nets out. Hidden entirely for hand-typed comps — the user knows
// where their own number came from.
function renderCompPriceTruth(el, comp) {
    if (!el) return;
    el.textContent = '';
    const parts = [];
    if (comp.priceType === 'closed') {
        const span = document.createElement('span');
        span.className = 'truth-verified';
        span.textContent = `✓ ${comp.priceSource || 'MLS'} closed price`;
        span.title = 'A recorded closing, not an asking price';
        parts.push(span);
    } else if (comp.priceType === 'list') {
        const span = document.createElement('span');
        span.className = 'truth-proxy';
        span.textContent = '≈ list-at-sale proxy — verify against MLS';
        span.title = 'Texas is a non-disclosure state: this is the price the home was listed at when it went off market, not the recorded sale';
        parts.push(span);
    }
    const conc = Engine.num(comp.concessions);
    if (conc > 0) {
        const span = document.createElement('span');
        span.textContent = `− ${formatCurrency(conc)} concessions netted out`;
        span.title = comp.concessionsComments || 'Netted off the price before the time adjustment (URAR grid line 1)';
        parts.push(span);
    }
    if (comp.mlsNumber) {
        const span = document.createElement('span');
        span.textContent = 'MLS #' + comp.mlsNumber;
        parts.push(span);
    }
    parts.forEach((p, i) => {
        if (i) el.append(' · ');
        el.appendChild(p);
    });
    el.classList.toggle('hidden', parts.length === 0);
}

// Rebuild comp editor cards (only on add/remove/restore; typing updates state in place)
function renderComps() {
    compsContainer.innerHTML = '';
    appraisalComps.forEach((comp, idx) => {
        const card = document.createElement('div');
        card.className = 'comp-card';
        card.innerHTML = `
            <div class="comp-card-header">
                <span>Comp ${idx + 1}${Engine.num(comp.salePrice) > 0 ? '' : ' <em class="comp-unpriced">unpriced · not in blend</em>'}</span>
                <span style="display: flex; gap: 0.35rem;">
                    ${comp.listingKey ? '<button class="comp-remove" data-action="comp-photos" title="View listing photos and judge condition yourself">📷</button>' : ''}
                    <button class="comp-remove" title="Remove comp" ${appraisalComps.length <= 1 ? 'disabled' : ''}>&times;</button>
                </span>
            </div>
            <div class="form-group">
                <label>Address / Label</label>
                <div class="autocomplete-wrap">
                    <input type="text" data-field="label" placeholder="Type address to auto-fill…" autocomplete="off" spellcheck="false">
                    <div class="address-suggestions hidden" role="listbox"></div>
                </div>
                <div class="comp-subdivision hidden" data-subdiv></div>
                <div class="comp-price-truth hidden" data-price-truth></div>
            </div>
            <div class="input-row">
                <div class="form-group">
                    <label>Sale Price</label>
                    <div class="input-wrapper has-prefix">
                        <span class="input-prefix">$</span>
                        <input type="number" data-field="salePrice" min="0" step="1000">
                    </div>
                </div>
                <div class="form-group">
                    <label>SqFt</label>
                    <input type="number" data-field="sqft" min="0" step="10">
                </div>
            </div>
            <div class="input-row">
                <div class="form-group">
                    <label>Beds</label>
                    <input type="number" data-field="beds" min="0" max="12" step="1">
                </div>
                <div class="form-group">
                    <label>Baths</label>
                    <input type="number" data-field="baths" min="0" max="12" step="0.5">
                </div>
            </div>
            <div class="input-row">
                <div class="form-group">
                    <label>Condition</label>
                    <select data-field="condition">
                        ${CONDITION_OPTIONS.map(o => `<option value="${o.value}">${o.text}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Sold (months ago)</label>
                    <input type="number" data-field="monthsAgo" min="0" max="24" step="1">
                </div>
            </div>
            <details class="comp-details">
                <summary>Details &amp; Ratings vs Subject</summary>
                <div class="comp-details-body">
                    <div class="input-row">
                        <div class="form-group">
                            <label>Lot SqFt</label>
                            <input type="number" data-field="lotSqft" min="0" step="100">
                        </div>
                        <div class="form-group">
                            <label>Garage Spaces</label>
                            <input type="number" data-field="garageSpaces" min="0" max="8" step="1">
                        </div>
                    </div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Year Built</label>
                            <input type="number" data-field="yearBuilt" min="1800" max="2030" step="1">
                        </div>
                        <div class="form-group">
                            <label>Stories</label>
                            <select data-field="stories">
                                <option value="1">1</option>
                                <option value="1.5">1.5</option>
                                <option value="2">2</option>
                                <option value="3">3+</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Pool</label>
                        <select data-field="pool">
                            <option value="no">No Pool</option>
                            <option value="yes">Pool</option>
                        </select>
                    </div>
                    <div class="comp-ratings-title">Property Facts</div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Subdivision</label>
                            <input type="text" data-field="subdivision">
                        </div>
                        <div class="form-group">
                            <label>Property Type</label>
                            <input type="text" data-field="propType">
                        </div>
                    </div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>County</label>
                            <input type="text" data-field="county">
                        </div>
                        <div class="form-group">
                            <label>Zoning</label>
                            <input type="text" data-field="zoning">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Parcel ID (APN)</label>
                        <input type="text" data-field="apn">
                    </div>
                    <div class="comp-ratings-title">Construction</div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Garage Type</label>
                            <input type="text" data-field="garageType">
                        </div>
                        <div class="form-group">
                            <label>Foundation</label>
                            <input type="text" data-field="foundation">
                        </div>
                    </div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Roof</label>
                            <input type="text" data-field="roof">
                        </div>
                        <div class="form-group">
                            <label>Exterior</label>
                            <input type="text" data-field="exterior">
                        </div>
                    </div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Heating</label>
                            <input type="text" data-field="heating">
                        </div>
                        <div class="form-group">
                            <label>Cooling</label>
                            <input type="text" data-field="cooling">
                        </div>
                    </div>
                    <div class="comp-ratings-title">Financial &amp; Sale</div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Assessed Value</label>
                            <input type="number" data-field="assessedValue" min="0" step="1000">
                        </div>
                        <div class="form-group">
                            <label>Annual Taxes</label>
                            <input type="number" data-field="annualTaxes" min="0" step="100">
                        </div>
                    </div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Last Sale Date</label>
                            <input type="date" data-field="lastSaleDate">
                        </div>
                        <div class="form-group">
                            <label>Last Sold Price</label>
                            <input type="number" data-field="lastSalePrice" min="0" step="1000">
                        </div>
                    </div>
                    <div class="input-row">
                        <div class="form-group">
                            <label title="Netted off the sale price before the time adjustment, the way the URAR grid does it">Seller Concessions</label>
                            <div class="input-wrapper has-prefix">
                                <span class="input-prefix">$</span>
                                <input type="number" data-field="concessions" min="0" step="500">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>MLS #</label>
                            <input type="text" data-field="mlsNumber">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>HOA Fee (monthly)</label>
                        <input type="number" data-field="hoaFee" min="0" step="10">
                    </div>
                    <div class="comp-ratings-title">Owner</div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Owner Name(s)</label>
                            <input type="text" data-field="ownerNames">
                        </div>
                        <div class="form-group">
                            <label>Owner Type</label>
                            <input type="text" data-field="ownerType">
                        </div>
                    </div>
                    <div class="input-row">
                        <div class="form-group">
                            <label>Owner-Occupied</label>
                            <select data-field="ownerOccupied">
                                <option value="">Unknown</option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Owner Mailing Addr</label>
                            <input type="text" data-field="ownerMailing">
                        </div>
                    </div>
                    <div class="comp-ratings-title">Site</div>
                    <button class="btn btn-secondary" data-action="site-scan" style="width: 100%; padding: 0.4rem; font-size: 0.78rem;">
                        🛰 Scan Site Influences
                    </button>
                    <div class="comp-site-scan ${comp.siteScan ? '' : 'hidden'}" data-site-scan></div>
                    <div class="comp-ratings-title">Location &amp; Quality (comp vs subject)</div>
                    ${QUALITATIVE_FACTORS.map(f => `
                    <div class="comp-rating-row">
                        <label>${f.label}</label>
                        <select data-rating="${f.key}">
                            <option value="superior">Superior</option>
                            <option value="similar">Similar</option>
                            <option value="inferior">Inferior</option>
                        </select>
                    </div>`).join('')}
                </div>
            </details>
        `;
        // Fill current values and wire updates back into state
        card.querySelectorAll('[data-field]').forEach(el => {
            el.value = comp[el.dataset.field];
            el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
                comp[el.dataset.field] = el.value;
                if (el.dataset.field === 'label') {
                    // Typing invalidates the previously picked location, same
                    // as the subject field — the map pin and site scan must
                    // never assert coordinates the current text didn't produce
                    comp.lat = ''; comp.lon = '';
                }
                if (el.dataset.field === 'condition') {
                    // The user made the call — stop flagging it as assumed
                    comp.conditionUnverified = false;
                    delete comp.conditionEvidence;
                }
                recalcAppraisal();
            });
        });
        card.querySelectorAll('[data-rating]').forEach(el => {
            el.value = comp.ratings[el.dataset.rating] || 'similar';
            el.addEventListener('change', () => {
                comp.ratings[el.dataset.rating] = el.value;
                recalcAppraisal();
            });
        });
        // Hover shows why an auto-seeded School District rating was chosen
        if (comp.schoolsEvidence) {
            const schoolSel = card.querySelector('[data-rating="schools"]');
            if (schoolSel) schoolSel.title = comp.schoolsEvidence;
        }
        // Where this price came from, and what the grid quietly did to it.
        // A closed MLS price and a list-at-sale proxy are different kinds of
        // number and the card has to say which one is sitting in the field.
        renderCompPriceTruth(card.querySelector('[data-price-truth]'), comp);
        // The photos button shares .comp-remove styling, so the REMOVE handler
        // must select by title — the first .comp-remove is now the camera
        // whenever the comp carries a listing key
        const photoBtn = card.querySelector('[data-action="comp-photos"]');
        if (photoBtn) {
            photoBtn.addEventListener('click', () => openPhotoViewer({
                listingKey: comp.listingKey,
                photosCount: comp.photosCount,
                label: comp.label || 'Listing photos',
                onCondition: (cond) => {
                    comp.condition = cond;
                    comp.conditionEvidence = 'photos — your read';
                    comp.conditionUnverified = false;
                    delete comp.conditionConflict;
                    // Reflect into the visible select without a full re-render
                    // so the viewer stays open over an up-to-date card
                    const sel = card.querySelector('[data-field="condition"]');
                    if (sel) sel.value = cond;
                    recalcAppraisal();
                }
            }));
        }
        card.querySelector('.comp-remove[title="Remove comp"]').addEventListener('click', () => {
            appraisalComps.splice(idx, 1);
            renderComps();
            recalcAppraisal();
        });
        // Address autocomplete on the label: picking a suggestion auto-fills
        // the whole comp card from property records
        attachAddressAutocomplete(
            card.querySelector('[data-field="label"]'),
            card.querySelector('.address-suggestions'),
            (s) => {
                comp.label = s.line1 || s.text;
                // Set-or-null like the subject flow: a coord-less suggestion
                // must clear any stale pin from the previous pick
                comp.lat = s.lat != null ? s.lat : '';
                comp.lon = s.lon != null ? s.lon : '';
                lookupCompProperty(comp, s.text, s.mprId || null,
                    (s.lat != null && s.lon != null) ? { lat: s.lat, lon: s.lon } : null);
            }
        );
        // Site influence scan for this comp — informs the Adverse Location /
        // Lot Placement ratings right below it
        const scanEl = card.querySelector('[data-site-scan]');
        if (comp.siteScan) scanEl.textContent = comp.siteScan;
        card.querySelector('[data-action="site-scan"]').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Scanning…';
            try {
                let lat = parseFloat(comp.lat), lon = parseFloat(comp.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                    // Street-only label + the subject's city/state tail for context
                    const tail = subjectAddressInput.value.split(',').slice(1).join(',').trim();
                    const list = await realtorSuggestions(tail ? `${comp.label}, ${tail}` : comp.label);
                    if (list.length && list[0].lat != null) {
                        lat = list[0].lat; lon = list[0].lon;
                        comp.lat = lat; comp.lon = lon;
                    }
                }
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                    comp.siteScan = 'Could not locate this address on the map — pick it from the autocomplete first.';
                } else {
                    const nearest = await overpassScan(lat, lon);
                    const chips = influenceChips(nearest);
                    comp.siteScan = chips.length
                        ? chips.map(c => (c.kind === 'bad' ? '⚠ ' : c.kind === 'good' ? '✓ ' : '') + c.text).join('  ·  ')
                        : 'No mapped influences within ~1,300 ft.';
                    if (nearest.pool) comp.pool = 'yes';
                }
            } catch (err) {
                comp.siteScan = 'Scan failed — Overpass may be busy; try again shortly.';
            }
            renderComps();
            recalcAppraisal();
        });
        compsContainer.appendChild(card);
    });
    addCompBtn.disabled = appraisalComps.length >= MAX_COMPS;
}

// Subdivision line under each comp's address — highlighted when it matches
// the subject's subdivision (a same-subdivision comp is the gold standard)
function refreshCompSubdivisions() {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const subjectSub = norm(subjectSubdivisionInput.value);
    [...compsContainer.children].forEach((card, i) => {
        const el = card.querySelector('[data-subdiv]');
        const comp = appraisalComps[i];
        if (!el || !comp) return;
        const sub = String(comp.subdivision || '').trim();
        el.classList.toggle('hidden', !sub);
        if (!sub) return;
        const match = Boolean(subjectSub) && norm(sub) === subjectSub;
        el.textContent = match ? `${sub} · ✓ matches subject` : sub;
        el.classList.toggle('match', match);
    });
}

// ==================== MLS Photo Viewer ====================
// The photos exist so a HUMAN can judge condition. This is the deliberate
// alternative to automated photo scoring: measured CV condition models buy
// 0.3–0.4 MAPE points at ~60% classifier accuracy, while a person looking at
// a kitchen for three seconds is the gold-standard label — and condition is
// the one input this feed does not carry (NTREIS publishes no
// PropertyCondition). So the viewer shows the photos and offers three
// buttons; pressing one becomes the comp's condition with the evidence
// "photos — your read", which outranks the remarks classifier.
//
// Licence posture: photos are licensed MLS content. They render on screen
// for the licensee only, are never written to localStorage (the browser's
// HTTP cache holds them privately for the same 12 h the MLS record cache
// uses), and never appear in the printable protest packet.
//
// Mechanics: /mls/photo?key=<ListingKeyNumeric>&i=<n>&type=HighRes. Index 1
// is the first photo (0 is the server's alias for it); photosCount bounds
// the roll. Each request rides the worker's serial RETS queue, so photos
// arrive one at a time — the viewer preloads the next while you look.

let photoViewerEl = null;
let photoViewerState = null;

function ensurePhotoViewer() {
    if (photoViewerEl) return photoViewerEl;
    const el = document.createElement('div');
    el.className = 'photo-viewer hidden';
    el.innerHTML = `
        <div class="photo-viewer-backdrop" data-close></div>
        <div class="photo-viewer-panel" role="dialog" aria-label="Listing photos">
            <div class="photo-viewer-head">
                <span class="photo-viewer-title"></span>
                <span class="photo-viewer-count"></span>
                <button class="comp-remove" data-close title="Close (Esc)">&times;</button>
            </div>
            <div class="photo-viewer-stage">
                <button class="photo-nav" data-prev title="Previous (←)">&#x2039;</button>
                <img class="photo-viewer-img" alt="Listing photo">
                <div class="photo-viewer-loading">Loading photo…</div>
                <button class="photo-nav" data-next title="Next (→)">&#x203a;</button>
            </div>
            <div class="photo-viewer-actions">
                <span>Your condition read:</span>
                <button class="btn btn-secondary" data-cond="renovated">Renovated</button>
                <button class="btn btn-secondary" data-cond="average">Average</button>
                <button class="btn btn-secondary" data-cond="dated">Dated</button>
                <span class="photo-viewer-note"></span>
            </div>
        </div>`;
    document.body.appendChild(el);

    el.querySelectorAll('[data-close]').forEach(b =>
        b.addEventListener('click', closePhotoViewer));
    el.querySelector('[data-prev]').addEventListener('click', () => stepPhoto(-1));
    el.querySelector('[data-next]').addEventListener('click', () => stepPhoto(1));
    el.querySelectorAll('[data-cond]').forEach(b => b.addEventListener('click', () => {
        if (!photoViewerState || !photoViewerState.onCondition) return;
        photoViewerState.onCondition(b.dataset.cond);
        el.querySelector('.photo-viewer-note').textContent =
            `Set to ${b.dataset.cond} — counted as verified.`;
    }));
    document.addEventListener('keydown', (e) => {
        if (!photoViewerState) return;
        if (e.key === 'Escape') closePhotoViewer();
        else if (e.key === 'ArrowLeft') stepPhoto(-1);
        else if (e.key === 'ArrowRight') stepPhoto(1);
    });

    const img = el.querySelector('.photo-viewer-img');
    img.addEventListener('load', () => {
        el.querySelector('.photo-viewer-loading').classList.add('hidden');
        img.classList.remove('hidden');
        // The next photo starts through the serial queue while this one is
        // being looked at, so paging forward feels instant
        if (photoViewerState && photoViewerState.index < photoViewerState.count) {
            new Image().src = photoUrl(photoViewerState.key, photoViewerState.index + 1);
        }
    });
    img.addEventListener('error', () => {
        // Past the end of the roll, or the feed hiccuped — either way say so
        // rather than showing a broken-image glyph
        el.querySelector('.photo-viewer-loading').textContent =
            'No photo here — the roll may be shorter than the listed count.';
    });
    photoViewerEl = el;
    return el;
}

function photoUrl(key, i) {
    return `${workerBase()}/mls/photo?key=${encodeURIComponent(key)}&i=${i}&type=HighRes`;
}

function showCurrentPhoto() {
    const el = photoViewerEl;
    const s = photoViewerState;
    el.querySelector('.photo-viewer-count').textContent = `${s.index} / ${s.count}`;
    const img = el.querySelector('.photo-viewer-img');
    const loading = el.querySelector('.photo-viewer-loading');
    loading.textContent = 'Loading photo…';
    loading.classList.remove('hidden');
    img.classList.add('hidden');
    img.src = photoUrl(s.key, s.index);
}

function stepPhoto(delta) {
    const s = photoViewerState;
    if (!s) return;
    const next = s.index + delta;
    if (next < 1 || next > s.count) return;
    s.index = next;
    showCurrentPhoto();
}

function openPhotoViewer(opts) {
    const el = ensurePhotoViewer();
    photoViewerState = {
        key: opts.listingKey,
        count: Math.max(1, Math.min(40, Engine.num(opts.photosCount) || 1)),
        index: 1,
        onCondition: opts.onCondition || null
    };
    el.querySelector('.photo-viewer-title').textContent = opts.label || 'Listing photos';
    el.querySelector('.photo-viewer-note').textContent = '';
    el.querySelector('.photo-viewer-actions').classList.toggle('hidden', !opts.onCondition);
    el.classList.remove('hidden');
    showCurrentPhoto();
}

function closePhotoViewer() {
    if (photoViewerEl) photoViewerEl.classList.add('hidden');
    photoViewerState = null;
}

// ==================== Comp Suggestions ====================
// Worker /comps merges realtor.com recent solds (keyless) with RentCast AVM
// comparables; ranking happens here so it always reflects the live subject.

const compCandidatesPanel = document.getElementById('comp-candidates');

// How many top-ranked priced candidates auto-fill the comp slots when the
// ARV page is opened from the subject page (user asked for "top 3–5")
const AUTO_APPLY_COUNT = 4;

// Search generation token: landing on the ARV page twice in quick succession
// (or hitting Retry) must not let a slow, stale response overwrite the
// newer search's candidates or double-fill the comp slots. Also bumped when
// the subject page is entered — the subject may be about to change, and a
// late response for the OLD address must not fill cards behind the user's back.
let suggestRunId = 0;

// Comps captured just before a page-entry wipe; offered back via "Restore
// previous comps" when the search that was meant to replace them fails
// (e.g. offline PWA) — the wipe must not convert a network error into
// permanent loss of a hand-tuned appraisal.
let preResetComps = null;

// ---- Derived adjustment rates ----
// The grid's $/sqft used to be a fixed 50 — a national rule of thumb that
// under-corrects by tens of thousands in a $300/sqft market, in the same
// direction on every comp. It is now read off the comps themselves. The user
// keeps the last word: touching the field marks it overridden and the
// derivation stops writing to it for the rest of the session.
const derivedRateInputs = {
    pricePerSqftAdj: { el: adjPriceSqftInput, overridden: false, note: null },
    annualAppreciationPct: { el: adjAppreciationInput, overridden: false, note: null }
};

function markRateOverridden(key) {
    const slot = derivedRateInputs[key];
    if (slot) slot.overridden = true;
}

// The note sits at the bottom of the setting's own row, under the slider and
// impact readout — the adjustment inputs live in .weight-row, not the
// .form-group used elsewhere on the page.
function derivedNoteFor(slot) {
    if (slot.note && slot.note.isConnected) return slot.note;
    const row = slot.el.closest('.weight-row') || slot.el.closest('.form-group');
    if (!row) return null;
    const note = document.createElement('div');
    note.className = 'derived-rate-note';
    row.appendChild(note);
    slot.note = note;
    return note;
}

/**
 * Fit the market's own rate of change and put it in the appreciation field.
 *
 * The default was a flat 2%/yr that nobody had checked. Measured across three
 * DFW submarkets the actual reading is roughly flat to slightly soft, so that
 * default was adding several points of upward adjustment to every older comp
 * — a systematic over-valuation, in the one direction that costs money.
 *
 * When the data cannot support a rate the answer is zero, not the midpoint of
 * a wide interval; the uncertainty shows up in the confidence band instead.
 */
async function fetchLocalTrend() {
    const slot = derivedRateInputs.annualAppreciationPct;
    if (!slot || !slot.el || !lastSelectedCoords) return;
    const q = new URLSearchParams({
        latitude: String(lastSelectedCoords.lat),
        longitude: String(lastSelectedCoords.lon),
        radius: '3', months: '18'
    });
    const res = await fetch(`${workerBase()}/trend?${q}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    const trend = Engine.deriveTimeAdjustment(data.sales || []);
    compsMeta.trend = trend;

    const note = derivedNoteFor(slot);
    if (!note) return;
    if (!trend) {
        note.textContent = 'Not enough local sales history to fit a market trend — using your setting.';
        note.className = 'derived-rate-note';
        note.classList.remove('hidden');
        recalcAppraisal();
        return;
    }
    const how = trend.usable
        ? `fitted across ${trend.used} sales over ${trend.months} months (95% CI ${trend.ci95[0]}% to ${trend.ci95[1]}%)`
        : `${trend.used} sales over ${trend.months} months put it between ${trend.ci95[0]}% and ${trend.ci95[1]}% — too wide to apply, so comps are not aged`;

    if (slot.overridden) {
        note.textContent = `Your override. The market reads ${trend.annualPct}%/yr — ${how}.`;
        note.className = 'derived-rate-note overridden';
    } else {
        slot.el.value = String(trend.annualPct);
        syncWeightSliders();
        note.textContent = `Auto-derived: ${trend.annualPct}%/yr — ${how}. Type here to override.`;
        note.className = 'derived-rate-note';
        saveAppraisalState();
    }
    note.classList.remove('hidden');
    recalcAppraisal();
}

function applyDerivedRates(derived, compCount) {
    const slot = derivedRateInputs.pricePerSqftAdj;
    if (!slot || !slot.el) return;
    const note = derivedNoteFor(slot);
    if (!note) return;

    if (!derived) {
        note.textContent = compCount
            ? 'Not enough priced comps with sizes to derive a rate — using your setting.'
            : '';
        note.classList.toggle('hidden', !compCount);
        return;
    }
    const how = derived.method === 'regression'
        ? `regression across ${derived.used} sales, R² ${derived.rSquared}`
        : `45% of the $${derived.medianPricePerSqft}/sqft this market trades at, across ${derived.used} sales`;

    if (slot.overridden) {
        note.textContent = `Your override — the comps suggest $${derived.pricePerSqftAdj}/sqft (${how}).`;
        note.className = 'derived-rate-note overridden';
    } else {
        slot.el.value = String(derived.pricePerSqftAdj);
        // The paired range slider mirrors the number field, but its ceiling
        // was set for the old $50-ish defaults — lift it rather than let a
        // derived rate look pinned at the top of the track.
        const slider = document.querySelector(`input[type="range"][data-for="${slot.el.id}"]`);
        if (slider && derived.pricePerSqftAdj > Number(slider.max)) {
            slider.max = String(Math.ceil(derived.pricePerSqftAdj * 1.5 / 25) * 25);
        }
        syncWeightSliders();
        note.textContent = `Auto-derived from these comps: $${derived.pricePerSqftAdj}/sqft — ${how}. Type here to override.`;
        note.className = 'derived-rate-note';
        saveAppraisalState();
    }
    note.classList.remove('hidden');
}

// Set-level provenance from the last /comps response: { priceTruth, mls }.
// priceTruth is 'closed' | 'mixed' | 'proxy' | 'none' and decides whether the
// panel hedges about Texas non-disclosure or states the prices as fact.
/**
 * How disagreed is the MIDDLE of the local market about price per foot?
 * Interquartile rather than max-minus-min, because a single teardown or new
 * build sets the extremes and tells you nothing about how hard the typical
 * house here is to price.
 */
function iqrSpreadPct(sortedPpsf) {
  if (!sortedPpsf || sortedPpsf.length < 4) return 0;
  const at = (f) => sortedPpsf[Math.min(sortedPpsf.length - 1, Math.floor(f * sortedPpsf.length))];
  const q1 = at(0.25), q3 = at(0.75), med = at(0.5);
  return med > 0 ? 100 * (q3 - q1) / med : 0;
}

let compsMeta = { priceTruth: null, mls: null, trend: null, ppsfSpreadPct: 0 };

// Proximity-first ranking (0–100): location and sale recency carry 70 of
// 100 points — the closest, freshest solds lead. Material similarity earns
// the last 30, and hard dissimilarity GATES multiply the total down so a
// next-door sale that's the wrong house (2,000 sqft bigger, 50 years newer)
// can never ride proximity to the top.
function candidateScore(c) {
    // The scoring itself lives in the engine so the back-test harness ranks
    // comps exactly the way this page does; here we only read the subject off
    // the form.
    return Engine.scoreComp({
        sqft: subjectSqftInput.value,
        beds: subjectBedsInput.value,
        baths: totalBaths(subjectBathsFullInput, subjectBathsHalfInput),
        yearBuilt: subjectYearInput.value,
        garageSpaces: subjectGarageInput.value,
        stories: subjectStoriesInput.value
    }, c);
}

async function suggestComps() {
    const address = subjectAddressInput.value.trim();
    const q = new URLSearchParams();
    if (lastSelectedCoords) {
        q.set('latitude', String(lastSelectedCoords.lat));
        q.set('longitude', String(lastSelectedCoords.lon));
    } else if (address) {
        q.set('address', address);
    } else {
        compCandidatesPanel.innerHTML = '<div class="appraisal-warning">Set the subject address on step 1 first — comp suggestions search around it.</div>';
        compCandidatesPanel.classList.remove('hidden');
        return;
    }
    const sqft = Engine.num(subjectSqftInput.value);
    if (sqft > 0) q.set('sqft', String(sqft));
    const beds = Engine.num(subjectBedsInput.value);
    if (beds > 0) q.set('beds', String(beds));
    const baths = totalBaths(subjectBathsFullInput, subjectBathsHalfInput);
    if (baths > 0) q.set('baths', String(baths));
    // An MLS feed served over classic RETS has no radius operator, and NTREIS
    // publishes no coordinates to trim by, so the postcode is the only thing
    // that makes a comp search local. Without it the worker declines the MLS
    // rung and falls back, rather than returning recent closings from
    // anywhere in North Texas and calling them comps.
    const compZip = subjectZip();
    if (compZip) q.set('zip', compZip);

    const runId = ++suggestRunId;
    compCandidatesPanel.innerHTML = '<div class="candidates-note">Searching recent solds near the subject…</div>';
    compCandidatesPanel.classList.remove('hidden');
    try {
        const res = await fetch(`${workerBase()}/comps?${q}`, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (runId !== suggestRunId) return; // superseded by a newer search
        // priceTruth / mls describe the SET, not one comp: whether every
        // price came back a recorded closing, some did, or none did
        // A new search invalidates the old trend and dispersion — they belong
        // to the previous subject's neighbourhood, not this one
        compsMeta = {
            priceTruth: data.priceTruth || null, mls: data.mls || null,
            trend: null, ppsfSpreadPct: 0,
            // The neighbours' own bills, so a high effective rate can be
            // attributed to a MUD/PID district instead of read as an
            // assessment error worth protesting.
            taxRate: Engine.neighborhoodTaxRate(data.candidates || [])
        };
        const pool = data.candidates || [];
        // Read the market's own numbers off the set BEFORE ranking: the
        // segment flag feeds the ranking gates, and the GLA rate replaces a
        // static default that is wrong in every market but the one it was
        // guessed for.
        const priced = pool.filter(c => c.price > 0 && c.sqft > 0)
            .map(c => ({ label: c.address, salePrice: c.price, sqft: c.sqft }));
        const outliers = new Map(
            Engine.pricePerSqftOutliers(priced).map(o => [o.label, o]));
        applyDerivedRates(Engine.deriveMarketRates(priced), priced.length);

        // Local price dispersion feeds the confidence band
        const ppsfs = priced.map(c => c.salePrice / c.sqft).sort((a, b) => a - b);
        compsMeta.ppsfSpreadPct = ppsfs.length >= 3
            ? iqrSpreadPct(ppsfs)
            : 0;

        // The time adjustment, fitted to a WIDE local pull rather than left at
        // a user-entered guess. Fire-and-forget: a missing trend means flat,
        // and must never hold up the comps.
        fetchLocalTrend().catch(() => {});

        const ranked = pool
            .map(c => {
                const o = outliers.get(c.address);
                const withFlags = {
                    ...c,
                    ppsfOutlier: Boolean(o && o.outlier),
                    ppsf: o ? o.pricePerSqft : null,
                    ppsfDeviationPct: o ? o.deviationPct : null
                };
                return { ...withFlags, score: candidateScore(withFlags) };
            })
            .sort((a, b) => b.score - a.score);
        if (autoApplyCandidates(ranked) > 0) preResetComps = null; // replacement secured
        renderCandidates(ranked);
        // Evidence-based School District ratings for the fresh comps (async;
        // seeds only untouched 'similar' ratings, never user choices)
        suggestSchoolRatings().catch(() => {});
    } catch (e) {
        if (runId !== suggestRunId) return;
        compCandidatesPanel.innerHTML = '';
        const warn = document.createElement('div');
        warn.className = 'appraisal-warning';
        warn.innerHTML = 'Comp search failed — check the connection. '
            + '<button class="btn btn-secondary" style="padding: 0.25rem 0.7rem; font-size: 0.75rem;">Retry</button>';
        warn.querySelector('button').addEventListener('click', suggestComps);
        const restore = makeRestoreButton();
        if (restore) warn.appendChild(restore);
        compCandidatesPanel.appendChild(warn);
    }
}

// "Restore previous comps" — undo the page-entry wipe when the search that
// was meant to replace them failed or came back empty.
function makeRestoreButton() {
    if (!preResetComps) return null;
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.cssText = 'padding: 0.25rem 0.7rem; font-size: 0.75rem; margin-left: 0.5rem;';
    btn.textContent = 'Restore previous comps';
    btn.addEventListener('click', () => {
        if (!preResetComps) return;
        appraisalComps = preResetComps;
        preResetComps = null;
        compCandidatesPanel.classList.add('hidden');
        renderComps();
        recalcAppraisal();
    });
    return btn;
}

// Addresses from different providers differ in punctuation and spacing
// ("412 Oak Ave." vs "412 Oak Ave"); compare on alphanumerics only, the same
// normalization the worker's /comps dedup uses.
function normalizeAddr(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The best-scoring priced candidates go straight into the comp slots so the
// ARV reads instantly; the candidate list stays rendered for swaps/additions.
// Only ever fills EMPTY slots and skips addresses already on a card, so a
// re-run (Retry/Refresh) can't duplicate comps or clobber manual entries.
// The subject's own sale is never auto-applied — at distance 0 it would
// outscore every real comp and anchor the ARV to the purchase price.
// Returns how many comps were applied; repaints once, not per comp.
function autoApplyCandidates(ranked) {
    const subjectAddr = normalizeAddr(subjectAddressInput.value.split(',')[0]);
    const priced = new Set();
    const labelOnly = new Set();
    appraisalComps.forEach(x => {
        const key = normalizeAddr(x.label);
        if (key) (Engine.num(x.salePrice) > 0 ? priced : labelOnly).add(key);
    });
    let room = Math.min(
        AUTO_APPLY_COUNT,
        appraisalComps.filter(x => !Engine.num(x.salePrice) && !x.label).length
    );
    let applied = 0;
    for (const c of ranked) {
        const addr = normalizeAddr(c.address);
        if (subjectAddr && addr === subjectAddr) { c.isSubject = true; continue; }
        if (priced.has(addr)) { c.autoAdded = true; continue; } // already on a card
        // A label-only card (address typed, no price yet) blocks auto-fill
        // for that address but leaves the Add button live for a deliberate click
        if (labelOnly.has(addr)) continue;
        if (room <= 0 || !(c.price > 0)) continue;
        if (!applyCandidateData(c)) continue;
        c.autoAdded = true;
        priced.add(addr);
        room--;
        applied++;
    }
    if (applied) {
        renderComps();
        recalcAppraisal();
    }
    return applied;
}

function addCandidateAsComp(c) {
    if (!applyCandidateData(c)) return;
    renderComps();
    recalcAppraisal();
}

// Pure data move — callers render/recalc themselves so batch fills repaint once
function applyCandidateData(c) {
    // Fill the first truly empty slot, else append (bounded by MAX_COMPS)
    let comp = appraisalComps.find(x => !Engine.num(x.salePrice) && !x.label);
    if (!comp) {
        if (appraisalComps.length >= MAX_COMPS) return false;
        comp = emptyCompSlot();
        appraisalComps.push(comp);
    }
    comp.label = c.address;
    if (c.lat != null && c.lon != null) { comp.lat = c.lat; comp.lon = c.lon; }
    if (c.price > 0) comp.salePrice = c.price;
    if (c.sqft) comp.sqft = c.sqft;
    if (c.beds != null) comp.beds = c.beds;
    if (c.baths != null) comp.baths = c.baths;
    if (c.lotSqft) comp.lotSqft = c.lotSqft;
    if (c.yearBuilt) comp.yearBuilt = c.yearBuilt;
    if (c.propType) comp.propType = c.propType;
    if (c.soldDate) {
        comp.lastSaleDate = String(c.soldDate).slice(0, 10);
        // Age from the CONTRACT date — when the price was actually agreed,
        // about a month before closing. Anchoring on the close date is late
        // by that much on every comp, always in the same direction.
        const months = Math.round(
            Engine.compMonthsAgo({ closeDate: c.soldDate, contractDate: c.contractDate }));
        if (months >= 0 && months <= 24) comp.monthsAgo = months;
    }
    if (c.price > 0) comp.lastSalePrice = c.price;
    // Provenance travels with the number so the card can say whether this is
    // a recorded closing or a list-at-sale proxy
    if (c.priceType) comp.priceType = c.priceType;
    if (c.source) comp.priceSource = c.source;
    if (c.mlsNumber) comp.mlsNumber = c.mlsNumber;
    // The GetObject key and photo count travel with the comp so the card can
    // open the photo viewer after the candidate list is long gone
    if (c.listingKey) comp.listingKey = c.listingKey;
    if (c.photosCount > 0) comp.photosCount = c.photosCount;
    // Concessions are engine math, not a note: the grid nets them off the
    // price before the time adjustment
    if (c.concessions > 0) comp.concessions = c.concessions;
    if (c.concessionsComments) comp.concessionsComments = c.concessionsComments;
    // Condition: the listing agent's coded PropertyCondition when the feed
    // carries one, else read from the remarks when the language is clear.
    // Otherwise the card default (renovated) stands but is FLAGGED so the
    // assumption is never silent. Remarks survive closing; photos don't.
    // ...then cross-checked against what the comp actually sold for per
    // square foot. Marketing prose is a weak signal and "sold as-is" is
    // boilerplate; a full condition uplift is the single largest line in the
    // grid, so it does not get to fire on a phrase the sale price contradicts.
    // A HUMAN read from the photos outranks everything: the research's one
    // clear result on condition is that human labels beat both the prose
    // classifier and CV scoring, and the photos are exactly what the person
    // looked at. Set from the photo viewer on the candidate row.
    if (c.userCondition) {
        comp.condition = c.userCondition;
        comp.conditionEvidence = 'photos — your read';
        comp.conditionUnverified = false;
        delete comp.conditionConflict;
        return true;
    }
    const textRead = Engine.classifyCondition(c.remarks, c.propertyCondition);
    const read = Engine.reconcileCondition(textRead, c.ppsfDeviationPct);
    if (read && read.trusted) {
        comp.condition = read.condition;
        comp.conditionEvidence = read.evidence;
        comp.conditionUnverified = false;
        delete comp.conditionConflict;
    } else {
        comp.conditionUnverified = true;
        if (read && read.conflict) comp.conditionConflict = read.conflict;
    }
    return true;
}

function renderCandidates(list) {
    compCandidatesPanel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'candidates-head';
    // The old blanket "prices are list-at-sale, verify against MLS" line was
    // honest when every price was a scrape. With a licensed feed the same
    // sentence is just wrong, so it tracks what actually came back.
    const truth = compsMeta.priceTruth;
    const mlsName = (compsMeta.mls && compsMeta.mls.name) || 'MLS';
    const priceLine = truth === 'closed'
        ? `Prices are recorded ${mlsName} closings.`
        : truth === 'mixed'
            ? `Mixed sources — rows marked “${mlsName} closed” are recorded sales; the rest are list-at-sale proxies to verify.`
            : truth === 'none'
                ? ''
                : 'Prices are list-at-sale (TX non-disclosure); verify against MLS before relying on them.';
    const headText = document.createElement('span');
    headText.textContent = 'Suggested comps — the top matches were auto-filled into the comp cards below; '
        + 'swap in any other candidate or add your own. ' + priceLine;
    head.appendChild(headText);
    head.insertAdjacentHTML('beforeend',
        '<span style="display: flex; gap: 0.35rem; flex-shrink: 0;">'
        + '<button class="comp-remove" data-act="refresh" title="Search again">&#x21bb;</button>'
        + '<button class="comp-remove" data-act="close" title="Close">&times;</button></span>');
    head.querySelector('[data-act="refresh"]').addEventListener('click', suggestComps);
    head.querySelector('[data-act="close"]').addEventListener('click', () => compCandidatesPanel.classList.add('hidden'));
    compCandidatesPanel.appendChild(head);
    if (!list.length) {
        const none = document.createElement('div');
        none.className = 'candidates-note';
        none.textContent = 'No recent solds found nearby — add comps manually from MLS.';
        const restore = makeRestoreButton();
        if (restore) none.appendChild(restore);
        compCandidatesPanel.appendChild(none);
        return;
    }
    list.forEach(c => {
        const row = document.createElement('div');
        row.className = 'candidate-row';
        const textRead = Engine.classifyCondition(c.remarks, c.propertyCondition);
        const read = Engine.reconcileCondition(textRead, c.ppsfDeviationPct);
        const conditionNote = !textRead
            ? (c.remarks ? 'remarks: no condition signal' : 'no remarks')
            : (read && read.trusted)
                ? `${textRead.from === 'field' ? 'MLS condition' : 'remarks'} → ${textRead.condition} (“${textRead.evidence}”)`
                : `⚠ ${read.conflict}`;
        const priceNote = !c.price ? 'no price'
            : formatCurrency(c.price) + (c.priceType === 'closed' ? ' closed' : ' list');
        const specs = [
            priceNote,
            // $/sqft is how you see at a glance that two "comps" are in
            // different market segments — it is the number an appraiser
            // scans first, and the grid cannot adjust a segment mismatch away
            c.ppsf ? `$${c.ppsf}/sf${c.ppsfOutlier ? ' ⚠ off-market-rate' : ''}` : null,
            c.soldDate ? `sold ${String(c.soldDate).slice(0, 10)}` : null,
            c.concessions > 0 ? `−${formatCurrency(c.concessions)} concessions` : null,
            c.sqft ? `${c.sqft.toLocaleString()} sqft` : null,
            (c.beds != null && c.baths != null) ? `${c.beds} bd / ${c.baths} ba` : null,
            c.yearBuilt ? `blt ${c.yearBuilt}` : null,
            c.distanceMi != null ? `${c.distanceMi} mi` : null,
            c.dom != null ? `${c.dom} DOM` : null,
            // Correlation is a RentCast score; it means nothing on an MLS row
            c.correlation != null ? `RentCast ${(c.correlation * 100).toFixed(0)}%` : null,
            conditionNote
        ].filter(Boolean).join(' · ');
        if (c.remarks) row.title = c.remarks.slice(0, 600); // hover to read the listing text
        row.innerHTML = `
            <div class="candidate-main">
                <div class="candidate-addr"></div>
                <div class="candidate-specs"></div>
            </div>
            <span class="candidate-score" title="similarity to subject (0–100)"></span>
            <button class="btn btn-secondary candidate-photos" title="View listing photos and judge condition yourself">📷</button>
            <button class="btn btn-secondary candidate-add">Add</button>`;
        const photosBtn = row.querySelector('.candidate-photos');
        if (c.listingKey) {
            photosBtn.addEventListener('click', () => openPhotoViewer({
                listingKey: c.listingKey,
                photosCount: c.photosCount,
                label: c.address,
                onCondition: (cond) => {
                    // Remember the read on the candidate so Add carries it —
                    // and if this one is already on a card, flow it through now
                    c.userCondition = cond;
                    const comp = appraisalComps.find(x =>
                        normalizeAddr(x.label) === normalizeAddr(c.address));
                    if (comp) {
                        comp.condition = cond;
                        comp.conditionEvidence = 'photos — your read';
                        comp.conditionUnverified = false;
                        delete comp.conditionConflict;
                        renderComps();
                        recalcAppraisal();
                    }
                }
            }));
        } else {
            // A fallback-source candidate has no MLS key and therefore no photos
            photosBtn.disabled = true;
            photosBtn.title = 'No MLS photos for this source';
        }
        const addrEl = row.querySelector('.candidate-addr');
        addrEl.textContent = c.address;
        // Only a recorded closing earns the badge — a proxy row stays bare
        // rather than being dressed up as verified
        if (c.priceType === 'closed') {
            const badge = document.createElement('span');
            badge.className = 'truth-verified candidate-badge';
            badge.textContent = ' ✓ ' + (c.source || 'MLS');
            badge.title = 'Recorded closing from the MLS feed';
            addrEl.appendChild(badge);
        }
        row.querySelector('.candidate-specs').textContent = specs;
        row.querySelector('.candidate-score').textContent = c.score;
        const btn = row.querySelector('.candidate-add');
        if (c.isSubject) {
            btn.disabled = true;
            btn.textContent = 'Subject';
            btn.title = "The subject property's own sale — shown for reference, not usable as a comp";
        } else if (c.autoAdded) {
            btn.disabled = true;
            btn.textContent = 'Added ✓';
        }
        btn.addEventListener('click', () => {
            addCandidateAsComp(c);
            btn.disabled = true;
            btn.textContent = 'Added ✓';
        });
        compCandidatesPanel.appendChild(row);
    });
    appendMlsAttribution(compCandidatesPanel,
        (compsMeta.mls && compsMeta.mls.used) ? compsMeta.mls.attribution : null);
}

// Every MLS data licence requires the compilation to be attributed wherever
// its data is shown. The worker passes the exact wording through from the
// MLS_ATTRIBUTION secret so the licence text is whatever the DLA demands,
// not something this app invented.
function appendMlsAttribution(container, text) {
    if (!container) return;
    // Re-rendering must not stack duplicates - the subject panel is refreshed
    // on every lookup, unlike the comps panel which is rebuilt wholesale.
    container.querySelectorAll(':scope > .mls-attribution').forEach(n => n.remove());
    if (!text) return;
    const note = document.createElement('div');
    note.className = 'mls-attribution';
    note.textContent = text;
    container.appendChild(note);
}

// ==================== Rent Ladder ====================
// Worker /rent: RentCast rent AVM (secret) + HUD SAFMR by zip (secret) +
// active realtor.com rentals (keyless). Button-triggered — a rent-AVM call
// is billable, so it never fires behind the user's back.

const rentNote = document.getElementById('rent-note');
let rentData = null;
let rentDataFor = null; // address the cached ladder belongs to

function subjectZip() {
    const zips = subjectAddressInput.value.match(/\b\d{5}\b/g);
    return zips ? zips[zips.length - 1] : '';
}

function renderRentNote() {
    const addr = subjectAddressInput.value.trim();
    if (rentData && rentDataFor === addr) { renderRentLadder(); return; }
    rentNote.innerHTML = '';
    if (!lastSelectedCoords && !addr) {
        rentNote.textContent = 'Set the subject address on step 1 and the market-rent ladder can price this field.';
        return;
    }
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.cssText = 'padding: 0.2rem 0.7rem; font-size: 0.72rem;';
    btn.textContent = '⌕ Estimate market rent';
    btn.addEventListener('click', fetchRent);
    rentNote.append('Market check: ');
    rentNote.appendChild(btn);
}

async function fetchRent() {
    const addr = subjectAddressInput.value.trim();
    const q = new URLSearchParams();
    if (lastSelectedCoords) {
        q.set('latitude', String(lastSelectedCoords.lat));
        q.set('longitude', String(lastSelectedCoords.lon));
    } else if (addr) {
        q.set('address', addr);
    } else {
        return;
    }
    const zip = subjectZip();
    if (zip) q.set('zip', zip);
    const sqft = Engine.num(subjectSqftInput.value);
    if (sqft > 0) q.set('sqft', String(sqft));
    const beds = Engine.num(subjectBedsInput.value);
    if (beds > 0) q.set('beds', String(beds));
    const baths = totalBaths(subjectBathsFullInput, subjectBathsHalfInput);
    if (baths > 0) q.set('baths', String(baths));

    rentNote.textContent = 'Checking market rent…';
    try {
        const res = await fetch(`${workerBase()}/rent?${q}`, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        rentData = await res.json();
        rentDataFor = addr;
        renderRentLadder();
    } catch (e) {
        rentNote.innerHTML = '';
        rentNote.append('Rent check failed — connection or worker. ');
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = 'Retry';
        btn.addEventListener('click', fetchRent);
        rentNote.appendChild(btn);
    }
}

function renderRentLadder() {
    const d = rentData;
    if (!d) return;
    rentNote.innerHTML = '';
    const sqft = Engine.num(subjectSqftInput.value);
    const compsRead = Engine.rentFromComps({ sqft }, d.rentals);
    // A closed lease is a transacted rent; an AVM is a model of one. When the
    // feed produced real closings they lead, and the AVM (which bills a
    // credit) isn't even fetched.
    const market = (compsRead && compsRead.basis === 'closed')
        ? compsRead.estimate
        : (d.rentcast && d.rentcast.rent > 0
            ? Math.round(d.rentcast.rent)
            : (compsRead ? compsRead.estimate : 0));

    if (!market) {
        rentNote.append('No market-rent signal near the subject — no nearby rental listings'
            + (d.rentcast ? '' : ' and no RentCast key on the worker') + '. Enter rent from your own comps.');
        return;
    }

    const l1 = document.createElement('div');
    l1.append('Market rent ≈ ');
    const fig = document.createElement('span');
    fig.className = 'tax-figure';
    fig.textContent = `${formatCurrency(market)}/mo`;
    l1.appendChild(fig);
    const sources = [];
    if (compsRead && compsRead.basis === 'closed') {
        sources.push(`${compsRead.used} closed lease${compsRead.used === 1 ? '' : 's'}`
            + (d.mls ? ` on ${d.mls.name}` : '') + ` → ${formatCurrency(compsRead.estimate)}`
            + (compsRead.ppsfMedian ? ` ($${compsRead.ppsfMedian.toFixed(2)}/sqft)` : ''));
    }
    if (d.rentcast && d.rentcast.rent > 0) {
        sources.push(`RentCast ${formatCurrency(d.rentcast.rent)}`
            + (d.rentcast.low ? ` (${formatCurrency(d.rentcast.low)}–${formatCurrency(d.rentcast.high)})` : ''));
    }
    if (compsRead && compsRead.basis !== 'closed') {
        sources.push(`${compsRead.used} listed rental${compsRead.used === 1 ? '' : 's'} nearby → ${formatCurrency(compsRead.estimate)}`
            + (compsRead.ppsfMedian ? ` ($${compsRead.ppsfMedian.toFixed(2)}/sqft)` : ''));
    }
    if (sources.length) l1.append(' · ' + sources.join(' · '));
    if (compsRead && compsRead.basis === 'closed') {
        const tag = document.createElement('span');
        tag.className = 'truth-verified';
        tag.textContent = ' ✓ signed leases, not asking rents';
        l1.appendChild(tag);
    }
    rentNote.appendChild(l1);

    const beds = Math.round(Engine.num(subjectBedsInput.value));
    if (d.hud && d.hud.byBedroom && d.hud.byBedroom[beds] > 0) {
        const hud = document.createElement('div');
        const std = d.hud.byBedroom[beds];
        hud.textContent = `Section 8 SAFMR ${beds}BR ${d.hud.zip}: ${formatCurrency(std)}`
            + (std >= market ? ' — voucher standard meets market: Section 8 candidate.' : '.');
        rentNote.appendChild(hud);
    }

    // Lender reality: DSCR takes the LOWER of lease vs market rent (Form
    // 1007 logic); conventional counts 75% of market
    const userRent = Engine.num(monthlyRentInput.value);
    const lender = document.createElement('div');
    lender.append(`Lender view: DSCR uses the lower of lease vs market; conventional counts 75% ≈ ${formatCurrency(Math.round(market * 0.75))}.`);
    if (userRent > market * 1.05) {
        const warn = document.createElement('span');
        warn.className = 'tax-figure';
        warn.textContent = ` Your ${formatCurrency(userRent)} runs ${Math.round((userRent / market - 1) * 100)}% above market — expect underwriting at ${formatCurrency(market)}.`;
        lender.appendChild(warn);
    }
    rentNote.appendChild(lender);

    if (userRent !== market) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'margin-top: 0.3rem; padding: 0.2rem 0.7rem; font-size: 0.72rem;';
        btn.textContent = `Use ${formatCurrency(market)}/mo`;
        btn.addEventListener('click', () => {
            monthlyRentInput.value = market;
            calculateDeal();
            renderRentLadder();
        });
        rentNote.appendChild(btn);
    } else {
        const ok = document.createElement('span');
        ok.className = 'tax-applied';
        ok.textContent = ' ✓ in use';
        rentNote.appendChild(ok);
    }
}

// ==================== Live Market Scan ====================
// Worker /market (keyless realtor.com): recent solds, actives and pendings
// within a mile. Auto-fills the absorption meter, buckets solds into the
// appraiser's 0–3/4–6/7–12-month trend grid, and reads the competition
// standing at the appraised ARV. Runs alongside comp suggestion.

const marketScanEl = document.getElementById('market-scan');
let marketScanData = null;
let marketRunId = 0;

async function scanMarket() {
    const address = subjectAddressInput.value.trim();
    if (!lastSelectedCoords && !address) return;
    const q = new URLSearchParams();
    if (lastSelectedCoords) {
        q.set('latitude', String(lastSelectedCoords.lat));
        q.set('longitude', String(lastSelectedCoords.lon));
    } else {
        q.set('address', address);
    }
    const marketZip = subjectZip(); // RETS can only be bounded by postcode — see suggestComps()
    if (marketZip) q.set('zip', marketZip);
    const runId = ++marketRunId;
    marketScanData = null;
    marketScanEl.textContent = 'Scanning live listings near the subject…';
    marketScanEl.classList.remove('hidden');
    try {
        const res = await fetch(`${workerBase()}/market?${q}`, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (runId !== marketRunId) return; // superseded / user left for the subject page
        marketScanData = data;
        // Auto-fill the absorption meter from live counts (still editable)
        const sold90 = data.solds.filter(s =>
            s.soldDate && (Date.now() - new Date(s.soldDate).getTime()) / 86400000 <= 90).length;
        mktActivesInput.value = data.actives.length;
        mktPendingsInput.value = data.pendings.length;
        mktSold90Input.value = sold90;
        updateAbsorption();
        updateMaxOffer(); // rule % follows the fresh market temperature
        renderMarketScan();
    } catch (e) {
        if (runId !== marketRunId) return;
        marketScanEl.innerHTML = '';
        marketScanEl.append('Market scan failed — counts stay manual. ');
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = 'Retry';
        btn.addEventListener('click', scanMarket);
        marketScanEl.appendChild(btn);
    }
}

function renderMarketScan() {
    if (!marketScanData) return;
    const d = marketScanData;
    const median = (arr) => {
        if (!arr.length) return null;
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    marketScanEl.innerHTML = '';
    marketScanEl.classList.remove('hidden');

    const l1 = document.createElement('div');
    l1.append('Live within 1 mi: ');
    const counts = document.createElement('span');
    counts.className = 'scan-strong';
    counts.textContent = `${d.actives.length} active · ${d.pendings.length} pending · `
        + `${d.totals.sold12mo != null ? d.totals.sold12mo : d.solds.length} sold in 12 mo`;
    l1.appendChild(counts);
    l1.append(' — meter auto-filled');
    // A licensed hot sheet and a scrape of a portal are not the same reading;
    // the panel says which one produced these counts
    if (d.source) {
        const src = document.createElement('span');
        src.className = d.priceTruth === 'closed' ? 'truth-verified' : 'truth-proxy';
        src.textContent = ` from ${d.source}`;
        src.title = d.priceTruth === 'closed'
            ? 'Recorded closings and real listing statuses straight from the MLS feed'
            : 'Scraped portal listings — counts and prices are approximate';
        l1.appendChild(src);
    }
    l1.append('. ');
    const rescan = document.createElement('button');
    rescan.className = 'btn btn-secondary';
    rescan.textContent = '⟳';
    rescan.title = 'Re-scan live listings';
    rescan.addEventListener('click', scanMarket);
    l1.appendChild(rescan);
    marketScanEl.appendChild(l1);

    const trend = Engine.marketTrend(d.solds);
    if (trend.buckets.some(b => b.count > 0)) {
        const l2 = document.createElement('div');
        l2.append('Solds — ' + trend.buckets
            .map(b => `${b.label}: ${b.count}${b.medianPrice ? ` @ ${formatCurrency(b.medianPrice)}` : ''}`)
            .join(' · ') + (trend.direction ? ' → prices ' : ''));
        if (trend.direction) {
            const dir = document.createElement('span');
            dir.className = `trend-${trend.direction}`;
            dir.textContent = `${trend.direction} ${trend.changePct > 0 ? '+' : ''}${trend.changePct.toFixed(1)}%`;
            l2.appendChild(dir);
        }
        marketScanEl.appendChild(l2);
        // True days-on-market only exists on a licensed feed — it is the
        // number a flip holding period should actually be built on
        if (trend.medianDom != null) {
            const dom = document.createElement('div');
            // Marketing time to contract, plus the ~30 days a DFW close takes
            // after that — the hold period a flip actually has to fund.
            const toContract = Math.max(1, Math.round(trend.medianDom / 30));
            const suggested = Math.max(1, Math.round((trend.medianDom + 30) / 30));
            dom.textContent = `Median days on market (12 mo): ${Math.round(trend.medianDom)}`
                + ` — a resale here takes about ${toContract} month${toContract === 1 ? '' : 's'}`
                + ` to go under contract, plus roughly a month to close. `;
            // The hold period drives carry, interest, annualized ROI and the
            // max offer, and it has always been a hardcoded 6 sitting next to
            // a measured figure that never reached it.
            const rehabMonths = Math.max(0, Engine.num(rehabBudgetInput.value) > 0 ? 2 : 0);
            const target = suggested + rehabMonths;
            const cur = Engine.num(holdingPeriodInput.value);
            if (Math.abs(cur - target) <= 0) {
                const ok = document.createElement('span');
                ok.className = 'tax-applied';
                ok.textContent = ' ✓ hold period matches';
                dom.appendChild(ok);
            } else {
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary';
                btn.textContent = `Set hold to ${target} mo`;
                btn.title = `${suggested} months to market and close`
                    + (rehabMonths ? ` + ${rehabMonths} months of rehab` : '');
                btn.addEventListener('click', () => {
                    holdingPeriodInput.value = target;
                    calculateDeal();
                });
                dom.appendChild(btn);
            }
            marketScanEl.appendChild(dom);
        }
    }

    const arv = lastAppraisal && lastAppraisal.arv > 0 ? lastAppraisal.arv : 0;
    if (arv > 0) {
        const band = d.actives.filter(a => a.listPrice > 0 && Math.abs(a.listPrice - arv) <= arv * 0.10);
        const ppsf = median(d.actives.filter(a => a.listPrice > 0 && a.sqft > 0).map(a => a.listPrice / a.sqft));
        const l3 = document.createElement('div');
        l3.append(`Competition at your ${formatCurrency(arv)} ARV: `);
        const b = document.createElement('span');
        b.className = 'scan-strong';
        b.textContent = `${band.length} active${band.length === 1 ? '' : 's'} within ±10%`;
        l3.appendChild(b);
        l3.append(` — you'd list as #${band.length + 1} in that band`
            + (ppsf ? ` · actives ask ${formatCurrency(ppsf)}/sqft` : '') + '.');
        marketScanEl.appendChild(l3);
    }
}

// ==================== Site Map & Influence Scan ====================
// Leaflet + Esri imagery for the eyeball read (pools, greenbelts, what the
// lot actually backs to); Overpass (OSM, keyless + CORS-open) for the
// programmatic read: nearest major road / rail / power line / commercial
// and parks or green space, plus mapped swimming pools on the parcel.

const siteMapEl = document.getElementById('site-map');
const siteFrontEl = document.getElementById('site-front');
const siteFrontImg = document.getElementById('site-front-img');
const siteFrontEmpty = document.getElementById('site-front-empty');
const gmapsKeyInput = document.getElementById('gmaps-key');
const scanSiteBtn = document.getElementById('scan-site-btn');
const siteInfluencesEl = document.getElementById('site-influences');
const GMAPS_KEY_STORAGE = 'underwriter-gmaps-key';
let siteMap = null;
let siteMarker = null;

// Street View Static URL, or null without a key (Google keys are designed
// to ship client-side, restricted by referrer in the Google console)
function frontViewUrl(lat, lon) {
    const key = gmapsKeyInput.value.trim();
    if (!key) return null;
    return `https://maps.googleapis.com/maps/api/streetview?size=500x280&location=${lat},${lon}&fov=80&key=${encodeURIComponent(key)}`;
}

function updateFrontView(lat, lon) {
    siteFrontEl.classList.remove('hidden');
    const url = frontViewUrl(lat, lon);
    if (url) {
        siteFrontImg.src = url;
        siteFrontImg.classList.remove('hidden');
        siteFrontEmpty.classList.add('hidden');
    } else {
        siteFrontImg.classList.add('hidden');
        siteFrontEmpty.classList.remove('hidden');
    }
}

function metersToFeet(m) { return Math.round(m * 3.28084); }

function haversineMeters(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function resolveSubjectCoords() {
    if (lastSelectedCoords) return lastSelectedCoords;
    const address = subjectAddressInput.value.trim();
    if (!address) return null;
    const list = await realtorSuggestions(address);
    if (list.length && list[0].lat != null) {
        lastSelectedCoords = { lat: list[0].lat, lon: list[0].lon };
        return lastSelectedCoords;
    }
    return null;
}

function showSiteMap(lat, lon) {
    if (typeof L === 'undefined') return; // CDN unavailable — scan still works
    siteMapEl.classList.remove('hidden');
    if (!siteMap) {
        siteMap = L.map(siteMapEl).setView([lat, lon], 18);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Imagery © Esri'
        }).addTo(siteMap);
        siteMarker = L.marker([lat, lon]).addTo(siteMap);
    } else {
        siteMap.setView([lat, lon], 18);
        siteMarker.setLatLng([lat, lon]);
    }
    // Container may have been hidden when Leaflet measured it
    setTimeout(() => siteMap.invalidateSize(), 60);
    updateFrontView(lat, lon);
}

// Nearest mapped feature per category around a point (~1,300 ft radius;
// pools only within ~115 ft so a neighbor's pool doesn't read as ours)
async function overpassScan(lat, lon) {
    const q = `[out:json][timeout:25];(
way(around:400,${lat},${lon})[highway~"^(motorway|trunk|primary|secondary)$"];
way(around:400,${lat},${lon})[railway=rail];
way(around:400,${lat},${lon})[power=line];
node(around:400,${lat},${lon})[power=tower];
way(around:400,${lat},${lon})[landuse~"^(commercial|retail|industrial)$"];
way(around:400,${lat},${lon})[leisure~"^(park|nature_reserve|golf_course)$"];
way(around:400,${lat},${lon})[landuse=recreation_ground];
way(around:35,${lat},${lon})[leisure=swimming_pool];
);out tags geom 80;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q)
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();

    const nearest = {}; // category -> { dist (m), name }
    const consider = (cat, dist, name) => {
        if (!nearest[cat] || dist < nearest[cat].dist) nearest[cat] = { dist, name };
    };
    for (const el of data.elements || []) {
        const t = el.tags || {};
        let dist = Infinity;
        if (el.type === 'node' && el.lat != null) {
            dist = haversineMeters(lat, lon, el.lat, el.lon);
        } else if (el.geometry) {
            for (const p of el.geometry) {
                const d = haversineMeters(lat, lon, p.lat, p.lon);
                if (d < dist) dist = d;
            }
        }
        if (!Number.isFinite(dist)) continue;
        if (t.highway) consider('road', dist, t.name || 'major road');
        else if (t.railway) consider('rail', dist, t.name || 'railroad');
        else if (t.power) consider('power', dist, 'power line');
        else if (t.landuse === 'commercial' || t.landuse === 'retail' || t.landuse === 'industrial') {
            consider('commercial', dist, t.name || t.landuse);
        } else if (t.leisure === 'swimming_pool') consider('pool', dist, 'pool');
        else if (t.leisure || t.landuse) consider('green', dist, t.name || 'park / green space');
    }
    return nearest;
}

// Chips: bad = likely external obsolescence, good = value-positive backing
function influenceChips(nearest) {
    const chips = [];
    const ft = (d) => `${metersToFeet(d).toLocaleString()} ft`;
    if (nearest.road) chips.push({ kind: nearest.road.dist < 120 ? 'bad' : 'note', text: `Major road: ${nearest.road.name} · ${ft(nearest.road.dist)}` });
    if (nearest.rail) chips.push({ kind: nearest.rail.dist < 200 ? 'bad' : 'note', text: `Railroad · ${ft(nearest.rail.dist)}` });
    if (nearest.power) chips.push({ kind: nearest.power.dist < 100 ? 'bad' : 'note', text: `Power line · ${ft(nearest.power.dist)}` });
    if (nearest.commercial) chips.push({ kind: nearest.commercial.dist < 120 ? 'bad' : 'note', text: `Commercial: ${nearest.commercial.name} · ${ft(nearest.commercial.dist)}` });
    if (nearest.green) {
        const backs = nearest.green.dist < 100;
        chips.push({ kind: backs ? 'good' : 'note', text: `${nearest.green.name} · ${ft(nearest.green.dist)}${backs ? ' — backs to green space' : ''}` });
    }
    if (nearest.pool) chips.push({ kind: 'good', text: 'Pool mapped on parcel' });
    return chips;
}

function renderSiteInfluences(nearest) {
    siteInfluencesEl.innerHTML = '';
    siteInfluencesEl.classList.remove('hidden');
    const chips = influenceChips(nearest);
    if (!chips.length) {
        const none = document.createElement('div');
        none.className = 'influence-chip note';
        none.textContent = 'No mapped influences within ~1,300 ft.';
        siteInfluencesEl.appendChild(none);
    }
    chips.forEach(c => {
        const div = document.createElement('div');
        div.className = `influence-chip ${c.kind}`;
        div.textContent = (c.kind === 'bad' ? '⚠ ' : c.kind === 'good' ? '✓ ' : '') + c.text;
        siteInfluencesEl.appendChild(div);
    });
    const note = document.createElement('div');
    note.className = 'influence-disclaimer';
    note.textContent = 'OpenStreetMap data — absence of a feature is not proof it isn\'t there. '
        + 'Use these for the Adverse Location / Lot Placement ratings on the comp cards.';
    siteInfluencesEl.appendChild(note);
}

// ---- Public-records scans: flood zone, expansive soil, permit history ----

function influenceChipDiv(c) {
    const div = document.createElement('div');
    div.className = `influence-chip ${c.kind}`;
    div.textContent = (c.kind === 'bad' ? '⚠ ' : c.kind === 'good' ? '✓ ' : '') + c.text;
    return div;
}

// FEMA NFHL via Esri's Living Atlas mirror (CORS-open, keyless). The view
// carries HAZARD polygons only, so an empty result means no special-hazard
// zone is mapped at the point. hazards.fema.gov itself is a dead end —
// no CORS headers for browsers AND 403/525 for Workers (checked 2026-08-14).
const NFHL_VIEW_URL = 'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Flood_Hazard_Areas_view/FeatureServer/0/query';

async function floodScan(lat, lon) {
    const q = new URLSearchParams({
        geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
        outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE', returnGeometry: 'false', f: 'json'
    });
    const res = await fetch(`${NFHL_VIEW_URL}?${q}`, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.error) return null;
    const attrs = d.features && d.features[0] && d.features[0].attributes;
    if (!attrs) return { kind: 'good', text: 'Flood: no special flood hazard zone mapped here (FEMA NFHL)' };
    const read = Engine.readFloodZone(attrs.FLD_ZONE, attrs.ZONE_SUBTY);
    if (!read) return null;
    const bfe = (attrs.STATIC_BFE != null && attrs.STATIC_BFE > -9000) ? ` (base flood elevation ${attrs.STATIC_BFE} ft)` : '';
    return { kind: read.severity === 'info' ? 'note' : read.severity, text: read.label + bfe };
}

// USDA Soil Data Access (CORS-open, keyless): dominant component's linear
// extensibility — the shrink-swell number behind DFW foundation trouble
async function soilScan(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    const sql = 'SELECT TOP 1 c.compname, ch.lep_r FROM component c '
        + 'JOIN chorizon ch ON ch.cokey = c.cokey WHERE c.mukey IN '
        + `(SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lo} ${la})')) `
        + "AND c.majcompflag = 'Yes' AND ch.lep_r IS NOT NULL "
        + 'ORDER BY c.comppct_r DESC, ch.lep_r DESC';
    const res = await fetch('https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, format: 'JSON' })
    });
    if (!res.ok) return null;
    const d = await res.json();
    const row = d && d.Table && d.Table[0];
    if (!row) return null;
    const read = Engine.readShrinkSwell(row[1], row[0]);
    if (!read) return null;
    return { kind: read.severity === 'info' ? 'note' : read.severity, text: 'Soil — ' + read.label };
}

// Shared ArcGIS point query — TAD, FEMA, TEA, TxDOT and the ACS layers all
// speak the same REST dialect (returns attribute objects, [] on no hit,
// null on transport/API error)
async function arcgisPointQuery(layerUrl, lon, lat, extraParams) {
    const q = new URLSearchParams({
        geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
        returnGeometry: 'false', f: 'json', ...(extraParams || {})
    });
    const res = await fetch(`${layerUrl}/query?${q}`, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.error) return null;
    return (d.features || []).map(f => f.attributes);
}

// ---- School district + TEA A–F rating (keyless, verified 2026-08-14) ----
// Boundaries: TEA's SY25-26 district polygons. Ratings: the txschools.gov
// feature view — its service name carries a refresh date, so the known name
// is tried first and rediscovered from the TEA org's service list if it
// ever 400s (TEA republishes under a new date).
const TEA_ORG = 'https://services2.arcgis.com/5MVN2jsqIrNZD4tP/arcgis/rest/services';
const TEA_DISTRICT_POLYGONS = `${TEA_ORG}/School_Districts__2026/FeatureServer/0`;
let teaRatingsUrl = `${TEA_ORG}/districts_schools_2026_0814D__view/FeatureServer/0`;
const teaGradeCache = new Map();    // district name -> 'A'..'F' | null
const districtCache = new Map();    // "lat,lon" (4dp) -> district name | null

async function teaDistrictGrade(districtName) {
    if (teaGradeCache.has(districtName)) return teaGradeCache.get(districtName);
    const fetchGrade = async () => {
        const where = `district_name = '${districtName.replace(/'/g, "''")}'`;
        const res = await fetch(`${teaRatingsUrl}/query?` + new URLSearchParams({
            where, outFields: 'district_name,rating', returnGeometry: 'false', f: 'json'
        }));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (d.error) throw new Error('view gone');
        const row = (d.features || [])[0];
        const rating = row && row.attributes.rating;
        return rating && /^[A-F]/.test(rating) ? rating.charAt(0) : null;
    };
    let grade = null;
    try {
        grade = await fetchGrade();
    } catch (e) {
        // The dated view was republished — rediscover it from the org list
        try {
            const list = await (await fetch(`${TEA_ORG}?f=json`)).json();
            const views = (list.services || []).map(s => s.name)
                .filter(n => /^districts_schools_\d{4}_\d{4}D_?_view$/.test(n)).sort();
            if (views.length) {
                teaRatingsUrl = `${TEA_ORG}/${views[views.length - 1]}/FeatureServer/0`;
                grade = await fetchGrade().catch(() => null);
            }
        } catch (e2) { /* ratings stay unknown */ }
    }
    teaGradeCache.set(districtName, grade);
    return grade;
}

async function schoolDistrictAndGrade(lat, lon) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    let district = districtCache.get(key);
    if (district === undefined) {
        const rows = await arcgisPointQuery(TEA_DISTRICT_POLYGONS, lon, lat, { outFields: 'NAME' });
        district = (rows && rows[0] && rows[0].NAME) || null;
        districtCache.set(key, district);
    }
    if (!district) return null;
    return { district, grade: await teaDistrictGrade(district) };
}

async function schoolScan(lat, lon) {
    const s = await schoolDistrictAndGrade(lat, lon);
    if (!s) return null;
    const kind = !s.grade ? 'note' : (s.grade === 'A' || s.grade === 'B') ? 'good' : s.grade === 'C' ? 'note' : 'bad';
    return { kind, text: `School district: ${s.district}${s.grade ? ` — TEA rating ${s.grade}` : ' (no TEA rating on file)'}` };
}

// After comps auto-apply, seed the qualitative School District rating from
// actual TEA grades — evidence instead of gut feel. Only ever seeds a
// still-default 'similar' rating (never overrides the user), only across
// district lines, and records its evidence on the comp.
async function suggestSchoolRatings() {
    if (!lastSelectedCoords) return;
    const compsAtStart = appraisalComps;
    const rank = (g) => ({ A: 5, B: 4, C: 3, D: 2, F: 1 })[g] || null;
    const subj = await schoolDistrictAndGrade(lastSelectedCoords.lat, lastSelectedCoords.lon);
    if (!subj || !rank(subj.grade)) return;
    let changed = false;
    await Promise.all(appraisalComps.map(async (comp) => {
        const lat = parseFloat(comp.lat);
        const lon = parseFloat(comp.lon);
        if (!comp.label || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const c = await schoolDistrictAndGrade(lat, lon).catch(() => null);
        if (!c || !rank(c.grade) || c.district === subj.district) return;
        const suggested = rank(c.grade) > rank(subj.grade) ? 'superior'
            : rank(c.grade) < rank(subj.grade) ? 'inferior' : 'similar';
        if (suggested !== 'similar' && comp.ratings.schools === 'similar') {
            comp.ratings.schools = suggested;
            comp.schoolsEvidence = `TEA: ${c.district} ${c.grade} vs subject ${subj.district} ${subj.grade}`;
            changed = true;
        }
    }));
    if (changed && appraisalComps === compsAtStart) {
        renderComps();
        recalcAppraisal();
    }
}

// ---- TxDOT traffic counts (keyless, verified 2026-08-14) ----
const TXDOT_AADT_URL = 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_AADT_Annuals_(Public_View)/FeatureServer/0';

async function trafficScan(lat, lon) {
    const rows = await arcgisPointQuery(TXDOT_AADT_URL, lon, lat, {
        distance: '800', units: 'esriSRUnit_Meter',
        outFields: 'AADT_RPT_QTY,AADT_RPT_YEAR', resultRecordCount: '25'
    });
    if (!rows || !rows.length) return null; // no counted road within ~½ mi — quiet
    const top = rows.reduce((m, r) => ((r.AADT_RPT_QTY || 0) > (m.AADT_RPT_QTY || 0) ? r : m), {});
    if (!(top.AADT_RPT_QTY > 0)) return null;
    return {
        kind: 'note',
        text: `Traffic: busiest counted road within ½ mi carries ~${top.AADT_RPT_QTY.toLocaleString()} vehicles/day (TxDOT ${top.AADT_RPT_YEAR})`
    };
}

// ---- Crime density (per-city, like permits) ----
// Dallas PD publishes fresh geocoded incidents on Socrata (CORS-open,
// within_circle verified 2026-08-14). Fort Worth researched the same day:
// the fresh AGOL table stores coordinates as TEXT (no spatial queries) and
// the city's point layer is CORS-blocked AND stale (2018) — beat-level
// counts would need a worker proxy; revisit if a real feed appears.
const CRIME_SOURCES = {
    dallas: async (lat, lon) => {
        const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
        const where = `within_circle(geocoded_column, ${lat}, ${lon}, 402) AND date1 > '${since}'`;
        const res = await fetch('https://www.dallasopendata.com/resource/qv6i-rri7.json?$select=count(*)&$where='
            + encodeURIComponent(where), { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        const d = await res.json();
        const n = d && d[0] ? parseInt(d[0].count, 10) : NaN;
        if (!Number.isFinite(n)) return null;
        return { kind: 'note', text: `Crime: ${n.toLocaleString()} police incidents within ¼ mi in 12 mo (Dallas PD)` };
    }
};

async function crimeScan(address, lat, lon) {
    const parts = String(address || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const src = CRIME_SOURCES[parts[1].toLowerCase()];
    return src ? src(lat, lon) : null; // quiet outside covered cities
}

// ---- Neighborhood panel (Esri Living Atlas ACS tract layers, keyless) ----
// NOTE researched 2026-08-14: api.census.gov itself now REQUIRES an API key
// ("Missing Key" on keyless calls) — the Living Atlas mirrors are the
// keyless path. Income layer verified live; no national median-gross-rent
// layer exists, so the panel is income + rent burden (the rent ladder
// already covers rent levels).
const ACS_INCOME_TRACT = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/ACS_Median_Income_by_Race_and_Age_Selp_Emp_Boundaries/FeatureServer/2';
const ACS_HOUSING_TRACT = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/ACS_Housing_Costs_Boundaries/FeatureServer/2';

async function acsScan(lat, lon) {
    const [inc, hous] = await Promise.all([
        arcgisPointQuery(ACS_INCOME_TRACT, lon, lat, { outFields: 'B19049_001E,NAME' }).catch(() => null),
        arcgisPointQuery(ACS_HOUSING_TRACT, lon, lat, { outFields: 'B25070_calc_pctGE30pctE' }).catch(() => null)
    ]);
    const income = inc && inc[0] ? inc[0].B19049_001E : null;
    const burden = hous && hous[0] ? hous[0].B25070_calc_pctGE30pctE : null;
    const bits = [];
    if (income > 0) bits.push(`median household income ${formatCurrency(income)}`);
    if (Number.isFinite(burden)) bits.push(`${Math.round(burden)}% of renters pay ≥30% of income`);
    if (!bits.length) return null;
    const tract = inc && inc[0] && inc[0].NAME ? `${inc[0].NAME}: ` : '';
    return { kind: 'note', text: `Neighborhood (ACS 5-yr) — ${tract}${bits.join(' · ')}` };
}

// NWS hail history via the worker (IEM's 5-year CSV is ~1 MB — the worker
// caches it daily and returns a tiny distance-filtered summary)
async function hailScan(lat, lon) {
    const res = await fetch(`${workerBase()}/hail?latitude=${lat}&longitude=${lon}`, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const read = Engine.readHailHistory(await res.json());
    if (!read) return null;
    return { kind: read.severity === 'info' ? 'note' : read.severity, text: read.label };
}

// City permit feeds are per-city; only Dallas publishes a live keyless one.
// Fort Worth researched 2026-08-14: the BLDS Socrata feed is dead (stale
// since 2015), data.fortworthtexas.gov migrated to ArcGIS Hub, and the
// city's public ArcGIS org exposes no permits layer — slot it here the day
// one exists. Other DFW suburbs (incl. Benbrook) publish nothing.
const PERMIT_SOURCES = {
    dallas: {
        query: (street) => 'https://www.dallasopendata.com/resource/e7gq-4sah.json'
            + `?$where=${encodeURIComponent(`upper(street_address) like '${street}%'`)}`
            + `&$order=issued_date DESC&$limit=12`,
        map: (r) => ({
            type: r.permit_type || '',
            date: (r.issued_date || '').slice(0, 10),
            desc: r.work_description || ''
        })
    }
};

async function permitScan(address) {
    const parts = String(address || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const cityLabel = parts[1];
    const src = PERMIT_SOURCES[cityLabel.toLowerCase()];
    if (!src) return [{ kind: 'note', text: `Permits: ${cityLabel} publishes no open permit data (Dallas only so far)` }];
    const street = parts[0].toUpperCase().replace(/'/g, '');
    const res = await fetch(src.query(street), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const rows = (await res.json()).map(src.map);
    if (!rows.length) return [{ kind: 'note', text: 'Permits: none on file at this address (city open data)' }];
    const chips = [];
    const hay = (r) => `${r.type} ${r.desc}`;
    const foundation = rows.find(r => /foundation|pier/i.test(hay(r)));
    if (foundation) chips.push({ kind: 'bad', text: `Permit history: foundation work on file (${foundation.date || 'undated'}) — ask for the warranty transfer` });
    const roof = rows.find(r => /roof/i.test(hay(r)));
    if (roof) chips.push({ kind: 'good', text: `Permit history: roof permit ${roof.date || 'on file'}` });
    const latest = rows.slice(0, 3).map(r => `${r.date || '—'} ${(r.type || r.desc).slice(0, 40)}`.trim()).join(' · ');
    chips.push({ kind: 'note', text: `Permits on file: ${rows.length}${rows.length >= 12 ? '+' : ''} — ${latest}` });
    return chips;
}

async function scanSubjectSite() {
    scanSiteBtn.disabled = true;
    siteInfluencesEl.classList.remove('hidden');
    siteInfluencesEl.textContent = 'Reading map data…';
    try {
        const coords = await resolveSubjectCoords();
        if (!coords) {
            siteInfluencesEl.textContent = 'Set the property address first — the scan reads the map around it.';
            return;
        }
        showSiteMap(coords.lat, coords.lon);
        // Public-records pass (flood / soil / permits) runs alongside the
        // map and vision passes — each source fails independently and quietly
        const recordsPromise = Promise.all([
            floodScan(coords.lat, coords.lon).catch(() => null),
            soilScan(coords.lat, coords.lon).catch(() => null),
            hailScan(coords.lat, coords.lon).catch(() => null),
            schoolScan(coords.lat, coords.lon).catch(() => null),
            trafficScan(coords.lat, coords.lon).catch(() => null),
            crimeScan(subjectAddressInput.value, coords.lat, coords.lon).catch(() => null),
            acsScan(coords.lat, coords.lon).catch(() => null),
            permitScan(subjectAddressInput.value).catch(() => null)
        ]);
        // Measured pass (Overpass) and vision pass are independent — a busy
        // Overpass must not take the AI read down with it
        let poolSeen = false;
        try {
            const nearest = await overpassScan(coords.lat, coords.lon);
            renderSiteInfluences(nearest);
            poolSeen = Boolean(nearest.pool);
        } catch (overpassErr) {
            siteInfluencesEl.innerHTML = '';
            const busy = document.createElement('div');
            busy.className = 'influence-chip note';
            busy.textContent = 'Measured scan unavailable (Overpass busy) — AI vision read below.';
            siteInfluencesEl.appendChild(busy);
        }

        // AI vision pass — the app looks at the imagery itself and judges
        // adjacency, instead of only measuring distances to mapped features
        const pending = document.createElement('div');
        pending.className = 'influence-chip note';
        pending.textContent = '🤖 AI vision reading the imagery…';
        siteInfluencesEl.appendChild(pending);
        try {
            const vq = new URLSearchParams({
                latitude: String(coords.lat),
                longitude: String(coords.lon)
            });
            const sv = frontViewUrl(coords.lat, coords.lon);
            if (sv) vq.set('photo', sv);
            const vres = await fetch(`${workerBase()}/vision?${vq}`, { headers: { 'Accept': 'application/json' } });
            const v = vres.ok ? await vres.json() : null;
            pending.remove();
            const visionChips = [];
            const s = (v && v.satellite) || {};
            if (s.pool === 'yes') { visionChips.push({ kind: 'good', text: 'AI sees: pool on the parcel' }); poolSeen = true; }
            if (s.road === 'yes') visionChips.push({ kind: 'bad', text: 'AI sees: major road adjacent' });
            if (s.rail === 'yes') visionChips.push({ kind: 'bad', text: 'AI sees: railroad nearby' });
            if (s.commercial === 'yes') visionChips.push({ kind: 'bad', text: 'AI sees: commercial buildings adjacent' });
            if (s.green === 'yes') visionChips.push({ kind: 'good', text: 'AI sees: backs to green space' });
            const p = (v && v.photo) || {};
            if (p.powerlines === 'yes') visionChips.push({ kind: 'bad', text: 'AI sees: overhead power lines (street view)' });
            if (p.road === 'yes') visionChips.push({ kind: 'bad', text: 'AI sees: busy / multi-lane street (street view)' });
            if (!visionChips.length) {
                visionChips.push({ kind: 'note', text: v ? 'AI vision: nothing flagged in the imagery' : 'AI vision unavailable right now' });
            }
            visionChips.forEach(c => {
                const div = document.createElement('div');
                div.className = `influence-chip ${c.kind}`;
                div.textContent = (c.kind === 'bad' ? '⚠ ' : c.kind === 'good' ? '✓ ' : '') + c.text;
                siteInfluencesEl.appendChild(div);
            });
        } catch (e) {
            pending.textContent = 'AI vision unavailable right now — measured results above still stand.';
        }

        if (poolSeen && subjectPoolInput.value !== 'yes') {
            subjectPoolInput.value = 'yes';
            recalcAppraisal();
            const auto = document.createElement('div');
            auto.className = 'influence-chip good';
            auto.textContent = '✓ Pool field auto-set to Yes from the imagery';
            siteInfluencesEl.appendChild(auto);
        }

        // Public-records chips: flood, soil, hail, schools, traffic, crime,
        // neighborhood, permits
        const [floodChip, soilChip, hailChip, schoolChip, trafficChip, crimeChip, acsChip, permitChips] = await recordsPromise;
        [floodChip, soilChip, hailChip, schoolChip, trafficChip, crimeChip, acsChip]
            .concat(permitChips || [])
            .filter(Boolean)
            .forEach(c => {
                const div = influenceChipDiv(c);
                // Fannie B4-1.1-04 names "reference to crime rate or related
                // data" an Unacceptable Appraisal Practice, and this user is a
                // licensed agent. Fine as private underwriting input; it must
                // never ride along into anything handed to a third party, so
                // it is excluded from every print surface at the source.
                if (c === crimeChip || c === acsChip) div.classList.add('no-print');
                siteInfluencesEl.appendChild(div);
            });
    } catch (e) {
        siteInfluencesEl.textContent = 'Map scan failed — Overpass may be busy; try again in a minute.';
    } finally {
        scanSiteBtn.disabled = false;
    }
}

scanSiteBtn.addEventListener('click', scanSubjectSite);
gmapsKeyInput.addEventListener('input', () => {
    try { localStorage.setItem(GMAPS_KEY_STORAGE, gmapsKeyInput.value.trim()); } catch (e) { /* private mode */ }
    if (lastSelectedCoords) updateFrontView(lastSelectedCoords.lat, lastSelectedCoords.lon);
});

function readAppraisalInputs() {
    const qualitativeAdjPct = {};
    QUALITATIVE_FACTORS.forEach(f => {
        qualitativeAdjPct[f.key] = qualSettingInputs[f.key] ? qualSettingInputs[f.key].value : f.pct;
    });
    return {
        subject: {
            sqft: subjectSqftInput.value,
            beds: subjectBedsInput.value,
            baths: totalBaths(subjectBathsFullInput, subjectBathsHalfInput),
            lotSqft: subjectLotInput.value,
            garageSpaces: subjectGarageInput.value,
            yearBuilt: subjectYearInput.value,
            pool: subjectPoolInput.value,
            stories: subjectStoriesInput.value
        },
        comps: appraisalComps,
        settings: {
            pricePerSqftAdj: adjPriceSqftInput.value,
            bedAdj: adjBedInput.value,
            bathAdj: adjBathInput.value,
            lotAdjPerSqft: adjLotInput.value,
            garageAdjPerSpace: adjGarageInput.value,
            poolAdj: adjPoolInput.value,
            yearAdjPerYear: adjYearInput.value,
            storyAdj: adjStoryInput.value,
            conditionAdjPct: {
                renovated: 0,
                average: adjCondAvgInput.value,
                dated: adjCondDatedInput.value
            },
            annualAppreciationPct: adjAppreciationInput.value,
            qualitativeAdjPct
        }
    };
}

const CONFIDENCE_STYLES = {
    high: { label: 'HIGH', card: 'success' },
    medium: { label: 'MEDIUM', card: 'warning' },
    low: { label: 'LOW', card: 'danger' }
};

// One-line subject recap above the comps so the CMA is always read
// against the property it's for (street only — no city/state/zip)
function updateSubjectSummary() {
    const street = subjectAddressInput.value.split(',')[0].trim();
    const baths = totalBaths(subjectBathsFullInput, subjectBathsHalfInput);
    // Static tag via innerHTML, user-typed address via text node (no injection)
    subjectSummaryEl.innerHTML = '<span class="subject-summary-tag">SUBJECT PROP</span>';
    subjectSummaryEl.appendChild(document.createTextNode([
        street || 'no address set',
        `${Engine.num(subjectSqftInput.value).toLocaleString()} sqft`,
        `${Engine.num(subjectLotInput.value).toLocaleString()} sqft lot`,
        `built ${subjectYearInput.value || '—'}`,
        `${subjectStoriesInput.value} story`,
        `${subjectBedsInput.value} bd / ${baths} ba / ${subjectGarageInput.value} gar`
    ].join('  ·  ')));
    subjectSummaryEl.classList.remove('hidden');
}

// ==================== Comps Map (ARV page) ====================
// Numbered pins for every located comp around the subject — the "are these
// actually neighbors?" eyeball check below the comp cards. recalcAppraisal
// fires per keystroke, so the pin set rebuilds (and the view re-fits) only
// when a LOCATION appears, moves, or vanishes; label/price edits restyle the
// existing pins in place — pan/zoom AND an open popup survive typing.

const compsMapWrap = document.getElementById('comps-map-wrap');
const compsMapEl = document.getElementById('comps-map');
const compsMapNote = document.getElementById('comps-map-note');
let compsMap = null;
let compsMapMarkers = null; // layer group holding the pins
let compsMapCompPins = [];  // { marker, iconKey } parallel to the located list
let compsMapSig = '';       // what's drawn (labels/prices/status included)
let compsMapPosSig = '';    // just the coordinates — gates rebuild + re-fit
let compsMapFitPending = false;

function compPinIcon(text, extraClass) {
    return L.divIcon({
        className: 'comp-map-icon',
        html: `<div class="comp-map-pin ${extraClass || ''}">${text}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });
}

// Popup content built via textContent — comp labels come from external
// listing data and must never be interpreted as HTML
function compPinPopup(title, lines) {
    const div = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = title;
    div.appendChild(strong);
    lines.filter(Boolean).forEach(text => {
        const row = document.createElement('div');
        row.textContent = text;
        div.appendChild(row);
    });
    return div;
}

function updateCompsMap() {
    if (!compsMapEl || typeof L === 'undefined') return; // CDN unavailable
    const subj = lastSelectedCoords;
    const located = [];
    const unlocated = [];
    appraisalComps.forEach((comp, idx) => {
        const lat = parseFloat(comp.lat), lon = parseFloat(comp.lon);
        const priced = Engine.num(comp.salePrice) > 0;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            located.push({ idx, lat, lon, priced, label: comp.label, salePrice: Engine.num(comp.salePrice) });
        } else if (comp.label || priced) {
            unlocated.push(idx + 1); // on a card but not placeable
        }
    });
    const show = Boolean(subj) || located.length > 0;
    compsMapWrap.classList.toggle('hidden', !show);
    if (!show) { compsMapSig = ''; compsMapPosSig = ''; return; }

    const pinContent = (p) => {
        const dist = subj ? haversineMeters(subj.lat, subj.lon, p.lat, p.lon) : null;
        return compPinPopup(p.label || `Comp ${p.idx + 1}`, [
            p.priced ? formatCurrency(p.salePrice) : 'Unpriced — not in blend',
            dist != null ? `${(dist / 1609.34).toFixed(2)} mi from subject` : null
        ]);
    };
    const posSig = JSON.stringify([subj, located.map(p => [p.lat, p.lon])]);
    const sig = JSON.stringify([subj, located]);
    if (posSig !== compsMapPosSig || !compsMap) {
        // A location appeared, moved, or vanished — rebuild the pin set and re-fit
        compsMapPosSig = posSig;
        compsMapSig = sig;
        compsMapFitPending = true;
        if (!compsMap) {
            compsMap = L.map(compsMapEl);
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 19,
                attribution: 'Imagery © Esri'
            }).addTo(compsMap);
            compsMapMarkers = L.layerGroup().addTo(compsMap);
        }
        compsMapMarkers.clearLayers();
        compsMapCompPins = [];
        if (subj) {
            L.marker([subj.lat, subj.lon], { icon: compPinIcon('S', 'subject'), zIndexOffset: 1000 })
                .bindPopup(compPinPopup(subjectAddressInput.value.trim() || 'Subject property', ['Subject property']))
                .addTo(compsMapMarkers);
        }
        located.forEach(p => {
            const iconKey = `${p.idx + 1}|${p.priced}`;
            const marker = L.marker([p.lat, p.lon], { icon: compPinIcon(String(p.idx + 1), p.priced ? '' : 'excluded') })
                .bindPopup(pinContent(p))
                .addTo(compsMapMarkers);
            compsMapCompPins.push({ marker, iconKey });
        });
    } else if (sig !== compsMapSig) {
        // Same locations, different labels/prices/numbers — restyle the pins
        // in place so per-keystroke recalcs never churn marker DOM or close
        // an open popup (setPopupContent updates an open popup live)
        compsMapSig = sig;
        located.forEach((p, k) => {
            const pin = compsMapCompPins[k];
            if (!pin) return;
            const iconKey = `${p.idx + 1}|${p.priced}`;
            if (iconKey !== pin.iconKey) {
                pin.iconKey = iconKey;
                pin.marker.setIcon(compPinIcon(String(p.idx + 1), p.priced ? '' : 'excluded'));
            }
            pin.marker.setPopupContent(pinContent(p));
        });
    }
    compsMapNote.classList.toggle('hidden', !unlocated.length);
    compsMapNote.textContent = unlocated.length
        ? `Comp${unlocated.length > 1 ? 's' : ''} ${unlocated.join(', ')}: no map location — pick the address from the autocomplete to place ${unlocated.length > 1 ? 'them' : 'it'}.`
        : '';
    fitCompsMap();
}

// Fitting needs real pixel dimensions, so it defers while the ARV page is
// hidden (switchPage re-runs it on entry)
function fitCompsMap() {
    if (!compsMap || !compsMapFitPending || arvPage.classList.contains('hidden')) return;
    compsMapFitPending = false;
    compsMap.invalidateSize();
    const pts = [];
    compsMapMarkers.eachLayer(m => pts.push(m.getLatLng()));
    if (!pts.length) return;
    if (pts.length === 1) {
        compsMap.setView(pts[0], 15);
    } else {
        compsMap.fitBounds(L.latLngBounds(pts).pad(0.18), { maxZoom: 17 });
    }
}

function recalcAppraisal() {
    const a = Engine.appraise(readAppraisalInputs());
    lastAppraisal = a;
    updateWeightImpacts(a);
    updateSubjectSummary();
    refreshCompSubdivisions();
    updateCompsMap();

    arvEstimateValue.textContent = formatCurrency(a.arv);
    arvPpsfNote.textContent = a.subjectPricePerSqft > 0
        ? `$${a.subjectPricePerSqft.toFixed(0)}/sqft on subject` : 'Weighted comp value';
    // The range and the confidence now come from a stated uncertainty rather
    // than from the min/max of the adjusted comps. Measured error varies
    // six-fold across DFW submarkets (Pleasant Grove 31% MdAPE vs Fort Worth
    // southeast 5.6%) and the old label could not tell them apart.
    const band = Engine.valuationInterval(a, {
        pricePerSqftSpreadPct: compsMeta.ppsfSpreadPct || 0,
        unverifiedComps: appraisalComps.filter(c =>
            c.conditionUnverified && Engine.num(c.salePrice) > 0).length,
        trendUnusable: compsMeta.trend ? !compsMeta.trend.usable : false
    });

    arvRangeValue.textContent = band
        ? `${formatCurrency(band.low)} – ${formatCurrency(band.high)}`
        : `${formatCurrency(a.low)} – ${formatCurrency(a.high)}`;

    // The card states the WIDTH, not a confidence word. Measured on 84 closed
    // sales, the band width is about right (77% coverage against a 68%
    // target) but the high/medium/low tiering ranks backwards — deals it
    // called "low" came in at 7.4% MdAPE against 10.4% for "high". A label
    // that misranks is worse than no label, so until the ranking is earned
    // the card shows a fact instead of a claim.
    if (band) {
        arvConfidenceValue.textContent = `±${band.sigmaPct}%`;
        arvConfidenceCard.className = 'metric-card';
    } else {
        const conf = CONFIDENCE_STYLES[a.confidence];
        arvConfidenceValue.textContent = conf.label;
        arvConfidenceCard.className = `metric-card ${conf.card}`;
    }
    if (band && a.comps.length) {
        // Name what is driving the width. "Low confidence" on its own is a
        // shrug; "local $/sqft varies by 62%" is something you can act on.
        arvSpreadNote.textContent = `±${band.sigmaPct}% — ` + (band.drivers[0] || 'comps agree closely');
        arvSpreadNote.title = band.drivers.join('\n');
    } else {
        arvSpreadNote.textContent = a.comps.length
            ? `${a.spreadPct.toFixed(1)}% spread across ${a.comps.length} comp${a.comps.length !== 1 ? 's' : ''}`
            : 'Add at least one comp';
        arvSpreadNote.title = '';
    }

    compResultsBody.innerHTML = '';
    a.comps.forEach((c, i) => {
        const row = document.createElement('tr');
        const netPrefix = c.netAdjustment >= 0 ? '+' : '';
        row.innerHTML = `
            <td>${c.flagged ? '⚠ ' : ''}<button type="button" class="comp-adj-toggle" aria-expanded="false" title="Show the adjustment line items">▸</button> <span class="comp-name"></span></td>
            <td>${formatCurrency(c.salePrice)}</td>
            <td class="${c.netAdjustment >= 0 ? 'adj-pos' : 'adj-neg'}">${netPrefix}${formatCurrency(c.netAdjustment)}</td>
            <td><strong>${formatCurrency(c.adjustedValue)}</strong></td>
            <td class="${c.flagged ? 'adj-neg' : ''}">${c.grossAdjPct.toFixed(1)}%</td>
            <td>×${c.weight.toFixed(2)}</td>
        `;
        row.querySelector('.comp-name').textContent = c.label || `Comp ${i + 1}`;
        compResultsBody.appendChild(row);

        // The net figure alone can't answer "why is this comp down $40k?".
        // Every line is already computed on the comp object each keystroke —
        // this is pure render of data that was being thrown away.
        const detail = document.createElement('tr');
        detail.className = 'comp-adj-detail hidden';
        const cell = document.createElement('td');
        cell.colSpan = 6;
        const lines = Object.entries(c.adjustments || {})
            .filter(([, v]) => Math.round(v) !== 0)
            .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
        if (!lines.length) {
            cell.textContent = 'No adjustments — this comp matches the subject on every field with data on both sides.';
        } else {
            const list = document.createElement('div');
            list.className = 'comp-adj-lines';
            lines.forEach(([key, v]) => {
                const item = document.createElement('span');
                item.className = 'comp-adj-line ' + (v >= 0 ? 'adj-pos' : 'adj-neg');
                item.textContent = `${ADJ_LABELS[key] || key}: ${v >= 0 ? '+' : ''}${formatCurrency(v)}`;
                list.appendChild(item);
            });
            cell.appendChild(list);
            if (c.concessions > 0) {
                const note = document.createElement('div');
                note.className = 'comp-adj-foot';
                note.textContent = `Seller concessions of ${formatCurrency(c.concessions)} came off the price first `
                    + `(cash-equivalent ${formatCurrency(c.cashEquivalent)}), before any adjustment above.`;
                cell.appendChild(note);
            }
        }
        detail.appendChild(cell);
        compResultsBody.appendChild(detail);
        row.querySelector('.comp-adj-toggle').addEventListener('click', (e) => {
            const open = detail.classList.toggle('hidden');
            e.currentTarget.setAttribute('aria-expanded', String(!open));
            e.currentTarget.textContent = open ? '▸' : '▾';
        });
    });

    const flagged = a.comps.filter(c => c.flagged);
    appraisalWarnings.innerHTML = '';
    if (flagged.length) {
        const warn = document.createElement('div');
        warn.className = 'appraisal-warning';
        // Fannie ELIMINATED the 15%/25% net/gross adjustment guidelines in
        // Selling Guide B4-1.3-09 (2025-06-04): "Fannie Mae does not have
        // specific limitations or guidelines associated with net or gross
        // adjustments." The signal is still real — a comp needing a quarter of
        // its price in adjustments is being argued into place — but it must
        // not be presented as somebody's rule.
        warn.textContent = `⚠ ${flagged.map(c => c.label || 'Unnamed comp').join(', ')}: adjustments total more than 25% of the sale price — that comp is being argued into place rather than compared. Not a lender rule (Fannie dropped its 25% guideline in 2025), but a strong hint to find a closer sale.`;
        appraisalWarnings.appendChild(warn);
    }

    // Does the comp set SURROUND the subject? valuationInterval() measures how
    // much the comps disagree with each other and scoreComp() rates them one
    // at a time — neither can see a set that agrees closely and sits entirely
    // on one side of the subject, which is a narrow band around an
    // extrapolation. Read appraisalComps: appraise() does not echo sqft/beds.
    Engine.bracketingDefects(readAppraisalInputs().subject, appraisalComps).forEach(d => {
        const warn = document.createElement('div');
        warn.className = 'appraisal-warning';
        warn.textContent = '⚠ Not bracketed — ' + d.message;
        appraisalWarnings.appendChild(warn);
    });
    // NOTHING is rendered from compAdjustmentAsymmetry(). A "every comp in this
    // blend was adjusted upward" warning was built and then withdrawn: it
    // separated by +4.3 points of median signed error on one 156-sale sample
    // and by +0.3 on an independent 132-sale one, which is sampling noise
    // rather than a signal, and it fired on a third of all deals. The
    // statistic lives in engine.js for backtest.mjs to pool across hundreds of
    // sales, which is the only scale at which it resolves anything. Do not
    // wire it to the UI again without a paired measurement behind it.
    a.comps.filter(c => c.overlaps.length).forEach((c, i) => {
        const warn = document.createElement('div');
        warn.className = 'appraisal-warning';
        warn.textContent = `⚠ Possible double-count on ${c.label || 'unnamed comp'}: ${c.overlaps.join('; ')} — the same defect may be adjusted twice, consider easing one side.`;
        appraisalWarnings.appendChild(warn);
    });

    // Auto-added comps whose listing remarks gave no condition signal are
    // blended at the card default (Renovated) — never let that pass silently
    const assumed = appraisalComps.filter(c => c.conditionUnverified && Engine.num(c.salePrice) > 0);
    if (assumed.length) {
        const warn = document.createElement('div');
        warn.className = 'appraisal-warning';
        warn.textContent = `⚠ Condition unverified on: ${assumed.map(c => c.label || 'unnamed comp').join(', ')} — no renovation signal in listing remarks, so Renovated is assumed. Verify in MLS or set the Condition dropdown (that clears this warning).`;
        appraisalWarnings.appendChild(warn);
    }

    useArvBtn.disabled = a.arv <= 0;
    useArvBtn.textContent = a.arv > 0
        ? `Use ${formatCurrency(a.arv)} as ARV in the Deal Calculator →`
        : 'Add comps to estimate ARV';

    renderMarketScan(); // competition band tracks the freshly blended ARV
    updateProtestNote(); // assessed-vs-evidence case tracks the blend too
    saveAppraisalState();
}

// Push the appraised ARV into the calculator and move to step 2
function useAppraisedArv() {
    if (!lastAppraisal || lastAppraisal.arv <= 0) return;
    arvInput.value = lastAppraisal.arv;
    const address = subjectAddressInput.value.trim();
    calcAddressNote.textContent = `${address ? address + ' — ' : ''}appraised ARV ${formatCurrency(lastAppraisal.arv)} applied (${lastAppraisal.confidence} confidence)`;
    calcAddressNote.classList.remove('hidden');
    switchPage('calculator');
    calculateDeal();
}

// ==================== Market Absorption Meter ====================

const TEMPERATURE_STYLES = {
    hot: { label: 'HOT MARKET', color: '#ef4444' },
    warm: { label: 'WARM · SELLER LEAN', color: '#f59e0b' },
    balanced: { label: 'BALANCED', color: '#10b981' },
    cool: { label: 'COOL · BUYER LEAN', color: '#06b6d4' },
    cold: { label: 'COLD MARKET', color: '#3b82f6' },
    unknown: { label: 'ENTER MLS COUNTS', color: '#6b7280' }
};

function updateAbsorption() {
    const m = Engine.marketAbsorption({
        activeListings: mktActivesInput.value,
        pendingListings: mktPendingsInput.value,
        soldLast90Days: mktSold90Input.value
    });
    const style = TEMPERATURE_STYLES[m.temperature];
    absorptionBadge.textContent = style.label;
    absorptionBadge.style.background = style.color + '22';
    absorptionBadge.style.borderColor = style.color + '55';
    absorptionBadge.style.color = style.color;
    absorptionScoreNote.textContent = m.temperature === 'unknown' ? '' : `heat ${m.score.toFixed(0)}/100`;
    absorptionNeedle.style.left = `${m.score}%`;
    statMoi.textContent = Number.isFinite(m.monthsOfInventory) ? `${m.monthsOfInventory.toFixed(1)} mo` : 'No sales';
    statAbsorption.textContent = Number.isFinite(m.absorptionRatePct) ? `${m.absorptionRatePct.toFixed(0)}%/mo` : '—';
    statPendingRatio.textContent = Number.isFinite(m.pendingRatio) ? m.pendingRatio.toFixed(2) : '—';
    saveAppraisalState();
}

// ==================== Property Data Auto-Fill (RentCast) ====================

function setLookupStatus(message, kind) {
    lookupStatus.textContent = message;
    lookupStatus.className = `lookup-status ${kind}`;
}

// ==================== Property Data Providers ====================
// Lookup ladder: local cache → RentCast (address variants, then coordinate
// radius — 404s are NOT billed, so retries are free) → Melissa. Records are
// normalized to one shape and cached so a property is never fetched twice.

// Bump the version whenever records gain fields — older cached entries
// would otherwise silently auto-fill without the new fields forever
// (v2: subdivision/hoa; v3: facts/construction/financial/owner details)
// v5 is a POISON eviction, not a shape change: the worker's MLS rung briefly
// answered EVERY address with the same listing, and those records cached under
// each address that was tried. A wrong record keyed to a right address is the
// one thing this cache cannot heal on its own — non-MLS entries never expire.
const PROPERTY_CACHE_KEY = 'underwriter-property-cache-v5';

// MLS licences cap how long a licensee may hold the compilation locally and
// require refreshing against the source. Public-record and portal data carry
// no such clock, so only MLS-sourced records expire — twelve hours is the
// conventional refresh interval and is well inside any DLA's window.
const MLS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let lastSelectedCoords = null; // lat/lon from the picked autocomplete suggestion
let lastSelectedMprId = null;  // realtor.com property id from the picked suggestion

// Built-in data proxy (worker/ in the repo) — auto-fill works out of the box
// with zero setup. The settings field overrides it for self-hosters.
const DEFAULT_WORKER_URL = 'https://underwriter-proxy.jamesthorneiii.workers.dev';

function workerBase() {
    const raw = workerUrlInput.value.trim().replace(/\/+$/, '');
    return /^https?:\/\/.+/i.test(raw) ? raw : DEFAULT_WORKER_URL;
}

// null = no record / provider not configured (both fall through the ladder)
async function workerFetchRecord(path) {
    const res = await fetch(workerBase() + path, { headers: { 'Accept': 'application/json' } });
    if (res.status === 404 || res.status === 501) return null;
    if (!res.ok) throw new Error(`Worker request failed (HTTP ${res.status}).`);
    const rec = await res.json();
    return recordHasData(rec) ? rec : null;
}

function cacheKeyFor(address) {
    return address.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A record carries MLS-licensed content when the feed answered for it. That
// is the only case with a retention clock, so it is the only case that expires.
function recordIsMlsSourced(rec) {
    if (!rec || !rec.extra) return false;
    // extra.mlsNumber resolves through MLS_FIELD_MAP (bound to ListingId
    // today). extra.mls.matchedBy is stamped by the worker whenever the feed
    // produced a row at all, independent of any field mapping. Now that every
    // subject lookup can ride on this, one unmapped field would otherwise park
    // licensed close prices in localStorage permanently. Deliberately NOT keyed
    // on rec.source - MLS_SYSTEM_NAME is configurable.
    return Boolean(rec.extra.mlsNumber)
        || Boolean(rec.extra.mls && rec.extra.mls.matchedBy);
}

// Eviction was read-triggered only, so an address never looked up again kept
// its licensed close price forever - the 12 h retention window was aspirational
// rather than real. Now that the feed leads most subject records, far more
// entries carry the clock, so sweep the whole cache once at load.
function sweepExpiredMlsRecords() {
    try {
        const cache = JSON.parse(localStorage.getItem(PROPERTY_CACHE_KEY) || '{}');
        let dropped = 0;
        for (const key of Object.keys(cache)) {
            const entry = cache[key];
            if (recordIsMlsSourced(entry) && Date.now() - ((entry && entry._cachedAt) || 0) > MLS_CACHE_TTL_MS) {
                delete cache[key];
                dropped++;
            }
        }
        if (dropped) localStorage.setItem(PROPERTY_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* best-effort: a corrupt cache must not block startup */ }
}
sweepExpiredMlsRecords();

function getCachedRecord(address) {
    try {
        const cache = JSON.parse(localStorage.getItem(PROPERTY_CACHE_KEY) || '{}');
        const entry = cache[cacheKeyFor(address)];
        if (!entry) return null;
        if (recordIsMlsSourced(entry) && Date.now() - (entry._cachedAt || 0) > MLS_CACHE_TTL_MS) {
            delete cache[cacheKeyFor(address)];
            localStorage.setItem(PROPERTY_CACHE_KEY, JSON.stringify(cache));
            return null; // stale licensed data: re-pull rather than re-serve
        }
        return entry;
    } catch (e) { return null; }
}

function putCachedRecord(address, record) {
    try {
        const cache = JSON.parse(localStorage.getItem(PROPERTY_CACHE_KEY) || '{}');
        const keys = Object.keys(cache);
        if (keys.length >= 60) delete cache[keys[0]]; // keep the cache bounded
        cache[cacheKeyFor(address)] = { ...record, _cachedAt: Date.now() };
        localStorage.setItem(PROPERTY_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* storage full — cache is best-effort */ }
}

// Latest-year entry from RentCast's { "2024": {...}, "2025": {...} } maps
function latestByYear(byYear) {
    const years = Object.keys(byYear || {}).map(Number).filter(Number.isFinite);
    return years.length ? byYear[String(Math.max(...years))] : null;
}

// Normalized record shape — every key is null when the provider doesn't know:
// { sqft, beds, baths, lot, year, garage, pool, stories, subdivision, hoa,
//   propType, county, zoning, apn, legal, garageType, foundation, roof,
//   exterior, heating, cooling, assessedValue, assessedLand, assessedImprov,
//   annualTaxes, lastSaleDate, lastSalePrice, listPrice, listingStatus,
//   hoaFee, ownerNames, ownerType, ownerOccupied, ownerMailing,
//   formattedAddress, source }
function rentcastToRecord(p) {
    const f = p.features || {};
    const garage = (f.garageSpaces != null) ? f.garageSpaces : (f.garage === true ? 1 : (f.garage === false ? 0 : null));
    const assessment = latestByYear(p.taxAssessments);
    const taxes = latestByYear(p.propertyTaxes);
    const owner = p.owner || {};
    return {
        sqft: p.squareFootage != null ? p.squareFootage : null,
        beds: p.bedrooms != null ? p.bedrooms : null,
        baths: p.bathrooms != null ? p.bathrooms : null,
        lot: p.lotSize != null ? p.lotSize : null,
        year: p.yearBuilt != null ? p.yearBuilt : null,
        garage,
        pool: (f.pool === true || f.pool === false) ? f.pool : null,
        stories: f.floorCount != null ? f.floorCount : null,
        subdivision: p.subdivision || null,
        // Absence of HOA data is unknown, not "no HOA"
        hoa: (p.hoa && p.hoa.fee > 0) ? true : null,
        propType: p.propertyType || null,
        county: p.county || null,
        zoning: p.zoning || null,
        apn: p.assessorID || null,
        legal: p.legalDescription || null,
        garageType: f.garageType || null,
        foundation: f.foundationType || null,
        roof: f.roofType || null,
        exterior: f.exteriorType || null,
        heating: f.heatingType || (f.heating === true ? 'Yes' : null),
        cooling: f.coolingType || (f.cooling === true ? 'Yes' : null),
        assessedValue: assessment ? assessment.value : null,
        assessedLand: assessment ? assessment.land : null,
        assessedImprov: assessment ? assessment.improvements : null,
        annualTaxes: taxes ? taxes.total : null,
        lastSaleDate: p.lastSaleDate || null,
        lastSalePrice: p.lastSalePrice != null ? p.lastSalePrice : null,
        listPrice: null,
        listingStatus: null,
        hoaFee: (p.hoa && p.hoa.fee > 0) ? p.hoa.fee : null,
        ownerNames: Array.isArray(owner.names) && owner.names.length ? owner.names.join(', ') : null,
        ownerType: owner.type || null,
        ownerOccupied: (p.ownerOccupied === true || p.ownerOccupied === false) ? p.ownerOccupied : null,
        ownerMailing: owner.mailingAddress && owner.mailingAddress.formattedAddress ? owner.mailingAddress.formattedAddress : null,
        lat: p.latitude != null ? p.latitude : null,
        lon: p.longitude != null ? p.longitude : null,
        formattedAddress: p.formattedAddress || null,
        source: 'RentCast'
    };
}

function melissaToRecord(r) {
    const numOrNull = (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) && n > 0 ? n : null;
    };
    const room = r.IntRoomInfo || {};
    const size = r.PropertySize || {};
    const use = r.PropertyUseInfo || {};
    const parking = r.Parking || {};
    const amenities = r.ExtAmenities || {};
    // Melissa pool signals vary by county record; treat any non-empty,
    // non-zero pool code as "has pool", absence as unknown (not "no")
    const poolRaw = amenities.PoolCode || amenities.Pool || '';
    const pool = poolRaw && poolRaw !== '0' ? true : null;
    const legal = r.Legal || {};
    const parcel = r.Parcel || {};
    const sale = r.SaleInfo || {};
    const tax = r.Tax || {};
    const primOwner = r.PrimaryOwner || {};
    const ownerAddr = r.OwnerAddress || {};
    const ext = r.ExtStructInfo || {};
    const mailing = [ownerAddr.Address, ownerAddr.City, ownerAddr.State, ownerAddr.Zip]
        .filter(Boolean).join(', ') || null;
    return {
        sqft: numOrNull(size.AreaBuilding),
        beds: numOrNull(room.BedroomsCount),
        baths: numOrNull(room.BathCount),
        lot: numOrNull(size.AreaLotSF),
        year: numOrNull(use.YearBuilt),
        garage: numOrNull(parking.ParkingSpaceCount),
        pool,
        stories: numOrNull((r.IntStructInfo || {}).StoriesCount),
        subdivision: legal.Subdivision || null,
        hoa: null,
        propType: use.PropertyUseGroup || null,
        county: parcel.County || null,
        zoning: use.ZoningCode || null,
        apn: parcel.FormattedAPN || parcel.UnformattedAPN || null,
        legal: legal.LegalDescription || null,
        garageType: parking.GarageType || null,
        foundation: (r.IntStructInfo || {}).Foundation || null,
        roof: ext.RoofMaterial || ext.RoofCover || null,
        exterior: ext.Exterior1Code || null,
        heating: (r.UtilitiesInfo || {}).HVACHeatingDetail || null,
        cooling: (r.UtilitiesInfo || {}).HVACCoolingDetail || null,
        assessedValue: numOrNull(tax.AssessedValueTotal),
        assessedLand: numOrNull(tax.AssessedValueLand),
        assessedImprov: numOrNull(tax.AssessedValueImprovements),
        annualTaxes: numOrNull(tax.TaxBilledAmount),
        lastSaleDate: sale.DeedLastSaleDate || null,
        lastSalePrice: numOrNull(sale.DeedLastSalePrice),
        listPrice: null,
        listingStatus: null,
        hoaFee: null,
        ownerNames: primOwner.Name1Full || null,
        ownerType: primOwner.Type || null,
        ownerOccupied: null,
        ownerMailing: mailing,
        formattedAddress: null,
        source: 'Melissa'
    };
}

function recordHasData(rec) {
    return rec && (rec.sqft != null || rec.beds != null);
}

// RentCast: null = no record (retryable), throw = hard error
async function rentcastFetch(params, key) {
    const res = await fetch(`https://api.rentcast.io/v1/properties?${params}`, {
        headers: { 'X-Api-Key': key, 'Accept': 'application/json' }
    });
    if (res.status === 401 || res.status === 403) throw new Error('RentCast key rejected — double-check it.');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RentCast lookup failed (HTTP ${res.status}).`);
    const data = await res.json();
    const rec = Array.isArray(data) ? data[0] : data;
    return (rec && (rec.squareFootage != null || rec.bedrooms != null)) ? rentcastToRecord(rec) : null;
}

async function rentcastLookup(address, key, opts = {}) {
    // 1. Address variants: canonical suggestion text, then the raw typed text
    const variants = [address];
    if (opts.altAddress && opts.altAddress.toLowerCase() !== address.toLowerCase() && /\d/.test(opts.altAddress)) {
        variants.push(opts.altAddress);
    }
    for (const variant of variants) {
        const rec = await rentcastFetch(`address=${encodeURIComponent(variant)}`, key);
        if (rec) return rec;
    }
    // 2. Coordinate radius — sidesteps address-string matching entirely
    if (opts.coords) {
        const { lat, lon } = opts.coords;
        const rec = await rentcastFetch(`latitude=${lat}&longitude=${lon}&radius=0.05&limit=1`, key);
        if (rec) return rec;
    }
    return null;
}

async function melissaLookup(address, key) {
    const res = await fetch(
        `https://property.melissadata.net/v4/WEB/LookupProperty?id=${encodeURIComponent(key)}&ff=${encodeURIComponent(address)}&format=json&cols=GrpAll`,
        { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error(`Melissa lookup failed (HTTP ${res.status}).`);
    const data = await res.json();
    if (data.TransmissionResults && /GE0[1-9]/.test(data.TransmissionResults)) {
        throw new Error('Melissa key rejected — double-check it.');
    }
    const rec = (data.Records || [])[0];
    if (!rec) return null;
    const normalized = melissaToRecord(rec);
    return recordHasData(normalized) ? normalized : null;
}

// Apply a normalized record: only overwrite fields the record actually has;
// everything remains editable afterward
function applyPropertyRecord(rec, fallbackAddress) {
    const filled = [];
    const fill = (input, value, label) => {
        if (value === undefined || value === null || value === '') return;
        input.value = value;
        filled.push(`${label} ${value}`);
    };
    fill(subjectSubdivisionInput, rec.subdivision, 'subdivision');
    if (rec.hoa === true) {
        subjectHoaInput.value = 'yes';
        filled.push('hoa yes');
    }
    fill(subjectSqftInput, rec.sqft, 'sqft');
    fill(subjectBedsInput, rec.beds, 'beds');
    if (rec.baths != null) {
        const { full, half } = splitBaths(rec.baths);
        subjectBathsFullInput.value = full;
        subjectBathsHalfInput.value = half;
        filled.push(`baths ${rec.baths}`);
    }
    fill(subjectLotInput, rec.lot, 'lot');
    fill(subjectYearInput, rec.year, 'built');
    if (rec.garage != null) fill(subjectGarageInput, rec.garage, 'garage');
    if (rec.pool === true || rec.pool === false) {
        subjectPoolInput.value = rec.pool ? 'yes' : 'no';
        filled.push(`pool ${rec.pool ? 'yes' : 'no'}`);
    }
    if (rec.stories != null) {
        const storyVal = rec.stories >= 3 ? '3' : String(rec.stories);
        if ([...subjectStoriesInput.options].some(o => o.value === storyVal)) {
            subjectStoriesInput.value = storyVal;
            filled.push(`stories ${storyVal}`);
        }
    }

    // Detail fields fill silently (the status line stays readable) and are
    // counted; each one remains editable like everything else
    let extraCount = 0;
    const fillQuiet = (input, value) => {
        if (value === undefined || value === null || value === '') return;
        input.value = value;
        extraCount++;
    };
    fillQuiet(subjectPropTypeInput, rec.propType);
    fillQuiet(subjectCountyInput, rec.county);
    fillQuiet(subjectZoningInput, rec.zoning);
    fillQuiet(subjectApnInput, rec.apn);
    fillQuiet(subjectLegalInput, rec.legal);
    fillQuiet(subjectGarageTypeInput, rec.garageType);
    fillQuiet(subjectFoundationInput, rec.foundation);
    fillQuiet(subjectRoofInput, rec.roof);
    fillQuiet(subjectExteriorInput, rec.exterior);
    fillQuiet(subjectHeatingInput, rec.heating);
    fillQuiet(subjectCoolingInput, rec.cooling);
    fillQuiet(subjectAssessedValueInput, rec.assessedValue);
    fillQuiet(subjectAssessedLandInput, rec.assessedLand);
    fillQuiet(subjectAssessedImprovInput, rec.assessedImprov);
    fillQuiet(subjectAnnualTaxesInput, rec.annualTaxes);
    // Date inputs need yyyy-mm-dd, providers send ISO timestamps
    fillQuiet(subjectLastSaleDateInput, rec.lastSaleDate ? String(rec.lastSaleDate).slice(0, 10) : null);
    fillQuiet(subjectLastSalePriceInput, rec.lastSalePrice);
    fillQuiet(subjectListPriceInput, rec.listPrice);
    fillQuiet(subjectListingStatusInput, rec.listingStatus);
    fillQuiet(subjectHoaFeeInput, rec.hoaFee);
    fillQuiet(subjectOwnerNamesInput, rec.ownerNames);
    fillQuiet(subjectOwnerTypeInput, rec.ownerType);
    if (rec.ownerOccupied === true || rec.ownerOccupied === false) {
        subjectOwnerOccupiedInput.value = rec.ownerOccupied ? 'yes' : 'no';
        extraCount++;
    }
    fillQuiet(subjectOwnerMailingInput, rec.ownerMailing);
    if (extraCount) filled.push(`+${extraCount} detail fields`);

    // Seed the calculator's monthly Taxes/Ins/HOA from real tax + HOA data
    // (the reassessment note on the calculator page then flags how far the
    // seller's bill sits from what the buyer will actually pay)
    if (rec.annualTaxes > 0) {
        const monthly = Math.round(rec.annualTaxes / 12 + (rec.hoaFee || 0));
        monthlyTaxesInsInput.value = monthly;
        filled.push(`est. taxes+HOA $${monthly}/mo`);
    }
    updateTaxProjection();
    updateRehabEstimator();

    // Absentee signal: tax bill mails somewhere other than the property
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const propAddr = norm(rec.formattedAddress || fallbackAddress);
    if (rec.ownerOccupied === false ||
        (rec.ownerMailing && propAddr && norm(rec.ownerMailing) !== propAddr)) {
        filled.push('ABSENTEE OWNER');
    }

    if (rec.formattedAddress) subjectAddressInput.value = rec.formattedAddress;
    // A record with coordinates unlocks the site map/scan even when the
    // address came from cache rather than a picked suggestion
    if (!lastSelectedCoords && rec.lat != null && rec.lon != null) {
        lastSelectedCoords = { lat: rec.lat, lon: rec.lon };
    }
    setLookupStatus(
        filled.length
            ? `✓ ${rec.formattedAddress || fallbackAddress} (${rec.source}): ${filled.join(' · ')}. Review and override anything below.`
            : 'Record found, but it had no usable fields — enter details manually.',
        'success'
    );
    appendMlsAttribution(subjectAttributionBox,
        recordIsMlsSourced(rec) ? ((rec.extra && rec.extra.mls && rec.extra.mls.attribution) || null) : null);
    recalcAppraisal();
}

// Shared provider ladder: cache → browser-pasted keys (deliberate user
// overrides, so a power user controls their own quota) → Worker unified
// /lookup (RentCast → Melissa server-side secrets → realtor.com keyless).
// Returns { rec, problems }; successful records are cached.
async function fetchPropertyRecord(address, opts = {}) {
    const problems = [];
    const cached = getCachedRecord(address);
    if (cached) return { rec: cached, problems };

    const rcKey = rentcastKeyInput.value.trim();
    const mdKey = melissaKeyInput.value.trim();
    const worker = workerBase();
    let rec = null;
    if (rcKey) {
        try {
            rec = await rentcastLookup(address, rcKey, opts);
        } catch (err) {
            problems.push(err instanceof TypeError ? 'RentCast: network error' : err.message);
        }
    }
    if (!rec && mdKey) {
        try {
            rec = await melissaLookup(address, mdKey);
        } catch (err) {
            problems.push(err instanceof TypeError ? 'Melissa: network error' : err.message);
        }
    }
    if (!rec && worker) {
        try {
            const q = new URLSearchParams({ address });
            if (opts.mprId) q.set('mpr_id', opts.mprId);
            if (opts.coords) {
                q.set('latitude', String(opts.coords.lat));
                q.set('longitude', String(opts.coords.lon));
            }
            rec = await workerFetchRecord(`/lookup?${q}`);
        } catch (err) {
            problems.push(err instanceof TypeError ? 'Worker: network error' : 'Worker: ' + err.message);
        }
    }
    if (rec) {
        // providerErrors are live diagnostics about THIS call. The worker now
        // returns them on 200 responses too, and putCachedRecord() spreads the
        // whole object - so without this a transient MLS auth failure replays
        // out of localStorage as a stale complaint for the next 12 hours.
        if (Array.isArray(rec.providerErrors)) {
            for (const msg of rec.providerErrors) problems.push(msg);
            delete rec.providerErrors;
        }
        putCachedRecord(address, rec);
    }
    return { rec, problems };
}

async function lookupSubjectProperty() {
    const address = subjectAddressInput.value.trim();
    if (!address) {
        setLookupStatus('Enter the property address first.', 'error');
        return;
    }
    if (!rentcastKeyInput.value.trim() && !melissaKeyInput.value.trim() && !workerBase()) {
        setLookupStatus('Deploy the bundled Cloudflare Worker (keyless) or paste a free RentCast/Melissa API key below to enable auto-fill.', 'error');
        rentcastKeyInput.closest('details').open = true;
        return;
    }

    lookupBtn.disabled = true;
    setLookupStatus('Looking up property records…', 'info');
    try {
        const { rec, problems } = await fetchPropertyRecord(address, {
            mprId: lastSelectedMprId,
            coords: lastSelectedCoords,
            altAddress: rawTypedAddress
        });
        if (rec) {
            applyPropertyRecord(rec, address);
        } else {
            setLookupStatus(
                problems.length
                    ? `✗ ${problems.join(' · ')}`
                    : '✗ No property record found for that address — enter details manually.',
                'error'
            );
        }
    } finally {
        lookupBtn.disabled = false;
    }
}

// Apply a record to a comp object: only fields the record actually has,
// and the sale data feeds the CMA directly when present (TX is
// non-disclosure — sold prices usually only exist for MLS-listed sales)
function applyRecordToComp(comp, rec) {
    const set = (field, value) => {
        if (value !== undefined && value !== null && value !== '') comp[field] = value;
    };
    set('sqft', rec.sqft); set('beds', rec.beds); set('baths', rec.baths);
    set('lotSqft', rec.lot); set('yearBuilt', rec.year); set('garageSpaces', rec.garage);
    if (rec.pool === true || rec.pool === false) comp.pool = rec.pool ? 'yes' : 'no';
    if (rec.stories != null) {
        const v = rec.stories >= 3 ? '3' : String(rec.stories);
        if (['1', '1.5', '2', '3'].includes(v)) comp.stories = v;
    }
    set('subdivision', rec.subdivision); set('propType', rec.propType);
    set('county', rec.county); set('zoning', rec.zoning); set('apn', rec.apn);
    set('garageType', rec.garageType); set('foundation', rec.foundation);
    set('roof', rec.roof); set('exterior', rec.exterior);
    set('heating', rec.heating); set('cooling', rec.cooling);
    set('assessedValue', rec.assessedValue); set('annualTaxes', rec.annualTaxes);
    if (rec.lastSaleDate) comp.lastSaleDate = String(rec.lastSaleDate).slice(0, 10);
    set('lastSalePrice', rec.lastSalePrice); set('hoaFee', rec.hoaFee);
    set('ownerNames', rec.ownerNames); set('ownerType', rec.ownerType);
    if (rec.ownerOccupied === true || rec.ownerOccupied === false) {
        comp.ownerOccupied = rec.ownerOccupied ? 'yes' : 'no';
    }
    set('ownerMailing', rec.ownerMailing);
    if (rec.lat != null && rec.lon != null) { comp.lat = rec.lat; comp.lon = rec.lon; }
    if (rec.lastSalePrice > 0) comp.salePrice = rec.lastSalePrice;
    // Provenance has to travel with the number here too. A close price that
    // arrived through the RECORD ladder is exactly as licensed as one that
    // arrived through /comps, which stamps these fields itself.
    // mlsSourcedCompLabels() keys on priceType + priceSource and the protest
    // packet withholds on that - without this an NTREIS sale price prints in
    // the table handed to an ARB panel, which NTREIS Rule 15.03(b) forbids
    // and Rule 8.08 Note 2 makes confidential. Latent until the feed started
    // leading the subject record; now it is the common case.
    if (rec.lastSalePrice > 0 && recordIsMlsSourced(rec)) {
        comp.priceType = 'closed';
        comp.priceSource = rec.source;
        if (rec.extra && rec.extra.mlsNumber) comp.mlsNumber = rec.extra.mlsNumber;
    }
    if (rec.lastSaleDate) {
        const months = Math.round((Date.now() - new Date(rec.lastSaleDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44));
        // Only within the comp window — an ancient record sale must not
        // masquerade as a 24-month-old comp
        if (months >= 0 && months <= 24) comp.monthsAgo = months;
    }
    if (rec.formattedAddress) comp.label = rec.formattedAddress.split(',')[0];
}

async function lookupCompProperty(comp, address, mprId, coords) {
    const { rec } = await fetchPropertyRecord(address, { mprId, coords });
    if (rec) applyRecordToComp(comp, rec);
    renderComps();       // reflect whatever filled (or just the label)
    recalcAppraisal();
}

// ==================== Address Autocomplete ====================
// Three free, keyless sources queried in parallel, best-first:
// - realtor.com geo-suggest (CORS-open): canonical listing addresses with
//   proper street suffixes — the best input for record lookups
// - US Census Bureau geocoder (JSONP — no CORS support): authoritative
//   house-number matches from TIGER data
// - Photon / OpenStreetMap (fetch): fuzzy partial matching as fallback
// Selecting a suggestion auto-runs the RentCast record lookup when a key
// is on file, and every populated field stays editable.

const addressSuggestionsBox = document.getElementById('address-suggestions');
let jsonpCounter = 0;      // unique JSONP callback names across all instances
let rawTypedAddress = '';  // what the user had typed before a suggestion replaced it

function titleCase(s) {
    return s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

// Attach autocomplete to any input + suggestion-box pair. Each instance owns
// its own debounce, generation counter and abort controller, so the subject
// field and every comp card can autocomplete independently.
function attachAddressAutocomplete(input, box, onSelect) {
    let debounce = null;
    let generation = 0; // ignore out-of-order responses while typing
    let list = [];
    let active = -1;
    let abortCtrl = null;

    const hide = () => {
        box.classList.add('hidden');
        box.innerHTML = '';
        list = [];
        active = -1;
    };
    const highlight = (idx) => {
        active = idx;
        [...box.children].forEach((el, i) => el.classList.toggle('active', i === idx));
    };
    const render = (items) => {
        list = items;
        active = -1;
        box.innerHTML = '';
        if (!items.length) { hide(); return; }
        items.forEach((s, i) => {
            const item = document.createElement('div');
            item.className = 'address-suggestion';
            item.setAttribute('role', 'option');
            const primary = document.createElement('div');
            primary.textContent = s.line1;
            item.appendChild(primary);
            if (s.line2) {
                const secondary = document.createElement('div');
                secondary.className = 'suggestion-secondary';
                secondary.textContent = s.line2;
                item.appendChild(secondary);
            }
            // mousedown (not click) so the input doesn't blur first and eat the event
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                hide();
                onSelect(s);
            });
            item.addEventListener('mouseenter', () => highlight(i));
            box.appendChild(item);
        });
        box.classList.remove('hidden');
    };

    input.addEventListener('input', () => {
        const q = input.value.trim();
        clearTimeout(debounce);
        if (q.length < 4) { hide(); return; }
        debounce = setTimeout(async () => {
            const gen = ++generation;
            if (abortCtrl) abortCtrl.abort();
            abortCtrl = new AbortController();
            const items = await queryAddressProviders(q, abortCtrl.signal);
            if (gen === generation) render(items);
        }, 300);
    });
    input.addEventListener('keydown', (e) => {
        if (box.classList.contains('hidden')) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlight(Math.min(active + 1, list.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlight(Math.max(active - 1, 0));
        } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            const s = list[active];
            hide();
            onSelect(s);
        } else if (e.key === 'Escape') {
            hide();
        }
    });
    input.addEventListener('blur', () => {
        // Delay so a mousedown on a suggestion can land first
        setTimeout(hide, 150);
    });
}

// realtor.com's public geo-suggest — canonical addresses with street suffixes
async function realtorSuggestions(query) {
    try {
        const res = await fetch(
            `https://parser-external.geo.moveaws.com/suggest?input=${encodeURIComponent(query)}&client_id=rdc-home&limit=6&area_types=address`,
            { headers: { 'Accept': 'application/json' } }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.autocomplete || [])
            .filter(a => a.line && a.city && a.state_code)
            .map(a => {
                const line2 = `${a.city}, ${a.state_code}${a.postal_code ? ' ' + a.postal_code : ''}`;
                return {
                    text: `${a.line}, ${a.city}, ${a.state_code}${a.postal_code ? ' ' + a.postal_code : ''}`,
                    line1: a.line,
                    line2,
                    lat: a.centroid ? a.centroid.lat : null,
                    lon: a.centroid ? a.centroid.lon : null,
                    mprId: a.mpr_id || null // realtor property id — unlocks the keyless worker lookup
                };
            });
    } catch (e) {
        return []; // offline or endpoint changed — other sources still answer
    }
}

// Census geocoder only speaks JSONP — inject a script tag with a callback
function censusSuggestions(query) {
    return new Promise((resolve) => {
        const cb = '__censusCb' + (++jsonpCounter);
        const timer = setTimeout(() => { cleanup(); resolve([]); }, 5000);
        const script = document.createElement('script');
        const cleanup = () => { clearTimeout(timer); delete window[cb]; script.remove(); };
        window[cb] = (data) => {
            const matches = (data.result && data.result.addressMatches) || [];
            cleanup();
            resolve(matches.map(m => {
                // "5500 GRAND LAKE, SAN ANTONIO, TX, 78244" → street / city, ST zip
                const parts = m.matchedAddress.split(', ');
                const street = titleCase(parts[0] || '');
                const city = titleCase(parts[1] || '');
                const state = parts[2] || '';
                const zip = parts[3] || '';
                return {
                    text: [street, city, state, zip].filter(Boolean).join(', '),
                    line1: street,
                    line2: [city, state].filter(Boolean).join(', ') + (zip ? ' ' + zip : ''),
                    lat: m.coordinates ? m.coordinates.y : null,
                    lon: m.coordinates ? m.coordinates.x : null
                };
            }));
        };
        script.src = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
            + `?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=jsonp&callback=${cb}`;
        script.onerror = () => { cleanup(); resolve([]); };
        document.head.appendChild(script);
    });
}

async function photonSuggestions(query, signal) {
    try {
        // lat/lon bias toward the continental US improves ranking
        const res = await fetch(
            `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=en&lat=39.8&lon=-98.5`,
            { signal }
        );
        if (!res.ok) return [];
        const data = await res.json();
        const feats = (data.features || [])
            .filter(f => (f.properties || {}).countrycode === 'US');
        // Address-level results (with a house number) rank first
        feats.sort((a, b) => ((b.properties.housenumber ? 1 : 0) - (a.properties.housenumber ? 1 : 0)));
        return feats.map(f => {
            const p = f.properties;
            const coords = (f.geometry && f.geometry.coordinates) || [];
            const line1 = (p.housenumber ? `${p.housenumber} ${p.street || p.name || ''}` : (p.name || p.street || '')).trim();
            const line2 = [p.city || p.county, p.state, p.postcode].filter(Boolean).join(', ');
            return {
                text: [line1, line2].filter(Boolean).join(', '),
                line1: line1 || line2,
                line2: line1 ? line2 : '',
                lat: coords.length === 2 ? coords[1] : null,
                lon: coords.length === 2 ? coords[0] : null
            };
        });
    } catch (e) {
        return []; // aborted mid-typing or offline
    }
}

// One query across all three sources, merged best-first: realtor.com
// (canonical, suffixed) first, then Census, then Photon — deduped on
// street line + zip so near-identical entries collapse
async function queryAddressProviders(query, signal) {
    // Census needs a house number to match; skip it for street-only fragments
    const censusPromise = /\d/.test(query) ? censusSuggestions(query) : Promise.resolve([]);
    const [realtor, census, photon] = await Promise.all([
        realtorSuggestions(query), censusPromise, photonSuggestions(query, signal)
    ]);
    const seen = new Set();
    return [...realtor, ...census, ...photon].filter(s => {
        const key = s.text.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 6);
}

// Subject field: picking a suggestion sets the canonical address and
// auto-runs the property lookup
attachAddressAutocomplete(subjectAddressInput, addressSuggestionsBox, (s) => {
    rawTypedAddress = subjectAddressInput.value.trim(); // keep as a lookup fallback variant
    lastSelectedCoords = (s.lat != null && s.lon != null) ? { lat: s.lat, lon: s.lon } : null;
    lastSelectedMprId = s.mprId || null;
    subjectAddressInput.value = s.text;
    if (lastSelectedCoords) showSiteMap(lastSelectedCoords.lat, lastSelectedCoords.lon);
    recalcAppraisal(); // persists the chosen address
    const anyProvider = rentcastKeyInput.value.trim() || melissaKeyInput.value.trim() || workerBase();
    if (anyProvider) {
        lookupSubjectProperty(); // auto-populate beds/baths/sqft/etc — all editable after
    } else {
        setLookupStatus('Address set. Deploy the free Cloudflare Worker or paste an API key below and property details will fill in automatically.', 'info');
    }
});

subjectAddressInput.addEventListener('input', () => {
    lastSelectedCoords = null; // typing invalidates the previously picked location
    lastSelectedMprId = null;
    purchaseEnteredForSubject = false; // a new subject voids the old price as evidence
    updateProtestNote();
});

// ==================== Page switching ====================

// Any subject-page visit arms the next ARV arrival for a fresh appraisal —
// even via a calculator detour (subject → calculator → arv must not carry
// the old property's comps into the new subject). ARV ⇄ calculator hops
// alone never reset.
let subjectVisitedSinceArv = true;

// Fresh appraisal on ARV entry: prior comps are wiped and the top-ranked
// nearby solds are searched and auto-filled (deliberate — stale comps from
// the last property must never bleed into a new subject). The outgoing set
// is kept in memory so a failed search can offer "Restore previous comps".
function resetCompsAndSuggest() {
    if (!lastSelectedCoords && !subjectAddressInput.value.trim()) return; // nothing to search around
    if (appraisalComps.some(c => c.label || Engine.num(c.salePrice) > 0)) {
        preResetComps = appraisalComps;
    }
    appraisalComps = Array.from({ length: 4 }, () => emptyCompSlot());
    compCandidatesPanel.classList.add('hidden');
    renderComps();
    recalcAppraisal();
    suggestComps();
    scanMarket(); // live counts + trend + competition ride the same arrival
}

function switchPage(page) {
    if (page === 'subject') {
        subjectVisitedSinceArv = true;
        suggestRunId++; // the subject may be about to change — kill any in-flight comp search
        marketRunId++;  // same for an in-flight market scan
    }
    pageSubjectBtn.classList.toggle('active', page === 'subject');
    pageArvBtn.classList.toggle('active', page === 'arv');
    pageCalculatorBtn.classList.toggle('active', page === 'calculator');
    subjectPage.classList.toggle('hidden', page !== 'subject');
    arvPage.classList.toggle('hidden', page !== 'arv');
    calculatorPage.classList.toggle('hidden', page !== 'calculator');
    strategySelector.classList.toggle('hidden', page !== 'calculator');
    if (page === 'arv' && subjectVisitedSinceArv) {
        subjectVisitedSinceArv = false;
        resetCompsAndSuggest();
    }
    if (page === 'arv') {
        // Re-measure unconditionally: Leaflet's own window-resize handler
        // fires even while this page is display:none and caches a 0×0 size
        // that nothing else repairs (same reason the chart resizes below).
        // Then fit, if a location change arrived while hidden.
        requestAnimationFrame(() => {
            if (compsMap) compsMap.invalidateSize();
            fitCompsMap();
        });
    }
    if (page === 'calculator' && chart) {
        // Chart may have been created while its container was hidden
        requestAnimationFrame(() => chart.resize());
    }
}

pageSubjectBtn.addEventListener('click', () => switchPage('subject'));
pageArvBtn.addEventListener('click', () => switchPage('arv'));
pageCalculatorBtn.addEventListener('click', () => switchPage('calculator'));
continueToArvBtn.addEventListener('click', () => switchPage('arv'));
useArvBtn.addEventListener('click', useAppraisedArv);
addCompBtn.addEventListener('click', () => {
    if (appraisalComps.length >= MAX_COMPS) return;
    // Seed physicals from the subject so only the differences need editing;
    // the price stays blank so the card sits out of the blend until priced
    appraisalComps.push({
        ...emptyCompSlot(),
        sqft: Engine.num(subjectSqftInput.value) || '', beds: Engine.num(subjectBedsInput.value) || '',
        baths: totalBaths(subjectBathsFullInput, subjectBathsHalfInput) || '', lotSqft: Engine.num(subjectLotInput.value) || '',
        garageSpaces: Engine.num(subjectGarageInput.value) || '', yearBuilt: Engine.num(subjectYearInput.value) || '',
        pool: subjectPoolInput.value, stories: subjectStoriesInput.value
    });
    renderComps();
    recalcAppraisal();
});

[
    subjectAddressInput, subjectSubdivisionInput, subjectSqftInput, subjectBedsInput,
    subjectBathsFullInput, subjectBathsHalfInput,
    subjectLotInput, subjectYearInput, subjectGarageInput,
    subjectPropTypeInput, subjectCountyInput, subjectZoningInput, subjectApnInput, subjectLegalInput,
    subjectGarageTypeInput, subjectFoundationInput, subjectRoofInput, subjectExteriorInput,
    subjectHeatingInput, subjectCoolingInput,
    subjectAssessedValueInput, subjectAssessedLandInput, subjectAssessedImprovInput,
    subjectAnnualTaxesInput, subjectLastSaleDateInput, subjectLastSalePriceInput,
    subjectListPriceInput, subjectListingStatusInput, subjectHoaFeeInput,
    subjectOwnerNamesInput, subjectOwnerTypeInput, subjectOwnerMailingInput,
    adjPriceSqftInput, adjBedInput, adjBathInput, adjCondAvgInput,
    adjCondDatedInput, adjAppreciationInput, adjLotInput, adjGarageInput,
    adjPoolInput, adjYearInput, adjStoryInput
].forEach(input => input.addEventListener('input', recalcAppraisal));

// Typing in a derived field is the override. From then on the next comp
// search reports what it would have suggested instead of overwriting the
// number under the user's cursor.
adjPriceSqftInput.addEventListener('input', () => markRateOverridden('pricePerSqftAdj'));
adjAppreciationInput.addEventListener('input', () => markRateOverridden('annualAppreciationPct'));

[subjectStoriesInput, subjectPoolInput, subjectHoaInput, subjectOwnerOccupiedInput]
    .forEach(sel => sel.addEventListener('change', recalcAppraisal));
// The HOA answer gates a rental thesis, and that gate lives on the calculator
// page — the appraisal recalc above never reaches it.
subjectHoaInput.addEventListener('change', updateHoaGate);
// Tax-projection inputs live on the subject page; keep the calculator note current
[subjectAssessedValueInput, subjectAnnualTaxesInput, subjectHoaFeeInput]
    .forEach(input => input.addEventListener('input', updateTaxProjection));
[subjectAssessedValueInput, subjectAnnualTaxesInput]
    .forEach(input => input.addEventListener('input', updateProtestNote));
// Typing a price is what makes it evidence for the current subject.
// Re-render after setting the flag: the calculateDeal listener registered
// earlier already ran updateProtestNote with the flag still false.
purchasePriceInput.addEventListener('input', () => {
    purchaseEnteredForSubject = true;
    updateProtestNote();
});
subjectOwnerOccupiedInput.addEventListener('change', updateTaxProjection);
// Max-offer targets re-solve on their own; market inputs also flex the rule %
[maoTargetProfitInput, maoTargetCfInput, maoMinDscrInput, maoMinCocInput, mktActivesInput, mktPendingsInput, mktSold90Input]
    .forEach(input => input.addEventListener('input', updateMaxOffer));
// Rehab estimator: tier picks a $/sqft preset; all three drive the estimate line
rehabTierSelect.addEventListener('change', () => {
    rehabPerSqftInput.value = Engine.DEFAULTS.rehabTiers[rehabTierSelect.value] || rehabPerSqftInput.value;
    updateRehabEstimator();
});
[rehabPerSqftInput, rehabContingencyInput, subjectSqftInput, subjectYearInput]
    .forEach(input => input.addEventListener('input', updateRehabEstimator));
interestAccrualSelect.addEventListener('change', calculateDeal);
// Rent-ladder freshness: a new address invalidates the cached ladder; the
// lender-haircut line tracks the live rent input
subjectAddressInput.addEventListener('input', renderRentNote);
monthlyRentInput.addEventListener('input', () => { if (rentData) renderRentLadder(); });
[mktActivesInput, mktPendingsInput, mktSold90Input].forEach(input => input.addEventListener('input', updateAbsorption));

lookupBtn.addEventListener('click', lookupSubjectProperty);
rentcastKeyInput.addEventListener('input', () => {
    try { localStorage.setItem(RENTCAST_KEY_STORAGE, rentcastKeyInput.value.trim()); } catch (e) { /* private mode */ }
});
melissaKeyInput.addEventListener('input', () => {
    try { localStorage.setItem(MELISSA_KEY_STORAGE, melissaKeyInput.value.trim()); } catch (e) { /* private mode */ }
});

// Feed status in the settings panel. Runs once at load and after any proxy
// URL change, so the answer to "is my MLS licence actually wired up?" is
// visible without a network tab.
const mlsStatusEl = document.getElementById('mls-status');
let mlsHealth = null;

async function refreshMlsStatus() {
    if (!mlsStatusEl) return;
    try {
        const res = await fetch(workerBase() + '/health', { headers: { 'Accept': 'application/json' } });
        const h = await res.json();
        mlsHealth = (h && h.mls) || null;
        if (mlsHealth) {
            mlsStatusEl.textContent = `MLS feed: ✓ ${mlsHealth.name} live over ${String(mlsHealth.transport).toUpperCase()}`
                + ' — comps, market scan and rent all read from it, with the sources below as fallback.';
            mlsStatusEl.className = 'settings-note truth-verified';
        } else {
            mlsStatusEl.textContent = 'MLS feed: not configured — comps fall back to realtor.com list-at-sale proxies. '
                + 'Add the feed credentials as secrets on the data proxy to switch to recorded sale prices.';
            mlsStatusEl.className = 'settings-note truth-proxy';
        }
    } catch (e) {
        mlsStatusEl.textContent = 'MLS feed: could not reach the data proxy to check.';
        mlsStatusEl.className = 'settings-note';
    }
}

let workerHealthDebounce = null;
workerUrlInput.addEventListener('input', () => {
    try { localStorage.setItem(WORKER_URL_STORAGE, workerUrlInput.value.trim()); } catch (e) { /* private mode */ }
    clearTimeout(workerHealthDebounce);
    const base = workerBase();
    if (!base) return;
    workerHealthDebounce = setTimeout(async () => {
        try {
            const res = await fetch(base + '/health', { headers: { 'Accept': 'application/json' } });
            const h = await res.json();
            if (h && h.ok) {
                const extras = [h.providers.rentcast && 'RentCast', h.providers.melissa && 'Melissa'].filter(Boolean);
                const mls = h.mls
                    ? `✓ Worker connected — ${h.mls.name} feed live (${h.mls.transport.toUpperCase()}); `
                        + `fallbacks: keyless realtor.com${extras.length ? ' + ' + extras.join(', ') : ''}.`
                    : `✓ Worker connected — keyless realtor.com data${extras.length ? ' + server-side keys: ' + extras.join(', ') : ''}.`;
                setLookupStatus(mls, 'success');
            } else {
                setLookupStatus('✗ That URL responded, but not like the underwriter worker — check the deployment.', 'error');
            }
        } catch (e) {
            setLookupStatus('✗ Could not reach the worker at that URL (CORS or typo?).', 'error');
        }
        refreshMlsStatus();
    }, 700);
});

// ==================== Initial render ====================
// (scripts are deferred, so the DOM is ready here)

if (window.lucide) {
    window.lucide.createIcons(); // static page icons only; dynamic ones use inline SVGs
}
switchStrategy('flip');
renderQualSettings();          // must exist before restore fills the % values
restoreAppraisalState();
initWeightSliders();           // sliders mirror the restored number values
try {
    rentcastKeyInput.value = localStorage.getItem(RENTCAST_KEY_STORAGE) || '';
    melissaKeyInput.value = localStorage.getItem(MELISSA_KEY_STORAGE) || '';
    workerUrlInput.value = localStorage.getItem(WORKER_URL_STORAGE) || '';
    gmapsKeyInput.value = localStorage.getItem(GMAPS_KEY_STORAGE) || '';
} catch (e) { /* private mode */ }
renderComps();
recalcAppraisal();
updateAbsorption();
updateRehabEstimator();
renderRentNote();
refreshMlsStatus();    // async; settings panel shows the feed's real state
switchPage('subject'); // step 1 first

// ==================== Native app (Capacitor) integration ====================
// The store builds (see native/) run this same file inside a Capacitor
// WebView, where window.Capacitor exists. Everything below is a no-op in
// the browser/PWA.

const capacitorGlobal = window.Capacitor;
if (capacitorGlobal && capacitorGlobal.isNativePlatform && capacitorGlobal.isNativePlatform()) {
    const nativePlugins = capacitorGlobal.Plugins || {};

    // window.print() does nothing inside WKWebView / Android WebView
    document.getElementById('export-pdf-btn').classList.add('hidden');

    // Android hardware back: calculator → ARV estimation → subject → home screen
    if (nativePlugins.App) {
        nativePlugins.App.addListener('backButton', () => {
            if (!calculatorPage.classList.contains('hidden')) {
                switchPage('arv');
            } else if (!arvPage.classList.contains('hidden')) {
                switchPage('subject');
            } else {
                nativePlugins.App.exitApp();
            }
        });
    }

    // Light status-bar icons over the dark theme ('DARK' = dark background)
    if (nativePlugins.StatusBar) {
        nativePlugins.StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
    }
}

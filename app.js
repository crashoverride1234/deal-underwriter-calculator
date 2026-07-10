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
    } else {
        holdingPeriodLabel.textContent = 'Rehab/Stabilization Hold';
        sliderVarianceLabel.textContent = 'Appraised Value Variance';
        rentalOperationsSection.classList.remove('hidden');
    }

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
        monthlyTaxesIns: monthlyTaxesInsInput.value
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
    summaryLoanAmount.textContent = formatCurrency(m.loanAmount);
    summaryMonthlyHoldingCost.textContent = formatCurrency(m.monthlyHoldingCost);
    summaryTotalFinanceCosts.textContent = formatCurrency(m.financeFees);
    summarySellingCosts.textContent = formatCurrency(m.sellingRefiCosts);
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

    if (m.netProfit < 0) {
        setScorecard('fail', ICONS.cross, 'WARNING: Unprofitable Deal',
            'Carrying costs and fees exceed returns. Review purchase price or rehab costs.');
    } else if (m.roi < 12) {
        setScorecard('warning', ICONS.warning, 'CAUTION: Tight Margins',
            'ROI is below 12%. Small rehab overrun will wipe out profit.');
    } else {
        setScorecard('success', ICONS.check, 'EXCELLENT: Strong Flip Deal',
            `Excellent margins with ROI of ${formatPercent(m.roi)}.`);
    }

    updateFlipChart(m);
}

// Rental dashboard
function updateRentalUI(m) {
    const cashFlowClass = m.monthlyCashFlow >= 250 ? 'success' : (m.monthlyCashFlow > 0 ? 'warning' : 'danger');
    const cocClass = m.cocReturn >= 8 ? 'success' : (m.cocReturn > 3 ? 'warning' : 'danger');
    const noDebt = m.dscrRatio === Infinity;
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
    setMetric('dscrRatio', {
        value: noDebt ? 'N/A' : m.dscrRatio.toFixed(2),
        cardClass: noDebt ? 'info' : (dscrHealthy ? 'success' : 'danger'),
        trendClass: noDebt ? 'trend-neutral' : (dscrHealthy ? 'trend-up' : 'trend-down'),
        trendText: noDebt ? 'No Debt — All Cash' : (dscrHealthy ? 'Lender Approved (1.25+)' : 'Rejection Risk (< 1.25)')
    });

    if (m.monthlyCashFlow < 0) {
        setScorecard('fail', ICONS.cross, 'WARNING: Negative Cash Flow',
            'Property costs exceed net operating rent. Review expenses, price, or interest rate.');
    } else if (!noDebt && m.dscrRatio < 1.25) {
        setScorecard('warning', ICONS.warning, 'CAUTION: Low Debt Coverage',
            `DSCR is ${m.dscrRatio.toFixed(2)}. Banks generally require 1.20 - 1.25 to finance.`);
    } else if (m.cocReturn > 10) {
        setScorecard('success', ICONS.check, 'EXCELLENT: High Yield Rental',
            `High Cash-on-Cash yield of ${formatPercent(m.cocReturn)}. Safe coverage ratio.`);
    } else {
        setScorecard('success', ICONS.check, 'SOLID: Balanced Rental',
            'DSCR passes bank underwriting easily. Positive net cash flow.');
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
                { label: 'Break-Even ARV Baseline', data: [0, 0], backgroundColor: '#374151' }
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
    monthlyTaxesInsInput
].forEach(input => input.addEventListener('input', calculateDeal));

financingTypeSelect.addEventListener('change', handleFinancingChange);
document.getElementById('strategy-flip-btn').addEventListener('click', () => switchStrategy('flip'));
document.getElementById('strategy-rental-btn').addEventListener('click', () => switchStrategy('rental'));
document.getElementById('export-pdf-btn').addEventListener('click', () => window.print());

// ==================== ARV Desktop Appraisal (Page 1) ====================

const appraisalPage = document.getElementById('appraisal-page');
const calculatorPage = document.getElementById('calculator-page');
const pageAppraisalBtn = document.getElementById('page-appraisal-btn');
const pageCalculatorBtn = document.getElementById('page-calculator-btn');
const strategySelector = document.getElementById('strategy-selector');
const calcAddressNote = document.getElementById('calc-address-note');

const subjectAddressInput = document.getElementById('subject-address');
const subjectSqftInput = document.getElementById('subject-sqft');
const subjectBedsInput = document.getElementById('subject-beds');
const subjectBathsInput = document.getElementById('subject-baths');
const subjectLotInput = document.getElementById('subject-lot');
const subjectYearInput = document.getElementById('subject-year');
const subjectGarageInput = document.getElementById('subject-garage');
const subjectStoriesInput = document.getElementById('subject-stories');
const subjectPoolInput = document.getElementById('subject-pool');
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
const addCompBtn = document.getElementById('add-comp-btn');
const arvEstimateValue = document.getElementById('arv-estimate-value');
const arvPpsfNote = document.getElementById('arv-ppsf-note');
const arvRangeValue = document.getElementById('arv-range-value');
const arvConfidenceCard = document.getElementById('arv-confidence-card');
const arvConfidenceValue = document.getElementById('arv-confidence-value');
const arvSpreadNote = document.getElementById('arv-spread-note');
const compResultsBody = document.getElementById('comp-results-body');
const appraisalWarnings = document.getElementById('appraisal-warnings');
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
    { key: 'curbAppeal', label: 'Curb Appeal', pct: 2 },
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
        condition: 'renovated', monthsAgo: 0, ratings: defaultRatings()
    };
}

// Older saved comps predate the extra fields; fill gaps with template values
function normalizeComp(c) {
    const t = compTemplate();
    return { ...t, ...c, ratings: { ...t.ratings, ...(c.ratings || {}) } };
}

const DEFAULT_COMPS = [
    { ...compTemplate(), label: '412 Oak Ave', salePrice: 325000, sqft: 1520, lotSqft: 7200, yearBuilt: 1982, monthsAgo: 2 },
    { ...compTemplate(), label: '88 Birch Ln', salePrice: 310000, sqft: 1450, lotSqft: 6800, yearBuilt: 1978, monthsAgo: 4 },
    { ...compTemplate(), label: '205 Cedar Ct', salePrice: 289000, sqft: 1400, baths: 1, garageSpaces: 1, yearBuilt: 1975, condition: 'average', monthsAgo: 6,
      ratings: { ...defaultRatings(), locationInfluence: 'inferior' } }
];

let appraisalComps = DEFAULT_COMPS.map(c => normalizeComp(c));
let lastAppraisal = null;
const qualSettingInputs = {}; // factor key -> generated % input

// Shared field lists so save/restore can't drift apart (key -> input element)
const SUBJECT_STATE_FIELDS = {
    address: subjectAddressInput, sqft: subjectSqftInput, beds: subjectBedsInput,
    baths: subjectBathsInput, lot: subjectLotInput, year: subjectYearInput,
    garage: subjectGarageInput, stories: subjectStoriesInput, pool: subjectPoolInput
};
const SETTINGS_STATE_FIELDS = {
    pricePerSqft: adjPriceSqftInput, bed: adjBedInput, bath: adjBathInput,
    condAvg: adjCondAvgInput, condDated: adjCondDatedInput, appreciation: adjAppreciationInput,
    lot: adjLotInput, garage: adjGarageInput, pool: adjPoolInput, year: adjYearInput, story: adjStoryInput
};
const MARKET_STATE_FIELDS = {
    actives: mktActivesInput, pendings: mktPendingsInput, sold90: mktSold90Input
};

function saveAppraisalState() {
    try {
        const qual = {};
        QUALITATIVE_FACTORS.forEach(f => {
            if (qualSettingInputs[f.key]) qual[f.key] = qualSettingInputs[f.key].value;
        });
        const dump = fields => Object.fromEntries(Object.entries(fields).map(([k, input]) => [k, input.value]));
        localStorage.setItem(APPRAISAL_STORAGE_KEY, JSON.stringify({
            ...dump(SUBJECT_STATE_FIELDS),
            settings: { ...dump(SETTINGS_STATE_FIELDS), qual },
            market: dump(MARKET_STATE_FIELDS),
            comps: appraisalComps
        }));
    } catch (e) { /* storage full/blocked — appraisal still works, just not persisted */ }
}

function restoreAppraisalState() {
    try {
        const raw = localStorage.getItem(APPRAISAL_STORAGE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        const set = (input, v) => { if (v !== undefined && v !== null) input.value = v; };
        const apply = (fields, source) => Object.entries(fields).forEach(([k, input]) => set(input, source[k]));

        apply(SUBJECT_STATE_FIELDS, s);
        if (s.settings) {
            apply(SETTINGS_STATE_FIELDS, s.settings);
            if (s.settings.qual) {
                QUALITATIVE_FACTORS.forEach(f => {
                    if (qualSettingInputs[f.key] && s.settings.qual[f.key] !== undefined) {
                        qualSettingInputs[f.key].value = s.settings.qual[f.key];
                    }
                });
            }
        }
        if (s.market) apply(MARKET_STATE_FIELDS, s.market);
        if (Array.isArray(s.comps) && s.comps.length) {
            appraisalComps = s.comps.slice(0, MAX_COMPS).map(normalizeComp);
        }
    } catch (e) { /* corrupted state — fall back to defaults */ }
}

// Generate the qualitative % inputs in Adjustment Settings from one source of truth
function renderQualSettings() {
    qualSettingsContainer.innerHTML = '';
    QUALITATIVE_FACTORS.forEach(f => {
        const div = document.createElement('div');
        div.className = 'form-group';
        div.innerHTML = `
            <label></label>
            <div class="input-wrapper has-suffix">
                <input type="number" min="0" max="25" step="0.5" value="${f.pct}">
                <span class="input-suffix">%</span>
            </div>`;
        div.querySelector('label').textContent = f.label;
        const input = div.querySelector('input');
        input.addEventListener('input', recalcAppraisal);
        qualSettingInputs[f.key] = input;
        qualSettingsContainer.appendChild(div);
    });
}

const CONDITION_OPTIONS = [
    { value: 'renovated', text: 'Renovated' },
    { value: 'average', text: 'Average' },
    { value: 'dated', text: 'Dated' }
];

// Rebuild comp editor cards (only on add/remove/restore; typing updates state in place)
function renderComps() {
    compsContainer.innerHTML = '';
    appraisalComps.forEach((comp, idx) => {
        const card = document.createElement('div');
        card.className = 'comp-card';
        card.innerHTML = `
            <div class="comp-card-header">
                <span>Comp ${idx + 1}</span>
                <button class="comp-remove" title="Remove comp" ${appraisalComps.length <= 1 ? 'disabled' : ''}>&times;</button>
            </div>
            <div class="form-group">
                <label>Address / Label</label>
                <input type="text" data-field="label">
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
        card.querySelector('.comp-remove').addEventListener('click', () => {
            appraisalComps.splice(idx, 1);
            renderComps();
            recalcAppraisal();
        });
        compsContainer.appendChild(card);
    });
    addCompBtn.disabled = appraisalComps.length >= MAX_COMPS;
}

function readAppraisalInputs() {
    const qualitativeAdjPct = {};
    QUALITATIVE_FACTORS.forEach(f => {
        qualitativeAdjPct[f.key] = qualSettingInputs[f.key] ? qualSettingInputs[f.key].value : f.pct;
    });
    return {
        subject: {
            sqft: subjectSqftInput.value,
            beds: subjectBedsInput.value,
            baths: subjectBathsInput.value,
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

function recalcAppraisal() {
    const a = Engine.appraise(readAppraisalInputs());
    lastAppraisal = a;

    arvEstimateValue.textContent = formatCurrency(a.arv);
    arvPpsfNote.textContent = a.subjectPricePerSqft > 0
        ? `$${a.subjectPricePerSqft.toFixed(0)}/sqft on subject` : 'Weighted comp value';
    arvRangeValue.textContent = `${formatCurrency(a.low)} – ${formatCurrency(a.high)}`;

    const conf = CONFIDENCE_STYLES[a.confidence];
    arvConfidenceValue.textContent = conf.label;
    arvConfidenceCard.className = `metric-card ${conf.card}`;
    arvSpreadNote.textContent = a.comps.length
        ? `${a.spreadPct.toFixed(1)}% spread across ${a.comps.length} comp${a.comps.length !== 1 ? 's' : ''}`
        : 'Add at least one comp';

    compResultsBody.innerHTML = '';
    a.comps.forEach((c, i) => {
        const row = document.createElement('tr');
        const netPrefix = c.netAdjustment >= 0 ? '+' : '';
        row.innerHTML = `
            <td>${c.flagged ? '⚠ ' : ''}<span class="comp-name"></span></td>
            <td>${formatCurrency(c.salePrice)}</td>
            <td class="${c.netAdjustment >= 0 ? 'adj-pos' : 'adj-neg'}">${netPrefix}${formatCurrency(c.netAdjustment)}</td>
            <td><strong>${formatCurrency(c.adjustedValue)}</strong></td>
            <td>×${c.weight.toFixed(2)}</td>
        `;
        row.querySelector('.comp-name').textContent = c.label || `Comp ${i + 1}`;
        compResultsBody.appendChild(row);
    });

    const flagged = a.comps.filter(c => c.flagged);
    appraisalWarnings.innerHTML = '';
    if (flagged.length) {
        const warn = document.createElement('div');
        warn.className = 'appraisal-warning';
        warn.textContent = `⚠ ${flagged.map(c => c.label || 'Unnamed comp').join(', ')}: gross adjustments exceed 25% of sale price — weak comparable(s), consider replacing.`;
        appraisalWarnings.appendChild(warn);
    }

    useArvBtn.disabled = a.arv <= 0;
    useArvBtn.textContent = a.arv > 0
        ? `Use ${formatCurrency(a.arv)} as ARV in the Deal Calculator →`
        : 'Add comps to estimate ARV';

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

const PROPERTY_CACHE_KEY = 'underwriter-property-cache-v1';
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

function getCachedRecord(address) {
    try {
        const cache = JSON.parse(localStorage.getItem(PROPERTY_CACHE_KEY) || '{}');
        return cache[cacheKeyFor(address)] || null;
    } catch (e) { return null; }
}

function putCachedRecord(address, record) {
    try {
        const cache = JSON.parse(localStorage.getItem(PROPERTY_CACHE_KEY) || '{}');
        const keys = Object.keys(cache);
        if (keys.length >= 60) delete cache[keys[0]]; // keep the cache bounded
        cache[cacheKeyFor(address)] = record;
        localStorage.setItem(PROPERTY_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* storage full — cache is best-effort */ }
}

// Normalized record shape: { sqft, beds, baths, lot, year, garage, pool, stories, formattedAddress, source }
function rentcastToRecord(p) {
    const f = p.features || {};
    const garage = (f.garageSpaces != null) ? f.garageSpaces : (f.garage === true ? 1 : (f.garage === false ? 0 : null));
    return {
        sqft: p.squareFootage != null ? p.squareFootage : null,
        beds: p.bedrooms != null ? p.bedrooms : null,
        baths: p.bathrooms != null ? p.bathrooms : null,
        lot: p.lotSize != null ? p.lotSize : null,
        year: p.yearBuilt != null ? p.yearBuilt : null,
        garage,
        pool: (f.pool === true || f.pool === false) ? f.pool : null,
        stories: f.floorCount != null ? f.floorCount : null,
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
    return {
        sqft: numOrNull(size.AreaBuilding),
        beds: numOrNull(room.BedroomsCount),
        baths: numOrNull(room.BathCount),
        lot: numOrNull(size.AreaLotSF),
        year: numOrNull(use.YearBuilt),
        garage: numOrNull(parking.ParkingSpaceCount),
        pool,
        stories: numOrNull((r.IntStructInfo || {}).StoriesCount),
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

async function rentcastLookup(address, key) {
    // 1. Address variants: canonical suggestion text, then the raw typed text
    const variants = [address];
    if (rawTypedAddress && rawTypedAddress.toLowerCase() !== address.toLowerCase() && /\d/.test(rawTypedAddress)) {
        variants.push(rawTypedAddress);
    }
    for (const variant of variants) {
        const rec = await rentcastFetch(`address=${encodeURIComponent(variant)}`, key);
        if (rec) return rec;
    }
    // 2. Coordinate radius — sidesteps address-string matching entirely
    if (lastSelectedCoords) {
        const { lat, lon } = lastSelectedCoords;
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
    fill(subjectSqftInput, rec.sqft, 'sqft');
    fill(subjectBedsInput, rec.beds, 'beds');
    fill(subjectBathsInput, rec.baths, 'baths');
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
    if (rec.formattedAddress) subjectAddressInput.value = rec.formattedAddress;
    setLookupStatus(
        filled.length
            ? `✓ ${rec.formattedAddress || fallbackAddress} (${rec.source}): ${filled.join(' · ')}. Review and override anything below.`
            : 'Record found, but it had no usable fields — enter details manually.',
        'success'
    );
    recalcAppraisal();
}

async function lookupSubjectProperty() {
    const address = subjectAddressInput.value.trim();
    if (!address) {
        setLookupStatus('Enter the property address first.', 'error');
        return;
    }
    const rcKey = rentcastKeyInput.value.trim();
    const mdKey = melissaKeyInput.value.trim();
    const worker = workerBase();
    if (!rcKey && !mdKey && !worker) {
        setLookupStatus('Deploy the bundled Cloudflare Worker (keyless) or paste a free RentCast/Melissa API key below to enable auto-fill.', 'error');
        rentcastKeyInput.closest('details').open = true;
        return;
    }

    // Cache first — a property already fetched never costs another API call
    const cached = getCachedRecord(address);
    if (cached) {
        applyPropertyRecord(cached, address);
        return;
    }

    lookupBtn.disabled = true;
    setLookupStatus('Looking up property records…', 'info');
    const problems = [];
    try {
        let rec = null;
        // 1. Worker + realtor.com (keyless, richest data): use the picked
        //    suggestion's mpr_id when we have one, otherwise let the worker
        //    resolve the address itself — works for Census/Photon picks too
        if (worker) {
            try {
                rec = await workerFetchRecord(lastSelectedMprId
                    ? `/property?mpr_id=${encodeURIComponent(lastSelectedMprId)}`
                    : `/property?address=${encodeURIComponent(address)}`);
            } catch (err) {
                problems.push(err instanceof TypeError ? 'Worker: network error' : 'Worker: ' + err.message);
            }
        }
        // 2. RentCast with a browser-side key
        if (!rec && rcKey) {
            try {
                rec = await rentcastLookup(address, rcKey);
            } catch (err) {
                problems.push(err instanceof TypeError ? 'RentCast: network error' : err.message);
            }
        }
        // 3. RentCast through the worker (server-side key, if configured)
        if (!rec && worker && !rcKey) {
            try {
                rec = await workerFetchRecord(`/rentcast?address=${encodeURIComponent(address)}`);
                if (!rec && lastSelectedCoords) {
                    rec = await workerFetchRecord(`/rentcast?latitude=${lastSelectedCoords.lat}&longitude=${lastSelectedCoords.lon}&radius=0.05&limit=1`);
                }
            } catch (err) {
                problems.push(err instanceof TypeError ? 'Worker: network error' : 'Worker RentCast: ' + err.message);
            }
        }
        // 4. Melissa with a browser-side key
        if (!rec && mdKey) {
            try {
                rec = await melissaLookup(address, mdKey);
            } catch (err) {
                problems.push(err instanceof TypeError ? 'Melissa: network error' : err.message);
            }
        }
        // 5. Melissa through the worker (server-side key, if configured)
        if (!rec && worker && !mdKey) {
            try {
                rec = await workerFetchRecord(`/melissa?ff=${encodeURIComponent(address)}`);
            } catch (err) {
                problems.push(err instanceof TypeError ? 'Worker: network error' : 'Worker Melissa: ' + err.message);
            }
        }
        if (rec) {
            putCachedRecord(address, rec);
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
let suggestDebounce = null;
let suggestAbort = null;
let suggestGeneration = 0; // ignore out-of-order responses while typing
let jsonpCounter = 0;      // unique JSONP callback names (separate from generation)
let currentSuggestions = [];
let activeSuggestion = -1;
let rawTypedAddress = '';  // what the user had typed before a suggestion replaced it

function titleCase(s) {
    return s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function hideSuggestions() {
    addressSuggestionsBox.classList.add('hidden');
    addressSuggestionsBox.innerHTML = '';
    currentSuggestions = [];
    activeSuggestion = -1;
}

function highlightSuggestion(idx) {
    activeSuggestion = idx;
    [...addressSuggestionsBox.children].forEach((el, i) => {
        el.classList.toggle('active', i === idx);
    });
}

function selectSuggestion(s) {
    rawTypedAddress = subjectAddressInput.value.trim(); // keep as a lookup fallback variant
    lastSelectedCoords = (s.lat != null && s.lon != null) ? { lat: s.lat, lon: s.lon } : null;
    lastSelectedMprId = s.mprId || null;
    subjectAddressInput.value = s.text;
    hideSuggestions();
    recalcAppraisal(); // persists the chosen address
    const anyProvider = rentcastKeyInput.value.trim() || melissaKeyInput.value.trim() || workerBase();
    if (anyProvider) {
        lookupSubjectProperty(); // auto-populate beds/baths/sqft/etc — all editable after
    } else {
        setLookupStatus('Address set. Deploy the free Cloudflare Worker or paste an API key below and property details will fill in automatically.', 'info');
    }
}

function renderSuggestions(list) {
    currentSuggestions = list;
    activeSuggestion = -1;
    addressSuggestionsBox.innerHTML = '';
    if (!list.length) {
        hideSuggestions();
        return;
    }
    list.forEach((s, i) => {
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
            selectSuggestion(s);
        });
        item.addEventListener('mouseenter', () => highlightSuggestion(i));
        addressSuggestionsBox.appendChild(item);
    });
    addressSuggestionsBox.classList.remove('hidden');
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

async function photonSuggestions(query) {
    if (suggestAbort) suggestAbort.abort();
    suggestAbort = new AbortController();
    try {
        // lat/lon bias toward the continental US improves ranking
        const res = await fetch(
            `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=en&lat=39.8&lon=-98.5`,
            { signal: suggestAbort.signal }
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

async function fetchAddressSuggestions(query) {
    const generation = ++suggestGeneration;
    // Census needs a house number to match; skip it for street-only fragments
    const censusPromise = /\d/.test(query) ? censusSuggestions(query) : Promise.resolve([]);
    const [realtor, census, photon] = await Promise.all([
        realtorSuggestions(query), censusPromise, photonSuggestions(query)
    ]);
    if (generation !== suggestGeneration) return; // a newer query superseded this one
    // realtor.com (canonical, suffixed) first, then Census, then Photon —
    // deduped on street line + zip so near-identical entries collapse
    const seen = new Set();
    const merged = [...realtor, ...census, ...photon].filter(s => {
        const key = s.text.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    renderSuggestions(merged.slice(0, 6));
}

subjectAddressInput.addEventListener('input', () => {
    lastSelectedCoords = null; // typing invalidates the previously picked location
    lastSelectedMprId = null;
    const q = subjectAddressInput.value.trim();
    clearTimeout(suggestDebounce);
    if (q.length < 4) {
        hideSuggestions();
        return;
    }
    suggestDebounce = setTimeout(() => fetchAddressSuggestions(q), 300);
});

subjectAddressInput.addEventListener('keydown', (e) => {
    if (addressSuggestionsBox.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightSuggestion(Math.min(activeSuggestion + 1, currentSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightSuggestion(Math.max(activeSuggestion - 1, 0));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
        e.preventDefault();
        selectSuggestion(currentSuggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
        hideSuggestions();
    }
});

subjectAddressInput.addEventListener('blur', () => {
    // Delay so a mousedown on a suggestion can land first
    setTimeout(hideSuggestions, 150);
});

// ==================== Page switching ====================

function switchPage(page) {
    const onAppraisal = page === 'appraisal';
    pageAppraisalBtn.classList.toggle('active', onAppraisal);
    pageCalculatorBtn.classList.toggle('active', !onAppraisal);
    appraisalPage.classList.toggle('hidden', !onAppraisal);
    calculatorPage.classList.toggle('hidden', onAppraisal);
    strategySelector.classList.toggle('hidden', onAppraisal);
    if (!onAppraisal && chart) {
        // Chart may have been created while its container was hidden
        requestAnimationFrame(() => chart.resize());
    }
}

pageAppraisalBtn.addEventListener('click', () => switchPage('appraisal'));
pageCalculatorBtn.addEventListener('click', () => switchPage('calculator'));
useArvBtn.addEventListener('click', useAppraisedArv);
addCompBtn.addEventListener('click', () => {
    if (appraisalComps.length >= MAX_COMPS) return;
    // Seed the new comp from the subject so only the differences need editing
    appraisalComps.push({
        ...compTemplate(),
        sqft: Engine.num(subjectSqftInput.value), beds: Engine.num(subjectBedsInput.value),
        baths: Engine.num(subjectBathsInput.value), lotSqft: Engine.num(subjectLotInput.value),
        garageSpaces: Engine.num(subjectGarageInput.value), yearBuilt: Engine.num(subjectYearInput.value),
        pool: subjectPoolInput.value, stories: subjectStoriesInput.value
    });
    renderComps();
    recalcAppraisal();
});

[
    subjectAddressInput, subjectSqftInput, subjectBedsInput, subjectBathsInput,
    subjectLotInput, subjectYearInput, subjectGarageInput,
    adjPriceSqftInput, adjBedInput, adjBathInput, adjCondAvgInput,
    adjCondDatedInput, adjAppreciationInput, adjLotInput, adjGarageInput,
    adjPoolInput, adjYearInput, adjStoryInput
].forEach(input => input.addEventListener('input', recalcAppraisal));

[subjectStoriesInput, subjectPoolInput].forEach(sel => sel.addEventListener('change', recalcAppraisal));
[mktActivesInput, mktPendingsInput, mktSold90Input].forEach(input => input.addEventListener('input', updateAbsorption));

lookupBtn.addEventListener('click', lookupSubjectProperty);
rentcastKeyInput.addEventListener('input', () => {
    try { localStorage.setItem(RENTCAST_KEY_STORAGE, rentcastKeyInput.value.trim()); } catch (e) { /* private mode */ }
});
melissaKeyInput.addEventListener('input', () => {
    try { localStorage.setItem(MELISSA_KEY_STORAGE, melissaKeyInput.value.trim()); } catch (e) { /* private mode */ }
});

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
                setLookupStatus(`✓ Worker connected — keyless realtor.com data${extras.length ? ' + server-side keys: ' + extras.join(', ') : ''}.`, 'success');
            } else {
                setLookupStatus('✗ That URL responded, but not like the underwriter worker — check the deployment.', 'error');
            }
        } catch (e) {
            setLookupStatus('✗ Could not reach the worker at that URL (CORS or typo?).', 'error');
        }
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
try {
    rentcastKeyInput.value = localStorage.getItem(RENTCAST_KEY_STORAGE) || '';
    melissaKeyInput.value = localStorage.getItem(MELISSA_KEY_STORAGE) || '';
    workerUrlInput.value = localStorage.getItem(WORKER_URL_STORAGE) || '';
} catch (e) { /* private mode */ }
renderComps();
recalcAppraisal();
updateAbsorption();
switchPage('appraisal'); // step 1 first

// ==================== Native app (Capacitor) integration ====================
// The store builds (see native/) run this same file inside a Capacitor
// WebView, where window.Capacitor exists. Everything below is a no-op in
// the browser/PWA.

const capacitorGlobal = window.Capacitor;
if (capacitorGlobal && capacitorGlobal.isNativePlatform && capacitorGlobal.isNativePlatform()) {
    const nativePlugins = capacitorGlobal.Plugins || {};

    // window.print() does nothing inside WKWebView / Android WebView
    document.getElementById('export-pdf-btn').classList.add('hidden');

    // Android hardware back: calculator page → appraisal page → home screen
    if (nativePlugins.App) {
        nativePlugins.App.addListener('backButton', () => {
            if (calculatorPage.classList.contains('hidden')) {
                nativePlugins.App.exitApp();
            } else {
                switchPage('appraisal');
            }
        });
    }

    // Light status-bar icons over the dark theme ('DARK' = dark background)
    if (nativePlugins.StatusBar) {
        nativePlugins.StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
    }
}

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
        // Informational detail fields (auto-filled from the comp's address,
        // not used by the engine math)
        subdivision: '', propType: '', county: '', zoning: '', apn: '',
        garageType: '', foundation: '', roof: '', exterior: '', heating: '', cooling: '',
        assessedValue: '', annualTaxes: '', lastSaleDate: '', lastSalePrice: '', hoaFee: '',
        ownerNames: '', ownerType: '', ownerOccupied: '', ownerMailing: '',
        lat: '', lon: '', siteScan: ''
    };
}

// Older saved comps predate the extra fields; fill gaps with template values
function normalizeComp(c) {
    const t = compTemplate();
    return { ...t, ...c, ratings: { ...t.ratings, ...(c.ratings || {}) } };
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

const DEFAULT_COMPS = [
    { ...compTemplate(), label: '412 Oak Ave', salePrice: 325000, sqft: 1520, lotSqft: 7200, yearBuilt: 1982, monthsAgo: 2 },
    { ...compTemplate(), label: '88 Birch Ln', salePrice: 310000, sqft: 1450, lotSqft: 6800, yearBuilt: 1978, monthsAgo: 4 },
    { ...compTemplate(), label: '205 Cedar Ct', salePrice: 289000, sqft: 1400, baths: 1, garageSpaces: 1, yearBuilt: 1975, condition: 'average', monthsAgo: 6,
      ratings: { ...defaultRatings(), locationInfluence: 'inferior' } },
    emptyCompSlot()
];

let appraisalComps = DEFAULT_COMPS.map(c => normalizeComp(c));
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

// Shared field lists so save/restore can't drift apart (key -> input element)
const SUBJECT_STATE_FIELDS = {
    address: subjectAddressInput, subdivision: subjectSubdivisionInput, sqft: subjectSqftInput, beds: subjectBedsInput,
    bathsFull: subjectBathsFullInput, bathsHalf: subjectBathsHalfInput, lot: subjectLotInput, year: subjectYearInput,
    garage: subjectGarageInput, stories: subjectStoriesInput, pool: subjectPoolInput, hoa: subjectHoaInput,
    propType: subjectPropTypeInput, county: subjectCountyInput, zoning: subjectZoningInput,
    apn: subjectApnInput, legal: subjectLegalInput,
    garageType: subjectGarageTypeInput, foundation: subjectFoundationInput, roof: subjectRoofInput,
    exterior: subjectExteriorInput, heating: subjectHeatingInput, cooling: subjectCoolingInput,
    assessedValue: subjectAssessedValueInput, assessedLand: subjectAssessedLandInput,
    assessedImprov: subjectAssessedImprovInput, annualTaxes: subjectAnnualTaxesInput,
    lastSaleDate: subjectLastSaleDateInput, lastSalePrice: subjectLastSalePriceInput,
    listPrice: subjectListPriceInput, listingStatus: subjectListingStatusInput, hoaFee: subjectHoaFeeInput,
    ownerNames: subjectOwnerNamesInput, ownerType: subjectOwnerTypeInput,
    ownerOccupied: subjectOwnerOccupiedInput, ownerMailing: subjectOwnerMailingInput
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
            // Keep a spare slot visible (min 4 cards); empty slots stay out
            // of the blend until priced
            while (appraisalComps.length < 4) appraisalComps.push(emptyCompSlot());
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

// Rebuild comp editor cards (only on add/remove/restore; typing updates state in place)
function renderComps() {
    compsContainer.innerHTML = '';
    appraisalComps.forEach((comp, idx) => {
        const card = document.createElement('div');
        card.className = 'comp-card';
        card.innerHTML = `
            <div class="comp-card-header">
                <span>Comp ${idx + 1}${Engine.num(comp.salePrice) > 0 ? '' : ' <em class="comp-unpriced">unpriced · not in blend</em>'}</span>
                <button class="comp-remove" title="Remove comp" ${appraisalComps.length <= 1 ? 'disabled' : ''}>&times;</button>
            </div>
            <div class="form-group">
                <label>Address / Label</label>
                <div class="autocomplete-wrap">
                    <input type="text" data-field="label" placeholder="Type address to auto-fill…" autocomplete="off" spellcheck="false">
                    <div class="address-suggestions hidden" role="listbox"></div>
                </div>
                <div class="comp-subdivision hidden" data-subdiv></div>
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
        // Address autocomplete on the label: picking a suggestion auto-fills
        // the whole comp card from property records
        attachAddressAutocomplete(
            card.querySelector('[data-field="label"]'),
            card.querySelector('.address-suggestions'),
            (s) => {
                comp.label = s.line1 || s.text;
                if (s.lat != null) { comp.lat = s.lat; comp.lon = s.lon; }
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

// ==================== Comp Suggestions ====================
// Worker /comps merges realtor.com recent solds (keyless) with RentCast AVM
// comparables; ranking happens here so it always reflects the live subject.

const suggestCompsBtn = document.getElementById('suggest-comps-btn');
const compCandidatesPanel = document.getElementById('comp-candidates');

// Proximity-first ranking (0–100): location and sale recency carry 70 of
// 100 points — the closest, freshest solds lead. Material similarity earns
// the last 30, and hard dissimilarity GATES multiply the total down so a
// next-door sale that's the wrong house (2,000 sqft bigger, 50 years newer)
// can never ride proximity to the top.
function candidateScore(c) {
    const sSqft = Engine.num(subjectSqftInput.value);
    const sBeds = Engine.num(subjectBedsInput.value);
    const sBaths = totalBaths(subjectBathsFullInput, subjectBathsHalfInput);
    const sYear = Engine.num(subjectYearInput.value);
    const sGarage = Engine.num(subjectGarageInput.value);
    const sSingleStory = Engine.num(subjectStoriesInput.value) === 1;

    // 1. Location — 40 pts, fading to 0 at 2 miles
    let score = (c.distanceMi != null)
        ? 40 * Math.max(0, 1 - c.distanceMi / 2)
        : 15; // unknown location = middling, never top-tier

    // 2. Time — 30 pts, fading to 0 at 12 months
    if (c.soldDate) {
        const months = (Date.now() - new Date(c.soldDate).getTime()) / (86400000 * 30.44);
        score += 30 * Math.max(0, 1 - months / 12);
    } else {
        score += 10;
    }

    // 3. Material similarity — 30 pts (sqft 14, beds 5, baths 4, vintage 7)
    if (sSqft > 0 && c.sqft) score += 14 * Math.max(0, 1 - (Math.abs(c.sqft - sSqft) / sSqft) / 0.35);
    else score += 5;
    if (sBeds && c.beds != null) score += 5 * Math.max(0, 1 - Math.abs(c.beds - sBeds) / 2);
    if (sBaths && c.baths != null) score += 4 * Math.max(0, 1 - Math.abs(c.baths - sBaths) / 2);
    if (sYear && c.yearBuilt) score += 7 * Math.max(0, 1 - Math.abs(c.yearBuilt - sYear) / 30);

    // 4. Common-sense gates — material wrongness caps what proximity can buy
    let gate = 1;
    if (sSqft > 0 && c.sqft) {
        const dev = Math.abs(c.sqft - sSqft) / sSqft;
        if (dev > 0.5) gate *= 0.3;        // different class of house
        else if (dev > 0.3) gate *= 0.6;   // stretch comp at best
    }
    if (sBeds && c.beds != null && Math.abs(c.beds - sBeds) >= 3) gate *= 0.6;
    if (sYear && c.yearBuilt && Math.abs(c.yearBuilt - sYear) > 40) gate *= 0.6;
    if (sGarage > 0 && c.garage != null && Math.abs(c.garage - sGarage) >= 2) gate *= 0.85;
    if (c.stories != null && (c.stories === 1) !== sSingleStory) gate *= 0.9;

    return Math.max(0, Math.round(score * gate));
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

    suggestCompsBtn.disabled = true;
    compCandidatesPanel.innerHTML = '<div class="candidates-note">Searching recent solds near the subject…</div>';
    compCandidatesPanel.classList.remove('hidden');
    try {
        const res = await fetch(`${workerBase()}/comps?${q}`, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const ranked = (data.candidates || [])
            .map(c => ({ ...c, score: candidateScore(c) }))
            .sort((a, b) => b.score - a.score);
        renderCandidates(ranked);
    } catch (e) {
        compCandidatesPanel.innerHTML = '<div class="appraisal-warning">Comp search failed — check the connection and try again.</div>';
    } finally {
        suggestCompsBtn.disabled = false;
    }
}

function addCandidateAsComp(c) {
    // Fill the first truly empty slot, else append (bounded by MAX_COMPS)
    let comp = appraisalComps.find(x => !Engine.num(x.salePrice) && !x.label);
    if (!comp) {
        if (appraisalComps.length >= MAX_COMPS) return;
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
        const months = Math.round((Date.now() - new Date(c.soldDate).getTime()) / (86400000 * 30.44));
        if (months >= 0 && months <= 24) comp.monthsAgo = months;
    }
    renderComps();
    recalcAppraisal();
}

function renderCandidates(list) {
    compCandidatesPanel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'candidates-head';
    head.innerHTML = '<span>Suggested comps — recent nearby solds ranked by similarity to the subject. '
        + 'Prices are list-at-sale (TX non-disclosure); verify against MLS before relying on them.</span>'
        + '<button class="comp-remove" title="Close">&times;</button>';
    head.querySelector('button').addEventListener('click', () => compCandidatesPanel.classList.add('hidden'));
    compCandidatesPanel.appendChild(head);
    if (!list.length) {
        const none = document.createElement('div');
        none.className = 'candidates-note';
        none.textContent = 'No recent solds found nearby — add comps manually from MLS.';
        compCandidatesPanel.appendChild(none);
        return;
    }
    list.forEach(c => {
        const row = document.createElement('div');
        row.className = 'candidate-row';
        const specs = [
            c.price ? formatCurrency(c.price) : 'no price',
            c.soldDate ? `sold ${String(c.soldDate).slice(0, 10)}` : null,
            c.sqft ? `${c.sqft.toLocaleString()} sqft` : null,
            (c.beds != null && c.baths != null) ? `${c.beds} bd / ${c.baths} ba` : null,
            c.yearBuilt ? `blt ${c.yearBuilt}` : null,
            c.distanceMi != null ? `${c.distanceMi} mi` : null,
            c.correlation != null ? `RentCast ${(c.correlation * 100).toFixed(0)}%` : null
        ].filter(Boolean).join(' · ');
        row.innerHTML = `
            <div class="candidate-main">
                <div class="candidate-addr"></div>
                <div class="candidate-specs"></div>
            </div>
            <span class="candidate-score" title="similarity to subject (0–100)"></span>
            <button class="btn btn-secondary candidate-add">Add</button>`;
        row.querySelector('.candidate-addr').textContent = c.address;
        row.querySelector('.candidate-specs').textContent = specs;
        row.querySelector('.candidate-score').textContent = c.score;
        const btn = row.querySelector('.candidate-add');
        btn.addEventListener('click', () => {
            addCandidateAsComp(c);
            btn.disabled = true;
            btn.textContent = 'Added ✓';
        });
        compCandidatesPanel.appendChild(row);
    });
}

suggestCompsBtn.addEventListener('click', suggestComps);

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

function recalcAppraisal() {
    const a = Engine.appraise(readAppraisalInputs());
    lastAppraisal = a;
    updateWeightImpacts(a);
    updateSubjectSummary();
    refreshCompSubdivisions();

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
            <td class="${c.flagged ? 'adj-neg' : ''}">${c.grossAdjPct.toFixed(1)}%</td>
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
    a.comps.filter(c => c.overlaps.length).forEach((c, i) => {
        const warn = document.createElement('div');
        warn.className = 'appraisal-warning';
        warn.textContent = `⚠ Possible double-count on ${c.label || 'unnamed comp'}: ${c.overlaps.join('; ')} — the same defect may be adjusted twice, consider easing one side.`;
        appraisalWarnings.appendChild(warn);
    });

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

// Bump the version whenever records gain fields — older cached entries
// would otherwise silently auto-fill without the new fields forever
// (v2: subdivision/hoa; v3: facts/construction/financial/owner details)
const PROPERTY_CACHE_KEY = 'underwriter-property-cache-v3';
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
    if (rec.annualTaxes > 0) {
        const monthly = Math.round(rec.annualTaxes / 12 + (rec.hoaFee || 0));
        monthlyTaxesInsInput.value = monthly;
        filled.push(`est. taxes+HOA $${monthly}/mo`);
    }

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
    if (rec) putCachedRecord(address, rec);
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
});

// ==================== Page switching ====================

function switchPage(page) {
    pageSubjectBtn.classList.toggle('active', page === 'subject');
    pageArvBtn.classList.toggle('active', page === 'arv');
    pageCalculatorBtn.classList.toggle('active', page === 'calculator');
    subjectPage.classList.toggle('hidden', page !== 'subject');
    arvPage.classList.toggle('hidden', page !== 'arv');
    calculatorPage.classList.toggle('hidden', page !== 'calculator');
    strategySelector.classList.toggle('hidden', page !== 'calculator');
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
    // Seed the new comp from the subject so only the differences need editing
    appraisalComps.push({
        ...compTemplate(),
        sqft: Engine.num(subjectSqftInput.value), beds: Engine.num(subjectBedsInput.value),
        baths: totalBaths(subjectBathsFullInput, subjectBathsHalfInput), lotSqft: Engine.num(subjectLotInput.value),
        garageSpaces: Engine.num(subjectGarageInput.value), yearBuilt: Engine.num(subjectYearInput.value),
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

[subjectStoriesInput, subjectPoolInput, subjectHoaInput, subjectOwnerOccupiedInput]
    .forEach(sel => sel.addEventListener('change', recalcAppraisal));
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

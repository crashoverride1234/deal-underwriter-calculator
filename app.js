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

// Typical loan terms, applied once when the user picks a new financing type
const LOAN_DEFAULTS = {
    hard_money: { ltv: 85, rate: 10.5, points: 2.0 },
    private_money: { ltv: 85, rate: 10.5, points: 2.0 },
    dscr_purchase: { ltv: 75, rate: 7.5, points: 1.0 },
    dscr_refi: { ltv: 75, rate: 7.5, points: 1.0 }
};

const LOAN_LABELS = {
    hard_money: { ltv: 'Loan-to-Cost (LTC)', summary: 'Hard/Private Loan:' },
    private_money: { ltv: 'Loan-to-Cost (LTC)', summary: 'Hard/Private Loan:' },
    dscr_purchase: { ltv: 'Loan-to-Value (LTV)', summary: 'DSCR Purchase Loan:' },
    dscr_refi: { ltv: 'Refi LTV', summary: 'DSCR Refi Loan:' }
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
        const defaults = LOAN_DEFAULTS[type];
        if (defaults) {
            loanLtvInput.value = defaults.ltv;
            interestRateInput.value = defaults.rate;
            lenderPointsInput.value = defaults.points;
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
        const labels = LOAN_LABELS[type];
        if (labels) {
            ltvLabel.textContent = labels.ltv;
            summaryLeverageLabel.textContent = labels.summary;
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

// Initial render (scripts are deferred, so the DOM is ready here)
if (window.lucide) {
    window.lucide.createIcons(); // static page icons only; dynamic ones use inline SVGs
}
switchStrategy('flip');

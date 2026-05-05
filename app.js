// app.js — UI logic for To Zero debt payoff calculator
// Pure simulation helpers are in simulation.js (loaded before this file)

// ==========================================================
//  STATE
// ==========================================================
let debts          = [];
let extras         = [];
let activeTab      = 'avalanche';
let chart          = null;
let debtId         = 0;
let extraId        = 0;
let updateTimer    = null;
let encodeTimer    = null;
let lastAv         = null;
let lastSb         = null;
let lastIdentical  = false;
let lastValid      = [];
let lastSimKey     = '';
let monthlyBudget  = 0;
let previewAmount  = 50;
let previewFreq    = 'monthly';
let previewHistory = null;
let baselineHistory = null;
let baselineResult  = null;
let baselineAv      = null; // baseline (no extras) under avalanche order
let baselineSb      = null; // baseline (no extras) under snowball order

// Pick the cached strategy result that matches the user's current selection.
const activeResult   = () => activeTab === 'avalanche' ? lastAv : lastSb;
const activeBaseline = () => activeTab === 'avalanche' ? baselineAv : baselineSb;
function syncBaselineToActive() {
  baselineResult  = activeBaseline();
  baselineHistory = baselineResult ? baselineResult.history : null;
}
let showOriginalSchedule = false;
let origScheduleRestored = false;
let revealTimer = null;
let hasEverRevealed = false;
let isFirstRun = true;

const FREQ = {
  daily:       { label: 'Daily',          mult: 365 / 12 },
  weekly:      { label: 'Weekly',         mult: 52 / 12 },
  monthly:     { label: 'Monthly',        mult: 1 },
  quarterly:   { label: 'Every 3 months', mult: 1 / 3 },
  biannually:  { label: 'Every 6 months', mult: 1 / 6 },
  yearly:      { label: 'Yearly',         mult: 1 / 12 },
  one_time:    { label: 'One time',       mult: null },
};

// Formatters, simulation helpers, and calcWarnings are provided by simulation.js (loaded in <head>)

// ==========================================================
//  DEBT TYPE DEFINITIONS
// ==========================================================
const DEBT_TYPES = [
  { value: 'credit_card',   label: 'Credit Card' },
  { value: 'mortgage',      label: 'Mortgage' },
  { value: 'auto',          label: 'Auto Loan' },
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'student_loan',  label: 'Student Loan' },
  { value: 'other',         label: 'Other' },
];

// Types that have a contractual fixed monthly payment — payment field is required
const FIXED_PAYMENT_TYPES = new Set(['mortgage', 'auto', 'personal_loan', 'student_loan']);

// Single source of truth: a debt is "complete" enough to simulate when…
function isDebtComplete(d) {
  if (!(d.balance > 0)) return false;
  if (d.apr === null) return false;
  if (FIXED_PAYMENT_TYPES.has(d.debtType) && !(d.monthlyPayment > 0)) return false;
  // Non-student loans: if either past-due field is filled, both must be
  if (d.debtType !== 'student_loan') {
    const hasMpd = (d.monthsPastDue || 0) > 0;
    const hasPda = (d.pastDueAmount || 0) > 0;
    if (hasMpd !== hasPda) return false;
  }
  return true;
}

// ==========================================================
//  DEBT CARD DOM
// ==========================================================
function makeCard(id) {
  const el = document.createElement('div');
  el.className = 'debt-card';
  el.dataset.id = id;
  const typeOpts = DEBT_TYPES.map(t =>
    `<option value="${t.value}"${t.value === 'credit_card' ? ' selected' : ''}>${t.label}</option>`
  ).join('');
  el.innerHTML = `
    <div class="debt-card-header" data-action="toggle" data-id="${id}">
      <div class="debt-card-header-left">
        <span class="debt-card-name" id="debtLabel-${id}">Debt ${debts.length + 1}</span>
        <div class="debt-card-summary" id="debtSummary-${id}">
          <span class="summary-name" id="summaryName-${id}">Unnamed</span>
          <span class="summary-bal" id="summaryBal-${id}"></span>
        </div>
      </div>
      <div class="debt-card-header-right">
        <button class="btn-remove" id="btnRemove-${id}" data-action="remove-debt" data-id="${id}">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
        <span class="debt-chevron" id="debtChevron-${id}">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
    </div>
    <div class="debt-card-body" id="debtBody-${id}">
      <div class="field-row full">
        <div class="field">
          <label>Type</label>
          <select data-field="debtType" data-id="${id}">${typeOpts}</select>
        </div>
      </div>
      <div class="field-row full">
        <div class="field">
          <label>Name</label>
          <input type="text" placeholder="e.g. Chase Visa" data-field="name" data-id="${id}">
        </div>
      </div>
      <div id="balanceArea-${id}"></div>
      <div id="balanceError-${id}" style="display:none;font-size:12px;color:#b85c2a;margin-top:4px">Please enter a number from 1–10,000,000</div>
      <div class="debt-callout" id="callout-${id}"></div>
      <div id="bottomFields-${id}"></div>
      <div class="more-section" id="moreSection-${id}">
        <button class="more-toggle" data-action="toggle-more" data-id="${id}" type="button">
          <span>More</span>
          <svg class="chevron" width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="more-body">
          <div id="moreBodyContent-${id}"></div>
        </div>
      </div>
      <div class="debt-hint" id="debtHint-${id}">Enter all details to include this debt</div>
    </div>`;
  return el;
}

// ==========================================================
//  TYPE CHANGE
// ==========================================================
function onTypeChange(id) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  const sel = document.querySelector(`[data-field="debtType"][data-id="${id}"]`);
  const newType = sel?.value || 'credit_card';
  debt.debtType = newType;

  if (newType === 'other') {
    debt.apr = null;
    const aprEl = document.querySelector(`[data-field="apr"][data-id="${id}"]`);
    if (aprEl) aprEl.value = '';
  }

  updateCardForType(id, newType);
  updateDebtSummary(id);
  bump();
}

function updateCardForType(id, type) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  const calloutEl      = document.getElementById('callout-' + id);
  const bottomFieldsEl = document.getElementById('bottomFields-' + id);
  if (!calloutEl) return;

  // Drop monthlyPayment from state if switching to a type that doesn't use it
  if (!FIXED_PAYMENT_TYPES.has(type) && debt.monthlyPayment) {
    debt.monthlyPayment = 0;
  }

  // Render balance/APR/payment rows for the chosen type
  renderBalanceArea(id, type, debt);

  // If switching away from student_loan, clear any deferment state
  if (type !== 'student_loan' && debt.deferment) {
    debt.deferment = false;
    debt.defermentUntil = '';
  }

  // Render the body of the "More" section (different content per type)
  renderMoreBody(id, type, debt);

  // Non-student cards get a bit more breathing room above the toggle
  // (and less padding below) since the More body is just past-due fields
  const moreSec = document.getElementById('moreSection-' + id);
  if (moreSec) moreSec.classList.toggle('past-due-only', type !== 'student_loan');

  // Clear bottom slot; repopulate below if needed (student loan toggle)
  if (bottomFieldsEl) bottomFieldsEl.innerHTML = '';

  switch (type) {
    case 'student_loan': {
      const lt = debt.loanType || 'federal';
      const fedTip = 'Federal loans have forgiveness options that can change the math significantly. See studentaid.gov for details.';
      if (bottomFieldsEl) {
        bottomFieldsEl.innerHTML = `
          <div class="plan-toggle" style="margin-top:10px">
            <button class="plan-btn${lt==='federal'?' active':''}" data-action="set-loan-type" data-id="${id}" data-value="federal">Federal <span class="info-tooltip" data-tip="${fedTip}" style="margin-left:4px"><i class="info-icon">i</i></span></button>
            <button class="plan-btn${lt==='private'?' active':''}" data-action="set-loan-type" data-id="${id}" data-value="private">Private</button>
          </div>`;
      }
      calloutEl.className = 'debt-callout';
      calloutEl.innerHTML = '';
      break;
    }
    default:
      calloutEl.className = 'debt-callout';
      calloutEl.innerHTML = '';
  }

  updateCardPlaceholders(id, type);
}

// Paints the balance/APR/payment field rows. For fixed-payment types, balance
// gets its own full-width row and APR + Monthly payment share the next row.
function renderBalanceArea(id, type, debt) {
  const area = document.getElementById('balanceArea-' + id);
  if (!area) return;
  const isFixed = FIXED_PAYMENT_TYPES.has(type);
  const placeholderByType = { mortgage: 'e.g. 1,995', auto: 'e.g. 387', personal_loan: 'e.g. 250', student_loan: 'e.g. 250' };
  const balField = `
    <div class="field">
      <label>Balance owed</label>
      <div class="input-wrap has-prefix">
        <span class="input-prefix">$</span>
        <input type="text" inputmode="decimal" placeholder="5,000" data-field="balance" data-id="${id}" autocomplete="off">
      </div>
    </div>`;
  const aprField = `
    <div class="field">
      <label>APR</label>
      <div class="input-wrap has-suffix">
        <input type="text" inputmode="decimal" placeholder="19.9" data-field="apr" data-id="${id}">
        <span class="input-suffix">%</span>
      </div>
    </div>`;
  const paymentField = `
    <div class="field">
      <label>Monthly payment</label>
      <div class="input-wrap has-prefix">
        <span class="input-prefix">$</span>
        <input type="text" inputmode="decimal" placeholder="${placeholderByType[type] || 'e.g. 250'}" data-field="monthlyPayment" data-id="${id}" autocomplete="off">
      </div>
    </div>`;

  area.innerHTML = isFixed
    ? `<div class="field-row full">${balField}</div>
       <div class="field-row" style="margin-top:10px">${aprField}${paymentField}</div>`
    : `<div class="field-row">${balField}${aprField}</div>`;

  // Restore values from state
  const balEl = area.querySelector('[data-field="balance"]');
  if (balEl && debt.balance) balEl.value = normalizeDollarInput(debt.balance);
  const aprEl = area.querySelector('[data-field="apr"]');
  if (aprEl && debt.apr != null) aprEl.value = debt.apr;
  const mpEl = area.querySelector('[data-field="monthlyPayment"]');
  if (mpEl && debt.monthlyPayment) mpEl.value = normalizeDollarInput(debt.monthlyPayment);
}

// Paints the body of the "More" section. Student loans get the past-due +
// deferment checkbox flow (mutex). Other types show past-due fields directly.
function renderMoreBody(id, type, debt) {
  const slot = document.getElementById('moreBodyContent-' + id);
  if (!slot) return;

  // Toggle label: "Past due?" for non-student loans (only thing in there),
  // "More" for student loans (contains past due + deferment)
  const toggleLabel = document.querySelector(`#moreSection-${id} .more-toggle span`);
  if (toggleLabel) toggleLabel.textContent = type === 'student_loan' ? 'More' : 'Past due?';

  const pastDueFieldsHtml = `
    <div class="field-row">
      <div class="field">
        <label>Months past due</label>
        <input type="number" placeholder="0" data-field="monthsPastDue" data-id="${id}" min="0" step="1">
      </div>
      <div class="field">
        <label>Past due amount</label>
        <div class="input-wrap has-prefix">
          <span class="input-prefix">$</span>
          <input type="text" inputmode="decimal" placeholder="0" data-field="pastDueAmount" data-id="${id}" autocomplete="off">
        </div>
      </div>
    </div>`;

  if (type === 'student_loan') {
    const status = debt.pastDue ? 'pastDue' : (debt.deferment ? 'deferment' : 'current');
    const monthOpts = ['Month','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      .map((label, i) => `<option value="${i === 0 ? '' : String(i).padStart(2, '0')}">${label}</option>`).join('');
    const nowYear = new Date().getFullYear();
    const yearOpts = ['<option value="">Year</option>']
      .concat(Array.from({ length: 2099 - nowYear + 1 }, (_, i) => `<option value="${nowYear + i}">${nowYear + i}</option>`))
      .join('');

    slot.innerHTML = `
      <div class="status-radios">
        <label class="status-radio"><input type="radio" name="studentStatus-${id}" data-field="studentStatus" data-id="${id}" value="current"${status==='current'?' checked':''}><span>Current</span></label>
        <label class="status-radio"><input type="radio" name="studentStatus-${id}" data-field="studentStatus" data-id="${id}" value="pastDue"${status==='pastDue'?' checked':''}><span>Past due</span></label>
        <label class="status-radio"><input type="radio" name="studentStatus-${id}" data-field="studentStatus" data-id="${id}" value="deferment"${status==='deferment'?' checked':''}><span>In deferment</span></label>
      </div>
      <div id="pastDueFields-${id}" style="display:${status==='pastDue'?'':'none'};margin-top:10px">${pastDueFieldsHtml}</div>
      <div id="defermentFields-${id}" style="display:${status==='deferment'?'':'none'};margin-top:10px">
        <div class="field-row deferment-row">
          <div class="field">
            <label>Repayment starts</label>
            <div class="date-picker">
              <select data-field="defermentMonth" data-id="${id}" class="date-month">${monthOpts}</select>
              <select data-field="defermentYear" data-id="${id}" class="date-year">${yearOpts}</select>
            </div>
          </div>
          <div class="field">
            <label>Accruing? <span class="info-tooltip" data-tip="Most loans accrue interest during deferment, which then capitalizes (gets added to principal) when repayment starts. Subsidized federal loans typically don't accrue."><i class="info-icon">i</i></span></label>
            <div class="plan-toggle">
              <button class="plan-btn${debt.defermentAccruing!==false?' active':''}" data-action="set-defer-accruing" data-id="${id}" data-value="1">Yes</button>
              <button class="plan-btn${debt.defermentAccruing===false?' active':''}" data-action="set-defer-accruing" data-id="${id}" data-value="0">No</button>
            </div>
          </div>
        </div>
      </div>`;

    // Restore field values
    if (debt.monthsPastDue) slot.querySelector('[data-field="monthsPastDue"]').value = debt.monthsPastDue;
    if (debt.pastDueAmount) slot.querySelector('[data-field="pastDueAmount"]').value = normalizeDollarInput(debt.pastDueAmount);
    if (debt.defermentUntil) {
      const [y, m] = debt.defermentUntil.split('-');
      slot.querySelector('[data-field="defermentMonth"]').value = m || '';
      slot.querySelector('[data-field="defermentYear"]').value = y || '';
    }
  } else {
    // Non-student loans: past-due fields shown directly, no checkbox
    slot.innerHTML = pastDueFieldsHtml;
    if (debt.monthsPastDue) slot.querySelector('[data-field="monthsPastDue"]').value = debt.monthsPastDue;
    if (debt.pastDueAmount) slot.querySelector('[data-field="pastDueAmount"]').value = normalizeDollarInput(debt.pastDueAmount);
  }
}

function updateCardPlaceholders(id, type) {
  const nameEl = document.querySelector(`[data-field="name"][data-id="${id}"]`);
  const balEl  = document.querySelector(`[data-field="balance"][data-id="${id}"]`);
  const aprEl  = document.querySelector(`[data-field="apr"][data-id="${id}"]`);
  const cfg = {
    credit_card:   { name: 'e.g. Chase Freedom',     bal: '3,500',   apr: '22.9' },
    mortgage:      { name: 'e.g. Wells Fargo home',  bal: '320,000', apr: '7.0'  },
    auto:          { name: 'e.g. Honda Civic',       bal: '18,000',  apr: '6.5'  },
    personal_loan: { name: 'e.g. SoFi personal',     bal: '12,000',  apr: '9.0'  },
    student_loan:  { name: 'e.g. Navient / MOHELA',  bal: '25,000',  apr: '5.5'  },
    other:         { name: 'e.g. Medical bill',      bal: '2,000',   apr: '0'    },
  }[type] || { name: 'e.g. Debt name', bal: '5,000', apr: '0' };
  if (nameEl) nameEl.placeholder = cfg.name;
  if (balEl)  balEl.placeholder  = cfg.bal;
  if (aprEl)  aprEl.placeholder  = cfg.apr;
}

function setStudentStatus(id, status) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  debt.pastDue = status === 'pastDue';
  debt.deferment = status === 'deferment';
  if (!debt.pastDue) { debt.monthsPastDue = 0; debt.pastDueAmount = 0; }
  if (!debt.deferment) { debt.defermentUntil = ''; }
  // Default Accruing? to Yes when deferment is first turned on
  if (debt.deferment && debt.defermentAccruing === undefined) debt.defermentAccruing = true;
  // Default Repayment starts to 6 months from now when first entering deferment
  if (debt.deferment && !debt.defermentUntil) {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    debt.defermentUntil = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  // Reflect state in the DOM
  const pdFields = document.getElementById('pastDueFields-' + id);
  const defFields = document.getElementById('defermentFields-' + id);
  if (pdFields) pdFields.style.display = debt.pastDue ? '' : 'none';
  if (defFields) defFields.style.display = debt.deferment ? '' : 'none';
  if (debt.deferment) {
    const [y, m] = debt.defermentUntil.split('-');
    const monthSel = document.querySelector(`[data-field="defermentMonth"][data-id="${id}"]`);
    const yearSel = document.querySelector(`[data-field="defermentYear"][data-id="${id}"]`);
    if (monthSel) monthSel.value = m || '';
    if (yearSel) yearSel.value = y || '';
  }
  bump();
}

function setDefermentAccruing(id, accruing) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  debt.defermentAccruing = !!accruing;
  document.querySelectorAll(`#defermentFields-${id} .plan-btn`).forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.value === '1') === !!accruing);
  });
  bump();
}

function setStudentLoanType(id, lt) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  debt.loanType = lt;
  document.querySelectorAll(`#bottomFields-${id} .plan-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === lt);
  });
  bump();
}

function addDebt(pre = {}) {
  const id = ++debtId;
  // Map legacy type values to current 6-type system
  let dt = pre.debtType || 'credit_card';
  if (dt === 'card') dt = 'credit_card';
  if (dt === 'loan') dt = 'personal_loan';            // legacy single "loan" bucket
  if (['bnpl','tax'].includes(dt)) dt = 'personal_loan';
  if (dt === 'student_private' || dt === 'student_federal') dt = 'student_loan';
  if (dt === 'medical' || dt === 'collections') dt = 'other';
  const VALID = ['credit_card','mortgage','auto','personal_loan','student_loan','other'];
  if (!VALID.includes(dt)) dt = 'credit_card';

  // Collapse existing cards before adding the new one (so new card stays open)
  if (debts.length > 0) collapseAllDebts();

  debts.push({
    id,
    name:              pre.name || '',
    balance:           +pre.balance || 0,
    apr:               (pre.apr !== undefined && pre.apr !== null) ? +pre.apr : null,
    debtType:          dt,
    loanType:          pre.loanType || 'federal',
    monthlyPayment:    +pre.monthlyPayment || 0,
    pastDue:           !!pre.pastDue,
    monthsPastDue:     +pre.monthsPastDue || 0,
    pastDueAmount:     +pre.pastDueAmount || 0,
    deferment:         !!pre.deferment,
    defermentUntil:    pre.defermentUntil || '',
    defermentAccruing: pre.defermentAccruing !== undefined ? !!pre.defermentAccruing : true,
  });

  const card = makeCard(id);
  document.getElementById('debtsList').appendChild(card);

  if (pre.name) card.querySelector('[data-field="name"]').value = pre.name;
  if (pre.balance) {
    const balEl = card.querySelector('[data-field="balance"]');
    if (balEl) balEl.value = normalizeDollarInput(pre.balance);
  }

  const typeSelect = card.querySelector('[data-field="debtType"]');
  if (typeSelect) typeSelect.value = dt;

  updateCardForType(id, dt);

  if (pre.apr != null) { const a = card.querySelector('[data-field="apr"]'); if (a && !a.disabled) a.value = pre.apr; }

  // Past-due / deferment field restoration is handled by renderMoreBody during updateCardForType

  // Auto-open the More section if past due or deferment was preset
  // (or, for non-student loans, if either inline past-due field has a value)
  const hasInlinePastDue = dt !== 'student_loan' &&
    ((+pre.monthsPastDue || 0) > 0 || (+pre.pastDueAmount || 0) > 0);
  if (pre.pastDue || pre.deferment || hasInlinePastDue) {
    document.getElementById('moreSection-' + id)?.classList.add('open');
  }

  // Hint stays hidden until the user has interacted and clicked off an incomplete card
  const hintEl = document.getElementById('debtHint-' + id);
  const newDebt = debts[debts.length - 1];
  if (hintEl) hintEl.style.display = 'none';

  // Mark the card as "blurred" once focus moves outside it — that's when the hint gets to fire
  card.addEventListener('focusout', e => {
    if (card.contains(e.relatedTarget)) return;
    const debt = debts.find(d => d.id === id);
    if (!debt) return;
    debt._blurred = true;
    const h = document.getElementById('debtHint-' + id);
    if (h) h.style.display = isDebtComplete(debt) ? 'none' : 'block';
  });

  renumber();
  bump();
}


function removeDebt(id) {
  debts = debts.filter(d => d.id !== id);
  document.querySelector(`.debt-card[data-id="${id}"]`)?.remove();
  renumber();
  bump();
}

function renumber() {
  document.querySelectorAll('.debt-card-name').forEach((el, i) => el.textContent = 'Debt ' + (i + 1));
}

const TYPE_LABELS = { credit_card: 'Credit Card', mortgage: 'Mortgage', auto: 'Auto Loan', personal_loan: 'Personal Loan', student_loan: 'Student Loan', other: 'Other' };

function updateDebtSummary(id) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  const nameEl = document.getElementById('summaryName-' + id);
  const balEl  = document.getElementById('summaryBal-' + id);
  if (!nameEl) return;
  nameEl.textContent = debt.name || 'Debt ' + (debts.indexOf(debt) + 1);
  balEl.textContent  = debt.balance ? fmt(debt.balance) : '';
}

function toggleDebt(id) {
  const card    = document.querySelector(`.debt-card[data-id="${id}"]`);
  const body    = document.getElementById('debtBody-' + id);
  const remove  = document.getElementById('btnRemove-' + id);
  if (!card || !body) return;

  const isCollapsed = card.classList.contains('collapsed');
  if (isCollapsed) {
    card.classList.remove('collapsed');
    body.style.display = '';
    if (remove) remove.style.display = '';
  } else {
    updateDebtSummary(id);
    card.classList.add('collapsed');
    body.style.display = 'none';
    if (remove) remove.style.display = 'none';
  }
}

function collapseAllDebts() {
  debts.forEach(d => {
    const card   = document.querySelector(`.debt-card[data-id="${d.id}"]`);
    const body   = document.getElementById('debtBody-' + d.id);
    const remove = document.getElementById('btnRemove-' + d.id);
    if (!card || card.classList.contains('collapsed')) return;
    updateDebtSummary(d.id);
    card.classList.add('collapsed');
    body.style.display = 'none';
    if (remove) remove.style.display = 'none';
  });
}

// Money fields that need comma-formatting
const MONEY_FIELDS = new Set(['balance', 'pastDueAmount', 'monthlyPayment']);

document.getElementById('debtsList').addEventListener('input', e => {
  const el = e.target, id = +el.dataset.id, field = el.dataset.field;
  if (!field || !id) return;
  const debt = debts.find(d => d.id === id);
  if (!debt) return;

  if (field === 'name') {
    debt.name = el.value;
    updateDebtSummary(id);
    refreshExtraTargets();
  } else if (MONEY_FIELDS.has(field)) {
    const pos = el.selectionStart;
    const oldLen = el.value.length;
    el.value = normalizeDollarInput(el.value);
    const newLen = el.value.length;
    try { el.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen)); } catch(_) {}
    const parsed = parseInt(el.value.replace(/,/g, ''), 10) || 0;
    if (field === 'balance') {
      const errEl = document.getElementById('balanceError-' + id);
      if (parsed > 10000000) {
        el.value = el._lastValidBalance || '';
        if (errEl) errEl.style.display = 'block';
        return;
      }
      el._lastValidBalance = el.value;
      if (errEl) errEl.style.display = 'none';
    }
    debt[field] = parsed;
    if (field === 'balance') updateDebtSummary(id);
  } else if (field === 'apr') {
    el.value = normalizeAprInput(el.value);
    debt.apr = el.value.trim() !== '' ? (parseFloat(el.value) || 0) : null;
  } else if (field === 'defermentMonth' || field === 'defermentYear') {
    return; // handled by change delegation (combined into defermentUntil)
  } else {
    debt[field] = parseFloat(el.value) || 0;
  }
  // For non-student loans, derive pastDue boolean from the inline fields
  if (debt.debtType !== 'student_loan' && (field === 'monthsPastDue' || field === 'pastDueAmount')) {
    debt.pastDue = (debt.monthsPastDue || 0) > 0 && (debt.pastDueAmount || 0) > 0;
  }
  bump();
});

// Change delegation for select and checkbox fields on debtsList
document.getElementById('debtsList').addEventListener('change', e => {
  const el = e.target;
  const id = +el.dataset.id;
  const field = el.dataset.field;
  if (!field || !id) return;
  if (field === 'debtType') onTypeChange(id);
  else if (field === 'studentStatus') setStudentStatus(id, el.value);
  else if (field === 'defermentMonth' || field === 'defermentYear') onDefermentDateChange(id);
});

function onDefermentDateChange(id) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  const monthSel = document.querySelector(`[data-field="defermentMonth"][data-id="${id}"]`);
  const yearSel = document.querySelector(`[data-field="defermentYear"][data-id="${id}"]`);
  if (monthSel?.value && yearSel?.value) {
    debt.defermentUntil = `${yearSel.value}-${monthSel.value}`;
  } else {
    debt.defermentUntil = '';
  }
  bump();
}

// Click delegation for debt card actions
document.getElementById('debtsList').addEventListener('click', e => {
  // Remove debt button — check first so it doesn't bubble to toggle
  const removeBtn = e.target.closest('[data-action="remove-debt"]');
  if (removeBtn) { e.stopPropagation(); removeDebt(+removeBtn.dataset.id); return; }

  // Student loan type toggle (skip if click was on the info icon inside the button)
  const loanTypeBtn = e.target.closest('[data-action="set-loan-type"]');
  if (loanTypeBtn) {
    if (e.target.closest('[data-tip]')) return;
    setStudentLoanType(+loanTypeBtn.dataset.id, loanTypeBtn.dataset.value);
    return;
  }

  // Deferment Accruing toggle
  const accBtn = e.target.closest('[data-action="set-defer-accruing"]');
  if (accBtn) { setDefermentAccruing(+accBtn.dataset.id, accBtn.dataset.value === '1'); return; }

  // More section toggle
  const moreBtn = e.target.closest('[data-action="toggle-more"]');
  if (moreBtn) { document.getElementById('moreSection-' + moreBtn.dataset.id)?.classList.toggle('open'); return; }

  // Toggle card open/closed
  const header = e.target.closest('[data-action="toggle"]');
  if (header) { toggleDebt(+header.dataset.id); return; }
});

// Monthly budget input
let _lastValidBudget = '';
document.getElementById('monthlyBudgetInput').addEventListener('input', e => {
  const el = e.target;
  const pos = el.selectionStart;
  const oldLen = el.value.length;
  el.value = normalizeDollarInput(el.value);
  const newLen = el.value.length;
  try { el.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen)); } catch(_) {}
  const parsed = parseInt(el.value.replace(/,/g, ''), 10) || 0;
  const errEl = document.getElementById('budgetError');
  if (parsed > 999999) {
    el.value = _lastValidBudget;
    if (errEl) errEl.style.display = 'block';
  } else {
    _lastValidBudget = el.value;
    if (errEl) errEl.style.display = 'none';
    monthlyBudget = parsed;
    bump();
  }
});

// Extra payment cards
function makeExtraCard(eid) {
  const el = document.createElement('div');
  el.className = 'extra-card';
  el.dataset.eid = eid;
  const ex = extras.find(e => e.eid === eid);
  const targetOptions = buildTargetOptions(ex?.targetId);
  el.innerHTML = `
    <div class="extra-card-header">
      <span class="extra-card-label">Extra payment</span>
      <button class="btn-remove" data-action="remove-extra" data-eid="${eid}">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Amount</label>
        <div class="input-wrap has-prefix">
          <span class="input-prefix">$</span>
          <input type="text" inputmode="decimal" placeholder="100" data-efield="amount" data-eid="${eid}" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label>Frequency</label>
        <select data-efield="freq" data-eid="${eid}">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly" selected>Monthly</option>
          <option value="quarterly">Every 3 months</option>
          <option value="biannually">Every 6 months</option>
          <option value="yearly">Yearly</option>
          <option value="one_time">One time</option>
        </select>
      </div>
    </div>
    <div class="field-row full" style="margin-top:8px">
      <div class="field">
        <label>Apply to</label>
        <select data-efield="targetId" data-eid="${eid}">${targetOptions}</select>
      </div>
    </div>
    <div class="extra-rec" id="rec-${eid}"></div>`;
  return el;
}

function buildTargetOptions(selectedId) {
  const eligible = debts.filter(d => d.balance > 0);
  const opts = [];
  if (eligible.length > 1) opts.push(`<option value="">Whatever is optimal</option>`);
  eligible.forEach(d => {
    const sel = selectedId == d.id ? ' selected' : '';
    opts.push(`<option value="${d.id}"${sel}>${escHtml(d.name) || 'Debt ' + d.id}</option>`);
  });
  return opts.join('');
}

function addExtra(pre = {}) {
  const eid = ++extraId;
  const eligible = debts.filter(d => d.balance > 0);
  const autoTarget = eligible.length === 1 ? eligible[0].id : null;
  const targetId = pre.targetId != null ? pre.targetId : autoTarget;
  extras.push({ eid, amount: +pre.amount || 0, freq: pre.freq || 'monthly', targetId });
  const card = makeExtraCard(eid);
  document.getElementById('extrasList').appendChild(card);
  if (pre.amount) {
    const inp = card.querySelector('[data-efield="amount"]');
    inp.value = normalizeDollarInput(pre.amount);
  }
  if (pre.freq) card.querySelector('[data-efield="freq"]').value = pre.freq;
  if (targetId != null) card.querySelector('[data-efield="targetId"]').value = targetId;
  bump();
}

function removeExtra(eid) {
  extras = extras.filter(e => e.eid !== eid);
  document.querySelector(`.extra-card[data-eid="${eid}"]`)?.remove();
  bump();
}

// Refresh target dropdowns whenever debts change
function refreshExtraTargets() {
  const eligible = debts.filter(d => d.balance > 0);
  document.querySelectorAll('[data-efield="targetId"]').forEach(sel => {
    const eid = +sel.dataset.eid;
    const ex = extras.find(e => e.eid === eid);
    if (!ex) return;
    // Auto-assign the only debt when there's exactly one choice
    if (eligible.length === 1 && !ex.targetId) ex.targetId = eligible[0].id;
    const currentVal = ex.targetId != null ? String(ex.targetId) : '';
    sel.innerHTML = buildTargetOptions(currentVal);
    sel.value = currentVal;
  });
}

// Monthly equivalent for an extra payment
const monthlyEquiv = ex =>
  ex.freq === 'one_time' ? 0 : ex.amount * (FREQ[ex.freq]?.mult ?? 1);

// Total monthly extra split into optimal vs targeted; one-time amounts go in oneTime
function extrasBreakdown() {
  const oneTime  = extras.filter(e => e.freq === 'one_time').reduce((s, e) => s + e.amount, 0);
  const optimal  = extras.filter(e => !e.targetId && e.freq !== 'one_time').reduce((s, e) => s + monthlyEquiv(e), 0);
  const targeted = extras.filter(e =>  e.targetId && e.freq !== 'one_time').map(e => ({ id: e.targetId, amount: monthlyEquiv(e) }));
  return { optimal, oneTime, targeted };
}

// Show/hide recommendation under an extra card
function showRecommendation(eid) {
  const ex = extras.find(e => e.eid === eid);
  const rec = document.getElementById('rec-' + eid);
  if (!ex || !rec) return;

  if (!ex.targetId || ex.amount <= 0) { rec.className = 'extra-rec'; return; }

  const validDebts = debts.filter(d => d.balance > 0 && (d.apr > 0 || d.debtType === 'credit_card') && (!FIXED_PAYMENT_TYPES.has(d.debtType) || d.monthlyPayment > 0));
  if (validDebts.length <= 1) { rec.className = 'extra-rec'; return; }

  const chosenDebt = validDebts.find(d => d.id == ex.targetId);
  if (!chosenDebt) { rec.className = 'extra-rec'; return; }

  // Find optimal target (highest APR = avalanche)
  const optimalDebt = [...validDebts].sort((a, b) => b.apr - a.apr)[0];

  const labelOf = d => d.name || ('Debt ' + (debts.indexOf(d) + 1));
  if (chosenDebt.id === optimalDebt.id) {
    rec.textContent = `Great call. ${labelOf(chosenDebt)} has the highest APR so it costs you the most — targeting it first is the optimal move.`;
    rec.className = 'extra-rec good show';
  } else {
    const aprDiff = (optimalDebt.apr - chosenDebt.apr).toFixed(1);
    rec.innerHTML = `<strong>${escHtml(labelOf(optimalDebt))}</strong> is charging ${optimalDebt.apr.toFixed(1)}% vs ${chosenDebt.apr.toFixed(1)}% — putting this toward that debt first would save more in interest (${aprDiff}% difference).`;
    rec.className = 'extra-rec tip show';
  }
}

// Event delegation for extra cards (input)
document.getElementById('extrasList').addEventListener('input', e => {
  const el = e.target;
  const eid = +el.dataset.eid;
  const field = el.dataset.efield;
  if (!field || !eid) return;
  const ex = extras.find(e => e.eid === eid);
  if (!ex) return;

  if (field === 'amount') {
    const pos = el.selectionStart;
    const oldLen = el.value.length;
    el.value = normalizeDollarInput(el.value);
    const newLen = el.value.length;
    try { el.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen)); } catch(_) {}
    ex.amount = parseInt(el.value.replace(/,/g, ''), 10) || 0;
  } else if (field === 'freq') {
    ex.freq = el.value;
  } else if (field === 'targetId') {
    ex.targetId = el.value || null;
    showRecommendation(eid);
  }
  bump();
});

// Click delegation for extra card actions
document.getElementById('extrasList').addEventListener('click', e => {
  const removeBtn = e.target.closest('[data-action="remove-extra"]');
  if (removeBtn) { removeExtra(+removeBtn.dataset.eid); }
});

document.getElementById('addExtraBtn').addEventListener('click', () => addExtra());

function bump() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(run, 100);
}

// getFloor, strategySort, simulate, firstMonthBreakdown, buildSchedule, calcWarnings
// are all provided by simulation.js (loaded in <head>)

// ==========================================================
//  CHART
// ==========================================================
function toggleOriginalSchedule() {
  showOriginalSchedule = !showOriginalSchedule;
  const btn = document.getElementById('origBtn');
  btn.classList.toggle('active', showOriginalSchedule);
  btn.textContent = showOriginalSchedule ? 'Hide original' : 'Show original';
  document.getElementById('chartLineLegend').style.display = showOriginalSchedule ? '' : 'none';
  updateSavingsCallout();
  if (lastAv && lastSb) drawChart(lastAv, lastSb, lastIdentical);
}

function updateSavingsCallout() {
  const el = document.getElementById('savingsCallout');
  if (!el) return;
  const modalOpen = document.getElementById('extraModal').classList.contains('open');
  const r = activeResult();
  if (!baselineResult || !r || modalOpen) { el.style.display = 'none'; return; }
  const monthsFaster = baselineResult.months - r.months;
  const interestSaved = baselineResult.interest - r.interest;
  // Hide if there's nothing meaningful to celebrate
  if (monthsFaster <= 0 && interestSaved < 1) { el.style.display = 'none'; return; }
  document.getElementById('savingsMonths').textContent = monthsLabel(monthsFaster) + ' sooner';
  document.getElementById('savingsInterest').textContent = fmt(interestSaved) + ' less interest';
  el.style.display = '';
}

// For a payoff line: show dot only at the first $0 point, hide all after; same for line segments
const postZeroPtRadius = (ctx, r) => {
  const y = ctx.parsed.y;
  if (y > 0) return r;
  const firstZero = ctx.dataset.data.findIndex(v => v != null && v <= 0);
  return ctx.dataIndex === firstZero ? r : 0;
};
const postZeroSegment = {
  borderColor: ctx => (ctx.p0.parsed.y <= 0 && ctx.p1.parsed.y <= 0) ? 'transparent' : undefined,
};

// Custom HTML tooltip — shows date, planned balance, original (when shown), and delta
function externalTooltipHandler(context) {
  const { chart, tooltip } = context;
  const el = document.getElementById('chartTooltip');
  if (!el) return;

  if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }

  const dps = tooltip.dataPoints || [];
  if (!dps.length) { el.style.opacity = '0'; return; }

  // Identify series
  const planned  = dps.find(d => d.dataset.label !== 'Original schedule' && d.dataset.label !== 'With extra');
  const original = dps.find(d => d.dataset.label === 'Original schedule');
  const preview  = dps.find(d => d.dataset.label === 'With extra');

  const dateLabel = (planned || original || preview).label;
  const rows = [];

  if (planned) {
    const c = planned.dataset.borderColor;
    rows.push(`<div class="ct-row"><span class="ct-lbl"><span class="ct-dot" style="background:${c}"></span>Planned</span><span class="ct-val">${fmt(planned.parsed.y)}</span></div>`);
  }
  if (preview) {
    rows.push(`<div class="ct-row"><span class="ct-lbl"><span class="ct-dot" style="background:#5a8a6a"></span>With extra</span><span class="ct-val">${fmt(preview.parsed.y)}</span></div>`);
  }
  if (original) {
    rows.push(`<div class="ct-row"><span class="ct-lbl"><span class="ct-dot" style="background:#969188"></span>Original</span><span class="ct-val">${fmt(original.parsed.y)}</span></div>`);
  }

  let deltaHtml = '';
  if (planned && original) {
    const delta = original.parsed.y - planned.parsed.y;
    if (Math.abs(delta) >= 1) {
      const ahead = delta > 0;
      const arrow = ahead ? '↓' : '↑';
      const verb = ahead ? 'ahead of schedule' : 'behind schedule';
      const cls = ahead ? '' : ' behind';
      deltaHtml = `<div class="ct-delta${cls}">${arrow} ${fmt(Math.abs(delta))} ${verb}</div>`;
    }
  }

  el.innerHTML = `<div class="ct-date">${dateLabel}</div>${rows.join('')}${deltaHtml}`;

  const canvas = chart.canvas;
  const pointX = canvas.offsetLeft + tooltip.caretX;
  const top    = canvas.offsetTop  + tooltip.caretY;

  // Keep tooltip inside chart-wrap horizontally; track any shift so the tail
  // can stay anchored over the actual data point.
  const wrapWidth = canvas.parentElement.clientWidth;
  const halfWidth = el.offsetWidth / 2;
  let left = pointX;
  if (left - halfWidth < 4)              left = halfWidth + 4;
  if (left + halfWidth > wrapWidth - 4)  left = wrapWidth - halfWidth - 4;

  el.style.left = left + 'px';
  el.style.top  = top  + 'px';
  el.style.setProperty('--tail-x', `calc(50% + ${pointX - left}px)`);
  el.style.opacity = '1';
}

// Vertical dashed guide line at the hovered x-position
const verticalGuidePlugin = {
  id: 'verticalGuide',
  afterDatasetsDraw(chart) {
    const tt = chart.tooltip;
    if (!tt || tt.opacity === 0 || !tt.dataPoints || tt.dataPoints.length < 2) return;
    const ctx = chart.ctx;
    const x = tt.caretX;
    const { top, bottom } = chart.scales.y;
    ctx.save();
    ctx.strokeStyle = '#c9c0ad';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  }
};

function drawChart(av, sb, identical) {
  // When original schedule is active, extend to show full baseline; otherwise anchor to current payoff
  const len = Math.max(
    av.history.length,
    sb.history.length,
    previewHistory ? previewHistory.length : 0,
    (showOriginalSchedule && baselineHistory) ? baselineHistory.length : 0
  );
  const fullPad = (arr) => { const a = [...arr]; while (a.length < len) a.push(0); return a; };

  // Thin to major intervals so dots appear only at milestones
  const step = len <= 24 ? 3 : len <= 60 ? 6 : 12;
  const indices = [];
  for (let i = 0; i < len; i += step) indices.push(i);
  if (indices[indices.length - 1] !== len - 1) indices.push(len - 1);

  const labels = indices.map(i => i === 0 ? 'Now' : monthsToDate(i));
  const thin = (arr) => { const p = fullPad(arr); return indices.map(i => p[i]); };

  const payoffDataset = (label, data, color, bgColor) => ({
    label, data,
    borderColor: color,
    backgroundColor: bgColor,
    borderWidth: 2.5,
    pointRadius: ctx => postZeroPtRadius(ctx, 3),
    pointHoverRadius: ctx => postZeroPtRadius(ctx, 6),
    pointBackgroundColor: color,
    pointBorderColor: color,
    segment: postZeroSegment,
    tension: 0.42, fill: false,
  });

  // Single "Planned" line using whichever strategy the user has selected.
  // Color matches the strategy chip (orange = avalanche, blue = snowball).
  const isAv = activeTab === 'avalanche';
  const activeColor = isAv ? '#c4824a' : '#4a7a9b';
  const activeBg    = isAv ? 'rgba(196,130,74,0.07)' : 'rgba(74,122,155,0.05)';
  const activeData  = isAv ? av.history : sb.history;
  const datasets = [ payoffDataset('Planned', thin(activeData), activeColor, activeBg) ];
  // Sync the bottom legend's Planned dot to the active strategy
  document.getElementById('cllPlannedDot')?.setAttribute('fill', activeColor);

  // Preview line — faded solid green, only when modal is open
  if (previewHistory) {
    datasets.push({
      label: 'With extra',
      data: thin(previewHistory),
      borderColor: 'rgba(90,138,106,0.4)',
      backgroundColor: 'rgba(90,138,106,0.04)',
      borderWidth: 2.5,
      pointRadius: ctx => postZeroPtRadius(ctx, 2.5),
      pointHoverRadius: ctx => postZeroPtRadius(ctx, 5),
      pointBackgroundColor: 'rgba(90,138,106,0.4)',
      pointBorderColor: 'rgba(90,138,106,0.4)',
      segment: postZeroSegment,
      tension: 0.42, fill: false,
    });
  }

  // Original schedule — faint grey solid, shown when toggled
  if (baselineHistory && showOriginalSchedule) {
    const clipped = baselineHistory.slice(0, len);
    const thinBaseline = (arr) => {
      const padded = [...arr];
      while (padded.length < len) padded.push(null);
      return indices.map(i => i < arr.length ? arr[i] : null);
    };
    datasets.push({
      label: 'Original schedule',
      data: thinBaseline(clipped),
      borderColor: 'rgba(150,145,138,0.45)',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [],
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBackgroundColor: 'rgba(150,145,138,0.45)',
      pointBorderColor: 'rgba(150,145,138,0.45)',
      tension: 0.42, fill: false,
    });
  }

  const data = { labels, datasets };

  if (chart) {
    chart.data = data;
    chart.update('none');
    return;
  }

  chart = new Chart(document.getElementById('payoffChart').getContext('2d'), {
    type: 'line', data,
    plugins: [verticalGuidePlugin],
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: document.documentElement.classList.contains('has-data')
        ? false
        : { duration: 900, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          position: 'nearest',
          external: externalTooltipHandler,
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: '#e8e0d0' },
          offset: true,
          ticks: { color: '#7a6e65', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }
        },
        y: {
          grid: { color: 'rgba(232,224,208,0.5)', drawTicks: false },
          border: { display: false },
          ticks: {
            color: '#7a6e65', font: { size: 10 }, maxTicksLimit: 5,
            callback: v => v >= 1000 ? '$' + (v/1000).toFixed(0) + 'k' : '$' + v
          }
        }
      }
    }
  });
}

// ==========================================================
//  RENDER SUMMARY
// ==========================================================
function renderSummary() {
  if (!lastAv || !lastSb) return;
  const r = activeTab === 'avalanche' ? lastAv : lastSb;
  const o = activeTab === 'avalanche' ? lastSb  : lastAv;
  const totalDebt = debts.filter(d => d.balance > 0).reduce((s, d) => s + d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0), 0);
  const saved = o.interest - r.interest;
  const faster = o.months - r.months;

  document.getElementById('summaryArea').innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="s-label">Debt-free by</div>
        <div class="s-value c-green" style="font-size:1.05rem;line-height:1.2">${r.freeDate}</div>
        <div class="s-sub">${monthsLabel(r.months)} from now</div>
      </div>
      <div class="summary-card">
        <div class="s-label">Total interest</div>
        <div class="s-value c-burgundy">${fmt(r.interest)}</div>
        <div class="s-sub">on top of ${fmt(totalDebt)}</div>
      </div>
      <div class="summary-card">
        <div class="s-label">Total you'll pay</div>
        <div class="s-value">${fmt(r.totalPaid)}</div>
        <div class="s-sub">principal + interest</div>
      </div>
    </div>`;
}

// ==========================================================
//  RENDER BREAKDOWN
// ==========================================================
function renderBreakdown() {
  const r = activeTab === 'avalanche' ? lastAv : lastSb;
  if (!r) return;
  const sorted = [...r.breakdown];
  strategySort(sorted, activeTab);

  // Map extra amounts onto debt rows: targeted → that debt; optimal → first priority debt
  const activeExtras = extras.filter(e => e.amount > 0);
  const extraByDebt  = {}; // debtId → array of extra labels
  activeExtras.forEach(e => {
    const isOneTime = e.freq === 'one_time';
    const monthly   = monthlyEquiv(e);
    const label     = isOneTime
      ? `+${fmt(e.amount)} one-time`
      : `+${fmtDec(monthly)}/mo extra`;
    const targetId  = e.targetId
      ? String(e.targetId)
      : sorted.length ? String(sorted[0].id) : null;
    if (targetId) {
      if (!extraByDebt[targetId]) extraByDebt[targetId] = [];
      extraByDebt[targetId].push(label);
    }
  });

  // Build a floor lookup from the source debts
  const floorById = {};
  (lastValid || []).forEach(src => { floorById[src.id] = getFloorFromSource(src); });

  const debtRows = sorted.map(d => {
    const pos = sorted.indexOf(d);
    const posLabel = pos === 0 ? 'first' : pos === 1 ? 'second' : `#${pos + 1}`;
    const badge = d.monthsPastDue >= 3
      ? `<span class="priority-badge urgent">Paying ${posLabel} · 3+ mo past due</span>`
      : d.monthsPastDue >= 1
      ? `<span class="priority-badge overdue">Paying ${posLabel} · past due</span>`
      : '';
    const extraLabels = extraByDebt[String(d.id)] || [];
    const floor = floorById[d.id] || 0;
    const surplus = d.payment - floor;
    const isMinOnly = surplus <= 1;
    const extraBadge  = (!isMinOnly) ? extraLabels.map(l =>
      `<span class="extra-badge">${l}</span>`
    ).join('') : '';
    const minBadge = isMinOnly ? `<span class="min-badge">Min. payment</span>` : '';
    const surplusBadge = (surplus > 1 && extraLabels.length === 0)
      ? `<span class="extra-badge">+${fmtDec(surplus)}/mo extra</span>`
      : '';
    const hasInterest = d.monthlyInterest > 0.01 && d.payment > 0;
    const piLine = hasInterest
      ? `<div class="pi-labels">${fmtDec(d.principal)} principal &middot; <span class="pi-i">${fmtDec(d.monthlyInterest)} interest</span></div>`
      : '';
    const pastDueLine = d.pastDueAmount > 0
      ? `<div class="pi-labels" style="color:#b94a3a">Includes ${fmt(d.pastDueAmount)} past due balance</div>`
      : '';
    return `
      <div class="breakdown-row">
        <div class="breakdown-name">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:1.4em">${escHtml(d.name) || 'Debt ' + (debts.findIndex(x => x.id === d.id) + 1 || '')}${badge}${minBadge}${surplusBadge}${extraBadge}</div>
          <small>${d.apr.toFixed(1)}% APR &middot; ${fmt(d.balance)} balance</small>
        </div>
        <div class="breakdown-right">
          <div class="breakdown-amount">${fmtDec(d.payment)}/mo</div>
          ${piLine}
          ${pastDueLine}
        </div>
      </div>`;
  }).join('');

  document.getElementById('breakdownList').innerHTML = debtRows;
}

// ==========================================================
//  RENDER WARNINGS  (logic lives in calcWarnings in simulation.js)
// ==========================================================
function renderWarnings(valid, sim) {
  const panel = document.getElementById('warningsPanel');
  if (!panel) return;

  const raw = calcWarnings(valid, sim, monthlyBudget);
  if (!raw.length) { panel.style.display = 'none'; return; }

  const dangerIcon  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;margin-top:3px"><circle cx="7" cy="7" r="6.5" stroke="#8b3428" stroke-width="1.3"/><path d="M7 4v3.5" stroke="#8b3428" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="10" r="0.75" fill="#8b3428"/></svg>`;
  const cautionIcon = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;margin-top:3px"><circle cx="7" cy="7" r="6.5" stroke="#7a4a20" stroke-width="1.3"/><path d="M7 4v3.5" stroke="#7a4a20" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="10" r="0.75" fill="#7a4a20"/></svg>`;

  const htmlItems = raw.map(w => {
    if (w.type === 'budget-too-low') {
      const msg = w.hasPastDue
        ? `Your monthly commitment may not be enough to cover minimums and catch up on past due balances. You need at least <strong>${fmt(w.minNeeded)}/mo</strong>.`
        : `Your monthly commitment doesn't cover the minimum payments on all your debts. You need at least <strong>${fmt(w.minNeeded)}/mo</strong> to avoid falling behind.`;
      return `<div class="warning-item danger" style="display:flex;align-items:flex-start;gap:8px">${dangerIcon}<span>${msg}</span></div>`;
    }
    if (w.type === 'no-payoff') {
      return `<div class="warning-item danger" style="display:flex;align-items:flex-start;gap:8px">${dangerIcon}<span><strong>No payoff date found.</strong> We couldn't calculate when you'll be debt-free with your current budget. Try increasing your monthly budget.</span></div>`;
    }
    if (w.type === 'federal-loan-high-apr') {
      return `<div class="warning-item caution" style="display:flex;align-items:flex-start;gap:8px">${cautionIcon}<span><strong>${escHtml(w.label)}</strong>: ${w.apr.toFixed(1)}% APR is high for a federal student loan. Double-check your rate — federal loans are typically below 8%.</span></div>`;
    }
    if (w.type === 'payment-below-interest') {
      return `<div class="warning-item danger" style="display:flex;align-items:flex-start;gap:8px">${dangerIcon}<span><strong>${escHtml(w.label)}</strong>: monthly payment of ${fmt(w.payment)} doesn't cover the ${fmt(w.interest)} of interest accruing each month. The balance will grow, not shrink.</span></div>`;
    }
    return '';
  }).filter(Boolean);

  panel.style.display = '';
  panel.innerHTML = htmlItems.join('');
}

function renderPayoffTimeline() {
  const card = document.getElementById('payoffTimelineCard');
  const list = document.getElementById('payoffTimelineList');
  if (!card || !list) return;
  const r = activeTab === 'avalanche' ? lastAv : lastSb;
  if (!r || !r.debtPayoffs || !r.debtPayoffs.length) { card.style.display = 'none'; return; }

  // Sort by payoff month ascending
  const sorted = [...r.debtPayoffs].sort((a, b) => a.month - b.month);

  list.innerHTML = sorted.map((d, i) => {
    const col = i === 0 ? 'var(--green)' : i === sorted.length - 1 ? 'var(--avalanche)' : 'var(--snowball)';
    return `
      <div class="payoff-row">
        <div class="payoff-dot" style="background:${col}"></div>
        <div class="payoff-name">${escHtml(d.name) || 'Debt ' + (debts.findIndex(x => x.id === d.id) + 1 || '')}</div>
        <div class="payoff-date"><strong>${monthsLabel(d.month)}</strong> from now · ${monthsToDate(d.month)}</div>
      </div>`;
  }).join('');

  // Keep schedule link pointing at current state
  const schedLink = document.getElementById('scheduleLink');
  if (schedLink) schedLink.href = 'amortization.html' + location.hash;

  card.style.display = '';
}

// ==========================================================
//  EXTRA PAYMENT PREVIEW MODAL
// ==========================================================
function isMobileViewport() {
  return window.matchMedia('(max-width: 600px)').matches;
}

function anchorChartToTopbar() {
  const card = document.querySelector('.chart-card');
  if (!card) return;
  const body = document.scrollingElement || document.documentElement;
  // Wait for the modal to finish opening so we can measure its height
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const modal = document.getElementById('extraModal');
    const header = document.querySelector('header');
    const headerH = header ? header.getBoundingClientRect().height : 56;
    const modalH = modal ? modal.getBoundingClientRect().height : 0;
    const cardRect = card.getBoundingClientRect();
    const visibleTop = headerH + 8;
    const visibleBottom = window.innerHeight - modalH - 8;
    const visibleHeight = visibleBottom - visibleTop;
    // If the chart fits, center it in the visible area; otherwise pin its top.
    const offset = cardRect.height <= visibleHeight
      ? visibleTop + (visibleHeight - cardRect.height) / 2
      : visibleTop;
    const target = Math.max(0, body.scrollTop + cardRect.top - offset);
    window.scrollTo({ top: target, behavior: 'smooth' });
  }));
}

// Portal slot — remembers where the modal originally lived so we can put it back
let _modalOrigParent = null;
let _modalOrigNext = null;

function portalModalToBody() {
  const modal = document.getElementById('extraModal');
  if (!modal || modal.parentElement === document.body) return;
  _modalOrigParent = modal.parentElement;
  _modalOrigNext = modal.nextSibling;
  document.body.appendChild(modal);
  // Move backdrop too so it sits above other body content but below the sheet
  const back = document.getElementById('sheetBackdrop');
  if (back && back.parentElement !== document.body) {
    document.body.appendChild(back);
  }
}

function unportalModal() {
  const modal = document.getElementById('extraModal');
  if (!modal || !_modalOrigParent) return;
  if (_modalOrigNext) _modalOrigParent.insertBefore(modal, _modalOrigNext);
  else _modalOrigParent.appendChild(modal);
  _modalOrigParent = null;
  _modalOrigNext = null;
}

function openExtraModal() {
  if (isMobileViewport()) portalModalToBody();
  document.getElementById('extraModal').classList.add('open');
  document.getElementById('sheetBackdrop')?.classList.add('open');
  document.getElementById('extraBtn').classList.add('active');
  document.getElementById('savingsCallout').style.display = 'none';
  // Sync inputs to current state
  document.getElementById('emInput').value = normalizeDollarInput(previewAmount);
  document.getElementById('emSlider').value = Math.min(previewAmount, 500);
  document.getElementById('emFreq').value = previewFreq;
  updatePreview();
  if (isMobileViewport()) anchorChartToTopbar();
  setTimeout(() => document.addEventListener('mousedown', outsideClickClose), 0);
}

function closeExtraModal() {
  const modal = document.getElementById('extraModal');
  modal.classList.remove('open', 'has-insight');
  document.getElementById('sheetBackdrop')?.classList.remove('open');
  document.getElementById('extraBtn').classList.remove('active');
  document.getElementById('emInsight').style.display = 'none';
  document.getElementById('previewCallout').style.display = 'none';
  document.removeEventListener('mousedown', outsideClickClose);
  previewHistory = null;
  if (lastAv && lastSb) drawChart(lastAv, lastSb, lastIdentical);
  updateSavingsCallout();
  // Wait for slide-out before moving back
  setTimeout(unportalModal, 380);
}

function outsideClickClose(e) {
  const modal = document.getElementById('extraModal');
  const btn   = document.getElementById('extraBtn');
  if (!modal.contains(e.target) && !btn.contains(e.target)) closeExtraModal();
}

function updatePreview() {
  if (!lastAv || !lastValid.length) return;
  const isOneTime  = previewFreq === 'one_time';
  const mult       = isOneTime ? 0 : (FREQ[previewFreq]?.mult ?? 1);
  const monthlyAmt = previewAmount * mult;
  const insight  = document.getElementById('emInsight');
  const callout  = document.getElementById('previewCallout');
  if (previewAmount <= 0) {
    previewHistory = null;
    insight.style.display = 'none';
    document.getElementById('extraModal').classList.remove('has-insight');
    callout.style.display = 'none';
    drawChart(lastAv, lastSb, lastIdentical);
    return;
  }
  const eb = extrasBreakdown();
  const pr = simulate(lastValid, {
    optimal: eb.optimal + monthlyAmt,
    oneTime: (eb.oneTime || 0) + (isOneTime ? previewAmount : 0),
    targeted: eb.targeted,
  }, activeTab, monthlyBudget);
  previewHistory = pr ? pr.history : null;

  // Insight inside modal — compare against the user's currently selected strategy
  const baselineForPreview = activeResult();
  if (pr && baselineForPreview) {
    const diffMo  = baselineForPreview.months - pr.months;
    const diffInt = baselineForPreview.interest - pr.interest;
    const modal = document.getElementById('extraModal');
    if (diffMo > 0 || diffInt > 0.5) {
      const parts = [];
      if (diffMo  > 0)   parts.push(monthsLabel(diffMo) + ' sooner');
      if (diffInt > 0.5) parts.push(fmt(diffInt) + ' saved in interest');
      const text = parts.join(' · ');
      insight.textContent = text;
      insight.style.display = '';
      modal.classList.add('has-insight');
      callout.style.display = 'none';
    } else {
      insight.style.display = 'none';
      modal.classList.remove('has-insight');
      callout.style.display = 'none';
    }
  }

  drawChart(lastAv, lastSb, lastIdentical);
}

function commitExtra() {
  if (previewAmount <= 0) { closeExtraModal(); return; }
  const isFirst = extras.every(e => e.amount <= 0);
  addExtra({ amount: previewAmount, freq: previewFreq, targetId: null });
  previewHistory = null;
  document.getElementById('extraModal').classList.remove('open', 'has-insight');
  document.getElementById('sheetBackdrop')?.classList.remove('open');
  document.getElementById('extraBtn').classList.remove('active');
  document.getElementById('emInsight').style.display = 'none';
  document.getElementById('previewCallout').style.display = 'none';
  document.removeEventListener('mousedown', outsideClickClose);
  run();
  if (isFirst && baselineResult && !showOriginalSchedule && !origScheduleRestored) toggleOriginalSchedule();
}

// ==========================================================
//  TAB TOGGLE
// ==========================================================
function setTab(tab) {
  activeTab = tab;
  document.getElementById('tabAv').className = 'tab-btn' + (tab === 'avalanche' ? ' is-active' : '');
  document.getElementById('tabSb').className = 'tab-btn' + (tab === 'snowball'  ? ' is-active' : '');
  document.getElementById('tabThumb')?.classList.toggle('is-right', tab === 'snowball');
  encodeUrl(); // persist strategy to hash so amortization link stays in sync
  // The baseline (no-extras) and savings comparison should follow the active strategy
  syncBaselineToActive();
  renderSummary();
  renderBreakdown();
  renderPayoffTimeline();
  updateSavingsCallout();
  // Recolor the chart's Planned line + the bottom legend dot to match the new strategy
  if (lastAv && lastSb) drawChart(lastAv, lastSb, lastIdentical);
}

// ==========================================================
//  MAIN RUN
// ==========================================================
function renderRecoveryNotice(missing) {
  const both = missing.length > 1;
  const title = both ? 'Almost there —' : 'One thing missing';
  const items = missing.map((m, i) =>
    `<li class="recovery-item" style="animation-delay:${i * 80}ms">
      <span class="recovery-dot"></span>
      <span>${escHtml(m.label)}</span>
    </li>`
  ).join('');
  return `<div class="recovery">
    <div class="recovery-icon" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="32" height="32">
        <circle cx="16" cy="16" r="13" fill="none" stroke="#C49A4F" stroke-width="1.6"/>
        <path d="M16,9 L16,17" stroke="#C49A4F" stroke-width="2" stroke-linecap="round"/>
        <circle cx="16" cy="21" r="1.4" fill="#C49A4F"/>
      </svg>
    </div>
    <div class="recovery-body">
      <div class="recovery-title">${escHtml(title)}</div>
      <ul class="recovery-list">${items}</ul>
    </div>
  </div>`;
}

function run() {
  const valid = debts.filter(isDebtComplete);
  const hasData = valid.length > 0 && monthlyBudget > 0;
  refreshExtraTargets();

  // Update animated checklist
  const emptyEl = document.getElementById('emptyState');
  const resultsEl = document.getElementById('results');
  const recoveryBlock = document.getElementById('recoveryBlock');
  document.getElementById('checkBudget')?.classList.toggle('cl-done', monthlyBudget > 0);
  document.getElementById('checkDebts')?.classList.toggle('cl-done', valid.length > 0);

  // Update hint chips
  const hintBudget = document.getElementById('hintBudget');
  const hintDebts  = document.getElementById('hintDebts');
  if (hintBudget && monthlyBudget > 0) {
    let budgetLabel;
    if (monthlyBudget < 1000)         budgetLabel = '$' + monthlyBudget + ' / mo';
    else if (monthlyBudget < 1000000) budgetLabel = '$' + Math.floor(monthlyBudget / 1000) + 'k / mo';
    else                              budgetLabel = '$' + Math.floor(monthlyBudget / 1000000) + 'M / mo';
    hintBudget.textContent = budgetLabel;
  }
  if (hintDebts && valid.length > 0) {
    const totalBal = valid.reduce((s, d) => s + d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0), 0);
    hintDebts.textContent = valid.length + ' added · ' + fmt(totalBal);
  }

  // Show/hide the first-run CTA button
  const calcBtn = document.getElementById('calcBtn');
  if (calcBtn && !hasEverRevealed && !isFirstRun) {
    calcBtn.style.display = hasData ? 'inline-flex' : 'none';
  }

  // Always update hints regardless of hasData
  debts.forEach(d => {
    const hintEl = document.getElementById('debtHint-' + d.id);
    if (!hintEl) return;
    // Only nag once the user has tabbed/clicked off an incomplete card
    hintEl.style.display = (isDebtComplete(d) || !d._blurred) ? 'none' : 'block';
  });

  if (!hasData) {
    if (!hasEverRevealed) {
      // Haven't revealed yet — retreat to empty state
      clearTimeout(revealTimer);
      emptyEl.classList.remove('is-leaving');
      resultsEl.classList.remove('is-entering');
      return;
    }
    // Already revealed — collapse results and show recovery notice so the
    // right panel resizes back to its natural (empty-state) height.
    const missing = [];
    if (monthlyBudget <= 0) missing.push({ id: 'commit', label: 'Add a monthly commitment to see your plan.' });
    if (valid.length === 0) missing.push({ id: 'debts', label: 'Fill in every field for at least one debt.' });

    if (recoveryBlock) {
      const key = missing.map(m => m.id).join(',');
      if (recoveryBlock.dataset.key !== key) {
        recoveryBlock.dataset.key = key;
        recoveryBlock.innerHTML = renderRecoveryNotice(missing);
      }
      recoveryBlock.classList.add('is-shown');
    }
    resultsEl.classList.remove('is-entering');
    return;
  }

  // Data is valid — hide recovery, show chart
  if (recoveryBlock) recoveryBlock.classList.remove('is-shown');

  if (!hasEverRevealed) {
    if (isFirstRun) {
      // Page loaded with existing URL data — reveal immediately, no animation
      emptyEl.classList.add('is-leaving');
      resultsEl.classList.add('is-entering');
      hasEverRevealed = true;
      updateShareBtn();
    }
    // Otherwise wait for the explicit "See my path to zero" button click
  } else {
    // Already revealed before (recovery → chart) — immediate
    emptyEl.classList.add('is-leaving');
    resultsEl.classList.add('is-entering');
  }

  // Track first time results appear in this session
  if (!window._trackedDebtEntered) {
    window._trackedDebtEntered = true;
    trackEvent('debt-entered');
  }

  const eb = extrasBreakdown();
  lastValid = valid;

  // Only re-simulate when inputs actually changed
  const simKey = JSON.stringify({
    v: valid.map(d => [d.id, d.name, d.balance, d.apr, d.debtType, d.pastDue, d.pastDueAmount, d.monthsPastDue]),
    eb, mb: monthlyBudget,
  });
  if (simKey !== lastSimKey) {
    lastAv = simulate(valid, eb, 'avalanche', monthlyBudget);
    lastSb = simulate(valid, eb, 'snowball',  monthlyBudget);
    const hasExtras = eb.optimal > 0 || eb.oneTime > 0 || eb.targeted.length > 0;
    const blank = { optimal: 0, oneTime: 0, targeted: [] };
    baselineAv = hasExtras ? simulate(valid, blank, 'avalanche', monthlyBudget) : null;
    baselineSb = hasExtras ? simulate(valid, blank, 'snowball',  monthlyBudget) : null;
    lastSimKey = simKey;
  }
  syncBaselineToActive();
  if (!lastAv || !lastSb) return;

  // When the two strategies yield the same result, hide the selector entirely
  // (instead of showing a disabled toggle with a note).
  const identical = lastAv.months === lastSb.months && Math.abs(lastAv.interest - lastSb.interest) < 1;
  lastIdentical = identical;
  const tabsSection = document.getElementById('tabsSection');
  if (tabsSection) tabsSection.style.display = identical ? 'none' : '';
  const origBtn = document.getElementById('origBtn');
  if (origBtn) origBtn.style.display = baselineHistory ? 'flex' : 'none';
  // Top-right Avalanche/Snowball legend is obsolete now that the chart shows a single Planned line
  const legend = document.getElementById('chartLegend');
  if (legend) legend.style.display = 'none';

  // Chart subtitle
  const total = valid.reduce((s, d) => s + d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0), 0);
  document.getElementById('chartSubtitle').textContent = `Starting from ${fmt(total)} total`;

  drawChart(lastAv, lastSb, identical);
  updateSavingsCallout();
  if (document.getElementById('extraModal').classList.contains('open')) updatePreview();
  renderSummary();
  renderBreakdown();
  renderPayoffTimeline();
  renderWarnings(valid, lastAv);

  // Debounce URL encoding — visual state doesn't need it immediately
  clearTimeout(encodeTimer);
  encodeTimer = setTimeout(encodeUrl, 500);

  isFirstRun = false;
}

// ==========================================================
//  URL ENCODING
// ==========================================================
function encodeUrl() {
  try {
    const state = {
      v: 4,
      mb: monthlyBudget,
      d: debts.map(d => ({
        n: d.name,
        b: d.balance,
        a: d.apr,
        t: d.debtType,
        lt: d.loanType || '',
        mp: d.monthlyPayment || 0,
        pd: d.pastDue ? 1 : 0,
        mpd: d.monthsPastDue || 0,
        pda: d.pastDueAmount || 0,
        df: d.deferment ? 1 : 0,
        du: d.defermentUntil || '',
        da: d.defermentAccruing ? 1 : 0,
      })),
      e: extras.map(e => [e.amount, e.freq, e.targetId || '']),
    };
    const enc = btoa(JSON.stringify(state));
    const stratPart = activeTab === 'snowball' ? '&s=snowball' : '';
    const origPart  = showOriginalSchedule ? '&o=1' : '&o=0';
    history.replaceState(null, '', location.pathname + '#p=' + enc + stratPart + origPart);
    const schedLink = document.getElementById('scheduleLink');
    if (schedLink) schedLink.href = 'amortization.html' + location.hash;
  } catch (_) {}
}

function decodeUrl() {
  const hash = location.hash.slice(1); // strip leading #
  // URLSearchParams decodes + as space which breaks base64 — use regex instead
  const pm = hash.match(/(?:^|&)p=([^&]+)/);
  const p = pm ? pm[1] : null;
  if (!p) return false;
  try {
    const s = JSON.parse(atob(p));

    if (s.v === 4) {
      monthlyBudget = s.mb || 0;
      if (Array.isArray(s.d)) s.d.forEach(d => addDebt({
        name: d.n, balance: d.b, apr: d.a,
        debtType: d.t, loanType: d.lt || 'federal',
        monthlyPayment: +d.mp || 0,
        pastDue: !!d.pd, monthsPastDue: d.mpd || 0, pastDueAmount: d.pda || 0,
        deferment: !!d.df, defermentUntil: d.du || '',
        defermentAccruing: d.da === undefined ? true : !!d.da,
      }));
    } else if (s.v === 3) {
      // Legacy v3 had per-debt minPayment — sum them to reconstruct budget
      monthlyBudget = Array.isArray(s.d) ? s.d.reduce((sum, d) => sum + (+d.m || 0), 0) : 0;
      if (Array.isArray(s.d)) s.d.forEach(d => addDebt({
        name: d.n, balance: d.b, apr: d.a,
        debtType: d.t, useMinimum: !!d.u, loanType: d.lt || 'federal',
        pastDue: !!d.pd, monthsPastDue: d.mpd || 0, pastDueAmount: d.pda || 0,
      }));
    } else if (s.v === 2) {
      monthlyBudget = Array.isArray(s.d) ? s.d.reduce((sum, d) => sum + (+d.m || 0), 0) : 0;
      if (Array.isArray(s.d)) s.d.forEach(d => addDebt({
        name: d.n, balance: d.b, apr: d.a,
        debtType: d.t, loanType: d.lt || 'federal',
      }));
    } else if (Array.isArray(s.d)) {
      // Legacy v1 format (array-of-arrays)
      monthlyBudget = s.d.reduce((sum, d) => sum + (+d[3] || 0), 0);
      s.d.forEach(d => addDebt({
        name: d[0], balance: d[1], apr: d[2],
        debtType: d[4] || 'credit_card',
      }));
    }

    if (Array.isArray(s.e)) s.e.forEach(e => addExtra({ amount: e[0], freq: e[1], targetId: e[2] || null }));

    // Restore budget input
    if (monthlyBudget > 0) {
      const bi = document.getElementById('monthlyBudgetInput');
      if (bi) bi.value = normalizeDollarInput(monthlyBudget);
    }

    // Restore strategy (use regex to avoid URLSearchParams + → space corruption)
    const sm = hash.match(/(?:^|&)s=([^&]+)/);
    const strat = sm ? sm[1] : null;
    if (strat === 'snowball') {
      activeTab = 'snowball';
      document.getElementById('tabAv').className = 'tab-btn';
      document.getElementById('tabSb').className = 'tab-btn is-active';
      document.getElementById('tabThumb')?.classList.add('is-right');
    }

    // Restore "show original" toggle
    const origParam = new URLSearchParams(hash).get('o');
    if (origParam !== null) {
      origScheduleRestored = true;
      showOriginalSchedule = origParam === '1';
      const btn = document.getElementById('origBtn');
      if (btn) {
        btn.classList.toggle('active', showOriginalSchedule);
        btn.textContent = showOriginalSchedule ? 'Hide original' : 'Show original';
      }
      const leg = document.getElementById('chartLineLegend');
      if (leg) leg.style.display = showOriginalSchedule ? '' : 'none';
    }

    return true;
  } catch (_) { return false; }
}

// ==========================================================
//  SHARE
// ==========================================================
function updateShareBtn() {
  const btn = document.getElementById('headerShareBtn');
  if (!btn) return;
  btn.classList.toggle('is-locked', !hasEverRevealed);
}

function shareUrl() {
  if (!hasEverRevealed) {
    const toast = document.getElementById('shareLockToast');
    if (toast) {
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
    return;
  }
  trackEvent('share-click');
  encodeUrl();
  // Build a /plan?p=... URL so iMessage/Slack get the custom OG preview,
  // then plan.html redirects the browser back to the main app with the hash.
  const hash   = location.hash.slice(1); // strip leading #
  const params = new URLSearchParams(hash);
  const p = params.get('p');
  const s = params.get('s');
  let url = location.origin + '/plan?p=' + encodeURIComponent(p || '');
  if (s) url += '&s=' + encodeURIComponent(s);
  const btn   = document.getElementById('headerShareBtn');
  const toast = document.getElementById('shareToast');
  const copied = () => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    toast.classList.add('show');
    setTimeout(() => {
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M9.5 1.5L12.5 4.5L9.5 7.5M12.5 4.5H5C3.6 4.5 2.5 5.6 2.5 7v5.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Share my plan`;
      btn.classList.remove('copied');
      toast.classList.remove('show');
    }, 3000);
  };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(copied).catch(() => fallbackCopy(url, copied));
  else fallbackCopy(url, copied);
}

function fallbackCopy(text, cb) {
  const el = Object.assign(document.createElement('input'), { value: text, style: 'position:fixed;opacity:0' });
  document.body.appendChild(el); el.select();
  try { document.execCommand('copy'); cb(); } catch (_) {}
  document.body.removeChild(el);
}

// ==========================================================
//  ANALYTICS (GoatCounter)
// ==========================================================
function trackEvent(name) {
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path: name, title: name, event: true });
  }
}

function initAnalytics() {
  if (location.hash.startsWith('#p=')) {
    trackEvent('shared-plan-view');
  }
  if (localStorage.getItem('tz_visited')) {
    trackEvent('return-visit');
  } else {
    localStorage.setItem('tz_visited', '1');
  }
}

window.addEventListener('load', initAnalytics);

// ==========================================================
//  TOOLTIP
// ==========================================================
function showInfoTooltip(el, text) {
  const t = document.getElementById('infoTooltip');
  t.textContent = text;
  t.style.display = 'block';
  const rect = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 256));
  t.style.left = left + 'px';
  t.style.top = (rect.top - t.offsetHeight - 8) + 'px';
}
function hideInfoTooltip() {
  document.getElementById('infoTooltip').style.display = 'none';
}

document.addEventListener('mouseover', e => {
  const tipEl = e.target.closest('[data-tip]');
  if (tipEl) { showInfoTooltip(tipEl, tipEl.dataset.tip); return; }
  const dynEl = e.target.closest('[data-tip-id]');
  if (dynEl) { showInfoTooltip(dynEl, window._pmtWarnText?.[+dynEl.dataset.tipId] || ''); }
});
document.addEventListener('mouseout', e => {
  const tipEl = e.target.closest('[data-tip],[data-tip-id]');
  if (tipEl && (!e.relatedTarget || !tipEl.contains(e.relatedTarget))) hideInfoTooltip();
});

// ==========================================================
//  STATIC BUTTON LISTENERS
// ==========================================================
document.getElementById('headerShareBtn').addEventListener('click', shareUrl);
document.getElementById('tabAv').addEventListener('click', e => {
  if (e.target.closest('[data-tip]')) return;
  setTab('avalanche');
});
document.getElementById('tabSb').addEventListener('click', e => {
  if (e.target.closest('[data-tip]')) return;
  setTab('snowball');
});

// Extra payment preview modal
document.getElementById('extraBtn').addEventListener('click', () => {
  if (!lastAv) return;
  if (document.getElementById('extraModal').classList.contains('open')) closeExtraModal();
  else openExtraModal();
});
document.getElementById('emSlider').addEventListener('input', () => {
  previewAmount = +document.getElementById('emSlider').value;
  document.getElementById('emInput').value = normalizeDollarInput(previewAmount);
  updatePreview();
});
document.getElementById('emInput').addEventListener('input', () => {
  const el = document.getElementById('emInput');
  const pos = el.selectionStart;
  const oldLen = el.value.length;
  el.value = normalizeDollarInput(el.value);
  const newLen = el.value.length;
  try { el.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen)); } catch(_) {}
  previewAmount = parseInt(el.value.replace(/,/g, ''), 10) || 0;
  document.getElementById('emSlider').value = Math.min(previewAmount, 500);
  updatePreview();
});
document.getElementById('emFreq').addEventListener('change', () => {
  previewFreq = document.getElementById('emFreq').value;
  updatePreview();
});
document.getElementById('emCancel').addEventListener('click', closeExtraModal);
document.getElementById('emCommit').addEventListener('click', commitExtra);

// ==========================================================
//  INIT
// ==========================================================
document.getElementById('addDebtBtn').addEventListener('click', () => addDebt());

// First-run CTA
let isCalculating = false;
document.getElementById('calcBtn').addEventListener('click', () => {
  if (isCalculating || hasEverRevealed) return;
  isCalculating = true;
  const btn = document.getElementById('calcBtn');
  btn.disabled = true;
  btn.classList.add('is-calculating');
  btn.innerHTML = '<span class="calc-spinner" aria-hidden="true"></span><span>Calculating…</span>';
  setTimeout(() => {
    isCalculating = false;
    btn.style.display = 'none';
    const emptyEl = document.getElementById('emptyState');
    const resultsEl = document.getElementById('results');
    emptyEl.classList.add('is-leaving');
    resultsEl.classList.add('is-entering');
    hasEverRevealed = true;
    updateShareBtn();
    run();
    if (isMobileViewport()) setTimeout(anchorChartToTopbar, 350);
  }, 450);
});

updateShareBtn();
if (!decodeUrl()) { isFirstRun = false; addDebt(); }
else run();

// Initial reveal is complete (or we never had data) — release the no-flash class
// so subsequent state changes (clearing debts, etc.) animate normally.
document.documentElement.classList.remove('has-data');

// Inline onclick handlers in HTML are blocked by the Vercel CSP (script-src 'self').
// Wire up navigation + the chart's "Show original" toggle here so they work in production.
(function wireNavHandlers() {
  // Forward-nav links to sub-pages: persist current calc URL so back buttons can return.
  document.querySelectorAll('a.nav-out, .header-how, .footer-link').forEach(a => {
    a.addEventListener('click', () => {
      try { encodeUrl(); sessionStorage.setItem('calcUrl', location.href); } catch (_) {}
    });
  });

  // Amortization link: ensure href has the latest hash at click time.
  const sched = document.getElementById('scheduleLink');
  if (sched) {
    sched.addEventListener('click', function () {
      try { encodeUrl(); } catch (_) {}
      this.href = 'amortization.html' + location.hash;
    });
    // Also set initial href in case the user clicks before the debounced encodeUrl fires.
    try { encodeUrl(); } catch (_) {}
  }

  // "Show original" toggle in the chart.
  const orig = document.getElementById('origBtn');
  if (orig) orig.addEventListener('click', toggleOriginalSchedule);
})();

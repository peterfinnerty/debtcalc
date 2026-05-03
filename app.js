// app.js — UI logic for To Zero debt payoff calculator
// Pure simulation helpers are in simulation.js (loaded before this file)

// ==========================================================
//  STATE
// ==========================================================
let debts       = [];
let extras      = [];
let activeTab   = 'avalanche';
let chart       = null;
let debtId      = 0;
let extraId     = 0;
let updateTimer = null;
let encodeTimer = null;
let lastAv         = null;
let lastSb         = null;
let lastIdentical  = false;
let lastValid      = [];
let lastSimKey     = '';
let previewAmount  = 50;
let previewFreq    = 'monthly';
let previewHistory = null;
let baselineHistory = null;
let baselineResult  = null;
let showOriginalSchedule = false;

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
  { value: 'credit_card',  label: 'Credit Card' },
  { value: 'loan',         label: 'Loan' },
  { value: 'student_loan', label: 'Student Loan' },
  { value: 'other',        label: 'Other' },
];

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
      <div class="field-row" id="balanceRow-${id}">
        <div class="field">
          <label>Balance owed</label>
          <div class="input-wrap has-prefix">
            <span class="input-prefix">$</span>
            <input type="text" inputmode="decimal" placeholder="5,000" data-field="balance" data-id="${id}" autocomplete="off">
          </div>
        </div>
        <div class="field" id="aprField-${id}">
          <label>Interest rate</label>
          <div class="input-wrap has-suffix">
            <input type="number" placeholder="19.9" data-field="apr" data-id="${id}" min="0" max="100" step="0.1">
            <span class="input-suffix">%</span>
          </div>
        </div>
      </div>
      <div id="typeFields-${id}"></div>
      <div class="debt-callout" id="callout-${id}"></div>
      <div class="past-due-section">
        <label class="past-due-toggle-label">
          <input type="checkbox" data-field="pastDue" data-id="${id}">
          <span>Past due?</span>
        </label>
        <div id="pastDueFields-${id}" style="display:none;margin-top:8px">
          <div class="field-row">
            <div class="field">
              <label>Months past due</label>
              <input type="number" placeholder="1" data-field="monthsPastDue" data-id="${id}" min="0" step="1">
            </div>
            <div class="field">
              <label>Past due amount</label>
              <div class="input-wrap has-prefix">
                <span class="input-prefix">$</span>
                <input type="text" inputmode="decimal" placeholder="0" data-field="pastDueAmount" data-id="${id}" autocomplete="off">
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="bottomFields-${id}"></div>
      <div class="debt-hint" id="debtHint-${id}">Fill in all fields to see your results</div>
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
  debt.minPayment = 0;
  debt.useMinimum = false;

  // 'other' defaults to 0% APR
  if (newType === 'other') {
    debt.apr = 0;
    const aprEl = document.querySelector(`[data-field="apr"][data-id="${id}"]`);
    if (aprEl) aprEl.value = '';
  }

  updateCardForType(id, newType);
  updateDebtSummary(id);
  bump();
}

// Shared field builders
function moneyPaymentField(id, debt) {
  const val = debt.minPayment ? normalizeDollarInput(debt.minPayment) : '';
  return `
    <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:12px">
      <div class="field">
        <label style="display:flex;align-items:center;gap:6px">
          What I plan to pay each month
          <span class="info-tooltip pmt-warn" id="pmtWarn-${id}" style="display:none" data-tip-id="${id}"><i class="warn-icon">!</i></span>
        </label>
        <div class="input-wrap has-prefix">
          <span class="input-prefix">$</span>
          <input type="text" inputmode="decimal" placeholder="0" data-field="minPayment" data-id="${id}" autocomplete="off" value="${val}">
        </div>
      </div>
    </div>`;
}

// Calculate a first-month minimum payment estimate for display
function calcMinPreview(debt) {
  if (!debt.balance || debt.balance <= 0) return '~$25/mo';
  const rate = (debt.apr || 0) / 1200;
  const interest = debt.balance * rate;
  const min = Math.min(debt.balance, Math.max(25, debt.balance * 0.01 + interest, debt.balance * 0.02));
  return '~' + fmt(min) + '/mo';
}

// Show/hide the ! warning on the payment field if entry is below estimated minimum
function checkPaymentWarn(debt) {
  const warnEl = document.getElementById('pmtWarn-' + debt.id);
  if (!warnEl) return;

  // Only warn when we can estimate a minimum: need balance + apr
  const canEstimate = debt.balance > 0 && debt.apr > 0;
  // Don't warn when useMinimum is checked (it's handled automatically)
  if (!canEstimate || debt.useMinimum || !debt.minPayment) {
    warnEl.style.display = 'none'; return;
  }

  const rate = debt.apr / 1200;
  const interest = debt.balance * rate;
  const estMin = Math.min(debt.balance, Math.max(25, debt.balance * 0.01 + interest, debt.balance * 0.02));

  if (debt.minPayment < estMin) {
    if (!window._pmtWarnText) window._pmtWarnText = {};
    window._pmtWarnText[debt.id] = `This may be below the typical minimum payment. Lenders may require at least ${fmt(Math.ceil(estMin))}/mo.`;
    warnEl.style.display = 'inline-flex';
  } else {
    warnEl.style.display = 'none';
  }
}

// Refresh the minimum preview placeholder when balance or APR changes
function refreshMinPreview(debt) {
  if (debt.debtType !== 'credit_card' || !debt.useMinimum) return;
  const pmtInput = document.querySelector(`[data-field="minPayment"][data-id="${debt.id}"]`);
  if (pmtInput) pmtInput.placeholder = calcMinPreview(debt);
}

function updateCardForType(id, type) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  const typeFieldsEl   = document.getElementById('typeFields-' + id);
  const calloutEl      = document.getElementById('callout-' + id);
  const bottomFieldsEl = document.getElementById('bottomFields-' + id);
  const aprFieldEl     = document.getElementById('aprField-' + id);
  const balanceRow     = document.getElementById('balanceRow-' + id);
  if (!typeFieldsEl || !calloutEl) return;

  // Balance row always visible for all types
  if (balanceRow) balanceRow.style.display = '';

  // Reset APR field
  const aprInput2 = aprFieldEl?.querySelector('input');
  if (aprInput2) { aprInput2.disabled = false; aprInput2.style.opacity = ''; }

  // Clear bottom slot (student loan toggle); repopulate below if needed
  if (bottomFieldsEl) bottomFieldsEl.innerHTML = '';

  switch (type) {
    // ── Credit Card ───────────────────────────────────────────
    case 'credit_card': {
      const useMin = debt.useMinimum;
      const pmtVal = useMin ? '' : (debt.minPayment ? normalizeDollarInput(debt.minPayment) : '');
      const placeholder = useMin ? calcMinPreview(debt) : '150';
      typeFieldsEl.innerHTML = `
        <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:12px">
          <div class="field">
            <label style="display:flex;align-items:center;gap:6px">
              What I plan to pay each month
              ${useMin ? '' : `<span class="info-tooltip pmt-warn" id="pmtWarn-${id}" style="display:none" data-tip-id="${id}"><i class="warn-icon">!</i></span>`}
            </label>
            <div class="input-wrap${useMin ? '' : ' has-prefix'}">
              ${useMin ? '' : '<span class="input-prefix">$</span>'}
              <input type="text" inputmode="decimal" placeholder="${placeholder}" data-field="minPayment" data-id="${id}" autocomplete="off" value="${pmtVal}"${useMin ? ' disabled style="opacity:0.5;font-style:italic"' : ''}>
            </div>
          </div>
          <label class="checkbox-label" style="margin-top:10px;display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.8rem;color:var(--text-muted)">
            <input type="checkbox" data-field="useMinimum" data-id="${id}"${useMin ? ' checked' : ''}>
            Use estimated minimum
            <span class="info-tooltip" data-tip="Minimum = max($25, 1% of balance + interest, 2% of balance). Recalculates each month as your balance drops."><i class="info-icon">i</i></span>
          </label>
        </div>`;
      calloutEl.className = 'debt-callout';
      break;
    }

    // ── Loan (personal, auto, mortgage, BNPL, etc.) ───────────
    case 'loan': {
      typeFieldsEl.innerHTML = moneyPaymentField(id, debt);
      calloutEl.className = 'debt-callout';
      break;
    }

    // ── Student Loan ──────────────────────────────────────────
    case 'student_loan': {
      const lt = debt.loanType || 'federal';
      typeFieldsEl.innerHTML = moneyPaymentField(id, debt);
      if (bottomFieldsEl) {
        bottomFieldsEl.innerHTML = `
          <div class="plan-toggle" style="margin-top:10px">
            <button class="plan-btn${lt==='federal'?' active':''}" data-action="set-loan-type" data-id="${id}" data-value="federal">Federal</button>
            <button class="plan-btn${lt==='private'?' active':''}" data-action="set-loan-type" data-id="${id}" data-value="private">Private</button>
          </div>`;
      }
      if (lt === 'federal') {
        calloutEl.className = 'debt-callout blue show';
        calloutEl.innerHTML = 'Federal loans have forgiveness options that can change the math significantly. <a href="https://studentaid.gov/loan-simulator" target="_blank">Check studentaid.gov</a> to understand your options.';
      } else {
        calloutEl.className = 'debt-callout';
        calloutEl.innerHTML = '';
      }
      break;
    }

    // ── Other (medical, collections, anything else) ───────────
    case 'other': {
      typeFieldsEl.innerHTML = moneyPaymentField(id, debt);
      calloutEl.className = 'debt-callout';
      // Default APR to 0 if not set
      if (!debt.apr) {
        const aprEl = document.querySelector(`[data-field="apr"][data-id="${id}"]`);
        if (aprEl) aprEl.value = '';
      }
      break;
    }

    default: {
      typeFieldsEl.innerHTML = moneyPaymentField(id, debt);
      calloutEl.className = 'debt-callout';
    }
  }
  updateCardPlaceholders(id, type);
}

function updateCardPlaceholders(id, type) {
  const nameEl = document.querySelector(`[data-field="name"][data-id="${id}"]`);
  const balEl  = document.querySelector(`[data-field="balance"][data-id="${id}"]`);
  const aprEl  = document.querySelector(`[data-field="apr"][data-id="${id}"]`);
  const cfg = {
    credit_card:  { name: 'e.g. Chase Freedom',      bal: '3,500',  apr: '22.9' },
    loan:         { name: 'e.g. Car / Mortgage / SoFi', bal: '15,000', apr: '7.5' },
    student_loan: { name: 'e.g. Navient / MOHELA',   bal: '25,000', apr: '5.5'  },
    other:        { name: 'e.g. Medical bill',        bal: '2,000',  apr: '0'    },
  }[type] || { name: 'e.g. Debt name', bal: '5,000', apr: '0' };
  if (nameEl) nameEl.placeholder = cfg.name;
  if (balEl)  balEl.placeholder  = cfg.bal;
  if (aprEl)  aprEl.placeholder  = cfg.apr;
}

function onUseMinimumChange(id) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  const cb = document.querySelector(`[data-field="useMinimum"][data-id="${id}"]`);
  debt.useMinimum = !!cb?.checked;
  if (debt.useMinimum) debt.minPayment = 0;
  updateCardForType(id, 'credit_card');
  checkPaymentWarn(debt);
  bump();
}

function onPastDueChange(id) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  const cb = document.querySelector(`[data-field="pastDue"][data-id="${id}"]`);
  debt.pastDue = !!cb?.checked;
  if (!debt.pastDue) { debt.monthsPastDue = 0; debt.pastDueAmount = 0; }
  const fields = document.getElementById('pastDueFields-' + id);
  if (fields) fields.style.display = debt.pastDue ? '' : 'none';
  bump();
}

function setStudentLoanType(id, lt) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  debt.loanType = lt;
  document.querySelectorAll(`#bottomFields-${id} .plan-btn`).forEach(btn => {
    btn.classList.toggle('active', (lt==='federal' && btn.textContent==='Federal') || (lt==='private' && btn.textContent==='Private'));
  });
  const callout = document.getElementById('callout-' + id);
  if (callout) {
    if (lt === 'federal') {
      callout.className = 'debt-callout blue show';
      callout.innerHTML = 'Federal loans have forgiveness options that can change the math significantly. <a href="https://studentaid.gov/loan-simulator" target="_blank">Check studentaid.gov</a> to understand your options.';
    } else {
      callout.className = 'debt-callout';
      callout.innerHTML = '';
    }
  }
  bump();
}

function addDebt(pre = {}) {
  const id = ++debtId;
  // Map legacy type values to new 4-type system
  let dt = pre.debtType || 'credit_card';
  if (dt === 'card') dt = 'credit_card';
  if (['personal_loan','auto','mortgage','bnpl','tax'].includes(dt)) dt = 'loan';
  if (dt === 'student_private' || dt === 'student_federal') dt = 'student_loan';
  if (dt === 'medical' || dt === 'collections') dt = 'other';
  if (!['credit_card','loan','student_loan','other'].includes(dt)) dt = 'credit_card';

  // Collapse existing cards before adding the new one (so new card stays open)
  if (debts.length > 0) collapseAllDebts();

  debts.push({
    id,
    name:          pre.name || '',
    balance:       +pre.balance || 0,
    apr:           +pre.apr || 0,
    minPayment:    +pre.minPayment || 0,
    debtType:      dt,
    useMinimum:    !!pre.useMinimum,
    loanType:      pre.loanType || 'federal',
    pastDue:       !!pre.pastDue,
    monthsPastDue: +pre.monthsPastDue || 0,
    pastDueAmount: +pre.pastDueAmount || 0,
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

  if (pre.apr) { const a = card.querySelector('[data-field="apr"]'); if (a && !a.disabled) a.value = pre.apr; }
  const pmtEl = card.querySelector('[data-field="minPayment"]');
  if (pre.minPayment && pmtEl && !pmtEl.disabled) pmtEl.value = normalizeDollarInput(pre.minPayment);

  // Restore past due state
  if (pre.pastDue) {
    const cb = card.querySelector(`[data-field="pastDue"]`);
    if (cb) cb.checked = true;
    const fields = document.getElementById('pastDueFields-' + id);
    if (fields) fields.style.display = '';
    if (pre.monthsPastDue) {
      const mpd = card.querySelector('[data-field="monthsPastDue"]');
      if (mpd) mpd.value = pre.monthsPastDue;
    }
    if (pre.pastDueAmount) {
      const pda = card.querySelector('[data-field="pastDueAmount"]');
      if (pda) pda.value = normalizeDollarInput(pre.pastDueAmount);
    }
  }

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

const TYPE_LABELS = { credit_card: 'Credit Card', loan: 'Loan', student_loan: 'Student Loan', other: 'Other' };

function updateDebtSummary(id) {
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  const nameEl = document.getElementById('summaryName-' + id);
  const balEl  = document.getElementById('summaryBal-' + id);
  if (!nameEl) return;
  nameEl.textContent = debt.name || 'Unnamed';
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
const MONEY_FIELDS = new Set(['balance', 'minPayment', 'pastDueAmount']);

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
    debt[field] = parseInt(el.value.replace(/,/g, ''), 10) || 0;
    refreshMinPreview(debt);
    if (field === 'balance') updateDebtSummary(id);
    if (field === 'balance' || field === 'minPayment') checkPaymentWarn(debt);
  } else if (field === 'apr') {
    debt.apr = parseFloat(el.value) || 0;
    refreshMinPreview(debt);
    checkPaymentWarn(debt);
  } else {
    debt[field] = parseFloat(el.value) || 0;
  }
  bump();
});

// Change delegation for select and checkbox fields on debtsList
document.getElementById('debtsList').addEventListener('change', e => {
  const el = e.target;
  const id = +el.dataset.id;
  const field = el.dataset.field;
  if (!field || !id) return;
  if (field === 'debtType')   onTypeChange(id);
  else if (field === 'pastDue')    onPastDueChange(id);
  else if (field === 'useMinimum') onUseMinimumChange(id);
});

// Click delegation for debt card actions
document.getElementById('debtsList').addEventListener('click', e => {
  // Remove debt button — check first so it doesn't bubble to toggle
  const removeBtn = e.target.closest('[data-action="remove-debt"]');
  if (removeBtn) { e.stopPropagation(); removeDebt(+removeBtn.dataset.id); return; }

  // Student loan type toggle
  const loanTypeBtn = e.target.closest('[data-action="set-loan-type"]');
  if (loanTypeBtn) { setStudentLoanType(+loanTypeBtn.dataset.id, loanTypeBtn.dataset.value); return; }

  // Toggle card open/closed
  const header = e.target.closest('[data-action="toggle"]');
  if (header) { toggleDebt(+header.dataset.id); return; }
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

  const validDebts = debts.filter(d => d.balance > 0 && (d.apr > 0 || d.debtType === 'credit_card'));
  if (validDebts.length <= 1) { rec.className = 'extra-rec'; return; }

  const chosenDebt = validDebts.find(d => d.id == ex.targetId);
  if (!chosenDebt) { rec.className = 'extra-rec'; return; }

  // Find optimal target (highest APR = avalanche)
  const optimalDebt = [...validDebts].sort((a, b) => b.apr - a.apr)[0];

  if (chosenDebt.id === optimalDebt.id) {
    rec.textContent = `Great call. ${chosenDebt.name || 'This debt'} has the highest APR so it costs you the most — targeting it first is the optimal move.`;
    rec.className = 'extra-rec good show';
  } else {
    const aprDiff = (optimalDebt.apr - chosenDebt.apr).toFixed(1);
    rec.innerHTML = `<strong>${escHtml(optimalDebt.name) || 'Debt with highest APR'}</strong> is charging ${optimalDebt.apr.toFixed(1)}% vs ${chosenDebt.apr.toFixed(1)}% — putting this toward that debt first would save more in interest (${aprDiff}% difference).`;
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

// getMinPayment, getFloor, getUserBudget, avSortKey, pastDuePriority, strategySort,
// simulate, and firstMonthBreakdown are all provided by simulation.js (loaded in <head>)

// ==========================================================
//  CHART
// ==========================================================
function toggleOriginalSchedule() {
  showOriginalSchedule = !showOriginalSchedule;
  const btn = document.getElementById('origBtn');
  btn.classList.toggle('active', showOriginalSchedule);
  btn.textContent = showOriginalSchedule ? 'Hide original' : 'Show original';
  updateSavingsCallout();
  if (lastAv && lastSb) drawChart(lastAv, lastSb, lastIdentical);
}

function updateSavingsCallout() {
  const el = document.getElementById('savingsCallout');
  if (!el) return;
  const modalOpen = document.getElementById('extraModal').classList.contains('open');
  if (!baselineResult || !lastAv || modalOpen) { el.style.display = 'none'; return; }
  const monthsFaster = baselineResult.months - lastAv.months;
  const interestSaved = baselineResult.interest - lastAv.interest;
  document.getElementById('savingsMonths').textContent = monthsLabel(monthsFaster);
  document.getElementById('savingsInterest').textContent = fmt(interestSaved) + ' in interest';
  el.style.display = '';
}

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

  const datasets = identical
    ? [
        {
          label: 'Balance',
          data: thin(av.history),
          borderColor: '#c4824a',
          backgroundColor: 'rgba(196,130,74,0.07)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#c4824a',
          pointBorderColor: '#c4824a',
          tension: 0.42, fill: false,
        },
      ]
    : [
        {
          label: 'Avalanche',
          data: thin(av.history),
          borderColor: '#c4824a',
          backgroundColor: 'rgba(196,130,74,0.07)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#c4824a',
          pointBorderColor: '#c4824a',
          tension: 0.42, fill: false,
        },
        {
          label: 'Snowball',
          data: thin(sb.history),
          borderColor: '#4a7a9b',
          backgroundColor: 'rgba(74,122,155,0.05)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#4a7a9b',
          pointBorderColor: '#4a7a9b',
          tension: 0.42, fill: false,
        },
      ];

  // Preview line — faded solid green, only when modal is open
  if (previewHistory) {
    datasets.push({
      label: 'With extra',
      data: thin(previewHistory),
      borderColor: 'rgba(90,138,106,0.4)',
      backgroundColor: 'rgba(90,138,106,0.04)',
      borderWidth: 2.5,
      pointRadius: 2.5,
      pointHoverRadius: 5,
      pointBackgroundColor: 'rgba(90,138,106,0.4)',
      pointBorderColor: 'rgba(90,138,106,0.4)',
      tension: 0.42, fill: false,
    });
  }

  // Original schedule — faint grey dashed, clipped to current chart window
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

  // Show label in tooltip when multiple series are visible
  const tooltipLabel = (identical && !previewHistory)
    ? c => '  ' + fmt(c.parsed.y)
    : c => '  ' + c.dataset.label + ': ' + fmt(c.parsed.y);

  const data = { labels, datasets };

  if (chart) {
    chart.data = data;
    chart.options.plugins.tooltip.callbacks.label = tooltipLabel;
    chart.update('none');
    return;
  }

  chart = new Chart(document.getElementById('payoffChart').getContext('2d'), {
    type: 'line', data,
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fff', borderColor: '#e8e0d0', borderWidth: 1,
          titleColor: '#2d2620', bodyColor: '#7a6e65', padding: 10, cornerRadius: 8,
          callbacks: { label: tooltipLabel }
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
        <div class="s-value c-amber">${fmt(r.interest)}</div>
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

  const debtRows = sorted.map(d => {
    const badge = d.monthsPastDue >= 3
      ? `<span class="priority-badge urgent">Paying first · 3+ mo past due</span>`
      : d.monthsPastDue >= 1
      ? `<span class="priority-badge overdue">Paying second · past due</span>`
      : '';
    const extraLabels = extraByDebt[String(d.id)] || [];
    const extraBadge  = extraLabels.map(l =>
      `<span class="extra-badge">${l}</span>`
    ).join('');
    const hasInterest = d.monthlyInterest > 0.01 && d.payment > 0;
    const piLine = hasInterest
      ? `<div class="pi-labels">${fmtDec(d.principal)} principal &middot; <span class="pi-i">${fmtDec(d.monthlyInterest)} interest</span></div>`
      : '';
    return `
      <div class="breakdown-row">
        <div class="breakdown-name">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:1.4em">${escHtml(d.name) || 'Unnamed debt'}${badge}${extraBadge}</div>
          <small>${d.apr.toFixed(1)}% APR &middot; ${fmt(d.balance)} balance</small>
        </div>
        <div class="breakdown-right">
          <div class="breakdown-amount">${fmtDec(d.payment)}/mo</div>
          ${piLine}
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

  const raw = calcWarnings(valid, sim);
  if (!raw.length) { panel.style.display = 'none'; return; }

  const dangerIcon  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;margin-top:3px"><circle cx="7" cy="7" r="6.5" stroke="#8b3428" stroke-width="1.3"/><path d="M7 4v3.5" stroke="#8b3428" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="10" r="0.75" fill="#8b3428"/></svg>`;
  const cautionIcon = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;margin-top:3px"><circle cx="7" cy="7" r="6.5" stroke="#7a4a20" stroke-width="1.3"/><path d="M7 4v3.5" stroke="#7a4a20" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="10" r="0.75" fill="#7a4a20"/></svg>`;

  const htmlItems = raw.map(w => {
    if (w.type === 'interest-exceeds-payment') {
      return `<div class="warning-item danger" style="display:flex;align-items:flex-start;gap:8px">${dangerIcon}<span><strong>${escHtml(w.label)}</strong>: your payment only covers the interest — your balance will never go down. You need to pay at least <strong>${fmt(w.minNeeded)}/mo</strong> to start making progress.</span></div>`;
    }
    if (w.type === 'no-payoff') {
      return `<div class="warning-item danger" style="display:flex;align-items:flex-start;gap:8px">${dangerIcon}<span><strong>No payoff date found.</strong> We couldn't calculate when you'll be debt-free with your current payments. Try increasing your monthly payment.</span></div>`;
    }
    if (w.type === 'federal-loan-high-apr') {
      return `<div class="warning-item caution" style="display:flex;align-items:flex-start;gap:8px">${cautionIcon}<span><strong>${escHtml(w.label)}</strong>: ${w.apr.toFixed(1)}% APR is high for a federal student loan. Double-check your rate — federal loans are typically below 8%.</span></div>`;
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
        <div class="payoff-name">${escHtml(d.name) || 'Unnamed debt'}</div>
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
function openExtraModal() {
  document.getElementById('extraModal').classList.add('open');
  document.getElementById('extraBtn').classList.add('active');
  document.getElementById('savingsCallout').style.display = 'none';
  // Sync inputs to current state
  document.getElementById('emInput').value = normalizeDollarInput(previewAmount);
  document.getElementById('emSlider').value = Math.min(previewAmount, 500);
  document.getElementById('emFreq').value = previewFreq;
  updatePreview();
  setTimeout(() => document.addEventListener('mousedown', outsideClickClose), 0);
}

function closeExtraModal() {
  const modal = document.getElementById('extraModal');
  modal.classList.remove('open', 'has-insight');
  document.getElementById('extraBtn').classList.remove('active');
  document.getElementById('emInsight').style.display = 'none';
  document.getElementById('previewCallout').style.display = 'none';
  document.removeEventListener('mousedown', outsideClickClose);
  previewHistory = null;
  if (lastAv && lastSb) drawChart(lastAv, lastSb, lastIdentical);
  updateSavingsCallout();
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
    callout.style.display = 'none';
    drawChart(lastAv, lastSb, lastIdentical);
    return;
  }
  const eb = extrasBreakdown();
  const pr = simulate(lastValid, {
    optimal: eb.optimal + monthlyAmt,
    oneTime: (eb.oneTime || 0) + (isOneTime ? previewAmount : 0),
    targeted: eb.targeted,
  }, 'avalanche');
  previewHistory = pr ? pr.history : null;

  // Insight inside modal + callout under button
  if (pr && lastAv) {
    const diffMo  = lastAv.months - pr.months;
    const diffInt = lastAv.interest - pr.interest;
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
  document.getElementById('extraBtn').classList.remove('active');
  document.getElementById('emInsight').style.display = 'none';
  document.getElementById('previewCallout').style.display = 'none';
  document.removeEventListener('mousedown', outsideClickClose);
  run();
  if (isFirst && baselineResult && !showOriginalSchedule) toggleOriginalSchedule();
}

// ==========================================================
//  TAB TOGGLE
// ==========================================================
function setTab(tab) {
  activeTab = tab;
  document.getElementById('tabAv').className = 'tab-btn' + (tab === 'avalanche' ? ' tab-av' : '');
  document.getElementById('tabSb').className = 'tab-btn' + (tab === 'snowball'  ? ' tab-sb' : '');
  encodeUrl(); // persist strategy to hash so amortization link stays in sync
  renderSummary();
  renderBreakdown();
  renderPayoffTimeline();
}

// ==========================================================
//  MAIN RUN
// ==========================================================
function run() {
  const valid = debts.filter(d => {
    if (!d.balance || d.balance <= 0) return false;
    if (d.debtType === 'credit_card')  return d.useMinimum || d.minPayment > 0;
    if (d.debtType === 'student_loan') return d.minPayment > 0;
    return d.minPayment > 0;
  });
  const hasData = valid.length > 0;
  refreshExtraTargets();

  document.getElementById('emptyState').style.display = hasData ? 'none' : 'flex';
  document.getElementById('results').style.display    = hasData ? 'block' : 'none';

  // Track first time results appear in this session
  if (hasData && !window._trackedDebtEntered) {
    window._trackedDebtEntered = true;
    trackEvent('debt-entered');
  }

  // Show hint on cards that are incomplete (have a balance but missing other fields)
  debts.forEach(d => {
    const hintEl = document.getElementById('debtHint-' + d.id);
    if (!hintEl) return;
    const isValid = valid.includes(d);
    const isPartial = d.balance > 0 && !isValid;
    hintEl.style.display = isPartial ? 'block' : 'none';
  });

  if (!hasData) return;

  const eb = extrasBreakdown();
  lastValid = valid;

  // Only re-simulate when debt/extra inputs actually changed
  const simKey = JSON.stringify({
    v: valid.map(d => [d.id, d.balance, d.apr, d.minPayment, d.debtType, d.useMinimum, d.pastDue, d.pastDueAmount, d.monthsPastDue]),
    eb,
  });
  if (simKey !== lastSimKey) {
    lastAv = simulate(valid, eb, 'avalanche');
    lastSb = simulate(valid, eb, 'snowball');
    const hasExtras = eb.optimal > 0 || eb.oneTime > 0 || eb.targeted.length > 0;
    baselineResult  = hasExtras ? simulate(valid, { optimal: 0, oneTime: 0, targeted: [] }, 'avalanche') : null;
    baselineHistory = baselineResult ? baselineResult.history : null;
    lastSimKey = simKey;
  }
  if (!lastAv || !lastSb) return;

  // Grey out strategy tabs + hide legend when both strategies are identical
  const identical = lastAv.months === lastSb.months && Math.abs(lastAv.interest - lastSb.interest) < 1;
  lastIdentical = identical;
  const tabsWrap = document.getElementById('tabsWrap');
  tabsWrap.classList.toggle('strategies-same', identical);
  const strategiesSameNote = document.getElementById('strategiesSameNote');
  strategiesSameNote.style.visibility = identical ? 'visible' : 'hidden';
  const origBtn = document.getElementById('origBtn');
  if (origBtn) origBtn.style.display = baselineHistory ? 'flex' : 'none';
  const legend = document.getElementById('chartLegend');
  if (legend) legend.style.display = (identical && !baselineHistory) ? 'none' : '';
  document.getElementById('avLegendItem')?.style.setProperty('display', identical ? 'none' : '');
  document.getElementById('sbLegendItem')?.style.setProperty('display', identical ? 'none' : '');

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
}

// ==========================================================
//  URL ENCODING
// ==========================================================
function encodeUrl() {
  try {
    const state = {
      v: 3,
      d: debts.map(d => ({
        n: d.name,
        b: d.balance,
        a: d.apr,
        m: d.minPayment,
        t: d.debtType,
        u: d.useMinimum ? 1 : 0,
        lt: d.loanType || '',
        pd: d.pastDue ? 1 : 0,
        mpd: d.monthsPastDue || 0,
        pda: d.pastDueAmount || 0,
      })),
      e: extras.map(e => [e.amount, e.freq, e.targetId || '']),
    };
    const enc = btoa(JSON.stringify(state));
    const stratPart = activeTab === 'snowball' ? '&s=snowball' : '';
    history.replaceState(null, '', location.pathname + '#p=' + enc + stratPart);
  } catch (_) {}
}

function decodeUrl() {
  const hash = location.hash.slice(1); // strip leading #
  const p = new URLSearchParams(hash).get('p');
  if (!p) return false;
  try {
    const s = JSON.parse(atob(p));
    if (s.v === 3) {
      if (Array.isArray(s.d)) s.d.forEach(d => addDebt({
        name: d.n, balance: d.b, apr: d.a, minPayment: d.m,
        debtType: d.t, useMinimum: !!d.u, loanType: d.lt || 'federal',
        pastDue: !!d.pd, monthsPastDue: d.mpd || 0, pastDueAmount: d.pda || 0,
      }));
    } else if (s.v === 2) {
      // Legacy v2 — map old types to new, restore what we can
      if (Array.isArray(s.d)) s.d.forEach(d => addDebt({
        name: d.n, balance: d.b, apr: d.a, minPayment: d.m,
        debtType: d.t, loanType: d.lt || 'federal', useMinimum: false,
      }));
    } else if (Array.isArray(s.d)) {
      // Legacy v1 format (array-of-arrays)
      s.d.forEach(d => addDebt({
        name: d[0], balance: d[1], apr: d[2], minPayment: d[3],
        debtType: d[4] || 'credit_card',
      }));
    }
    if (Array.isArray(s.e)) s.e.forEach(e => addExtra({ amount: e[0], freq: e[1], targetId: e[2] || null }));
    // Restore strategy
    const strat = new URLSearchParams(hash).get('s');
    if (strat === 'snowball') {
      activeTab = 'snowball';
      document.getElementById('tabAv').className = 'tab-btn';
      document.getElementById('tabSb').className = 'tab-btn tab-sb';
    }
    return true;
  } catch (_) { return false; }
}

// ==========================================================
//  SHARE
// ==========================================================
function shareUrl() {
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

// Email signup handled by Tally popup (data-tally-open="J98LA7")

// ==========================================================
//  ANALYTICS (GoatCounter)
// ==========================================================
function trackEvent(name) {
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path: name, title: name, event: true });
  }
}

function initAnalytics() {
  // Shared plan visit — URL contains a shared plan hash
  if (location.hash.startsWith('#p=')) {
    trackEvent('shared-plan-view');
  }

  // Return visitor — use localStorage to distinguish first vs. repeat visits
  if (localStorage.getItem('tz_visited')) {
    trackEvent('return-visit');
  } else {
    localStorage.setItem('tz_visited', '1');
  }
}

// Wait for GoatCounter to load before firing events
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

// Tooltip delegation — replaces all onmouseenter/onmouseleave inline handlers
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
  if (e.target.closest('[data-tip]')) return; // don't fire tab change when clicking tooltip
  setTab('avalanche');
});
document.getElementById('tabSb').addEventListener('click', e => {
  if (e.target.closest('[data-tip]')) return; // don't fire tab change when clicking tooltip
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
if (!decodeUrl()) addDebt();
else run();

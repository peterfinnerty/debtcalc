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
          <label>APR</label>
          <div class="input-wrap has-suffix">
            <input type="text" inputmode="decimal" placeholder="19.9" data-field="apr" data-id="${id}">
            <span class="input-suffix">%</span>
          </div>
        </div>
      </div>
      <div id="balanceError-${id}" style="display:none;font-size:12px;color:#b85c2a;margin-top:4px">Please enter a number from 1–10,000,000</div>
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
  const aprFieldEl     = document.getElementById('aprField-' + id);
  if (!calloutEl) return;

  // Reset APR field
  const aprInput2 = aprFieldEl?.querySelector('input');
  if (aprInput2) { aprInput2.disabled = false; aprInput2.style.opacity = ''; }

  // Clear bottom slot; repopulate below if needed
  if (bottomFieldsEl) bottomFieldsEl.innerHTML = '';

  switch (type) {
    case 'student_loan': {
      const lt = debt.loanType || 'federal';
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
    default:
      calloutEl.className = 'debt-callout';
      calloutEl.innerHTML = '';
  }
  updateCardPlaceholders(id, type);
}

function updateCardPlaceholders(id, type) {
  const nameEl = document.querySelector(`[data-field="name"][data-id="${id}"]`);
  const balEl  = document.querySelector(`[data-field="balance"][data-id="${id}"]`);
  const aprEl  = document.querySelector(`[data-field="apr"][data-id="${id}"]`);
  const cfg = {
    credit_card:  { name: 'e.g. Chase Freedom',       bal: '3,500',  apr: '22.9' },
    loan:         { name: 'e.g. Car / Mortgage / SoFi', bal: '15,000', apr: '7.5' },
    student_loan: { name: 'e.g. Navient / MOHELA',    bal: '25,000', apr: '5.5'  },
    other:        { name: 'e.g. Medical bill',         bal: '2,000',  apr: '0'    },
  }[type] || { name: 'e.g. Debt name', bal: '5,000', apr: '0' };
  if (nameEl) nameEl.placeholder = cfg.name;
  if (balEl)  balEl.placeholder  = cfg.bal;
  if (aprEl)  aprEl.placeholder  = cfg.apr;
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
    apr:           (pre.apr !== undefined && pre.apr !== null) ? +pre.apr : null,
    debtType:      dt,
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

  if (pre.apr != null) { const a = card.querySelector('[data-field="apr"]'); if (a && !a.disabled) a.value = pre.apr; }

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

  // Show hint immediately without waiting for run()
  const hintEl = document.getElementById('debtHint-' + id);
  const newDebt = debts[debts.length - 1];
  if (hintEl) hintEl.style.display = (newDebt.balance <= 0 || newDebt.apr === null) ? 'block' : 'none';

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
const MONEY_FIELDS = new Set(['balance', 'pastDueAmount']);

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
  if (field === 'debtType') onTypeChange(id);
  else if (field === 'pastDue') onPastDueChange(id);
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
  if (!baselineResult || !lastAv || modalOpen) { el.style.display = 'none'; return; }
  const monthsFaster = baselineResult.months - lastAv.months;
  const interestSaved = baselineResult.interest - lastAv.interest;
  document.getElementById('savingsMonths').textContent = monthsLabel(monthsFaster);
  document.getElementById('savingsInterest').textContent = fmt(interestSaved) + ' in interest';
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

  const datasets = identical
    ? [ payoffDataset('Balance', thin(av.history), '#c4824a', 'rgba(196,130,74,0.07)') ]
    : [
        payoffDataset('Avalanche', thin(av.history), '#c4824a', 'rgba(196,130,74,0.07)'),
        payoffDataset('Snowball',  thin(sb.history), '#4a7a9b', 'rgba(74,122,155,0.05)'),
      ];

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
      animation: document.documentElement.classList.contains('has-data')
        ? false
        : { duration: 900, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          position: 'nearest',
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
  }, 'avalanche', monthlyBudget);
  previewHistory = pr ? pr.history : null;

  // Insight inside modal
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
  if (isFirst && baselineResult && !showOriginalSchedule && !origScheduleRestored) toggleOriginalSchedule();
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
  const valid = debts.filter(d => d.balance > 0 && d.apr !== null);
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
  if (hintBudget) {
    let budgetLabel;
    if (monthlyBudget <= 0)          budgetLabel = '$0 / mo';
    else if (monthlyBudget < 1000)   budgetLabel = '$' + monthlyBudget + ' / mo';
    else if (monthlyBudget < 1000000) budgetLabel = '$' + Math.floor(monthlyBudget / 1000) + 'k / mo';
    else                             budgetLabel = '$' + Math.floor(monthlyBudget / 1000000) + 'M / mo';
    hintBudget.textContent = budgetLabel;
  }
  if (hintDebts) hintDebts.textContent = valid.length === 0 ? '0 added' : valid.length + ' added';

  // Show/hide the first-run CTA button
  const calcBtn = document.getElementById('calcBtn');
  if (calcBtn && !hasEverRevealed && !isFirstRun) {
    calcBtn.style.display = hasData ? 'inline-flex' : 'none';
  }

  // Always update hints regardless of hasData
  debts.forEach(d => {
    const hintEl = document.getElementById('debtHint-' + d.id);
    if (!hintEl) return;
    hintEl.style.display = (d.balance <= 0 || d.apr === null) ? 'block' : 'none';
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
    if (valid.length === 0) missing.push({ id: 'debts', label: 'Add a balance and APR for at least one debt.' });

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
    baselineResult  = hasExtras ? simulate(valid, { optimal: 0, oneTime: 0, targeted: [] }, 'avalanche', monthlyBudget) : null;
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
        pd: d.pastDue ? 1 : 0,
        mpd: d.monthsPastDue || 0,
        pda: d.pastDueAmount || 0,
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
        pastDue: !!d.pd, monthsPastDue: d.mpd || 0, pastDueAmount: d.pda || 0,
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
      document.getElementById('tabSb').className = 'tab-btn tab-sb';
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

// ── State ────────────────────────────────────────────────
let activeTab = 'avalanche';
let state = null; // { debts, extras, monthlyBudget }
let backLink = null; // set at init
const simCache      = {};   // strategy → simulate() result
const scheduleCache = {};   // strategy → buildSchedule() result

// ── Decode URL hash (mirrors app.js decodeUrl logic) ─────
function decodeState() {
  const hash = location.hash.slice(1);
  // URLSearchParams decodes + as space which breaks base64 — use regex instead
  const pm = hash.match(/(?:^|&)p=([^&]+)/);
  const p = pm ? pm[1] : null;
  if (!p) return null;
  try {
    const raw = JSON.parse(atob(p));
    const debts = [];
    const extras = [];
    let idCounter = 0;
    let monthlyBudget = 0;

    const normalizeType = t => {
      if (!t || t === 'card') return 'credit_card';
      if (['personal_loan','auto','mortgage','bnpl','tax'].includes(t)) return 'loan';
      if (['student_private','student_federal'].includes(t)) return 'student_loan';
      if (['medical','collections'].includes(t)) return 'other';
      return ['credit_card','loan','student_loan','other'].includes(t) ? t : 'credit_card';
    };

    if (raw.v === 4 && Array.isArray(raw.d)) {
      monthlyBudget = raw.mb || 0;
      raw.d.forEach(d => debts.push({
        id: ++idCounter, name: d.n || '', balance: +d.b || 0, apr: +d.a || 0,
        debtType: normalizeType(d.t), loanType: d.lt || 'federal',
        pastDue: !!d.pd, monthsPastDue: +d.mpd || 0, pastDueAmount: +d.pda || 0,
      }));
    } else if (raw.v === 3 && Array.isArray(raw.d)) {
      monthlyBudget = raw.d.reduce((s, d) => s + (+d.m || 0), 0);
      raw.d.forEach(d => debts.push({
        id: ++idCounter, name: d.n || '', balance: +d.b || 0, apr: +d.a || 0,
        debtType: normalizeType(d.t), loanType: d.lt || 'federal',
        pastDue: !!d.pd, monthsPastDue: +d.mpd || 0, pastDueAmount: +d.pda || 0,
      }));
    } else if (raw.v === 2 && Array.isArray(raw.d)) {
      monthlyBudget = raw.d.reduce((s, d) => s + (+d.m || 0), 0);
      raw.d.forEach(d => debts.push({
        id: ++idCounter, name: d.n || '', balance: +d.b || 0, apr: +d.a || 0,
        debtType: normalizeType(d.t), loanType: d.lt || 'federal',
        pastDue: false, monthsPastDue: 0, pastDueAmount: 0,
      }));
    } else if (Array.isArray(raw.d)) {
      monthlyBudget = raw.d.reduce((s, d) => s + (+d[3] || 0), 0);
      raw.d.forEach(d => debts.push({
        id: ++idCounter, name: d[0] || '', balance: +d[1] || 0, apr: +d[2] || 0,
        debtType: normalizeType(d[4]), loanType: 'federal',
        pastDue: false, monthsPastDue: 0, pastDueAmount: 0,
      }));
    }

    if (Array.isArray(raw.e)) {
      raw.e.forEach((e, i) => {
        if (e[0]) extras.push({ eid: i + 1, amount: +e[0] || 0, freq: e[1] || 'monthly', targetId: e[2] || null });
      });
    }

    return { debts, extras, monthlyBudget };
  } catch (_) { return null; }
}

// ── Compute extras breakdown ─────────────────────────────
function computeEB(extras) {
  const MULT = { daily: 365/12, weekly: 52/12, monthly: 1, quarterly: 1/3, biannually: 1/6, yearly: 1/12 };
  const me = e => e.freq === 'one_time' ? 0 : e.amount * (MULT[e.freq] ?? 1);
  return {
    oneTime:  extras.filter(e => e.freq === 'one_time' && !e.targetId).reduce((s, e) => s + e.amount, 0),
    optimal:  extras.filter(e => !e.targetId && e.freq !== 'one_time').reduce((s, e) => s + me(e), 0),
    targeted: extras.filter(e =>  e.targetId && e.freq !== 'one_time').map(e => ({ id: e.targetId, amount: me(e) })),
  };
}

// ── Valid debts: any debt with a positive balance ────────
function validDebts(debts) {
  return debts.filter(d => d.balance > 0);
}

// ── Hash strategy helpers ─────────────────────────────────
function updateHashStrategy(strat) {
  // Manipulate hash with string ops to avoid URLSearchParams corrupting base64 + chars
  let hash = location.hash.slice(1);
  hash = hash.replace(/(?:^|&)s=[^&]*/g, '');
  if (strat === 'snowball') hash += (hash ? '&' : '') + 's=snowball';
  hash = hash.replace(/^&/, '');
  history.replaceState(null, '', location.pathname + '#' + hash);
  if (backLink) backLink.href = '/' + location.hash;
}

// ── Render ───────────────────────────────────────────────
function render() {
  const valid = validDebts(state.debts);
  const eb    = computeEB(state.extras);
  const mb    = state.monthlyBudget || 0;

  if (!valid.length || !mb) {
    document.getElementById('content').style.display = 'none';
    return;
  }
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('content').style.display    = '';

  // Detect identical strategies — cache both sim results and schedules (state is immutable after load)
  if (!simCache.avalanche) simCache.avalanche = simulate(valid, eb, 'avalanche', mb);
  if (!simCache.snowball)  simCache.snowball  = simulate(valid, eb, 'snowball',  mb);
  const av = simCache.avalanche, sb = simCache.snowball;
  const identical = av && sb && av.months === sb.months && Math.abs(av.interest - sb.interest) < 1;
  document.getElementById('tabsWrap').style.display          = identical ? 'none' : '';
  document.getElementById('strategiesSameNote').style.display = identical ? '' : 'none';

  const simResult = activeTab === 'avalanche' ? av : sb;
  if (!scheduleCache[activeTab]) scheduleCache[activeTab] = buildSchedule(valid, eb, activeTab, mb);
  const schedule = scheduleCache[activeTab];

  renderSummary(simResult, valid);
  renderOverall(schedule, simResult, identical);
  renderDebtSections(schedule);
}

function renderSummary(r, valid) {
  const totalDebt = valid.reduce((s, d) => s + d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0), 0);
  document.getElementById('summaryArea').innerHTML = `
    <div class="summary-card">
      <div class="s-label">Debt-free by</div>
      <div class="s-value c-green" style="font-size:1.05rem">${r.freeDate}</div>
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
    </div>`;
}

function renderOverall(schedule, simResult, identical) {
  const stratLabel = identical ? '' : ` · ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} strategy`;
  document.getElementById('overallSub').textContent = `${schedule.rows.length} months${stratLabel}`;

  const tbody = document.getElementById('overallBody');
  tbody.innerHTML = schedule.rows.map(row => {
    return `<tr>
      <td class="mo num">${row.month}</td>
      <td class="date">${monthsToDate(row.month)}</td>
      <td class="bal num">${fmt(row.totalBalance)}</td>
      <td class="num">${fmt(row.totalPayment)}</td>
      <td class="pri num">${fmt(row.totalPrincipal)}</td>
      <td class="int num">${fmt(row.totalInterest)}</td>
      <td class="cum num">${fmt(row.cumInterest)}</td>
    </tr>`;
  }).join('');
}

function renderDebtSections(schedule) {
  const container = document.getElementById('debtSections');
  if (schedule.debts.length < 2) { container.innerHTML = ''; return; }

  container.innerHTML = schedule.debts.map(debt => {
    const payoffRow = [...schedule.rows].reverse().find(r => {
      const dr = r.debts.find(d => d.id === debt.id);
      return dr && dr.balance < 0.01;
    });
    const payoffMonth = payoffRow ? payoffRow.month : schedule.rows.length;
    const activeRows  = schedule.rows.filter(r => r.month <= payoffMonth);

    let totPmt = 0, totPri = 0, totInt = 0;
    const rowsHtml = activeRows.map(row => {
      const dr = row.debts.find(d => d.id === debt.id);
      if (!dr) return '';
      totPmt += dr.payment;
      totPri += dr.principal;
      totInt += dr.interest;
      return `<tr>
        <td class="mo num">${row.month}</td>
        <td class="date">${monthsToDate(row.month)}</td>
        <td class="bal num">${fmt(dr.balance)}</td>
        <td class="num">${fmt(dr.payment)}</td>
        <td class="pri num">${fmt(dr.principal)}</td>
        <td class="int num">${fmt(dr.interest)}</td>
      </tr>`;
    }).join('');

    const totalsBar = `
      <div class="t-item"><span class="t-label">Total paid</span><span class="t-val">${fmt(totPmt)}</span></div>
      <div class="t-item"><span class="t-label">Principal</span><span class="t-val" style="color:var(--green)">${fmt(totPri)}</span></div>
      <div class="t-item"><span class="t-label">Interest</span><span class="t-val" style="color:var(--amber)">${fmt(totInt)}</span></div>`;

    return `
      <details class="sched-card">
        <summary>
          <div class="sum-left">
            <div class="sum-title">${escHtml(debt.name) || 'Unnamed debt'}</div>
            <div class="sum-sub">${debt.apr.toFixed(1)}% APR · ${fmt(debt.initialBalance)} starting balance</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <div class="sum-right">Paid off ${monthsToDate(payoffMonth)}</div>
            <svg class="chevron" viewBox="0 0 12 12" fill="none">
              <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </summary>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mo.</th><th>Date</th>
                <th class="num">Balance</th>
                <th class="num">Payment</th>
                <th class="num">Principal</th>
                <th class="num">Interest</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="totals-bar">${totalsBar}</div>
      </details>`;
  }).join('');
}

// ── Tab listeners ─────────────────────────────────────────
document.getElementById('tabAv').addEventListener('click', () => {
  activeTab = 'avalanche';
  document.getElementById('tabAv').className = 'tab-btn tab-av';
  document.getElementById('tabSb').className = 'tab-btn';
  updateHashStrategy('avalanche');
  render();
});
document.getElementById('tabSb').addEventListener('click', () => {
  activeTab = 'snowball';
  document.getElementById('tabAv').className = 'tab-btn';
  document.getElementById('tabSb').className = 'tab-btn tab-sb';
  updateHashStrategy('snowball');
  render();
});

// ── Init ──────────────────────────────────────────────────
state = decodeState();

// Read strategy from hash
const initSm = location.hash.slice(1).match(/(?:^|&)s=([^&]+)/);
if (initSm && initSm[1] === 'snowball') {
  activeTab = 'snowball';
  document.getElementById('tabAv').className = 'tab-btn';
  document.getElementById('tabSb').className = 'tab-btn tab-sb';
}

// Preserve hash on back link so the calculator reloads with state intact
backLink = document.getElementById('backLink');
if (backLink && location.hash) backLink.href = '/' + location.hash;

if (state && state.debts.length) {
  try {
    render();
    document.getElementById('emptyState').style.display = 'none';
  } catch(e) {
    document.getElementById('emptyState').innerHTML += `<p style="color:red;font-size:11px;margin-top:12px">Error: ${e.message}</p>`;
  }
}

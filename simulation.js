// simulation.js — pure simulation helpers shared by index.html and tests.html
// Extracted from index.html so tests can import without the full DOM/UI.

// ==========================================================
//  SECURITY HELPER
// ==========================================================
// Escape user-supplied strings before inserting into innerHTML.
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ==========================================================
//  FORMATTERS
// ==========================================================
const fmt = n =>
  '$' + Math.abs(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDec = n =>
  '$' + Math.abs(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Format a raw string/number with commas while typing (no $ prefix, preserves decimals)
function fmtInput(val) {
  const s = String(val).replace(/[^\d.]/g, '');
  const [int, ...dec] = s.split('.');
  const formatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec.length ? formatted + '.' + dec[0] : formatted;
}

// Normalize a dollar-amount input: integers only, commas, no leading zeros,
// no decimals, no negatives, no letters. Returns '' for empty/zero.
function normalizeDollarInput(val) {
  const s = String(val);
  // Chop at first decimal point so "50.25" → "50", not "5025"
  const intStr = s.includes('.') ? s.slice(0, s.indexOf('.')) : s;
  // Keep only digits
  const digits = intStr.replace(/[^\d]/g, '');
  if (!digits) return '';
  const n = parseInt(digits, 10); // strips leading zeros
  return n.toLocaleString('en-US');
}

function monthsToDate(m) {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.round(m));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function monthsLabel(m) {
  const y = Math.floor(m / 12), mo = m % 12;
  if (!y) return mo + ' month' + (mo !== 1 ? 's' : '');
  if (!mo) return y + ' year' + (y !== 1 ? 's' : '');
  return y + 'y ' + mo + 'm';
}

// ==========================================================
//  SIMULATION HELPERS
// ==========================================================

// The absolute floor for a debt in simulation:
//   Credit card: max($25, 1% of balance + interest, 2% of balance)
//   Loan/other:  interest-only (balance × APR/1200), minimum $25
// Called with live pool objects (d.b = live balance, d.rate = apr/1200).
function getFloor(d) {
  const monthlyInterest = d.b * d.rate;
  if (d.debtType === 'credit_card') {
    return Math.min(d.b, Math.max(25, d.b * 0.01 + monthlyInterest, d.b * 0.02));
  }
  // Loans/student loans/other: interest-only floor, minimum $25
  return Math.min(d.b, Math.max(25, monthlyInterest));
}

// Same floor logic but accepts a source debt object (d.balance, d.apr) for warnings/display.
function getFloorFromSource(d) {
  const bal = d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0);
  const rate = (d.apr || 0) / 1200;
  const monthlyInterest = bal * rate;
  if (d.debtType === 'credit_card') {
    return Math.min(bal, Math.max(25, bal * 0.01 + monthlyInterest, bal * 0.02));
  }
  return Math.min(bal, Math.max(25, monthlyInterest));
}

function avSortKey(d) {
  return d.apr || 0;
}

// 0 = highest priority (3+ months past due), 1 = 1–2 months, 2 = current
function pastDuePriority(d) {
  const mpd = d.monthsPastDue || 0;
  if (mpd >= 3) return 0;
  if (mpd >= 1) return 1;
  return 2;
}

function strategySort(arr, strategy) {
  arr.sort((a, b) => {
    const pa = pastDuePriority(a), pb = pastDuePriority(b);
    if (pa !== pb) return pa - pb;
    // .b = live balance in simulation pool; .balance = effective balance in breakdown objects
    if (strategy === 'avalanche') {
      const aprDiff = avSortKey(b) - avSortKey(a);
      if (aprDiff !== 0) return aprDiff;
      // Tiebreak: smallest balance first (matches snowball behavior on equal APRs)
      return (a.b ?? a.balance ?? 0) - (b.b ?? b.balance ?? 0);
    }
    return (a.b ?? a.balance ?? 0) - (b.b ?? b.balance ?? 0);
  });
}

// ==========================================================
//  SIMULATION
// ==========================================================
// monthlyBudget: the user's total recurring monthly allocation across all debts.
// eb: { optimal, oneTime, targeted[] } — extra payments on top of the budget.
function simulate(source, eb, strategy, monthlyBudget) {
  monthlyBudget = monthlyBudget || 0;
  const effBal = d => d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0);
  let pool = source
    .filter(d => d.balance > 0)
    .map(d => ({ ...d, b: effBal(d), rate: (d.apr || 0) / 1200 }));

  if (!pool.length) return null;

  const history = [pool.reduce((s, d) => s + d.b, 0)];
  let interest = 0, mo = 0;
  const payoffMonths = {};

  while (mo < 600 && pool.some(d => d.b > 0.005)) {
    mo++;

    // Accrue interest
    for (const d of pool) {
      if (d.b > 0) { const i = d.b * d.rate; d.b += i; interest += i; }
    }

    // Total available this month: fixed budget + optional extra + one-time (month 1 only)
    let rem = monthlyBudget + Math.max(0, eb.optimal)
      + (mo === 1 ? Math.max(0, eb.oneTime || 0) : 0);

    // Pay floor on every active debt (capped at remaining budget to prevent overdraft)
    for (const d of pool) {
      if (d.b > 0 && rem > 0.005) {
        const p = Math.min(getFloor(d), d.b, rem);
        d.b -= p;
        rem -= p;
      }
    }

    // Targeted extras: apply to chosen debt, fall back to strategy priority if paid off
    for (const te of eb.targeted) {
      let target = pool.find(d => d.id == te.id && d.b > 0.005);
      if (!target) {
        const alive = pool.filter(d => d.b > 0.005);
        strategySort(alive, strategy);
        target = alive[0];
      }
      if (target) { const p = Math.min(te.amount, target.b); target.b -= p; }
    }

    // Surplus after floors → strategy priority
    const active = pool.filter(d => d.b > 0.005);
    strategySort(active, strategy);
    for (const d of active) {
      if (rem <= 0) break;
      const p = Math.min(rem, d.b); d.b -= p; rem -= p;
    }

    for (const d of pool) {
      d.b = Math.max(0, d.b);
      if (d.b < 0.005 && payoffMonths[d.id] === undefined) payoffMonths[d.id] = mo;
    }
    history.push(pool.reduce((s, d) => s + d.b, 0));
  }

  return {
    months: mo, interest,
    totalPaid: source.reduce((s, d) => s + effBal(d), 0) + interest,
    freeDate: monthsToDate(mo), history,
    breakdown: firstMonthBreakdown(source, eb, strategy, monthlyBudget),
    debtPayoffs: pool.map(d => ({ id: d.id, name: d.name, month: payoffMonths[d.id] ?? mo })),
  };
}

function firstMonthBreakdown(source, eb, strategy, monthlyBudget) {
  monthlyBudget = monthlyBudget || 0;
  const effBal = d => d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0);
  let pool = source
    .filter(d => d.balance > 0)
    .map(d => ({ ...d, b: effBal(d), rate: (d.apr || 0) / 1200, alloc: 0 }));

  let rem = monthlyBudget + Math.max(0, eb.optimal) + Math.max(0, eb.oneTime || 0);

  // Apply floors (capped at remaining budget)
  for (const d of pool) {
    if (rem > 0.005) {
      const p = Math.min(getFloor(d), d.b, rem);
      d.alloc += p;
      rem -= p;
    }
  }

  // Targeted extras
  for (const te of eb.targeted) {
    const target = pool.find(d => d.id == te.id);
    if (target) { const p = Math.min(te.amount, target.b - target.alloc); target.alloc += p; }
  }

  // Surplus → strategy priority
  const active = pool.filter(d => d.b - d.alloc > 0.005);
  strategySort(active, strategy);
  for (const d of active) {
    if (rem <= 0) break;
    const p = Math.min(rem, d.b - d.alloc); d.alloc += p; rem -= p;
  }

  return pool.map(d => {
    const monthlyInterest = d.b * d.rate;
    const principal = Math.max(0, d.alloc - monthlyInterest);
    return {
      id: d.id, name: d.name, payment: d.alloc, balance: d.b, apr: d.apr,
      monthlyInterest, principal,
      monthsPastDue: d.monthsPastDue || 0,
      pastDueAmount: d.pastDue ? (d.pastDueAmount || 0) : 0,
    };
  });
}

// ==========================================================
//  AMORTIZATION SCHEDULE
// ==========================================================
// Returns full month-by-month data for the amortization page.
// Mirrors simulate() logic exactly — just tracks more per-debt detail.
function buildSchedule(source, eb, strategy, monthlyBudget) {
  monthlyBudget = monthlyBudget || 0;
  const effBal = d => d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0);
  let pool = source
    .filter(d => d.balance > 0)
    .map(d => ({ ...d, b: effBal(d), rate: (d.apr || 0) / 1200 }));

  if (!pool.length) return { rows: [], debts: [] };

  const debtMeta = pool.map(d => ({ id: d.id, name: d.name, apr: d.apr, initialBalance: effBal(d) }));
  const rows = [];
  let mo = 0;
  let cumInterest = 0;

  while (mo < 600 && pool.some(d => d.b > 0.005)) {
    mo++;

    // Accrue interest
    const monthlyInterestMap = {};
    for (const d of pool) {
      if (d.b > 0) {
        const i = d.b * d.rate;
        monthlyInterestMap[d.id] = i;
        d.b += i;
        cumInterest += i;
      } else {
        monthlyInterestMap[d.id] = 0;
      }
    }

    let rem = monthlyBudget + Math.max(0, eb.optimal)
      + (mo === 1 ? Math.max(0, eb.oneTime || 0) : 0);

    const paid = {};
    for (const d of pool) paid[d.id] = 0;

    // Floors
    for (const d of pool) {
      if (d.b > 0 && rem > 0.005) {
        const p = Math.min(getFloor(d), d.b, rem);
        d.b -= p; rem -= p; paid[d.id] += p;
      }
    }

    // Targeted extras
    for (const te of eb.targeted) {
      let target = pool.find(d => d.id == te.id && d.b > 0.005);
      if (!target) {
        const alive = pool.filter(d => d.b > 0.005);
        strategySort(alive, strategy);
        target = alive[0];
      }
      if (target) { const p = Math.min(te.amount, target.b); target.b -= p; paid[target.id] += p; }
    }

    // Surplus → strategy priority
    const active = pool.filter(d => d.b > 0.005);
    strategySort(active, strategy);
    for (const d of active) {
      if (rem <= 0) break;
      const p = Math.min(rem, d.b); d.b -= p; rem -= p; paid[d.id] += p;
    }

    for (const d of pool) d.b = Math.max(0, d.b);

    const debtRows = pool.map(d => ({
      id: d.id,
      balance:   d.b,
      payment:   paid[d.id] || 0,
      principal: Math.max(0, (paid[d.id] || 0) - (monthlyInterestMap[d.id] || 0)),
      interest:  monthlyInterestMap[d.id] || 0,
    }));

    rows.push({
      month:          mo,
      debts:          debtRows,
      totalBalance:   pool.reduce((s, d) => s + d.b, 0),
      totalPayment:   debtRows.reduce((s, r) => s + r.payment, 0),
      totalPrincipal: debtRows.reduce((s, r) => s + r.principal, 0),
      totalInterest:  debtRows.reduce((s, r) => s + r.interest, 0),
      cumInterest,
    });
  }

  return { rows, debts: debtMeta };
}

// ==========================================================
//  PURE WARNINGS (no DOM)
// Returns an array of warning objects instead of rendering HTML.
// ==========================================================
function calcWarnings(valid, sim, monthlyBudget) {
  const warnings = [];

  // Rule 1 — monthly budget below the minimum needed to cover all debt floors
  if (monthlyBudget > 0) {
    const floorSum = valid.reduce((s, d) => s + getFloorFromSource(d), 0);
    // For 1-2 months past due, add the catch-up amount on top of floor
    const pastDueCatchUp = valid
      .filter(d => d.pastDue && (d.monthsPastDue || 0) >= 1 && (d.monthsPastDue || 0) < 3)
      .reduce((s, d) => s + (d.pastDueAmount || 0), 0);
    const minNeeded = floorSum + pastDueCatchUp;
    if (monthlyBudget < minNeeded) {
      const hasPastDue = valid.some(d => d.pastDue && (d.monthsPastDue || 0) >= 1);
      warnings.push({ type: 'budget-too-low', minNeeded: Math.ceil(minNeeded), hasPastDue });
    }
  }

  // Rule 2 — simulation hit 600-month cap (skip if budget-too-low already explains it)
  const budgetTooLow = warnings.some(w => w.type === 'budget-too-low');
  if (!budgetTooLow && sim && sim.months >= 600) {
    warnings.push({ type: 'no-payoff' });
  }

  // Rule 3 — federal student loan with suspiciously high APR
  for (const d of valid) {
    if (d.debtType === 'student_loan' && d.loanType === 'federal' && (d.apr || 0) > 10) {
      const label = d.name || 'Federal student loan';
      warnings.push({ type: 'federal-loan-high-apr', label, apr: d.apr });
    }
  }

  return warnings;
}

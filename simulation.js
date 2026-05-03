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
function getMinPayment(d) {
  if (d.debtType === 'credit_card') {
    // useMinimum: dynamic formula recalculated every month as balance drops
    if (d.useMinimum || d.minPayment <= 0) {
      const monthlyInterest = d.b * d.rate;
      return Math.min(d.b, Math.max(25, d.b * 0.01 + monthlyInterest, d.b * 0.02));
    }
    return Math.min(d.b, d.minPayment);
  }
  return Math.min(d.b, d.minPayment || 0);
}

// The absolute floor for a debt in simulation — always uses dynamic formula for
// credit cards so any user payment above the minimum becomes strategy-directable surplus.
function getFloor(d) {
  if (d.debtType === 'credit_card') {
    const monthlyInterest = d.b * d.rate;
    return Math.min(d.b, Math.max(25, d.b * 0.01 + monthlyInterest, d.b * 0.02));
  }
  return Math.min(d.b, d.minPayment || 0);
}

// The user's intended monthly allocation for this debt (forms the total budget)
function getUserBudget(d) {
  if (d.debtType === 'credit_card' && (d.useMinimum || d.minPayment <= 0)) {
    const monthlyInterest = d.b * d.rate;
    return Math.min(d.b, Math.max(25, d.b * 0.01 + monthlyInterest, d.b * 0.02));
  }
  return Math.min(d.b, d.minPayment || 0);
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
function simulate(source, eb, strategy) {
  // eb = { optimal: number, targeted: [{id, amount}] }
  const effBal = d => d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0);
  let pool = source
    .filter(d => d.balance > 0)
    .map(d => ({ ...d, b: effBal(d), rate: (d.apr || 0) / 1200 }));

  if (!pool.length) return null;

  // Fixed-payment contributions are locked in before the simulation loop.
  // When a fixed-payment debt pays off, its freed money stays in the monthly
  // budget as surplus that gets redirected to remaining debts — this is the
  // "snowball" effect. Without this lock, the budget collapses when a high-
  // payment debt pays off first (the avalanche bug).
  //
  // Dynamic (useMinimum) CC contributions are recomputed each month because
  // their minimum payment shrinks as the balance drops.
  const fixedMonthlyBudget = pool.reduce((s, d) => {
    if (d.debtType === 'credit_card' && (d.useMinimum || (d.minPayment || 0) <= 0)) return s;
    return s + (d.minPayment || 0);
  }, 0);

  const history = [pool.reduce((s, d) => s + d.b, 0)];
  let interest = 0, mo = 0;
  const payoffMonths = {};

  while (mo < 600 && pool.some(d => d.b > 0.005)) {
    mo++;

    // Accrue interest
    for (const d of pool) {
      if (d.b > 0) { const i = d.b * d.rate; d.b += i; interest += i; }
    }

    // Total budget = fixed commitments (persists after payoff) +
    //               dynamic minimums for useMinimum CCs (shrinks with balance) +
    //               optional extra payment.
    const dynamicBudget = pool
      .filter(d => d.b > 0 && d.debtType === 'credit_card' && (d.useMinimum || (d.minPayment || 0) <= 0))
      .reduce((s, d) => {
        const interest = d.b * d.rate;
        return s + Math.min(d.b, Math.max(25, d.b * 0.01 + interest, d.b * 0.02));
      }, 0);
    const totalBudget = fixedMonthlyBudget + dynamicBudget + Math.max(0, eb.optimal);
    let rem = totalBudget;

    // Apply floors to all active debts (capped at getUserBudget to prevent negative rem)
    for (const d of pool) {
      if (d.b > 0) {
        const p = Math.min(getFloor(d), getUserBudget(d), d.b);
        d.b -= p;
        rem -= p;
      }
    }

    // Targeted extras: apply to chosen debt, fall back to priority if paid off
    for (const te of eb.targeted) {
      let target = pool.find(d => d.id == te.id && d.b > 0.005);
      if (!target) {
        const alive = pool.filter(d => d.b > 0.005);
        strategySort(alive, strategy);
        target = alive[0];
      }
      if (target) { const p = Math.min(te.amount, target.b); target.b -= p; }
    }

    // Optimal extra toward strategy priority
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
    breakdown: firstMonthBreakdown(source, eb, strategy),
    debtPayoffs: pool.map(d => ({ id: d.id, name: d.name, month: payoffMonths[d.id] ?? mo })),
  };
}

function firstMonthBreakdown(source, eb, strategy) {
  const effBal = d => d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0);
  let pool = source
    .filter(d => d.balance > 0)
    .filter(d => d.debtType === 'credit_card' ? (d.useMinimum || d.minPayment > 0) : d.minPayment > 0)
    .map(d => ({ ...d, b: effBal(d), rate: (d.apr || 0) / 1200, alloc: 0 }));

  const totalBudget = pool.reduce((s, d) => s + getUserBudget(d), 0) + Math.max(0, eb.optimal);
  let rem = totalBudget;

  // Apply floors (capped at getUserBudget to prevent negative rem)
  for (const d of pool) {
    const p = Math.min(getFloor(d), getUserBudget(d), d.b);
    d.alloc += p;
    rem -= p;
  }

  // Targeted extras
  for (const te of eb.targeted) {
    const target = pool.find(d => d.id == te.id);
    if (target) { const p = Math.min(te.amount, target.b - target.alloc); target.alloc += p; }
  }

  // Optimal extra
  const active = pool.filter(d => d.b - d.alloc > 0.005);
  strategySort(active, strategy);
  for (const d of active) {
    if (rem <= 0) break;
    const p = Math.min(rem, d.b - d.alloc); d.alloc += p; rem -= p;
  }

  return pool.map(d => {
    const monthlyInterest = d.b * d.rate;
    const principal = Math.max(0, d.alloc - monthlyInterest);
    return { id: d.id, name: d.name, payment: d.alloc, balance: d.b, apr: d.apr, monthlyInterest, principal, monthsPastDue: d.monthsPastDue || 0 };
  });
}

// ==========================================================
//  PURE WARNINGS (no DOM)
// Returns an array of warning objects instead of rendering HTML.
// ==========================================================
function calcWarnings(valid, sim) {
  const warnings = [];

  // Rule 1 — payment does not cover monthly interest
  for (const d of valid) {
    const rate = (d.apr || 0) / 1200;
    const monthlyInterest = d.balance * rate;
    const effectivePmt = (d.debtType === 'credit_card' && d.useMinimum)
      ? Math.min(d.balance, Math.max(25, d.balance * 0.01 + monthlyInterest, d.balance * 0.02))
      : (d.minPayment || 0);
    if (d.apr > 0 && effectivePmt > 0 && effectivePmt <= monthlyInterest) {
      const minNeeded = Math.ceil(monthlyInterest + 1);
      const label = d.name || `Debt ${valid.indexOf(d) + 1}`;
      warnings.push({ type: 'interest-exceeds-payment', label, minNeeded });
    }
  }

  // Rule 2 — simulation hit 600-month cap
  if (sim && sim.months >= 600) {
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

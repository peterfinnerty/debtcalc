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

function normalizeAprInput(val) {
  // Strip everything except digits and decimal point
  let s = String(val).replace(/[^\d.]/g, '');
  // Only allow one decimal point
  const dotIdx = s.indexOf('.');
  if (dotIdx !== -1) s = s.slice(0, dotIdx + 1) + s.slice(dotIdx + 1).replace(/\./g, '');
  // Limit to 1 decimal place
  const parts = s.split('.');
  if (parts[1] !== undefined) s = parts[0] + '.' + parts[1].slice(0, 1);
  // Strip leading zeros (but allow "0." prefix)
  if (parts[0].length > 1 && parts[0][0] === '0') s = parts[0].replace(/^0+/, '') + (parts[1] !== undefined ? '.' + parts[1].slice(0, 1) : '');
  return s;
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
//  TYPE NORMALIZATION (shared by app.js and amortization.js)
// ==========================================================
// Map legacy / alternative debtType values to the current 6-type system.
// Old saved URL hashes still need to decode correctly.
function normalizeType(t) {
  if (!t || t === 'card') return 'credit_card';
  if (t === 'loan') return 'personal_loan';                       // legacy single "loan" bucket
  if (t === 'bnpl' || t === 'tax') return 'personal_loan';
  if (t === 'student_private' || t === 'student_federal') return 'student_loan';
  if (t === 'medical' || t === 'collections') return 'other';
  const VALID = ['credit_card','mortgage','auto','personal_loan','student_loan','other'];
  return VALID.includes(t) ? t : 'credit_card';
}

// ==========================================================
//  SIMULATION HELPERS
// ==========================================================

// The absolute floor for a debt in simulation:
//   Credit card:                  max($25, 1% of balance + interest, 2% of balance)
//   Loan with fixed payment set:  the contractual monthly payment (capped at balance)
//   Loan/student loan/other:      interest-only (balance × APR/1200), minimum $25
// Called with live pool objects (d.b = live balance, d.rate = apr/1200).
function getFloor(d) {
  const monthlyInterest = d.b * d.rate;
  if (d.debtType === 'credit_card') {
    return Math.min(d.b, Math.max(25, d.b * 0.01 + monthlyInterest, d.b * 0.02));
  }
  if (d.monthlyPayment > 0) {
    return Math.min(d.b, d.monthlyPayment);
  }
  // Loans/student loans/other: interest-only floor, minimum $25
  return Math.min(d.b, Math.max(25, monthlyInterest));
}

// Same floor logic but accepts a source debt object (d.balance, d.apr) for warnings/display.
function getFloorFromSource(d) {
  // Deferred debts have no required payment until repayment starts
  if (d.deferment && defermentMonthsRemaining(d) > 0) return 0;
  const bal = d.balance + (d.pastDue ? (d.pastDueAmount || 0) : 0);
  const rate = (d.apr || 0) / 1200;
  const monthlyInterest = bal * rate;
  if (d.debtType === 'credit_card') {
    return Math.min(bal, Math.max(25, bal * 0.01 + monthlyInterest, bal * 0.02));
  }
  if (d.monthlyPayment > 0) {
    return Math.min(bal, d.monthlyPayment);
  }
  return Math.min(bal, Math.max(25, monthlyInterest));
}

// Standard fixed-payment amortization formula:
//   P = L × [r(1+r)^n] / [(1+r)^n − 1]
// Source: Brealey/Myers/Allen, Principles of Corporate Finance, §2-4 (Annuities);
//         Federal Reserve Board, "Calculating Your Mortgage Payment" methodology.
function amortizingPayment(principal, aprPct, months) {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = (aprPct || 0) / 1200;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return principal * (r * f) / (f - 1);
}

// Inverse: months remaining given balance, APR, monthly payment.
// Returns Infinity if the payment doesn't cover monthly interest (loan would grow).
function termFromPayment(principal, aprPct, payment) {
  if (!(principal > 0) || !(payment > 0)) return 0;
  const r = (aprPct || 0) / 1200;
  if (r === 0) return Math.ceil(principal / payment);
  if (payment <= principal * r) return Infinity;
  return Math.ceil(-Math.log(1 - principal * r / payment) / Math.log(1 + r));
}

// Number of simulation months a debt is in deferment. Sim month 1 is "next month"
// (since interest accrues then payments post), so a defermentUntil of "next month"
// means defMonths = 0 (no deferment), and "month after next" means defMonths = 1.
function defermentMonthsRemaining(d, simStart) {
  if (!d.deferment || !d.defermentUntil) return 0;
  const start = simStart || new Date();
  const [y, m] = d.defermentUntil.split('-').map(Number);
  if (!y || !m) return 0;
  const monthsBetween = (y - start.getFullYear()) * 12 + (m - 1 - start.getMonth());
  return Math.max(0, monthsBetween - 1);
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

// Order in which floors get paid when budget is tight. Mortgages come first
// (foreclosure is the highest-stakes outcome), then past-due debts (in order
// of how far behind), then everything else current. Within a tier we keep
// pool order so the user's input order acts as a stable tiebreak.
function floorPriority(d) {
  if (d.debtType === 'mortgage') return 0;
  return 1 + pastDuePriority(d); // 1 (3+ mo past due) → 3 (current)
}

function floorSort(arr) {
  // Stable sort by floor priority — items at the same priority keep input order
  arr.sort((a, b) => floorPriority(a) - floorPriority(b));
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
    .map(d => ({ ...d, b: effBal(d), rate: (d.apr || 0) / 1200, defMonths: defermentMonthsRemaining(d) }));

  if (!pool.length) return null;

  const isDeferred = (d, mo) => d.defMonths > 0 && mo <= d.defMonths;

  const history = [pool.reduce((s, d) => s + d.b, 0)];
  let interest = 0, mo = 0;
  const payoffMonths = {};

  while (mo < 600 && pool.some(d => d.b > 0.005)) {
    mo++;

    // Accrue interest (skip if deferred and not accruing)
    for (const d of pool) {
      if (d.b > 0 && !(isDeferred(d, mo) && !d.defermentAccruing)) {
        const i = d.b * d.rate; d.b += i; interest += i;
      }
    }

    // Total available this month: fixed budget + optional extra + one-time (month 1 only)
    let rem = monthlyBudget + Math.max(0, eb.optimal)
      + (mo === 1 ? Math.max(0, eb.oneTime || 0) : 0);

    // Pay floor on every active, non-deferred debt — sorted by safety priority
    // (mortgage first, then past-due, then current) so when budget runs short
    // the highest-stakes payments still get covered.
    const floorOrdered = pool.filter(d => d.b > 0 && !isDeferred(d, mo));
    floorSort(floorOrdered);
    for (const d of floorOrdered) {
      if (rem > 0.005) {
        const p = Math.min(getFloor(d), d.b, rem);
        d.b -= p;
        rem -= p;
      }
    }

    // Targeted extras: apply to chosen debt unless it's deferred; fall back to strategy priority
    for (const te of eb.targeted) {
      let target = pool.find(d => d.id == te.id && d.b > 0.005 && !isDeferred(d, mo));
      if (!target) {
        const alive = pool.filter(d => d.b > 0.005 && !isDeferred(d, mo));
        strategySort(alive, strategy);
        target = alive[0];
      }
      if (target) { const p = Math.min(te.amount, target.b); target.b -= p; }
    }

    // Surplus after floors → strategy priority (skip deferred debts)
    const active = pool.filter(d => d.b > 0.005 && !isDeferred(d, mo));
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
    .map(d => ({ ...d, b: effBal(d), rate: (d.apr || 0) / 1200, defMonths: defermentMonthsRemaining(d), alloc: 0 }));

  // Month 1 of the sim — a debt is deferred this month iff defMonths >= 1
  const isDeferredM1 = d => d.defMonths >= 1;

  let rem = monthlyBudget + Math.max(0, eb.optimal) + Math.max(0, eb.oneTime || 0);

  // Apply floors (skip deferred), sorted by safety priority
  const floorOrdered = pool.filter(d => !isDeferredM1(d));
  floorSort(floorOrdered);
  for (const d of floorOrdered) {
    if (rem > 0.005) {
      const p = Math.min(getFloor(d), d.b, rem);
      d.alloc += p;
      rem -= p;
    }
  }

  // Targeted extras (skip deferred)
  for (const te of eb.targeted) {
    const target = pool.find(d => d.id == te.id);
    if (target && !isDeferredM1(target)) { const p = Math.min(te.amount, target.b - target.alloc); target.alloc += p; }
  }

  // Surplus → strategy priority (skip deferred)
  const active = pool.filter(d => d.b - d.alloc > 0.005 && !isDeferredM1(d));
  strategySort(active, strategy);
  for (const d of active) {
    if (rem <= 0) break;
    const p = Math.min(rem, d.b - d.alloc); d.alloc += p; rem -= p;
  }

  return pool.map(d => {
    const accruing = !(isDeferredM1(d) && !d.defermentAccruing);
    const monthlyInterest = accruing ? d.b * d.rate : 0;
    const principal = Math.max(0, d.alloc - monthlyInterest);
    return {
      id: d.id, name: d.name, payment: d.alloc, balance: d.b, apr: d.apr,
      monthlyInterest, principal,
      monthsPastDue: d.monthsPastDue || 0,
      pastDueAmount: d.pastDue ? (d.pastDueAmount || 0) : 0,
      deferred: isDeferredM1(d),
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
    .map(d => ({ ...d, b: effBal(d), rate: (d.apr || 0) / 1200, defMonths: defermentMonthsRemaining(d) }));

  if (!pool.length) return { rows: [], debts: [] };

  const isDeferred = (d, mo) => d.defMonths > 0 && mo <= d.defMonths;

  const debtMeta = pool.map(d => ({ id: d.id, name: d.name, apr: d.apr, initialBalance: effBal(d) }));
  const rows = [];
  let mo = 0;
  let cumInterest = 0;

  while (mo < 600 && pool.some(d => d.b > 0.005)) {
    mo++;

    // Accrue interest (skip if deferred and not accruing)
    const monthlyInterestMap = {};
    for (const d of pool) {
      if (d.b > 0 && !(isDeferred(d, mo) && !d.defermentAccruing)) {
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

    // Floors (skip deferred), sorted by safety priority
    const floorOrdered = pool.filter(d => d.b > 0 && !isDeferred(d, mo));
    floorSort(floorOrdered);
    for (const d of floorOrdered) {
      if (rem > 0.005) {
        const p = Math.min(getFloor(d), d.b, rem);
        d.b -= p; rem -= p; paid[d.id] += p;
      }
    }

    // Targeted extras (skip deferred)
    for (const te of eb.targeted) {
      let target = pool.find(d => d.id == te.id && d.b > 0.005 && !isDeferred(d, mo));
      if (!target) {
        const alive = pool.filter(d => d.b > 0.005 && !isDeferred(d, mo));
        strategySort(alive, strategy);
        target = alive[0];
      }
      if (target) { const p = Math.min(te.amount, target.b); target.b -= p; paid[target.id] += p; }
    }

    // Surplus → strategy priority (skip deferred)
    const active = pool.filter(d => d.b > 0.005 && !isDeferred(d, mo));
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

  // Rule 4 — fixed monthly payment doesn't cover monthly interest (loan would grow)
  for (const d of valid) {
    if (d.monthlyPayment > 0) {
      const monthlyInterest = d.balance * (d.apr || 0) / 1200;
      if (d.monthlyPayment < monthlyInterest) {
        warnings.push({
          type: 'payment-below-interest',
          label: d.name || 'Loan',
          payment: d.monthlyPayment,
          interest: monthlyInterest,
        });
      }
    }
  }

  return warnings;
}

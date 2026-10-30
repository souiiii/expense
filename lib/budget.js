// Budget decisions are replayed in date order. Balances are a cache, never a
// second ledger. A monthly snapshot keeps later plan edits out of old budgets.
export const signed = (t) => (t.direction === 'in' ? t.amountPaise : -t.amountPaise);
export const transactionPeriod = (t) => t.budgetPeriod || t.date.slice(0, 7);
const sumBalances = (state) => state.categories.reduce((n, c) => n + c.balancePaise, 0);
function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function stamp(date, createdAt, decision = false) {
  const created = new Date(createdAt);
  const clock = decision && date > localDate(created) ? '00:00:00.000' :
    `${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}:${String(created.getSeconds()).padStart(2, '0')}.${String(created.getMilliseconds()).padStart(3, '0')}`;
  return `${date}T${clock}/${createdAt}`;
}

export function allocationDate(period, date) {
  const last = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate();
  return date < `${period}-01` ? `${period}-01` : date > `${period}-${last}` ? `${period}-${last}` : date;
}

export function prepareLedger(state) {
  if (state.budgetBase) return;
  const base = Object.fromEntries(state.categories.map(c => [c.id, c.balancePaise]));
  for (const t of state.transactions) if (t.categoryId) base[t.categoryId] -= signed(t);
  for (const m of state.moves || []) {
    if (m.fromCategoryId) base[m.fromCategoryId] += m.amountPaise;
    if (m.toCategoryId) base[m.toCategoryId] -= m.amountPaise;
  }
  for (const a of state.allocations) for (const item of a.items) base[item.categoryId] -= item.deltaPaise;
  state.budgetBase = base;
  state.billOverrides ||= [];
  // Old divisions have no rule snapshots. Keep their exact effects; never guess
  // historical settings or silently redistribute an existing user's money.
  state.historyStartsAt = state.allocations.filter(a => !a.snapshot)
    .map(a => allocationDate(a.period, localDate(new Date(a.createdAt)))).sort().at(-1) || null;
}

export function paymentTotal(state, categoryId, period, transactions = state.transactions) {
  return transactions.filter(t => t.categoryId === categoryId && transactionPeriod(t) === period)
    .reduce((sum, t) => sum - signed(t), (state.billOverrides || []).find(b => b.categoryId === categoryId && b.period === period)?.openingPaidPaise || 0);
}

export function billTarget(state, categoryId, period, fallback) {
  const override = (state.billOverrides || []).find(b => b.categoryId === categoryId && b.period === period);
  return override?.amountPaise ?? fallback;
}

export function fundingTarget(state, categoryId, period, planned) {
  const override = (state.billOverrides || []).find(b => b.categoryId === categoryId && b.period === period);
  return Math.max(0, (override?.amountPaise ?? planned) - (override?.openingPaidPaise || 0));
}

export function billSettled(state, categoryId, period, asOf = '9999-12-31') {
  return (state.billOverrides || []).some(b => b.categoryId === categoryId && b.period === period && b.settled && (!b.date || b.date <= asOf)
    && paymentTotal(state, categoryId, period) >= (b.paidAtSettlement || 0));
}

export function plannedBillTarget(state, categoryId, period) {
  const exact = state.allocations.find(a => a.period === period)?.items.find(i => i.categoryId === categoryId && i.reason === 'target');
  if (exact) return exact.targetPaise;
  const plans = [
    ...(state.planVersions || []).filter(p => p.effectivePeriod <= period).map(p => ({period: p.effectivePeriod, createdAt: p.createdAt, categories: p.categories})),
    ...state.allocations.filter(a => a.period <= period && a.snapshot).map(a => ({period: a.period, createdAt: a.createdAt, categories: a.snapshot.categories})),
  ].sort((a,b) => a.period.localeCompare(b.period) || a.createdAt.localeCompare(b.createdAt));
  if (plans.length) return plans.at(-1).categories.find(c => c.id === categoryId)?.targetPaise || 0;
  return state.categories.find(c => c.id === categoryId)?.targetPaise || 0;
}

export function priorBills(state, categoryId, period, transactions = state.transactions, asOf = '9999-12-31') {
  let due = 0;
  const starts = [...state.allocations.map(a => a.period), ...(state.planVersions || []).map(p => p.effectivePeriod)].sort();
  let p = starts[0];
  while (p && p < period) {
    if (!billSettled(state, categoryId, p, asOf)) due += Math.max(0, billTarget(state, categoryId, p, plannedBillTarget(state, categoryId, p)) - paymentTotal(state, categoryId, p, transactions));
    const [year, month] = p.split('-').map(Number);
    p = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`;
  }
  return due;
}

export function replayBudgets(state, throughPeriod = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })()) {
  prepareLedger(state);
  state.futureReservedPaise = 0;
  for (const c of state.categories) c.balancePaise = state.budgetBase[c.id] || 0;
  const categories = new Map(state.categories.map(c => [c.id, c]));
  const events = [];
  for (const t of state.transactions) events.push({key: stamp(t.date, t.createdAt), type: 'tx', value: t});
  for (const m of state.moves || []) {
    const createdDate = localDate(new Date(m.createdAt));
    const date = m.date || createdDate;
    if (date > createdDate) events.push({key: stamp(createdDate, m.createdAt), type: 'reserve', value: (!m.fromCategoryId ? m.amountPaise : 0) - (!m.toCategoryId ? m.amountPaise : 0)});
    events.push({key: stamp(date, m.createdAt, true), type: 'move', value: m});
  }
  for (const a of state.allocations) {
    if (!a.snapshot) {
      events.push({key: stamp(allocationDate(a.period, localDate(new Date(a.createdAt))), a.createdAt), type: 'legacy', value: a});
      continue;
    }
    a.items = a.snapshot.categories.map(c => ({categoryId: c.id, targetPaise: c.targetPaise, deltaPaise: 0, fundedPaise: 0, carryPaise: 0, reason: 'target'}));
    a.surplusPaise = 0;
    for (const [index, funding] of a.fundings.entries()) {
      const createdDate = localDate(new Date(funding.createdAt));
      if (funding.date > createdDate) events.push({key: stamp(createdDate, funding.createdAt), type: 'reserve', value: Object.values(funding.amounts).reduce((n, amount) => n + amount, 0)});
      events.push({key: stamp(funding.date, funding.createdAt, true), type: 'fund', value: {a, funding, first: index === 0}});
    }
  }
  events.sort((a, b) => a.key.localeCompare(b.key));
  let bank = state.settings.openingBalancePaise;
  const processed = [];
  const periodEffects = new Map();
  const effect = (period, id, amount) => {
    const key = `${period}/${id}`;
    periodEffects.set(key, (periodEffects.get(key) || 0) + amount);
  };
  for (const event of events) {
    if (event.type === 'reserve') {
      state.futureReservedPaise += event.value;
    } else if (event.type === 'tx') {
      const t = event.value;
      bank += signed(t);
      if (t.categoryId && transactionPeriod(t) > throughPeriod) {
        state.futureReservedPaise += signed(t);
        processed.push(t);
        continue;
      }
      if (t.categoryId && categories.has(t.categoryId)) {
        categories.get(t.categoryId).balancePaise += signed(t);
        effect(transactionPeriod(t), t.categoryId, signed(t));
      }
      processed.push(t);
    } else if (event.type === 'move') {
      const m = event.value;
      const period = (m.date || m.createdAt).slice(0, 7);
      if (period > throughPeriod) continue;
      if (m.date > localDate(new Date(m.createdAt))) state.futureReservedPaise -= (!m.fromCategoryId ? m.amountPaise : 0) - (!m.toCategoryId ? m.amountPaise : 0);
      if (m.fromCategoryId) { categories.get(m.fromCategoryId).balancePaise -= m.amountPaise; effect(period, m.fromCategoryId, -m.amountPaise); }
      if (m.toCategoryId) { categories.get(m.toCategoryId).balancePaise += m.amountPaise; effect(period, m.toCategoryId, m.amountPaise); }
    } else if (event.type === 'legacy') {
      for (const item of event.value.items) if (categories.has(item.categoryId)) categories.get(item.categoryId).balancePaise += item.deltaPaise;
    } else {
      const {a, funding, first} = event.value;
      if (a.period > throughPeriod) {
        for (const spec of a.snapshot.categories) {
          const amount = funding.amounts[spec.id] || 0;
          const row = a.items.find(i => i.categoryId === spec.id && i.reason === 'target');
          row.fundedPaise += amount;
          row.deltaPaise += amount;
        }
        a.remainingPaise = a.items.filter(i => i.reason === 'target').reduce((n, i) => n + Math.max(0, fundingTarget(state, i.categoryId, a.period, i.targetPaise) - i.fundedPaise), 0);
        continue;
      }
      if (funding.date > localDate(new Date(funding.createdAt))) state.futureReservedPaise -= Object.values(funding.amounts).reduce((n, amount) => n + amount, 0);
      a.availablePaise = bank - sumBalances(state) - Math.max(0, state.futureReservedPaise);
      for (const spec of a.snapshot.categories) {
        const c = categories.get(spec.id);
        const row = a.items.find(i => i.categoryId === spec.id && i.reason === 'target');
        const amount = funding.amounts[spec.id] || 0;
        const currentEffects = periodEffects.get(`${a.period}/${spec.id}`) || 0;
        const futureEffects = [...periodEffects.entries()].filter(([key]) => key.slice(0, 7) > a.period && key.slice(8) === spec.id).reduce((n, [, amount]) => n + amount, 0);
        const oldBalance = c.balancePaise;
        let carry = oldBalance - currentEffects - futureEffects;
        let desired;
        if (first) {
          if (spec.type === 'spending') carry = spec.rollover ? carry : Math.min(0, carry);
          else if (spec.type === 'bill' || spec.type === 'loan') {
            carry = Math.min(Math.max(0, carry), priorBills(state, c.id, a.period, processed, funding.date));
          } else carry = spec.rollover ? Math.max(0, carry) : 0;
          let fundedBalance = carry + amount;
          if (spec.capPaise != null && !['bill', 'loan'].includes(spec.type)) fundedBalance = Math.min(fundedBalance, spec.capPaise);
          desired = fundedBalance + currentEffects + futureEffects;
          row.carryPaise = carry;
          row.fundedPaise += Math.max(0, fundedBalance - carry);
        } else {
          let addition = amount;
          if (spec.capPaise != null && !['bill', 'loan'].includes(spec.type)) addition = Math.min(addition, Math.max(0, spec.capPaise - c.balancePaise));
          desired = c.balancePaise + addition;
          row.fundedPaise += addition;
        }
        c.balancePaise = desired;
        row.deltaPaise += desired - oldBalance;
        row.availablePaise = desired;
      }
      const surplus = categories.get(a.snapshot.surplusCategoryId);
      // A partial month's unassigned cash stays available for its next funding.
      if (funding.sweep && surplus) {
        const cap = a.snapshot.categories.find(c => c.id === surplus.id)?.capPaise;
        const amount = Math.max(0, Math.min(bank - sumBalances(state) - Math.max(0, state.futureReservedPaise), cap == null ? Infinity : cap - surplus.balancePaise));
        if (amount > 0) {
          surplus.balancePaise += amount;
          a.surplusPaise += amount;
          let row = a.items.find(i => i.reason === 'surplus');
          if (!row) { row = {categoryId: surplus.id, targetPaise: 0, deltaPaise: 0, reason: 'surplus'}; a.items.push(row); }
          row.deltaPaise += amount;
        }
      }
      a.fundedPaise = a.items.filter(i => i.reason === 'target').reduce((n, i) => n + Math.max(0, i.deltaPaise), 0);
      a.sweptPaise = a.items.reduce((n, i) => n + Math.max(0, -i.deltaPaise), 0);
      a.leftoverPaise = bank - sumBalances(state) - Math.max(0, state.futureReservedPaise);
      a.remainingPaise = a.items.filter(i => i.reason === 'target').reduce((n, i) => {
        const spec = a.snapshot.categories.find(c => c.id === i.categoryId);
        const remaining = Math.max(0, fundingTarget(state, i.categoryId, a.period, i.targetPaise) - i.fundedPaise);
        return n + (spec.capPaise == null ? remaining : Math.min(remaining, Math.max(0, spec.capPaise - categories.get(i.categoryId).balancePaise)));
      }, 0);
    }
  }
  state.futureReservedPaise = Math.max(0, state.futureReservedPaise);
  return state;
}

// Shared by the monthly plan preview and ledger. Amounts remain integer paise.
export function scheduledAmount(category, period) {
  if (category.startPeriod && period < category.startPeriod) return 0;
  if (category.endPeriod && period > category.endPeriod) return 0;
  const frequency = category.frequency || 'monthly';
  if (frequency !== 'monthly') {
    if (!category.startPeriod) return 0;
    const monthNumber = p => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7));
    const elapsed = monthNumber(period) - monthNumber(category.startPeriod);
    if (frequency === 'once' ? elapsed !== 0 : elapsed % (frequency === 'yearly' ? 12 : 3) !== 0) return 0;
  }
  return category.recurringAmountPaise ?? category.targetPaise;
}

export function peakFixedPlan(categories, fromPeriod) {
  const monthNumber = p => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
  const periodFor = n => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
  const first = monthNumber(fromPeriod);
  const boundaries = new Set([first]);
  const fixed = categories.filter(c => c.kind === 'fixed');
  for (const c of fixed) {
    if (c.startPeriod) boundaries.add(Math.max(first, monthNumber(c.startPeriod)));
    if (c.endPeriod) boundaries.add(Math.max(first, monthNumber(c.endPeriod)));
  }
  // All supported schedules repeat within 12 months. Check each phase after
  // every start/end boundary, including one-off payments, without scanning years.
  let peak = {amountPaise: 0, period: fromPeriod};
  for (const start of boundaries) for (let offset = 0; offset < 12; offset++) {
    const period = periodFor(start + offset);
    const amountPaise = fixed.reduce((n,c) => n + (['bill', 'loan'].includes(c.type) ? scheduledAmount(c, period) : c.targetPaise), 0);
    if (amountPaise > peak.amountPaise) peak = {amountPaise, period};
  }
  return peak;
}

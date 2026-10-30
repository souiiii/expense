import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const uid = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
export const isoNow = () => new Date().toISOString();

export function todayString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const periodOf = (date = todayString()) => date.slice(0, 7);

export function dateInMonth(period, day) {
  return `${period}-${String(day).padStart(2, '0')}`;
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function rupeesText(paise) {
  return `₹${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`;
}

function requireInt(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === '' || value === null || value === undefined) {
    throw new AppError('INVALID_INPUT', `${label} is required.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new AppError('INVALID_INPUT', `${label} must be a whole number${min === 0 ? ' of at least 0' : ''}.`);
  }
  return n;
}

function requirePercent(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new AppError('INVALID_INPUT', `${label} must be between 0 and 100.`);
  }
  return Math.round(n * 100) / 100;
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function activeCategories(state) {
  return state.categories
    .filter((c) => !c.archived)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'fixed' ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
}

export function categoryType(category) {
  if (
    category.type === 'bill' ||
    category.type === 'saving' ||
    category.type === 'investment' ||
    category.type === 'loan' ||
    category.type === 'spending'
  ) {
    return category.type;
  }
  if (category.id === 'rent') return 'bill';
  if (category.id === 'loan') return 'loan';
  if (category.id === 'invest') return 'investment';
  if (category.id === 'emergency') return 'saving';
  if (category.kind === 'flex') return 'spending';
  return category.rollover ? 'saving' : 'bill';
}

export function findCategory(state, id) {
  return state.categories.find((c) => c.id === id) ?? null;
}

export function computeBankBalance(state) {
  return state.transactions.reduce((sum, t) => {
    return sum + (t.direction === 'in' ? t.amountPaise : -t.amountPaise);
  }, state.settings.openingBalancePaise);
}

export function computeAllocated(state) {
  return state.categories.reduce((sum, c) => sum + c.balancePaise, 0);
}

export function computeUnallocated(state) {
  return computeBankBalance(state) - computeAllocated(state);
}

/**
 * The plan is a monthly intention, not a live percentage of the bank balance.
 * Fixed envelopes are rupee amounts. Flexible envelopes split what is left.
 */
export function computePlan(state) {
  const categories = activeCategories(state);
  const fixed = categories.filter((c) => c.kind === 'fixed');
  const flex = categories.filter((c) => c.kind === 'flex');

  const incomePaise = state.settings.monthlyIncomePaise;
  const fixedTotalPaise = fixed.reduce((sum, c) => sum + c.targetPaise, 0);
  const flexPoolPaise = Math.max(0, incomePaise - fixedTotalPaise);
  const flexPercentTotal = Math.round(flex.reduce((sum, c) => sum + c.percent, 0) * 100) / 100;

  const targetById = new Map();
  let flexTargetTotal = 0;
  for (const c of flex) {
    const target = Math.round((flexPoolPaise * c.percent) / 100);
    targetById.set(c.id, target);
    flexTargetTotal += target;
  }

  // Put rounding residue on the last flexible envelope so the plan adds up exactly.
  if (flex.length > 0 && Math.abs(flexPercentTotal - 100) < 0.01) {
    const diff = flexPoolPaise - flexTargetTotal;
    if (diff !== 0) {
      const last = flex[flex.length - 1];
      targetById.set(last.id, targetById.get(last.id) + diff);
      flexTargetTotal += diff;
    }
  }

  const items = categories.map((c) => ({
    categoryId: c.id,
    kind: c.kind,
    percent: c.kind === 'flex' ? c.percent : null,
    targetPaise: c.kind === 'fixed' ? c.targetPaise : targetById.get(c.id) ?? 0,
  }));

  const totalPaise = items.reduce((sum, item) => sum + item.targetPaise, 0);

  return {
    incomePaise,
    fixedTotalPaise,
    flexPoolPaise,
    flexPercentTotal,
    flexPercentValid: flex.length === 0 || Math.abs(flexPercentTotal - 100) < 0.01,
    totalPaise,
    unplannedPaise: incomePaise - totalPaise,
    overIncome: totalPaise > incomePaise,
    items,
  };
}

export function targetMap(plan) {
  return new Map(plan.items.map((item) => [item.categoryId, item.targetPaise]));
}

function applyEffect(state, tx, sign) {
  if (!tx.categoryId) return;
  const category = findCategory(state, tx.categoryId);
  if (!category) {
    throw new AppError('UNKNOWN_CATEGORY', 'That bucket no longer exists.');
  }
  const direction = tx.direction === 'in' ? 1 : -1;
  category.balancePaise += direction * tx.amountPaise * sign;
}

function normalizeTransaction(state, input, existing = null) {
  const date = input.date ?? existing?.date ?? todayString();
  if (!isValidDate(date)) {
    throw new AppError('INVALID_DATE', 'Date must be a real date in YYYY-MM-DD format.');
  }
  if (date > todayString()) {
    throw new AppError('INVALID_DATE', 'Date cannot be in the future. Add it when the money actually moves.');
  }

  const description = String(input.description ?? existing?.description ?? '').trim();
  if (!description) throw new AppError('INVALID_INPUT', 'Add a short description.');
  if (description.length > 120) throw new AppError('INVALID_INPUT', 'Description must be 120 characters or fewer.');

  const amountPaise = requireInt(
    input.amountPaise ?? existing?.amountPaise,
    'Amount',
    { min: 1 }
  );

  const direction = input.direction ?? existing?.direction ?? 'out';
  if (direction !== 'in' && direction !== 'out') {
    throw new AppError('INVALID_INPUT', 'Direction must be in or out.');
  }

  const kind = input.kind ?? existing?.kind ?? 'expense';
  if (!['expense', 'income', 'transfer', 'adjustment'].includes(kind)) {
    throw new AppError('INVALID_INPUT', 'Unknown transaction type.');
  }

  let categoryId = input.categoryId !== undefined ? input.categoryId : existing?.categoryId ?? null;
  if (!categoryId) categoryId = null;
  if (kind === 'income' || kind === 'adjustment') categoryId = null;

  if (kind === 'expense' || kind === 'transfer') {
    if (!categoryId) throw new AppError('CATEGORY_REQUIRED', 'Choose a bucket for this transaction.');
    const category = findCategory(state, categoryId);
    if (!category) throw new AppError('UNKNOWN_CATEGORY', 'That bucket no longer exists.');
    if (category.archived && category.id !== existing?.categoryId) {
      throw new AppError('CATEGORY_ARCHIVED', 'That bucket is archived.');
    }

    const type = categoryType(category);
    if (kind === 'expense' && type !== 'spending' && type !== 'bill') {
      throw new AppError(
        'TYPE_MISMATCH',
        `"${category.name}" only accepts "Set aside" or "Money back", not "Spent".`
      );
    }
    if (kind === 'transfer' && type !== 'saving' && type !== 'investment' && type !== 'loan') {
      throw new AppError(
        'TYPE_MISMATCH',
        `"${category.name}" only accepts "Spent" or "Refund", not "Set aside".`
      );
    }
  }

  const notes = input.notes !== undefined ? String(input.notes).slice(0, 300) : existing?.notes ?? '';

  return {
    date,
    description,
    amountPaise,
    direction,
    kind,
    categoryId,
    notes,
    source: existing?.source ?? input.source ?? 'manual',
    externalId: existing?.externalId ?? (input.externalId ? String(input.externalId).slice(0, 120) : null),
  };
}

export function addTransaction(state, input) {
  const tx = {
    id: uid('tx'),
    ...normalizeTransaction(state, input),
    createdAt: isoNow(),
  };

  if (tx.externalId && state.transactions.some((t) => t.externalId === tx.externalId)) {
    throw new AppError('DUPLICATE', 'This transaction was already recorded.', 409);
  }

  applyEffect(state, tx, 1);
  state.transactions.push(tx);
  return tx;
}

export function updateTransaction(state, id, input) {
  const index = state.transactions.findIndex((t) => t.id === id);
  if (index === -1) throw new AppError('NOT_FOUND', 'Transaction not found.', 404);

  const old = state.transactions[index];
  const normalized = normalizeTransaction(state, input, old);

  applyEffect(state, old, -1);
  const updated = { ...old, ...normalized, id: old.id, createdAt: old.createdAt };
  applyEffect(state, updated, 1);
  state.transactions[index] = updated;
  return updated;
}

export function deleteTransaction(state, id) {
  const index = state.transactions.findIndex((t) => t.id === id);
  if (index === -1) throw new AppError('NOT_FOUND', 'Transaction not found.', 404);
  const tx = state.transactions[index];
  applyEffect(state, tx, -1);
  state.transactions.splice(index, 1);
  return tx;
}

export function reconcileBalance(state, actualBalancePaise, note = '') {
  const actual = requireInt(actualBalancePaise, 'Bank balance', { min: 0 });
  const current = computeBankBalance(state);
  const diff = actual - current;
  if (diff === 0) return null;

  return addTransaction(state, {
    date: todayString(),
    description: note || 'Bank balance correction',
    amountPaise: Math.abs(diff),
    direction: diff > 0 ? 'in' : 'out',
    kind: 'adjustment',
    notes: 'Matches the app to the real bank balance.',
    source: 'reconcile',
  });
}

export function moveBetweenEnvelopes(state, { fromCategoryId = null, toCategoryId = null, amountPaise, note = '' }) {
  const amount = requireInt(amountPaise, 'Amount', { min: 1 });
  if (!fromCategoryId && !toCategoryId) {
    throw new AppError('INVALID_INPUT', 'Choose where the money comes from and where it goes.');
  }

  const from = fromCategoryId ? findCategory(state, fromCategoryId) : null;
  const to = toCategoryId ? findCategory(state, toCategoryId) : null;
  if (fromCategoryId && !from) throw new AppError('UNKNOWN_CATEGORY', 'That bucket no longer exists.');
  if (toCategoryId && !to) throw new AppError('UNKNOWN_CATEGORY', 'That bucket no longer exists.');
  if (from && to && from.id === to.id) {
    throw new AppError('INVALID_INPUT', 'Choose two different buckets.');
  }
  if ((from && from.archived) || (to && to.archived)) {
    throw new AppError('CATEGORY_ARCHIVED', 'That bucket is archived.');
  }

  if (from) {
    if (from.balancePaise < amount) {
      throw new AppError(
        'INSUFFICIENT_ENVELOPE',
        `Only ${rupeesText(from.balancePaise)} is available in ${from.name}.`
      );
    }
  } else {
    const unallocated = computeUnallocated(state);
    if (unallocated < amount) {
      throw new AppError(
        'INSUFFICIENT_UNALLOCATED',
        `Only ${rupeesText(Math.max(0, unallocated))} is not divided.`
      );
    }
  }

  if (from) from.balancePaise -= amount;
  if (to) to.balancePaise += amount;

  const move = {
    id: uid('mv'),
    fromCategoryId: from?.id ?? null,
    toCategoryId: to?.id ?? null,
    amountPaise: amount,
    note: String(note || '').slice(0, 160),
    createdAt: isoNow(),
  };
  state.moves.push(move);
  return move;
}

/**
 * One allocation per calendar month. On payday the app fills each envelope to
 * its monthly target. Rollover envelopes keep last month's leftover; the rest
 * reset. Anything left over is swept to the configured surplus envelope.
 */
export function allocateMonth(state, period = periodOf()) {
  const existing = state.allocations.find((a) => a.period === period);
  if (existing) {
    throw new AppError(
      'ALREADY_ALLOCATED',
      `This month is already divided. Undo that division first.`,
      409
    );
  }

  const plan = computePlan(state);
  if (!plan.flexPercentValid) {
    throw new AppError(
      'FLEX_PERCENT',
      `Your spending percentages add up to ${plan.flexPercentTotal}%. They need to equal 100%.`
    );
  }
  if (plan.overIncome) {
    throw new AppError(
      'PLAN_OVER_INCOME',
      `Your bills are more than your monthly salary.`
    );
  }

  const categories = activeCategories(state);
  if (categories.length === 0) {
    throw new AppError('NO_CATEGORIES', 'Add at least one bucket before dividing.');
  }

  const targets = targetMap(plan);
  const rows = categories.map((c) => {
    const target = targets.get(c.id) ?? 0;
    let desired;
    if (c.rollover) {
      desired = Math.max(target, c.balancePaise + target);
      if (c.capPaise !== null && c.capPaise !== undefined) {
        desired = Math.min(desired, c.capPaise);
      }
    } else {
      desired = target;
    }
    return {
      categoryId: c.id,
      targetPaise: target,
      deltaPaise: desired - c.balancePaise,
      reason: 'target',
    };
  });

  const available = computeUnallocated(state);
  const needs = rows.filter((r) => r.deltaPaise > 0).reduce((sum, r) => sum + r.deltaPaise, 0);
  const sweeps = rows.filter((r) => r.deltaPaise < 0).reduce((sum, r) => sum - r.deltaPaise, 0);
  const shortfall = needs - (available + sweeps);

  if (shortfall > 0) {
    throw new AppError(
      'INSUFFICIENT_FUNDS',
      `Not enough money to divide. You need ${rupeesText(shortfall)} more.`,
      409,
      { shortfallPaise: shortfall, needsPaise: needs, availablePaise: available, sweepsPaise: sweeps }
    );
  }

  for (const row of rows) {
    const category = findCategory(state, row.categoryId);
    category.balancePaise += row.deltaPaise;
  }

  let leftover = available + sweeps - needs;
  const surplusCategoryId = state.settings.surplusCategoryId;
  if (leftover > 0 && surplusCategoryId) {
    const surplus = findCategory(state, surplusCategoryId);
    if (surplus && !surplus.archived) {
      let amount = leftover;
      if (surplus.capPaise !== null && surplus.capPaise !== undefined) {
        amount = Math.min(amount, Math.max(0, surplus.capPaise - surplus.balancePaise));
      }
      if (amount > 0) {
        surplus.balancePaise += amount;
        leftover -= amount;
        rows.push({
          categoryId: surplus.id,
          targetPaise: targets.get(surplus.id) ?? 0,
          deltaPaise: amount,
          reason: 'surplus',
        });
      }
    }
  }

  const allocation = {
    id: uid('al'),
    period,
    createdAt: isoNow(),
    incomePaise: plan.incomePaise,
    plannedPaise: plan.totalPaise,
    availablePaise: available,
    fundedPaise: needs,
    sweptPaise: sweeps,
    surplusPaise: rows.filter((r) => r.reason === 'surplus').reduce((s, r) => s + r.deltaPaise, 0),
    leftoverPaise: leftover,
    items: rows,
  };
  state.allocations.push(allocation);
  return allocation;
}

export function undoAllocation(state, allocationId) {
  const index = state.allocations.findIndex((a) => a.id === allocationId);
  if (index === -1) throw new AppError('NOT_FOUND', 'Division not found.', 404);
  const allocation = state.allocations[index];

  if (!canUndoAllocation(state, allocationId)) {
    throw new AppError(
      'ALLOCATION_LOCKED',
      'Spending has been recorded since this division. Undoing it would leave buckets short — move money between buckets instead.'
    );
  }

  for (const item of allocation.items) {
    const category = findCategory(state, item.categoryId);
    if (category) category.balancePaise -= item.deltaPaise;
  }

  state.allocations.splice(index, 1);
  return allocation;
}

export function canUndoAllocation(state, allocationId) {
  const allocation = state.allocations.find((a) => a.id === allocationId);
  if (!allocation) return false;
  if (state.moves.some((move) => move.createdAt >= allocation.createdAt)) return false;
  return !state.transactions.some((t) => {
    if (t.createdAt < allocation.createdAt) return false;
    return !(t.kind === 'income' && t.direction === 'in');
  });
}

export function currentAllocation(state, period = periodOf()) {
  return state.allocations.find((a) => a.period === period) ?? null;
}

export function monthSummary(state, period = periodOf()) {
  const txs = state.transactions.filter((t) => t.date.startsWith(period));
  let incomePaise = 0;
  let spentPaise = 0;
  let investedPaise = 0;
  let savedPaise = 0;
  let loanPaidPaise = 0;
  const spentByCategory = {};
  const transferredByCategory = {};

  for (const t of txs) {
    if (t.kind === 'income') {
      incomePaise += t.direction === 'in' ? t.amountPaise : -t.amountPaise;
    }
    if (t.kind === 'expense') {
      const amount = t.direction === 'out' ? t.amountPaise : -t.amountPaise;
      spentPaise += amount;
      if (t.categoryId) {
        spentByCategory[t.categoryId] = (spentByCategory[t.categoryId] ?? 0) + amount;
      }
    }
    if (t.kind === 'transfer') {
      const amount = t.direction === 'out' ? t.amountPaise : -t.amountPaise;
      investedPaise += amount;
      const category = t.categoryId ? findCategory(state, t.categoryId) : null;
      if (category && categoryType(category) === 'loan') {
        loanPaidPaise += amount;
      } else {
        savedPaise += amount;
      }
      if (t.categoryId) {
        transferredByCategory[t.categoryId] =
          (transferredByCategory[t.categoryId] ?? 0) + amount;
      }
    }
  }

  return {
    period,
    incomePaise,
    spentPaise,
    investedPaise,
    savedPaise,
    loanPaidPaise,
    spentByCategory,
    transferredByCategory,
    transactionCount: txs.length,
  };
}

function sanitizeIcon(value) {
  const icon = String(value ?? '').trim();
  return icon ? icon.slice(0, 16) : '🏷️';
}

function sanitizeColor(value, index) {
  return typeof value === 'string' && COLOR_RE.test(value)
    ? value
    : CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

export const CATEGORY_COLORS = [
  '#b4643c',
  '#7d6a9e',
  '#23735f',
  '#3f6b8e',
  '#6c8a45',
  '#a8842f',
  '#b05f70',
  '#567797',
  '#c27642',
  '#8a8376',
];

/**
 * Saves the whole plan. Categories omitted from the payload are archived, but
 * only when their balance is zero. This keeps the ledger honest.
 */
export function savePlan(state, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('INVALID_INPUT', 'Plan payload missing.');
  }

  const incomePaise = requireInt(payload.monthlyIncomePaise, 'Monthly income', { min: 1 });
  const paydayDay = requireInt(payload.paydayDay ?? state.settings.paydayDay, 'Payday day', {
    min: 1,
    max: 28,
  });
  const incoming = payload.categories;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw new AppError('INVALID_INPUT', 'Keep at least one bucket.');
  }

  const activeExisting = new Map(
    state.categories.filter((c) => !c.archived).map((c) => [c.id, c])
  );

  const specs = incoming.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new AppError('INVALID_INPUT', 'One of the buckets is malformed.');
    }

    let existing = null;
    if (raw.id) {
      existing = activeExisting.get(raw.id);
      if (!existing) {
        throw new AppError('UNKNOWN_CATEGORY', 'A bucket no longer exists. Reload the page.');
      }
    }

    const kind = raw.kind;
    if (kind !== 'fixed' && kind !== 'flex') {
      throw new AppError('INVALID_INPUT', 'A bucket must be a bill or a spending bucket.');
    }
    const requestedType = raw.type ?? existing?.type;
    const validTypes = ['bill', 'saving', 'investment', 'loan', 'spending'];
    if (requestedType && !validTypes.includes(requestedType)) {
      throw new AppError('INVALID_INPUT', 'That bucket type is not recognised.');
    }
    if (kind === 'flex' && requestedType && requestedType !== 'spending') {
      throw new AppError('INVALID_INPUT', 'A spending bucket must be flexible.');
    }
    if (kind === 'fixed' && requestedType === 'spending') {
      throw new AppError('INVALID_INPUT', 'A spending bucket must be flexible.');
    }

    const name = String(raw.name ?? '').trim();
    if (!name) throw new AppError('INVALID_INPUT', 'Every bucket needs a name.');
    if (name.length > 40) throw new AppError('INVALID_INPUT', 'Bucket names must be 40 characters or fewer.');

    const targetPaise =
      kind === 'fixed'
        ? requireInt(raw.targetPaise ?? 0, `Amount for ${name}`, { min: 0 })
        : 0;
    const percent =
      kind === 'flex' ? requirePercent(raw.percent ?? 0, `Percentage for ${name}`) : 0;

    let capPaise = null;
    if (raw.capPaise !== undefined && raw.capPaise !== null && raw.capPaise !== '') {
      capPaise = requireInt(raw.capPaise, `Cap for ${name}`, { min: 0 });
    }
    if (
      kind === 'fixed' &&
      Boolean(raw.rollover) &&
      capPaise !== null &&
      capPaise < targetPaise
    ) {
      throw new AppError(
        'INVALID_CAP',
        `Max for "${name}" cannot be less than its monthly amount.`
      );
    }

    return {
      id: existing?.id ?? null,
      kind,
      type:
        kind === 'flex'
          ? 'spending'
          : raw.type === 'bill' ||
              raw.type === 'saving' ||
              raw.type === 'investment' ||
              raw.type === 'loan'
            ? raw.type
            : existing?.type
              ? existing.type
              : raw.rollover
                ? 'saving'
                : 'bill',
      name,
      targetPaise,
      percent,
      capPaise,
      rollover: Boolean(raw.rollover),
      icon: sanitizeIcon(raw.icon),
      color: sanitizeColor(raw.color, index),
    };
  });

  const seenNames = new Set();
  for (const spec of specs) {
    const key = spec.name.toLowerCase();
    if (seenNames.has(key)) {
      throw new AppError('DUPLICATE_NAME', `Two buckets are named "${spec.name}".`);
    }
    seenNames.add(key);
  }

  const flex = specs.filter((spec) => spec.kind === 'flex');
  const flexPercentTotal = Math.round(flex.reduce((sum, spec) => sum + spec.percent, 0) * 100) / 100;
  if (flex.length > 0 && Math.abs(flexPercentTotal - 100) > 0.01) {
    throw new AppError(
      'FLEX_PERCENT',
      `Your spending percentages add up to ${flexPercentTotal}%. They need to equal 100%.`
    );
  }

  const fixedTotalPaise = specs
    .filter((spec) => spec.kind === 'fixed')
    .reduce((sum, spec) => sum + spec.targetPaise, 0);
  if (fixedTotalPaise > incomePaise) {
    throw new AppError(
      'PLAN_OVER_INCOME',
      `Bills and savings (${rupeesText(fixedTotalPaise)}) are more than your monthly salary (${rupeesText(incomePaise)}).`
    );
  }

  const keptIds = new Set(specs.map((spec) => spec.id).filter(Boolean));
  for (const category of state.categories) {
    if (!category.archived && !keptIds.has(category.id) && category.balancePaise !== 0) {
      throw new AppError(
        'CATEGORY_HAS_BALANCE',
        `Move the ${rupeesText(category.balancePaise)} in "${category.name}" to another bucket before removing it.`
      );
    }
  }

  const now = isoNow();
  const saved = specs.map((spec, index) => {
    let category = spec.id ? findCategory(state, spec.id) : null;
    if (!category) {
      category = {
        id: uid('cat'),
        balancePaise: 0,
        archived: false,
        createdAt: now,
      };
      state.categories.push(category);
    }
    category.name = spec.name;
    category.kind = spec.kind;
    category.type = spec.type;
    category.targetPaise = spec.targetPaise;
    category.percent = spec.percent;
    category.rollover = spec.rollover;
    category.capPaise = spec.capPaise;
    category.icon = spec.icon;
    category.color = spec.color;
    category.sortOrder = index;
    return category;
  });

  const savedIds = new Set(saved.map((category) => category.id));
  for (const category of state.categories) {
    if (!category.archived && !savedIds.has(category.id)) {
      category.archived = true;
    }
  }

  let surplusCategoryId = payload.surplusCategoryId ?? state.settings.surplusCategoryId;
  if (surplusCategoryId && !savedIds.has(surplusCategoryId)) {
    surplusCategoryId = saved.find((category) => category.rollover)?.id ?? null;
  }
  if (surplusCategoryId) {
    const surplusCategory = saved.find((category) => category.id === surplusCategoryId);
    if (
      !surplusCategory ||
      ['spending', 'bill'].includes(categoryType(surplusCategory))
    ) {
      surplusCategoryId =
        saved.find((category) => categoryType(category) === 'saving')?.id ||
        saved.find((category) => categoryType(category) === 'investment')?.id ||
        saved.find((category) => categoryType(category) === 'loan')?.id ||
        null;
    }
  }

  state.settings.monthlyIncomePaise = incomePaise;
  state.settings.paydayDay = paydayDay;
  state.settings.surplusCategoryId = surplusCategoryId;

  return {
    incomePaise,
    fixedTotalPaise,
    flexPercentTotal,
    categories: saved,
  };
}

const ALERT_RULES = [
  [/\b(swiggy|zomato|restaurant|cafe|coffee|dominos|pizza)\b/i, 'fun'],
  [/\b(bigbasket|blinkit|zepto|dmart|grocer|supermarket|instamart)\b/i, 'groceries'],
  [/\b(uber|ola|rapido|metro|fuel|petrol|diesel|fastag|parking)\b/i, 'transport'],
  [/\b(rent|landlord|housing)\b/i, 'rent'],
  [/\b(emi|loan|credit card)\b/i, 'loan'],
  [/\b(myntra|ajio|zara|h&m|uniqlo|clothes|fashion)\b/i, 'clothes'],
  [/\b(amazon|flipkart|croma|reliance digital|electronics)\b/i, 'electronics'],
  [/\b(sip|mutual fund|zerodha|groww|upstox|invest|nps|ppf)\b/i, 'invest'],
];

const TYPE_FALLBACK_RULES = [
  [/\b(sip|mutual fund|zerodha|groww|upstox|invest|nps|ppf)\b/i, 'investment'],
  [/\b(emi|loan|credit card)\b/i, 'loan'],
  [/\b(rent|landlord|housing)\b/i, 'bill'],
  [/\b(emergency|savings)\b/i, 'saving'],
];

export function guessCategoryId(state, description, direction) {
  if (direction === 'in') return null;
  const text = String(description ?? '');
  for (const [pattern, id] of ALERT_RULES) {
    if (pattern.test(text) && state.categories.some((c) => c.id === id && !c.archived)) {
      return id;
    }
  }
  for (const [pattern, type] of TYPE_FALLBACK_RULES) {
    if (!pattern.test(text)) continue;
    const category = activeCategories(state).find((c) => categoryType(c) === type);
    if (category) return category.id;
  }
  const misc = state.categories.find((c) => c.id === 'misc' && !c.archived);
  if (misc) return misc.id;
  return activeCategories(state).find((c) => c.kind === 'flex')?.id ?? null;
}

export function rotateIngestToken(state) {
  state.settings.ingestToken = randomUUID().replace(/-/g, '');
  return state.settings.ingestToken;
}

export function monthlyCommitments(state, period = periodOf()) {
  const categories = activeCategories(state);
  const plan = computePlan(state);
  const planTargets = new Map(plan.items.map((item) => [item.categoryId, item.targetPaise]));
  const allocation = currentAllocation(state, period);
  const allocationTargets = new Map();

  if (allocation) {
    for (const item of allocation.items) {
      if (item.reason === 'target') {
        allocationTargets.set(item.categoryId, item.targetPaise);
      }
    }
  }

  const transactions = state.transactions.filter((t) => t.date.startsWith(period));
  const result = [];

  for (const category of categories) {
    const type = categoryType(category);
    if (type === 'spending') continue;

    const inDivision = Boolean(allocation && allocationTargets.has(category.id));
    const targetPaise = allocation
      ? inDivision
        ? allocationTargets.get(category.id)
        : planTargets.get(category.id) ?? 0
      : planTargets.get(category.id) ?? 0;

    let paidPaise = 0;
    for (const transaction of transactions) {
      if (transaction.categoryId !== category.id) continue;
      if (type === 'bill' && transaction.kind === 'expense') {
        paidPaise += transaction.direction === 'out' ? transaction.amountPaise : -transaction.amountPaise;
      } else if (type !== 'bill' && transaction.kind === 'transfer') {
        paidPaise += transaction.direction === 'out' ? transaction.amountPaise : -transaction.amountPaise;
      }
    }

    // Money kept in the bank as savings is considered saved once the month's
    // division funds it. Savings moved out to an external account also count.
    const fundedByDivision = type === 'saving' && inDivision && targetPaise > 0;
    if (fundedByDivision) paidPaise = targetPaise;

    let status;
    if (fundedByDivision) {
      status = 'done';
    } else if (targetPaise <= 0) {
      status = allocation && !inDivision ? 'not-in-division' : 'no-target';
    } else if (allocation && !inDivision) {
      status = paidPaise >= targetPaise ? 'done' : 'not-in-division';
    } else if (paidPaise < 0) {
      status = 'refunded';
    } else if (paidPaise === 0) {
      status = 'due';
    } else if (paidPaise < targetPaise) {
      status = 'partial';
    } else {
      status = 'done';
    }

    result.push({
      categoryId: category.id,
      type,
      period,
      targetPaise,
      paidPaise,
      remainingPaise: targetPaise > 0 ? Math.max(0, targetPaise - Math.max(0, paidPaise)) : 0,
      extraPaise: targetPaise > 0 ? Math.max(0, paidPaise - targetPaise) : 0,
      progress: targetPaise > 0 ? Math.min(1, Math.max(0, paidPaise / targetPaise)) : 0,
      status,
      inDivision,
      afterDivision: Boolean(allocation && !inDivision),
      fundedByDivision,
    });
  }

  return result;
}

export function clientState(state, period = periodOf()) {
  const copy = structuredClone(state);
  const plan = computePlan(state);
  const allocation = currentAllocation(state, period);

  copy.categories = copy.categories.map((category) => ({
    ...category,
    type: categoryType(category),
  }));

  copy.categories.sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.kind !== b.kind) return a.kind === 'fixed' ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
  copy.transactions.sort((a, b) => {
    if (a.date === b.date) return String(b.createdAt).localeCompare(String(a.createdAt));
    return b.date.localeCompare(a.date);
  });
  copy.allocations.sort((a, b) => b.period.localeCompare(a.period));

  return {
    ...copy,
    derived: {
      period,
      bankBalancePaise: computeBankBalance(state),
      unallocatedPaise: computeUnallocated(state),
      allocatedPaise: computeAllocated(state),
      plan,
      allocation: allocation
        ? { ...allocation, canUndo: canUndoAllocation(state, allocation.id) }
        : null,
      commitments: monthlyCommitments(state, period),
      summary: monthSummary(state, period),
      setupRequired: !state.settings.onboarded,
    },
  };
}

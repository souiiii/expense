import {peakFixedPlan} from '../public/schedule.js';
import { randomUUID } from 'node:crypto';
import { allocationDate, billSettled, billTarget, fundingTarget, paymentTotal, plannedBillTarget, prepareLedger, priorBills, replayBudgets, transactionPeriod, scheduledAmount, signed, plannedBillSpec } from './budget.js';

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
let lastIsoMs = 0;

// Timestamps are used to tell whether an investment's worth is older than its
// latest movement. A plain Date.now() can repeat within the same millisecond,
// so keep every call strictly ordered.
export const isoNow = () => {
  lastIsoMs = Math.max(Date.now(), lastIsoMs + 1);
  return new Date(lastIsoMs).toISOString();
};

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

export const STANDARD_BUCKET_TYPES = [
  {
    id: 'bill',
    name: 'Bills & Utilities',
    description: 'Rent, electricity, broadband, and fixed monthly bills.',
    kind: 'fixed',
    behavior: 'bill',
    defaultRollover: false,
    defaultCapPaise: null,
    defaultDueDay: null,
    allowSurplus: false,
    priority: 1,
    icon: '🏠',
    color: '#b4643c',
    sortOrder: 0,
  },
  {
    id: 'loan',
    name: 'Loans & EMIs',
    description: 'EMIs and fixed monthly repayments to lenders.',
    kind: 'fixed',
    behavior: 'loan',
    defaultRollover: false,
    defaultCapPaise: null,
    defaultDueDay: null,
    allowSurplus: true,
    priority: 1,
    icon: '🏦',
    color: '#7d6a9e',
    sortOrder: 1,
  },
  {
    id: 'saving',
    name: 'Savings Goals',
    description: 'Emergency fund and cash reserves kept in your bank.',
    kind: 'fixed',
    behavior: 'saving',
    defaultRollover: true,
    defaultCapPaise: null,
    defaultDueDay: null,
    allowSurplus: true,
    priority: 3,
    icon: '🛡️',
    color: '#3f6b8e',
    sortOrder: 2,
  },
  {
    id: 'investment',
    name: 'Investments',
    description: 'SIPs, PPF, stocks, gold, and holdings tracked separately from bank cash.',
    kind: 'fixed',
    behavior: 'investment',
    defaultRollover: true,
    defaultCapPaise: null,
    defaultDueDay: null,
    allowSurplus: true,
    priority: 4,
    icon: '📈',
    color: '#23735f',
    sortOrder: 3,
  },
  {
    id: 'spending',
    name: 'Everyday Spending',
    description: 'What is left after fixed commitments, split by percentage.',
    kind: 'flex',
    behavior: 'spending',
    defaultRollover: false,
    defaultCapPaise: null,
    defaultDueDay: null,
    allowSurplus: false,
    priority: 2,
    icon: '🛒',
    color: '#6c8a45',
    sortOrder: 4,
  },
];

export function ensureBucketTypes(state) {
  if (!Array.isArray(state.bucketTypes) || state.bucketTypes.length === 0) {
    state.bucketTypes = structuredClone(STANDARD_BUCKET_TYPES);
  }
  const existingIds = new Set(state.bucketTypes.map((bt) => bt.id));
  for (const c of state.categories || []) {
    if (c.archived) continue;
    const t = categoryType(c);
    const btId = c.bucketTypeId || t;
    if (!existingIds.has(btId)) {
      const std = STANDARD_BUCKET_TYPES.find((s) => s.id === btId) || STANDARD_BUCKET_TYPES.find((s) => s.id === t);
      if (std && !existingIds.has(std.id)) {
        state.bucketTypes.push({ ...std, sortOrder: state.bucketTypes.length });
        existingIds.add(std.id);
      }
    }
  }
  state.bucketTypes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'fixed' ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
  return state.bucketTypes;
}

export function saveBucketType(state, input) {
  if (!input || typeof input !== 'object') {
    throw new AppError('INVALID_INPUT', 'Bucket type details are required.');
  }
  ensureBucketTypes(state);
  const name = String(input.name ?? '').trim();
  if (!name) throw new AppError('INVALID_INPUT', 'Give the bucket type a name.');
  if (name.length > 40) throw new AppError('INVALID_INPUT', 'Bucket type name must be 40 characters or fewer.');

  const validBehaviors = ['bill', 'loan', 'saving', 'investment', 'spending'];
  const existing = input.id ? state.bucketTypes.find((bt) => bt.id === input.id) : null;
  if (input.id && !existing) throw new AppError('NOT_FOUND', 'Bucket type not found.', 404);

  const duplicate = state.bucketTypes.find((bt) => bt.id !== existing?.id && bt.name.toLowerCase() === name.toLowerCase());
  if (duplicate) throw new AppError('DUPLICATE_NAME', `A bucket type named "${name}" already exists.`);

  const behavior = input.behavior ?? existing?.behavior ?? 'bill';
  if (!validBehaviors.includes(behavior)) {
    throw new AppError('INVALID_INPUT', 'Choose how buckets in this type should work.');
  }
  const kind = behavior === 'spending' ? 'flex' : 'fixed';

  const behaviorChanged = Boolean(existing && existing.behavior !== behavior);
  if (behaviorChanged) {
    const members = state.categories.filter(c => (c.bucketTypeId || categoryType(c)) === existing.id);
    if (members.some(c => c.balancePaise || c.currentValuePaise || c.openingCostPaise || c.openingSavedPaise ||
        c.valuations?.length || c.externalSavingsAdjustments?.length ||
        (state.billOverrides || []).some(b => b.categoryId === c.id) ||
        state.transactions.some(t => t.categoryId === c.id) ||
        state.moves.some(m => m.fromCategoryId === c.id || m.toCategoryId === c.id) ||
        state.allocations.some(a => a.items.some(i => i.categoryId === c.id)) ||
        (state.planVersions || []).some(p => p.categories.some(i => i.id === c.id)))) {
      throw new AppError('TYPE_HAS_HISTORY', 'This type has financial history. Create a new type and bucket to use different behavior.');
    }
  }

  let defaultCapPaise = null;
  if (input.defaultCapPaise !== undefined && input.defaultCapPaise !== null && input.defaultCapPaise !== '') {
    defaultCapPaise = requireInt(input.defaultCapPaise, 'Default maximum cap', { min: 0 });
  }
  const defaultDueDay =
    ['bill', 'loan'].includes(behavior) && input.defaultDueDay
      ? requireInt(input.defaultDueDay, 'Default due day', { min: 1, max: 31 })
      : null;
  const priority = input.priority != null
    ? requireInt(input.priority, 'Funding priority', { min: 1, max: 4 })
    : existing?.priority ?? (['bill', 'loan'].includes(behavior) ? 1 : behavior === 'spending' ? 2 : behavior === 'saving' ? 3 : 4);
  const defaultRollover = Boolean(input.defaultRollover ?? existing?.defaultRollover ?? ['saving', 'investment'].includes(behavior));
  const allowSurplus = ['bill', 'spending'].includes(behavior)
    ? false
    : Boolean(input.allowSurplus ?? existing?.allowSurplus ?? true);
  const description = String(input.description ?? existing?.description ?? '').trim().slice(0, 140);
  const icon = sanitizeIcon(input.icon ?? existing?.icon);
  const color = sanitizeColor(input.color ?? existing?.color, state.bucketTypes.length);

  let bt = existing;
  if (!bt) {
    bt = {
      id: uid('bt'),
      sortOrder: state.bucketTypes.length,
    };
    state.bucketTypes.push(bt);
  }
  bt.name = name;
  bt.description = description;
  bt.kind = kind;
  bt.behavior = behavior;
  bt.defaultRollover = defaultRollover;
  bt.defaultCapPaise = defaultCapPaise;
  bt.defaultDueDay = defaultDueDay;
  bt.allowSurplus = allowSurplus;
  bt.priority = priority;
  bt.icon = icon;
  bt.color = color;

  if (behaviorChanged) {
    for (const c of state.categories) {
      if (c.archived || (c.bucketTypeId || categoryType(c)) !== bt.id) continue;
      c.type = bt.behavior;
      c.kind = bt.kind;
      if (bt.kind === 'flex') {
        c.targetPaise = 0;
        if (!c.percent) c.percent = 10;
      } else {
        c.percent = 0;
      }
    }
    const flexLeft = state.categories.filter((c) => !c.archived && c.kind === 'flex');
    if (flexLeft.length > 0) {
      const sum = flexLeft.reduce((n, c) => n + c.percent, 0);
      if (Math.abs(sum - 100) > 0.01) {
        let running = 0;
        flexLeft.forEach((c, idx) => {
          if (idx === flexLeft.length - 1) {
            c.percent = Math.max(0, Math.round((100 - running) * 100) / 100);
          } else {
            const share = sum > 0 ? Math.round(((c.percent / sum) * 100) * 2) / 2 : Math.round((100 / flexLeft.length) * 2) / 2;
            const bounded = Math.min(Math.max(0, 100 - running), Math.max(0, share));
            c.percent = bounded;
            running += bounded;
          }
        });
      }
    }
  }

  if (input.applyToExisting) {
    for (const c of state.categories) {
      if (c.archived || (c.bucketTypeId || categoryType(c)) !== bt.id) continue;
      c.rollover = bt.defaultRollover;
      if (bt.defaultCapPaise !== null) {
        c.capPaise = c.kind === 'fixed' && c.rollover ? Math.max(bt.defaultCapPaise, c.targetPaise) : bt.defaultCapPaise;
      } else {
        c.capPaise = null;
      }
      if (['bill', 'loan'].includes(bt.behavior)) {
        c.dueDay = bt.defaultDueDay;
      }
    }
  }

  if (!existing && input.initialBucketName && String(input.initialBucketName).trim()) {
    const bucketName = String(input.initialBucketName).trim();
    if (bucketName.length > 40) {
      throw new AppError('INVALID_INPUT', 'Bucket names must be 40 characters or fewer.');
    }
    if (state.categories.some((c) => !c.archived && c.name.toLowerCase() === bucketName.toLowerCase())) {
      throw new AppError('DUPLICATE_NAME', `A bucket named "${bucketName}" already exists.`);
    }
    const isFlex = bt.kind === 'flex';
    const targetPaise = isFlex ? 0 : requireInt(input.initialTargetPaise ?? 0, `Amount for ${bucketName}`, { min: 0 });
    const fixedTotal = peakFixedPlan([...activeCategories(state), {kind: bt.kind, type: bt.behavior, targetPaise, ...normalizeSchedule({...input, priority: null, rollover: bt.defaultRollover}, null, bt.behavior)}], periodOf()).amountPaise;
    if (!isFlex && fixedTotal > state.settings.monthlyIncomePaise) {
      throw new AppError(
        'PLAN_OVER_INCOME',
        `Adding ${rupeesText(targetPaise)} would exceed your monthly salary (${rupeesText(state.settings.monthlyIncomePaise)}).`
      );
    }
    let percent = isFlex ? requirePercent(input.initialPercent ?? 10, `Percentage for ${bucketName}`) : 0;
    if (isFlex) {
      const flexCats = state.categories.filter((c) => !c.archived && c.kind === 'flex');
      if (flexCats.length === 0) {
        percent = 100;
      } else {
        const remainder = Math.max(0, 100 - percent);
        const oldSum = flexCats.reduce((n, c) => n + c.percent, 0);
        let running = 0;
        flexCats.forEach((c, idx) => {
          if (idx === flexCats.length - 1) {
            c.percent = Math.max(0, Math.round((remainder - running) * 100) / 100);
          } else {
            const share = oldSum > 0 ? Math.round(((c.percent / oldSum) * remainder) * 2) / 2 : Math.round((remainder / flexCats.length) * 2) / 2;
            const bounded = Math.min(Math.max(0, remainder - running), Math.max(0, share));
            c.percent = bounded;
            running += bounded;
          }
        });
      }
    }
    const capPaise =
      bt.defaultCapPaise != null
        ? (!isFlex && bt.defaultRollover ? Math.max(bt.defaultCapPaise, targetPaise) : bt.defaultCapPaise)
        : null;
    prepareLedger(state);
    const newCat = {
      id: uid('cat'),
      name: bucketName,
      kind: bt.kind,
      type: bt.behavior,
      bucketTypeId: bt.id,
      targetPaise,
      percent,
      rollover: bt.defaultRollover,
      capPaise,
      dueDay: bt.defaultDueDay,
      icon: bt.icon,
      color: bt.color,
      balancePaise: 0,
      archived: false,
      historyComplete: false,
      createdAt: isoNow(),
      sortOrder: state.categories.length,
      ...normalizeSchedule({...input, priority: null, rollover: bt.defaultRollover}, null, bt.behavior),
    };
    state.categories.push(newCat);
    state.budgetBase[newCat.id] = 0;
    includeNewBill(state, newCat);
  }

  ensureBucketTypes(state);
  return bt;
}

export function deleteBucketType(state, id) {
  ensureBucketTypes(state);
  const index = state.bucketTypes.findIndex((bt) => bt.id === id);
  if (index === -1) throw new AppError('NOT_FOUND', 'Bucket type not found.', 404);
  if (state.bucketTypes.length <= 1) {
    throw new AppError('INVALID_INPUT', 'Keep at least one bucket type.');
  }

  const members = state.categories.filter((c) => !c.archived && (c.bucketTypeId || categoryType(c)) === id);
  const remainingActive = state.categories.filter((c) => !c.archived && !members.includes(c));
  if (remainingActive.length === 0) {
    throw new AppError('INVALID_INPUT', 'Keep at least one active bucket in your plan.');
  }

  const commitments = monthlyCommitments(state);
  const pendingPeriod = state.allocations.map((a) => a.period).filter((p) => p > periodOf()).sort().at(-1);
  const pendingView = pendingPeriod ? structuredClone(state) : null;
  if (pendingView) replayBudgets(pendingView, pendingPeriod);

  for (const category of members) {
    if (categoryType(category) === 'saving' && externalSavings(state, category.id) !== 0) {
      throw new AppError('EXTERNAL_SAVINGS_REMAIN', `"${category.name}" still holds external savings. Keep this goal until that balance is withdrawn or corrected.`);
    }
    if (category.balancePaise !== 0) {
      throw new AppError(
        'CATEGORY_HAS_BALANCE',
        `Move the ${rupeesText(category.balancePaise)} in "${category.name}" to another bucket before removing this bucket type.`
      );
    }
    if (pendingView && findCategory(pendingView, category.id)?.balancePaise) {
      throw new AppError('PENDING_BALANCE', `"${category.name}" has money reserved next month. Move that money before removing this bucket type.`);
    }
    const commitment = commitments.find((c) => c.categoryId === category.id);
    if (
      (state.allocations.length || state.planVersions?.length) &&
      ['bill', 'loan'].includes(categoryType(category)) &&
      commitment &&
      (commitment.remainingPaise || commitment.overduePaise)
    ) {
      throw new AppError('BILL_STILL_DUE', `Settle or cancel the outstanding bills for "${category.name}" before removing this bucket type.`);
    }
  }

  for (const category of members) {
    category.archived = true;
  }

  const flexLeft = state.categories.filter((c) => !c.archived && c.kind === 'flex');
  if (flexLeft.length > 0) {
    const sum = flexLeft.reduce((n, c) => n + c.percent, 0);
    if (Math.abs(sum - 100) > 0.01) {
      let running = 0;
      flexLeft.forEach((c, idx) => {
        if (idx === flexLeft.length - 1) {
          c.percent = Math.round((100 - running) * 100) / 100;
        } else {
          const share = sum > 0 ? Math.round(((c.percent / sum) * 100) * 100) / 100 : Math.round((100 / flexLeft.length) * 100) / 100;
          c.percent = share;
          running += share;
        }
      });
    }
  }

  const [removed] = state.bucketTypes.splice(index, 1);
  return removed;
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
  return state.categories.reduce((sum, c) => sum + c.balancePaise, state.futureReservedPaise || 0);
}

export function computeUnallocated(state) {
  return computeBankBalance(state) - computeAllocated(state);
}

/**
 * The plan is a monthly intention, not a live percentage of the bank balance.
 * Fixed envelopes are rupee amounts. Flexible envelopes split what is left.
 */
export function computePlan(state, period = periodOf()) {
  const categories = activeCategories(state);
  const fixed = categories.filter((c) => c.kind === 'fixed');
  const flex = categories.filter((c) => c.kind === 'flex');

  const incomePaise = state.settings.monthlyIncomePaise;
  const fixedTarget = c => ['bill', 'loan'].includes(categoryType(c)) ? scheduledAmount(c, period) : c.targetPaise;
  const fixedTotalPaise = fixed.reduce((sum, c) => sum + fixedTarget(c), 0);
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
    targetPaise: c.kind === 'fixed' ? fixedTarget(c) : targetById.get(c.id) ?? 0,
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

function normalizeTransaction(state, input, existing = null) {
  const date = input.date ?? existing?.date ?? todayString();
  if (!isValidDate(date)) {
    throw new AppError('INVALID_DATE', 'Date must be a real date in YYYY-MM-DD format.');
  }
  if (date > todayString()) {
    throw new AppError('INVALID_DATE', 'Date cannot be in the future. Add it when the money actually moves.');
  }
  if (state.settings.openingDate && date < state.settings.openingDate && (!existing || date !== existing.date)) {
    throw new AppError('BEFORE_OPENING', 'That date is already included in your opening balance. Record a correction today instead.');
  }
  if (state.historyStartsAt && date < state.historyStartsAt) {
    throw new AppError('LEGACY_HISTORY', 'This entry predates the saved budget rules. Record a correction today to preserve your existing balances.');
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
    if (category.archived && direction !== 'in' && !(category.id === existing?.categoryId && existing.direction === 'out')) {
      throw new AppError('CATEGORY_ARCHIVED', 'That bucket is archived.');
    }

    const type = categoryType(category);
    if (kind === 'expense' && type !== 'spending' && type !== 'bill') {
      throw new AppError(
        'TYPE_MISMATCH',
        `"${category.name}" only accepts "Moved out" or "Withdrawal", not "Spent".`
      );
    }
    if (kind === 'transfer' && type !== 'saving' && type !== 'investment' && type !== 'loan') {
      throw new AppError(
        'TYPE_MISMATCH',
        `"${category.name}" only accepts "Spent" or "Refund", not "Moved out".`
      );
    }
  }

  const notes = input.notes !== undefined ? String(input.notes).slice(0, 300) : existing?.notes ?? '';
  const budgetPeriod = input.budgetPeriod ?? (existing && existing.budgetPeriod && existing.budgetPeriod !== periodOf(existing.date) ? existing.budgetPeriod : periodOf(date));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(budgetPeriod)) throw new AppError('INVALID_PERIOD', 'Choose a valid budget month.');

  return {
    date,
    description,
    amountPaise,
    direction,
    kind,
    categoryId,
    notes,
    budgetPeriod,
    externalSaving: categoryId && categoryType(findCategory(state, categoryId)) === 'saving' && kind === 'transfer'
      ? (existing && existing.categoryId === categoryId && existing.kind === kind ? Boolean(existing.externalSaving) : true) : false,
    unassignedReturn: Boolean(categoryId && direction === 'in' && (findCategory(state, categoryId).archived ||
      (existing?.unassignedReturn && existing.categoryId === categoryId))),
    reversalOf: existing?.reversalOf ?? null,
    source: existing?.source ?? input.source ?? 'manual',
    externalId: existing?.externalId ?? (input.externalId ? String(input.externalId).slice(0, 120) : null),
  };
}

export function addTransaction(state, input) {
  prepareLedger(state);
  const tx = {
    id: uid('tx'),
    ...normalizeTransaction(state, input),
    createdAt: isoNow(),
  };

  if (tx.externalId && state.transactions.some((t) => t.externalId === tx.externalId)) {
    throw new AppError('DUPLICATE', 'This transaction was already recorded.', 409);
  }

  state.transactions.push(tx);
  replayBudgets(state);
  invalidateWorth(state, tx.categoryId, tx.date);
  return tx;
}

export function updateTransaction(state, id, input) {
  prepareLedger(state);
  const index = state.transactions.findIndex((t) => t.id === id);
  if (index === -1) throw new AppError('NOT_FOUND', 'Transaction not found.', 404);

  const old = state.transactions[index];
  if (old.reversalOf || state.transactions.some(t => t.reversalOf === id)) throw new AppError('LINKED_REVERSAL', 'Delete the reversal before editing this payment.');
  const normalized = normalizeTransaction(state, input, old);
  if (old.correctionId && (normalized.amountPaise !== old.amountPaise || normalized.direction !== old.direction)) {
    throw new AppError('CLASSIFIED_AMOUNT', 'Delete this classification and identify the correction again to split or change its amount.');
  }

  const updated = {
    ...old,
    ...normalized,
    id: old.id,
    createdAt: old.createdAt,
    updatedAt: isoNow(),
  };
  state.transactions[index] = updated;
  replayBudgets(state);
  invalidateWorth(state, old.categoryId, old.date);
  invalidateWorth(state, updated.categoryId, updated.date);
  return updated;
}

export function deleteTransaction(state, id) {
  prepareLedger(state);
  const index = state.transactions.findIndex((t) => t.id === id);
  if (index === -1) throw new AppError('NOT_FOUND', 'Transaction not found.', 404);
  const tx = state.transactions[index];
  if (state.transactions.some(t => t.reversalOf === id)) throw new AppError('LINKED_REVERSAL', 'Delete the reversal before deleting this payment.');
  if (state.historyStartsAt && tx.date < state.historyStartsAt) throw new AppError('LEGACY_HISTORY', 'Record a correction today for an entry from your older budget history.');
  state.transactions.splice(index, 1);
  if (tx.correctionId) {
    const remainder = state.transactions.find(t => t.id === tx.correctionId && t.kind === 'adjustment');
    if (remainder) remainder.amountPaise += tx.amountPaise;
    else state.transactions.push({id: tx.correctionId, date: tx.correctionDate || tx.date, createdAt: tx.correctionCreatedAt || tx.createdAt,
      description: 'Unidentified balance difference', amountPaise: tx.amountPaise, direction: tx.direction, kind: 'adjustment', categoryId: null, source: 'reconcile', notes: ''});
  }
  replayBudgets(state);
  invalidateWorth(state, tx.categoryId, tx.date);
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

export function moveBetweenEnvelopes(state, { fromCategoryId = null, toCategoryId = null, amountPaise, note = '', period = periodOf() }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError('INVALID_PERIOD', 'Choose a valid month.');
  prepareLedger(state);
  replayBudgets(state);
  const amount = requireInt(amountPaise, 'Amount', { min: 1 });
  if (!fromCategoryId && !toCategoryId) {
    throw new AppError('INVALID_INPUT', 'Choose where the money comes from and where it goes.');
  }

  const view = structuredClone(state);
  if (period > periodOf()) replayBudgets(view, period);
  const from = fromCategoryId ? findCategory(view, fromCategoryId) : null;
  const to = toCategoryId ? findCategory(view, toCategoryId) : null;
  if (fromCategoryId && !from) throw new AppError('UNKNOWN_CATEGORY', 'That bucket no longer exists.');
  if (toCategoryId && !to) throw new AppError('UNKNOWN_CATEGORY', 'That bucket no longer exists.');
  if (from && to && from.id === to.id) {
    throw new AppError('INVALID_INPUT', 'Choose two different buckets.');
  }
  if (to && to.archived) {
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

  const move = {
    id: uid('mv'),
    fromCategoryId: from?.id ?? null,
    toCategoryId: to?.id ?? null,
    amountPaise: amount,
    note: String(note || '').slice(0, 160),
    date: allocationDate(period, todayString()),
    createdAt: isoNow(),
  };
  state.moves.push(move);
  replayBudgets(state);
  return move;
}

/**
 * One allocation per calendar month. On payday the app fills each envelope to
 * its monthly target. Rollover envelopes keep last month's leftover; the rest
 * reset. Anything left over is swept to the configured surplus envelope.
 */
export function allocateMonth(state, period = periodOf(), { partial = false } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError('INVALID_PERIOD', 'Choose a valid month.');
  const draft = structuredClone(state);
  prepareLedger(draft);
  replayBudgets(draft);
  let allocation = currentAllocation(draft, period);
  if (allocation && (!partial || !allocation.snapshot)) throw new AppError('ALREADY_ALLOCATED', 'This month is already funded. Use Top up or Move money.', 409);
  const plan = computePlan(draft, period);
  if (!plan.flexPercentValid) throw new AppError('FLEX_PERCENT', 'Spending shares must add up to 100%.');
  if (plan.overIncome) throw new AppError('PLAN_OVER_INCOME', 'The plan is larger than your expected salary.');
  const categories = activeCategories(draft);
  if (!categories.length) throw new AppError('NO_CATEGORIES', 'Add a bucket first.');
  const createdAt = isoNow();
  if (!allocation) {
    allocation = {
      id: uid('al'), period, createdAt, incomePaise: plan.incomePaise, plannedPaise: plan.totalPaise,
      snapshot: {surplusCategoryId: draft.settings.surplusCategoryId, categories: categories.map(c => ({
        id: c.id, name: c.name, type: categoryType(c), bucketTypeId: c.bucketTypeId || categoryType(c), kind: c.kind, rollover: c.rollover,
        capPaise: c.capPaise, dueDay: c.dueDay || null,
        frequency: c.frequency || 'monthly', startPeriod: c.startPeriod || null, endPeriod: c.endPeriod || null,
        recurringAmountPaise: c.targetPaise, priority: fundingPriority(draft, c),
        includeInDailyGuide: c.includeInDailyGuide ?? !c.rollover,
        targetPaise: plan.items.find(i => i.categoryId === c.id)?.targetPaise || 0,
      }))},
      fundings: [], items: [],
    };
    draft.allocations.push(allocation);
  }
  const requested = Object.fromEntries(allocation.snapshot.categories.map(c => {
    const funded = allocation.items.find(i => i.reason === 'target' && i.categoryId === c.id)?.fundedPaise || 0;
    const balance = findCategory(draft, c.id).balancePaise;
    let remaining = Math.max(0, fundingTarget(draft, c.id, period, c.targetPaise) - funded);
    if (allocation.fundings.length && c.capPaise != null) remaining = Math.min(remaining, Math.max(0, c.capPaise - balance));
    return [c.id, remaining];
  }));
  const funding = {id: uid('fund'), date: allocationDate(period, todayString()), createdAt, amounts: {...requested}, sweep: !partial};
  allocation.fundings.push(funding);
  replayBudgets(draft);
  const shortfall = Math.max(0, -computeUnallocated(draft));
  if (shortfall && !partial) throw new AppError('INSUFFICIENT_FUNDS', `The full plan needs ${rupeesText(shortfall)} more. You can fund essentials now.`, 409, {shortfallPaise: shortfall});
  if (partial) {
    funding.amounts = Object.fromEntries(Object.keys(requested).map(id => [id, 0]));
    replayBudgets(draft);
    // Old snapshots retain their original order; new snapshots store the user's priorities.
    const priority = c => c.priority ?? (['bill', 'loan'].includes(c.type) ? 1 : ['groceries', 'transport', 'misc'].includes(c.id) ? 2 : c.type === 'saving' ? 3 : c.type === 'investment' ? 4 : 5);
    for (const c of [...allocation.snapshot.categories].sort((a, b) => priority(a) - priority(b))) {
      funding.amounts[c.id] = Math.min(requested[c.id], Math.max(0, computeUnallocated(draft)));
      replayBudgets(draft);
    }
    if (computeUnallocated(draft) < 0) throw new AppError('INSUFFICIENT_FUNDS', 'Cover the existing shortage before funding this month.', 409);
    if (allocation.fundings.length > 1 && !Object.values(funding.amounts).some(n => n > 0)) throw new AppError('NO_FUNDING', 'No additional funding is needed, or no unassigned money is available.');
  }
  Object.assign(state, draft);
  return currentAllocation(state, period);
}

export function fundingPreview(state, period = periodOf()) {
  const existing = currentAllocation(state, period);
  if (existing && !existing.snapshot) return {legacy: true, shortfallPaise: 0, items: []};
  let shortfallPaise = 0;
  let draft = structuredClone(state);
  try { allocateMonth(draft, period, {partial: Boolean(existing)}); }
  catch (error) {
    if (error.code !== 'INSUFFICIENT_FUNDS' && error.code !== 'NO_FUNDING') return {error: error.message, items: []};
    shortfallPaise = error.details?.shortfallPaise || 0;
    draft = structuredClone(state);
    try { allocateMonth(draft, period, {partial: true}); } catch { return {shortfallPaise, items: []}; }
  }
  const allocation = currentAllocation(draft, period);
  const fundedView = structuredClone(draft);
  if (period > periodOf()) replayBudgets(fundedView, period);
  return {shortfallPaise, remainingPaise: allocation?.remainingPaise || 0, items: (allocation?.items || []).filter(i => i.reason === 'target').map(i => ({
    ...i, name: findCategory(draft, i.categoryId)?.name,
    priority: allocation.snapshot?.categories.find(c => c.id === i.categoryId)?.priority ?? fundingPriority(draft, findCategory(draft, i.categoryId)),
    beforePaise: findCategory(state, i.categoryId)?.balancePaise || 0,
    afterPaise: findCategory(fundedView, i.categoryId)?.balancePaise || 0,
  })).sort((a,b) => a.priority - b.priority)};
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

  prepareLedger(state);
  state.allocations.splice(index, 1);
  replayBudgets(state);
  return allocation;
}

export function canUndoAllocation(state, allocationId) {
  const allocation = state.allocations.find((a) => a.id === allocationId);
  if (!allocation) return false;
  if (state.allocations.some(a => a !== allocation && a.createdAt > allocation.createdAt)) return false;
  if (state.moves.some((move) => move.createdAt >= allocation.createdAt)) return false;
  return !state.transactions.some((t) => {
    if ((t.updatedAt || t.createdAt) < allocation.createdAt) return false;
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
  let grossSpentPaise = 0;
  let refundedPaise = 0;
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
      if (t.direction === 'out') grossSpentPaise += t.amountPaise;
      else refundedPaise += t.amountPaise;
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
    grossSpentPaise,
    refundedPaise,
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
function normalizeSchedule(raw, existing, type) {
  const isBill = ['bill', 'loan'].includes(type);
  const frequency = isBill ? raw.frequency ?? existing?.frequency ?? 'monthly' : 'monthly';
  if (!['monthly', 'quarterly', 'yearly', 'once'].includes(frequency)) throw new AppError('INVALID_SCHEDULE', 'Choose a supported bill frequency.');
  const startPeriod = isBill ? raw.startPeriod || existing?.startPeriod || (existing ? null : periodOf()) : null;
  const endPeriod = isBill ? (raw.endPeriod !== undefined ? raw.endPeriod || null : existing?.endPeriod || null) : null;
  for (const p of [startPeriod, endPeriod]) if (p && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new AppError('INVALID_SCHEDULE', 'Choose a valid start or end month.');
  if (frequency !== 'monthly' && !startPeriod) throw new AppError('INVALID_SCHEDULE', 'Choose the first due month for this bill.');
  if (startPeriod && endPeriod && endPeriod < startPeriod) throw new AppError('INVALID_SCHEDULE', 'The end month cannot be before the start month.');
  const priority = raw.priority === '' || raw.priority === null ? null : raw.priority === undefined ? existing?.priority ?? null : requireInt(raw.priority, 'Funding priority', {min: 1, max: 4});
  if (raw.includeInDailyGuide != null && typeof raw.includeInDailyGuide !== 'boolean') throw new AppError('INVALID_INPUT', 'Daily guide inclusion must be true or false.');
  return {frequency, startPeriod, endPeriod, priority,
    includeInDailyGuide: raw.includeInDailyGuide ?? existing?.includeInDailyGuide ?? !Boolean(raw.rollover ?? existing?.rollover)};
}

function fundingPriority(state, category) {
  return category.priority ?? state.bucketTypes?.find(bt => bt.id === (category.bucketTypeId || categoryType(category)))?.priority ??
    (['bill', 'loan'].includes(categoryType(category)) ? 1 : categoryType(category) === 'spending' ? 2 : categoryType(category) === 'saving' ? 3 : 4);
}

function includeNewBill(state, category) {
  if (!['bill', 'loan'].includes(categoryType(category))) return;
  // Only new obligations amend saved budgets. Old funding instalments have no
  // amount for the new bucket, so existing balances remain unchanged.
  for (const allocation of state.allocations.filter(a => a.period >= periodOf() && (!category.startPeriod || a.period >= category.startPeriod))) {
    if (allocation.snapshot && !allocation.snapshot.categories.some(c => c.id === category.id)) {
      allocation.snapshot.categories.push({...category, targetPaise: scheduledAmount(category, allocation.period),
        recurringAmountPaise: category.targetPaise, priority: fundingPriority(state, category)});
    } else if (!allocation.snapshot) {
      state.billOverrides ||= [];
      state.billOverrides.push({categoryId: category.id, period: allocation.period, amountPaise: scheduledAmount(category, allocation.period), settled: false, date: todayString()});
    }
  }
  replayBudgets(state);
}

export function savePlan(state, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('INVALID_INPUT', 'Plan payload missing.');
  }

  const incomePaise = requireInt(payload.monthlyIncomePaise, 'Monthly income', { min: 1 });
  const paydayDay = requireInt(payload.paydayDay ?? state.settings.paydayDay, 'Payday day', {
    min: 1,
    max: 31,
  });
  const incoming = payload.categories;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw new AppError('INVALID_INPUT', 'Keep at least one bucket.');
  }

  ensureBucketTypes(state);
  const bucketTypeMap = new Map(state.bucketTypes.map((bt) => [bt.id, bt]));

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

    const customBt = bucketTypeMap.get(raw.bucketTypeId || raw.type);
    const kind = raw.kind ?? customBt?.kind;
    if (kind !== 'fixed' && kind !== 'flex') {
      throw new AppError('INVALID_INPUT', 'A bucket must be a bill or a spending bucket.');
    }
    const requestedType = customBt ? customBt.behavior : (raw.type ?? existing?.type);
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

    if (existing && requestedType && requestedType !== categoryType(existing)) throw new AppError('TYPE_CHANGE', 'Create a new bucket to change its type.');
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

    const resolvedType =
      kind === 'flex'
        ? 'spending'
        : requestedType === 'bill' ||
            requestedType === 'saving' ||
            requestedType === 'investment' ||
            requestedType === 'loan'
          ? requestedType
          : existing?.type
            ? existing.type
            : raw.rollover
              ? 'saving'
              : 'bill';

    const resolvedBucketTypeId =
      customBt?.id ||
      (raw.bucketTypeId && bucketTypeMap.has(raw.bucketTypeId) ? raw.bucketTypeId : null) ||
      existing?.bucketTypeId ||
      resolvedType;

    let openingCostPaise = existing?.openingCostPaise;
    let historyComplete = existing?.historyComplete;
    let historyConfirmed = existing?.historyConfirmed;
    if (resolvedType === 'investment' && raw.openingCostPaise !== undefined) {
      if (raw.openingCostPaise === null || raw.openingCostPaise === '') {
        // leave unchanged unless explicitly cleared
      } else {
        openingCostPaise = requireInt(raw.openingCostPaise, `Opening invested amount for ${name}`, { min: 0 });
        historyComplete = true;
        historyConfirmed = true;
      }
    }
    let openingSavedPaise = existing?.openingSavedPaise ?? 0;
    if (resolvedType === 'saving' && raw.openingSavedPaise !== undefined && raw.openingSavedPaise !== null && raw.openingSavedPaise !== '') {
      openingSavedPaise = requireInt(raw.openingSavedPaise, `Opening saved amount for ${name}`, { min: 0 });
    }

    return {
      id: existing?.id ?? null,
      kind,
      type: resolvedType,
      bucketTypeId: resolvedBucketTypeId,
      name,
      targetPaise,
      percent,
      capPaise,
      rollover: Boolean(raw.rollover),
      dueDay: raw.dueDay ? requireInt(raw.dueDay, 'Due day', {min: 1, max: 31}) : null,
      openingCostPaise,
      historyComplete,
      historyConfirmed,
      openingSavedPaise,
      ...normalizeSchedule(raw, existing, resolvedType),
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

  const peak = peakFixedPlan(specs, periodOf());
  const fixedTotalPaise = peak.amountPaise;
  if (fixedTotalPaise > incomePaise) {
    throw new AppError(
      'PLAN_OVER_INCOME',
      `Bills and savings in ${peak.period} (${rupeesText(fixedTotalPaise)}) are more than your monthly salary (${rupeesText(incomePaise)}).`
    );
  }

  const keptIds = new Set(specs.map((spec) => spec.id).filter(Boolean));
  const commitments = monthlyCommitments(state);
  const pendingPeriod = state.allocations.map(a => a.period).filter(p => p > periodOf()).sort().at(-1);
  const pendingView = pendingPeriod ? structuredClone(state) : null;
  if (pendingView) replayBudgets(pendingView, pendingPeriod);
  for (const category of state.categories) {
    if (!category.archived && !keptIds.has(category.id) && categoryType(category) === 'saving' && externalSavings(state, category.id) !== 0) {
      throw new AppError('EXTERNAL_SAVINGS_REMAIN', `"${category.name}" still holds external savings. Keep this goal until that balance is withdrawn or corrected.`);
    }
    if (!category.archived && !keptIds.has(category.id) && category.balancePaise !== 0) {
      throw new AppError(
        'CATEGORY_HAS_BALANCE',
        `Move the ${rupeesText(category.balancePaise)} in "${category.name}" to another bucket before removing it.`
      );
    }
    if (!category.archived && !keptIds.has(category.id) && pendingView && findCategory(pendingView, category.id)?.balancePaise) {
      throw new AppError('PENDING_BALANCE', `"${category.name}" has money reserved next month. Move that money before removing it.`);
    }
    const commitment = commitments.find(c => c.categoryId === category.id);
    if (!category.archived && !keptIds.has(category.id) && (state.allocations.length || state.planVersions?.length) &&
        ['bill', 'loan'].includes(categoryType(category)) && commitment && (commitment.remainingPaise || commitment.overduePaise)) {
      throw new AppError('BILL_STILL_DUE', `Settle or cancel the outstanding bills for "${category.name}" before removing it.`);
    }
  }

  prepareLedger(state);
  const now = isoNow();
  const saved = specs.map((spec, index) => {
    let category = spec.id ? findCategory(state, spec.id) : null;
    if (!category) {
      category = {
        id: uid('cat'),
        balancePaise: 0,
        archived: false,
        historyComplete: false,
        createdAt: now,
      };
      state.categories.push(category);
    }
    category.name = spec.name;
    category.kind = spec.kind;
    category.type = spec.type;
    category.bucketTypeId = spec.bucketTypeId;
    category.targetPaise = spec.targetPaise;
    category.percent = spec.percent;
    category.rollover = spec.rollover;
    category.capPaise = spec.capPaise;
    category.icon = spec.icon;
    category.color = spec.color;
    category.sortOrder = index;
    category.dueDay = spec.dueDay;
    if (spec.openingCostPaise !== undefined) category.openingCostPaise = spec.openingCostPaise;
    if (spec.historyComplete !== undefined) category.historyComplete = spec.historyComplete;
    if (spec.historyConfirmed !== undefined) category.historyConfirmed = spec.historyConfirmed;
    if (spec.openingSavedPaise !== undefined && spec.openingSavedPaise !== category.openingSavedPaise) category.openingSavedPaise = spec.openingSavedPaise;
    Object.assign(category, {frequency: spec.frequency, startPeriod: spec.startPeriod, endPeriod: spec.endPeriod,
      priority: spec.priority, includeInDailyGuide: spec.includeInDailyGuide});
    if (categoryType(category) === 'investment' && category.historyComplete === undefined && !category.createdAt) category.historyComplete = false;
    return category;
  });

  const savedIds = new Set(saved.map((category) => category.id));
  for (const category of state.categories) {
    if (!category.archived && !savedIds.has(category.id)) {
      category.archived = true;
    }
  }

  let surplusCategoryId = payload.surplusCategoryId ?? state.settings.surplusCategoryId;
  if (typeof surplusCategoryId === 'string' && surplusCategoryId.startsWith('type:')) {
    const btId = surplusCategoryId.slice(5);
    const bt = bucketTypeMap.get(btId);
    const eligibleMembers = saved.filter(
      (c) => c.bucketTypeId === btId && !['spending', 'bill'].includes(categoryType(c))
    );
    if (!bt || !bt.allowSurplus || eligibleMembers.length === 0) {
      surplusCategoryId =
        saved.find((category) => categoryType(category) === 'saving')?.id ||
        saved.find((category) => categoryType(category) === 'investment')?.id ||
        saved.find((category) => categoryType(category) === 'loan')?.id ||
        null;
    }
  } else {
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
  }

  state.settings.monthlyIncomePaise = incomePaise;
  state.settings.paydayDay = paydayDay;
  state.settings.surplusCategoryId = surplusCategoryId;
  state.settings.planConfirmed = true;
  const effectivePeriod = currentAllocation(state) ? todayString(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)).slice(0, 7) : periodOf();
  state.planVersions ||= [];
  const snapshot = {effectivePeriod, createdAt: now, categories: saved.map(c => ({id: c.id, type: categoryType(c), targetPaise: c.targetPaise,
    frequency: c.frequency, startPeriod: c.startPeriod, endPeriod: c.endPeriod, dueDay: c.dueDay}))};
  const versionIndex = state.planVersions.findIndex(p => p.effectivePeriod === effectivePeriod);
  if (versionIndex < 0) state.planVersions.push(snapshot); else state.planVersions[versionIndex] = snapshot;
  for (const category of saved) if (!activeExisting.has(category.id)) includeNewBill(state, category);

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
  const allocation = currentAllocation(state, period);
  const plan = targetMap(computePlan(state));
  return activeCategories(state).filter(c => categoryType(c) !== 'spending').map(category => {
    const type = categoryType(category);
    const row = allocation?.items.find(i => i.reason === 'target' && i.categoryId === category.id);
    const inDivision = Boolean(row);
    const planned = row?.targetPaise ?? (['bill', 'loan'].includes(type) ? plannedBillTarget(state, category.id, period) : plan.get(category.id) ?? 0);
    const targetPaise = ['bill', 'loan'].includes(type) ? billTarget(state, category.id, period, planned) : planned;
    const transactions = state.transactions.filter(t => t.categoryId === category.id && transactionPeriod(t) === period);
    let paidPaise = paymentTotal(state, category.id, period);
    const fundedPaise = row?.fundedPaise ?? Math.max(0, row?.deltaPaise || 0);
    if (type === 'investment') paidPaise = transactions.filter(t => t.kind === 'transfer' && t.direction === 'out').reduce((n, t) => n + successfulContribution(state, t), 0);
    if (type === 'saving') {
      const moved = (state.moves || []).filter(m => (m.date || m.createdAt).startsWith(period)).reduce((n, m) => n + (m.toCategoryId === category.id ? m.amountPaise : 0) - (m.fromCategoryId === category.id ? m.amountPaise : 0), 0);
      paidPaise = Math.max(0, fundedPaise + moved, paymentTotal(state, category.id, period));
    }
    const settled = ['bill', 'loan'].includes(type) && billSettled(state, category.id, period);
    const atGoal = type === 'saving' && category.capPaise != null && category.balancePaise >= category.capPaise && paidPaise < targetPaise;
    const remainingPaise = settled || atGoal ? 0 : Math.max(0, targetPaise - Math.max(0, paidPaise));
    const overduePaise = ['bill', 'loan'].includes(type) ? priorBills(state, category.id, period) : 0;
    const status = settled ? 'done' : atGoal ? 'at-goal' : targetPaise <= 0 ? 'no-target' : paidPaise >= targetPaise ? 'done' : allocation && !inDivision ? 'not-in-division' : paidPaise < 0 ? 'refunded' : paidPaise > 0 ? 'partial' : 'due';
    const dueDay = (['bill', 'loan'].includes(type) ? plannedBillSpec(state, category.id, period)?.dueDay : category.dueDay) || null;
    const days = new Date(Number(period.slice(0, 4)), Number(period.slice(5)), 0).getDate();
    return {categoryId: category.id, type, period, targetPaise, paidPaise, remainingPaise, overduePaise,
      fundingGapPaise: ['bill', 'loan'].includes(type) ? Math.max(0, remainingPaise + overduePaise - Math.max(0, category.balancePaise)) : 0,
      dueDate: dueDay && targetPaise > 0 ? `${period}-${String(Math.min(days, dueDay)).padStart(2, '0')}` : null,
      extraPaise: Math.max(0, paidPaise - targetPaise), progress: targetPaise > 0 ? Math.min(1, Math.max(0, paidPaise / targetPaise)) : 0,
      status, inDivision, afterDivision: Boolean(allocation && !inDivision), fundedByDivision: type === 'saving' && fundedPaise > 0, fundedPaise};
  });
}

function successfulContribution(state, tx) {
  return tx.amountPaise - state.transactions.filter(t => t.reversalOf === tx.id).reduce((n, t) => n + t.amountPaise, 0);
}

function invalidateWorth(state, categoryId, date = todayString()) {
  const category = findCategory(state, categoryId);
  if (category && categoryType(category) === 'investment') {
    category.movementUpdatedAt = isoNow();
    category.valuationInvalidations ||= [];
    category.valuationInvalidations.push({date, recordedAt: category.movementUpdatedAt});
  }
}

export function classifyAdjustment(state, id, input) {
  const adjustment = state.transactions.find(t => t.id === id && t.kind === 'adjustment');
  if (!adjustment) throw new AppError('NOT_FOUND', 'Balance correction not found.', 404);
  const normalized = normalizeTransaction(state, {...input, direction: adjustment.direction});
  if (normalized.kind === 'adjustment' || normalized.amountPaise > adjustment.amountPaise) throw new AppError('INVALID_INPUT', 'Choose a transaction up to the correction amount.');
  prepareLedger(state);
  const tx = {id: uid('tx'), ...normalized, createdAt: isoNow(), source: 'classified', correctionId: id, correctionDate: adjustment.date, correctionCreatedAt: adjustment.createdAt};
  adjustment.amountPaise -= tx.amountPaise;
  if (!adjustment.amountPaise) state.transactions.splice(state.transactions.indexOf(adjustment), 1);
  state.transactions.push(tx);
  replayBudgets(state);
  invalidateWorth(state, tx.categoryId, tx.date);
  return tx;
}

export function reversePayment(state, id, amountPaise) {
  const payment = state.transactions.find(t => t.id === id && t.direction === 'out' && t.categoryId && !t.reversalOf);
  if (!payment) throw new AppError('INVALID_INPUT', 'Choose an outgoing payment.');
  const available = successfulContribution(state, payment);
  const amount = requireInt(amountPaise ?? available, 'Returned amount', {min: 1, max: available});
  const tx = addTransaction(state, {date: todayString(), budgetPeriod: transactionPeriod(payment), kind: payment.kind,
    direction: 'in', categoryId: payment.categoryId, amountPaise: amount, description: `Reversed: ${payment.description}`.slice(0, 120)});
  tx.reversalOf = id;
  tx.externalSaving = Boolean(payment.externalSaving);
  return tx;
}

export function settleBill(state, categoryId, {period = periodOf(), amountPaise, settled = true}) {
  const category = findCategory(state, categoryId);
  if (!category || !['bill', 'loan'].includes(categoryType(category))) throw new AppError('INVALID_INPUT', 'Choose a bill or loan.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError('INVALID_PERIOD', 'Choose a month.');
  prepareLedger(state);
  const index = state.billOverrides.findIndex(b => b.categoryId === categoryId && b.period === period);
  const prior = state.billOverrides[index];
  const amount = amountPaise === undefined ? prior?.amountPaise ?? null : amountPaise === null ? null : requireInt(amountPaise, 'Bill amount');
  const paid = paymentTotal(state, categoryId, period);
  const hasPayments = state.transactions.some(t => t.categoryId === categoryId && transactionPeriod(t) === period);
  const openingPaidPaise = (!settled && !hasPayments) ? 0 : prior?.openingPaidPaise || (settled && paid === 0 ? amount ?? category.targetPaise : 0);
  const override = {categoryId, period, amountPaise: amount, settled: Boolean(settled), date: todayString(), openingPaidPaise,
    paidAtSettlement: paid + (prior?.openingPaidPaise ? 0 : openingPaidPaise)};
  if (index < 0) state.billOverrides.push(override); else state.billOverrides[index] = override;
  replayBudgets(state);
  return override;
}

function valuationHistory(category) {
  if (category.valuations) return category.valuations;
  // Retain the last known legacy value at its actual recorded date. Never
  // manufacture month-end valuations for older periods.
  return category.currentValueAt ? [{date: todayString(new Date(category.currentValueAt)),
    recordedAt: category.currentValueAt, valuePaise: category.currentValuePaise}] : [];
}

export function investmentSummaries(state, asOf = todayString()) {
  const transactions = state.transactions.filter(t => t.date <= asOf);
  const scoped = {...state, transactions};
  return state.categories.filter(c => categoryType(c) === 'investment').map(category => {
    const movements = transactions.filter(t => t.categoryId === category.id && t.kind === 'transfer');
    const putInPaise = movements.filter(t => t.direction === 'out').reduce((n,t) => n + successfulContribution(scoped, t), 0);
    const tookOutPaise = movements.filter(t => t.direction === 'in' && !t.reversalOf).reduce((n,t) => n + t.amountPaise, 0);
    const valuation = valuationHistory(category).filter(v => v.date <= asOf)
      .sort((a,b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
    const worthPaise = valuation?.valuePaise ?? null;
    const openingCostPaise = category.openingCostPaise || 0;
    const hasCostBasis = category.historyComplete === true && (putInPaise > 0 || openingCostPaise > 0);
    const invalidations = category.valuationInvalidations || (category.movementUpdatedAt && asOf >= todayString()
      ? [{date: todayString(), recordedAt: category.movementUpdatedAt}] : []);
    const worthStale = worthPaise !== null && (
      movements.some(t => t.date > valuation.date || (t.updatedAt || t.createdAt) > valuation.recordedAt) ||
      invalidations.some(i => i.date <= asOf && i.recordedAt > valuation.recordedAt));
    return {categoryId: category.id, name: category.name, icon: category.icon, color: category.color,
      putInPaise, openingCostPaise, netInvestedPaise: Math.max(0, openingCostPaise + putInPaise - tookOutPaise),
      archived: Boolean(category.archived), historyComplete: category.historyComplete === true,
      tookOutPaise, worthPaise, worthDate: valuation?.date || null, hasCostBasis, worthStale,
      gainPaise: worthPaise === null || !hasCostBasis || worthStale ? null : worthPaise + tookOutPaise - putInPaise - openingCostPaise};
  });
}

export function investmentTotals(investments) {
  const known = investments.filter(i => i.gainPaise !== null);
  return {
    estimatedWorthPaise: investments.reduce((n,i) => n + (i.worthPaise ?? (i.historyComplete ? i.netInvestedPaise : 0)), 0),
    worthComplete: investments.every(i => i.worthPaise !== null && !i.worthStale),
    gainPaise: known.length ? known.reduce((n,i) => n + i.gainPaise, 0) : null,
    gainComplete: known.length === investments.length,
    valuedCount: investments.filter(i => i.worthPaise !== null && !i.worthStale).length,
    gainCount: known.length, count: investments.length,
  };
}

export function updateInvestmentValue(state, categoryId, worthPaise, date = todayString()) {
  const category = findCategory(state, categoryId);
  if (!category || categoryType(category) !== 'investment') throw new AppError('INVALID_TYPE', 'Choose an investment.');
  if (!isValidDate(date) || date > todayString() || (state.settings.openingDate && date < state.settings.openingDate)) {
    throw new AppError('INVALID_DATE', 'Choose a valuation date between your starting date and today.');
  }
  const value = worthPaise === null || worthPaise === undefined || worthPaise === '' ? null : requireInt(worthPaise, 'Investment worth');
  if (value > 0 && !state.transactions.some(t => t.categoryId === category.id && t.kind === 'transfer' && t.direction === 'out') && !category.openingCostPaise) category.historyComplete = false;
  category.valuations = [...valuationHistory(category), {date, valuePaise: value, recordedAt: isoNow()}];
  const latest = [...category.valuations].sort((a,b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
  category.currentValuePaise = latest.valuePaise;
  category.currentValueAt = latest.valuePaise === null ? null : latest.recordedAt;
  return category;
}

export function updateInvestmentHistory(state, categoryId, openingCostPaise) {
  const category = findCategory(state, categoryId);
  if (!category || categoryType(category) !== 'investment') throw new AppError('INVALID_TYPE', 'Choose an investment.');
  category.historyComplete = openingCostPaise !== null && openingCostPaise !== undefined && openingCostPaise !== '';
  category.historyConfirmed = true;
  category.openingCostPaise = category.historyComplete ? requireInt(openingCostPaise, 'Opening invested amount') : null;
  return category;
}

export function externalSavings(state, categoryId, asOf = todayString()) {
  const category = findCategory(state, categoryId);
  return (category?.openingSavedPaise || 0) +
    state.transactions.filter(t => t.categoryId === categoryId && t.externalSaving && t.date <= asOf)
      .reduce((n,t) => n - signed(t), 0) +
    (category?.externalSavingsAdjustments || []).filter(a => a.date <= asOf).reduce((n,a) => n + a.deltaPaise, 0);
}

export function updateSavingOpening(state, categoryId, amountPaise) {
  const category = findCategory(state, categoryId);
  if (!category || categoryType(category) !== 'saving') throw new AppError('INVALID_TYPE', 'Choose a savings bucket.');
  const amount = amountPaise === null || amountPaise === undefined || amountPaise === '' ? 0 : requireInt(amountPaise, 'External savings balance');
  const deltaPaise = amount - externalSavings(state, categoryId);
  if (deltaPaise) {
    category.externalSavingsAdjustments ||= [];
    category.externalSavingsAdjustments.push({date: todayString(), recordedAt: isoNow(), deltaPaise});
  }
  return category;
}

export function moneySafety(state, period = periodOf(), asOf = todayString()) {
  const categories = state.categories;
  const commitments = monthlyCommitments(state, period);
  const bank = computeBankBalance(state);
  const positive = categories.reduce((n, c) => n + Math.max(0, c.balancePaise), 0);
  const spending = categories.filter(c => categoryType(c) === 'spending').reduce((n, c) => n + Math.max(0, c.balancePaise), 0);
  let reserved = categories.filter(c => categoryType(c) !== 'spending').reduce((n, c) => {
    const commitment = commitments.find(i => i.categoryId === c.id);
    return n + Math.max(0, c.balancePaise, ['bill', 'loan'].includes(categoryType(c)) ? (commitment?.remainingPaise || 0) + (commitment?.overduePaise || 0) : 0);
  }, state.futureReservedPaise || 0);
  const date = new Date(`${asOf}T12:00:00`);
  let payday = new Date(date.getFullYear(), date.getMonth(), Math.min(state.settings.paydayDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()), 12);
  if (payday <= date) payday = new Date(date.getFullYear(), date.getMonth() + 1, Math.min(state.settings.paydayDay, new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate()), 12);
  const daysToPayday = Math.max(1, Math.ceil((payday - date) / 86400000));
  const paydayDate = todayString(payday);
  const paydayPeriod = periodOf(paydayDate);
  let upcomingBillGapPaise = 0;
  if (period === periodOf(asOf) && paydayPeriod > period) {
    for (const bill of monthlyCommitments(state, paydayPeriod).filter(c => ['bill', 'loan'].includes(c.type))) {
      if ((bill.dueDate || `${paydayPeriod}-01`) >= paydayDate) continue;
      const id = bill.categoryId;
      const category = findCategory(state, id);
      const current = commitments.find(c => c.categoryId === id);
      const currentDue = (current?.remainingPaise || 0) + (current?.overduePaise || 0);
      const spareCurrentReserve = Math.max(0, category.balancePaise - currentDue);
      const futureFunding = state.allocations.filter(a => a.period === paydayPeriod)
        .reduce((n,a) => n + (a.fundings || []).reduce((m,f) => m + (f.amounts[id] || 0), 0), 0);
      const futurePayments = state.transactions.filter(t => t.categoryId === id && !t.unassignedReturn && transactionPeriod(t) === paydayPeriod)
        .reduce((n,t) => n + signed(t), 0);
      const futureMoves = state.moves.filter(m => (m.date || m.createdAt).startsWith(paydayPeriod))
        .reduce((n,m) => n + (m.toCategoryId === id ? m.amountPaise : 0) - (m.fromCategoryId === id ? m.amountPaise : 0), 0);
      const futureReserve = Math.max(0, futureFunding + futurePayments + futureMoves);
      upcomingBillGapPaise += Math.max(0, bill.remainingPaise - futureReserve - spareCurrentReserve);
    }
    reserved += upcomingBillGapPaise;
  }
  const safeToSpendPaise = Math.max(0, Math.min(spending, bank - reserved));
  const purchaseReserve = categories.filter(c => categoryType(c) === 'spending' && !(c.includeInDailyGuide ?? !c.rollover))
    .reduce((n,c) => n + Math.max(0, c.balancePaise), 0);
  const dailyBudgetPaise = Math.max(0, Math.min(spending - purchaseReserve, bank - reserved - purchaseReserve));
  const assignedReserve = categories.filter(c => categoryType(c) !== 'spending').reduce((n, c) => n + Math.max(0, c.balancePaise), state.futureReservedPaise || 0);
  return {safeToSpendPaise, reservedPaise: assignedReserve, protectedPaise: reserved, futureReservedPaise: state.futureReservedPaise || 0, uncoveredPaise: Math.max(0, positive + (state.futureReservedPaise || 0) - bank), daysToPayday,
    dailyPaise: Math.floor(dailyBudgetPaise / daysToPayday), dailyBudgetPaise, purchaseReservePaise: purchaseReserve, upcomingBillGapPaise, nextPayday: paydayDate,
    billGapPaise: commitments.reduce((n, c) => n + c.fundingGapPaise, 0)};
}

export function clientState(state, period = periodOf()) {
  const liveState = state;
  state = structuredClone(state);
  prepareLedger(state);
  if (period < periodOf()) {
    const cutoff = allocationDate(period, todayString());
    state.transactions = state.transactions.filter(t => periodOf(t.date) <= period);
    state.moves = state.moves.filter(m => periodOf(m.date || m.createdAt) <= period || todayString(new Date(m.createdAt)) <= cutoff);
    state.allocations = state.allocations.filter(a => a.period <= period || a.fundings?.some(f => todayString(new Date(f.createdAt)) <= cutoff));
    for (const a of state.allocations.filter(a => a.period > period)) a.fundings = a.fundings.filter(f => todayString(new Date(f.createdAt)) <= cutoff);
    const snapshot = currentAllocation(state, period)?.snapshot;
    if (snapshot) {
      const ids = new Set(snapshot.categories.map(c => c.id));
      for (const c of state.categories) c.archived = !ids.has(c.id);
    }
  }
  replayBudgets(state, period);
  const copy = structuredClone(state);
  const plan = computePlan(state, period);
  const allocation = currentAllocation(state, period);
  const asOf = period < periodOf() ? allocationDate(period, todayString()) : todayString();
  const investments = investmentSummaries(state, asOf);

  copy.bucketTypes = ensureBucketTypes(copy);

  copy.categories = copy.categories.map((category) => ({
    ...category,
    type: categoryType(category),
    bucketTypeId: category.bucketTypeId || categoryType(category),
    externalSavedPaise: categoryType(category) === 'saving' ? externalSavings(state, category.id, asOf) : 0,
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
      investments,
      investmentTotals: investmentTotals(investments),
      safety: moneySafety(state, period),
      fundingPreview: period < periodOf() ? {items: []} : fundingPreview(state, period),
      periods: [...new Set([periodOf(), todayString(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)).slice(0, 7), ...liveState.allocations.map(a => a.period), ...liveState.transactions.map(t => periodOf(t.date))])].sort().reverse(),
      summary: monthSummary(state, period),
      setupRequired: !state.settings.onboarded,
    },
  };
}

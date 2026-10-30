import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { paymentTotal, replayBudgets } from './lib/budget.js';
import { createStore } from './lib/store.js';
import { createState, createDemoState, fitDefaultsToIncome } from './lib/seed.js';
import {
  AppError,
  addTransaction,
  allocateMonth,
  categoryType,
  clientState,
  classifyAdjustment,
  reversePayment,
  settleBill,
  updateInvestmentHistory,
  deleteTransaction,
  guessCategoryId,
  isValidDate,
  moveBetweenEnvelopes,
  periodOf,
  reconcileBalance,
  rotateIngestToken,
  rupeesText,
  saveBucketType,
  deleteBucketType,
  savePlan,
  todayString,
  undoAllocation,
  updateTransaction,
  updateInvestmentValue,
} from './lib/domain.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'store.json');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '127.0.0.1';

const store = createStore(DATA_FILE);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5_000_000) {
      throw new AppError('BODY_TOO_LARGE', 'Request body is too large.', 413);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }
}

function validateImportedState(data) {
  if (!data || typeof data !== 'object') {
    throw new AppError('INVALID_BACKUP', 'That is not a Khaata backup.', 400);
  }
  if (
    !data.settings ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.transactions) ||
    !Array.isArray(data.allocations)
  ) {
    throw new AppError('INVALID_BACKUP', 'That backup is missing settings, buckets, transactions or divisions.', 400);
  }
  const settings = data.settings;
  if (!Number.isSafeInteger(settings.monthlyIncomePaise) || settings.monthlyIncomePaise < 1) {
    throw new AppError('INVALID_BACKUP', 'The backup has an invalid monthly salary.', 400);
  }
  if (!Number.isSafeInteger(settings.openingBalancePaise) || settings.openingBalancePaise < 0) {
    throw new AppError('INVALID_BACKUP', 'The backup has an invalid starting balance.', 400);
  }

  const categoryIds = new Set();
  for (const category of data.categories) {
    if (
      !category ||
      typeof category.id !== 'string' ||
      typeof category.name !== 'string' ||
      !['fixed', 'flex'].includes(category.kind) ||
      !Number.isSafeInteger(category.balancePaise) ||
      !Number.isSafeInteger(category.targetPaise) ||
      category.targetPaise < 0 ||
      typeof category.percent !== 'number' ||
      category.percent < 0 ||
      category.percent > 100 ||
      (category.capPaise !== null &&
        category.capPaise !== undefined &&
        (!Number.isSafeInteger(category.capPaise) || category.capPaise < 0)) ||
      (category.currentValuePaise !== null &&
        category.currentValuePaise !== undefined &&
        (!Number.isSafeInteger(category.currentValuePaise) ||
          category.currentValuePaise < 0)) ||
      (category.currentValueAt !== null &&
        category.currentValueAt !== undefined &&
        (typeof category.currentValueAt !== 'string' ||
          Number.isNaN(Date.parse(category.currentValueAt))))
    ) {
      throw new AppError('INVALID_BACKUP', 'The backup contains an invalid bucket.', 400);
    }
    if (categoryIds.has(category.id)) {
      throw new AppError('INVALID_BACKUP', 'The backup contains duplicate buckets.', 400);
    }
    categoryIds.add(category.id);
  }
  if (data.categories.length === 0) {
    throw new AppError('INVALID_BACKUP', 'The backup has no buckets.', 400);
  }

  const transactionIds = new Set();
  for (const transaction of data.transactions) {
    if (
      !transaction ||
      typeof transaction.id !== 'string' ||
      !isValidDate(transaction.date) ||
      transaction.date > todayString() ||
      !Number.isSafeInteger(transaction.amountPaise) ||
      transaction.amountPaise < 1 ||
      !['in', 'out'].includes(transaction.direction) ||
      !['expense', 'income', 'transfer', 'adjustment'].includes(transaction.kind) ||
      transactionIds.has(transaction.id) ||
      typeof transaction.description !== 'string' ||
      typeof transaction.createdAt !== 'string' || Number.isNaN(Date.parse(transaction.createdAt)) ||
      (transaction.categoryId && !categoryIds.has(transaction.categoryId)) ||
      (['expense', 'transfer'].includes(transaction.kind) && !transaction.categoryId) ||
      (transaction.budgetPeriod && !/^\d{4}-(0[1-9]|1[0-2])$/.test(transaction.budgetPeriod)) ||
      (transaction.categoryId !== null &&
        transaction.categoryId !== undefined &&
        typeof transaction.categoryId !== 'string')
    ) {
      throw new AppError('INVALID_BACKUP', 'The backup contains an invalid transaction.', 400);
    }
    transactionIds.add(transaction.id);
    if (transaction.categoryId) {
      const type = categoryType(data.categories.find(c => c.id === transaction.categoryId));
      if ((transaction.kind === 'expense' && !['bill', 'spending'].includes(type)) ||
          (transaction.kind === 'transfer' && !['saving', 'investment', 'loan'].includes(type))) {
        throw new AppError('INVALID_BACKUP', 'A transaction has the wrong bucket type.');
      }
    }
  }

  for (const t of data.transactions.filter(t => t.reversalOf)) {
    const payment = data.transactions.find(p => p.id === t.reversalOf);
    const reversed = data.transactions.filter(r => r.reversalOf === t.reversalOf).reduce((n, r) => n + r.amountPaise, 0);
    if (!payment || payment.direction !== 'out' || t.direction !== 'in' || payment.categoryId !== t.categoryId || payment.kind !== t.kind || reversed > payment.amountPaise) throw new AppError('INVALID_BACKUP', 'A payment reversal is invalid.');
  }

  if (data.moves != null && !Array.isArray(data.moves)) throw new AppError('INVALID_BACKUP', 'Budget moves must be a list.');
  for (const move of data.moves || []) {
    if (!move || !Number.isSafeInteger(move.amountPaise) || move.amountPaise < 1 ||
        !move.createdAt || Number.isNaN(Date.parse(move.createdAt)) ||
        (move.date && !isValidDate(move.date)) ||
        (move.fromCategoryId && !categoryIds.has(move.fromCategoryId)) ||
        (move.toCategoryId && !categoryIds.has(move.toCategoryId)) ||
        move.fromCategoryId === move.toCategoryId) throw new AppError('INVALID_BACKUP', 'A budget move is invalid.');
  }

  const periods = new Set();
  for (const allocation of data.allocations) {
    if (!allocation || !/^\d{4}-(0[1-9]|1[0-2])$/.test(allocation.period) || periods.has(allocation.period) || !Array.isArray(allocation.items) || !allocation.createdAt || Number.isNaN(Date.parse(allocation.createdAt))) {
      throw new AppError('INVALID_BACKUP', 'The backup contains an invalid division.', 400);
    }
    periods.add(allocation.period);
    for (const item of allocation.items) if (!categoryIds.has(item.categoryId) || !Number.isSafeInteger(item.deltaPaise) || !Number.isSafeInteger(item.targetPaise) || item.targetPaise < 0) throw new AppError('INVALID_BACKUP', 'A division amount is invalid.');
    if (allocation.snapshot) {
      const specs = allocation.snapshot.categories;
      if (!Array.isArray(specs) || !specs.length || !Array.isArray(allocation.fundings) || !allocation.fundings.length || new Set(specs.map(c => c.id)).size !== specs.length) throw new AppError('INVALID_BACKUP', 'The budget snapshot is invalid.');
      for (const spec of specs) if (!categoryIds.has(spec.id) || !['bill','loan','saving','investment','spending'].includes(spec.type) || !Number.isSafeInteger(spec.targetPaise) || spec.targetPaise < 0 || (spec.capPaise != null && (!Number.isSafeInteger(spec.capPaise) || spec.capPaise < 0))) throw new AppError('INVALID_BACKUP', 'The budget rules are invalid.');
      for (const funding of allocation.fundings) {
        if (!funding || !isValidDate(funding.date) || !funding.createdAt || Number.isNaN(Date.parse(funding.createdAt)) || !funding.amounts || typeof funding.amounts !== 'object') throw new AppError('INVALID_BACKUP', 'The funding history is invalid.');
        for (const [id, amount] of Object.entries(funding.amounts)) if (!specs.some(c => c.id === id) || !Number.isSafeInteger(amount) || amount < 0) throw new AppError('INVALID_BACKUP', 'A funding amount is invalid.');
      }
    }
  }
  if (data.budgetBase && (typeof data.budgetBase !== 'object' || Array.isArray(data.budgetBase) || Object.entries(data.budgetBase).some(([id, n]) => !categoryIds.has(id) || !Number.isSafeInteger(n)))) throw new AppError('INVALID_BACKUP', 'Opening bucket balances are invalid.');
  if (data.billOverrides && (!Array.isArray(data.billOverrides) || data.billOverrides.some(b => !b || !categoryIds.has(b.categoryId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.period) || (b.amountPaise != null && (!Number.isSafeInteger(b.amountPaise) || b.amountPaise < 0)) || (b.openingPaidPaise != null && (!Number.isSafeInteger(b.openingPaidPaise) || b.openingPaidPaise < 0))))) throw new AppError('INVALID_BACKUP', 'Bill history is invalid.');
  if (settings.openingDate && (!isValidDate(settings.openingDate) || settings.openingDate > todayString())) throw new AppError('INVALID_BACKUP', 'Starting date is invalid.');
  if (data.planVersions != null) {
    if (!Array.isArray(data.planVersions)) throw new AppError('INVALID_BACKUP', 'Plan history is invalid.');
    for (const plan of data.planVersions) {
      if (!plan || !/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.effectivePeriod) || !plan.createdAt || Number.isNaN(Date.parse(plan.createdAt)) || !Array.isArray(plan.categories)) throw new AppError('INVALID_BACKUP', 'Plan history is invalid.');
      for (const c of plan.categories) if (!categoryIds.has(c.id) || !Number.isSafeInteger(c.targetPaise) || c.targetPaise < 0) throw new AppError('INVALID_BACKUP', 'A historical plan amount is invalid.');
    }
  }

  return {
    ...data,
    version: data.version ?? 1,
    moves: Array.isArray(data.moves) ? data.moves : [],
    settings: {
      ...settings,
      ingestToken:
        typeof settings.ingestToken === 'string' && settings.ingestToken
          ? settings.ingestToken
          : randomUUID().replace(/-/g, ''),
      onboarded: Boolean(settings.onboarded),
    },
  };
}

function requirePaise(value, label, { min = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new AppError('INVALID_INPUT', `${label} must be a whole number of paise.`);
  }
  return n;
}

function parseRupees(value) {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return NaN;
  return Number(String(value).replace(/[₹,\s]/g, ''));
}

function stateResponse(extra = {}, period = periodOf()) {
  return { state: clientState(store.get(), period), ...extra };
}

function settleFromTransaction(state, transaction, body) {
  if (typeof body.settleBill !== 'boolean' || transaction.direction !== 'out') return;
  const category = state.categories.find(c => c.id === transaction.categoryId);
  if (!category || !['bill', 'loan'].includes(categoryType(category))) return;
  const period = transaction.budgetPeriod || transaction.date.slice(0, 7);
  settleBill(state, category.id, {period, settled: body.settleBill,
    amountPaise: body.settleBill ? Math.max(0, paymentTotal(state, category.id, period)) : null});
}

function handleSetup(body) {
  const mode = body.mode === 'demo' ? 'demo' : 'fresh';

  if (mode === 'demo') {
    const demo = createDemoState();
    store.set(demo);
    return stateResponse({ warning: null });
  }

  const income = requirePaise(body.monthlyIncomePaise, 'Monthly income', { min: 1 });
  const opening = requirePaise(body.openingBalancePaise ?? 0, 'Bank balance', { min: 0 });

  const state = createState({
    monthlyIncomePaise: income,
    openingBalancePaise: opening,
    onboarded: true,
  });
  fitDefaultsToIncome(state);

  const openingDate = body.openingDate || todayString();
  if (!isValidDate(openingDate) || openingDate > todayString()) throw new AppError('INVALID_DATE', 'Choose a valid starting date.');
  state.settings.openingDate = openingDate;
  state.settings.planConfirmed = false;
  store.set(state);
  return stateResponse({ warning: null });
}

function handleIngest(req, url, body) {
  const state = store.get();
  const token =
    req.headers['x-ingest-token'] ||
    (typeof req.headers.authorization === 'string' && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
    url.searchParams.get('token');

  if (!token || token !== state.settings.ingestToken) {
    throw new AppError('UNAUTHORIZED', 'Invalid ingest token.', 401);
  }

  const amountRupees = parseRupees(body.amount);
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    throw new AppError('INVALID_INPUT', 'amount must be a positive number in rupees.');
  }
  const amountPaise = Math.round(amountRupees * 100);

  const direction = body.direction === 'in' || body.direction === 'out' ? body.direction : null;
  if (!direction) {
    throw new AppError('INVALID_INPUT', 'direction must be "in" or "out".');
  }

  const description = String(body.description || body.narration || 'Bank alert').trim().slice(0, 120);
  let date = todayString();
  if (body.date !== undefined && body.date !== null && body.date !== '') {
    if (!isValidDate(body.date)) {
      throw new AppError('INVALID_DATE', 'date must be a real date in YYYY-MM-DD format.');
    }
    date = body.date;
  }
  let kind = body.kind || (direction === 'in' ? 'income' : 'expense');
  const externalId = body.externalId ? String(body.externalId).slice(0, 120) : null;

  const existing = externalId
    ? state.transactions.find((t) => t.externalId === externalId)
    : null;
  if (existing) {
    return stateResponse({ duplicate: true, transaction: existing });
  }

  if (!externalId) {
    const recent = [...state.transactions].reverse().find((t) => {
      if (t.source !== 'alert') return false;
      if (t.amountPaise !== amountPaise || t.direction !== direction || t.description !== description) {
        return false;
      }
      const age = Date.now() - Date.parse(t.createdAt);
      return Number.isFinite(age) && age >= 0 && age < 5 * 60 * 1000;
    });
    if (recent) {
      return stateResponse({ duplicate: true, transaction: recent });
    }
  }

  let categoryId = body.categoryId ?? null;
  if (!categoryId && body.category) {
    categoryId = state.categories.find(
      (c) => c.name.toLowerCase() === String(body.category).toLowerCase()
    )?.id ?? null;
  }
  if (kind === 'expense' && !categoryId) {
    categoryId = guessCategoryId(state, description, direction);
  }
  if (kind === 'transfer' && !categoryId) {
    const transferCategories = state.categories.filter(
      (category) =>
        !category.archived &&
        ['saving', 'investment', 'loan'].includes(categoryType(category))
    );
    categoryId =
      transferCategories.find((category) => categoryType(category) === 'investment')?.id ||
      transferCategories.find((category) => categoryType(category) === 'saving')?.id ||
      transferCategories.find((category) => categoryType(category) === 'loan')?.id ||
      null;
  }

  if (!body.kind && kind === 'expense' && categoryId) {
    const category = state.categories.find((c) => c.id === categoryId);
    if (category && ['saving', 'investment', 'loan'].includes(categoryType(category))) {
      kind = 'transfer';
    }
  }

  let targetBalancePaise = null;
  if (body.balance !== undefined && body.balance !== null && body.balance !== '') {
    const balanceRupees = parseRupees(body.balance);
    if (!Number.isFinite(balanceRupees) || balanceRupees < 0) {
      throw new AppError('INVALID_INPUT', 'balance must be a positive number in rupees.');
    }
    targetBalancePaise = Math.round(balanceRupees * 100);
  }

  const transaction = addTransaction(state, {
    date,
    description,
    amountPaise,
    direction,
    kind,
    categoryId,
    source: 'alert',
    externalId,
  });

  const adjustment =
    targetBalancePaise === null
      ? null
      : reconcileBalance(state, targetBalancePaise, 'Auto-corrected from bank alert');

  store.save();
  return stateResponse({ duplicate: false, transaction, adjustment });
}

async function handleApi(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const selectedPeriod = url.searchParams.get('period') || periodOf();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedPeriod)) throw new AppError('INVALID_PERIOD', 'Choose a valid month.');
  const reply = (extra = {}) => stateResponse(extra, selectedPeriod);

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, reply());
  }

  if (req.method === 'GET' && pathname === '/api/export') {
    const body = `${JSON.stringify(store.get(), null, 2)}\n`;
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="khaata-backup-${todayString()}.json"`,
      'cache-control': 'no-store',
    });
    return res.end(body);
  }

  if (req.method === 'POST' && pathname === '/api/setup') {
    const body = await readJson(req);
    return sendJson(res, 200, handleSetup(body));
  }

  if (req.method === 'POST' && pathname === '/api/restore') {
    const body = await readJson(req);
    const restored = validateImportedState(body);
    try {
      replayBudgets(restored);
      clientState(restored);
    } catch {
      throw new AppError('INVALID_BACKUP', 'That backup could not be read by the app.', 400);
    }
    store.set(restored);
    return sendJson(res, 200, reply());
  }

  if (req.method === 'POST' && pathname === '/api/reset') {
    store.set(createState());
    return sendJson(res, 200, reply());
  }

  if (req.method === 'POST' && pathname === '/api/token') {
    const state = structuredClone(store.get());
    rotateIngestToken(state);
    store.set(state);
    return sendJson(res, 200, reply());
  }

  if (req.method === 'POST' && pathname === '/api/transactions') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const transaction = body.adjustmentId ? classifyAdjustment(state, body.adjustmentId, body) : addTransaction(state, body);
    settleFromTransaction(state, transaction, body);
    store.set(state);
    return sendJson(res, 200, reply({ transaction }));
  }

  const reverseMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/reverse$/);
  if (reverseMatch && req.method === 'POST') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const transaction = reversePayment(state, reverseMatch[1], body.amountPaise);
    store.set(state);
    return sendJson(res, 200, reply({transaction}));
  }
  const billMatch = pathname.match(/^\/api\/bills\/([^/]+)$/);
  if (billMatch && req.method === 'POST') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const bill = settleBill(state, billMatch[1], body);
    store.set(state);
    return sendJson(res, 200, reply({bill}));
  }

  const txMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (txMatch && req.method === 'PUT') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const transaction = updateTransaction(state, txMatch[1], body);
    settleFromTransaction(state, transaction, body);
    store.set(state);
    return sendJson(res, 200, reply({ transaction }));
  }

  if (txMatch && req.method === 'DELETE') {
    const state = structuredClone(store.get());
    const transaction = deleteTransaction(state, txMatch[1]);
    store.set(state);
    return sendJson(res, 200, reply({ transaction }));
  }

  if (req.method === 'POST' && pathname === '/api/bucket-types') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const bucketType = saveBucketType(state, body);
    store.set(state);
    return sendJson(res, 200, reply({ bucketType }));
  }

  const btMatch = pathname.match(/^\/api\/bucket-types\/([^/]+)$/);
  if (btMatch && req.method === 'DELETE') {
    const state = structuredClone(store.get());
    const bucketType = deleteBucketType(state, btMatch[1]);
    store.set(state);
    return sendJson(res, 200, reply({ bucketType }));
  }

  if (req.method === 'PUT' && pathname === '/api/plan') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const result = savePlan(state, body);
    for (const raw of body.categories) {
      if (!raw.alreadyPaid) continue;
      const category = state.categories.find(c => c.name.toLowerCase() === raw.name.trim().toLowerCase() && !c.archived);
      if (!category || !['bill', 'loan'].includes(categoryType(category))) continue;
      settleBill(state, category.id, {period: body.period || selectedPeriod, amountPaise: category.targetPaise, settled: true});
    }
    store.set(state);
    return sendJson(res, 200, reply({ plan: result }));
  }

  if (req.method === 'POST' && pathname === '/api/allocate') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    let period = periodOf();
    if (body.period !== undefined) {
      if (typeof body.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period)) {
        throw new AppError('INVALID_PERIOD', 'Period must be a real month in YYYY-MM format.');
      }
      period = body.period;
    }
    const nextMonth = todayString(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)).slice(0, 7);
    if (period < periodOf() || period > nextMonth) throw new AppError('INVALID_PERIOD', 'Fund this month or next month. Past budgets are available in History.');
    if (state.settings.planConfirmed === false) throw new AppError('PLAN_NOT_CONFIRMED', 'Review and save your plan first.');
    const allocation = allocateMonth(state, period, {partial: Boolean(body.partial)});
    store.set(state);
    return sendJson(res, 200, reply({ allocation }));
  }

  const undoMatch = pathname.match(/^\/api\/allocations\/([^/]+)\/undo$/);
  if (undoMatch && req.method === 'POST') {
    const state = structuredClone(store.get());
    const allocation = undoAllocation(state, undoMatch[1]);
    store.set(state);
    return sendJson(res, 200, reply({ allocation }));
  }

  const investmentValueMatch = pathname.match(/^\/api\/investments\/([^/]+)\/value$/);
  if (investmentValueMatch && req.method === 'POST') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const category = updateInvestmentValue(
      state,
      investmentValueMatch[1],
      body.worthPaise
    );
    if (Object.hasOwn(body, 'openingCostPaise')) updateInvestmentHistory(state, investmentValueMatch[1], body.openingCostPaise);
    store.set(state);
    return sendJson(res, 200, reply({ category }));
  }

  if (req.method === 'POST' && pathname === '/api/reconcile') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const balance = requirePaise(body.balancePaise, 'Bank balance', { min: 0 });
    const adjustment = reconcileBalance(state, balance, body.note);
    store.set(state);
    return sendJson(res, 200, reply({ adjustment }));
  }

  if (req.method === 'POST' && pathname === '/api/move') {
    const body = await readJson(req);
    const state = structuredClone(store.get());
    const move = moveBetweenEnvelopes(state, body);
    store.set(state);
    return sendJson(res, 200, reply({ move }));
  }

  if (req.method === 'POST' && pathname === '/api/ingest') {
    const body = await readJson(req);
    return sendJson(res, 200, handleIngest(req, url, body));
  }

  throw new AppError('NOT_FOUND', 'Not found.', 404);
}

async function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? '/index.html' : pathname;
  if (relative.includes('\0')) {
    return sendJson(res, 400, { error: 'Bad path.' });
  }
  const filePath = path.resolve(PUBLIC_DIR, `.${relative}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return sendJson(res, 403, { error: 'Forbidden.' });
  }
  if (!existsSync(filePath)) {
    return sendJson(res, 404, { error: 'Not found.' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const body = await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    if (error instanceof AppError) {
      return sendJson(res, error.status, {
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }
    console.error(error);
    return sendJson(res, 500, { error: 'Something went wrong on the server.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Khaata is running at http://${HOST}:${PORT}`);
  console.log(`Data: ${DATA_FILE}`);
});

export { server };

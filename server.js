import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { createState, createDemoState, fitDefaultsToIncome } from './lib/seed.js';
import {
  AppError,
  addTransaction,
  allocateMonth,
  clientState,
  deleteTransaction,
  guessCategoryId,
  isValidDate,
  moveBetweenEnvelopes,
  periodOf,
  reconcileBalance,
  rotateIngestToken,
  rupeesText,
  savePlan,
  todayString,
  undoAllocation,
  updateTransaction,
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
    if (size > 1_000_000) {
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

function stateResponse(extra = {}) {
  return { state: clientState(store.get()), ...extra };
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

  let warning = null;
  try {
    allocateMonth(state);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'INSUFFICIENT_FUNDS') throw error;
    warning = `${rupeesText(error.details.shortfallPaise)} short of this month's plan. Add the salary credit or adjust the plan, then allocate.`;
  }

  store.set(state);
  return stateResponse({ warning });
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
  const date = isValidDate(body.date) ? body.date : todayString();
  const kind = body.kind || (direction === 'in' ? 'income' : 'expense');
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
    categoryId = state.categories.find((c) => c.id === 'invest' && !c.archived)?.id ?? null;
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
      : reconcileBalance(state, targetBalancePaise, 'Auto-synced from alert balance');

  store.save();
  return stateResponse({ duplicate: false, transaction, adjustment });
}

async function handleApi(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, stateResponse());
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

  if (req.method === 'POST' && pathname === '/api/reset') {
    store.set(createState());
    return sendJson(res, 200, stateResponse());
  }

  if (req.method === 'POST' && pathname === '/api/token') {
    rotateIngestToken(store.get());
    store.save();
    return sendJson(res, 200, stateResponse());
  }

  if (req.method === 'POST' && pathname === '/api/transactions') {
    const body = await readJson(req);
    const state = store.get();
    const transaction = addTransaction(state, body);
    store.save();
    return sendJson(res, 200, stateResponse({ transaction }));
  }

  const txMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (txMatch && req.method === 'PUT') {
    const body = await readJson(req);
    const state = store.get();
    const transaction = updateTransaction(state, txMatch[1], body);
    store.save();
    return sendJson(res, 200, stateResponse({ transaction }));
  }

  if (txMatch && req.method === 'DELETE') {
    const state = store.get();
    const transaction = deleteTransaction(state, txMatch[1]);
    store.save();
    return sendJson(res, 200, stateResponse({ transaction }));
  }

  if (req.method === 'PUT' && pathname === '/api/plan') {
    const body = await readJson(req);
    const state = store.get();
    const result = savePlan(state, body);
    store.save();
    return sendJson(res, 200, stateResponse({ plan: result }));
  }

  if (req.method === 'POST' && pathname === '/api/allocate') {
    const body = await readJson(req);
    const state = store.get();
    const period = typeof body.period === 'string' && /^\d{4}-\d{2}$/.test(body.period)
      ? body.period
      : periodOf();
    const allocation = allocateMonth(state, period);
    store.save();
    return sendJson(res, 200, stateResponse({ allocation }));
  }

  const undoMatch = pathname.match(/^\/api\/allocations\/([^/]+)\/undo$/);
  if (undoMatch && req.method === 'POST') {
    const state = store.get();
    const allocation = undoAllocation(state, undoMatch[1]);
    store.save();
    return sendJson(res, 200, stateResponse({ allocation }));
  }

  if (req.method === 'POST' && pathname === '/api/reconcile') {
    const body = await readJson(req);
    const state = store.get();
    const balance = requirePaise(body.balancePaise, 'Bank balance', { min: 0 });
    const adjustment = reconcileBalance(state, balance, body.note);
    store.save();
    return sendJson(res, 200, stateResponse({ adjustment }));
  }

  if (req.method === 'POST' && pathname === '/api/move') {
    const body = await readJson(req);
    const state = store.get();
    const move = moveBetweenEnvelopes(state, body);
    store.save();
    return sendJson(res, 200, stateResponse({ move }));
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

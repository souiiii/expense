const app = {
  data: null,
  view: 'dashboard',
  txKind: 'all',
  txSearch: '',
  planDirty: false,
  modalOpen: false,
  pendingConfirm: null,
  lastStateJson: '',
};

const VIEWS = ['dashboard', 'plan', 'transactions', 'settings'];

const PALETTE = [
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

const ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>`,
  plan: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h8"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M12 17h8"/><circle cx="9.5" cy="17" r="2"/></svg>`,
  transactions: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h11"/><circle cx="19.5" cy="17.5" r="1.1" fill="currentColor" stroke="none"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M12 2.6v2.1M12 19.3v2.1M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5"/></svg>`,
};

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="6" rx="3" fill="currentColor" opacity=".96"/><rect x="3" y="14.5" width="19" height="6" rx="3" fill="currentColor" opacity=".55"/><rect x="3" y="23" width="23" height="6" rx="3" fill="currentColor" opacity=".3"/></svg>`;

const moneyFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const moneyExactFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
const money = (paise, exact = false) => {
  const value = Number(paise) || 0;
  const formatter = exact || Math.abs(value) % 100 !== 0 ? moneyExactFmt : moneyFmt;
  return formatter.format(value / 100);
};
const rupeesInput = (paise) => (Number(paise) || 0) / 100;
const toPaise = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};
const formatPercent = (value) => {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
};

function todayStr() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function viewFromHash() {
  const view = location.hash.replace(/^#\/?/, '');
  return VIEWS.includes(view) ? view : 'dashboard';
}

function monthLabel(period) {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

function formatDate(value, short = false) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(short ? {} : { year: 'numeric' }),
  });
}

function categoryById(id) {
  return app.data?.categories.find((category) => category.id === id) ?? null;
}

function activeCategories() {
  return app.data?.categories.filter((category) => !category.archived) ?? [];
}

function acceptState(state) {
  app.data = state;
  app.lastStateJson = JSON.stringify(state);
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.code = data?.code;
    error.details = data?.details;
    throw error;
  }
  return data;
}

async function load() {
  const response = await api('/api/state');
  acceptState(response.state);
  render();
}

async function mutate(path, options) {
  const response = await api(path, options);
  if (response.state) {
    acceptState(response.state);
    render();
  }
  return response;
}

function toast(message, tone = 'ok') {
  const root = $('#toast-root');
  if (!root) return;
  const element = document.createElement('div');
  element.className = `toast ${tone}`;
  element.textContent = message;
  root.append(element);
  setTimeout(() => {
    element.classList.add('out');
    setTimeout(() => element.remove(), 260);
  }, tone === 'error' ? 5600 : 3800);
}

function brandMarkup(compact = false) {
  return `<div class="brand ${compact ? 'compact' : ''}">
    <span class="logo-mark" aria-hidden="true">${LOGO}</span>
    <div class="brand-text"><strong>Khaata</strong>${compact ? '' : '<span>Salary, divided.</span>'}</div>
  </div>`;
}

function navItem(view, label) {
  return `<button class="nav-item ${app.view === view ? 'active' : ''}" data-action="nav" data-view="${view}">
    ${ICONS[view]}<span>${label}</span>
  </button>`;
}

function setupView() {
  return `<div class="setup">
    <div class="setup-card">
      ${brandMarkup()}
      <p class="eyebrow" style="margin-top:34px">Start here</p>
      <h1>Salary,<br /><em>divided.</em></h1>
      <p class="lede">One bank balance. Fixed commitments first, percentages for everything else, and rollover for what you save up for.</p>
      <form data-form="setup" autocomplete="off">
        <label class="field">
          <span>Monthly take-home</span>
          <div class="money-input"><span>₹</span><input name="income" type="number" min="0" step="100" value="100000" inputmode="numeric" required /></div>
        </label>
        <label class="field">
          <span>What is in your bank right now?</span>
          <div class="money-input"><span>₹</span><input name="balance" type="number" min="0" step="100" value="" placeholder="e.g. 52000" inputmode="numeric" required /></div>
        </label>
        <p class="hint">Use the real balance. If salary hasn't landed yet, enter what's there now — you can allocate when it arrives.</p>
        <button class="btn primary wide" type="submit">Start budgeting</button>
      </form>
      <div class="setup-alt">
        <button class="link-btn" type="button" data-action="demo-setup">Or explore with demo data →</button>
      </div>
      <p class="fine">Everything lives in <code>data/store.json</code> on this computer. No bank login, no cloud.</p>
    </div>
  </div>`;
}

function shellView() {
  const derived = app.data.derived;
  return `<div class="shell">
    <aside class="sidebar">
      ${brandMarkup()}
      <nav class="nav" aria-label="Main">
        ${navItem('dashboard', 'Overview')}
        ${navItem('plan', 'Plan')}
        ${navItem('transactions', 'Transactions')}
        ${navItem('settings', 'Settings')}
      </nav>
      <div class="sidebar-foot">
        <div class="side-balance">
          <span>In the bank</span>
          <strong>${money(derived.bankBalancePaise)}</strong>
          <small>${monthLabel(derived.period)}</small>
        </div>
        <p class="fine">Local only · no bank login</p>
      </div>
    </aside>

    <main class="main">
      <header class="mobile-head">
        ${brandMarkup(true)}
        <button class="btn primary small" data-action="open-tx">+ Spend</button>
      </header>
      <div class="view">${viewMarkup()}</div>
    </main>

    <nav class="bottom-nav" aria-label="Main">
      ${navItem('dashboard', 'Overview')}
      ${navItem('plan', 'Plan')}
      ${navItem('transactions', 'Activity')}
      ${navItem('settings', 'Settings')}
    </nav>
  </div>`;
}

function viewMarkup() {
  switch (app.view) {
    case 'plan':
      return planView();
    case 'transactions':
      return transactionsView();
    case 'settings':
      return settingsView();
    default:
      return dashboardView();
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                          */
/* ------------------------------------------------------------------ */

function dashboardView() {
  const derived = app.data.derived;
  const targets = new Map(
    derived.plan.items.map((item) => [item.categoryId, item.targetPaise])
  );
  const categories = activeCategories();
  const fixed = categories.filter((category) => category.kind === 'fixed');
  const flexible = categories.filter((category) => category.kind === 'flex');
  const summary = derived.summary;

  const notice = allocationNotice(derived);

  return `<section class="hero">
    <div class="hero-glow" aria-hidden="true"></div>
    <div class="hero-main">
      <p class="eyebrow light">In your bank · ${monthLabel(derived.period)}</p>
      <h1 class="balance">${money(derived.bankBalancePaise)}</h1>
      <p class="hero-sub">${money(derived.allocatedPaise)} divided across ${categories.length} envelopes${
        derived.unallocatedPaise !== 0
          ? ` · <span class="${derived.unallocatedPaise < 0 ? 'hero-neg' : ''}">${money(
              derived.unallocatedPaise
            )} unallocated</span>`
          : ''
      }</p>
    </div>
    <div class="hero-actions">
      <button class="btn primary light" data-action="open-tx">Add expense</button>
      <button class="btn hero-ghost" data-action="open-move">Move money</button>
      <button class="btn hero-ghost" data-action="open-reconcile">Reconcile</button>
    </div>
  </section>

  ${notice}

  <div class="stats">
    ${statCard('Spent this month', money(summary.spentPaise), `${summary.transactionCount} transaction${summary.transactionCount === 1 ? '' : 's'}`)}
    ${statCard('Moved to assets', money(summary.investedPaise), 'SIPs and transfers out')}
    ${statCard(
      'Unallocated',
      money(derived.unallocatedPaise),
      derived.allocation ? 'Outside the envelopes' : 'Waiting to be divided',
      derived.unallocatedPaise < 0 ? 'negative' : derived.unallocatedPaise > 0 ? 'warm' : ''
    )}
  </div>

  ${envelopeSection('Commitments', 'Rent, EMI, investing — funded first.', fixed, targets, summary)}
  ${envelopeSection('Everyday', 'What is left, split by percentage.', flexible, targets, summary)}

  <section class="panel recents">
    <div class="panel-head">
      <div><h2>Recent activity</h2><p>The last few movements through your accounts.</p></div>
      <button class="link-btn" data-action="nav" data-view="transactions">View all →</button>
    </div>
    ${txList(app.data.transactions.slice(0, 6), 'No transactions yet. Add one, or send a bank alert to the ingest endpoint.')}
  </section>`;
}

function statCard(label, value, sub, tone = '') {
  return `<div class="stat ${tone}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
}

function envelopeSection(title, subtitle, categories, targets, summary) {
  if (categories.length === 0) return '';
  return `<section class="section">
    <div class="section-head">
      <div><h2>${title}</h2><p>${subtitle}</p></div>
      <button class="link-btn" data-action="nav" data-view="plan">Edit plan →</button>
    </div>
    <div class="env-grid">
      ${categories
        .map((category) =>
          envelopeCard(
            category,
            targets.get(category.id) ?? 0,
            summary.spentByCategory[category.id] ?? 0,
            summary.transferredByCategory?.[category.id] ?? 0
          )
        )
        .join('')}
    </div>
  </section>`;
}

function envelopeCard(category, target, spent, moved) {
  const balance = category.balancePaise;
  const ratio =
    target > 0
      ? Math.max(0, Math.min(1, balance / target))
      : balance > 0
        ? 1
        : 0;
  const over = balance < 0;
  const rollMeta = category.rollover
    ? category.capPaise !== null && category.capPaise !== undefined
      ? `Rolls over · cap ${money(category.capPaise)}`
      : 'Rolls over'
    : 'Resets monthly';

  return `<article class="env-card ${over ? 'is-over' : ''}" style="--accent:${esc(category.color)}">
    <div class="env-head">
      <span class="env-icon" style="background:${esc(category.color)}1f">${esc(category.icon)}</span>
      <div class="env-title"><h3>${esc(category.name)}</h3><span>${rollMeta}</span></div>
      <button class="icon-btn add" data-action="open-tx" data-category="${esc(category.id)}" data-kind="expense" title="Log an expense from ${esc(category.name)}" aria-label="Log an expense from ${esc(category.name)}">+</button>
    </div>
    <div class="env-amount">${money(balance)}</div>
    <div class="env-target">of ${target > 0 ? money(target) : 'no target'} ${
      category.rollover && balance > target && target > 0 ? '· saved up' : ''
    }</div>
    <div class="bar"><span style="width:${(ratio * 100).toFixed(1)}%;background:${esc(category.color)}"></span></div>
    <div class="env-foot">
      <span>${
        moved > 0
          ? `Moved ${money(moved)} out`
          : spent > 0
            ? `Spent ${money(spent)} this month`
            : 'Nothing spent yet'
      }</span>
      ${
        over
          ? `<button class="link-btn danger" data-action="open-move" data-to="${esc(category.id)}">Cover gap</button>`
          : ''
      }
    </div>
  </article>`;
}

function allocationNotice(derived) {
  const unallocated = derived.unallocatedPaise;

  if (unallocated < 0) {
    return `<div class="notice danger">
      <div class="notice-copy"><strong>Your envelopes are overdrawn by ${money(-unallocated)}.</strong><span>Move money from another envelope to cover the gap.</span></div>
      <div class="notice-actions"><button class="btn ghost" data-action="open-move">Move money</button></div>
    </div>`;
  }

  if (!derived.allocation && unallocated > 0) {
    return `<div class="notice warn">
      <div class="notice-copy"><strong>${money(unallocated)} is waiting to be divided.</strong><span>Run ${monthLabel(derived.period)}'s allocation to fill each envelope to its target.</span></div>
      <div class="notice-actions"><button class="btn primary" data-action="open-allocate">Allocate ${monthLabel(derived.period)}</button></div>
    </div>`;
  }

  if (!derived.allocation && unallocated === 0) {
    return `<div class="notice quiet">
      <div class="notice-copy"><strong>Nothing unallocated yet.</strong><span>When your salary lands, record it as income and allocate it.</span></div>
      <div class="notice-actions"><button class="btn ghost" data-action="open-tx" data-kind="income">Add income</button></div>
    </div>`;
  }

  if (derived.allocation && unallocated > 0) {
    return `<div class="notice warn">
      <div class="notice-copy"><strong>${money(unallocated)} is unallocated.</strong><span>This month is already allocated. Move the extra into an envelope.</span></div>
      <div class="notice-actions"><button class="btn ghost" data-action="open-move">Move money</button></div>
    </div>`;
  }

  return '';
}

function txList(transactions, emptyMessage) {
  if (!transactions || transactions.length === 0) {
    return `<div class="empty"><span>◎</span><p>${esc(emptyMessage)}</p></div>`;
  }
  return `<div class="tx-list" id="tx-list">${transactions.map(txRow).join('')}</div>`;
}

function txRow(transaction) {
  const category = categoryById(transaction.categoryId);
  const incoming = transaction.direction === 'in';
  const icon =
    category?.icon ||
    (transaction.kind === 'income'
      ? '💵'
      : transaction.kind === 'adjustment'
        ? '⚖️'
        : transaction.kind === 'transfer'
          ? '📈'
          : '💸');
  const colour = category?.color || '#8a8376';
  const label = category?.name || kindLabel(transaction.kind);
  const search = `${transaction.description} ${label} ${transaction.notes || ''}`.toLowerCase();

  return `<button class="tx-row" data-action="edit-tx" data-id="${esc(transaction.id)}" data-kind="${esc(
    transaction.kind
  )}" data-search="${esc(search)}">
    <span class="tx-date">${formatDate(transaction.date, true)}</span>
    <span class="tx-icon" style="background:${esc(colour)}1f">${esc(icon)}</span>
    <span class="tx-main">
      <strong>${esc(transaction.description)}</strong>
      <span>${esc(label)}${transaction.source === 'alert' ? ' · auto' : ''}</span>
    </span>
    <span class="tx-amount ${incoming ? 'in' : ''}">${incoming ? '+' : '−'}${money(transaction.amountPaise)}</span>
  </button>`;
}

function kindLabel(kind) {
  return (
    {
      expense: 'Expense',
      income: 'Income',
      transfer: 'Transfer to asset',
      adjustment: 'Balance adjustment',
    }[kind] || kind
  );
}

/* ------------------------------------------------------------------ */
/* Plan                                                               */
/* ------------------------------------------------------------------ */

function planView() {
  const derived = app.data.derived;
  const targets = new Map(
    derived.plan.items.map((item) => [item.categoryId, item.targetPaise])
  );
  const categories = activeCategories();
  const fixed = categories.filter((category) => category.kind === 'fixed');
  const flexible = categories.filter((category) => category.kind === 'flex');
  const allocation = derived.allocation;
  const settings = app.data.settings;
  const surplusOptions = categories
    .map(
      (category) =>
        `<option value="${esc(category.id)}" ${
          category.id === settings.surplusCategoryId ? 'selected' : ''
        }>${esc(category.name)}${category.rollover ? '' : ' (resets)'}</option>`
    )
    .join('');

  return `<div class="page-head">
    <div>
      <p class="eyebrow">The plan</p>
      <h1>Monthly plan</h1>
      <p class="lede">Fixed commitments first. The rest is split by percentage. Change it once, and every payday follows it.</p>
    </div>
    <button class="btn ghost" data-action="nav" data-view="dashboard">Back to overview</button>
  </div>

  <div class="status-card ${allocation ? 'ok' : 'warn'}">
    <div>
      <strong>${allocation ? `${monthLabel(derived.period)} is allocated` : `${monthLabel(derived.period)} is not allocated yet`}</strong>
      <span>${
        allocation
          ? `Funded ${money(allocation.fundedPaise)} · ${money(allocation.surplusPaise)} swept to surplus`
          : 'Fill each envelope from the money sitting in your bank.'
      }</span>
    </div>
    ${
      allocation
        ? allocation.canUndo
          ? `<button class="btn ghost" data-action="undo-allocation">Undo allocation</button>`
          : `<span class="status-note">Spending recorded. Use Move money to adjust envelopes.</span>`
        : `<button class="btn primary" data-action="open-allocate">Allocate now</button>`
    }
  </div>

  <form id="plan-form" data-form="plan" autocomplete="off">
    <div class="plan-controls">
      <label class="field">
        <span>Monthly take-home</span>
        <div class="money-input"><span>₹</span><input name="income" type="number" min="0" step="100" value="${rupeesInput(
          settings.monthlyIncomePaise
        )}" inputmode="numeric" /></div>
      </label>
      <label class="field">
        <span>Salary day</span>
        <input name="payday" type="number" min="1" max="28" value="${settings.paydayDay}" />
      </label>
      <label class="field">
        <span>Surplus goes to</span>
        <select name="surplus">${surplusOptions}</select>
      </label>
    </div>

    <div class="plan-summary" id="plan-summary"></div>

    ${planSection('fixed', 'Commitments', 'Fixed rupee amounts, funded before anything else.', fixed, targets)}
    ${planSection('flex', 'Everyday', 'These split the flexible pool by percentage.', flexible, targets)}

    <p class="plan-note">Changing the plan does not rewrite this month's envelopes. It takes effect the next time you allocate.</p>

    <div class="savebar" id="savebar" hidden>
      <div><strong>Unsaved changes</strong><span>Applied at the next allocation.</span></div>
      <div class="savebar-actions">
        <button type="button" class="btn ghost" data-action="discard-plan">Discard</button>
        <button type="submit" class="btn primary" id="save-plan-btn">Save plan</button>
      </div>
    </div>
  </form>`;
}

function planSection(kind, title, subtitle, categories, targets) {
  return `<section class="plan-section">
    <div class="plan-section-head">
      <div><h2>${title}</h2><span>${subtitle}</span></div>
      <button type="button" class="link-btn" data-action="add-row" data-kind="${kind}">+ Add ${
        kind === 'fixed' ? 'commitment' : 'envelope'
      }</button>
    </div>
    <div class="plan-table" data-kind="${kind}">
      <div class="plan-head">
        <span>Envelope</span><span>${kind === 'fixed' ? 'Monthly' : 'Share'}</span><span>Target</span><span>Roll</span><span>Cap</span><span></span>
      </div>
      <div class="plan-rows">
        ${categories
          .map((category) => planRow(category, targets.get(category.id) ?? 0))
          .join('')}
      </div>
    </div>
  </section>`;
}

function planRow(category, target) {
  const isFixed = category.kind === 'fixed';
  const color = category.color || PALETTE[0];
  return `<div class="plan-row" data-cat="${esc(category.id || '')}" data-kind="${esc(
    category.kind
  )}" data-icon="${esc(category.icon || '🏷️')}" data-color="${esc(color)}" data-balance="${
    category.balancePaise || 0
  }">
    <div class="plan-name">
      <button type="button" class="env-icon sm" style="background:${esc(color)}1f" data-action="cycle-icon" title="Change icon">${esc(
        category.icon || '🏷️'
      )}</button>
      <input name="name" value="${esc(category.name || '')}" placeholder="Envelope name" maxlength="40" aria-label="Envelope name" />
    </div>
    <div class="plan-input">
      ${
        isFixed
          ? `<span class="affix">₹</span><input name="target" type="number" min="0" step="100" value="${rupeesInput(
              category.targetPaise
            )}" aria-label="Monthly amount" />`
          : `<input name="percent" type="number" min="0" max="100" step="0.5" value="${formatPercent(
              category.percent
            )}" aria-label="Percentage of flexible pool" /><span class="affix">%</span>`
      }
    </div>
    <div class="plan-target" data-target>${isFixed ? '<span class="muted">fixed</span>' : money(target)}</div>
    <label class="check"><input type="checkbox" name="rollover" ${
      category.rollover ? 'checked' : ''
    } /><span>Roll</span></label>
    <div class="plan-input cap">
      <span class="affix">₹</span><input name="cap" type="number" min="0" step="100" value="${
        category.capPaise !== null && category.capPaise !== undefined
          ? rupeesInput(category.capPaise)
          : ''
      }" placeholder="No cap" aria-label="Rollover cap" />
    </div>
    <button type="button" class="icon-btn danger" data-action="remove-row" ${
      category.balancePaise !== 0 ? 'disabled title="Move the balance out first"' : ''
    } aria-label="Remove ${esc(category.name || 'envelope')}">×</button>
  </div>`;
}

function updatePlanPreview() {
  const form = $('#plan-form');
  if (!form) return;

  const income = toPaise(form.elements.income.value);
  const rows = $$('.plan-row', form);
  const fixedRows = rows.filter((row) => row.dataset.kind === 'fixed');
  const flexRows = rows.filter((row) => row.dataset.kind === 'flex');

  const fixedTotal = fixedRows.reduce(
    (sum, row) => sum + toPaise(row.querySelector('[name="target"]').value),
    0
  );
  const percentTotal =
    Math.round(
      flexRows.reduce(
        (sum, row) => sum + (Number(row.querySelector('[name="percent"]').value) || 0),
        0
      ) * 100
    ) / 100;
  const pool = Math.max(0, income - fixedTotal);

  let flexTotal = 0;
  for (const row of flexRows) {
    const percent = Number(row.querySelector('[name="percent"]').value) || 0;
    const target = Math.round((pool * percent) / 100);
    flexTotal += target;
    const targetNode = row.querySelector('[data-target]');
    if (targetNode) targetNode.textContent = money(target);
  }

  const planned = fixedTotal + flexTotal;
  const unplanned = income - planned;
  const percentOk = flexRows.length === 0 || Math.abs(percentTotal - 100) < 0.01;
  const incomeOk = income > 0;
  const overIncome = fixedTotal > income;
  const summary = $('#plan-summary');

  if (summary) {
    const fixedWidth = income > 0 ? Math.min(100, (fixedTotal / income) * 100) : 0;
    const flexWidth = income > 0 ? Math.min(100 - fixedWidth, (flexTotal / income) * 100) : 0;
    const statusClass = percentOk && !overIncome && incomeOk ? 'ok' : 'bad';
    const statusText = !incomeOk
      ? 'Enter your monthly take-home.'
      : overIncome
        ? `Fixed commitments are ${money(fixedTotal - income)} more than your income.`
        : !percentOk
          ? `Flexible envelopes add up to ${formatPercent(percentTotal)}%. They must add up to 100%.`
          : `Fixed ${money(fixedTotal)} + flexible ${money(flexTotal)} = ${money(planned)}. ${
              unplanned === 0 ? 'Every rupee planned.' : `${money(unplanned)} unplanned.`
            }`;

    summary.innerHTML = `<div class="alloc-bar" aria-hidden="true">
      <span style="width:${fixedWidth}%;background:#b4643c"></span>
      <span style="width:${flexWidth}%;background:#23735f"></span>
    </div>
    <div class="alloc-legend">
      <span><i style="background:#b4643c"></i>Fixed ${money(fixedTotal)}</span>
      <span><i style="background:#23735f"></i>Flexible ${money(flexTotal)}</span>
      <span><i class="unplanned"></i>Unplanned ${money(Math.max(0, unplanned))}</span>
    </div>
    <div class="alloc-status ${statusClass}">${statusText}</div>`;
  }

  const saveButton = $('#save-plan-btn');
  if (saveButton) saveButton.disabled = !(percentOk && !overIncome && incomeOk);
}

function markPlanDirty() {
  app.planDirty = true;
  const bar = $('#savebar');
  if (bar) bar.hidden = false;
}

function addPlanRow(kind) {
  const form = $('#plan-form');
  if (!form) return;
  const container = form.querySelector(`.plan-table[data-kind="${kind}"] .plan-rows`);
  if (!container) return;
  const count = $$('.plan-row', form).length;
  const category = {
    id: '',
    name: '',
    kind,
    targetPaise: 0,
    percent: 0,
    rollover: false,
    capPaise: null,
    icon: '🏷️',
    color: PALETTE[count % PALETTE.length],
    balancePaise: 0,
  };
  container.insertAdjacentHTML('beforeend', planRow(category, 0));
  markPlanDirty();
  updatePlanPreview();
  const rows = $$('.plan-row', container);
  rows[rows.length - 1]?.querySelector('[name="name"]')?.focus();
}

function removePlanRow(button) {
  const row = button.closest('.plan-row');
  if (!row) return;
  if (Number(row.dataset.balance) !== 0) {
    toast('Move the money out of this envelope before removing it.', 'error');
    return;
  }
  row.remove();
  markPlanDirty();
  updatePlanPreview();
}

function collectPlan() {
  const form = $('#plan-form');
  const rows = $$('.plan-row', form);
  return {
    monthlyIncomePaise: toPaise(form.elements.income.value),
    paydayDay: Number(form.elements.payday.value),
    surplusCategoryId: form.elements.surplus.value || null,
    categories: rows.map((row) => {
      const kind = row.dataset.kind;
      const capValue = row.querySelector('[name="cap"]').value;
      return {
        id: row.dataset.cat || undefined,
        kind,
        name: row.querySelector('[name="name"]').value.trim(),
        targetPaise: kind === 'fixed' ? toPaise(row.querySelector('[name="target"]').value) : 0,
        percent: kind === 'flex' ? Number(row.querySelector('[name="percent"]').value) || 0 : 0,
        rollover: row.querySelector('[name="rollover"]').checked,
        capPaise: capValue === '' ? null : toPaise(capValue),
        icon: row.dataset.icon,
        color: row.dataset.color,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Transactions                                                       */
/* ------------------------------------------------------------------ */

function transactionsView() {
  const transactions = app.data.transactions;
  const filters = [
    ['all', 'All'],
    ['expense', 'Expenses'],
    ['income', 'Income'],
    ['transfer', 'Transfers'],
  ];

  return `<div class="page-head">
    <div>
      <p class="eyebrow">The ledger</p>
      <h1>Transactions</h1>
      <p class="lede">Everything that moved in or out of your bank, and which envelope it touched.</p>
    </div>
    <button class="btn primary" data-action="open-tx">Add transaction</button>
  </div>

  <div class="filters">
    <div class="seg small" id="tx-filters">
      ${filters
        .map(
          ([value, label]) =>
            `<button type="button" class="${app.txKind === value ? 'active' : ''}" data-action="tx-filter" data-kind="${value}">${label}</button>`
        )
        .join('')}
    </div>
    <input id="tx-search" type="search" placeholder="Search description or envelope" value="${esc(
      app.txSearch
    )}" />
  </div>

  <div class="tx-meta"><span id="tx-count"></span></div>

  ${
    transactions.length === 0
      ? `<div class="empty large"><span>◎</span><p>No transactions yet.</p><small>Add one, or wire a bank alert to the ingest endpoint in Settings.</small></div>`
      : `<div class="panel tx-panel">${txList(
          transactions,
          ''
        )}<div class="empty" id="tx-empty" hidden><span>◎</span><p>Nothing matches that filter.</p></div></div>`
  }`;
}

function applyTxFilter() {
  const rows = $$('#tx-list .tx-row');
  const query = app.txSearch.trim().toLowerCase();
  let visible = 0;

  for (const row of rows) {
    const kindOk = app.txKind === 'all' || row.dataset.kind === app.txKind;
    const searchOk = !query || row.dataset.search.includes(query);
    const show = kindOk && searchOk;
    row.hidden = !show;
    if (show) visible += 1;
  }

  const count = $('#tx-count');
  if (count) {
    count.textContent = `${visible} transaction${visible === 1 ? '' : 's'}`;
  }
  const empty = $('#tx-empty');
  if (empty) empty.hidden = visible > 0;
  for (const button of $$('#tx-filters [data-action="tx-filter"]')) {
    button.classList.toggle('active', button.dataset.kind === app.txKind);
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function settingsView() {
  const settings = app.data.settings;
  const derived = app.data.derived;
  const endpoint = `${location.origin}/api/ingest`;
  const token = settings.ingestToken;
  const curl = `curl -s -X POST ${endpoint} \\
  -H 'content-type: application/json' \\
  -H 'x-ingest-token: ${token}' \\
  -d '{"amount":450.50,"direction":"out","description":"Swiggy","balance":52187.50}'`;

  return `<div class="page-head">
    <div>
      <p class="eyebrow">Settings</p>
      <h1>Setup &amp; data</h1>
      <p class="lede">Your ledger is a single file on this computer. The only way in is this app and the token below.</p>
    </div>
  </div>

  <div class="settings-grid">
    <section class="panel">
      <div class="panel-head"><div><h2>Monthly plan</h2><p>What payday follows.</p></div></div>
      <dl class="kv">
        ${kv('Take-home', money(settings.monthlyIncomePaise))}
        ${kv('Salary day', `Day ${settings.paydayDay}`)}
        ${kv('Fixed commitments', money(derived.plan.fixedTotalPaise))}
        ${kv('Flexible pool', money(derived.plan.flexPoolPaise))}
        ${kv('Surplus goes to', esc(categoryById(settings.surplusCategoryId)?.name || 'Unallocated'))}
      </dl>
      <button class="btn ghost wide" data-action="nav" data-view="plan">Edit plan</button>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>Bank balance</h2><p>The app's current view.</p></div></div>
      <p class="big-money">${money(derived.bankBalancePaise)}</p>
      <p class="hint">${money(derived.allocatedPaise)} sits in envelopes, ${money(
        derived.unallocatedPaise
      )} is unallocated.</p>
      <button class="btn ghost wide" data-action="open-reconcile">Reconcile with the bank</button>
    </section>

    <section class="panel wide">
      <div class="panel-head"><div><h2>Automatic updates</h2><p>Send bank or UPI alerts here and the app updates itself.</p></div></div>
      <p class="hint">Works with iPhone Shortcuts, Android Tasker/MacroDroid, or any script that can POST JSON. If the alert includes the available balance, the app also reconciles itself to it.</p>

      <div class="code-line">
        <span class="code-label">Endpoint</span>
        <code>${esc(endpoint)}</code>
        <button class="mini-btn" data-action="copy" data-copy="endpoint">Copy</button>
      </div>
      <div class="code-line">
        <span class="code-label">Token</span>
        <code class="token">${esc(token)}</code>
        <button class="mini-btn" data-action="copy" data-copy="token">Copy</button>
      </div>
      <div class="code-line">
        <span class="code-label">Rotate</span>
        <span class="hint inline">If the token leaks, replace it. Old automations will stop working.</span>
        <button class="mini-btn" data-action="rotate-token">New token</button>
      </div>

      <pre class="snippet"><code>${esc(curl)}</code></pre>

      <details class="how">
        <summary>How to automate it</summary>
        <p><strong>iPhone:</strong> Shortcuts → Automation → when you receive an SMS or email from your bank → Get Text → Get Contents of URL → POST the endpoint above with the token header and a JSON body.</p>
        <p><strong>Android:</strong> Tasker or MacroDroid → notification received from your bank/UPI app → HTTP POST the same JSON. The notification listener is the closest thing to instant updates.</p>
        <p><strong>Security:</strong> the server listens on <code>127.0.0.1</code> by default. To reach it from your phone, run with <code>HOST=0.0.0.0 npm start</code> and use your Mac's LAN address. Keep the token private; it can write to your ledger.</p>
      </details>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>Backup</h2><p>A readable JSON copy.</p></div></div>
      <p class="hint">Everything is in <code>data/store.json</code>, with the previous version in <code>data/store.json.bak</code>.</p>
      <a class="btn ghost wide" href="/api/export" download>Download backup</a>
    </section>

    <section class="panel danger-zone">
      <div class="panel-head"><div><h2>Danger zone</h2><p>These replace your current ledger.</p></div></div>
      <button class="btn ghost wide" data-action="load-demo">Load demo data</button>
      <button class="btn danger wide" data-action="reset-all">Start over</button>
    </section>
  </div>`;
}

function kv(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

/* ------------------------------------------------------------------ */
/* Modal plumbing                                                     */
/* ------------------------------------------------------------------ */

function modalShell({ title, subtitle = '', body, footer = '' }) {
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head">
      <div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
      <button class="icon-btn" data-action="close-modal" aria-label="Close">×</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
}

function openModal(innerHtml, focusSelector = '#modal-root input:not([type="hidden"]), #modal-root select, #modal-root textarea') {
  app.modalOpen = true;
  $('#modal-root').innerHTML = `<div class="modal-backdrop">${innerHtml}</div>`;
  requestAnimationFrame(() => {
    const focusable = $(focusSelector);
    focusable?.focus();
  });
}

function closeModal() {
  app.modalOpen = false;
  app.pendingConfirm = null;
  $('#modal-root').innerHTML = '';
}

function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false, action }) {
  app.pendingConfirm = action;
  openModal(
    modalShell({
      title,
      body: `<p class="confirm-copy">${message}</p>`,
      footer: `<button class="btn ghost" data-action="close-modal">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-action="confirm-action">${esc(
          confirmLabel
        )}</button>`,
    })
  );
}

/* ------------------------------------------------------------------ */
/* Transaction modal                                                  */
/* ------------------------------------------------------------------ */

function typeOption(value, label, current) {
  return `<label><input type="radio" name="tx-type" value="${value}" ${
    value === current ? 'checked' : ''
  } /><span>${label}</span></label>`;
}

function categoryOptions(categories, selectedId) {
  return categories
    .map(
      (category) =>
        `<option value="${esc(category.id)}" ${
          category.id === selectedId ? 'selected' : ''
        }>${esc(category.icon)} ${esc(category.name)} — ${money(category.balancePaise)}</option>`
    )
    .join('');
}

function defaultCategoryId(categories) {
  return (
    categories.find((category) => category.kind === 'flex' && category.balancePaise > 0)?.id ||
    categories.find((category) => category.balancePaise > 0)?.id ||
    categories.find((category) => category.id === 'misc')?.id ||
    categories[0]?.id ||
    ''
  );
}

function openTxModal({ id, categoryId, kind } = {}) {
  const transaction = id ? app.data.transactions.find((item) => item.id === id) : null;
  if (transaction?.kind === 'adjustment') {
    openAdjustmentModal(transaction);
    return;
  }
  const categories = activeCategories();
  if (transaction?.categoryId) {
    const existingCategory = categoryById(transaction.categoryId);
    if (existingCategory && !categories.some((category) => category.id === existingCategory.id)) {
      categories.push(existingCategory);
    }
  }
  const selectedCategory = transaction?.categoryId || categoryId || defaultCategoryId(categories);
  const initialType = transaction
    ? transaction.kind === 'income'
      ? 'income'
      : transaction.kind === 'transfer'
        ? 'transfer'
        : transaction.direction === 'in'
          ? 'refund'
          : 'expense'
    : kind === 'income'
      ? 'income'
      : kind === 'transfer'
        ? 'transfer'
        : 'expense';

  const body = `<form data-form="tx" data-id="${esc(transaction?.id || '')}">
    <div class="seg" role="radiogroup" aria-label="Type">
      ${typeOption('expense', 'Expense', initialType)}
      ${typeOption('income', 'Income', initialType)}
      ${typeOption('transfer', 'Transfer', initialType)}
      ${typeOption('refund', 'Refund', initialType)}
    </div>

    <label class="field amount-field">
      <span>Amount</span>
      <div class="money-input big"><span>₹</span><input name="amount" type="number" min="0.01" step="0.01" value="${
        transaction ? transaction.amountPaise / 100 : ''
      }" placeholder="0" inputmode="decimal" required /></div>
    </label>

    <label class="field">
      <span>Description</span>
      <input name="description" value="${esc(
        transaction?.description || ''
      )}" placeholder="Swiggy, rent, salary…" maxlength="120" required />
    </label>

    <div class="form-grid">
      <label class="field">
        <span>Date</span>
        <input name="date" type="date" value="${transaction?.date || todayStr()}" required />
      </label>
      <label class="field" data-field="category">
        <span data-cat-label>Envelope</span>
        <select name="categoryId">${categoryOptions(categories, selectedCategory)}</select>
      </label>
    </div>

    <p class="hint" data-hint></p>

    <label class="field">
      <span>Note <em>optional</em></span>
      <input name="notes" value="${esc(transaction?.notes || '')}" maxlength="300" />
    </label>

    <div class="modal-actions">
      ${
        transaction
          ? `<button type="button" class="link-btn danger" data-action="delete-tx" data-id="${esc(
              transaction.id
            )}">Delete</button>`
          : '<span></span>'
      }
      <div>
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${transaction ? 'Save changes' : 'Add transaction'}</button>
      </div>
    </div>
  </form>`;

  openModal(
    modalShell({
      title: transaction ? 'Edit transaction' : 'Add transaction',
      subtitle: transaction
        ? 'Changes update the envelope immediately.'
        : 'Every rupee needs a home.',
      body,
    }),
    '#modal-root [data-form="tx"] [name="amount"]'
  );
  updateTxModalFields();
}

function openAdjustmentModal(transaction) {
  const body = `<dl class="kv">
    ${kv('Date', formatDate(transaction.date))}
    ${kv('Amount', money(transaction.amountPaise))}
    ${kv('Direction', transaction.direction === 'in' ? 'Added to bank balance' : 'Removed from bank balance')}
    ${kv('Note', esc(transaction.notes || '—'))}
  </dl>
  <p class="hint">This came from <strong>Reconcile</strong>. It is not spending and does not belong to an envelope. Deleting it moves the app's balance away from the envelopes.</p>
  <div class="modal-actions">
    <span></span>
    <div>
      <button class="btn ghost" data-action="close-modal">Close</button>
      <button class="btn danger" data-action="delete-tx" data-id="${esc(transaction.id)}">Delete adjustment</button>
    </div>
  </div>`;
  openModal(
    modalShell({
      title: 'Balance adjustment',
      subtitle: 'A correction, not an expense.',
      body,
    })
  );
}

function updateTxModalFields() {
  const form = $('[data-form="tx"]');
  if (!form) return;
  const selected = form.querySelector('[name="tx-type"]:checked');
  if (!selected) return;
  const type = selected.value;
  const categoryField = form.querySelector('[data-field="category"]');
  categoryField.hidden = type === 'income';

  const labels = {
    expense: 'Envelope',
    refund: 'Back to envelope',
    transfer: 'From envelope',
    income: '',
  };
  form.querySelector('[data-cat-label]').textContent = labels[type];

  const hints = {
    expense: 'Spent from this envelope.',
    refund: 'A return or cashback adds money back to this envelope.',
    transfer: 'Money leaving your bank for an asset like a SIP or FD. It is not counted as spending.',
    income: 'Credits land in unallocated money. Allocate them from the overview.',
  };
  form.querySelector('[data-hint]').textContent = hints[type];
}

/* ------------------------------------------------------------------ */
/* Other modals                                                       */
/* ------------------------------------------------------------------ */

function openReconcileModal() {
  const derived = app.data.derived;
  const body = `<form data-form="reconcile">
    <p class="hint">The app thinks your bank balance is <strong>${money(
      derived.bankBalancePaise
    )}</strong>. Enter the real balance from your bank app.</p>
    <label class="field">
      <span>Actual bank balance</span>
      <div class="money-input"><span>₹</span><input name="balance" type="number" min="0" step="0.01" value="${rupeesInput(
        derived.bankBalancePaise
      )}" inputmode="decimal" required /></div>
    </label>
    <label class="field">
      <span>Note <em>optional</em></span>
      <input name="note" placeholder="e.g. matched after salary" maxlength="160" />
    </label>
    <div class="modal-actions">
      <span></span>
      <div><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Match balance</button></div>
    </div>
  </form>`;
  openModal(modalShell({ title: 'Reconcile balance', subtitle: 'Differences are recorded as an adjustment.', body }));
}

function openAllocateModal() {
  const derived = app.data.derived;
  const surplus = categoryById(app.data.settings.surplusCategoryId);
  const body = `<form data-form="allocate">
    <p class="confirm-copy">This fills every envelope to its monthly target, keeps rollover balances, and sweeps anything left over to <strong>${esc(
      surplus?.name || 'unallocated'
    )}</strong>.</p>
    <dl class="kv">
      ${kv('Monthly plan', money(derived.plan.totalPaise))}
      ${kv('Unallocated now', money(derived.unallocatedPaise))}
      ${kv('Rollover balances', 'Kept where they are')}
    </dl>
    <p class="hint">You can undo this allocation until you record spending or move money.</p>
    <div class="modal-actions">
      <span></span>
      <div><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Allocate ${monthLabel(
        derived.period
      )}</button></div>
    </div>
  </form>`;
  openModal(modalShell({ title: 'Run this month’s allocation', subtitle: 'One allocation per calendar month.', body }));
}

function openMoveModal(toId) {
  const categories = activeCategories();
  const fromCategories = categories.filter((category) => category.balancePaise > 0);
  if (fromCategories.length === 0) {
    toast('No envelope has money to move yet.', 'error');
    return;
  }

  const target = toId ? categoryById(toId) : null;
  const candidates = [...fromCategories].sort((a, b) => b.balancePaise - a.balancePaise);
  let fromId = candidates.find((category) => category.id !== target?.id)?.id || candidates[0].id;
  let toDefault = target?.id;
  let defaultAmount = '';

  if (!target) {
    const deficit = categories.find((category) => category.balancePaise < 0);
    const lowFlex = [...categories]
      .filter((category) => category.kind === 'flex' && category.id !== fromId)
      .sort((a, b) => a.balancePaise - b.balancePaise)[0];
    toDefault = deficit?.id || lowFlex?.id || categories.find((category) => category.id !== fromId)?.id;
    if (toDefault === fromId) {
      toDefault = categories.find((category) => category.id !== fromId)?.id;
    }
  } else if (target.balancePaise < 0) {
    const coverFrom = categories.find((category) => category.id === fromId);
    defaultAmount = coverFrom
      ? Math.min(coverFrom.balancePaise, -target.balancePaise) / 100
      : '';
  }

  const options = (selected) =>
    categories
      .map(
        (category) =>
          `<option value="${esc(category.id)}" ${category.id === selected ? 'selected' : ''}>${
            category.icon
          } ${esc(category.name)} — ${money(category.balancePaise)}</option>`
      )
      .join('');

  const body = `<form data-form="move">
    <div class="form-grid">
      <label class="field"><span>From</span><select name="fromCategoryId">${options(fromId)}</select></label>
      <label class="field"><span>To</span><select name="toCategoryId">${options(toDefault)}</select></label>
    </div>
    <label class="field amount-field">
      <span>Amount</span>
      <div class="money-input big"><span>₹</span><input name="amount" type="number" min="0.01" step="0.01" value="${defaultAmount}" placeholder="0" inputmode="decimal" required /></div>
    </label>
    <label class="field"><span>Note <em>optional</em></span><input name="note" maxlength="160" placeholder="Why are you moving it?" /></label>
    <div class="modal-actions">
      <span></span>
      <div><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Move money</button></div>
    </div>
  </form>`;
  openModal(modalShell({ title: 'Move between envelopes', subtitle: 'The bank balance does not change.', body }));
}

function askUndoAllocation() {
  const allocation = app.data.derived.allocation;
  if (!allocation) return;
  if (!allocation.canUndo) {
    toast('Spending is recorded for this month. Move money between envelopes instead.', 'error');
    return;
  }
  confirmModal({
    title: `Undo ${monthLabel(allocation.period)}?`,
    message:
      'Envelope balances go back to how they were before this allocation. Spending recorded since then stays, so some envelopes may become negative. You can allocate again afterwards.',
    confirmLabel: 'Undo allocation',
    danger: true,
    action: async () => {
      const response = await api(`/api/allocations/${allocation.id}/undo`, { method: 'POST' });
      acceptState(response.state);
      render();
      toast('Allocation undone.');
    },
  });
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

async function startDemo() {
  const response = await api('/api/setup', { method: 'POST', body: { mode: 'demo' } });
  acceptState(response.state);
  app.view = 'dashboard';
  app.planDirty = false;
  history.replaceState(null, '', '#dashboard');
  render();
  toast('Demo data loaded. Reset it any time from Settings.');
}

function fatalView(error) {
  return `<div class="setup"><div class="setup-card">
    <p class="eyebrow">Khaata</p>
    <h1>Could not load.</h1>
    <p class="lede">${esc(error.message)}</p>
    <p class="fine">Make sure the server is running with <code>npm start</code>.</p>
    <button class="btn primary wide" data-action="reload">Retry</button>
  </div></div>`;
}

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

function navigate(view) {
  if (app.view === view) return;
  if (app.view === 'plan' && app.planDirty && view !== 'plan') {
    if (!window.confirm('Discard unsaved plan changes?')) return;
  }
  app.view = view;
  app.planDirty = false;
  if (location.hash !== `#${view}`) {
    history.pushState(null, '', `#${view}`);
  }
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('popstate', () => {
  const view = viewFromHash();
  if (view === app.view) return;
  if (app.view === 'plan' && app.planDirty) {
    if (!window.confirm('Discard unsaved plan changes?')) {
      history.pushState(null, '', '#plan');
      return;
    }
  }
  app.view = view;
  app.planDirty = false;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
});

async function handleAction(element) {
  const action = element.dataset.action;

  switch (action) {
    case 'nav':
      navigate(element.dataset.view);
      return;
    case 'reload':
      location.reload();
      return;
    case 'demo-setup':
      await startDemo();
      return;
    case 'open-tx':
      openTxModal({ categoryId: element.dataset.category, kind: element.dataset.kind });
      return;
    case 'edit-tx':
      openTxModal({ id: element.dataset.id });
      return;
    case 'open-reconcile':
      openReconcileModal();
      return;
    case 'open-allocate':
      openAllocateModal();
      return;
    case 'open-move':
      openMoveModal(element.dataset.to);
      return;
    case 'close-modal':
      closeModal();
      return;
    case 'undo-allocation':
      askUndoAllocation();
      return;
    case 'add-row':
      addPlanRow(element.dataset.kind);
      return;
    case 'remove-row':
      removePlanRow(element);
      return;
    case 'cycle-icon': {
      const row = element.closest('.plan-row');
      if (!row) return;
      const icons = ['🏠', '🛒', '🚌', '👕', '💻', '🎬', '🧾', '📈', '🛡️', '🏦', '🎧', '✈️', '🎁', '💊', '📚', '☕'];
      const current = icons.indexOf(row.dataset.icon);
      const next = icons[(current + 1) % icons.length];
      row.dataset.icon = next;
      element.textContent = next;
      markPlanDirty();
      return;
    }
    case 'discard-plan':
      app.planDirty = false;
      await load();
      toast('Plan changes discarded.');
      return;
    case 'tx-filter':
      app.txKind = element.dataset.kind;
      applyTxFilter();
      return;
    case 'delete-tx': {
      const id = element.dataset.id;
      const transaction = app.data.transactions.find((item) => item.id === id);
      confirmModal({
        title: 'Delete transaction?',
        message: `“${esc(transaction?.description || 'This transaction')}” will be removed and its effect on the envelope reversed.`,
        confirmLabel: 'Delete',
        danger: true,
        action: async () => {
          const response = await api(`/api/transactions/${id}`, { method: 'DELETE' });
          acceptState(response.state);
          render();
          toast('Transaction deleted.');
        },
      });
      return;
    }
    case 'confirm-action': {
      const fn = app.pendingConfirm;
      if (!fn) return;
      element.disabled = true;
      try {
        await fn();
      } finally {
        closeModal();
      }
      return;
    }
    case 'copy': {
      const text =
        element.dataset.copy === 'token'
          ? app.data.settings.ingestToken
          : `${location.origin}/api/ingest`;
      await copyText(text);
      return;
    }
    case 'rotate-token':
      confirmModal({
        title: 'Replace the ingest token?',
        message: 'Any automation using the old token will stop working immediately.',
        confirmLabel: 'New token',
        danger: true,
        action: async () => {
          const response = await api('/api/token', { method: 'POST' });
          acceptState(response.state);
          render();
          toast('New token created.');
        },
      });
      return;
    case 'load-demo':
      confirmModal({
        title: 'Load demo data?',
        message: 'This replaces your current envelopes, transactions and balances with sample data.',
        confirmLabel: 'Load demo',
        danger: true,
        action: async () => {
          const response = await api('/api/setup', { method: 'POST', body: { mode: 'demo' } });
          acceptState(response.state);
          app.view = 'dashboard';
          history.replaceState(null, '', '#dashboard');
          render();
          toast('Demo data loaded.');
        },
      });
      return;
    case 'reset-all':
      confirmModal({
        title: 'Start over?',
        message: 'This erases the local ledger and asks you to set up again. Download a backup first if you might want it.',
        confirmLabel: 'Erase and start over',
        danger: true,
        action: async () => {
          const response = await api('/api/reset', { method: 'POST' });
          acceptState(response.state);
          app.view = 'dashboard';
          history.replaceState(null, '', '#dashboard');
          render();
          toast('Ledger reset.');
        },
      });
      return;
    default:
      return;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  toast('Copied.');
}

document.addEventListener('click', async (event) => {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  try {
    await handleAction(element);
  } catch (error) {
    toast(error.message || 'Something went wrong.', 'error');
  }
});

document.addEventListener('click', (event) => {
  if (event.target.classList.contains('modal-backdrop')) closeModal();
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.matches('form[data-form]')) return;
  event.preventDefault();

  const submitButton = form.querySelector('button[type="submit"]');
  const submitLabel = submitButton?.textContent;
  if (submitButton) submitButton.disabled = true;

  try {
    if (form.dataset.form === 'setup') {
      const data = new FormData(form);
      const incomePaise = toPaise(data.get('income'));
      const openingBalancePaise = toPaise(data.get('balance'));
      if (incomePaise < 100) {
        toast('Enter a monthly take-home of at least ₹1.', 'error');
        return;
      }
      if (submitButton) submitButton.textContent = 'Setting up…';
      const response = await api('/api/setup', {
        method: 'POST',
        body: { mode: 'fresh', monthlyIncomePaise: incomePaise, openingBalancePaise },
      });
      acceptState(response.state);
      app.view = 'dashboard';
      app.planDirty = false;
      history.replaceState(null, '', '#dashboard');
      render();
      if (response.warning) toast(response.warning, 'warn');
      else toast('You are set up.');
      return;
    }

    if (form.dataset.form === 'plan') {
      const payload = collectPlan();
      if (payload.categories.some((category) => !category.name)) {
        toast('Give every envelope a name.', 'error');
        return;
      }
      const response = await api('/api/plan', { method: 'PUT', body: payload });
      acceptState(response.state);
      app.planDirty = false;
      render();
      toast('Plan saved. It applies at the next allocation.');
      return;
    }

    if (form.dataset.form === 'tx') {
      const data = new FormData(form);
      const type = data.get('tx-type');
      const mapping = {
        expense: { kind: 'expense', direction: 'out' },
        income: { kind: 'income', direction: 'in' },
        transfer: { kind: 'transfer', direction: 'out' },
        refund: { kind: 'expense', direction: 'in' },
      };
      const body = {
        date: data.get('date'),
        description: data.get('description'),
        amountPaise: toPaise(data.get('amount')),
        direction: mapping[type].direction,
        kind: mapping[type].kind,
        categoryId: type === 'income' ? null : data.get('categoryId'),
        notes: data.get('notes'),
      };
      const id = form.dataset.id;
      const response = await api(id ? `/api/transactions/${id}` : '/api/transactions', {
        method: id ? 'PUT' : 'POST',
        body,
      });
      acceptState(response.state);
      closeModal();
      render();
      toast(id ? 'Transaction updated.' : 'Transaction added.');
      return;
    }

    if (form.dataset.form === 'reconcile') {
      const data = new FormData(form);
      const response = await api('/api/reconcile', {
        method: 'POST',
        body: { balancePaise: toPaise(data.get('balance')), note: data.get('note') },
      });
      acceptState(response.state);
      closeModal();
      render();
      toast(response.adjustment ? 'Balance matched. Difference recorded.' : 'Balance already matches.');
      return;
    }

    if (form.dataset.form === 'allocate') {
      const response = await api('/api/allocate', { method: 'POST', body: {} });
      acceptState(response.state);
      closeModal();
      render();
      toast(`${monthLabel(response.state.derived.period)} allocated.`);
      return;
    }

    if (form.dataset.form === 'move') {
      const data = new FormData(form);
      const response = await api('/api/move', {
        method: 'POST',
        body: {
          fromCategoryId: data.get('fromCategoryId'),
          toCategoryId: data.get('toCategoryId'),
          amountPaise: toPaise(data.get('amount')),
          note: data.get('note'),
        },
      });
      acceptState(response.state);
      closeModal();
      render();
      toast('Money moved.');
      return;
    }
  } catch (error) {
    toast(error.message || 'Something went wrong.', 'error');
  } finally {
    if (submitButton?.isConnected) {
      submitButton.disabled = false;
      if (submitLabel !== undefined) submitButton.textContent = submitLabel;
    }
  }
});

document.addEventListener('input', (event) => {
  if (event.target.closest('#plan-form')) {
    markPlanDirty();
    updatePlanPreview();
    return;
  }
  if (event.target.id === 'tx-search') {
    app.txSearch = event.target.value;
    applyTxFilter();
  }
});

document.addEventListener('change', (event) => {
  if (event.target.name === 'tx-type') {
    updateTxModalFields();
    return;
  }
  if (event.target.closest('#plan-form')) {
    markPlanDirty();
    updatePlanPreview();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && app.modalOpen) closeModal();
});

/* ------------------------------------------------------------------ */
/* Render + boot                                                      */
/* ------------------------------------------------------------------ */

function render() {
  if (!app.data) return;
  const root = $('#app');
  const scrollY = window.scrollY;

  if (app.data.derived.setupRequired) {
    root.innerHTML = setupView();
  } else {
    root.innerHTML = shellView();
  }

  window.scrollTo(0, scrollY);

  if (app.view === 'plan' && !app.data.derived.setupRequired) {
    updatePlanPreview();
    if (app.planDirty) {
      const bar = $('#savebar');
      if (bar) bar.hidden = false;
    }
  }
  if (app.view === 'transactions') {
    applyTxFilter();
  }
}

async function init() {
  app.view = viewFromHash();
  try {
    await load();
  } catch (error) {
    $('#app').innerHTML = fatalView(error);
  }

  setInterval(async () => {
    if (app.modalOpen || app.planDirty || document.visibilityState !== 'visible') return;
    const active = document.activeElement;
    if (active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
    try {
      const response = await api('/api/state');
      if (JSON.stringify(response.state) !== app.lastStateJson) {
        acceptState(response.state);
        render();
      }
    } catch {
      /* keep the current screen if the server blips */
    }
  }, 30000);
}

init();

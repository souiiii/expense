const app = {
  data: null,
  view: location.hash.slice(1) || 'dashboard',
  period: sessionStorage.getItem('khaata-month') || '',
  modal: false,
  busy: false,
  dirty: false,
  search: '',
  filter: 'all',
  typeFilter: 'all'
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: Math.abs(n || 0) % 100 ? 2 : 0
}).format((n || 0) / 100);
const paise = n => Math.round(Number(n) * 100);
const rupees = n => n == null ? '' : n / 100;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthName = p => new Date(`${p}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shortMonth = p => new Date(`${p}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
const shortDate = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const cat = id => app.data.categories.find(c => c.id === id);
const active = () => app.data.categories.filter(c => !c.archived);
const type = c => c.type || (c.kind === 'flex' ? 'spending' : 'bill');
const currentMonth = () => today().slice(0, 7);
const historical = () => app.period < currentMonth();

const DEFAULT_BUCKET_TYPES = [
  { id: 'bill', name: 'Bills & Utilities', description: 'Rent, electricity, broadband, and fixed monthly bills.', kind: 'fixed', behavior: 'bill', defaultRollover: false, defaultCapPaise: null, defaultDueDay: null, allowSurplus: false, priority: 1, icon: '🏠', color: '#b4643c' },
  { id: 'loan', name: 'Loans & EMIs', description: 'EMIs and fixed monthly repayments to lenders.', kind: 'fixed', behavior: 'loan', defaultRollover: false, defaultCapPaise: null, defaultDueDay: null, allowSurplus: true, priority: 1, icon: '🏦', color: '#7d6a9e' },
  { id: 'saving', name: 'Savings Goals', description: 'Emergency fund and cash reserves kept in your bank.', kind: 'fixed', behavior: 'saving', defaultRollover: true, defaultCapPaise: null, defaultDueDay: null, allowSurplus: true, priority: 3, icon: '🛡️', color: '#3f6b8e' },
  { id: 'investment', name: 'Investments', description: 'SIPs, PPF, stocks, gold, and holdings tracked separately from bank cash.', kind: 'fixed', behavior: 'investment', defaultRollover: true, defaultCapPaise: 3000000, defaultDueDay: null, allowSurplus: true, priority: 4, icon: '📈', color: '#23735f' },
  { id: 'spending', name: 'Everyday Spending', description: 'What is left after fixed commitments, split by percentage.', kind: 'flex', behavior: 'spending', defaultRollover: false, defaultCapPaise: null, defaultDueDay: null, allowSurplus: false, priority: 2, icon: '🛒', color: '#6c8a45' }
];

const bucketTypes = () => app.data?.bucketTypes?.length ? app.data.bucketTypes : DEFAULT_BUCKET_TYPES;
const findBucketType = id => bucketTypes().find(bt => bt.id === id) || DEFAULT_BUCKET_TYPES.find(bt => bt.id === id) || null;
const catBucketTypeId = c => {
  const bts = bucketTypes();
  if (c.bucketTypeId && bts.some(bt => bt.id === c.bucketTypeId)) return c.bucketTypeId;
  const t = type(c);
  if (bts.some(bt => bt.id === t)) return t;
  return bts.find(bt => bt.behavior === t)?.id || t;
};
const catBucketType = c => findBucketType(catBucketTypeId(c)) || { id: type(c), name: type(c), behavior: type(c), kind: c.kind || 'fixed', icon: c.icon || '🏷️', color: c.color || '#23735f' };

const logo = `<span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="3" y="6" width="26" height="6" rx="3" fill="currentColor"/><rect x="3" y="15" width="19" height="6" rx="3" fill="currentColor" opacity=".6"/><rect x="3" y="24" width="23" height="5" rx="2" fill="currentColor" opacity=".3"/></svg></span>`;
const brand = (tagline = false) => `<div class="brand">${logo}<span class="brand-text"><span class="brand-name">Khaata<span class="brand-dot">.</span></span>${tagline ? '<small>salary, divided</small>' : ''}</span></div>`;

const navIcons = {
  dashboard: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="6" height="6" rx="1.5"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.5"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.5"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.5"/></svg>`,
  plan: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h14M3 10h14M3 15h14"/><circle cx="7" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="13" cy="10" r="1.6" fill="currentColor" stroke="none"/><circle cx="8" cy="15" r="1.6" fill="currentColor" stroke="none"/></svg>`,
  activity: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11l-2.5-2.5M16 13H5l2.5 2.5"/></svg>`,
  settings: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.7v2M10 15.3v2M2.7 10h2M15.3 10h2M5 5l1.4 1.4M13.6 13.6 15 15M15 5l-1.4 1.4M6.4 13.6 5 15"/></svg>`
};

const button = (label, action, attrs = '', style = 'ghost') =>
  `<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;

// Rupee fields step by 10 rupees on increment/decrement spin buttons
const amountField = (label, name, value = '', required = true, placeholder = '0') =>
  `<label class="field"><span>${label}</span><div class="money-input"><span>₹</span><input name="${name}" type="number" min="0" step="10" inputmode="decimal" placeholder="${esc(placeholder)}" value="${esc(value)}" ${required ? 'required' : ''}/></div></label>`;

const monthOptions = (selected, fundingOnly = false) =>
  [...new Set([...(app.data?.derived.periods || []), selected, currentMonth(), today().slice(0, 7)])]
    .filter(p => !fundingOnly || p >= currentMonth())
    .sort()
    .reverse()
    .map(p => `<option value="${p}" ${p === selected ? 'selected' : ''}>${monthName(p)}${p === currentMonth() ? ' (Current)' : ''}</option>`)
    .join('');

async function api(path, { method = 'GET', body } = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const response = await fetch(`${path}${sep}period=${app.period}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save. Try again.');
  if (data.state && (!data.state.derived?.safety || !data.state.derived?.fundingPreview)) {
    throw new Error('Khaata’s server is running an older version. Restart it with npm start, then reload this page.');
  }
  return data;
}

async function refresh() {
  app.data = (await api('/api/state')).state;
  render();
}

async function change(path, body, method = 'POST') {
  const response = await api(path, { method, body });
  if (response.state) app.data = response.state;
  return response;
}

function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast ${error ? 'error' : 'ok'}`;
  node.textContent = message;
  $('#toast-root').append(node);
  setTimeout(() => node.remove(), error ? 6500 : 3500);
}

let previousFocus;
function modal(title, body, subtitle = '') {
  previousFocus = document.activeElement;
  app.modal = true;
  $('#modal-root').innerHTML = `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <div>
            <h2>${esc(title)}</h2>
            ${subtitle ? `<p class="modal-sub">${esc(subtitle)}</p>` : ''}
          </div>
          <button class="icon-btn" type="button" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">${body}</div>
      </section>
    </div>`;
  document.body.classList.add('modal-open');
  setTimeout(() => ($('#modal-root .modal-body input:not([type=hidden]):not([readonly]):not([type=range]), #modal-root .modal-body select') || $('#modal-root button'))?.focus(), 0);
}

function close() {
  app.modal = false;
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('modal-open');
  previousFocus?.focus();
}

const actions = (label = 'Save') =>
  `<div class="modal-actions">${button('Cancel', 'close')}<button class="btn primary" type="submit">${label}</button></div>`;

/* ------------------------------------------------------------------ */
/* Setup & Onboarding                                                 */
/* ------------------------------------------------------------------ */

function setupView() {
  return `
  <div class="setup">
    <div class="setup-art">
      ${brand(true)}
      <p class="eyebrow">A calm, local-first salary budget</p>
      <h1>Know what is<br><em>safe to spend.</em></h1>
      <p class="lede">Khaata divides your single bank balance into clear virtual buckets—so bills, investments, and goals are protected first, and you always know what is left for everyday life.</p>
      <div class="setup-points">
        <div>
          <span>1</span>
          <div>
            <strong>Plan your bucket types &amp; buckets</strong>
            <p>Organize fixed commitments (Bills, Loans, Savings, Investments, or custom types) and split remaining salary across everyday spending with self-adjusting sliders.</p>
          </div>
        </div>
        <div>
          <span>2</span>
          <div>
            <strong>Fund the month on payday</strong>
            <p>Pour your bank balance into your buckets with one click. Bills and essentials get covered first.</p>
          </div>
        </div>
        <div>
          <span>3</span>
          <div>
            <strong>Spend &amp; adjust freely</strong>
            <p>Log expenses as money leaves your bank, or move money between buckets anytime without touching your bank total.</p>
          </div>
        </div>
      </div>
      <p class="fine">100% private &amp; local on this computer · No bank login required</p>
    </div>
    <div class="setup-card">
      <div class="step-pill">Step 1 of 2 · Basics</div>
      <h2>Let’s set up your khaata</h2>
      <p class="hint">Enter your typical monthly salary and what is currently in your bank account. On the next screen, you’ll customize your bucket types and buckets.</p>
      <form data-form="setup" novalidate>
        ${amountField('Expected monthly take-home salary', 'income', '', true, 'e.g. 100000')}
        ${amountField('Current bank balance right now', 'balance', '', true, 'e.g. 85000')}
        <label class="field">
          <span>Starting date</span>
          <input name="openingDate" type="date" value="${today()}" max="${today()}" required>
        </label>
        <div class="setup-note">
          <strong>Starting mid-month?</strong>
          <p>Your current bank balance already reflects earlier transactions. On the next screen, you can mark any bills you’ve already paid this month so they aren’t counted twice.</p>
        </div>
        <button class="btn primary wide" type="submit">Continue to monthly plan →</button>
      </form>
      <div class="setup-alt">
        ${button('Or explore with sample data first', 'demo', '', 'ghost small')}
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* App Shell & Navigation                                             */
/* ------------------------------------------------------------------ */

function nav(view, label, sub, icon, badge = '') {
  const isActive = app.view === view;
  return `
    <button class="nav-item ${isActive ? 'active' : ''}" data-action="nav" data-view="${view}" aria-current="${isActive ? 'page' : 'false'}">
      <span class="nav-symbol" aria-hidden="true">${icon}</span>
      <span class="nav-copy">
        <span class="nav-label">${label}${badge ? `<span class="nav-badge">${badge}</span>` : ''}</span>
        <small class="nav-sub">${sub}</small>
      </span>
    </button>`;
}

function render() {
  if (!app.data) return;
  if (app.data.derived.setupRequired) {
    $('#app').innerHTML = setupView();
    return;
  }
  const d = app.data.derived;
  const unconfirmed = app.data.settings.planConfirmed === false;
  const needsFunding = !unconfirmed && !historical() && (!d.allocation || d.allocation.remainingPaise > 0) && d.unallocatedPaise > 0;
  const navs =
    nav('dashboard', 'This Month', 'Buckets & spending', navIcons.dashboard, needsFunding ? 'Fund' : '') +
    nav('plan', 'Monthly Plan', 'Bucket types & rules', navIcons.plan, unconfirmed ? 'Step 1' : '') +
    nav('transactions', 'Activity', 'Ledger & history', navIcons.activity) +
    nav('settings', 'Settings', 'Backups & types', navIcons.settings);

  $('#app').innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        ${brand(true)}
        <div class="sidebar-quick">
          ${button('+ Log expense', 'expense', '', 'primary wide')}
          <div class="sidebar-quick-row">
            ${button('+ Income', 'income', '', 'ghost small')}
            ${button('⇄ Move', 'move', '', 'ghost small')}
          </div>
        </div>
        <nav class="nav" aria-label="Main navigation">${navs}</nav>
        <div class="sidebar-foot">
          <div class="side-bank">
            <div class="side-bank-head">
              <span>Bank balance</span>
              <small>${shortMonth(app.period)}</small>
            </div>
            <strong>${money(d.bankBalancePaise)}</strong>
            <button type="button" class="side-bank-link" data-action="reconcile">✓ Match with bank app</button>
          </div>
          ${button('? How Khaata works', 'help', '', 'ghost small')}
        </div>
      </aside>
      <main class="main">
        <header class="mobile-head">
          ${brand()}
          <div class="mobile-head-actions">
            ${button('+ Income', 'income', '', 'ghost small')}
            ${button('+ Expense', 'expense', '', 'primary small')}
          </div>
        </header>
        <div class="view">
          ${app.view === 'plan'
            ? planView()
            : app.view === 'transactions'
              ? activityView()
              : app.view === 'settings'
                ? settingsView()
                : dashboardView()}
        </div>
      </main>
      <nav class="bottom-nav" aria-label="Main">${navs}</nav>
    </div>`;

  if (app.view === 'plan') updatePlanTotal();
  if (app.view === 'transactions') filterActivity();
}

function pageHead(title, sub = '', rightContent = '') {
  return `
    <header class="page-head">
      <div>
        <p class="eyebrow">${esc(sub)}</p>
        <h1>${title}</h1>
      </div>
      ${rightContent ? `<div class="page-head-actions">${rightContent}</div>` : ''}
    </header>`;
}

function monthPicker() {
  return `
    <label class="month-picker">
      <span class="month-picker-label">Month</span>
      <select data-control="month" aria-label="Budget month">${monthOptions(app.period)}</select>
    </label>`;
}

/* ------------------------------------------------------------------ */
/* Guided Status / Next-Step Banner                                   */
/* ------------------------------------------------------------------ */

function notice() {
  const d = app.data.derived;
  const s = d.safety;

  if (app.data.settings.planConfirmed === false) {
    return `
      <div class="notice warn flow-banner">
        <div class="notice-copy">
          <span class="step-pill">Step 1 of 2 · Confirm your plan</span>
          <strong>Review your monthly buckets before dividing your money.</strong>
          <p>Check the starter amounts, mark any bills already paid before your starting balance, and save your plan.</p>
        </div>
        ${button('Review & save plan →', 'nav', 'data-view="plan"', 'primary')}
      </div>`;
  }

  if (historical()) {
    return `
      <div class="notice quiet">
        <div class="notice-copy">
          <strong>Viewing past month: ${monthName(app.period)}</strong>
          <p>Balances and commitments are shown as they stood at the end of ${monthName(app.period)}.</p>
        </div>
        ${button('Back to current month', 'this-month', '', 'primary small')}
      </div>`;
  }

  if (s.uncoveredPaise > 0) {
    return `
      <div class="notice danger">
        <div class="notice-copy">
          <strong>Overspent by ${money(s.uncoveredPaise)}</strong>
          <p>One or more buckets are negative. Move money from another bucket or Unassigned cash so your buckets stay backed by real bank money.</p>
        </div>
        ${button('Cover overspent bucket', 'move', '', 'primary')}
      </div>`;
  }

  if (s.billGapPaise > 0 && d.allocation) {
    return `
      <div class="notice warn">
        <div class="notice-copy">
          <strong>Bills need ${money(s.billGapPaise)} more this month</strong>
          <p>Some fixed bills or EMIs don’t have enough cash set aside yet.</p>
        </div>
        ${button('Move money to bills', 'move', '', 'primary')}
      </div>`;
  }

  if (!d.allocation) {
    const canFundNow = d.unallocatedPaise > 0;
    return `
      <div class="notice warn flow-banner">
        <div class="notice-copy">
          <span class="step-pill">Next step · Fund ${monthName(app.period).split(' ')[0]}</span>
          <strong>Your buckets are at ₹0 until you fund ${monthName(app.period)}.</strong>
          <p>${canFundNow
            ? `You have ${money(d.unallocatedPaise)} of unassigned cash in your bank ready to pour into your buckets.`
            : `Log your salary or income first, then fund ${monthName(app.period)} to fill your buckets.`}</p>
        </div>
        <div class="notice-actions">
          ${canFundNow
            ? button(`Fund ${monthName(app.period).split(' ')[0]} budget`, 'fund', '', 'primary')
            : button('+ Log income', 'income', '', 'primary')}
        </div>
      </div>`;
  }

  if (d.allocation.remainingPaise > 0) {
    return `
      <div class="notice warn">
        <div class="notice-copy">
          <strong>${money(d.allocation.remainingPaise)} of this month’s plan is still unfunded</strong>
          <p>${d.unallocatedPaise > 0
            ? `You have ${money(d.unallocatedPaise)} unassigned in the bank ready to top up the rest of your buckets.`
            : 'When the rest of your income arrives, log it and click Top up to fill the remaining buckets.'}</p>
        </div>
        ${d.unallocatedPaise > 0
          ? button('Top up buckets', 'fund', '', 'primary')
          : button('+ Log income', 'income', '', 'ghost')}
      </div>`;
  }

  if (d.unallocatedPaise > 0) {
    return `
      <div class="notice quiet">
        <div class="notice-copy">
          <strong>${money(d.unallocatedPaise)} is sitting unassigned in your bank</strong>
          <p>All planned buckets for ${monthName(app.period).split(' ')[0]} are funded. You can move this extra cash into savings, investments, or any spending bucket.</p>
        </div>
        ${button('Assign extra money', 'move', '', 'primary small')}
      </div>`;
  }

  return '';
}

/* ------------------------------------------------------------------ */
/* Overview / Dashboard View                                          */
/* ------------------------------------------------------------------ */

function dashboardView() {
  const d = app.data.derived;
  const s = d.safety;
  const targets = new Map((d.allocation?.items || d.plan.items).filter(i => i.reason !== 'surplus').map(i => [i.categoryId, i.targetPaise]));
  const commitments = new Map(d.commitments.map(c => [c.categoryId, c]));
  const fixed = active().filter(c => type(c) !== 'spending');
  const everyday = active().filter(c => type(c) === 'spending');
  const doneCount = fixed.filter(c => ['done', 'at-goal'].includes(commitments.get(c.id)?.status)).length;

  const fixedBucketTypes = bucketTypes().filter(bt => bt.kind === 'fixed' && fixed.some(c => catBucketTypeId(c) === bt.id));
  const filteredFixed = app.typeFilter === 'all' || !fixedBucketTypes.some(bt => bt.id === app.typeFilter)
    ? fixed
    : fixed.filter(c => catBucketTypeId(c) === app.typeFilter);

  const heroSub = historical()
    ? `Remaining in everyday spending buckets at the end of ${monthName(app.period)}`
    : app.period > currentMonth()
      ? `Reserved for ${monthName(app.period)} everyday spending`
      : s.daysToPayday == null
        ? 'Money available in your everyday spending buckets'
        : `${money(s.dailyPaise)} / day · ${s.daysToPayday} day${s.daysToPayday === 1 ? '' : 's'} until payday`;

  const totalBank = Math.max(1, d.bankBalancePaise);
  const safePct = Math.max(0, Math.min(100, (s.safeToSpendPaise / totalBank) * 100));
  const reservedPct = Math.max(0, Math.min(100 - safePct, (s.reservedPaise / totalBank) * 100));
  const unallocPct = Math.max(0, Math.min(100 - safePct - reservedPct, (Math.max(0, d.unallocatedPaise) / totalBank) * 100));

  const showFundBtn = !historical() && app.data.settings.planConfirmed !== false && (!d.allocation || d.allocation.remainingPaise > 0);

  return `
    ${pageHead(
      monthName(app.period),
      historical() ? 'Past month snapshot' : 'This month’s overview',
      `${monthPicker()}${showFundBtn ? button(d.allocation ? 'Top up month' : 'Fund month', 'fund', '', 'primary small') : ''}`
    )}

    ${notice()}

    <section class="hero">
      <div class="hero-main">
        <p class="eyebrow light">Safe to spend · Everyday buckets</p>
        <h2 class="balance">${money(s.safeToSpendPaise)}</h2>
        <p class="hero-sub">${heroSub}</p>
        <p class="hero-explain">Bills, EMIs, savings, and investments are already set aside separately.</p>
      </div>
      <div class="hero-actions">
        ${button('+ Log expense', 'expense', '', 'primary light')}
        ${button('+ Log income', 'income', '', 'hero-ghost')}
        ${button('⇄ Move money', 'move', '', 'hero-ghost')}
        ${button('✓ Match bank', 'reconcile', '', 'hero-ghost')}
      </div>
      <div class="hero-foot">
        <div class="bank-equation">
          <div class="bank-eq-total">
            <span class="bank-eq-label">Total in bank</span>
            <strong>${money(d.bankBalancePaise)}</strong>
            <small>Real cash tracked</small>
          </div>
          <span class="bank-eq-sign" aria-hidden="true">=</span>
          <div class="bank-eq-part">
            <span class="bank-eq-label"><i class="dot dot-safe"></i>Safe to spend</span>
            <strong>${money(s.safeToSpendPaise)}</strong>
            <small>Everyday buckets</small>
          </div>
          <span class="bank-eq-sign" aria-hidden="true">+</span>
          <div class="bank-eq-part">
            <span class="bank-eq-label"><i class="dot dot-reserved"></i>Bills &amp; goals</span>
            <strong>${money(s.reservedPaise)}</strong>
            <small>${s.futureReservedPaise ? `Includes ${money(s.futureReservedPaise)} for next mo` : 'Set aside in buckets'}</small>
          </div>
          <span class="bank-eq-sign" aria-hidden="true">+</span>
          <div class="bank-eq-part ${d.unallocatedPaise < 0 ? 'is-negative' : d.unallocatedPaise > 0 ? 'is-warm' : ''}">
            <span class="bank-eq-label"><i class="dot dot-unassigned"></i>Unassigned</span>
            <strong>${money(d.unallocatedPaise)}</strong>
            <small>${d.unallocatedPaise > 0 ? 'Ready to fund / assign' : d.unallocatedPaise < 0 ? 'Needs covering' : 'Every rupee assigned'}</small>
          </div>
        </div>
        <div class="bank-bar" aria-hidden="true">
          <span class="bank-bar-safe" style="width:${safePct}%"></span>
          <span class="bank-bar-reserved" style="width:${reservedPct}%"></span>
          <span class="bank-bar-unassigned" style="width:${unallocPct}%"></span>
        </div>
      </div>
    </section>

    <div class="month-flow-strip">
      <div class="flow-stat">
        <span>Income logged in ${monthName(app.period).split(' ')[0]}</span>
        <strong class="${d.summary.incomePaise > 0 ? 'positive' : ''}">${money(d.summary.incomePaise)}</strong>
      </div>
      <div class="flow-stat">
        <span>Spent in ${monthName(app.period).split(' ')[0]}</span>
        <strong>${money(d.summary.grossSpentPaise)}</strong>
      </div>
      <div class="flow-stat">
        <span>Saved &amp; invested in ${monthName(app.period).split(' ')[0]}</span>
        <strong>${money(Math.max(0, d.summary.savedPaise))}</strong>
      </div>
    </div>

    <section class="panel commitments-panel">
      <div class="panel-head">
        <div>
          <span class="section-step">1 · Protected first</span>
          <h2>Fixed Commitments &amp; Goals</h2>
          <p class="panel-sub">${fixed.length
            ? `${doneCount} of ${fixed.length} completed this month · Organized across your bucket types.`
            : 'No fixed commitments yet.'}</p>
        </div>
        <div class="panel-head-actions">
          ${button('+ Add bucket', 'quick-add-bucket', '', 'small ghost')}
          ${button('Manage plan & types', 'nav', 'data-view="plan"', 'small ghost')}
        </div>
      </div>
      ${fixedBucketTypes.length > 1 ? `
        <div class="type-filter-bar" role="tablist" aria-label="Filter by bucket type">
          <button type="button" class="type-chip ${app.typeFilter === 'all' ? 'active' : ''}" data-action="filter-type" data-id="all">All types (${fixed.length})</button>
          ${fixedBucketTypes.map(bt => {
            const count = fixed.filter(c => catBucketTypeId(c) === bt.id).length;
            return `<button type="button" class="type-chip ${app.typeFilter === bt.id ? 'active' : ''}" data-action="filter-type" data-id="${esc(bt.id)}">${esc(bt.icon)} ${esc(bt.name)} (${count})</button>`;
          }).join('')}
        </div>` : ''}
      <div class="commitment-grid">
        ${filteredFixed.map(c => commitmentCard(c, commitments.get(c.id))).join('') || '<p class="empty">Add a bill, loan, saving, or investment bucket in your Monthly Plan.</p>'}
      </div>
    </section>

    <section class="panel spending-section">
      <div class="panel-head">
        <div>
          <span class="section-step">2 · Daily flexible budget</span>
          <h2>Everyday Spending</h2>
          <p class="panel-sub">Spend directly from these buckets. If one runs low, move money from another bucket without changing your bank balance.</p>
        </div>
        <div class="panel-head-actions">
          ${button('+ Add spending bucket', 'quick-add-bucket', 'data-type="spending"', 'small ghost')}
          ${button('⇄ Move money', 'move', '', 'small ghost')}
        </div>
      </div>
      <div class="envelope-grid">
        ${everyday.map(c => spendingCard(c, targets.get(c.id) || 0)).join('') || '<p class="empty">Add an everyday spending bucket in your Monthly Plan.</p>'}
      </div>
    </section>

    ${investmentView()}
    ${recentActivity()}`;
}

function commitmentCard(c, commitment) {
  const t = type(c);
  const bt = catBucketType(c);
  const status = commitment?.status;
  const done = status === 'done';
  const atGoal = status === 'at-goal';
  const complete = done || atGoal;
  const target = commitment?.targetPaise || 0;
  const paid = Math.max(0, commitment?.paidPaise || 0);
  const remaining = commitment?.remainingPaise || 0;
  const progress = complete ? 100 : target ? Math.min(100, Math.max(0, (paid / target) * 100)) : 0;
  const due = commitment?.dueDate && !complete
    ? new Date(`${commitment.dueDate}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : '';

  const tag = bt?.name || (t === 'bill' ? 'Bill' : t === 'loan' ? 'Loan EMI' : t === 'saving' ? 'Savings' : 'Investment');
  const actionLabel = t === 'bill' ? (complete ? '+ Log payment' : 'Pay bill')
    : t === 'loan' ? (complete ? '+ Log EMI' : 'Pay EMI')
    : t === 'investment' ? (complete ? '+ Invest more' : 'Record SIP / invest')
    : 'Transfer / save';

  let statusText;
  if (complete) {
    statusText = atGoal
      ? '✓ Cap / goal reached'
      : t === 'investment'
        ? `✓ ${money(paid || target)} invested this month`
        : t === 'saving'
          ? `✓ ${money(target)} monthly goal met`
          : `✓ Paid for ${monthName(app.period).split(' ')[0]}`;
  } else if (!target) {
    statusText = 'No monthly target set';
  } else if (t === 'saving') {
    statusText = `${money(remaining)} left to save this month`;
  } else if (t === 'investment') {
    statusText = `${money(remaining)} left to invest this month`;
  } else {
    statusText = `${money(remaining)} still to pay`;
  }
  if (commitment?.overduePaise) {
    statusText += ` · ${money(commitment.overduePaise)} overdue from earlier`;
  }

  const primaryLabel = t === 'saving' ? 'Total saved in bucket' : t === 'investment' ? 'Cash waiting to invest' : 'Cash set aside';

  return `
    <article class="commitment-card ${complete ? 'is-done' : ''} ${commitment?.overduePaise ? 'is-overdue' : ''}" style="--accent:${esc(c.color)}">
      <div class="commitment-top">
        <span class="env-icon" style="background:${esc(c.color)}18">${esc(c.icon)}</span>
        <div class="commitment-title-wrap">
          <button class="commitment-name" type="button" data-action="bucket" data-id="${c.id}">
            <strong>${esc(c.name)}</strong>
            <small>${c.rollover ? 'Rolls over unused cash' : 'Resets each month'}${due ? ` · Due ${due}` : ''}</small>
          </button>
        </div>
        <span class="env-tag ${t}">${esc(tag)}</span>
        ${complete ? '<span class="tick" aria-label="Done">✓</span>' : ''}
      </div>

      <div class="commitment-figures">
        <div class="commitment-figure">
          <span>${primaryLabel}</span>
          <strong class="commitment-amount ${c.balancePaise < 0 ? 'negative' : ''}">${money(c.balancePaise)}</strong>
        </div>
        <div class="commitment-figure right">
          <span>Monthly plan</span>
          <strong>${target > 0 ? money(target) : '—'}</strong>
        </div>
      </div>

      <div class="bar"><span style="width:${progress}%;background:${esc(c.color)}"></span></div>
      <div class="commitment-status ${complete ? 'done' : commitment?.overduePaise ? 'overdue' : 'due'}">${statusText}</div>

      <div class="commitment-foot">
        <button type="button" class="link-btn" data-action="bucket" data-id="${c.id}">Details${['bill', 'loan'].includes(t) ? ' / mark paid' : ''}</button>
        ${button(actionLabel, 'expense', `data-id="${c.id}"`, complete ? 'small ghost' : 'small primary')}
      </div>
    </article>`;
}

function spendingCard(c, target) {
  const over = c.balancePaise < 0;
  const unfunded = !app.data.derived.allocation && c.balancePaise === 0 && !historical();
  const spent = Math.max(0, app.data.derived.summary.spentByCategory?.[c.id] || 0);
  const totalPool = Math.max(target, c.balancePaise + spent);
  const remainingPct = over ? 0 : totalPool > 0 ? Math.min(100, Math.max(0, (c.balancePaise / totalPool) * 100)) : 0;

  return `
    <article class="env-card ${over ? 'is-over' : ''}" style="--accent:${esc(c.color)}">
      <div class="env-head">
        <span class="env-icon" style="background:${esc(c.color)}18">${esc(c.icon)}</span>
        <button class="env-name" type="button" data-action="bucket" data-id="${c.id}">
          <strong>${esc(c.name)}</strong>
          <small>${target ? `${money(target)} monthly plan` : 'No monthly plan'}${c.rollover ? ' · Rolls over' : ''}</small>
        </button>
        ${button('+ Spend', 'expense', `data-id="${c.id}" aria-label="Add ${esc(c.name)} expense"`, 'small ghost')}
      </div>

      <div class="env-balance-row">
        <div>
          <div class="env-amount">${money(c.balancePaise)}</div>
          <div class="env-target">
            ${over
              ? `Overspent by ${money(-c.balancePaise)}`
              : unfunded
                ? `Waiting to fund month (${money(target)} planned)`
                : `Available to spend right now`}
          </div>
        </div>
      </div>

      <div class="bar"><span style="width:${remainingPct}%;background:${over ? 'var(--danger)' : esc(c.color)}"></span></div>

      <div class="env-foot">
        <span>${spent > 0 ? `${money(spent)} spent this month` : 'No spending yet'}</span>
        ${over
          ? button('Cover overspend', 'move', `data-to="${c.id}"`, 'small danger')
          : `<strong>${target ? `${Math.round(remainingPct)}% left` : '—'}</strong>`}
      </div>
    </article>`;
}

function investmentView() {
  const investments = app.data.derived.investments;
  if (historical()) return '';
  const commitments = new Map(app.data.derived.commitments.map(c => [c.categoryId, c]));
  const totalWorth = investments.reduce((n, i) => n + (i.worthPaise || 0), 0);
  const totalCashWaiting = investments.reduce((n, i) => n + Math.max(0, cat(i.categoryId)?.balancePaise || 0), 0);
  const knownGains = investments.filter(i => i.gainPaise != null);
  const totalGain = knownGains.length ? knownGains.reduce((n, i) => n + i.gainPaise, 0) : null;
  const invBucketType = bucketTypes().find(bt => bt.behavior === 'investment')?.id || 'investment';

  return `
    <section class="panel investment-panel">
      <div class="panel-head">
        <div>
          <span class="section-step">Multi-Bucket Portfolio · Outside bank cash</span>
          <h2>Investment Buckets &amp; Holdings (${investments.length})</h2>
          <p class="panel-sub">Add separate buckets for each SIP, PPF, stock, or gold holding. Bucket cash is what is waiting in your bank to invest; Worth is the market value of the holding.</p>
        </div>
        <div class="panel-head-actions">
          ${button('+ Add investment bucket', 'quick-add-bucket', `data-type="${esc(invBucketType)}"`, 'small primary')}
        </div>
      </div>

      ${investments.length ? `
        <div class="investment-summary-bar">
          <div>
            <span>Cash waiting to invest</span>
            <strong>${money(totalCashWaiting)}</strong>
          </div>
          <div>
            <span>Portfolio market worth</span>
            <strong>${money(totalWorth)}</strong>
          </div>
          <div>
            <span>Total gain / loss</span>
            <strong class="${totalGain > 0 ? 'positive' : totalGain < 0 ? 'negative' : ''}">${totalGain == null ? '—' : `${totalGain >= 0 ? '+' : ''}${money(totalGain)}`}</strong>
          </div>
        </div>
        <div class="investment-list">
          ${investments.map(i => {
            const c = cat(i.categoryId);
            const commitment = commitments.get(i.categoryId);
            const cashInBucket = c?.balancePaise || 0;
            const gain = i.gainPaise;
            const gainText = gain == null
              ? (i.worthStale ? 'Needs value update' : i.historyComplete ? 'Enter current worth' : 'Set opening cost')
              : `${gain >= 0 ? '+' : ''}${money(gain)}`;
            return `
              <div class="investment-row">
                <span class="env-icon" style="background:${esc(i.color || '#23735f')}18">${esc(i.icon || '📈')}</span>
                <div class="investment-name">
                  <button type="button" class="commitment-name" data-action="bucket" data-id="${i.categoryId}">
                    <strong>${esc(i.name)}${i.archived ? '<span class="paused">Paused</span>' : ''}</strong>
                  </button>
                  <small>${i.worthStale
                    ? 'New SIP/withdrawal logged — update current value'
                    : i.historyComplete
                      ? `Cost basis: ${money((i.putInPaise || 0) + (i.openingCostPaise || 0))}${commitment?.targetPaise ? ` · Plan: ${money(commitment.targetPaise)}/mo` : ''}`
                      : 'Set opening history once to track gain / loss'}</small>
                </div>
                <div class="investment-metrics">
                  <div class="investment-metric">
                    <span>Cash in bucket</span>
                    <strong>${money(cashInBucket)}</strong>
                  </div>
                  <div class="investment-metric">
                    <span>Worth now</span>
                    <strong>${i.worthPaise == null ? '—' : money(i.worthPaise)}</strong>
                  </div>
                  <div class="investment-metric">
                    <span>Gain / loss</span>
                    <strong class="${gain > 0 ? 'positive' : gain < 0 ? 'negative' : ''}">${gainText}</strong>
                  </div>
                </div>
                <div class="investment-actions">
                  ${!i.archived ? button('Invest', 'expense', `data-id="${i.categoryId}"`, 'small ghost') : ''}
                  ${button('Update worth', 'worth', `data-id="${i.categoryId}"`, 'small ghost')}
                </div>
              </div>`;
          }).join('')}
        </div>` : `<p class="empty">No investment buckets yet. Click <strong>+ Add investment bucket</strong> to track SIPs, PPF, stocks, or gold.</p>`}
    </section>`;
}

function recentActivity() {
  const rows = [...app.data.transactions]
    .sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`))
    .slice(0, 5);

  return `
    <section class="panel recent-panel">
      <div class="panel-head">
        <div>
          <span class="section-step">Latest ledger entries</span>
          <h2>Recent Activity</h2>
          <p class="panel-sub">Click any entry to edit, reverse, or delete it.</p>
        </div>
        ${button('View all →', 'nav', 'data-view="transactions"', 'small ghost')}
      </div>
      ${rows.length
        ? `<div class="recent-list">
            ${rows.map(t => {
              const c = cat(t.categoryId);
              const incoming = t.direction === 'in';
              const tag = t.kind === 'income' ? 'Income' : t.kind === 'adjustment' ? 'Balance correction' : t.kind === 'transfer' ? (incoming ? 'Withdrawal' : 'Transfer out') : (incoming ? 'Refund' : 'Expense');
              return `
                <button class="recent-row" type="button" data-action="edit" data-id="${t.id}">
                  <span class="recent-icon" style="background:${c ? esc(c.color) : '#8a8376'}18">${c ? esc(c.icon) : (t.kind === 'income' ? '↓' : '•')}</span>
                  <span class="recent-main">
                    <strong>${esc(t.description)}</strong>
                    <small>${shortDate(t.date)} · ${esc(c?.name || tag)}</small>
                  </span>
                  <strong class="${incoming ? 'positive' : ''}">${incoming ? '+' : '−'}${money(t.amountPaise)}</strong>
                </button>`;
            }).join('')}
          </div>`
        : `<p class="empty">No transactions logged yet. Use <strong>+ Log expense</strong> or <strong>+ Log income</strong> as money moves.</p>`}
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Plan View (Bucket Types + Self-Adjusting Percentage Sliders)       */
/* ------------------------------------------------------------------ */

function bucketTypeRulesBadges(bt) {
  const behaviorLabel = {
    bill: 'Bill payment',
    loan: 'Loan / EMI',
    saving: 'Bank savings reserve',
    investment: 'Investment portfolio',
    spending: 'Daily spending (%)'
  }[bt.behavior] || bt.behavior;
  const parts = [
    behaviorLabel,
    bt.defaultRollover ? 'Default: Rolls over leftover' : 'Default: Resets monthly',
    bt.defaultCapPaise != null ? `Default cap: ${money(bt.defaultCapPaise)}` : '',
    bt.defaultDueDay ? `Default due day: ${bt.defaultDueDay}` : '',
    `Priority ${bt.priority || 2}`
  ].filter(Boolean);
  return parts.map(p => `<span class="rule-badge">${esc(p)}</span>`).join('');
}

function planView() {
  const s = app.data.settings;
  const allTypes = bucketTypes();
  const fixedTypes = allTypes.filter(bt => bt.kind === 'fixed');
  const flexTypes = allTypes.filter(bt => bt.kind === 'flex');

  return `
    ${pageHead(
      'Monthly Salary Plan',
      'Bucket types, rules & monthly division',
      button('+ Add Bucket Type', 'open-bucket-type', '', 'primary small')
    )}

    ${s.planConfirmed === false ? `
      <div class="notice warn flow-banner">
        <div class="notice-copy">
          <span class="step-pill">Step 1 of 2 · Customize your plan</span>
          <strong>Make this monthly plan yours, then click Save plan.</strong>
          <p>Adjust your expected salary and bucket amounts below. You can add multiple buckets under any Bucket Type (like Investments or Bills), configure Bucket Type rules, and drag the self-adjusting spending sliders.</p>
        </div>
      </div>` : ''}

    <form data-form="plan" id="plan-form" novalidate>
      <div class="plan-controls">
        ${amountField('Expected monthly take-home salary', 'income', rupees(s.monthlyIncomePaise))}
        <label class="field">
          <span>Usual payday (day of month)</span>
          <input name="payday" type="number" min="1" max="31" step="1" value="${s.paydayDay}" required>
        </label>
        <div class="plan-control-note">
          <span class="eyebrow">How the plan works</span>
          <strong>Salary − Fixed Commitments = Everyday Spending</strong>
          <small>Number fields step by ₹10. Spending sliders automatically self-adjust to maintain 100%.</small>
        </div>
      </div>

      <div id="plan-summary" class="plan-summary"></div>

      <div class="plan-waterfall-group">
        <div class="waterfall-banner">
          <div class="waterfall-banner-top">
            <div>
              <span class="step-pill">Part 1 · Fixed Rupee Bucket Types (₹)</span>
              <h2>Fixed Monthly Commitments &amp; Goals</h2>
              <p>Each bucket type has its own configurable rules and can hold as many buckets as you need (e.g., multiple SIPs under Investments, or multiple bills under Bills).</p>
            </div>
            ${button('+ Add Fixed Bucket Type', 'open-bucket-type', 'data-kind="fixed"', 'small ghost')}
          </div>
        </div>

        ${fixedTypes.map(bt => {
          const items = active().filter(c => catBucketTypeId(c) === bt.id);
          return `
            <section class="plan-section" data-bt-section="${esc(bt.id)}">
              <div class="plan-section-head">
                <div>
                  <div class="plan-section-title">
                    <span class="plan-type-icon" style="background:${esc(bt.color || '#23735f')}18">${esc(bt.icon || '🏷️')}</span>
                    <h3>${esc(bt.name)}</h3>
                    <span class="plan-count">${items.length} bucket${items.length === 1 ? '' : 's'}</span>
                    <span class="plan-type-subtotal" data-bt-subtotal="${esc(bt.id)}"></span>
                  </div>
                  <p>${esc(bt.description || '')}</p>
                  <div class="rule-badge-row">${bucketTypeRulesBadges(bt)}</div>
                </div>
                <div class="plan-section-actions">
                  ${button('⚙ Type rules', 'open-bucket-type', `data-id="${esc(bt.id)}"`, 'small ghost')}
                  ${button(`+ Add bucket`, 'add-row', `data-type="${esc(bt.id)}"`, 'small primary')}
                </div>
              </div>
              <div class="plan-rows" data-plan-type="${esc(bt.id)}">
                ${items.map(planRow).join('')}
              </div>
            </section>`;
        }).join('')}
      </div>

      <div class="plan-waterfall-group">
        <div class="waterfall-banner">
          <div class="waterfall-banner-top">
            <div>
              <span class="step-pill">Part 2 · Self-Adjusting Percentage Shares (Always 100%)</span>
              <h2>Everyday Spending Bucket Types</h2>
              <p>Drag any slider or type a percentage—the other unlocked spending buckets automatically rebalance so the total stays at 100%. Click 🔒 to lock a bucket’s share.</p>
            </div>
            <div class="plan-section-actions">
              ${button('Split evenly', 'even-percents', '', 'small ghost')}
              ${button('+ Add % Bucket Type', 'open-bucket-type', 'data-kind="flex"', 'small ghost')}
            </div>
          </div>
        </div>

        ${flexTypes.map(bt => {
          const items = active().filter(c => catBucketTypeId(c) === bt.id);
          return `
            <section class="plan-section" data-bt-section="${esc(bt.id)}">
              <div class="plan-section-head">
                <div>
                  <div class="plan-section-title">
                    <span class="plan-type-icon" style="background:${esc(bt.color || '#6c8a45')}18">${esc(bt.icon || '🛒')}</span>
                    <h3>${esc(bt.name)}</h3>
                    <span class="plan-count">${items.length} bucket${items.length === 1 ? '' : 's'}</span>
                    <span class="plan-type-subtotal" data-bt-subtotal="${esc(bt.id)}"></span>
                  </div>
                  <p>${esc(bt.description || '')}</p>
                  <div class="rule-badge-row">${bucketTypeRulesBadges(bt)}</div>
                </div>
                <div class="plan-section-actions">
                  ${button('⚙ Type rules', 'open-bucket-type', `data-id="${esc(bt.id)}"`, 'small ghost')}
                  ${button('+ Add bucket', 'add-row', `data-type="${esc(bt.id)}"`, 'small primary')}
                </div>
              </div>
              <div class="plan-rows" data-plan-type="${esc(bt.id)}">
                ${items.map(planRow).join('')}
              </div>
            </section>`;
        }).join('')}
      </div>

      <section class="panel plan-advanced">
        <div class="plan-advanced-head">
          <div>
            <span class="section-step">Part 3 · Leftover &amp; Surplus Rule</span>
            <h3>Where should extra money go when funding?</h3>
            <p class="hint">When non-rollover buckets reset or your income exceeds the plan, any extra cash can automatically sweep into an eligible goal bucket.</p>
          </div>
          <label class="field">
            <span>Send surplus to</span>
            <select name="surplus">
              <option value="">Keep in Unassigned</option>
              ${active().filter(c => {
                const bt = catBucketType(c);
                return bt?.allowSurplus !== undefined ? bt.allowSurplus && !['bill', 'spending'].includes(type(c)) : ['saving', 'investment'].includes(type(c));
              }).map(c => `<option value="${c.id}" ${s.surplusCategoryId === c.id ? 'selected' : ''}>${esc(c.name)} (${esc(catBucketType(c).name)})</option>`).join('')}
            </select>
          </label>
        </div>
      </section>

      <div class="plan-save" ${app.dirty || s.planConfirmed === false ? '' : 'hidden'}>
        <div>
          <strong>${s.planConfirmed === false ? 'Step 1 complete? Save your plan to continue.' : 'You have unsaved changes to your monthly plan.'}</strong>
          <p class="fine">Applies when you next fund a month. Existing funded budgets keep their snapshot.</p>
        </div>
        <button class="btn primary" type="submit">${s.planConfirmed === false ? 'Save plan & continue →' : 'Save plan'}</button>
      </div>
    </form>`;
}

function planRow(c) {
  const optionsId = `options-${c.id || Math.random().toString(36).slice(2, 9)}`;
  const btId = catBucketTypeId(c);
  const bt = findBucketType(btId) || { id: btId, behavior: type(c), kind: c.kind || (type(c) === 'spending' ? 'flex' : 'fixed'), icon: '🏷️', color: '#23735f' };
  const behavior = bt.behavior || type(c);
  const fixed = bt.kind !== 'flex' && behavior !== 'spending';
  const paid = (app.data.billOverrides || []).some(b => b.categoryId === c.id && b.period === app.period && b.settled);
  const showOnboardingPaid = app.data.settings.planConfirmed === false && ['bill', 'loan'].includes(behavior);
  const pctVal = fixed ? 0 : Number(c.percent ?? 0);

  const metaParts = [
    fixed ? 'Fixed ₹ / month' : 'Self-adjusting % share',
    c.rollover ? 'Rolls over unused cash' : 'Resets monthly',
    c.capPaise != null ? `Cap ${money(c.capPaise)}` : '',
    c.dueDay ? `Due day ${c.dueDay}` : ''
  ].filter(Boolean);

  const sameKindTypes = bucketTypes().filter(item => (item.kind === 'flex') === !fixed);

  return `
    <div class="plan-line ${fixed ? 'is-fixed-line' : 'is-flex-line'}" data-cat="${esc(c.id || '')}" data-type="${esc(behavior)}" data-bucket-type="${esc(bt.id)}" data-kind="${fixed ? 'fixed' : 'flex'}" data-locked="false" data-icon="${esc(c.icon || bt.icon || '🏷️')}" data-color="${esc(c.color || bt.color || '#23735f')}">
      <div class="plan-line-main">
        <span class="plan-icon" style="background:${esc(c.color || bt.color || '#23735f')}18">${esc(c.icon || bt.icon || '🏷️')}</span>
        <div class="plan-name">
          <input name="name" value="${esc(c.name || '')}" placeholder="Bucket name (e.g. ${behavior === 'investment' ? 'Nifty 50 SIP, PPF, Gold' : 'Name'})" maxlength="40" aria-label="Bucket name" required>
          <small>${metaParts.join(' · ')}</small>
        </div>
        ${!fixed ? `
          <div class="plan-slider-wrap">
            <button type="button" class="lock-btn" data-action="lock-percent" title="Lock or unlock this bucket's percentage" aria-label="Lock percentage">🔓</button>
            <input type="range" class="percent-slider" min="0" max="100" step="0.5" value="${esc(pctVal)}" aria-label="Percentage slider">
            <span class="plan-calc-rupees" data-plan-rupees></span>
          </div>` : ''}
        <div class="money-input">
          <span>${fixed ? '₹' : '%'}</span>
          <input name="${fixed ? 'target' : 'percent'}" value="${fixed ? rupees(c.targetPaise || 0) : pctVal}" type="number" min="0" ${fixed ? 'step="10"' : 'max="100" step="1"'} inputmode="decimal" aria-label="${fixed ? 'Monthly amount' : 'Spending share'}" required>
        </div>
        <button class="btn small ghost plan-opt-btn" type="button" data-action="row-options" aria-controls="${optionsId}" aria-expanded="${showOnboardingPaid ? 'true' : 'false'}" aria-label="Options for ${esc(c.name || 'bucket')}">Rules ▾</button>
      </div>
      <details id="${optionsId}" ${showOnboardingPaid ? 'open' : ''}>
        <summary hidden>Options</summary>
        <div class="plan-options">
          <label class="field small-field">
            <span>Icon</span>
            <input name="rowIcon" value="${esc(c.icon || bt.icon || '🏷️')}" maxlength="4" aria-label="Icon">
          </label>
          <label class="field small-field">
            <span>Color</span>
            <input name="rowColor" type="color" value="${esc(c.color || bt.color || '#23735f')}" aria-label="Color">
          </label>
          ${sameKindTypes.length > 1 ? `
            <label class="field">
              <span>Bucket type</span>
              <select name="rowBucketType">
                ${sameKindTypes.map(item => `<option value="${esc(item.id)}" ${item.id === bt.id ? 'selected' : ''}>${esc(item.icon)} ${esc(item.name)}</option>`).join('')}
              </select>
            </label>` : ''}
          <label class="check">
            <input name="rollover" type="checkbox" ${c.rollover ? 'checked' : ''}>
            Keep leftover cash for next month
          </label>
          ${amountField('Maximum bucket cap (optional)', 'cap', rupees(c.capPaise), false, 'No limit')}
          ${['bill', 'loan'].includes(behavior) ? `
            <label class="field">
              <span>Due day of month (1–31)</span>
              <input name="dueDay" type="number" min="1" max="31" step="1" placeholder="Optional" value="${c.dueDay || ''}">
            </label>
            ${app.data.settings.planConfirmed === false ? `
              <label class="check highlight-check">
                <input name="alreadyPaid" type="checkbox" ${paid ? 'checked' : ''}>
                Already paid before starting balance
              </label>` : ''}
          ` : ''}
          ${button('Remove bucket', 'remove-row', c.balancePaise ? 'disabled title="Move the balance to another bucket first"' : '', 'small ghost')}
        </div>
      </details>
    </div>`;
}

/**
 * Self-adjusting percentages: keeps all flexible spending buckets summing to 100%
 * whenever a slider or percentage input is changed, or when rows are added/removed.
 */
function rebalancePercentages(changedRow = null, sourceInput = null) {
  const f = $('#plan-form');
  if (!f) return;
  const flexRows = $$('.plan-line[data-kind="flex"]', f);
  if (!flexRows.length) return;

  const setRowPercent = (row, val) => {
    const rounded = Math.max(0, Math.min(100, Math.round(val * 100) / 100));
    const numInput = $('[name=percent]', row);
    const slider = $('.percent-slider', row);
    if (numInput && numInput !== sourceInput) numInput.value = rounded;
    if (slider && slider !== sourceInput) slider.value = rounded;
  };

  if (flexRows.length === 1) {
    setRowPercent(flexRows[0], 100);
    if (sourceInput) sourceInput.value = 100;
    return;
  }

  if (!changedRow) {
    const unlocked = flexRows.filter(r => r.dataset.locked !== 'true');
    const lockedSum = flexRows.filter(r => r.dataset.locked === 'true').reduce((n, r) => n + Number($('[name=percent]', r)?.value || 0), 0);
    const target = Math.max(0, 100 - lockedSum);
    const targets = unlocked.length ? unlocked : flexRows;
    const currentSum = targets.reduce((n, r) => n + Number($('[name=percent]', r)?.value || 0), 0);
    let running = 0;
    targets.forEach((row, idx) => {
      if (idx === targets.length - 1) {
        setRowPercent(row, Math.max(0, Math.round((target - running) * 100) / 100));
      } else {
        const cur = Number($('[name=percent]', row)?.value || 0);
        const nextVal = currentSum > 0
          ? Math.round(((cur / currentSum) * target) * 2) / 2
          : Math.round((target / targets.length) * 2) / 2;
        setRowPercent(row, nextVal);
        running += nextVal;
      }
    });
    return;
  }

  const rawValue = Number(sourceInput ? sourceInput.value : $('[name=percent]', changedRow)?.value || 0);
  const otherRows = flexRows.filter(r => r !== changedRow);
  const lockedOthers = otherRows.filter(r => r.dataset.locked === 'true');
  const unlockedOthers = otherRows.filter(r => r.dataset.locked !== 'true');
  const lockedSum = lockedOthers.reduce((n, r) => n + Number($('[name=percent]', r)?.value || 0), 0);
  const maxAllowed = Math.max(0, Math.round((100 - lockedSum) * 100) / 100);

  if (!unlockedOthers.length) {
    setRowPercent(changedRow, maxAllowed);
    if (sourceInput) sourceInput.value = maxAllowed;
    return;
  }

  const clamped = Math.max(0, Math.min(maxAllowed, Number.isFinite(rawValue) ? rawValue : 0));
  setRowPercent(changedRow, clamped);
  if (sourceInput && Number(sourceInput.value) !== clamped) {
    sourceInput.value = clamped;
  }

  const remainder = Math.max(0, Math.round((maxAllowed - clamped) * 100) / 100);
  const otherSum = unlockedOthers.reduce((n, r) => n + Math.max(0, Number($('[name=percent]', r)?.value || 0)), 0);

  let allocated = 0;
  unlockedOthers.forEach((row, idx) => {
    if (idx === unlockedOthers.length - 1) {
      const lastVal = Math.max(0, Math.round((remainder - allocated) * 100) / 100);
      setRowPercent(row, lastVal);
    } else {
      const cur = Math.max(0, Number($('[name=percent]', row)?.value || 0));
      const nextVal = otherSum > 0
        ? Math.round(((cur / otherSum) * remainder) * 2) / 2
        : Math.round((remainder / unlockedOthers.length) * 2) / 2;
      const bounded = Math.min(remainder - allocated, Math.max(0, nextVal));
      setRowPercent(row, bounded);
      allocated += bounded;
    }
  });
}

function collectPlan() {
  const f = $('#plan-form');
  return {
    monthlyIncomePaise: paise(f.elements.income.value),
    paydayDay: Number(f.elements.payday.value),
    surplusCategoryId: f.elements.surplus.value || null,
    period: app.period,
    categories: $$('.plan-line', f).map(row => {
      const btId = $('[name=rowBucketType]', row)?.value || row.dataset.bucketType || row.dataset.type;
      const bt = findBucketType(btId);
      const behavior = bt?.behavior || row.dataset.type;
      const icon = $('[name=rowIcon]', row)?.value.trim() || row.dataset.icon || '🏷️';
      const color = $('[name=rowColor]', row)?.value || row.dataset.color || '#23735f';
      return {
        id: row.dataset.cat || undefined,
        kind: row.dataset.kind === 'flex' ? 'flex' : 'fixed',
        type: behavior,
        bucketTypeId: btId,
        name: $('[name=name]', row).value.trim(),
        targetPaise: $('[name=target]', row) ? paise($('[name=target]', row).value) : 0,
        percent: Number($('[name=percent]', row)?.value || 0),
        rollover: $('[name=rollover]', row).checked,
        capPaise: $('[name=cap]', row).value === '' ? null : paise($('[name=cap]', row).value),
        dueDay: Number($('[name=dueDay]', row)?.value) || null,
        alreadyPaid: Boolean($('[name=alreadyPaid]', row)?.checked),
        icon,
        color
      };
    })
  };
}

function updatePlanTotal() {
  const f = $('#plan-form');
  if (!f) return;
  const p = collectPlan();
  const fixed = p.categories.filter(c => c.kind === 'fixed').reduce((n, c) => n + c.targetPaise, 0);
  const share = p.categories.filter(c => c.kind === 'flex').reduce((n, c) => n + c.percent, 0);
  const hasFlex = p.categories.some(c => c.kind === 'flex');
  const shareValid = !hasFlex || Math.abs(share - 100) < 0.01;
  const valid = p.monthlyIncomePaise > 0 && fixed <= p.monthlyIncomePaise && shareValid;
  const income = p.monthlyIncomePaise || 0;
  const spending = Math.max(0, income - fixed);
  const fixedPct = income ? Math.min(100, (fixed / income) * 100) : 0;
  const spendingPct = income ? Math.min(100, (spending / income) * 100) : 0;

  for (const row of $$('.plan-line[data-kind="flex"]', f)) {
    const pct = Number($('[name=percent]', row)?.value || 0);
    const preview = $('[data-plan-rupees]', row);
    if (preview) preview.textContent = `≈ ${money(Math.round((spending * pct) / 100))} / mo`;
  }

  for (const section of $$('[data-bt-section]', f)) {
    const btId = section.dataset.btSection;
    const subtotalEl = $(`[data-bt-subtotal="${btId}"]`, section);
    if (!subtotalEl) continue;
    const rows = $$('.plan-line', section);
    const bt = findBucketType(btId);
    if (bt?.kind === 'flex') {
      const pctSum = rows.reduce((n, r) => n + Number($('[name=percent]', r)?.value || 0), 0);
      subtotalEl.textContent = `· ${Number(pctSum.toFixed(1))}% (${money(Math.round((spending * pctSum) / 100))}/mo)`;
    } else {
      const rupeeSum = rows.reduce((n, r) => n + paise($('[name=target]', r)?.value || 0), 0);
      subtotalEl.textContent = `· ${money(rupeeSum)} / mo`;
    }
  }

  const shareDiff = Number((100 - share).toFixed(2));
  const shareHint = shareValid
    ? '✓ Self-balanced at 100%'
    : shareDiff > 0
      ? `Add ${shareDiff}% more to reach 100%`
      : `Reduce by ${Math.abs(shareDiff)}% to reach 100%`;

  $('#plan-summary').innerHTML = `
    <div class="plan-totals">
      <div>
        <span>1. Fixed commitments</span>
        <strong>${money(fixed)}</strong>
        <small>${fixedPct.toFixed(0)}% of salary (${money(income)})</small>
      </div>
      <div>
        <span>2. Left for everyday spending</span>
        <strong>${money(spending)}</strong>
        <small>${spendingPct.toFixed(0)}% of salary</small>
      </div>
      <div class="${shareValid ? '' : 'negative'}">
        <span>3. Spending shares total</span>
        <strong>${Number(share.toFixed(2))}%</strong>
        <small>${shareHint}</small>
      </div>
    </div>
    <div class="plan-meter" aria-hidden="true">
      <span style="width:${fixedPct}%"></span>
      <i style="width:${spendingPct}%"></i>
    </div>
    ${!valid ? `<p class="negative plan-error">${fixed > income ? `Fixed commitments (${money(fixed)}) exceed your salary (${money(income)}). ` : ''}${!shareValid ? `Everyday spending percentages must add up to 100% (currently ${Number(share.toFixed(2))}%).` : ''}</p>` : ''}`;

  const bar = $('.plan-save', f);
  if (bar) bar.hidden = !(app.dirty || app.data.settings.planConfirmed === false);
  const submit = $('button[type=submit]', f);
  if (submit) submit.disabled = !valid;
}

/* ------------------------------------------------------------------ */
/* Activity / Ledger View                                             */
/* ------------------------------------------------------------------ */

function activityView() {
  const rows = [];
  for (const t of app.data.transactions.filter(t => t.date.startsWith(app.period))) {
    const c = cat(t.categoryId);
    const bt = c ? catBucketType(c) : null;
    const typeBadge = t.kind === 'income' ? 'Income' : t.kind === 'adjustment' ? 'Balance correction' : t.kind === 'transfer' ? (t.direction === 'in' ? 'Withdrawal' : 'Transfer out') : (t.direction === 'in' ? 'Refund' : 'Expense');
    rows.push({
      key: `${t.date}${t.createdAt}`,
      date: t.date,
      label: t.description,
      detail: `${c?.name || typeBadge}${bt ? ` (${bt.name})` : ''}${c ? ` · ${typeBadge}` : ''}`,
      amount: (t.direction === 'in' ? 1 : -1) * t.amountPaise,
      kind: t.kind,
      id: t.id,
      action: 'edit',
      icon: c?.icon || (t.kind === 'income' ? '↓' : '•'),
      color: c?.color || '#8a8376'
    });
  }
  for (const m of app.data.moves.filter(m => (m.date || m.createdAt).startsWith(app.period))) {
    rows.push({
      key: `${m.date || m.createdAt.slice(0, 10)}${m.createdAt}`,
      date: m.date || m.createdAt.slice(0, 10),
      label: `${cat(m.fromCategoryId)?.name || 'Unassigned'} → ${cat(m.toCategoryId)?.name || 'Unassigned'}`,
      detail: m.note ? `Bucket move · ${m.note}` : 'Bucket move (bank balance unchanged)',
      amount: m.amountPaise,
      kind: 'budget',
      id: m.id,
      action: 'move-detail',
      icon: '⇄',
      color: '#2b7259'
    });
  }
  for (const a of app.data.allocations.filter(a => a.period === app.period)) {
    for (const f of a.fundings || [{ date: a.createdAt.slice(0, 10), createdAt: a.createdAt }]) {
      rows.push({
        key: `${f.date}${f.createdAt}`,
        date: f.date,
        label: `Funded ${monthName(a.period)} budget`,
        detail: 'Monthly salary division into buckets',
        amount: null,
        kind: 'budget',
        id: a.id,
        action: 'allocation-detail',
        icon: '◷',
        color: '#8a662e'
      });
    }
  }
  rows.sort((a, b) => b.key.localeCompare(a.key));

  return `
    ${pageHead('Activity & History', 'All transactions & budget moves', monthPicker())}
    <div class="activity-tools">
      <input type="search" data-control="search" value="${esc(app.search)}" placeholder="Search by description, bucket, or type…" aria-label="Search activity">
      <select data-control="filter" aria-label="Activity type">
        ${[
          ['all', 'All entries'],
          ['expense', 'Expenses & bills'],
          ['income', 'Income'],
          ['transfer', 'Investments, savings & EMIs'],
          ['budget', 'Bucket moves & funding']
        ].map(([v, l]) => `<option value="${v}" ${app.filter === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${button('+ Log expense', 'expense', '', 'primary')}
      ${button('+ Log income', 'income', '', 'ghost')}
    </div>
    <div class="panel activity-list">
      ${rows.map(r => `
        <button class="activity-row" type="button" data-action="${r.action}" data-id="${r.id}" data-kind="${r.kind}" data-search="${esc(`${r.label} ${r.detail}`.toLowerCase())}">
          <span class="activity-icon" style="background:${esc(r.color)}18">${esc(r.icon)}</span>
          <span class="activity-description">
            <strong>${esc(r.label)}</strong>
            <small>${shortDate(r.date)} · ${esc(r.detail)}</small>
          </span>
          <strong class="${r.kind !== 'budget' && r.amount > 0 ? 'positive' : r.kind !== 'budget' ? 'negative' : ''}">
            ${r.amount == null ? 'View' : `${r.kind === 'budget' ? '' : r.amount > 0 ? '+' : '−'}${money(Math.abs(r.amount))}`}
          </strong>
        </button>`).join('')}
      <div class="empty" id="activity-empty">No activity matches this view for ${monthName(app.period)}.</div>
    </div>`;
}

function filterActivity() {
  let count = 0;
  for (const row of $$('.activity-row')) {
    row.hidden = !(app.filter === 'all' || row.dataset.kind === app.filter) || !row.dataset.search.includes(app.search.toLowerCase());
    if (!row.hidden) count++;
  }
  const empty = $('#activity-empty');
  if (empty) empty.hidden = count > 0;
}

/* ------------------------------------------------------------------ */
/* Settings View                                                      */
/* ------------------------------------------------------------------ */

function settingsView() {
  const s = app.data.settings;
  const bts = bucketTypes();
  return `
    ${pageHead('Settings & Bucket Types', 'Customize bucket types, backups & app rules')}
    <div class="settings-grid">
      <section class="panel settings-card settings-card-wide">
        <div class="settings-card-head">
          <span class="settings-icon">⊞</span>
          <div style="flex:1">
            <h2>Bucket Types &amp; Configurable Rules (${bts.length})</h2>
            <p>Each bucket type defines how its buckets are planned (₹ or %), whether leftovers roll over, default caps, due dates, and funding priority.</p>
          </div>
          ${button('+ Add Bucket Type', 'open-bucket-type', '', 'primary small')}
        </div>
        <div class="bt-settings-list">
          ${bts.map(bt => {
            const count = active().filter(c => catBucketTypeId(c) === bt.id).length;
            return `
              <div class="bt-settings-row">
                <span class="env-icon" style="background:${esc(bt.color)}18">${esc(bt.icon)}</span>
                <div class="bt-settings-main">
                  <strong>${esc(bt.name)} <span class="plan-count">${count} bucket${count === 1 ? '' : 's'}</span></strong>
                  <small>${esc(bt.description || '')}</small>
                  <div class="rule-badge-row">${bucketTypeRulesBadges(bt)}</div>
                </div>
                <div class="bt-settings-actions">
                  ${button('+ Add bucket', 'quick-add-bucket', `data-type="${esc(bt.id)}"`, 'small ghost')}
                  ${button('Configure rules', 'open-bucket-type', `data-id="${esc(bt.id)}"`, 'small ghost')}
                </div>
              </div>`;
          }).join('')}
        </div>
      </section>

      <section class="panel settings-card">
        <div class="settings-card-head">
          <span class="settings-icon">◫</span>
          <div>
            <h2>Backups &amp; Balance Sync</h2>
            <p>Export your ledger as JSON, restore a backup, or verify your bank balance.</p>
          </div>
        </div>
        <div class="settings-buttons">
          <a class="btn ghost" href="/api/export">↓ Download JSON backup</a>
          <label class="btn ghost">↑ Restore from backup file<input id="restore-file" type="file" accept=".json" hidden></label>
          ${button('✓ Match bank balance', 'reconcile')}
        </div>
      </section>

      <section class="panel settings-card">
        <div class="settings-card-head">
          <span class="settings-icon">?</span>
          <div>
            <h2>Guide &amp; Rules</h2>
            <p>Learn how planning, monthly funding, rollovers, and balance corrections work.</p>
          </div>
        </div>
        ${button('Read how Khaata works', 'help')}
      </section>

      <details class="panel settings-card">
        <summary>
          <span class="settings-icon">↗</span>
          <span>
            <strong>Automatic bank / UPI alerts</strong>
            <small>Optional local webhook for SMS or notification forwarders.</small>
          </span>
        </summary>
        <div class="settings-card-body">
          <label class="field"><span>Local POST endpoint</span><input readonly value="${esc(location.origin)}/api/ingest"></label>
          <label class="field"><span>Ingest token (x-ingest-token)</span><input readonly value="${esc(s.ingestToken)}"></label>
          ${button('Generate new token', 'token')}
        </div>
      </details>

      <details class="panel settings-card">
        <summary>
          <span class="settings-icon">○</span>
          <span>
            <strong>Reset or load example data</strong>
            <small>Try the sample ledger or wipe all data to start fresh.</small>
          </span>
        </summary>
        <div class="settings-card-body">
          <div class="settings-buttons">
            ${button('Load example data', 'demo')}
            ${button('Erase all data & start over', 'reset', '', 'danger')}
          </div>
        </div>
      </details>
    </div>
    <p class="fine settings-foot">Khaata is 100% local-first. Your financial data stays on this computer in <code>data/store.json</code>.</p>`;
}

/* ------------------------------------------------------------------ */
/* Modals: Bucket Types, Quick-Add Bucket, Transactions, Funding      */
/* ------------------------------------------------------------------ */

function openBucketType({ id, defaultKind } = {}) {
  if (app.dirty && !confirm('Save or discard your unsaved plan edits before configuring bucket types?')) return;
  app.dirty = false;
  const bt = id ? findBucketType(id) : null;
  const initialBehavior = bt?.behavior || (defaultKind === 'flex' ? 'spending' : 'investment');
  const members = bt ? active().filter(c => catBucketTypeId(c) === bt.id) : [];

  modal(
    bt ? `Configure "${bt.name}" Type` : 'Add Bucket Type',
    `<form data-form="bucket-type" data-id="${esc(bt?.id || '')}" novalidate>
      <div class="form-grid">
        <label class="field">
          <span>Bucket type name</span>
          <input name="name" value="${esc(bt?.name || '')}" maxlength="40" placeholder="e.g. Subscriptions, Sinking Funds, Investments…" required>
        </label>
        <div class="form-grid" style="grid-template-columns: 74px 1fr; gap: 10px">
          <label class="field">
            <span>Icon</span>
            <input name="icon" value="${esc(bt?.icon || (initialBehavior === 'spending' ? '🛒' : '📈'))}" maxlength="4" required>
          </label>
          <label class="field">
            <span>Accent color</span>
            <input name="color" type="color" value="${esc(bt?.color || '#23735f')}">
          </label>
        </div>
      </div>

      <label class="field">
        <span>Description <em>optional</em></span>
        <input name="description" value="${esc(bt?.description || '')}" maxlength="140" placeholder="What kinds of buckets belong here?">
      </label>

      <label class="field">
        <span>Accounting &amp; planning behavior</span>
        <select name="behavior" ${bt && members.length ? 'disabled title="Remove or move existing buckets first to change behavior"' : ''}>
          ${[
            ['bill', 'Fixed Monthly Bill — ₹ amount, tracks monthly bill due/paid status & due day'],
            ['loan', 'Fixed Loan / EMI — ₹ amount, tracks monthly EMI transfers & due day'],
            ['saving', 'Fixed Savings Goal — ₹ amount kept in bank, builds toward goal cap'],
            ['investment', 'Fixed Investment Portfolio — ₹ amount set aside to invest, tracks market worth & gain/loss per bucket'],
            ['spending', 'Flexible Everyday Spending — % share of remaining salary, included in Safe to Spend']
          ].map(([val, label]) => `<option value="${val}" ${val === initialBehavior ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        ${bt && members.length ? `<input type="hidden" name="behavior" value="${esc(bt.behavior)}">` : ''}
      </label>

      <div class="bt-rules-box">
        <span class="eyebrow">Configurable Rules for "${esc(bt?.name || 'this bucket type')}"</span>
        <label class="check">
          <input name="defaultRollover" type="checkbox" ${(bt ? bt.defaultRollover : ['saving', 'investment'].includes(initialBehavior)) ? 'checked' : ''}>
          <strong>Roll over unused cash to next month</strong> (if unchecked, resets to target each month)
        </label>
        <div class="form-grid">
          ${amountField('Default maximum cap (optional)', 'defaultCap', rupees(bt?.defaultCapPaise), false, 'No limit')}
          <label class="field">
            <span>Funding priority when cash is short</span>
            <select name="priority">
              ${[
                [1, '1 — Essential (Funded first)'],
                [2, '2 — High priority (Core living)'],
                [3, '3 — Medium (Savings & reserves)'],
                [4, '4 — Standard (Investments & flexible)']
              ].map(([val, label]) => `<option value="${val}" ${Number(bt?.priority || 2) === val ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field" data-bt-dueday ${['bill', 'loan'].includes(initialBehavior) ? '' : 'hidden'}>
          <span>Default due day of month (1–31, optional)</span>
          <input name="defaultDueDay" type="number" min="1" max="31" step="1" placeholder="No default due day" value="${bt?.defaultDueDay || ''}">
        </label>
        <label class="check" data-bt-surplus ${['bill', 'spending'].includes(initialBehavior) ? 'hidden' : ''}>
          <input name="allowSurplus" type="checkbox" ${(bt ? bt.allowSurplus : !['bill', 'spending'].includes(initialBehavior)) ? 'checked' : ''}>
          Allow buckets of this type to receive extra / surplus money
        </label>
        ${bt && members.length ? `
          <label class="check highlight-check">
            <input name="applyToExisting" type="checkbox" checked>
            Apply these rules to all ${members.length} existing bucket${members.length === 1 ? '' : 's'} in ${esc(bt.name)}
          </label>` : ''}
      </div>

      ${bt ? `
        <div class="transaction-tools">
          ${button(`Delete "${bt.name}" bucket type`, 'delete-bucket-type', `data-id="${esc(bt.id)}"`, 'small danger')}
        </div>` : ''}

      ${actions(bt ? 'Save bucket type rules' : 'Create bucket type')}
    </form>`,
    'Bucket types let you group buckets (like multiple Investments or Subscriptions) under shared rules.'
  );
}

function openQuickAddBucket(preferredTypeId) {
  const bts = bucketTypes();
  const initialBt = findBucketType(preferredTypeId) || bts.find(bt => bt.behavior === 'investment') || bts[0];
  const isFlex = initialBt?.kind === 'flex';

  modal(
    'Add a New Bucket',
    `<form data-form="quick-bucket" novalidate>
      <label class="field">
        <span>Bucket type</span>
        <select name="bucketTypeId" data-control="quick-bt">
          ${bts.map(bt => `<option value="${esc(bt.id)}" ${bt.id === initialBt?.id ? 'selected' : ''}>${esc(bt.icon)} ${esc(bt.name)} (${bt.kind === 'flex' ? '% of remaining salary' : 'Fixed ₹ / month'})</option>`).join('')}
        </select>
      </label>
      <div class="form-grid" style="grid-template-columns: 1fr 74px 84px">
        <label class="field">
          <span>Bucket name</span>
          <input name="name" maxlength="40" placeholder="e.g. PPF, Gold ETF, Broadband, Travel…" required>
        </label>
        <label class="field">
          <span>Icon</span>
          <input name="icon" value="${esc(initialBt?.icon || '🏷️')}" maxlength="4" required>
        </label>
        <label class="field">
          <span>Color</span>
          <input name="color" type="color" value="${esc(initialBt?.color || '#23735f')}">
        </label>
      </div>
      <div data-quick-target ${isFlex ? 'hidden' : ''}>
        ${amountField('Monthly planned amount', 'target', '', false, 'e.g. 5000')}
      </div>
      <div data-quick-percent ${isFlex ? '' : 'hidden'}>
        <label class="field">
          <span>Spending share (%) — other buckets will self-adjust to keep 100%</span>
          <div class="money-input"><span>%</span><input name="percent" type="number" min="0" max="100" step="1" value="10"></div>
        </label>
      </div>
      <div class="bt-rules-box">
        <span class="eyebrow">Bucket Rules (pre-filled from Bucket Type)</span>
        <label class="check">
          <input name="rollover" type="checkbox" ${initialBt?.defaultRollover ? 'checked' : ''}>
          Keep leftover cash for next month
        </label>
        ${amountField('Maximum bucket cap (optional)', 'cap', rupees(initialBt?.defaultCapPaise), false, 'No limit')}
        <label class="field" data-quick-dueday ${['bill', 'loan'].includes(initialBt?.behavior) ? '' : 'hidden'}>
          <span>Due day of month (1–31, optional)</span>
          <input name="dueDay" type="number" min="1" max="31" step="1" value="${initialBt?.defaultDueDay || ''}">
        </label>
      </div>
      ${actions('Add bucket to plan')}
    </form>`,
    'Create a new bucket inside any bucket type.'
  );
}

const txMapping = {
  expense: { kind: 'expense', direction: 'out' },
  income: { kind: 'income', direction: 'in' },
  transfer: { kind: 'transfer', direction: 'out' },
  refund: { kind: 'expense', direction: 'in' },
  withdraw: { kind: 'transfer', direction: 'in' }
};

const txType = t =>
  t.kind === 'income'
    ? 'income'
    : t.kind === 'transfer'
      ? (t.direction === 'in' ? 'withdraw' : 'transfer')
      : (t.direction === 'in' ? 'refund' : 'expense');

const txTypeDescriptions = {
  expense: 'Money spent from your bank on an everyday bucket or monthly bill.',
  income: 'Salary or other money received into your bank (adds to Unassigned cash).',
  transfer: 'Money paid out for a Loan EMI, transferred to an Investment bucket (SIP, PPF, etc.), or moved to Savings.',
  refund: 'Money refunded back into your bank and returned to a bill or spending bucket.',
  withdraw: 'Money withdrawn from an investment or savings bucket back into your bank.'
};

function openTransaction({ id, categoryId, income = false, adjustmentId } = {}) {
  const t = id ? app.data.transactions.find(t => t.id === id) : null;
  if (t?.kind === 'adjustment') {
    openCorrection(t);
    return;
  }
  const adjustment = adjustmentId ? app.data.transactions.find(t => t.id === adjustmentId) : null;
  const category = cat(t?.categoryId || categoryId);
  const initial = t
    ? txType(t)
    : income
      ? 'income'
      : category && ['saving', 'investment', 'loan'].includes(type(category))
        ? 'transfer'
        : 'expense';
  const activeType = adjustment?.direction === 'in' ? 'income' : initial;

  const typeOptions = [
    ['expense', 'Expense / Bill payment'],
    ['income', 'Income / Salary'],
    ['transfer', 'Investment / EMI / Savings transfer'],
    ['refund', 'Refund received'],
    ['withdraw', 'Withdrawal from goal']
  ].filter(([v]) => !adjustment || txMapping[v].direction === adjustment.direction);

  modal(
    t ? 'Edit transaction' : adjustment ? 'Identify balance difference' : 'Log bank transaction',
    `<form class="tx-form" data-form="tx" data-id="${id || ''}" data-adjustment="${adjustmentId || ''}" novalidate>
      <div class="tx-type-pills" role="group" aria-label="Transaction type">
        ${typeOptions.map(([v, l]) => `<button type="button" class="tx-pill ${v === activeType ? 'active' : ''}" data-action="tx-type" data-type="${v}">${l.split(' / ')[0]}</button>`).join('')}
      </div>
      <p class="tx-helper" data-tx-helper>${esc(txTypeDescriptions[activeType] || '')}</p>
      <div class="form-grid tx-top">
        <label class="field">
          <span>Transaction type</span>
          <select name="txType">
            ${typeOptions.map(([v, l]) => `<option value="${v}" ${v === activeType ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        ${amountField('Amount', 'amount', rupees(t?.amountPaise ?? adjustment?.amountPaise))}
      </div>
      <label class="field" data-field="category">
        <span data-category-label>Bucket</span>
        <select name="categoryId" data-selected="${esc(category?.id || '')}"></select>
      </label>
      <label class="field">
        <span>Description</span>
        <input name="description" value="${esc(t?.description || '')}" maxlength="120" placeholder="e.g. BigBasket groceries, Nifty 50 SIP, October rent…" required>
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Date money moved</span>
          <input name="date" type="date" value="${t?.date || today()}" min="${app.data.settings.openingDate || ''}" max="${today()}" required>
        </label>
        <label class="field">
          <span>Counts toward budget month</span>
          <input name="budgetPeriod" type="month" value="${t?.budgetPeriod || t?.date.slice(0, 7) || app.period}" required>
        </label>
      </div>
      <label class="check highlight-check" data-field="settled" hidden>
        <input name="settled" type="checkbox" ${!t || (app.data.billOverrides || []).some(b => b.categoryId === t.categoryId && b.period === (t.budgetPeriod || t.date.slice(0, 7)) && b.settled) ? 'checked' : ''}>
        Mark this month’s bill / EMI as fully paid (even if the amount differed from plan)
      </label>
      <p class="hint bucket-warning" data-warning hidden></p>
      <div class="hint bucket-warning" data-correction-match hidden></div>
      <details class="form-details" ${t?.notes ? 'open' : ''}>
        <summary>Add a note (optional)</summary>
        <input name="notes" value="${esc(t?.notes || '')}" maxlength="300" placeholder="Optional details…" aria-label="Note">
      </details>
      ${id ? `
        <div class="transaction-tools">
          ${button('Delete entry', 'delete-tx', `data-id="${id}"`, 'small danger')}
          ${t.direction === 'out' && t.kind === 'transfer' && !t.reversalOf ? button('Payment failed / returned', 'reverse', `data-id="${id}"`, 'small ghost') : ''}
        </div>` : ''}
      ${actions(adjustment ? 'Classify difference' : t ? 'Save changes' : 'Save transaction')}
    </form>`,
    adjustment ? 'Categorize this difference without changing your bank balance a second time.' : 'Record real money entering or leaving your bank account.'
  );
  updateTransactionFields();
}

function updateTransactionFields() {
  const f = $('[data-form=tx]');
  if (!f) return;
  const k = f.elements.txType.value;
  const select = f.elements.categoryId;
  const selected = select.value || select.dataset.selected;
  const allowed = app.data.categories.filter(c =>
    (!c.archived || c.id === selected) &&
    (['expense', 'refund'].includes(k)
      ? ['bill', 'spending'].includes(type(c))
      : ['saving', 'investment', 'loan'].includes(type(c)))
  );

  for (const pill of $$('.tx-pill', f)) {
    pill.classList.toggle('active', pill.dataset.type === k);
  }
  const helper = $('[data-tx-helper]', f);
  if (helper) helper.textContent = txTypeDescriptions[k] || '';

  const catLabel = $('[data-category-label]', f);
  if (catLabel) {
    catLabel.textContent = ['expense', 'refund'].includes(k)
      ? 'Which bill or everyday bucket?'
      : 'Which investment, savings, or loan bucket?';
  }

  $('[data-field=category]', f).hidden = k === 'income';
  select.required = k !== 'income';
  select.disabled = k === 'income';

  const groups = new Map();
  for (const c of allowed) {
    const btName = catBucketType(c)?.name || 'Buckets';
    if (!groups.has(btName)) groups.set(btName, []);
    groups.get(btName).push(c);
  }
  select.innerHTML = [...groups.entries()].map(([gName, items]) =>
    `<optgroup label="${esc(gName)}">${items.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)} (${money(c.balancePaise)} in bucket)</option>`).join('')}</optgroup>`
  ).join('');

  if (!allowed.some(c => c.id === selected)) {
    const preferred = k === 'transfer'
      ? allowed.find(c => type(c) === 'investment')
      : k === 'withdraw'
        ? allowed.find(c => type(c) === 'saving')
        : allowed.find(c => c.id === 'misc');
    if (preferred) select.value = preferred.id;
  }
  select.dataset.selected = select.value;
  const c = cat(select.value);
  const bill = c && ['bill', 'loan'].includes(type(c)) && txMapping[k].direction === 'out';
  $('[data-field=settled]', f).hidden = !bill;
  updateTransactionWarning();
}

function updateTransactionWarning() {
  const f = $('[data-form=tx]');
  if (!f) return;
  const c = cat(f.elements.categoryId.value);
  const k = f.elements.txType.value;
  const warning = $('[data-warning]', f);
  const amount = paise(f.elements.amount.value || 0);
  let balance = c?.balancePaise || 0;
  const old = app.data.transactions.find(t => t.id === f.dataset.id);
  if (old?.categoryId === c?.id) balance -= (old.direction === 'in' ? 1 : -1) * old.amountPaise;
  const gap = amount - balance;
  warning.hidden = !c || txMapping[k].direction === 'in' || k === 'income' || gap <= 0;
  warning.textContent = `Heads up: ${c?.name || 'This bucket'} only has ${money(balance)}, so it will be ${money(gap)} short. You can cover it afterwards using Move money.`;

  const match = $('[data-correction-match]', f);
  const correction = !f.dataset.id && !f.dataset.adjustment && app.data.transactions.find(t => t.kind === 'adjustment' && t.amountPaise === amount && t.direction === txMapping[k].direction);
  match.hidden = !correction;
  if (correction) {
    match.innerHTML = `This exact amount matches an unidentified balance correction. ${button('Use that correction instead', 'classify', `data-id="${correction.id}"`, 'small ghost')}`;
  }
}

function openCorrection(t) {
  modal(
    'Unidentified balance difference',
    `<p class="big-money">${t.direction === 'in' ? '+' : '−'}${money(t.amountPaise)}</p>
     <p class="hint">This entry was created when you matched your bank balance. If you now remember what transaction caused it, identify it below—your bank balance won’t be changed a second time.</p>
     <div class="settings-buttons">
       ${button('Identify what this transaction was', 'classify', `data-id="${t.id}"`, 'primary')}
       ${button('Delete this balance correction', 'delete-tx', `data-id="${t.id}"`, 'ghost')}
     </div>`
  );
}

function openFunding() {
  const d = app.data.derived;
  const p = d.fundingPreview;
  if (historical()) {
    toast('Choose this month or next month to fund.', true);
    return;
  }
  if (app.data.settings.planConfirmed === false) {
    navigate('plan');
    return;
  }
  if (p.legacy) {
    toast('Use Move money to adjust this existing budget.');
    return;
  }
  modal(
    d.allocation ? `Top up ${monthName(app.period)}` : `Fund ${monthName(app.period)} budget`,
    `<form data-form="fund" novalidate>
      <label class="field">
        <span>Which month are you funding?</span>
        <select data-control="fund-month">${monthOptions(app.period, true)}</select>
      </label>
      <div class="fund-summary">
        <div>
          <span>Unassigned cash in bank</span>
          <small>Available to pour into buckets</small>
        </div>
        <strong>${money(d.unallocatedPaise)}</strong>
      </div>
      ${p.shortfallPaise ? `<div class="bucket-warning">Your full monthly plan needs <strong>${money(p.shortfallPaise)}</strong> more than your current unassigned cash. Khaata will fund bills and essentials first—you can top up the rest later.</div>` : ''}
      ${p.error ? `<p class="negative">${esc(p.error)}</p>` : ''}
      <div class="fund-preview">
        <div class="fund-preview-head">
          <span>Bucket</span>
          <span>New balance after funding</span>
        </div>
        ${p.items.map(i => {
          const added = (i.afterPaise || 0) - (i.beforePaise || 0);
          return `
            <div>
              <span>${esc(i.name)} ${added > 0 ? `<em class="fund-added">+${money(added)}</em>` : ''}</span>
              <strong>${money(i.afterPaise)}</strong>
            </div>`;
        }).join('')}
      </div>
      <p class="fine">Funding divides your existing bank balance into buckets. Your total bank balance stays ${money(d.bankBalancePaise)}.</p>
      ${actions(d.allocation ? 'Top up buckets' : p.shortfallPaise ? 'Fund essentials with what I have' : `Fund ${monthName(app.period).split(' ')[0]} buckets`)}
    </form>`,
    'Pour your unassigned bank cash into your monthly buckets.'
  );
}

function openMove(toId) {
  const d = app.data.derived;
  const positives = active().filter(c => c.balancePaise > 0);
  const sources = [
    ...(d.unallocatedPaise > 0 ? [{ id: '', name: 'Unassigned cash', balancePaise: d.unallocatedPaise }] : []),
    ...positives.filter(c => type(c) === 'spending'),
    ...positives.filter(c => type(c) !== 'spending')
  ];
  if (!sources.length) {
    toast('No funded money is available to move.', true);
    return;
  }
  const target = cat(toId);
  const from = sources.find(c => c.id !== toId);
  const to = toId || (d.unallocatedPaise < 0 ? '' : active().find(c => c.balancePaise < 0 && c.id !== from?.id)?.id || active().find(c => c.id !== from?.id)?.id || '');

  modal(
    'Move money between buckets',
    `<form data-form="move" novalidate>
      <div class="form-grid">
        <label class="field">
          <span>Move from</span>
          <select name="from">
            ${sources.map(c => `<option value="${c.id}" ${c.id === from?.id ? 'selected' : ''}>${esc(c.name)} (${money(c.balancePaise)} available)</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Move to</span>
          <select name="to">
            <option value="" ${to === '' ? 'selected' : ''}>Unassigned cash</option>
            ${active().map(c => `<option value="${c.id}" ${c.id === to ? 'selected' : ''}>${esc(c.name)} (${money(c.balancePaise)})</option>`).join('')}
          </select>
        </label>
      </div>
      ${amountField('Amount to move', 'amount', target?.balancePaise < 0 ? rupees(Math.min(from?.balancePaise || 0, -target.balancePaise)) : '')}
      <p class="hint bucket-warning" data-move-warning hidden></p>
      <label class="field">
        <span>Note <em>optional</em></span>
        <input name="note" maxlength="160" placeholder="e.g. Covering extra grocery run">
      </label>
      ${actions('Move money')}
    </form>`,
    'Relabels money between buckets inside Khaata. Your real bank balance does not change.'
  );
  updateMoveWarning();
}

function updateMoveWarning() {
  const f = $('[data-form=move]');
  if (!f) return;
  const c = cat(f.elements.from.value);
  const amount = paise(f.elements.amount.value || 0);
  const warning = $('[data-move-warning]', f);
  warning.hidden = !c || type(c) === 'spending';
  warning.textContent = c
    ? `Note: ${c.name} is a fixed commitment. Moving this money leaves ${money(c.balancePaise - amount)} set aside for ${['bill', 'loan'].includes(type(c)) ? 'this payment' : type(c) === 'investment' ? 'investing' : 'your savings goal'}.`
    : '';
}

function openBucket(id) {
  const c = cat(id);
  const bt = catBucketType(c);
  const commitment = app.data.derived.commitments.find(i => i.categoryId === id);
  const row = app.data.derived.allocation?.items.find(i => i.categoryId === id && i.reason === 'target');
  const t = type(c);
  const bucketTxs = app.data.transactions
    .filter(tx => tx.categoryId === id && (tx.budgetPeriod || tx.date.slice(0, 7)) === app.period)
    .slice(0, 5);

  modal(
    `${c.icon || ''} ${c.name}`.trim(),
    `<div class="bucket-modal-summary">
       <div>
         <span class="eyebrow">${esc(bt.name)} · ${t === 'spending' ? 'Available in bucket' : 'Cash set aside in bucket'}</span>
         <p class="big-money ${c.balancePaise < 0 ? 'negative' : ''}">${money(c.balancePaise)}</p>
       </div>
       <div class="bucket-quick-actions">
         ${button(t === 'spending' ? '+ Log expense' : ['bill', 'loan'].includes(t) ? 'Pay bill / EMI' : 'Log transfer', 'expense', `data-id="${id}"`, 'primary small')}
         ${t === 'investment' ? button('Update worth', 'worth', `data-id="${id}"`, 'ghost small') : ''}
         ${button('⇄ Move money', 'move', `data-to="${id}"`, 'ghost small')}
       </div>
     </div>
     <dl class="kv">
       <div><dt>Bucket type</dt><dd>${esc(bt.icon)} ${esc(bt.name)}</dd></div>
       <div><dt>Monthly rule</dt><dd>${c.rollover ? 'Unused money rolls over to next month' : 'Resets every month'}</dd></div>
       ${c.capPaise != null ? `<div><dt>Maximum balance cap</dt><dd>${money(c.capPaise)}</dd></div>` : ''}
       ${row?.carryPaise ? `<div><dt>Carried from last month</dt><dd>${money(row.carryPaise)}</dd></div>` : ''}
     </dl>
     ${commitment && ['bill', 'loan'].includes(t) ? `
       <form class="bill-status-form" data-form="bill" data-id="${id}" novalidate>
         <h3>Bill status for ${monthName(app.period)}</h3>
         <div class="form-grid">
           <label class="field">
             <span>Bill month</span>
             <input name="period" type="month" value="${app.period}" required>
           </label>
           ${amountField('Actual bill / EMI amount', 'amount', rupees(commitment.targetPaise))}
         </div>
         <label class="check highlight-check">
           <input name="settled" type="checkbox" ${commitment.status === 'done' ? 'checked' : ''}>
           Mark as fully paid / already settled in opening balance
         </label>
         <p class="fine">Use this if a variable bill cost less than planned, or was already paid before you started using Khaata.</p>
         ${actions('Update bill status')}
       </form>` : ''}
     ${bucketTxs.length ? `
       <div class="bucket-tx-history">
         <span class="eyebrow">Entries in ${monthName(app.period)}</span>
         <div class="recent-list">
           ${bucketTxs.map(tx => `
             <button class="recent-row" type="button" data-action="edit" data-id="${tx.id}">
               <span class="recent-main">
                 <strong>${esc(tx.description)}</strong>
                 <small>${shortDate(tx.date)}</small>
               </span>
               <strong class="${tx.direction === 'in' ? 'positive' : ''}">${tx.direction === 'in' ? '+' : '−'}${money(tx.amountPaise)}</strong>
             </button>`).join('')}
         </div>
       </div>` : ''}`
  );
}

function openWorth(id) {
  const i = app.data.derived.investments.find(i => i.categoryId === id);
  const c = cat(id);
  const history = c.historyConfirmed ? (i.historyComplete ? (i.openingCostPaise ? 'existing' : 'new') : 'unknown') : '';
  modal(
    `Update ${i.name} value`,
    `<form data-form="worth" data-id="${id}" novalidate>
      ${amountField('Current market value of holdings', 'worth', rupees(i.worthPaise))}
      <details class="form-details" ${!c.historyConfirmed ? 'open' : ''}>
        <summary>Opening holdings history (set once)</summary>
        <label class="field">
          <span>Did you already hold investments in ${esc(i.name)} before starting Khaata?</span>
          <select name="history" required>
            <option value="" disabled ${!history ? 'selected' : ''}>Choose once</option>
            <option value="new" ${history === 'new' ? 'selected' : ''}>No — I started investing here with Khaata</option>
            <option value="existing" ${history === 'existing' ? 'selected' : ''}>Yes — I already held investments here</option>
            <option value="unknown" ${history === 'unknown' ? 'selected' : ''}>I’m not sure (hide gain/loss)</option>
          </select>
        </label>
        <div data-opening-cost ${history !== 'existing' ? 'hidden' : ''}>
          ${amountField('Original cost of those pre-existing holdings', 'cost', i.openingCostPaise ? rupees(i.openingCostPaise) : '', false)}
          <p class="fine">What you originally paid for holdings you already owned when starting Khaata. Leave blank if unknown.</p>
        </div>
      </details>
      ${actions('Save value')}
    </form>`,
    'Market worth is tracked per investment bucket, separate from the cash in your bank.'
  );
}

function openReconcile() {
  modal(
    'Match with your bank app',
    `<form data-form="reconcile" novalidate>
      <div class="fund-summary">
        <div>
          <span>Khaata’s recorded bank balance</span>
          <small>Based on your logged income &amp; expenses</small>
        </div>
        <strong>${money(app.data.derived.bankBalancePaise)}</strong>
      </div>
      ${amountField('Actual balance shown in your bank app right now', 'balance', rupees(app.data.derived.bankBalancePaise))}
      <p class="hint">If the numbers differ, Khaata will create a balance correction so your total matches reality immediately. You can identify what transaction caused the difference whenever you’re ready.</p>
      ${actions('Compare & match')}
    </form>`,
    'Keep Khaata in sync with your real bank account.'
  );
}

function help() {
  modal(
    'How Khaata works',
    `<div class="help-steps">
      <div class="help-step">
        <span>1</span>
        <div>
          <strong>Plan your bucket types &amp; buckets (Monthly Plan)</strong>
          <p>Use the standard bucket types (Bills, Loans, Savings, Investments, Everyday Spending) or add your own with custom rules. Add as many buckets as you need inside each type—like multiple SIPs under Investments. Everyday spending sliders self-adjust to keep 100%.</p>
        </div>
      </div>
      <div class="help-step">
        <span>2</span>
        <div>
          <strong>Fund the month on payday (Fund month)</strong>
          <p>Log your salary as Income, then click <strong>Fund month</strong>. Khaata pours your unassigned bank cash into your buckets—covering bills and high-priority bucket types first if cash is tight.</p>
        </div>
      </div>
      <div class="help-step">
        <span>3</span>
        <div>
          <strong>Spend &amp; adjust (This Month)</strong>
          <p>Log expenses as money leaves your bank. If a bucket runs low, use <strong>Move money</strong> to shift budget from another bucket without changing your bank balance.</p>
        </div>
      </div>
    </div>
    <details>
      <summary>Bucket types &amp; configurable rules</summary>
      <p>Every bucket type has configurable rules: how it is planned (Fixed ₹ vs Flexible %), whether unused cash rolls over to next month, default maximum cap, default due day, funding priority, and whether it can receive surplus money.</p>
    </details>
    <details>
      <summary>Multiple investment buckets</summary>
      <p>You can create separate buckets under Investments for each SIP, PPF, stock, or gold holding. Each investment bucket tracks its own reserved cash in your bank AND its own market worth and gain/loss.</p>
    </details>
    <details>
      <summary>Self-adjusting spending sliders</summary>
      <p>In Everyday Spending, dragging a slider or typing a percentage automatically rebalances the other unlocked spending buckets so the total is always 100%. Click the lock icon (🔒) on any row to hold its percentage fixed while adjusting others.</p>
    </details>
    <details>
      <summary>Log transaction vs. Move money</summary>
      <p><strong>Log expense / income / transfer</strong> records real money entering or leaving your bank account. <strong>Move money</strong> only rearranges labels between your virtual buckets—your bank balance stays untouched.</p>
    </details>`
  );
}

/* ------------------------------------------------------------------ */
/* Navigation & Event Listeners                                       */
/* ------------------------------------------------------------------ */

function navigate(view) {
  if (app.dirty && !confirm('Discard unsaved plan changes?')) return;
  app.dirty = false;
  close();
  app.view = view;
  location.hash = view;
  render();
  window.scrollTo(0, 0);
}

async function selectMonth(period) {
  if (app.dirty && !confirm('Discard unsaved plan changes?')) return;
  app.dirty = false;
  app.period = period;
  sessionStorage.setItem('khaata-month', period);
  await refresh();
}

async function handleAction(el) {
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'nav':
      navigate(el.dataset.view);
      break;
    case 'close':
      close();
      break;
    case 'this-month':
      await selectMonth(currentMonth());
      break;
    case 'filter-type':
      app.typeFilter = id || 'all';
      render();
      break;
    case 'open-bucket-type':
      openBucketType({ id, defaultKind: el.dataset.kind });
      break;
    case 'delete-bucket-type': {
      const bt = findBucketType(id);
      if (confirm(`Remove the "${bt?.name || 'selected'}" bucket type? Any empty buckets in it will be archived.`)) {
        await change(`/api/bucket-types/${id}`, undefined, 'DELETE');
        close();
        render();
        toast('Bucket type removed.');
      }
      break;
    }
    case 'quick-add-bucket':
      openQuickAddBucket(el.dataset.type);
      break;
    case 'expense':
      openTransaction({ categoryId: id });
      break;
    case 'income':
      openTransaction({ income: true });
      break;
    case 'tx-type': {
      const f = $('[data-form=tx]');
      if (f && f.elements.txType) {
        f.elements.txType.value = el.dataset.type;
        updateTransactionFields();
      }
      break;
    }
    case 'edit':
      openTransaction({ id });
      break;
    case 'classify':
      openTransaction({ adjustmentId: id });
      break;
    case 'fund':
      openFunding();
      break;
    case 'move':
      openMove(el.dataset.to);
      break;
    case 'bucket':
      openBucket(id);
      break;
    case 'worth':
      openWorth(id);
      break;
    case 'reconcile':
      openReconcile();
      break;
    case 'help':
      help();
      break;
    case 'add-row': {
      const btId = el.dataset.type;
      const bt = findBucketType(btId) || { id: btId, behavior: btId, kind: btId === 'spending' ? 'flex' : 'fixed', defaultRollover: ['saving', 'investment'].includes(btId), defaultCapPaise: null, defaultDueDay: null, icon: '🏷️', color: '#23735f' };
      const container = $(`[data-plan-type="${btId}"]`);
      const isFlex = bt.kind === 'flex' || bt.behavior === 'spending';
      const existingFlexCount = $$('.plan-line[data-kind="flex"]', $('#plan-form')).length;
      const initialPercent = isFlex ? (existingFlexCount === 0 ? 100 : Math.max(5, Math.round(100 / (existingFlexCount + 1)))) : 0;

      container.insertAdjacentHTML(
        'beforeend',
        planRow({
          type: bt.behavior,
          bucketTypeId: bt.id,
          kind: bt.kind,
          rollover: Boolean(bt.defaultRollover),
          balancePaise: 0,
          capPaise: bt.defaultCapPaise ?? null,
          dueDay: bt.defaultDueDay ?? null,
          percent: initialPercent,
          icon: bt.icon,
          color: bt.color
        })
      );
      const newRow = container.lastElementChild;
      if (isFlex) rebalancePercentages(newRow);
      app.dirty = true;
      updatePlanTotal();
      $('[name=name]', newRow)?.focus();
      break;
    }
    case 'lock-percent': {
      const row = el.closest('.plan-line');
      const locked = row.dataset.locked === 'true';
      row.dataset.locked = String(!locked);
      el.textContent = !locked ? '🔒' : '🔓';
      el.classList.toggle('is-locked', !locked);
      break;
    }
    case 'even-percents': {
      const f = $('#plan-form');
      if (!f) break;
      const flexRows = $$('.plan-line[data-kind="flex"]', f);
      const unlocked = flexRows.filter(r => r.dataset.locked !== 'true');
      if (!unlocked.length) break;
      const lockedSum = flexRows.filter(r => r.dataset.locked === 'true').reduce((n, r) => n + Number($('[name=percent]', r)?.value || 0), 0);
      const pool = Math.max(0, 100 - lockedSum);
      let running = 0;
      unlocked.forEach((row, idx) => {
        const val = idx === unlocked.length - 1 ? Math.max(0, Math.round((pool - running) * 100) / 100) : Math.round((pool / unlocked.length) * 2) / 2;
        running += val;
        if ($('[name=percent]', row)) $('[name=percent]', row).value = val;
        if ($('.percent-slider', row)) $('.percent-slider', row).value = val;
      });
      app.dirty = true;
      updatePlanTotal();
      break;
    }
    case 'row-options': {
      const details = el.closest('.plan-line').querySelector('details');
      details.open = !details.open;
      el.setAttribute('aria-expanded', String(details.open));
      break;
    }
    case 'remove-row': {
      const row = el.closest('.plan-line');
      const wasFlex = row.dataset.kind === 'flex';
      row.remove();
      if (wasFlex) rebalancePercentages();
      app.dirty = true;
      updatePlanTotal();
      break;
    }
    case 'delete-tx':
      if (confirm('Delete this entry and reverse its effect?')) {
        await change(`/api/transactions/${id}`, undefined, 'DELETE');
        close();
        render();
        toast('Entry deleted.');
      }
      break;
    case 'reverse':
      if (confirm('Record money returned from this failed payment?')) {
        await change(`/api/transactions/${id}/reverse`, {});
        close();
        render();
        toast('Payment reversed.');
      }
      break;
    case 'allocation-detail': {
      const a = app.data.allocations.find(a => a.id === id);
      modal(
        `Funded budget · ${monthName(a.period)}`,
        `<div class="fund-preview">
          <div class="fund-preview-head"><span>Bucket</span><span>Amount funded</span></div>
          ${a.items.filter(i => i.reason === 'target').map(i => `<div><span>${esc(cat(i.categoryId)?.name || 'Bucket')}</span><strong>${money(i.fundedPaise ?? i.deltaPaise)}</strong></div>`).join('')}
        </div>
        ${app.data.derived.allocation?.id === id && app.data.derived.allocation.canUndo
          ? button('Undo this funding', 'undo', `data-id="${id}"`)
          : '<p class="fine">Spending or moves have been recorded since this funding. Adjust buckets with Move money.</p>'}`
      );
      break;
    }
    case 'move-detail': {
      const m = app.data.moves.find(m => m.id === id);
      modal(
        'Bucket move',
        `<p class="eyebrow">${shortDate(m.date || m.createdAt.slice(0, 10))}</p>
         <p><strong>${esc(cat(m.fromCategoryId)?.name || 'Unassigned')}</strong> → <strong>${esc(cat(m.toCategoryId)?.name || 'Unassigned')}</strong></p>
         <p class="big-money">${money(m.amountPaise)}</p>
         ${m.note ? `<p class="hint">${esc(m.note)}</p>` : ''}
         <p class="fine">Moving money between buckets does not change your bank balance.</p>`
      );
      break;
    }
    case 'undo':
      if (confirm('Undo this month’s funding?')) {
        await change(`/api/allocations/${id}/undo`, {});
        close();
        render();
        toast('Funding undone.');
      }
      break;
    case 'demo':
      if (!app.data.derived.setupRequired && !confirm('Replace your data with an example? Download a backup first.')) return;
      await change('/api/setup', { mode: 'demo' });
      app.view = 'dashboard';
      app.period = currentMonth();
      close();
      await refresh();
      break;
    case 'reset':
      if (confirm('Erase all data? Download a backup first.')) {
        await change('/api/reset', {});
        app.period = currentMonth();
        sessionStorage.setItem('khaata-month', app.period);
        app.dirty = false;
        close();
        render();
      }
      break;
    case 'token':
      if (confirm('Replace the token? Existing automations will need the new one.')) {
        await change('/api/token', {});
        render();
        toast('Token replaced.');
      }
      break;
  }
}

document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]');
  if (!el) {
    if (event.target.classList.contains('modal-backdrop') && !app.busy) close();
    return;
  }
  if (app.busy) return;
  try {
    app.busy = true;
    await handleAction(el);
  } catch (error) {
    toast(error.message, true);
  } finally {
    app.busy = false;
  }
});

document.addEventListener('submit', async event => {
  const f = event.target;
  if (!f.matches('[data-form]')) return;
  event.preventDefault();
  if (app.busy) return;
  const submit = $('button[type=submit]', f) || $('button:not([type])', f);
  if (submit) submit.disabled = true;
  app.busy = true;
  try {
    const data = new FormData(f);
    const form = f.dataset.form;
    if (form === 'setup') {
      if (paise(data.get('income')) <= 0) throw new Error('Enter your expected monthly salary.');
      await change('/api/setup', {
        mode: 'fresh',
        monthlyIncomePaise: paise(data.get('income')),
        openingBalancePaise: paise(data.get('balance')),
        openingDate: data.get('openingDate')
      });
      app.period = currentMonth();
      sessionStorage.setItem('khaata-month', app.period);
      app.view = 'plan';
      location.hash = 'plan';
      render();
    } else if (form === 'plan') {
      await change('/api/plan', collectPlan(), 'PUT');
      app.dirty = false;
      app.view = 'dashboard';
      location.hash = 'dashboard';
      render();
      toast('Plan saved.');
    } else if (form === 'bucket-type') {
      const behavior = data.get('behavior');
      await change('/api/bucket-types', {
        id: f.dataset.id || undefined,
        name: data.get('name'),
        description: data.get('description'),
        icon: data.get('icon'),
        color: data.get('color'),
        behavior,
        defaultRollover: data.get('defaultRollover') === 'on',
        defaultCapPaise: data.get('defaultCap') === '' ? null : paise(data.get('defaultCap')),
        defaultDueDay: data.get('defaultDueDay') ? Number(data.get('defaultDueDay')) : null,
        priority: Number(data.get('priority') || 2),
        allowSurplus: data.get('allowSurplus') === 'on',
        applyToExisting: data.get('applyToExisting') === 'on'
      });
      close();
      render();
      toast('Bucket type saved.');
    } else if (form === 'quick-bucket') {
      const btId = data.get('bucketTypeId');
      const bt = findBucketType(btId);
      const isFlex = bt?.kind === 'flex' || bt?.behavior === 'spending';
      const name = String(data.get('name') || '').trim();
      if (!name) throw new Error('Enter a bucket name.');
      const currentCats = active().map(c => ({ ...c }));
      const newPercent = isFlex ? Math.max(0, Math.min(100, Number(data.get('percent') || 10))) : 0;

      if (isFlex) {
        const flexCats = currentCats.filter(c => c.kind === 'flex');
        if (!flexCats.length) {
          // Only flex bucket: must be 100%
        } else {
          const remainder = Math.max(0, 100 - newPercent);
          const oldSum = flexCats.reduce((n, c) => n + c.percent, 0);
          let running = 0;
          flexCats.forEach((c, idx) => {
            if (idx === flexCats.length - 1) {
              c.percent = Math.max(0, Math.round((remainder - running) * 100) / 100);
            } else {
              const nextP = oldSum > 0 ? Math.round(((c.percent / oldSum) * remainder) * 2) / 2 : Math.round((remainder / flexCats.length) * 2) / 2;
              c.percent = nextP;
              running += nextP;
            }
          });
        }
      }

      currentCats.push({
        kind: isFlex ? 'flex' : 'fixed',
        type: bt?.behavior || 'bill',
        bucketTypeId: bt?.id || btId,
        name,
        targetPaise: isFlex ? 0 : paise(data.get('target') || 0),
        percent: isFlex ? (currentCats.some(c => c.kind === 'flex') ? newPercent : 100) : 0,
        rollover: data.get('rollover') === 'on',
        capPaise: data.get('cap') === '' ? null : paise(data.get('cap')),
        dueDay: data.get('dueDay') ? Number(data.get('dueDay')) : null,
        icon: data.get('icon') || bt?.icon || '🏷️',
        color: data.get('color') || bt?.color || '#23735f'
      });

      await change('/api/plan', {
        monthlyIncomePaise: app.data.settings.monthlyIncomePaise,
        paydayDay: app.data.settings.paydayDay,
        surplusCategoryId: app.data.settings.surplusCategoryId,
        period: app.period,
        categories: currentCats
      }, 'PUT');
      close();
      render();
      toast(`Added "${name}" to ${bt?.name || 'your plan'}.`);
    } else if (form === 'tx') {
      const mapping = txMapping[data.get('txType')];
      const c = cat(data.get('categoryId'));
      const body = {
        ...mapping,
        amountPaise: paise(data.get('amount')),
        description: data.get('description'),
        date: data.get('date'),
        budgetPeriod: data.get('budgetPeriod'),
        categoryId: mapping.kind === 'income' ? null : data.get('categoryId'),
        notes: data.get('notes'),
        adjustmentId: f.dataset.adjustment || undefined
      };
      if (c && ['bill', 'loan'].includes(type(c)) && mapping.direction === 'out') {
        body.settleBill = data.get('settled') === 'on';
      }
      await change(f.dataset.id ? `/api/transactions/${f.dataset.id}` : '/api/transactions', body, f.dataset.id ? 'PUT' : 'POST');
      close();
      render();
      toast('Transaction saved.');
      if (!f.dataset.id && !f.dataset.adjustment && mapping.kind === 'income' && body.budgetPeriod >= currentMonth() && app.data.derived.periods.includes(body.budgetPeriod) && body.budgetPeriod !== app.period) {
        await selectMonth(body.budgetPeriod);
      }
      if (!f.dataset.id && mapping.kind === 'income' && (!app.data.derived.allocation || app.data.derived.allocation.remainingPaise > 0)) {
        openFunding();
      }
    } else if (form === 'fund') {
      await change('/api/allocate', {
        period: app.period,
        partial: Boolean(app.data.derived.allocation) || Boolean(app.data.derived.fundingPreview.shortfallPaise)
      });
      close();
      render();
      toast('Budget funded.');
    } else if (form === 'move') {
      await change('/api/move', {
        fromCategoryId: data.get('from') || null,
        toCategoryId: data.get('to') || null,
        amountPaise: paise(data.get('amount')),
        note: data.get('note'),
        period: app.period
      });
      close();
      render();
      toast('Money moved.');
    } else if (form === 'bill') {
      await change(`/api/bills/${f.dataset.id}`, {
        period: data.get('period'),
        amountPaise: paise(data.get('amount')),
        settled: data.get('settled') === 'on'
      });
      close();
      render();
      toast('Bill updated.');
    } else if (form === 'worth') {
      await change(`/api/investments/${f.dataset.id}/value`, {
        worthPaise: paise(data.get('worth')),
        openingCostPaise: data.get('history') === 'new' ? 0 : data.get('history') === 'existing' && data.get('cost') !== '' ? paise(data.get('cost')) : null
      });
      close();
      render();
      toast('Value updated.');
    } else if (form === 'reconcile') {
      const response = await change('/api/reconcile', { balancePaise: paise(data.get('balance')) });
      close();
      render();
      if (response.adjustment) openCorrection(response.adjustment);
      else toast('Your balances match.');
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    app.busy = false;
    if (submit?.isConnected) submit.disabled = false;
  }
});

document.addEventListener('input', event => {
  if (event.target.closest('#plan-form')) {
    const row = event.target.closest('.plan-line');
    if (row && (event.target.classList.contains('percent-slider') || event.target.name === 'percent')) {
      rebalancePercentages(row, event.target);
    }
    if (row && event.target.name === 'rowIcon') {
      row.dataset.icon = event.target.value.trim() || '🏷️';
      const iconEl = $('.plan-icon', row);
      if (iconEl) iconEl.textContent = row.dataset.icon;
    }
    if (row && event.target.name === 'rowColor') {
      row.dataset.color = event.target.value;
      const iconEl = $('.plan-icon', row);
      if (iconEl) iconEl.style.background = `${row.dataset.color}18`;
    }
    app.dirty = true;
    updatePlanTotal();
  }
  if (event.target.closest('[data-form=tx]')) updateTransactionWarning();
  if (event.target.closest('[data-form=move]')) updateMoveWarning();
  if (event.target.dataset.control === 'search') {
    app.search = event.target.value;
    filterActivity();
  }
});

document.addEventListener('change', async event => {
  try {
    if (event.target.dataset.control === 'month') await selectMonth(event.target.value);
    if (event.target.dataset.control === 'fund-month') {
      await selectMonth(event.target.value);
      openFunding();
    }
    if (event.target.dataset.control === 'filter') {
      app.filter = event.target.value;
      filterActivity();
    }
    if (event.target.dataset.control === 'quick-bt') {
      const f = event.target.closest('[data-form=quick-bucket]');
      const bt = findBucketType(event.target.value);
      if (f && bt) {
        const isFlex = bt.kind === 'flex' || bt.behavior === 'spending';
        $('[data-quick-target]', f).hidden = isFlex;
        $('[data-quick-percent]', f).hidden = !isFlex;
        $('[data-quick-dueday]', f).hidden = !['bill', 'loan'].includes(bt.behavior);
        f.elements.icon.value = bt.icon || '🏷️';
        f.elements.color.value = bt.color || '#23735f';
        f.elements.rollover.checked = Boolean(bt.defaultRollover);
        f.elements.cap.value = bt.defaultCapPaise != null ? rupees(bt.defaultCapPaise) : '';
      }
    }
    if (event.target.closest('[data-form=bucket-type]') && event.target.name === 'behavior') {
      const f = event.target.closest('[data-form=bucket-type]');
      const b = event.target.value;
      $('[data-bt-dueday]', f).hidden = !['bill', 'loan'].includes(b);
      $('[data-bt-surplus]', f).hidden = ['bill', 'spending'].includes(b);
      f.elements.defaultRollover.checked = ['saving', 'investment'].includes(b);
    }
    if (event.target.name === 'txType' || event.target.name === 'categoryId') updateTransactionFields();
    if (event.target.name === 'from') updateMoveWarning();
    if (event.target.name === 'history') {
      const field = $('[data-opening-cost]');
      if (field) field.hidden = event.target.value !== 'existing';
    }
    if (event.target.id === 'restore-file') {
      const file = event.target.files[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      if (confirm('Replace all current data with this backup?')) {
        await change('/api/restore', data);
        app.dirty = false;
        await refresh();
        toast('Backup restored.');
      }
    }
  } catch (error) {
    toast(error.message, true);
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && app.modal && !app.busy) close();
  if (event.key === 'Tab' && app.modal) {
    const nodes = $$('#modal-root button:not([disabled]), #modal-root input:not([disabled]), #modal-root select:not([disabled]), #modal-root summary').filter(el => el.getClientRects().length);
    const first = nodes[0];
    const last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      last?.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first?.focus();
      event.preventDefault();
    }
  }
});

window.addEventListener('beforeunload', event => {
  if (app.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (next === app.view) return;
  if (app.dirty && !confirm('Discard unsaved plan changes?')) {
    location.hash = app.view;
    return;
  }
  app.dirty = false;
  app.view = ['dashboard', 'plan', 'transactions', 'settings'].includes(next) ? next : 'dashboard';
  render();
});

setInterval(async () => {
  if (!app.data || app.modal || app.dirty || app.busy || document.visibilityState !== 'visible' || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const period = app.period;
  try {
    const response = await api('/api/state');
    if (app.period === period && JSON.stringify(response.state) !== JSON.stringify(app.data)) {
      app.data = response.state;
      render();
    }
  } catch {}
}, 30000);

async function init() {
  app.period = /^\d{4}-(0[1-9]|1[0-2])$/.test(app.period) ? app.period : currentMonth();
  try {
    await refresh();
  } catch (error) {
    $('#app').innerHTML = `<div class="setup"><div class="setup-card"><h1>Couldn’t load Khaata</h1><p>${esc(error.message)}</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`;
  }
}
init();

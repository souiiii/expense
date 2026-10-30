const app = { data: null, view: location.hash.slice(1) || 'dashboard', period: sessionStorage.getItem('khaata-month') || '', modal: false, busy: false, dirty: false, search: '', filter: 'all' };
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',maximumFractionDigits: Math.abs(n || 0) % 100 ? 2 : 0}).format((n || 0) / 100);
const paise = n => Math.round(Number(n) * 100);
const rupees = n => n == null ? '' : n / 100;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const monthName = p => new Date(`${p}-01T12:00:00`).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
const cat = id => app.data.categories.find(c => c.id === id);
const active = () => app.data.categories.filter(c => !c.archived);
const type = c => c.type || (c.kind === 'flex' ? 'spending' : 'bill');
const currentMonth = () => today().slice(0,7);
const historical = () => app.period < currentMonth();
const logo = `<span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="3" y="6" width="26" height="6" rx="3" fill="currentColor"/><rect x="3" y="15" width="19" height="6" rx="3" fill="currentColor" opacity=".6"/><rect x="3" y="24" width="23" height="5" rx="2" fill="currentColor" opacity=".3"/></svg></span>`;
const brand = () => `<div class="brand">${logo}<span>Khaata<span class="brand-dot">.</span></span></div>`;
const button = (label, action, attrs = '', style = 'ghost') => `<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;
const amountField = (label, name, value = '', required = true) => `<label class="field"><span>${label}</span><div class="money-input"><span>₹</span><input name="${name}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value)}" ${required ? 'required' : ''}/></div></label>`;
const monthOptions = (selected, fundingOnly = false) => [...new Set([...(app.data?.derived.periods || []), selected, currentMonth(), today().slice(0,7)])].filter(p => !fundingOnly || p >= currentMonth()).sort().reverse().map(p => `<option value="${p}" ${p===selected?'selected':''}>${monthName(p)}</option>`).join('');

async function api(path, {method = 'GET', body} = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const response = await fetch(`${path}${sep}period=${app.period}`, {method, headers: body === undefined ? {} : {'content-type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save. Try again.');
  if (data.state && (!data.state.derived?.safety || !data.state.derived?.fundingPreview)) {
    throw new Error('Khaata’s server is running an older version. Restart it with npm start, then reload this page.');
  }
  return data;
}
async function refresh() { app.data = (await api('/api/state')).state; render(); }
async function change(path, body, method = 'POST') {
  const response = await api(path,{method,body});
  if (response.state) app.data = response.state;
  return response;
}
function toast(message, error = false) {
  const node = document.createElement('div'); node.className = `toast ${error?'error':'ok'}`; node.textContent = message;
  $('#toast-root').append(node); setTimeout(() => node.remove(), error?6500:3500);
}
let previousFocus;
function modal(title, body) {
  previousFocus = document.activeElement; app.modal = true;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-action="close" aria-label="Close">×</button></div><div class="modal-body">${body}</div></section></div>`;
  document.body.classList.add('modal-open');
  setTimeout(() => ($('#modal-root .modal-body input:not([type=hidden]), #modal-root .modal-body select') || $('#modal-root button'))?.focus(), 0);
}
function close() { app.modal = false; $('#modal-root').innerHTML = ''; document.body.classList.remove('modal-open'); previousFocus?.focus(); }
const actions = (label='Save') => `<div class="modal-actions">${button('Cancel','close')}<button class="btn primary" type="submit">${label}</button></div>`;

function setupView() {
  return `<div class="setup"><div class="setup-card">${brand()}<p class="eyebrow">A little clarity for your money</p><h1>Make room<br>for what matters.</h1><p class="lede">Plan your salary. Spend with confidence.</p><form data-form="setup">${amountField('Expected monthly salary','income','')}${amountField('Bank balance now','balance','')}<label class="field"><span>Starting date</span><input name="openingDate" type="date" value="${today()}" max="${today()}" required></label><p class="fine">Only log new transactions after this balance.</p><button class="btn primary wide">Build my plan</button></form><div class="setup-alt">${button('Explore an example','demo','','ghost')}</div><p class="fine">Stored on this computer.</p></div></div>`;
}
function nav(view,label,icon) { return `<button class="nav-item ${app.view===view?'active':''}" data-action="nav" data-view="${view}" aria-current="${app.view===view?'page':'false'}"><span class="nav-symbol" aria-hidden="true">${icon}</span><span>${label}</span></button>`; }
function render() {
  if (!app.data) return;
  if (app.data.derived.setupRequired) { $('#app').innerHTML = setupView(); return; }
  const navs = nav('dashboard','Overview','◫')+nav('plan','Plan','≡')+nav('transactions','Activity','↔')+nav('settings','Settings','⚙');
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar">${brand()}<nav class="nav">${navs}</nav><div class="sidebar-foot">${button('How it works','help')}<p class="fine">Local & private</p></div></aside><main class="main"><header class="mobile-head">${brand()}${button('+ Expense','expense','','primary small')}</header><div class="view">${app.view==='plan'?planView():app.view==='transactions'?activityView():app.view==='settings'?settingsView():dashboardView()}</div></main><nav class="bottom-nav">${navs}</nav></div>`;
  if (app.view === 'plan') updatePlanTotal();
  if (app.view === 'transactions') filterActivity();
}
function pageHead(title, sub = '', action = '') { return `<div class="page-head"><div><p class="eyebrow">${esc(sub)}</p><h1>${title}</h1></div>${action}</div>`; }
function monthPicker() { return `<label class="month-picker"><span class="sr-only">Budget month</span><select data-control="month">${monthOptions(app.period)}</select></label>`; }
function stat(label,value) { return `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${money(value)}</strong></div>`; }
function notice() {
  const d=app.data.derived, s=d.safety;
  if (app.data.settings.planConfirmed === false) return `<div class="notice warn"><strong>Make this plan yours.</strong>${button('Review plan','nav','data-view="plan"','primary')}</div>`;
  if (historical()) return `<div class="notice quiet"><span>History for ${monthName(app.period)}</span>${button('Back to this month','this-month')}</div>`;
  if (s.uncoveredPaise > 0) return `<div class="notice danger"><strong>${money(s.uncoveredPaise)} of your buckets needs covering.</strong>${button('Cover shortage','move','','ghost')}</div>`;
  if (s.billGapPaise > 0 && d.allocation) return `<div class="notice warn"><strong>Bills need ${money(s.billGapPaise)} more.</strong>${button('Move money','move')}</div>`;
  if (!d.allocation) return `<div class="notice warn"><span>Your ${monthName(app.period).split(' ')[0]} budget is ready to fund.</span>${button('Fund month','fund','','primary')}</div>`;
  if (d.allocation.remainingPaise > 0) return `<div class="notice warn"><span>${money(d.allocation.remainingPaise)} of the plan is still unfunded.</span>${button('Top up','fund','','primary')}</div>`;
  if (d.unallocatedPaise > 0) return `<div class="notice quiet"><span>${money(d.unallocatedPaise)} is unassigned.</span>${button('Assign money','move')}</div>`;
  return '';
}
function dashboardView() {
  const d=app.data.derived, s=d.safety;
  const targets=new Map((d.allocation?.items || d.plan.items).filter(i=>i.reason!=='surplus').map(i=>[i.categoryId,i.targetPaise]));
  const commitments = new Map(d.commitments.map(c=>[c.categoryId,c]));
  return `${pageHead('Your money','Overview',monthPicker())}<section class="hero clean-hero"><div><p class="eyebrow light">${app.period>currentMonth()?'Planned spending':'Available to spend'}</p><h1 class="balance">${money(s.safeToSpendPaise)}</h1><p class="hero-sub">${historical()?'At month end':app.period>currentMonth()?`Reserved for ${monthName(app.period)}`:`${money(s.dailyPaise)} / day until payday · ${s.daysToPayday} days`}</p></div><div class="hero-actions">${button('+ Expense','expense','','primary light')}${button('+ Income','income','','hero-ghost')}</div><div class="bank-line">Bank balance <strong>${money(d.bankBalancePaise)}</strong>${s.futureReservedPaise?`<span class="future-reserve">${money(s.futureReservedPaise)} reserved for next month</span>`:''}</div></section>${notice()}<div class="stats">${stat('Reserved',s.reservedPaise)}${stat('Spent this month',d.summary.grossSpentPaise)}${stat('Unassigned',d.unallocatedPaise)}</div><section class="panel"><div class="panel-head"><h2>Bills & goals</h2>${button('Edit plan','nav','data-view="plan"','small ghost')}</div><div class="commitment-list">${active().filter(c=>type(c)!=='spending').map(c=>commitmentRow(c,commitments.get(c.id))).join('') || '<p class="empty">No fixed commitments.</p>'}</div></section><section class="spending-section"><div class="panel-head"><h2>Everyday spending</h2>${button('Move money','move','','small ghost')}</div><div class="envelope-grid">${active().filter(c=>type(c)==='spending').map(c=>spendingCard(c,targets.get(c.id)||0)).join('')}</div></section>${investmentView()}<div class="overview-bottom">${button('Check bank balance','reconcile')}${button('View activity','nav','data-view="transactions"')}</div>`;
}
function commitmentRow(c, commitment) {
  const t=type(c), status=commitment?.status, done=status==='done';
  let label = done ? (t==='investment'?'Invested':t==='saving'?'Saved':'Paid') : status==='at-goal'?'Goal reached': t==='saving'?`${money(commitment?.remainingPaise)} to save`:t==='investment'?`${money(commitment?.remainingPaise)} to invest`:`${money(commitment?.remainingPaise)} due`;
  if (commitment?.overduePaise) label += ` · ${money(commitment.overduePaise)} overdue`;
  if (!commitment?.targetPaise && status!=='done') label='No monthly target';
  const action=t==='bill'||t==='loan'?'Pay':t==='investment'?'Invest':'Transfer';
  return `<div class="commitment-row"><span class="env-icon sm" style="background:${esc(c.color)}16">${esc(c.icon)}</span><button class="row-name" data-action="bucket" data-id="${c.id}"><strong>${esc(c.name)}</strong><small class="${done||status==='at-goal'?'status-done':commitment?.overduePaise?'negative':''}">${done?'✓ ':''}${label}${commitment?.dueDate&&!done?` · ${new Date(`${commitment.dueDate}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}`:''}</small></button><div class="row-money"><strong>${money(c.balancePaise)}</strong><small>reserved</small></div>${button(action,'expense',`data-id="${c.id}"`,'small ghost')}</div>`;
}
function spendingCard(c,target) {
  const over=c.balancePaise<0;
  return `<article class="env-card ${over?'is-over':''}" style="--accent:${esc(c.color)}"><div class="env-head"><span class="env-icon sm" style="background:${esc(c.color)}16">${esc(c.icon)}</span><button class="row-name" data-action="bucket" data-id="${c.id}"><strong>${esc(c.name)}</strong></button><button class="icon-btn add" data-action="expense" data-id="${c.id}" aria-label="Add ${esc(c.name)} expense">+</button></div><div class="env-amount">${money(c.balancePaise)}</div><div class="env-target">${over?'Over budget':`${money(target)} monthly`}</div><div class="bar"><span style="width:${target?Math.min(100,Math.max(0,c.balancePaise/target*100)):0}%;background:${esc(c.color)}"></span></div>${over?button('Cover overspend','move',`data-to="${c.id}"`,'small ghost'):''}</article>`;
}
function investmentView() {
  const investments=app.data.derived.investments;
  if (!investments.length || historical()) return '';
  return `<details class="panel investment-details"><summary><strong>Investments</strong><span>${investments.length} holding${investments.length===1?'':'s'}</span></summary><div>${investments.map(i=>`<div class="investment-row"><div><strong>${esc(i.name)}${i.archived?' · paused':''}</strong><small>${i.worthStale?'Update value after the last movement':i.gainPaise==null?'Gain unavailable · opening history needed':`${i.gainPaise>=0?'+':''}${money(i.gainPaise)} gain / loss`}</small></div><strong>${i.worthPaise==null?'—':money(i.worthPaise)}</strong>${button('Update','worth',`data-id="${i.categoryId}"`,'small ghost')}</div>`).join('')}</div></details>`;
}
function planView() {
  const s=app.data.settings;
  return `${pageHead('Your monthly plan','Plan')}${s.planConfirmed===false?'<div class="notice warn">Review the amounts before funding your first month.</div>':''}<form data-form="plan" id="plan-form"><div class="plan-controls">${amountField('Expected take-home salary','income',rupees(s.monthlyIncomePaise))}<label class="field"><span>Payday</span><input name="payday" type="number" min="1" max="31" value="${s.paydayDay}" required></label></div><div id="plan-summary" class="plan-summary"></div>${[['bill','Bills'],['loan','Loans'],['saving','Savings'],['investment','Investments'],['spending','Everyday spending']].map(([t,label])=>`<section class="plan-section"><div class="plan-section-head"><h2>${label}</h2>${button('+ Add','add-row',`data-type="${t}"`,'small ghost')}</div><div data-plan-type="${t}">${active().filter(c=>type(c)===t).map(planRow).join('')}</div></section>`).join('')}<details class="panel plan-advanced"><summary>Extra money</summary><label class="field"><span>Send surplus to</span><select name="surplus"><option value="">Keep unassigned</option>${active().filter(c=>['saving','investment'].includes(type(c))).map(c=>`<option value="${c.id}" ${s.surplusCategoryId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></details><div class="plan-save"><p class="fine">Applies when you next fund a month. Existing budgets keep their plan.</p><button class="btn primary" type="submit">Save plan</button></div></form>`;
}
function planRow(c) {
  const optionsId=`options-${c.id||Math.random().toString(36).slice(2,9)}`;
  const t=type(c), fixed=t!=='spending', paid=(app.data.billOverrides||[]).some(b=>b.categoryId===c.id&&b.period===app.period&&b.settled);
  return `<div class="plan-line" data-cat="${esc(c.id||'')}" data-type="${t}" data-icon="${esc(c.icon||'🏷️')}" data-color="${esc(c.color||'#23735f')}"><div class="plan-line-main"><input name="name" value="${esc(c.name||'')}" placeholder="Name" maxlength="40" aria-label="Bucket name" required><div class="money-input"><span>${fixed?'₹':'%'}</span><input name="${fixed?'target':'percent'}" value="${fixed?rupees(c.targetPaise||0):c.percent||0}" type="number" min="0" ${fixed?'':'max="100"'} step="0.01" inputmode="decimal" aria-label="${fixed?'Monthly amount':'Spending share'}" required></div><button class="icon-btn" type="button" data-action="row-options" aria-controls="${optionsId}" aria-expanded="false" aria-label="Options for ${esc(c.name||'bucket')}">⋯</button></div><details id="${optionsId}"><summary hidden>Options</summary><div class="plan-options"><label class="check"><input name="rollover" type="checkbox" ${c.rollover?'checked':''}>Keep leftover</label>${amountField('Maximum balance','cap',rupees(c.capPaise),false)}${['bill','loan'].includes(t)?`<label class="field"><span>Due day</span><input name="dueDay" type="number" min="1" max="31" value="${c.dueDay||''}"></label>${app.data.settings.planConfirmed===false?`<label class="check"><input name="alreadyPaid" type="checkbox" ${paid?'checked':''}>Already paid this month</label>`:''}`:''}${button('Remove bucket','remove-row',c.balancePaise?'disabled title="Move the balance first"':'','small ghost')}</div></details></div>`;
}
function collectPlan() {
  const f=$('#plan-form');
  return {monthlyIncomePaise:paise(f.elements.income.value),paydayDay:Number(f.elements.payday.value),surplusCategoryId:f.elements.surplus.value||null,period:app.period,categories:$$('.plan-line',f).map(row=>({
    id:row.dataset.cat||undefined,kind:row.dataset.type==='spending'?'flex':'fixed',type:row.dataset.type,name:$('[name=name]',row).value.trim(),targetPaise:$('[name=target]',row)?paise($('[name=target]',row).value):0,percent:Number($('[name=percent]',row)?.value||0),rollover:$('[name=rollover]',row).checked,capPaise:$('[name=cap]',row).value===''?null:paise($('[name=cap]',row).value),dueDay:Number($('[name=dueDay]',row)?.value)||null,alreadyPaid:Boolean($('[name=alreadyPaid]',row)?.checked),icon:row.dataset.icon,color:row.dataset.color
  }))};
}
function updatePlanTotal() {
  const f=$('#plan-form'); if (!f) return;
  const p=collectPlan(), fixed=p.categories.reduce((n,c)=>n+c.targetPaise,0), share=p.categories.reduce((n,c)=>n+c.percent,0);
  const valid=p.monthlyIncomePaise>0&&fixed<=p.monthlyIncomePaise&&(!p.categories.some(c=>c.kind==='flex')||Math.abs(share-100)<0.001);
  $('#plan-summary').innerHTML=`<div class="plan-totals"><span>Fixed <strong>${money(fixed)}</strong></span><span>Spending <strong>${money(Math.max(0,p.monthlyIncomePaise-fixed))}</strong></span><span class="${valid?'':'negative'}">Shares <strong>${Number(share.toFixed(2))}%</strong></span></div>${!valid?'<p class="negative">Fixed amounts must fit your salary. Spending shares must total 100%.</p>':''}`;
  $('button[type=submit]',f).disabled=!valid;
}
function activityView() {
  const rows=[];
  for (const t of app.data.transactions.filter(t=>t.date.startsWith(app.period))) rows.push({key:`${t.date}${t.createdAt}`,date:t.date,label:t.description,detail:cat(t.categoryId)?.name|| (t.kind==='adjustment'?'Balance correction':'Income'),amount:(t.direction==='in'?1:-1)*t.amountPaise,kind:t.kind,id:t.id,action:'edit'});
  for (const m of app.data.moves.filter(m=>(m.date||m.createdAt).startsWith(app.period))) rows.push({key:`${m.date||m.createdAt.slice(0,10)}${m.createdAt}`,date:m.date||m.createdAt.slice(0,10),label:`${cat(m.fromCategoryId)?.name||'Unassigned'} → ${cat(m.toCategoryId)?.name||'Unassigned'}`,detail:m.note||'Budget move',amount:m.amountPaise,kind:'budget',id:m.id,action:'move-detail'});
  for (const a of app.data.allocations.filter(a=>a.period===app.period)) for (const f of a.fundings||[{date:a.createdAt.slice(0,10),createdAt:a.createdAt}]) rows.push({key:`${f.date}${f.createdAt}`,date:f.date,label:`Funded ${monthName(a.period)}`,detail:'Budget allocation',amount:null,kind:'budget',id:a.id,action:'allocation-detail'});
  rows.sort((a,b)=>b.key.localeCompare(a.key));
  return `${pageHead('Activity','History',monthPicker())}<div class="activity-tools"><input type="search" data-control="search" value="${esc(app.search)}" placeholder="Search activity" aria-label="Search activity"><select data-control="filter" aria-label="Activity type">${[['all','Everything'],['expense','Spending'],['income','Income'],['transfer','Investments & transfers'],['budget','Budget changes']].map(([v,l])=>`<option value="${v}" ${app.filter===v?'selected':''}>${l}</option>`).join('')}</select>${button('+ Add','expense','','primary')}</div><div class="panel activity-list">${rows.map(r=>`<button class="activity-row" data-action="${r.action}" data-id="${r.id}" data-kind="${r.kind}" data-search="${esc(`${r.label} ${r.detail}`.toLowerCase())}"><span class="activity-icon">${r.kind==='budget'?'↔':r.amount>0?'↙':'↗'}</span><span class="activity-description"><strong>${esc(r.label)}</strong><small>${new Date(`${r.date}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})} · ${esc(r.detail)}</small></span><strong class="${r.kind!=='budget'&&r.amount>0?'positive':''}">${r.amount==null?'—':`${r.kind==='budget'?'':r.amount>0?'+':'−'}${money(Math.abs(r.amount))}`}</strong></button>`).join('')}<div class="empty" id="activity-empty">No activity in this view.</div></div>`;
}
function filterActivity() {
  let count=0; for (const row of $$('.activity-row')) { row.hidden=!(app.filter==='all'||row.dataset.kind===app.filter)||!row.dataset.search.includes(app.search.toLowerCase()); if (!row.hidden) count++; }
  const empty=$('#activity-empty'); if(empty) empty.hidden=count>0;
}
function settingsView() {
  const s=app.data.settings;
  return `${pageHead('Settings','Your app')}<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>Your data</h2></div><div class="settings-buttons"><a class="btn ghost" href="/api/export">Download backup</a><label class="btn ghost">Restore backup<input id="restore-file" type="file" accept=".json" hidden></label>${button('Check bank balance','reconcile')}</div></section><section class="panel"><div class="panel-head"><h2>Need a hand?</h2></div>${button('How Khaata works','help')}</section><details class="panel"><summary>Automatic updates</summary><p class="hint">Optional local alert endpoint.</p><label class="field"><span>Endpoint</span><input readonly value="${esc(location.origin)}/api/ingest"></label><label class="field"><span>Token</span><input readonly value="${esc(s.ingestToken)}"></label>${button('Replace token','token')}</details><details class="panel"><summary>Start over</summary><div class="settings-buttons">${button('Load example','demo')}${button('Erase data','reset','','danger')}</div></details></div>`;
}

const txMapping={expense:{kind:'expense',direction:'out'},income:{kind:'income',direction:'in'},transfer:{kind:'transfer',direction:'out'},refund:{kind:'expense',direction:'in'},withdraw:{kind:'transfer',direction:'in'}};
const txType=t=>t.kind==='income'?'income':t.kind==='transfer'?(t.direction==='in'?'withdraw':'transfer'):(t.direction==='in'?'refund':'expense');
function openTransaction({id, categoryId, income=false, adjustmentId}={}) {
  const t=id?app.data.transactions.find(t=>t.id===id):null;
  if (t?.kind==='adjustment') { openCorrection(t); return; }
  const adjustment=adjustmentId?app.data.transactions.find(t=>t.id===adjustmentId):null;
  const category=cat(t?.categoryId||categoryId), initial=t?txType(t):income?'income':category&&['saving','investment','loan'].includes(type(category))?'transfer':'expense';
  modal(t?'Edit transaction':adjustment?'Identify balance difference':'Add transaction',`<form data-form="tx" data-id="${id||''}" data-adjustment="${adjustmentId||''}"><div class="form-grid"><label class="field"><span>Type</span><select name="txType">${[['expense','Expense'],['income','Income'],['transfer','Money moved out'],['refund','Refund'],['withdraw','Withdrawal']].filter(([v])=>!adjustment||txMapping[v].direction===adjustment.direction).map(([v,l])=>`<option value="${v}" ${v===(adjustment?.direction==='in'?'income':initial)?'selected':''}>${l}</option>`).join('')}</select></label>${amountField('Amount','amount',rupees(t?.amountPaise??adjustment?.amountPaise))}</div><label class="field"><span>Description</span><input name="description" value="${esc(t?.description||'')}" maxlength="120" placeholder="e.g. Groceries" required></label><label class="field" data-field="category"><span>Bucket</span><select name="categoryId" data-selected="${esc(category?.id||'')}"></select></label><div class="form-grid"><label class="field"><span>Date</span><input name="date" type="date" value="${t?.date||today()}" min="${app.data.settings.openingDate||''}" max="${today()}" required></label><label class="field"><span>Budget month</span><input name="budgetPeriod" type="month" value="${t?.budgetPeriod||t?.date.slice(0,7)||app.period}" required></label></div><label class="check" data-field="settled" hidden><input name="settled" type="checkbox" ${!t|| (app.data.billOverrides||[]).some(b=>b.categoryId===t.categoryId&&b.period===(t.budgetPeriod||t.date.slice(0,7))&&b.settled)?'checked':''}>This bill is fully paid</label><p class="hint bucket-warning" data-warning hidden></p><div class="hint bucket-warning" data-correction-match hidden></div><details class="form-details"><summary>Note</summary><input name="notes" value="${esc(t?.notes||'')}" maxlength="300" aria-label="Note"></details>${id?`<div class="transaction-tools">${button('Delete','delete-tx',`data-id="${id}"`,'small ghost')}${t.direction==='out'&&t.kind==='transfer'&&!t.reversalOf?button('Payment failed / returned','reverse',`data-id="${id}"`,'small ghost'):''}</div>`:''}${actions(adjustment?'Classify difference':t?'Save changes':'Save transaction')}</form>`);
  updateTransactionFields();
}
function updateTransactionFields() {
  const f=$('[data-form=tx]'); if(!f)return;
  const k=f.elements.txType.value, select=f.elements.categoryId;
  const selected=select.value||select.dataset.selected;
  const allowed=app.data.categories.filter(c=>(!c.archived||c.id===selected)&&(['expense','refund'].includes(k)?['bill','spending'].includes(type(c)):['saving','investment','loan'].includes(type(c))));
  $('[data-field=category]',f).hidden=k==='income'; select.required=k!=='income'; select.disabled=k==='income';
  select.innerHTML=allowed.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.name)} · ${money(c.balancePaise)}</option>`).join('');
  if (!allowed.some(c=>c.id===selected)) {
    const preferred=k==='transfer'?allowed.find(c=>type(c)==='investment'):k==='withdraw'?allowed.find(c=>type(c)==='saving'):allowed.find(c=>c.id==='misc');
    if(preferred)select.value=preferred.id;
  }
  select.dataset.selected=select.value;
  const c=cat(select.value), bill=c&&['bill','loan'].includes(type(c))&&txMapping[k].direction==='out';
  $('[data-field=settled]',f).hidden=!bill;
  updateTransactionWarning();
}
function updateTransactionWarning() {
  const f=$('[data-form=tx]');if(!f)return;
  const c=cat(f.elements.categoryId.value), k=f.elements.txType.value, warning=$('[data-warning]',f), amount=paise(f.elements.amount.value||0);
  let balance=c?.balancePaise||0;
  const old=app.data.transactions.find(t=>t.id===f.dataset.id);
  if(old?.categoryId===c?.id)balance-=(old.direction==='in'?1:-1)*old.amountPaise;
  const gap=amount-balance;
  warning.hidden=!c||txMapping[k].direction==='in'||k==='income'||gap<=0;
  warning.textContent=`${c?.name||'This bucket'} will be ${money(gap)} short. You can cover it with Move money.`;
  const match=$('[data-correction-match]',f);
  const correction=!f.dataset.id&&!f.dataset.adjustment&&app.data.transactions.find(t=>t.kind==='adjustment'&&t.amountPaise===amount&&t.direction===txMapping[k].direction);
  match.hidden=!correction;
  if(correction)match.innerHTML=`This amount matches an unidentified balance correction. ${button('Use that correction','classify',`data-id="${correction.id}"`,'small ghost')}`;
}
function openCorrection(t) {
  modal('Balance correction',`<p class="big-money">${t.direction==='in'?'+':'−'}${money(t.amountPaise)}</p><p class="hint">Identify this difference without changing your bank balance again.</p><div class="settings-buttons">${button('Identify transaction','classify',`data-id="${t.id}"`,'primary')}${button('Delete correction','delete-tx',`data-id="${t.id}"`,'ghost')}</div>`);
}
function openFunding() {
  const d=app.data.derived, p=d.fundingPreview;
  if (historical()) { toast('Choose this month or next month to fund.',true);return; }
  if(app.data.settings.planConfirmed===false){navigate('plan');return;}
  if(p.legacy){toast('Use Move money to adjust this existing budget.');return;}
  modal(d.allocation?'Top up month':'Fund month',`<form data-form="fund"><label class="field"><span>Budget month</span><select data-control="fund-month">${monthOptions(app.period, true)}</select></label><div class="fund-summary"><span>Unassigned</span><strong>${money(d.unallocatedPaise)}</strong></div>${p.shortfallPaise?`<p class="hint">The full plan needs ${money(p.shortfallPaise)} more. Essentials are funded first.</p>`:''}${p.error?`<p class="negative">${esc(p.error)}</p>`:''}<div class="fund-preview">${p.items.map(i=>`<div><span>${esc(i.name)}</span><strong>${money(i.afterPaise)}</strong></div>`).join('')}</div><p class="fine">Balances after funding. Your bank total stays the same.</p>${actions(d.allocation?'Top up':p.shortfallPaise?'Fund what I have':'Fund month')}</form>`);
}
function openMove(toId) {
  const d=app.data.derived, positives=active().filter(c=>c.balancePaise>0);
  const sources=[...(d.unallocatedPaise>0?[{id:'',name:'Unassigned',balancePaise:d.unallocatedPaise}]:[]),...positives.filter(c=>type(c)==='spending'),...positives.filter(c=>type(c)!=='spending')];
  if(!sources.length){toast('No funded money is available to move.',true);return;}
  const target=cat(toId), from=sources.find(c=>c.id!==toId), to=toId|| (d.unallocatedPaise<0?'':active().find(c=>c.balancePaise<0&&c.id!==from?.id)?.id||active().find(c=>c.id!==from?.id)?.id||'');
  modal('Move money',`<form data-form="move"><div class="form-grid"><label class="field"><span>From</span><select name="from">${sources.map(c=>`<option value="${c.id}" ${c.id===from?.id?'selected':''}>${esc(c.name)} · ${money(c.balancePaise)}</option>`).join('')}</select></label><label class="field"><span>To</span><select name="to"><option value="" ${to===''?'selected':''}>Unassigned</option>${active().map(c=>`<option value="${c.id}" ${c.id===to?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div>${amountField('Amount','amount',target?.balancePaise<0?rupees(Math.min(from?.balancePaise||0,-target.balancePaise)):'')}<p class="hint bucket-warning" data-move-warning hidden></p><label class="field"><span>Note <em>optional</em></span><input name="note" maxlength="160"></label>${actions('Move money')}</form>`);updateMoveWarning();
}
function updateMoveWarning() {
  const f=$('[data-form=move]');if(!f)return;const c=cat(f.elements.from.value), amount=paise(f.elements.amount.value||0), warning=$('[data-move-warning]',f);
  warning.hidden=!c||type(c)==='spending';
  warning.textContent=c?`${c.name} will have ${money(c.balancePaise-amount)} reserved. This reduces money set aside for ${['bill','loan'].includes(type(c))?'payments':type(c)==='investment'?'investing':'saving'}.`:'';
}
function openBucket(id) {
  const c=cat(id), commitment=app.data.derived.commitments.find(i=>i.categoryId===id);
  const row=app.data.derived.allocation?.items.find(i=>i.categoryId===id&&i.reason==='target');
  modal(c.name,`<p class="big-money">${money(c.balancePaise)}</p><dl class="kv"><div><dt>Leftover</dt><dd>${c.rollover?'Kept next month':'Unused money is released next month'}</dd></div>${c.capPaise!=null?`<div><dt>Maximum</dt><dd>${money(c.capPaise)}</dd></div>`:''}${row?.carryPaise?`<div><dt>Carried forward</dt><dd>${money(row.carryPaise)}</dd></div>`:''}</dl>${commitment&&['bill','loan'].includes(type(c))?`<form data-form="bill" data-id="${id}"><div class="form-grid"><label class="field"><span>Bill month</span><input name="period" type="month" value="${app.period}" required></label>${amountField('Actual bill / EMI','amount',rupees(commitment.targetPaise))}</div><label class="check"><input name="settled" type="checkbox" ${commitment.status==='done'?'checked':''}>Fully paid / already included in opening balance</label><p class="fine">Updates the bill status. Log new payments as transactions.</p>${actions('Update bill')}</form>`:button('Move money','move',`data-to="${id}"`)} `);
}
function openWorth(id) {
  const i=app.data.derived.investments.find(i=>i.categoryId===id), c=cat(id);
  const history=c.historyConfirmed?(i.historyComplete?(i.openingCostPaise?'existing':'new'):'unknown'):'';
  modal(`Update ${i.name}`,`<form data-form="worth" data-id="${id}">${amountField('Current value','worth',rupees(i.worthPaise))}<details class="form-details" ${!c.historyConfirmed?'open':''}><summary>Opening history</summary><label class="field"><span>Before using Khaata</span><select name="history" required><option value="" disabled ${!history?'selected':''}>Choose once</option><option value="new" ${history==='new'?'selected':''}>I had no investments here</option><option value="existing" ${history==='existing'?'selected':''}>I already held investments</option><option value="unknown" ${history==='unknown'?'selected':''}>I'm not sure</option></select></label><div data-opening-cost ${history!=='existing'?'hidden':''}>${amountField('Cost of opening holdings','cost',i.openingCostPaise?rupees(i.openingCostPaise):'',false)}<p class="fine">What you paid for holdings you owned when you started. Leave blank if unknown.</p></div></details>${actions('Save value')}</form>`);
}

function openReconcile() {
  modal('Check bank balance',`<form data-form="reconcile">${amountField('Balance in your bank app','balance',rupees(app.data.derived.bankBalancePaise))}<p class="hint">A difference stays unidentified until you classify it.</p>${actions('Compare & match')}</form>`);
}
function help() {
  modal('How Khaata works',`<div class="help-steps"><div class="help-step"><span>1</span><div><strong>Make a plan</strong><p>Set bills and goals, then split the rest across spending.</p></div></div><div class="help-step"><span>2</span><div><strong>Fund a month</strong><p>Log salary, choose the month it supports, and fund it. Smaller salaries can fund essentials first.</p></div></div><div class="help-step"><span>3</span><div><strong>Log money as it moves</strong><p>Record expenses, investments and refunds. A budget move changes labels; it never changes your bank total.</p></div></div></div><details><summary>Available to spend</summary><p>Your funded spending money after protecting bills and goals. A negative bucket still needs covering.</p></details><details><summary>Starting midway through a month</summary><p>The opening balance already includes older transactions. Mark bills already paid under Plan options or the bill details. Only log money that moves after your starting date.</p></details><details><summary>Correcting missing entries</summary><p>If you matched your bank balance earlier, identify that correction from Activity. This avoids counting the same money twice.</p></details><details><summary>Bills and leftovers</summary><p>Unpaid bills stay due next month. Mark a variable bill fully paid when settled, even if it cost less than planned. Spending overshoots carry forward.</p></details><details><summary>Investments</summary><p>Reserved cash is separate from the value of your holdings. Update values manually. For failed payments, use Payment failed / returned. Pause a SIP by setting its monthly amount to zero.</p></details>`);
}
function navigate(view) {
  if(app.dirty&&!confirm('Discard unsaved plan changes?'))return;
  app.dirty=false;close();app.view=view;location.hash=view;render();window.scrollTo(0,0);
}
async function selectMonth(period) { if(app.dirty&&!confirm('Discard unsaved plan changes?'))return;app.dirty=false;app.period=period;sessionStorage.setItem('khaata-month',period);await refresh(); }
async function handleAction(el) {
  const id=el.dataset.id;
  switch(el.dataset.action) {
    case 'nav':navigate(el.dataset.view);break;
    case 'close':close();break;
    case 'this-month':await selectMonth(currentMonth());break;
    case 'expense':openTransaction({categoryId:id});break;
    case 'income':openTransaction({income:true});break;
    case 'edit':openTransaction({id});break;
    case 'classify':openTransaction({adjustmentId:id});break;
    case 'fund':openFunding();break;
    case 'move':openMove(el.dataset.to);break;
    case 'bucket':openBucket(id);break;
    case 'worth':openWorth(id);break;
    case 'reconcile':openReconcile();break;
    case 'help':help();break;
    case 'add-row': {
      const t=el.dataset.type; $(`[data-plan-type="${t}"]`).insertAdjacentHTML('beforeend',planRow({type:t,rollover:['saving','investment'].includes(t),balancePaise:0,capPaise:null}));app.dirty=true;updatePlanTotal();break;
    }
    case 'row-options':{const details=el.closest('.plan-line').querySelector('details');details.open=!details.open;el.setAttribute('aria-expanded',String(details.open));break;}
    case 'remove-row':el.closest('.plan-line').remove();app.dirty=true;updatePlanTotal();break;
    case 'delete-tx':if(confirm('Delete this entry and reverse its effect?')){await change(`/api/transactions/${id}`,undefined,'DELETE');close();render();toast('Entry deleted.');}break;
    case 'reverse':if(confirm('Record money returned from this failed payment?')){await change(`/api/transactions/${id}/reverse`,{});close();render();toast('Payment reversed.');}break;
    case 'allocation-detail': {
      const a=app.data.allocations.find(a=>a.id===id);
      modal(`Budget · ${monthName(a.period)}`,`<div class="fund-preview">${a.items.filter(i=>i.reason==='target').map(i=>`<div><span>${esc(cat(i.categoryId)?.name||'Bucket')}</span><strong>${money(i.fundedPaise??i.deltaPaise)}</strong></div>`).join('')}</div>${app.data.derived.allocation?.id===id&&app.data.derived.allocation.canUndo?button('Undo funding','undo',`data-id="${id}"`):'<p class="fine">Adjust this budget with Move money.</p>'}`);break;
    }
    case 'move-detail': {
      const m=app.data.moves.find(m=>m.id===id);modal('Budget move',`<p>${esc(cat(m.fromCategoryId)?.name||'Unassigned')} → ${esc(cat(m.toCategoryId)?.name||'Unassigned')}</p><p class="big-money">${money(m.amountPaise)}</p><p>${esc(m.note)}</p>`);break;
    }
    case 'undo':if(confirm('Undo this month’s funding?')){await change(`/api/allocations/${id}/undo`,{});close();render();toast('Funding undone.');}break;
    case 'demo':if(!app.data.derived.setupRequired&&!confirm('Replace your data with an example? Download a backup first.'))return;await change('/api/setup',{mode:'demo'});app.view='dashboard';app.period=currentMonth();close();await refresh();break;
    case 'reset':if(confirm('Erase all data? Download a backup first.')){await change('/api/reset',{});app.period=currentMonth();sessionStorage.setItem('khaata-month',app.period);app.dirty=false;close();render();}break;
    case 'token':if(confirm('Replace the token? Existing automations will need the new one.')){await change('/api/token',{});render();toast('Token replaced.');}break;
  }
}
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');
  if(!el){if(event.target.classList.contains('modal-backdrop')&&!app.busy)close();return;}
  if(app.busy)return;
  try {app.busy=true;await handleAction(el);}catch(error){toast(error.message,true);}finally{app.busy=false;}
});
document.addEventListener('submit',async event=>{
  const f=event.target;if(!f.matches('[data-form]'))return;event.preventDefault();if(app.busy)return;
  const submit=$('button[type=submit]',f)||$('button:not([type])',f);if(submit)submit.disabled=true;
  app.busy=true;
  try {
    const data=new FormData(f), form=f.dataset.form;
    if(form==='setup'){
      if(paise(data.get('income'))<=0)throw new Error('Enter your expected monthly salary.');
      await change('/api/setup',{mode:'fresh',monthlyIncomePaise:paise(data.get('income')),openingBalancePaise:paise(data.get('balance')),openingDate:data.get('openingDate')});app.period=currentMonth();sessionStorage.setItem('khaata-month',app.period);app.view='plan';location.hash='plan';render();
    } else if(form==='plan'){
      await change('/api/plan',collectPlan(),'PUT');app.dirty=false;app.view='dashboard';location.hash='dashboard';render();toast('Plan saved.');
    } else if(form==='tx'){
      const mapping=txMapping[data.get('txType')], c=cat(data.get('categoryId'));
      const body={...mapping,amountPaise:paise(data.get('amount')),description:data.get('description'),date:data.get('date'),budgetPeriod:data.get('budgetPeriod'),categoryId:mapping.kind==='income'?null:data.get('categoryId'),notes:data.get('notes'),adjustmentId:f.dataset.adjustment||undefined};
      if(c&&['bill','loan'].includes(type(c))&&mapping.direction==='out')body.settleBill=data.get('settled')==='on';
      const response=await change(f.dataset.id?`/api/transactions/${f.dataset.id}`:'/api/transactions',body,f.dataset.id?'PUT':'POST');
      close();render();toast('Transaction saved.');
      if(!f.dataset.id&&!f.dataset.adjustment&&mapping.kind==='income'&&body.budgetPeriod>=currentMonth()&&app.data.derived.periods.includes(body.budgetPeriod)&&body.budgetPeriod!==app.period)await selectMonth(body.budgetPeriod);
      if(!f.dataset.id&&mapping.kind==='income'&&(!app.data.derived.allocation||app.data.derived.allocation.remainingPaise>0))openFunding();
    } else if(form==='fund'){
      await change('/api/allocate',{period:app.period,partial:Boolean(app.data.derived.allocation)||Boolean(app.data.derived.fundingPreview.shortfallPaise)});close();render();toast('Budget funded.');
    } else if(form==='move'){
      await change('/api/move',{fromCategoryId:data.get('from')||null,toCategoryId:data.get('to')||null,amountPaise:paise(data.get('amount')),note:data.get('note'),period:app.period});close();render();toast('Money moved.');
    } else if(form==='bill'){
      await change(`/api/bills/${f.dataset.id}`,{period:data.get('period'),amountPaise:paise(data.get('amount')),settled:data.get('settled')==='on'});close();render();toast('Bill updated.');
    } else if(form==='worth'){
      await change(`/api/investments/${f.dataset.id}/value`,{worthPaise:paise(data.get('worth')),openingCostPaise:data.get('history')==='new'?0:data.get('history')==='existing'&&data.get('cost')!==''?paise(data.get('cost')):null});close();render();toast('Value updated.');
    } else if(form==='reconcile'){
      const response=await change('/api/reconcile',{balancePaise:paise(data.get('balance'))});close();render();if(response.adjustment)openCorrection(response.adjustment);else toast('Your balances match.');
    }
  }catch(error){toast(error.message,true);}finally{app.busy=false;if(submit?.isConnected)submit.disabled=false;}
});
document.addEventListener('input',event=>{
  if(event.target.closest('#plan-form')){app.dirty=true;updatePlanTotal();}
  if(event.target.closest('[data-form=tx]'))updateTransactionWarning();
  if(event.target.closest('[data-form=move]'))updateMoveWarning();
  if(event.target.dataset.control==='search'){app.search=event.target.value;filterActivity();}
});
document.addEventListener('change',async event=>{
  try {
    if(event.target.dataset.control==='month')await selectMonth(event.target.value);
    if(event.target.dataset.control==='fund-month'){await selectMonth(event.target.value);openFunding();}
    if(event.target.dataset.control==='filter'){app.filter=event.target.value;filterActivity();}
    if(event.target.name==='txType'||event.target.name==='categoryId')updateTransactionFields();
    if(event.target.name==='from')updateMoveWarning();
    if(event.target.name==='history'){const field=$('[data-opening-cost]');if(field)field.hidden=event.target.value!=='existing';}
    if(event.target.id==='restore-file'){
      const file=event.target.files[0];if(!file)return;const data=JSON.parse(await file.text());
      if(confirm('Replace all current data with this backup?')){await change('/api/restore',data);app.dirty=false;await refresh();toast('Backup restored.');}
    }
  }catch(error){toast(error.message,true);}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&app.modal&&!app.busy)close();
  if(event.key==='Tab'&&app.modal){const nodes=$$('#modal-root button:not([disabled]), #modal-root input:not([disabled]), #modal-root select:not([disabled]), #modal-root summary').filter(el=>el.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){last?.focus();event.preventDefault();}else if(!event.shiftKey&&document.activeElement===last){first?.focus();event.preventDefault();}}
});
window.addEventListener('beforeunload',event=>{if(app.dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(next===app.view)return;if(app.dirty&&!confirm('Discard unsaved plan changes?')){location.hash=app.view;return;}app.dirty=false;app.view=['dashboard','plan','transactions','settings'].includes(next)?next:'dashboard';render();});
setInterval(async()=>{if(!app.data||app.modal||app.dirty||app.busy||document.visibilityState!=='visible'||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;const period=app.period;try{const response=await api('/api/state');if(app.period===period&&JSON.stringify(response.state)!==JSON.stringify(app.data)){app.data=response.state;render();}}catch{}},30000);
async function init(){app.period=/^\d{4}-(0[1-9]|1[0-2])$/.test(app.period)?app.period:currentMonth();try{await refresh();}catch(error){$('#app').innerHTML=`<div class="setup"><div class="setup-card"><h1>Couldn’t load Khaata</h1><p>${esc(error.message)}</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`;}}
init();

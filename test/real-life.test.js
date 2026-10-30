import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../lib/seed.js';
import {scheduledAmount, replayBudgets} from '../lib/budget.js';
import {
  addTransaction, allocateMonth, clientState, computeBankBalance, computePlan, computeUnallocated,
  deleteTransaction, externalSavings, investmentSummaries, investmentTotals, moneySafety, monthlyCommitments,
  moveBetweenEnvelopes, reversePayment, saveBucketType, savePlan, settleBill, updateInvestmentHistory,
  updateInvestmentValue, updateSavingOpening, updateTransaction,
} from '../lib/domain.js';

// These scenarios cross a month boundary; keep them independent of the test runner's date.
test.beforeEach(t => t.mock.timers.enable({apis: ['Date'], now: new Date('2026-10-30T12:00:00+05:30')}));
const P = n => Math.round(n * 100);
const make = (opening = 100000) => createState({monthlyIncomePaise: P(100000), openingBalancePaise: P(opening), onboarded: true});
const cat = (s,id) => s.categories.find(c => c.id === id);
const plan = s => ({monthlyIncomePaise: s.settings.monthlyIncomePaise, paydayDay: s.settings.paydayDay,
  surplusCategoryId: s.settings.surplusCategoryId, categories: s.categories.filter(c => !c.archived).map(c => ({...c}))});
const tx = (s,id,n,extra = {}) => addTransaction(s,{date:'2026-10-30',description:'Real-life scenario',
  amountPaise:P(n),categoryId:id,direction:'out',kind:['invest','emergency','loan'].includes(id)?'transfer':'expense',...extra});
const commitment = (s,id,period='2026-10') => monthlyCommitments(s,period).find(c => c.categoryId === id);
function rentState() {
  const s=make(20000);s.settings.monthlyIncomePaise=P(20000);s.settings.paydayDay=5;s.settings.surplusCategoryId=null;
  s.categories=s.categories.filter(c=>['rent','fun'].includes(c.id));
  Object.assign(cat(s,'rent'),{targetPaise:P(8000),dueDay:1});cat(s,'fun').percent=100;
  allocateMonth(s,'2026-10');tx(s,'rent',8000);
  return s;
}

test('safe spending protects next month rent before payday and releases it when paid early',()=>{
  const s=rentState();let safety=moneySafety(s,'2026-10');
  assert.equal(safety.nextPayday,'2026-11-05');assert.equal(safety.safeToSpendPaise,P(4000));
  assert.equal(safety.upcomingBillGapPaise,P(8000));assert.equal(safety.dailyPaise,Math.floor(P(4000)/6));
  tx(s,'rent',8000,{budgetPeriod:'2026-11'});safety=moneySafety(s,'2026-10');
  assert.equal(safety.upcomingBillGapPaise,0);assert.equal(safety.safeToSpendPaise,P(4000));
});

test('future funding, current extra reserves and later due dates are not protected twice',()=>{
  const s=rentState();tx(s,null,20000,{kind:'income',direction:'in'});allocateMonth(s,'2026-11');
  assert.equal(moneySafety(s,'2026-10').safeToSpendPaise,P(12000));
  assert.equal(moneySafety(s,'2026-10').upcomingBillGapPaise,0);
  const held=rentState();moveBetweenEnvelopes(held,{fromCategoryId:'fun',toCategoryId:'rent',amountPaise:P(8000)});
  assert.equal(moneySafety(held,'2026-10').safeToSpendPaise,P(4000));
  assert.equal(moneySafety(held,'2026-10').upcomingBillGapPaise,0);
  const later=rentState();const p=plan(later);p.categories.find(c=>c.id==='rent').dueDay=10;savePlan(later,p);
  assert.equal(moneySafety(later,'2026-10').safeToSpendPaise,P(12000));
});

test('partial payments keep the actual bill amount until settlement is explicit',()=>{
  const s=make();allocateMonth(s,'2026-10');settleBill(s,'rent',{amountPaise:P(22000),settled:false});
  tx(s,'rent',5000);settleBill(s,'rent',{settled:false});
  assert.equal(commitment(s,'rent').targetPaise,P(22000));assert.equal(commitment(s,'rent').remainingPaise,P(17000));
  settleBill(s,'rent',{amountPaise:P(5000),settled:true});assert.equal(commitment(s,'rent').status,'done');
});

test('changing a used bucket type is rejected without rewriting transfers or holdings',()=>{
  const s=make();allocateMonth(s,'2026-10');tx(s,'invest',15000);updateInvestmentHistory(s,'invest',0);updateInvestmentValue(s,'invest',P(16000));
  const before=structuredClone(s);
  assert.throws(()=>saveBucketType(s,{id:'investment',name:'Investments',behavior:'spending'}),{code:'TYPE_HAS_HISTORY'});
  assert.deepEqual(s,before);assert.equal(investmentSummaries(s)[0].gainPaise,P(1000));
});

test('an immediate new bill is due now and can be topped up without changing old funding',()=>{
  const s=make();allocateMonth(s,'2026-10');const before=s.categories.map(c=>c.balancePaise);
  const p=plan(s);p.categories.push({name:'Broadband',type:'bill',kind:'fixed',targetPaise:P(1000),startPeriod:'2026-10',dueDay:31});
  savePlan(s,p);const bill=s.categories.find(c=>c.name==='Broadband');
  assert.deepEqual(s.categories.slice(0,before.length).map(c=>c.balancePaise),before);
  assert.equal(commitment(s,bill.id).remainingPaise,P(1000));assert.equal(commitment(s,bill.id).fundingGapPaise,P(1000));
  tx(s,null,1000,{kind:'income',direction:'in'});allocateMonth(s,'2026-10',{partial:true});
  assert.equal(cat(s,bill.id).balancePaise,P(1000));assert.equal(s.allocations[0].remainingPaise,0);
});

test('moving money into a new bill satisfies funding without requesting it again',()=>{
  const s=make();allocateMonth(s,'2026-10');const p=plan(s);
  p.categories.push({name:'Broadband',type:'bill',kind:'fixed',targetPaise:P(1000),startPeriod:'2026-10'});savePlan(s,p);
  const bill=s.categories.find(c=>c.name==='Broadband');
  moveBetweenEnvelopes(s,{fromCategoryId:'fun',toCategoryId:bill.id,amountPaise:P(1000)});
  assert.equal(s.allocations[0].remainingPaise,0);assert.equal(commitment(s,bill.id).fundingGapPaise,0);
});

test('a bill starting next month creates no current obligation',()=>{
  const s=make();allocateMonth(s,'2026-10');const p=plan(s);
  p.categories.push({name:'Broadband',type:'bill',kind:'fixed',targetPaise:P(1000),startPeriod:'2026-11'});savePlan(s,p);
  const id=s.categories.find(c=>c.name==='Broadband').id;
  assert.equal(commitment(s,id).remainingPaise,0);assert.equal(commitment(s,id,'2026-11').remainingPaise,P(1000));
});

test('custom essential priorities and per-bucket overrides survive later type edits',()=>{
  const s=make(1000);const p=plan(s);
  p.categories.find(c=>c.id==='rent').priority=2;p.categories.find(c=>c.id==='loan').priority=2;
  p.categories.push({name:'Medicines',type:'spending',kind:'flex',percent:10,priority:1});
  p.categories.find(c=>c.id==='misc').percent-=10;savePlan(s,p);allocateMonth(s,'2026-10',{partial:true});
  const id=s.categories.find(c=>c.name==='Medicines').id;
  assert.equal(cat(s,id).balancePaise,P(1000));assert.equal(cat(s,'rent').balancePaise,0);
  saveBucketType(s,{id:'spending',name:'Everyday Spending',priority:4});
  tx(s,null,1000,{kind:'income',direction:'in'});allocateMonth(s,'2026-10',{partial:true});
  assert.equal(cat(s,id).balancePaise,P(2000));
});

test('type priority controls new funding without depending on built-in category IDs',()=>{
  const s=make(1000);saveBucketType(s,{id:'investment',name:'Investments',priority:1});
  saveBucketType(s,{id:'bill',name:'Bills & Utilities',priority:4});saveBucketType(s,{id:'loan',name:'Loans & EMIs',priority:4});
  allocateMonth(s,'2026-10',{partial:true});assert.equal(cat(s,'invest').balancePaise,P(1000));
});

test('savings transfers and withdrawals preserve total savings and replay edits',()=>{
  const s=make();allocateMonth(s,'2026-10');const bank=computeBankBalance(s);
  const transfer=tx(s,'emergency',13000);
  assert.equal(externalSavings(s,'emergency'),P(13000));assert.equal(cat(s,'emergency').balancePaise,0);
  assert.equal(computeBankBalance(s),bank-P(13000));
  const returned=tx(s,'emergency',3000,{direction:'in'});
  assert.equal(externalSavings(s,'emergency'),P(10000));assert.equal(cat(s,'emergency').balancePaise,P(3000));
  updateTransaction(s,returned.id,{amountPaise:P(4000)});assert.equal(externalSavings(s,'emergency'),P(9000));
  deleteTransaction(s,returned.id);assert.equal(externalSavings(s,'emergency'),P(13000));
  reversePayment(s,transfer.id);assert.equal(externalSavings(s,'emergency'),0);assert.equal(computeBankBalance(s),bank);
});

test('legacy savings are preserved and dated balance checks do not rewrite earlier totals',()=>{
  const s=make();cat(s,'emergency').openingSavedPaise=P(50000);
  s.transactions.push({id:'old',date:'2026-09-15',createdAt:'2026-09-15T08:00:00Z',categoryId:'emergency',amountPaise:P(10000),kind:'transfer',direction:'out',description:'Old transfer'});
  assert.equal(externalSavings(s,'emergency'),P(50000));
  updateSavingOpening(s,'emergency',P(51000));assert.equal(externalSavings(s,'emergency'),P(51000));
  assert.equal(externalSavings(s,'emergency','2026-09-30'),P(50000));
  tx(s,'emergency',1000);assert.equal(externalSavings(s,'emergency'),P(52000));
});

test('paused investments can redeem and reverse into accessible Unassigned money exactly once',()=>{
  const s=make();allocateMonth(s,'2026-10');const payment=tx(s,'invest',15000);
  updateInvestmentHistory(s,'invest',0);updateInvestmentValue(s,'invest',P(16000));
  const p=plan(s);p.categories=p.categories.filter(c=>c.id!=='invest');savePlan(s,p);
  const bank=computeBankBalance(s),unassigned=computeUnallocated(s);
  const redemption=tx(s,'invest',16000,{direction:'in'});
  assert.equal(redemption.unassignedReturn,true);assert.equal(cat(s,'invest').balancePaise,0);
  assert.equal(computeBankBalance(s),bank+P(16000));assert.equal(computeUnallocated(s),unassigned+P(16000));
  deleteTransaction(s,redemption.id);reversePayment(s,payment.id);
  assert.equal(computeUnallocated(s),unassigned+P(15000));assert.equal(investmentSummaries(s)[0].putInPaise,0);
  assert.throws(()=>tx(s,'invest',1000),{code:'CATEGORY_ARCHIVED'});
});

test('valuations use their as-of date; stale and partial totals are explicit',()=>{
  const s=make();tx(s,'invest',15000,{date:'2026-09-20'});updateInvestmentHistory(s,'invest',0);
  updateInvestmentValue(s,'invest',P(16000),'2026-09-30');
  tx(s,'invest',5000,{date:'2026-10-10'});updateInvestmentValue(s,'invest',P(22000),'2026-10-30');
  assert.equal(clientState(s,'2026-09').derived.investments[0].worthPaise,P(16000));
  assert.equal(clientState(s,'2026-09').derived.investments[0].worthStale,false);
  tx(s,'invest',1000);let investments=investmentSummaries(s);
  assert.equal(investments[0].worthStale,true);assert.equal(investmentTotals(investments).worthComplete,false);
  const totals=investmentTotals([{worthPaise:P(5000),netInvestedPaise:P(4000),gainPaise:P(1000),worthStale:false,historyComplete:true},
    {worthPaise:null,netInvestedPaise:P(3000),gainPaise:null,worthStale:false,historyComplete:true}]);
  assert.equal(totals.gainComplete,false);assert.equal(totals.gainCount,1);assert.equal(totals.count,2);
});

test('history never borrows a newer valuation and edited old contributions invalidate snapshots',()=>{
  const s=make();const payment=tx(s,'invest',15000,{date:'2026-09-20'});updateInvestmentHistory(s,'invest',0);
  updateInvestmentValue(s,'invest',P(16000),'2026-10-30');
  assert.equal(clientState(s,'2026-09').derived.investments[0].worthPaise,null);
  updateInvestmentValue(s,'invest',P(15500),'2026-09-30');
  assert.equal(investmentSummaries(s)[0].worthPaise,P(16000));
  updateTransaction(s,payment.id,{amountPaise:P(14000)});
  assert.equal(clientState(s,'2026-09').derived.investments[0].worthStale,true);
});

test('editing a transaction date follows the date unless its budget month was overridden',()=>{
  const s=make();const expense=tx(s,'fun',100);
  updateTransaction(s,expense.id,{date:'2026-09-30'});
  assert.equal(s.transactions[0].budgetPeriod,'2026-09');
  updateTransaction(s,expense.id,{budgetPeriod:'2026-08'});
  updateTransaction(s,expense.id,{date:'2026-09-29'});assert.equal(s.transactions[0].budgetPeriod,'2026-08');
});

test('yearly, quarterly, one-off and ended bills only create obligations when due',()=>{
  const annual={targetPaise:P(12000),frequency:'yearly',startPeriod:'2026-10'};
  assert.equal(scheduledAmount(annual,'2026-10'),P(12000));assert.equal(scheduledAmount(annual,'2026-11'),0);
  assert.equal(scheduledAmount(annual,'2027-10'),P(12000));
  assert.equal(scheduledAmount({...annual,frequency:'quarterly'},'2027-01'),P(12000));
  assert.equal(scheduledAmount({...annual,frequency:'once'},'2027-10'),0);
  assert.equal(scheduledAmount({...annual,frequency:'monthly',endPeriod:'2026-12'},'2027-01'),0);
  const s=make();const p=plan(s);Object.assign(p.categories.find(c=>c.id==='rent'),annual);savePlan(s,p);
  allocateMonth(s,'2026-10');tx(s,'rent',12000);
  assert.equal(commitment(s,'rent','2026-11').targetPaise,0);assert.equal(commitment(s,'rent','2026-12').overduePaise,0);
  assert.equal(computePlan(s,'2026-11').items.find(i=>i.categoryId==='rent').targetPaise,0);
});

test('planned purchases remain funded but do not inflate the daily spending guide',()=>{
  const s=make();allocateMonth(s,'2026-10');const safety=moneySafety(s,'2026-10');
  assert.equal(safety.safeToSpendPaise,P(40000));assert.equal(safety.purchaseReservePaise,P(9000));
  assert.equal(safety.dailyBudgetPaise,P(31000));
  cat(s,'electronics').includeInDailyGuide=true;
  assert.equal(moneySafety(s,'2026-10').dailyBudgetPaise,P(36000));
});

test('a new bill can join an already prefunded next month without changing its cash reservation',()=>{
  const s=make();allocateMonth(s,'2026-10');tx(s,null,100000,{kind:'income',direction:'in'});allocateMonth(s,'2026-11');
  const reserved=s.futureReservedPaise,before=s.categories.map(c=>c.balancePaise);
  const p=plan(s);p.categories.push({name:'New connection',kind:'fixed',type:'bill',targetPaise:P(1000),startPeriod:'2026-11'});savePlan(s,p);
  assert.equal(s.futureReservedPaise,reserved);assert.deepEqual(s.categories.slice(0,before.length).map(c=>c.balancePaise),before);
  assert.equal(s.allocations.find(a=>a.period==='2026-11').remainingPaise,P(1000));
  tx(s,null,1000,{kind:'income',direction:'in'});allocateMonth(s,'2026-11',{partial:true});
  assert.equal(s.allocations.find(a=>a.period==='2026-11').remainingPaise,0);
});

test('bills introduced through the type editor are visible before funding the current month',()=>{
  const s=make();allocateMonth(s,'2026-09');
  const bt=saveBucketType(s,{name:'Home services',behavior:'bill',initialBucketName:'Broadband',initialTargetPaise:P(1000)});
  const bill=s.categories.find(c=>c.bucketTypeId===bt.id);
  assert.equal(commitment(s,bill.id).remainingPaise,P(1000));
  assert.equal(commitment(s,bill.id,'2026-09').targetPaise,0);
});

test('historical cash keeps next-month reservations made before month end',()=>{
  const s=make();allocateMonth(s,'2026-10');
  const a=s.allocations[0];a.createdAt='2026-09-30T10:00:00Z';
  a.fundings[0].createdAt=a.createdAt;a.fundings[0].date='2026-10-01';
  const view=clientState(s,'2026-09');
  assert.equal(view.derived.bankBalancePaise,P(100000));assert.equal(view.derived.safety.futureReservedPaise,P(100000));
  assert.equal(view.derived.unallocatedPaise,0);assert.ok(view.categories.every(c=>c.balancePaise===0));
});

test('non-overlapping bills are affordable while overlapping schedules are rejected',()=>{
  const s=make(20000);const p=plan(s);p.monthlyIncomePaise=P(20000);p.surplusCategoryId=null;
  p.categories=[{...cat(s,'fun'),percent:100},
    {name:'Last old EMI',kind:'fixed',type:'loan',targetPaise:P(12000),startPeriod:'2026-10',endPeriod:'2026-10'},
    {name:'New EMI',kind:'fixed',type:'loan',targetPaise:P(12000),startPeriod:'2026-11'}];
  savePlan(s,p);assert.equal(computePlan(s,'2026-10').fixedTotalPaise,P(12000));
  assert.equal(computePlan(s,'2026-11').fixedTotalPaise,P(12000));
  const overlapping=plan(s);overlapping.categories.find(c=>c.name==='New EMI').startPeriod='2026-10';
  assert.throws(()=>savePlan(s,overlapping),{code:'PLAN_OVER_INCOME'});
});

test('a bucket created with its type inherits later priority edits before funding',()=>{
  const s=make(1000);const bt=saveBucketType(s,{name:'Essentials',behavior:'bill',priority:4,initialBucketName:'Medicine bill',initialTargetPaise:P(1000)});
  saveBucketType(s,{id:'bill',name:'Bills & Utilities',priority:4});saveBucketType(s,{id:'loan',name:'Loans & EMIs',priority:4});
  saveBucketType(s,{id:bt.id,name:'Essentials',priority:1});
  const bill=s.categories.find(c=>c.bucketTypeId===bt.id);assert.equal(bill.priority,null);
  allocateMonth(s,'2026-10',{partial:true});assert.equal(cat(s,bill.id).balancePaise,P(1000));
});

test('a savings goal holding external money cannot disappear when its bank bucket is empty',()=>{
  const s=make();allocateMonth(s,'2026-10');tx(s,'emergency',13000);
  const p=plan(s);p.categories=p.categories.filter(c=>c.id!=='emergency');
  assert.throws(()=>savePlan(s,p),{code:'EXTERNAL_SAVINGS_REMAIN'});
  assert.equal(externalSavings(s,'emergency'),P(13000));
});

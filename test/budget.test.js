import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../lib/seed.js';
import {replayBudgets} from '../lib/budget.js';
import {addTransaction, allocateMonth, classifyAdjustment, clientState, computeBankBalance, computeUnallocated, deleteTransaction, investmentSummaries, monthlyCommitments, moveBetweenEnvelopes, reconcileBalance, reversePayment, savePlan, settleBill, todayString, updateInvestmentHistory, updateInvestmentValue, updateTransaction} from '../lib/domain.js';
const P=n=>Math.round(n*100);
const state=(opening=100000)=>createState({monthlyIncomePaise:P(100000),openingBalancePaise:P(opening),onboarded:true});
const category=(s,id)=>s.categories.find(c=>c.id===id);
const commitment=(s,id,period='2026-10')=>monthlyCommitments(s,period).find(c=>c.categoryId===id);
const tx=(s,categoryId,amount,{date='2026-10-05',direction='out',kind=categoryId==='invest'?'transfer':categoryId?'expense':'income',budgetPeriod}={})=>addTransaction(s,{categoryId,amountPaise:P(amount),date,direction,kind,budgetPeriod,description:'Test movement'});
const plan=s=>({monthlyIncomePaise:s.settings.monthlyIncomePaise,paydayDay:s.settings.paydayDay,surplusCategoryId:s.settings.surplusCategoryId,categories:s.categories.filter(c=>!c.archived).map(c=>({...c}))});

test('rent and SIP paid before funding consume their current month allocation once',()=>{
 const s=state(); tx(s,'rent',20000);tx(s,'invest',15000);allocateMonth(s,'2026-10');
 assert.equal(category(s,'rent').balancePaise,0);assert.equal(category(s,'invest').balancePaise,0);
 assert.equal(computeBankBalance(s),P(65000));assert.equal(computeUnallocated(s),0);
 assert.equal(commitment(s,'rent').status,'done');
});

test('historical expenses have identical outcomes regardless of entry time',()=>{
 const make=late=>{const s=state();allocateMonth(s,'2026-09');tx(s,'groceries',10000,{date:'2026-09-10'});if(!late)tx(s,'groceries',3000,{date:'2026-09-20'});tx(s,null,100000,{date:'2026-10-01',direction:'in'});allocateMonth(s,'2026-10');if(late)tx(s,'groceries',3000,{date:'2026-09-20'});return s;};
 const a=make(false),b=make(true);assert.equal(category(a,'groceries').balancePaise,P(11000));
 assert.deepEqual(a.categories.map(c=>c.balancePaise),b.categories.map(c=>c.balancePaise));assert.equal(computeBankBalance(a),computeBankBalance(b));
});

test('editing and deleting prior expenses replay resets and surplus',()=>{
 const s=state();allocateMonth(s,'2026-09');const expense=tx(s,'groceries',10000,{date:'2026-09-10'});tx(s,null,100000,{date:'2026-10-01',direction:'in'});allocateMonth(s,'2026-10');
 updateTransaction(s,expense.id,{amountPaise:P(13000)});assert.equal(category(s,'groceries').balancePaise,P(11000));
 deleteTransaction(s,expense.id);assert.equal(category(s,'groceries').balancePaise,P(12000));assert.equal(computeUnallocated(s),0);
});

test('classifying all or part of a correction leaves the bank balance unchanged',()=>{
 const s=state();allocateMonth(s,'2026-10');const correction=reconcileBalance(s,P(99500));
 classifyAdjustment(s,correction.id,{date:todayString(),kind:'expense',categoryId:'fun',description:'Forgotten lunch',amountPaise:P(300)});
 assert.equal(computeBankBalance(s),P(99500));assert.equal(s.transactions.find(t=>t.id===correction.id).amountPaise,P(200));
 classifyAdjustment(s,correction.id,{date:todayString(),kind:'expense',categoryId:'misc',description:'Bank charge',amountPaise:P(200)});
 assert.equal(computeBankBalance(s),P(99500));assert.equal(computeUnallocated(s),0);assert.equal(s.transactions.filter(t=>t.kind==='adjustment').length,0);
});

test('partial salary funds essentials and a top-up does not reset or duplicate funding',()=>{
 const s=state(80000);allocateMonth(s,'2026-10',{partial:true});
 assert.equal(category(s,'rent').balancePaise,P(20000));assert.equal(category(s,'loan').balancePaise,P(12000));assert.equal(category(s,'groceries').balancePaise,P(12000));
 const spent=tx(s,'groceries',1000,{date:todayString()});tx(s,null,20000,{date:todayString(),direction:'in'});allocateMonth(s,'2026-10',{partial:true});
 assert.equal(s.allocations.length,1);assert.equal(category(s,'groceries').balancePaise,P(11000));assert.equal(category(s,'invest').balancePaise,P(15000));assert.equal(computeUnallocated(s),0);
 assert.equal(s.allocations[0].remainingPaise,0);assert.ok(spent);
});

test('unpaid rent carries into next month instead of becoming surplus',()=>{
 const s=state();allocateMonth(s,'2026-09');tx(s,null,100000,{date:'2026-10-01',direction:'in'});allocateMonth(s,'2026-10');
 assert.equal(category(s,'rent').balancePaise,P(40000));assert.equal(commitment(s,'rent').overduePaise,P(20000));
});

test('a variable bill can settle below budget and a refund reopens it',()=>{
 const s=state();category(s,'rent').targetPaise=P(2500);allocateMonth(s,'2026-10');tx(s,'rent',1800);
 settleBill(s,'rent',{period:'2026-10',amountPaise:P(1800),settled:true});assert.equal(commitment(s,'rent').status,'done');
 tx(s,'rent',500,{date:todayString(),direction:'in'});assert.equal(commitment(s,'rent').status,'partial');assert.equal(commitment(s,'rent').remainingPaise,P(500));
});

test('bills already included in opening balance are not funded or charged twice',()=>{
 const s=state(80000);settleBill(s,'rent',{period:'2026-10',amountPaise:P(20000),settled:true});allocateMonth(s,'2026-10');
 assert.equal(category(s,'rent').balancePaise,0);assert.equal(computeBankBalance(s),P(80000));assert.equal(commitment(s,'rent').status,'done');assert.equal(s.allocations[0].remainingPaise,0);
});

test('a late payment covers its chosen bill month without consuming the new bill twice',()=>{
 const s=state();allocateMonth(s,'2026-09');tx(s,null,100000,{date:'2026-10-01',direction:'in'});tx(s,'rent',20000,{date:'2026-10-05',budgetPeriod:'2026-09'});allocateMonth(s,'2026-10');
 assert.equal(category(s,'rent').balancePaise,P(20000));assert.equal(commitment(s,'rent').overduePaise,0);assert.equal(commitment(s,'rent').remainingPaise,P(20000));
});

test('savings status follows money moved out of the goal, including a capped goal',()=>{
 const s=state();allocateMonth(s,'2026-10');moveBetweenEnvelopes(s,{fromCategoryId:'emergency',toCategoryId:'fun',amountPaise:P(13000)});
 assert.equal(commitment(s,'emergency').paidPaise,0);assert.equal(commitment(s,'emergency').status,'due');
 const capped=state();category(capped,'emergency').capPaise=P(13000);allocateMonth(capped,'2026-09');tx(capped,null,100000,{date:'2026-10-01',direction:'in'});allocateMonth(capped,'2026-10');
 assert.equal(commitment(capped,'emergency').fundedPaise,0);assert.equal(commitment(capped,'emergency').status,'at-goal');
});

test('a failed SIP is not a successful investment; a genuine redemption is separate',()=>{
 const s=state();allocateMonth(s,'2026-10');const payment=tx(s,'invest',15000);reversePayment(s,payment.id);
 assert.equal(commitment(s,'invest').paidPaise,0);assert.equal(commitment(s,'invest').status,'due');
 assert.equal(investmentSummaries(s)[0].putInPaise,0);assert.equal(investmentSummaries(s)[0].tookOutPaise,0);
 assert.throws(()=>reversePayment(s,payment.id));assert.throws(()=>deleteTransaction(s,payment.id));
 const redeemed=state();allocateMonth(redeemed,'2026-10');tx(redeemed,'invest',15000);tx(redeemed,'invest',15000,{direction:'in'});assert.equal(commitment(redeemed,'invest').status,'done');
});

test('opening holdings remain unknown after a new SIP until their opening cost is supplied',()=>{
 const s=state();updateInvestmentValue(s,'invest',P(100000));tx(s,'invest',15000);updateInvestmentValue(s,'invest',P(115000));assert.equal(investmentSummaries(s)[0].gainPaise,null);
 updateInvestmentHistory(s,'invest',P(100000));assert.equal(investmentSummaries(s)[0].gainPaise,0);
});

test('deleting a contribution invalidates its value snapshot',()=>{
 const s=state();const a=tx(s,'invest',10000);tx(s,'invest',10000);updateInvestmentValue(s,'invest',P(22000));deleteTransaction(s,a.id);assert.equal(investmentSummaries(s)[0].gainPaise,null);assert.equal(investmentSummaries(s)[0].worthStale,true);
});

test('pausing a cash-empty SIP keeps its holding visible',()=>{
 const s=state();allocateMonth(s,'2026-10');tx(s,'invest',15000);updateInvestmentValue(s,'invest',P(16000));const p=plan(s);p.categories=p.categories.filter(c=>c.id!=='invest');savePlan(s,p);
 assert.equal(investmentSummaries(s)[0].worthPaise,P(16000));assert.equal(investmentSummaries(s)[0].archived,true);
});

test('plan edits do not rewrite a funded month and payday accepts the 31st',()=>{
 const s=state();allocateMonth(s,'2026-10');const before=s.categories.map(c=>c.balancePaise);const p=plan(s);p.paydayDay=31;p.categories.find(c=>c.id==='rent').targetPaise=P(25000);savePlan(s,p);replayBudgets(s);
 assert.deepEqual(s.categories.map(c=>c.balancePaise),before);assert.equal(commitment(s,'rent').targetPaise,P(20000));assert.equal(s.settings.paydayDay,31);
});

test('transactions before the opening date are rejected without changing cash',()=>{
 const s=state();s.settings.openingDate='2026-10-10';assert.throws(()=>tx(s,'fun',100,{date:'2026-10-09'}),{code:'BEFORE_OPENING'});assert.equal(computeBankBalance(s),P(100000));
});

test('available-to-spend protects commitments and shows cash backing shortages',()=>{
 const s=state();allocateMonth(s,'2026-10');tx(s,'fun',10000);const safety=clientState(s,'2026-10').derived.safety;
 assert.equal(safety.uncoveredPaise,P(3000));assert.equal(safety.safeToSpendPaise,P(30000));assert.equal(computeUnallocated(s),0);
});

test('funding next month reserves cash without resetting this month spending',()=>{
 const s=state();const now=todayString(),current=now.slice(0,7),d=new Date(`${now}T12:00:00`),next=todayString(new Date(d.getFullYear(),d.getMonth()+1,1)).slice(0,7);
 allocateMonth(s,current);const before=s.categories.map(c=>c.balancePaise);tx(s,null,100000,{date:now,direction:'in'});allocateMonth(s,next);
 assert.deepEqual(s.categories.map(c=>c.balancePaise),before);assert.equal(s.futureReservedPaise,P(100000));assert.equal(computeUnallocated(s),0);
 const view=clientState(s,current);assert.equal(view.derived.safety.safeToSpendPaise,P(40000));assert.equal(view.derived.safety.futureReservedPaise,P(100000));
 moveBetweenEnvelopes(s,{period:next,fromCategoryId:'groceries',toCategoryId:'fun',amountPaise:P(1000)});
 assert.deepEqual(s.categories.map(c=>c.balancePaise),before);
 assert.equal(clientState(s,next).categories.find(c=>c.id==='groceries').balancePaise,P(11000));
});

test('a payment from next month money reduces its reservation once',()=>{
 const s=state(),now=todayString(),d=new Date(`${now}T12:00:00`),next=todayString(new Date(d.getFullYear(),d.getMonth()+1,1)).slice(0,7);
 allocateMonth(s,now.slice(0,7));tx(s,null,100000,{date:now,direction:'in'});tx(s,'rent',20000,{date:now,budgetPeriod:next});allocateMonth(s,next);
 assert.equal(s.futureReservedPaise,P(80000));assert.equal(computeUnallocated(s),0);assert.equal(category(s,'rent').balancePaise,P(20000));
 assert.equal(commitment(s,'rent',next).status,'done');
});

test('settled payments before funding are covered, including below-budget bills',()=>{
 const s=state();tx(s,'rent',18000);settleBill(s,'rent',{period:'2026-10',amountPaise:P(18000),settled:true});allocateMonth(s,'2026-10');
 assert.equal(category(s,'rent').balancePaise,0);assert.equal(computeUnallocated(s),0);assert.equal(commitment(s,'rent').status,'done');
});

test('history shows the selected month bank and bucket balances',()=>{
 const s=state();allocateMonth(s,'2026-09');tx(s,'groceries',1000,{date:'2026-09-10'});tx(s,null,100000,{date:'2026-10-01',direction:'in'});allocateMonth(s,'2026-10');
 const view=clientState(s,'2026-09');assert.equal(view.derived.bankBalancePaise,P(99000));assert.equal(view.categories.find(c=>c.id==='groceries').balancePaise,P(11000));assert.equal(computeBankBalance(s),P(199000));
});

test('removing a classification restores the unidentified difference, not the bank cash',()=>{
 const s=state();allocateMonth(s,'2026-10');const correction=reconcileBalance(s,P(99500));
 const entry=classifyAdjustment(s,correction.id,{date:todayString(),kind:'expense',categoryId:'fun',description:'Uncertain meal',amountPaise:P(500)});
 assert.throws(()=>updateTransaction(s,entry.id,{amountPaise:P(400)}),{code:'CLASSIFIED_AMOUNT'});
 deleteTransaction(s,entry.id);assert.equal(computeBankBalance(s),P(99500));assert.equal(s.transactions.find(t=>t.id===correction.id).amountPaise,P(500));
});

test('unpaid bills remain visible through a month with no salary division',()=>{
 const s=state();allocateMonth(s,'2026-08');tx(s,null,100000,{date:'2026-10-01',direction:'in'});allocateMonth(s,'2026-10');
 assert.equal(commitment(s,'rent').overduePaise,P(40000));assert.equal(commitment(s,'rent').fundingGapPaise,P(20000));
});

test('legacy backups keep their exact balances and reject guesses about older rules',()=>{
 const s=state();s.allocations=[{id:'old',period:'2026-09',createdAt:'2026-09-30T10:00:00.000Z',items:s.categories.map(c=>({categoryId:c.id,targetPaise:c.targetPaise,deltaPaise:0,reason:'target'}))}];
 category(s,'emergency').balancePaise=P(5000);replayBudgets(s);assert.equal(category(s,'emergency').balancePaise,P(5000));
 assert.throws(()=>tx(s,'fun',100,{date:'2026-09-20'}),{code:'LEGACY_HISTORY'});assert.equal(computeBankBalance(s),P(100000));
});

test('a prefunded month activates before new money arrives on its first day',()=>{
 const s=state(0),now=todayString(),d=new Date(`${now}T12:00:00`),next=todayString(new Date(d.getFullYear(),d.getMonth()+1,1)).slice(0,7);
 tx(s,null,100000,{date:now,direction:'in'});allocateMonth(s,next);
 s.transactions.push({id:'new-month-salary',date:`${next}-01`,createdAt:new Date(`${next}-01T09:00:00`).toISOString(),description:'New salary',kind:'income',direction:'in',amountPaise:P(100000),categoryId:null});
 replayBudgets(s,next);assert.equal(computeUnallocated(s),P(100000));assert.equal(category(s,'emergency').balancePaise,P(13000));
});

test('funding this month after next month cannot sweep the future reservation',()=>{
 const s=state(200000),now=todayString(),d=new Date(`${now}T12:00:00`),next=todayString(new Date(d.getFullYear(),d.getMonth()+1,1)).slice(0,7);
 allocateMonth(s,next);allocateMonth(s,now.slice(0,7));
 assert.equal(s.futureReservedPaise,P(100000));assert.equal(computeUnallocated(s),0);assert.equal(category(s,'emergency').balancePaise,P(13000));
 const projected=clientState(s,next);assert.equal(projected.derived.unallocatedPaise,0);assert.equal(projected.derived.safety.uncoveredPaise,0);
});

test('early future payments survive an intervening current-month division',()=>{
 const s=state(200000),now=todayString(),d=new Date(`${now}T12:00:00`),next=todayString(new Date(d.getFullYear(),d.getMonth()+1,1)).slice(0,7);
 tx(s,'rent',20000,{date:now,budgetPeriod:next});allocateMonth(s,next);allocateMonth(s,now.slice(0,7));
 assert.equal(s.futureReservedPaise,P(80000));assert.equal(computeUnallocated(s),0);
 const projected=clientState(s,next);assert.equal(projected.derived.unallocatedPaise,0);assert.equal(projected.categories.find(c=>c.id==='rent').balancePaise,P(20000));
});

test('an investment with pending cash cannot disappear by archiving it',()=>{
 const s=state(200000),now=todayString(),d=new Date(`${now}T12:00:00`),next=todayString(new Date(d.getFullYear(),d.getMonth()+1,1)).slice(0,7);
 allocateMonth(s,now.slice(0,7));tx(s,'invest',15000,{date:now});tx(s,null,100000,{date:now,direction:'in'});allocateMonth(s,next);
 const p=plan(s);p.categories=p.categories.filter(c=>c.id!=='invest');assert.throws(()=>savePlan(s,p),{code:'PENDING_BALANCE'});
});

import {scheduledAmount, peakFixedPlan} from '../public/schedule.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createState} from '../lib/seed.js';
import {clientState} from '../lib/domain.js';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/, '').replace(/init\(\);\s*$/,'');
function client(payload){
 const nodes={'#modal-root':{innerHTML:''}};
 const context=vm.createContext({scheduledAmount,peakFixedPlan,nodes,location:{hash:''},sessionStorage:{getItem:()=>null},document:{addEventListener(){},querySelector:s=>nodes[s]||null,body:{classList:{add(){}}}},window:{addEventListener(){}},setInterval(){},setTimeout(){},fetch:async()=>({ok:true,json:async()=>payload})});
 vm.runInContext(source,context);
 return context;
}

test('an outdated running server produces restart instructions instead of a dashboard crash',async()=>{
 const context=client({state:{derived:{bankBalancePaise:0}}});
 await assert.rejects(vm.runInContext("api('/api/state')",context),/server is running an older version.*Restart/);
});

test('the updated server state is accepted by the client',async()=>{
 const payload={state:{derived:{safety:{safeToSpendPaise:0},fundingPreview:{items:[]},investmentTotals:{}}}};
 const context=client(payload);
 const response=await vm.runInContext("api('/api/state')",context);
 assert.equal(response,payload);
});


test('new payment forms do not settle bills by default or inherit the month being browsed',()=>{
 const context=client({});context.reviewState=clientState(createState({onboarded:true}));
 vm.runInContext("app.data=reviewState;app.period='2026-09';openTransaction({categoryId:'rent'})",context);
 const html=context.nodes['#modal-root'].innerHTML;
 assert.doesNotMatch(html.match(/<input name="settled"[^>]*>/)[0],/checked/);
 const current=vm.runInContext('currentMonth()',context);
 assert.ok(html.includes(`name="budgetPeriod" type="month" value="${current}"`));
});

test('changing a date follows its month until the user explicitly chooses another budget month',()=>{
 const context=client({});context.form={dataset:{budgetOverride:'false'},elements:{date:{value:'2026-09-30'},budgetPeriod:{value:'2026-10'}}};
 vm.runInContext("syncTransactionPeriod(form,'date')",context);assert.equal(context.form.elements.budgetPeriod.value,'2026-09');
 context.form.elements.budgetPeriod.value='2026-08';vm.runInContext("syncTransactionPeriod(form,'budgetPeriod')",context);
 context.form.elements.date.value='2026-10-01';vm.runInContext("syncTransactionPeriod(form,'date')",context);
 assert.equal(context.form.elements.budgetPeriod.value,'2026-08');
});

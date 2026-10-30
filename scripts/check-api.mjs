// Runs against a disposable ledger; never opens data/store.json.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import vm from 'node:vm';
import {todayString} from '../lib/domain.js';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'khaata-api-test-'));
process.env.DATA_FILE=path.join(directory,'store.json');process.env.PORT='0';process.env.HOST='127.0.0.1';
const {server}=await import('../server.js');
try {
 if(!server.listening)await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`,today=todayString(),period=today.slice(0,7);
 const request=async(route,body,method='POST',month=period)=>{
  const response=await fetch(`${base}${route}?period=${month}`,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
 };
 const ok=async(...args)=>{const response=await request(...args);assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};
 let setup=await ok('/api/setup',{monthlyIncomePaise:10000000,openingBalancePaise:10000000});
 assert.equal(setup.state.derived.allocation,null);assert.equal(setup.state.settings.planConfirmed,false);
 assert.equal((await request('/api/allocate',{period})).status,400);
 let p={monthlyIncomePaise:10000000,paydayDay:31,surplusCategoryId:'emergency',categories:setup.state.categories};
 p.categories.find(c=>c.id==='rent').targetPaise=2500000;
 await ok('/api/plan',p,'PUT');
 await ok('/api/transactions',{date:today,kind:'expense',direction:'out',categoryId:'rent',amountPaise:1800000,description:'Actual rent settled',settleBill:true});
 let funded=await ok('/api/allocate',{period});
 assert.equal(funded.state.categories.find(c=>c.id==='rent').balancePaise,0);
 assert.equal(funded.state.derived.bankBalancePaise,8200000);
 assert.equal(funded.state.derived.commitments.find(c=>c.categoryId==='rent').status,'done');
 const correction=await ok('/api/reconcile',{balancePaise:8150000});
 const classified=await ok('/api/transactions',{adjustmentId:correction.adjustment.id,date:today,kind:'expense',direction:'out',categoryId:'fun',amountPaise:50000,description:'Forgotten meal'});
 assert.equal(classified.state.derived.bankBalancePaise,8150000);
 const payment=await ok('/api/transactions',{date:today,kind:'transfer',direction:'out',categoryId:'invest',amountPaise:1500000,description:'SIP'});
 const reversed=await ok(`/api/transactions/${payment.transaction.id}/reverse`,{});
 assert.equal(reversed.state.derived.commitments.find(c=>c.categoryId==='invest').paidPaise,0);
 await ok('/api/investments/invest/value',{worthPaise:11500000,openingCostPaise:10000000});
 const exported=await (await fetch(`${base}/api/export`)).json();
 const before=JSON.stringify((await ok('/api/state',undefined,'GET')).state.categories.map(c=>c.balancePaise));
 await ok('/api/reset',{});await ok('/api/restore',exported);
 assert.equal(JSON.stringify((await ok('/api/state',undefined,'GET')).state.categories.map(c=>c.balancePaise)),before);
 const broken=structuredClone(exported);broken.transactions[0].categoryId='does-not-exist';
 assert.equal((await request('/api/restore',broken)).status,400);
 assert.equal(JSON.stringify((await ok('/api/state',undefined,'GET')).state.categories.map(c=>c.balancePaise)),before);
 await ok('/api/reset',{});
 setup=await ok('/api/setup',{monthlyIncomePaise:7358245,openingBalancePaise:5843759});
 assert.equal(setup.state.derived.bankBalancePaise,5843759);
 p={monthlyIncomePaise:7358245,paydayDay:31,surplusCategoryId:'emergency',categories:setup.state.categories};
 await ok('/api/plan',p,'PUT');
 funded=await ok('/api/allocate',{period,partial:true});assert.ok(funded.state.derived.allocation.remainingPaise>0);
 await ok('/api/transactions',{date:today,kind:'income',direction:'in',amountPaise:1514486,description:'Rest of salary'});
 funded=await ok('/api/allocate',{period,partial:true});assert.equal(funded.state.derived.allocation.remainingPaise,0);
 const next=todayString(new Date(new Date().getFullYear(),new Date().getMonth()+1,1)).slice(0,7);
 await ok('/api/transactions',{date:today,kind:'income',direction:'in',amountPaise:7358245,description:'Next salary'});
 const nextFunded=await ok('/api/allocate',{period:next},'POST',next);assert.equal(nextFunded.state.derived.period,next);
 const current=await ok('/api/state',undefined,'GET');assert.equal(current.state.derived.safety.futureReservedPaise,7358245);
 assert.equal((await request('/api/allocate',{period:'2020-01'})).status,400);

 // Execute all view functions without a browser. This catches template/runtime
 // errors; visual layout and native input behavior still need browser QA.
 const nodes=Object.fromEntries(['#app','#modal-root','#toast-root'].map(id=>[id,{innerHTML:'',append(){}}]));
 const context=vm.createContext({Intl,Date,JSON,Number,String,Math,Set,Map,FormData,confirm:()=>true,
  location:{origin:base,hash:'#dashboard'},sessionStorage:{getItem:()=>null,setItem(){}},
  window:{addEventListener(){},scrollTo(){}},document:{querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){},body:{classList:{add(){},remove(){}}},visibilityState:'hidden',activeElement:null},
  setInterval(){},setTimeout(){},fetch:(url,options)=>fetch(`${base}${url}`,options)});
 vm.runInContext(await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8'),context);
 for(let n=0;n<100&&!vm.runInContext('Boolean(app.data)',context);n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(vm.runInContext('Boolean(app.data)',context));
 for(const view of ['dashboard','plan','transactions','settings']){
  vm.runInContext(`app.view=${JSON.stringify(view)};render()`,context);assert.ok(nodes['#app'].innerHTML.includes('Khaata'));
 }
 vm.runInContext("openTransaction();openFunding();openReconcile();openWorth('invest');help()",context);
 assert.ok(nodes['#modal-root'].innerHTML.includes('How Khaata works'));
 console.log('API smoke checks passed: setup, exact amounts, paid bills, classification, reversals, restore, partial funding, next-month reservations, and view rendering.');
} finally {
 await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});
}

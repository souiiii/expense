import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/init\(\);\s*$/,'');
function client(payload){
 const context=vm.createContext({location:{hash:''},sessionStorage:{getItem:()=>null},document:{addEventListener(){}},window:{addEventListener(){}},setInterval(){},fetch:async()=>({ok:true,json:async()=>payload})});
 vm.runInContext(source,context);
 return context;
}

test('an outdated running server produces restart instructions instead of a dashboard crash',async()=>{
 const context=client({state:{derived:{bankBalancePaise:0}}});
 await assert.rejects(vm.runInContext("api('/api/state')",context),/server is running an older version.*Restart/);
});

test('the updated server state is accepted by the client',async()=>{
 const payload={state:{derived:{safety:{safeToSpendPaise:0},fundingPreview:{items:[]}}}};
 const context=client(payload);
 const response=await vm.runInContext("api('/api/state')",context);
 assert.equal(response,payload);
});

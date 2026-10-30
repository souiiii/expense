import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('server and browser modules parse',()=>{
 for(const file of ['server.js','public/app.js','lib/domain.js','lib/budget.js','lib/store.js','lib/seed.js','lib/cloud-sync.js','lib/neon.js']) {
  execFileSync(process.execPath,['--check',fileURLToPath(new URL(`../${file}`,import.meta.url))],{stdio:'pipe'});
 }
});

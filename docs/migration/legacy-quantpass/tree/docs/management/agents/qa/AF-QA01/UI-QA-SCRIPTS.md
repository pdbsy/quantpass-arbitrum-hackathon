# AF-QA01 executed UI supplemental scripts

以下为 QA 自有脚本最终实际执行版本；放在 `QA_ROOT/.checks/af-qa01/` 后运行，各 candidates 目录从相应固定 SHA git archive 获取，绝对根见 UI-REVIEW。没有业务源码改动。脚本产生的数据库/cookies/profile 不发布。contract-check 的逐例 FAILED 是结果，exit 0 只代表观察完成。

## ui-contract-check.mjs

SHA256: `efe2306afabbb7b2d0b5bc1f4ac5ef2536749e7bb6fb12e135f7bea26dec9f60`

```javascript
import { readFile } from 'node:fs/promises';
import { ProductAdapter, fromCanonicalVault } from './candidates/3caf8dd4c12a6b5da38ee3664b44683b69affcd2/apps/web/src/product-adapter.ts';
const all = JSON.parse(await readFile(new URL('./candidates/f66faa10c2a22f56048b04416cd83a2e8e9dd481/docs/api/fixtures/AF-BE01.json', import.meta.url)));
const fixture = all.scenarios.NORMAL;
const minimumKeys = ['schemaVersion','scope','vaultId','ownerId','strategyId','status','revision','passBalance','balances','pendingOperations'];
const canonical = Object.fromEntries(minimumKeys.map(k=>[k,structuredClone(fixture.vault[k])]));
try { fromCanonicalVault(canonical,'alice'); console.log('F04: PASSED canonical minimum accepted'); }
catch(e) { console.log('F04: FAILED canonical minimum rejected:',e.message,'status',e.status); }
try { fromCanonicalVault({...canonical,asset:canonical.balances.asset},'alice'); console.log('F04 control: PASSED with non-required top-level asset'); }
catch(e) { console.log('F04 control failed:',e.message); }
const summary = Object.fromEntries(['schemaVersion','scope','strategyId','name','description','testPasses'].map(k=>[k,fixture.strategySummary[k]]));
const account = {schemaVersion:1,scope:'TEST_ONLY',ownerId:'alice',strategies:[{ownerId:'alice',strategyId:summary.strategyId,vaultId:null,status:'not_started'}],passBalances:[{strategyId:summary.strategyId,total:'0',allowance:'0'}]};
for(const relation of [null,account.strategies[0]]) {
 const adapter=new ProductAdapter({storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},request:async path=>{
  if(path==='/session')return {user:'alice'};
  if(path.startsWith('/v1/strategies?'))return {items:[summary],nextCursor:null};
  if(path.startsWith('/v1/vaults?'))return {items:[],nextCursor:null};
  if(path==='/v1/account')return account;
  if(path==='/v1/strategies/'+summary.strategyId)return {...summary,accountStrategy:relation};
  throw Error('unexpected path '+path);
 }});
 try { await adapter.client.refresh(); console.log('F05 relation',relation===null?'null':'object',': PASSED',adapter.snapshot.phase); }
 catch(e) { console.log('F05 relation',relation===null?'null':'object',': FAILED',e.message,adapter.snapshot.phase); }
}

```

## backend-form-boundaries.mjs

SHA256: `9e28f949941a7b226f26f3e992ec94cc27f80a6c448f818a8f3ed60ca34f4816`

```javascript
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildApp} from './candidates/f66faa10c2a22f56048b04416cd83a2e8e9dd481/apps/server/src/app.ts';
const dir=await mkdtemp(resolve('.checks/af-qa01/backend-form-'));
const {app}=await buildApp({dbPath:resolve(dir,'ledger.sqlite'),origin:'http://127.0.0.1:42918',env:{QP_MODE:'local',QP_ADAPTER:'mock'}});
let cookie='';
const call=(url,payload)=>app.inject({method:payload===undefined?'GET':'POST',url,headers:{host:'127.0.0.1:42918','x-quantpass-demo':'1',cookie},...(payload===undefined?{}:{payload})});
try{
 const login=await call('/api/demo/session',{user:'alice'});assert.equal(login.statusCode,200);cookie=String(login.headers['set-cookie']).split(';')[0];
 const claim=await call('/api/v1/vaults',{strategyId:'core-flow-demo'});assert.equal(claim.statusCode,200);const id=claim.json().vaultId;
 const cases=[['zero',{amount:'0'},409],['negative',{amount:'-1'},400],['decimal',{amount:'1.5'},400],['exponent',{amount:'1e6'},400],['leading zero',{amount:'01'},400],['over uint256',{amount:(2n**256n).toString()},400],['number',{amount:1},400],['null',{amount:null},400],['missing',{},400],['extra field',{amount:'1',note:'ordinary form'},400]];
 for(const [i,[label,fields,status]] of cases.entries()){
  const r=await call(`/api/v1/vaults/${id}/commands`,{id:'qa-invalid-'+i,expectedRevision:0,type:'deposit',...fields});assert.equal(r.statusCode,status,label);assert.deepEqual(Object.keys(r.json()),['error']);
  const v=(await call(`/api/v1/vaults/${id}`)).json();assert.equal(v.revision,0);assert.equal(v.balances.idle,'0');
 }
 const normal=await call(`/api/v1/vaults/${id}/commands`,{id:'qa-normal',expectedRevision:0,type:'deposit',amount:'1'});assert.equal(normal.statusCode,200);assert.equal(normal.json().vault.balances.idle,'1');
 const audit=(await call(`/api/v1/vaults/${id}/audit`)).json();assert.equal(audit.items.length,1);assert.equal(audit.items[0].commandId,'qa-normal');
 console.log('PASS 10 normal form/amount boundary rejections, unchanged state and closed error envelopes; valid 1 atomic-unit control, exactly one audit event');
}finally{await app.close();}

```

## ui-qa-server.mjs

SHA256: `ad0c1687eac986ed1d7e89fe942b1479a3026b3940e306ca984c352bcab7473c`

```javascript
import { buildApp } from './candidates/f66faa10c2a22f56048b04416cd83a2e8e9dd481/apps/server/src/app.ts';
const {app}=await buildApp({dbPath:process.env.QA_DB,webRoot:process.env.QA_WEB,origin:'http://127.0.0.1:42917',env:{QP_MODE:'local',QP_ADAPTER:'mock'}});
await app.listen({host:'127.0.0.1',port:42917});
console.log('QA_SERVER_READY');
process.once('SIGTERM',async()=>{await app.close();process.exit(0);});

```

## ui-extra-browser.mjs

SHA256: `3f9ee90f44219626d3a7bf9b4e73901e59bfe42febdccb7c3a943f56b22f1c52`

```javascript
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from './browser-tools/node_modules/playwright-core/index.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
await mkdir(resolve(root,'ui-extra'),{recursive:true});
const evidence=await mkdtemp(resolve(root,'ui-extra/run-'));
const origin='http://127.0.0.1:42917';
let child,browser,page,release;const checks=[];
async function start(){
 child=spawn(process.execPath,[resolve(root,'ui-qa-server.mjs')],{env:{...process.env,QA_DB:resolve(evidence,'ledger.sqlite'),QA_WEB:resolve(root,'candidates/3caf8dd4c12a6b5da38ee3664b44683b69affcd2/apps/web/dist')},stdio:['ignore','pipe','pipe']});
 await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('server start timeout')),15000);child.once('error',no);child.once('exit',code=>{clearTimeout(timer);no(Error('server exited '+code));});child.stdout.on('data',b=>{if(String(b).includes('QA_SERVER_READY')){clearTimeout(timer);ok();}});});
}
async function stop(){const done=once(child,'exit');child.kill('SIGTERM');await done;child=null;}
async function ready(){await page.locator('[data-product-state]').filter({hasText:/^(READY|EMPTY)$/}).waitFor();}
async function money(){const r=await page.request.get(origin+'/api/v1/vaults');assert.equal(r.status(),200);return (await r.json()).items[0];}
try{
 await start();browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(origin+'/#/home');
 const headers=await response.allHeaders();assert.match(headers['content-security-policy'],/script-src 'self'/);assert.doesNotMatch(headers['content-security-policy'],/unsafe-inline|unsafe-eval/);assert.equal(headers['referrer-policy'],'no-referrer');
 await page.locator('[data-product-login="alice"]').click();await ready();
 await page.locator('a[href="#/market"]').first().click();
 await page.locator('[data-product-strategy="core-flow-demo"]').click();
 await page.locator('[data-product-claim="core-flow-demo"]').click();await page.locator('dialog[open] [data-product-confirm]').click();await ready();
 let gate=new Promise(r=>release=r);let enter;const entered=new Promise(r=>enter=r);
 await page.route('**/api/**/commands',async route=>{enter();await gate;await route.continue();},{times:1});
 await page.locator('[data-product-command="deposit"]').click();await page.locator('dialog[open] [name="amount"]').fill('2.345678');await page.locator('[data-product-review]').click();await page.locator('[data-product-confirm]').click();await entered;
 await page.locator('[data-product-state]').filter({hasText:/^PENDING$/}).waitFor();assert.equal(await page.locator('[data-product-command="deposit"]').isDisabled(),true);
 await page.screenshot({path:resolve(evidence,'pending.png'),fullPage:true,animations:'disabled'});release();await ready();await page.unroute('**/api/**/commands');
 const initial=await money();assert.equal(initial.balances.idle,'2345678');assert.equal(initial.revision,1);checks.push('Controlled normal request delay shows PENDING and disables new commands; exact six-decimal value persists');
 gate=new Promise(r=>release=r);let readEnter;const readEntered=new Promise(r=>readEnter=r);
 await page.route('**/api/session',async route=>{readEnter();await gate;await route.continue();},{times:1});
 await page.locator('[data-product-refresh]').click();await readEntered;await page.locator('[data-product-state]').filter({hasText:/^LOADING$/}).waitFor();release();await ready();await page.unroute('**/api/session');checks.push('Controlled refresh delay visibly shows LOADING then READY');
 const priorPid=child.pid;await stop();await start();assert.notEqual(child.pid,priorPid);
 await page.locator('[data-product-refresh]').click();await page.locator('[data-product-state]').filter({hasText:/^DISCONNECTED$/}).waitFor();assert.equal((await page.locator('main').innerText()).includes(initial.vaultId),false);
 await page.locator('[data-product-login="alice"]').click();await ready();const after=await money();assert.equal(after.vaultId,initial.vaultId);assert.equal(after.revision,1);assert.equal(after.balances.idle,'2345678');const history=await page.request.get(origin+'/api/v1/vaults/'+after.vaultId+'/audit');assert.equal(history.status(),200);const receipt=(await history.json()).items;assert.equal(receipt.length,1);assert.equal(receipt[0].commandType,'deposit');assert.equal(receipt[0].revision,1);
 checks.push('Actual server process stop/new PID with same SQLite invalidates session, clears private view, and restores exact ledger and audit receipt after explicit login');
 await page.screenshot({path:resolve(evidence,'after-server-restart.png'),fullPage:true,animations:'disabled'});
 await page.goto(origin+'/#/market');await ready();await page.locator('[data-product-strategy="core-flow-demo"]').click();await page.locator('h1').filter({hasText:'核心资金流程样例'}).waitFor();
 await page.goBack();await page.locator('[data-product-catalogue]').waitFor();await page.goForward();await page.locator('h1').filter({hasText:'核心资金流程样例'}).waitFor();
 checks.push('Actual browser back/forward retains marketplace and selected API strategy route');
 for(const failure of ['unreadable','malformed']){
  const current=await money();const retained=JSON.stringify({owner:'alice',vaultId:current.vaultId,command:{id:'qa-unsent-'+failure,expectedRevision:current.revision,type:'deposit',amount:'1000000'}});
  const p2=await context.newPage();let posts=0;p2.on('request',req=>{if(req.url().endsWith('/commands'))posts++;});
  await p2.addInitScript(({failure,retained})=>{
   localStorage.setItem('quantpass.local.pending-command.v1',retained);
   localStorage.setItem('quantpass.local.retry-after.v1',failure==='malformed'?'invalid-deadline':'0');
   window.qaStorageBlocked=failure==='unreadable';const get=Storage.prototype.getItem;
   Storage.prototype.getItem=function(key){if(key==='quantpass.local.retry-after.v1'&&window.qaStorageBlocked)throw Error('QA_STORAGE_UNAVAILABLE');return get.call(this,key);};
  },{failure,retained});
  await p2.goto(origin+'/#/trade/core-flow-demo');await p2.locator('[data-product-state]').filter({hasText:/^DISCONNECTED$/}).waitFor();
  await p2.evaluate(()=>{window.qaStorageBlocked=false;localStorage.setItem('quantpass.local.retry-after.v1','0');});
  await p2.locator('[data-product-refresh]').click();await p2.locator('[data-product-state]').filter({hasText:/^PENDING$/}).waitFor();
  assert.equal(await p2.evaluate(()=>localStorage.getItem('quantpass.local.pending-command.v1')),retained);assert.equal(posts,0);
  await p2.screenshot({path:resolve(evidence,'storage-'+failure+'.png'),fullPage:true,animations:'disabled'});
  await p2.evaluate(()=>localStorage.removeItem('quantpass.local.pending-command.v1'));await p2.close();
 }
 checks.push('Actual unreadable/malformed cooldown startup is DISCONNECTED; storage recovery restores exact pending request without a command POST');
 const keys=await page.evaluate(()=>Object.keys(localStorage));assert.equal(keys.some(k=>/token|secret|password|private.?key/i.test(k)),false);assert.equal(await page.evaluate(()=>document.cookie.includes('qp_demo')),false);
 assert.deepEqual(errors,[]);checks.push('CSP and no-referrer headers retained; session cookie not JavaScript-readable; no credential-like localStorage keys or page errors in this normal flow');
 await writeFile(resolve(evidence,'result.json'),JSON.stringify({status:'PASSED',browser:await browser.version(),checks},null,2));console.log(JSON.stringify({status:'PASSED',evidence,checks},null,2));
}catch(e){release?.();if(page)await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error(evidence,e);process.exitCode=1;}
finally{if(browser)await browser.close();if(child)await stop();}

```

## ui-navigation-browser.mjs

SHA256: `f1f2d763fea31c7d0ef6ceca175799a1e5a29850e428b2efc5333210ebccbec8`

```javascript
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from './browser-tools/node_modules/playwright-core/index.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
await mkdir(resolve(root,'ui-extra'),{recursive:true});
const evidence=await mkdtemp(resolve(root,'ui-extra/run-'));
const origin='http://127.0.0.1:42917';
let child,browser,page,release;const checks=[];
async function start(){
 child=spawn(process.execPath,[resolve(root,'ui-qa-server.mjs')],{env:{...process.env,QA_DB:resolve(evidence,'ledger.sqlite'),QA_WEB:resolve(root,'candidates/3caf8dd4c12a6b5da38ee3664b44683b69affcd2/apps/web/dist')},stdio:['ignore','pipe','pipe']});
 await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('server start timeout')),15000);child.once('error',no);child.once('exit',code=>{clearTimeout(timer);no(Error('server exited '+code));});child.stdout.on('data',b=>{if(String(b).includes('QA_SERVER_READY')){clearTimeout(timer);ok();}});});
}
async function stop(){const done=once(child,'exit');child.kill('SIGTERM');await done;child=null;}
async function ready(){await page.locator('[data-product-state]').filter({hasText:/^(READY|EMPTY)$/}).waitFor();}
async function money(){const r=await page.request.get(origin+'/api/v1/vaults');assert.equal(r.status(),200);return (await r.json()).items[0];}
try{
 await start();browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/home');await page.locator('[data-product-login="alice"]').click();await ready();
 await page.goto(origin+'/#/market');await ready();
 assert.equal(await page.locator('[data-product-catalogue] article').count(),2);
 await page.locator('[data-product-search]').fill('core-flow');assert.equal(await page.locator('[data-product-catalogue] article').count(),1);
 await page.locator('[data-product-search]').fill('qa-no-match');assert.match(await page.locator('[data-product-catalogue]').innerText(),/No API strategies match/);
 await page.locator('[data-product-search]').fill('');await page.locator('[data-product-status-filter]').selectOption('running');assert.equal(await page.locator('[data-product-catalogue] article').count(),0);
 await page.locator('[data-product-status-filter]').selectOption('not_started');assert.equal(await page.locator('[data-product-catalogue] article').count(),2);
 await page.locator('[data-product-environment-filter]').selectOption('TEST_ONLY');assert.equal(await page.locator('[data-product-catalogue] article').count(),2);
 await page.locator('[data-product-status-filter]').selectOption('all');
 checks.push('Canonical marketplace search, no-match empty state, status and TEST_ONLY filters preserve catalogue association');
 await page.locator('[data-product-strategy="core-flow-demo"]').click();await page.locator('[data-product-claim="core-flow-demo"]').click();await page.locator('[data-product-confirm]').click();await ready();
 const initial=await money();let committedSignal;const committed=new Promise(r=>committedSignal=r);const gate=new Promise(r=>release=r);let original;
 await page.route('**/api/**/commands',async route=>{original=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),200);committedSignal();await gate;await route.abort('failed');},{times:1});
 await page.locator('[data-product-command="deposit"]').click();await page.locator('[name="amount"]').fill('1');await page.locator('[data-product-review]').click();await page.locator('[data-product-confirm]').click();await committed;
 await page.locator('dialog[open] [data-close]').first().click();await page.locator('[data-product-login="bob"]').click();await page.locator('[role="alert"]').filter({hasText:'BUSY'}).waitFor();
 const session=await page.request.get(origin+'/api/session');assert.equal((await session.json()).user,'alice');assert.match(await page.locator('main').innerText(),new RegExp(initial.vaultId));
 release();await page.locator('[data-product-retry]').waitFor();await page.unroute('**/api/**/commands');
 const retained=await page.evaluate(()=>localStorage.getItem('quantpass.local.pending-command.v1'));assert.deepEqual(JSON.parse(retained).command,original);
 await page.locator('[data-product-login="bob"]').click();await ready();assert.equal((await page.locator('main').innerText()).includes(initial.vaultId),false);assert.equal(await page.locator('[data-product-retry]').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('quantpass.local.pending-command.v1')),retained);
 await page.locator('[data-product-login="alice"]').click();await page.locator('[data-product-retry]').waitFor();await page.locator('[data-product-retry]').click();await ready();assert.equal((await money()).balances.idle,'1000000');
 checks.push('During active command a Bob switch is refused BUSY with Alice session retained; after response loss Bob cannot see/retry Alice pending, switching back recovers exact original without duplicate funds');
 for(const route of ['home','market','trade/core-flow-demo','account/funds','trade/trend']){
  await page.goto(origin+'/#/'+route);await ready();await page.reload();await ready();assert.equal(new URL(page.url()).hash,'#/'+route);assert.equal(await page.locator('h1').count(),1);assert.equal((await money()).vaultId,initial.vaultId);assert.equal((await money()).balances.idle,'1000000');
 }
 checks.push('Full reload on home, marketplace, API detail/workspace, account and original fixture route retains route, identity, vault and exact funds');
 assert.deepEqual(errors,[]);await writeFile(resolve(evidence,'result.json'),JSON.stringify({status:'PASSED',browser:await browser.version(),checks},null,2));console.log(JSON.stringify({status:'PASSED',evidence,checks},null,2));
}catch(e){release?.();if(page)await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error(evidence,e);process.exitCode=1;}
finally{if(browser)await browser.close();if(child)await stop();}

```

## ui-explicit-secret-check.mjs

SHA256: `91479f389d5abe7f05d81fd44150bd379096841cb0f450ef5a95fb3818a2c408`

```javascript
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {findSecretKinds} from './candidates/3caf8dd4c12a6b5da38ee3664b44683b69affcd2/tools/check-secrets.mjs';
const failures=[];
async function scan(path,label){const bytes=await readFile(path);if(bytes.includes(0))return false;for(const kind of findSecretKinds(bytes.toString('utf8')))failures.push({file:label,kind});return true;}
for(const sha of ['3caf8dd4c12a6b5da38ee3664b44683b69affcd2','f66faa10c2a22f56048b04416cd83a2e8e9dd481']){
 const files=execFileSync('git',['ls-tree','-r','--name-only','-z',sha],{encoding:'utf8'}).split('\0').filter(Boolean);let count=0;
 for(const file of files){if(/(^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example'))failures.push({file,kind:'environment-file'});if(await scan(resolve('.checks/af-qa01/candidates',sha,file),sha+'/'+file))count++;}
 console.log(sha+': enumerated '+files.length+' exact tracked files, '+count+' text files scanned');
}
const dist='.checks/af-qa01/candidates/3caf8dd4c12a6b5da38ee3664b44683b69affcd2/apps/web/dist';let built=0;
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())await walk(p);else if(await scan(p,'built/'+e.name))built++;}}
await walk(dist);console.log('Built UI text files scanned: '+built);assert.deepEqual(failures,[]);console.log('PASS bounded baseline, no candidate paths matched; binary and full-secret-audit coverage excluded');

```

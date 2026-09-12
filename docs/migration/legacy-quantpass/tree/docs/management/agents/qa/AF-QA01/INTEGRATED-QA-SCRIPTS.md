# AF-QA01 final executed supplemental scripts

每个脚本放在 QA_ROOT/.checks/af-qa01，目标是准确 detached integrated-c22cfdf 工作树。运行环境/命令见 INTEGRATED-REVIEW。以下是实际最终执行内容；业务实现未修改。

## integrated-contract-check.mjs

SHA256: `3bce792336a98a52859358d658c1919643dfd8996e8fd1c33efd2654fe532c07`

```javascript
import { readFile } from 'node:fs/promises';
import { ProductAdapter, fromCanonicalVault } from './integrated-c22cfdf/apps/web/src/product-adapter.ts';
const all = JSON.parse(await readFile(new URL('./integrated-c22cfdf/docs/api/fixtures/AF-BE01.json', import.meta.url)));
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

## integrated-form-boundaries.mjs

SHA256: `a3457f1181682c12346f24fb9cb3ada4c8129a31c4373d703962823491ce7b7f`

```javascript
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildApp} from './integrated-c22cfdf/apps/server/src/app.ts';
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

## integrated-backend-qa.mjs

SHA256: `6c13fc8c23a241da86011100d5e5a1cb505a4fb0b036503c6193dcbec9c7762d`

```javascript
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const candidate = resolve('.checks/af-qa01/integrated-c22cfdf');
process.chdir(candidate);
const { productHarness } = await import(pathToFileURL(resolve('test/helpers/product-api.ts')));
const h = await productHarness();
const check = (label) => process.stdout.write(`PASS ${label}\n`);
try {
  const cookie = await h.login();
  async function read(url, payload) {
    const response = await h.request(cookie, url, payload);
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
    return response.json();
  }
  const empty = await read('/api/v1/account');
  assert.equal(empty.schemaVersion, 1);
  assert.equal(empty.scope, 'TEST_ONLY');
  assert.equal(empty.ownerId, 'alice');
  assert.ok(empty.strategies.length >= 2);
  for (const item of empty.strategies) {
    assert.equal(item.ownerId, 'alice');
    assert.equal(item.vaultId, null);
    assert.equal(item.status, 'not_started');
  }
  for (const pass of empty.passBalances) {
    assert.equal(pass.total, '0');
    assert.equal(pass.allowance, '0');
  }
  let vault = await read('/api/v1/vaults', { strategyId: 'core-flow-demo' });
  const satellite = await read('/api/v1/vaults', { strategyId: 'satellite-flow-demo' });
  const account = await read('/api/v1/account');
  for (const state of [vault, satellite]) {
    assert.equal(account.strategies.find((s) => s.strategyId === state.strategyId).vaultId, state.vaultId);
    const pass = account.passBalances.find((p) => p.strategyId === state.strategyId);
    assert.equal(pass.total, '1000');
    assert.equal(pass.allowance, '1000000000');
    assert.equal(BigInt(pass.allowance), BigInt(pass.total) * 1000000n);
  }
  check('F01 canonical empty/claimed multi-strategy account and Pass units');
  async function command(id, type, fields = {}) {
    const result = await read(`/api/v1/vaults/${vault.vaultId}/commands`, {
      id, type, expectedRevision: vault.revision, ...fields,
    });
    vault = result.vault;
  }
  await command('qa-deposit', 'deposit', { amount: '1500000000' });
  await command('qa-allocate', 'allocate', { amount: '1000000000' });
  await command('qa-start', 'start');
  await command('qa-reserve', 'reserveBuy', { orderId: 'qa-order', amount: '200000000' });
  await command('qa-withdraw', 'requestWithdrawal', { amount: '500000000' });
  await command('qa-stop', 'stop');
  assert.equal(vault.status, 'stopping');
  assert.deepEqual(vault.pendingOperations.slice().sort((a, b) => a.kind.localeCompare(b.kind)), [
    { operationId: 'qa-order', kind: 'order', status: 'pending', amount: '200000000' },
    { operationId: 'qa-withdraw', kind: 'withdrawal', status: 'pending', amount: '500000000' },
  ]);
  await command('qa-cancel-order', 'cancelOrder', { orderId: 'qa-order' });
  await command('qa-cancel-withdraw', 'cancelWithdrawal', { withdrawalId: 'qa-withdraw' });
  assert.deepEqual(vault.pendingOperations, []);
  check('F02 exact pending shape, stopping has no STOP item, terminal operations removed');
  for (const [identity, url, status, error] of [
    ['', '/api/v1/account', 401, 'SESSION_REQUIRED'],
    [cookie, '/api/v1/strategies/qa-missing', 409, 'UNKNOWN_STRATEGY'],
    [cookie, '/api/v1/vaults/qa-missing', 404, 'VAULT_NOT_FOUND'],
    [cookie, '/api/v1/vaults?limit=0', 400, 'INVALID_REQUEST'],
  ]) {
    const response = await h.request(identity, url);
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), { error });
  }
  assert.deepEqual((await h.request(cookie, '/api/v1/qa-missing-route')).json(), { error: 'INVALID_REQUEST' });
  assert.equal((await h.request(cookie, '/api/strategies/qa-missing')).json().error, 'UNKNOWN_STRATEGY');
  assert.equal((await h.request(cookie, '/api/qa-missing-route')).json().error, 'INVALID_REQUEST');
  check('F03 ordinary canonical and legacy missing-resource errors use frozen codes');
  while (vault.revision < 51) await command(`qa-page-${vault.revision}`, 'deposit', { amount: '1' });
  const auditPath = `/api/v1/vaults/${vault.vaultId}/audit`;
  const page = await read(auditPath);
  assert.equal(page.items.length, 50);
  assert.equal(page.items[0].revision, 51);
  assert.equal(page.items.at(-1).revision, 2);
  assert.equal(typeof page.nextCursor, 'string');
  const nextUrl = `${auditPath}?cursor=${encodeURIComponent(page.nextCursor)}`;
  const tail = await read(nextUrl);
  assert.deepEqual(tail.items.map((e) => e.revision), [1]);
  assert.equal(tail.nextCursor, null);
  assert.deepEqual(await read(nextUrl), tail);
  assert.equal((await read(`${auditPath}?limit=1`)).items.length, 1);
  assert.equal((await read(`${auditPath}?limit=100`)).items.length, 51);
  const legacyAudit = await read(`/api/vaults/${vault.vaultId}/audit`);
  assert.equal(legacyAudit.length, 51);
  assert.equal(legacyAudit[0].revision, 51);
  check('Q01 canonical audit default 50/continuation/order vs legacy default 100 on 51 events');
  for (const collection of ['/api/v1/strategies', '/api/v1/vaults']) {
    const first = await read(`${collection}?limit=1`);
    assert.equal(first.items.length, 1);
    assert.equal(typeof first.nextCursor, 'string');
    const second = await read(`${collection}?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`);
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
    const key = collection.endsWith('/strategies') ? 'strategyId' : 'vaultId';
    assert.notEqual(first.items[0][key], second.items[0][key]);
    assert.equal((await read(`${collection}?limit=100`)).items.length, 2);
  }
  for (const collection of ['/api/v1/strategies', '/api/v1/vaults', auditPath]) {
    for (const limit of [0, 101]) {
      const result = await h.request(cookie, `${collection}?limit=${limit}`);
      assert.equal(result.statusCode, 400);
      assert.deepEqual(result.json(), { error: 'INVALID_REQUEST' });
    }
  }
  assert.ok(Array.isArray(await read('/api/strategies')));
  const legacyVaults = await read('/api/vaults');
  assert.deepEqual(legacyVaults.map((v) => v.vaultId), [vault.vaultId]);
  check('Q01 canonical collections, limit bounds, opaque cursor roundtrip and legacy arrays');
  process.stdout.write('RESULT 5 independent QA groups passed; Integrated SHA c22cfdf59ee120d7d8c5a75edc79ce97418435c7\n');
} finally {
  await h.app.close();
}

```

## integrated-qa-server.mjs

SHA256: `24499f613b3bfae944a334f33a0e9ac09c5887f3c8e4e83d972b34528c1e0998`

```javascript
import { buildApp } from './integrated-c22cfdf/apps/server/src/app.ts';
const {app}=await buildApp({dbPath:process.env.QA_DB,webRoot:process.env.QA_WEB,origin:'http://127.0.0.1:42917',env:{QP_MODE:'local',QP_ADAPTER:'mock'}});
await app.listen({host:'127.0.0.1',port:42917});
console.log('QA_SERVER_READY');
process.once('SIGTERM',async()=>{await app.close();process.exit(0);});

```

## integrated-extra-browser.mjs

SHA256: `4b550bff39880a050f7dabd9547673e9e87a54861d3de860364781ca81489825`

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
 child=spawn(process.execPath,[resolve(root,'integrated-qa-server.mjs')],{env:{...process.env,QA_DB:resolve(evidence,'ledger.sqlite'),QA_WEB:resolve(root,'integrated-c22cfdf/apps/web/dist')},stdio:['ignore','pipe','pipe']});
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

## integrated-navigation-browser.mjs

SHA256: `b31badf19790766c45728ffa44428c645b6f3b8535c067e49ab5934207f6accb`

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
 child=spawn(process.execPath,[resolve(root,'integrated-qa-server.mjs')],{env:{...process.env,QA_DB:resolve(evidence,'ledger.sqlite'),QA_WEB:resolve(root,'integrated-c22cfdf/apps/web/dist')},stdio:['ignore','pipe','pipe']});
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

## integrated-secret-check.mjs

SHA256: `a4bb028347b39887bad52a8103e1d37cd632117cbb0ffecd141985308b389741`

```javascript
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {findSecretKinds} from './integrated-c22cfdf/tools/check-secrets.mjs';
const failures=[];
async function scan(path,label){const bytes=await readFile(path);if(bytes.includes(0))return false;for(const kind of findSecretKinds(bytes.toString('utf8')))failures.push({file:label,kind});return true;}
for(const sha of ['c22cfdf59ee120d7d8c5a75edc79ce97418435c7']){
 const files=execFileSync('git',['ls-tree','-r','--name-only','-z',sha],{encoding:'utf8'}).split('\0').filter(Boolean);let count=0;
 for(const file of files){if(/(^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example'))failures.push({file,kind:'environment-file'});if(await scan(resolve('.checks/af-qa01/integrated-c22cfdf',file),sha+'/'+file))count++;}
 console.log(sha+': enumerated '+files.length+' exact tracked files, '+count+' text files scanned');
}
const dist='.checks/af-qa01/integrated-c22cfdf/apps/web/dist';let built=0;
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())await walk(p);else if(await scan(p,'built/'+e.name))built++;}}
await walk(dist);console.log('Built UI text files scanned: '+built);assert.deepEqual(failures,[]);console.log('PASS bounded baseline, no candidate paths matched; binary and full-secret-audit coverage excluded');

```

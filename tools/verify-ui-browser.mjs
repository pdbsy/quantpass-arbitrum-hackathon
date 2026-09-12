/* global window, document, innerWidth */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { buildApp } = await import(
  pathToFileURL(resolve(process.env.AF_BACKEND_APP || 'apps/server/src/app.ts')).href
);

// Optional browser tooling stays outside project dependencies. Run on a built UI.
const toolPath =
  process.env.AF_PLAYWRIGHT_PATH || '.checks/browser-tools/node_modules/playwright-core/index.mjs';
const { chromium } = await import(pathToFileURL(resolve(toolPath)).href);
await mkdir('.checks/AF-UI01', { recursive: true });
const evidence = await mkdtemp(resolve('.checks/AF-UI01/browser-'));
const port = Number(process.env.AF_BROWSER_PORT || '4195');
const origin = `http://127.0.0.1:${port}`;
const { app } = await buildApp({
  dbPath: resolve(evidence, 'ledger.sqlite'),
  env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
  origin,
  webRoot: resolve('apps/web/dist'),
});
const checks = [];
let browser;
let page;
try {
  await app.listen({ host: '127.0.0.1', port });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const pageErrors = [];
  const cspErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to (?:apply|execute)/i.test(message.text()))
      cspErrors.push(message.text());
  });
  async function waitReady() {
    await page
      .locator('[data-product-state]')
      .filter({ hasText: /READY|EMPTY/ })
      .waitFor();
  }
  async function state() {
    const response = await page.request.get(`${origin}/api/vaults`);
    assert.equal(response.status(), 200);
    return response.json();
  }
  async function command(type, fields = {}) {
    await page.locator(`[data-product-command="${type}"]`).first().click();
    const dialog = page.locator('dialog[open]');
    for (const [name, value] of Object.entries(fields)) await dialog.locator(`[name="${name}"]`).fill(value);
    const review = dialog.locator('[data-product-review]');
    if (await review.count()) await review.click();
    await dialog.locator('[data-product-confirm]').click();
    await waitReady();
    const close = page.locator('dialog[open] [data-close]').first();
    if (await close.count()) await close.click();
  }
  async function go(route) {
    await page.goto(`${origin}/#/${route}`);
    await page.locator('h1').waitFor();
  }
  await go('home');
  assert.match(await page.locator('h1').first().textContent(), /Good ideas/);
  assert.equal(
    await page.locator('[data-product-state]').isVisible(),
    true,
    'Backend connection state is visible in the supplied UI',
  );
  await page.locator('[data-product-login="alice"]').click();
  await waitReady();
  await page.locator('a[href="#/market"]').first().click();
  await page.locator('[data-product-strategy="core-flow-demo"]').click();
  await page.locator('[data-product-claim="core-flow-demo"]').click();
  const confirmClaim = page.locator('dialog[open] [data-product-confirm]');
  if (await confirmClaim.count()) await confirmClaim.click();
  await waitReady();
  let vault = (await state())[0];
  assert.equal(vault.passes, '1000');
  assert.equal(vault.idle, '0');
  const aliceVault = vault.id;
  checks.push('Homepage -> Marketplace -> API detail -> test Pass: 1000 access, zero funds');
  await go('account/funds');
  await waitReady();
  assert.match(await page.locator('main').textContent(), /alice/i);
  assert.match(await page.locator('main').textContent(), /core-flow-demo/);
  await page.locator('[data-product-strategy="core-flow-demo"]').first().click();
  await command('deposit', { amount: '1500' });
  await command('allocate', { amount: '1000' });
  await command('start');
  await command('reserveBuy', { amount: '100' });
  await command('cancelOrder');
  await command('reserveBuy', { amount: '1000' });
  await command('fillBuy');
  await command('markPosition', { value: '1100' });
  await command('stop');
  vault = (await state())[0];
  assert.equal(vault.status, 'stopping');
  await command('settlePosition', { proceeds: '1100' });
  vault = (await state())[0];
  assert.equal(vault.status, 'stopped');
  assert.equal(vault.idle, '600000000');
  await command('deallocate', { amount: '1000' });
  await command('requestWithdrawal', { amount: '100' });
  await command('cancelWithdrawal');
  await command('requestWithdrawal', { amount: '1600' });
  await command('confirmWithdrawal');
  vault = (await state())[0];
  assert.equal(vault.idle, '0');
  assert.equal(vault.balances.activeNet, '0');
  assert.equal(vault.balances.pending, '0');
  assert.equal(vault.withdrawalsPaid, '1600000000');
  checks.push(
    'All thirteen command types exercised; stop stayed stopping until settlement; 1600 simulated units withdrawn exactly',
  );
  await page.reload();
  await waitReady();
  assert.equal((await state())[0].withdrawalsPaid, '1600000000');
  await page.locator('[data-product-login="bob"]').click();
  await waitReady();
  assert.deepEqual(await state(), []);
  assert.equal((await page.locator('main').textContent()).includes(aliceVault), false);
  await page.locator('[data-product-login="alice"]').click();
  await waitReady();
  assert.equal((await state())[0].id, aliceVault);
  checks.push('Reload persistence and Alice/Bob account isolation');
  await page.screenshot({
    path: resolve(evidence, 'workspace-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  // The real server commits the request; only the browser response is lost.
  let lostBody;
  await page.route(
    '**/api/**/commands',
    async (route) => {
      lostBody = route.request().postDataJSON();
      const committed = await route.fetch();
      assert.equal(committed.status(), 200);
      await route.abort('failed');
      await page.unroute('**/api/**/commands');
    },
    { times: 1 },
  );
  await page.locator('[data-product-command="deposit"]').first().click();
  await page.locator('dialog[open] [name="amount"]').fill('7');
  await page.locator('dialog[open] [data-product-review]').click();
  await page.locator('dialog[open] [data-product-confirm]').click();
  await page.locator('[data-product-retry]').waitFor();
  assert.equal((await state())[0].idle, '7000000');
  const retained = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('quantpass.local.pending-command.v1')),
  );
  assert.deepEqual(retained.command, lostBody);
  await page.reload();
  await page.locator('[data-product-retry]').waitFor();
  const requests = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/commands')) requests.push(request.postDataJSON());
  });
  await page.locator('[data-product-retry]').click();
  await waitReady();
  if (requests.length) assert.deepEqual(requests.at(-1), lostBody);
  const auditResponse = await page.request.get(`${origin}/api/vaults/${aliceVault}/audit`);
  const audit = await auditResponse.json();
  assert.ok(audit.some((event) => event.command_id === lostBody.id));
  assert.equal(await page.evaluate(() => localStorage.getItem('quantpass.local.pending-command.v1')), null);
  assert.equal((await state())[0].idle, '7000000');
  checks.push('Lost POST response + page reload + exact original retry does not duplicate deposit');
  // A second actor in the same account advances the server after this page reviewed.
  await page.locator('[data-product-command="deposit"]').first().click();
  await page.locator('dialog[open] [name="amount"]').fill('5');
  await page.locator('dialog[open] [data-product-review]').click();
  const beforePeer = (await state())[0];
  const peer = await page.request.post(`${origin}/api/vaults/${aliceVault}/commands`, {
    headers: { 'x-quantpass-demo': '1' },
    data: {
      id: 'browser-peer-deposit',
      expectedRevision: beforePeer.revision,
      type: 'deposit',
      amount: '1000000',
    },
  });
  assert.equal(peer.status(), 200);
  await page.locator('dialog[open] [data-product-confirm]').click();
  await page.locator('[data-product-state]').filter({ hasText: /STALE/ }).waitFor();
  assert.equal((await state())[0].idle, '8000000');
  const rejected = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('quantpass.local.pending-command.v1')),
  );
  assert.equal(rejected.command.expectedRevision, beforePeer.revision);
  const conflictClose = page.locator('dialog[open] [data-close]').first();
  if (await conflictClose.count()) await conflictClose.click();
  await page.locator('[data-product-refresh]').click();
  await page.locator('[data-product-dismiss]').click();
  await waitReady();
  assert.equal((await state())[0].idle, '8000000');
  checks.push(
    'Concurrent revision conflict preserves the reviewed payload, makes no extra deposit, and requires explicit refresh/dismissal',
  );
  await context.setOffline(true);
  await page.locator('[data-product-refresh]').click();
  await page
    .locator('[data-product-state]')
    .filter({ hasText: /STALE|DISCONNECTED/ })
    .waitFor();
  assert.equal(await page.locator('[data-product-command="deposit"]').first().isDisabled(), true);
  await context.setOffline(false);
  await page.locator('[data-product-refresh]').click();
  await waitReady();
  checks.push(
    'Offline read is visibly stale/disconnected and disables monetary writes until successful refresh',
  );
  await page.locator('[data-product-command="deposit"]').first().click();
  await page.locator('dialog[open] [name="amount"]').fill('1.0000001');
  await page.locator('dialog[open] [data-product-review]').click();
  await page
    .locator('[data-product-state]')
    .filter({ hasText: /^ERROR$/ })
    .waitFor();
  assert.equal((await state())[0].idle, '8000000');
  assert.equal(await page.locator('dialog[open] [data-product-confirm]').count(), 0);
  await page.locator('dialog[open] [data-close]').first().click();
  await page.locator('[data-product-refresh]').click();
  await waitReady();
  checks.push('Over-precision amount shows ERROR before confirmation and cannot reach the ledger');
  await page.locator('[data-product-command="allocate"]').first().click();
  await page.locator('dialog[open] [name="amount"]').fill('999');
  await page.locator('dialog[open] [data-product-review]').click();
  await page.locator('dialog[open] [data-product-confirm]').click();
  await page
    .locator('[data-product-state]')
    .filter({ hasText: /STALE|ERROR/ })
    .waitFor();
  assert.equal((await state())[0].idle, '8000000');
  const domainClose = page.locator('dialog[open] [data-close]').first();
  if (await domainClose.count()) await domainClose.click();
  await page.locator('[data-product-refresh]').click();
  await page.locator('[data-product-dismiss]').click();
  await waitReady();
  checks.push(
    'Insufficient-idle domain rejection is visibly rejected with no success claim or balance change',
  );
  const v1Probe = await page.request.get(`${origin}/api/v1/strategies?limit=1`);
  if (v1Probe.status() === 200) {
    const firstPage = await v1Probe.json();
    assert.equal(firstPage.items.length, 1);
    assert.equal(typeof firstPage.nextCursor, 'string');
    await go('market');
    await page.locator('[data-product-strategy="satellite-flow-demo"]').click();
    await page.locator('[data-product-claim="satellite-flow-demo"]').click();
    const confirmSatellite = page.locator('dialog[open] [data-product-confirm]');
    if (await confirmSatellite.count()) await confirmSatellite.click();
    await waitReady();
    await command('deposit', { amount: '3' });
    const ownedResponse = await page.request.get(`${origin}/api/v1/vaults`);
    const owned = (await ownedResponse.json()).items;
    const core = owned.find((v) => v.strategyId === 'core-flow-demo');
    const satellite = owned.find((v) => v.strategyId === 'satellite-flow-demo');
    assert.equal(core.balances.idle, '8000000');
    assert.equal(satellite.balances.idle, '3000000');
    assert.notEqual(core.vaultId, satellite.vaultId);
    await go('account/funds');
    assert.match(await page.locator('main').textContent(), /satellite-flow-demo/);
    checks.push(
      'Canonical v1 catalogue/account/all-vault views expose both separately associated strategies; satellite deposit cannot alter core funds',
    );
  } else {
    assert.equal(v1Probe.status(), 404);
    checks.push('Legacy backend capability explicitly detected; no claim of second-strategy or v1 support');
  }
  for (const route of [
    'home',
    'market',
    'rankings',
    'forum',
    'trade/trend',
    'trade/factor',
    'trade/mean',
    'trade/rotate',
    'trade/breakout',
    'trade/pairs',
    'account/trades',
    'account/passes',
    'account/saved',
    'account/notes',
    'account/settings',
  ]) {
    await go(route);
    assert.equal(await page.locator('h1').count(), 1, route);
  }
  await go('trade/trend');
  const fixture = await page.evaluate(() => ({
    series: window.AF.marketData.metrics('trend'),
    cash: window.AF.exchange.read().cash,
  }));
  await page.screenshot({
    path: resolve(evidence, 'fixture-trade-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['home', 'market', 'trade/trend', 'trade/core-flow-demo', 'account/funds']) {
    await go(route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    assert.equal(overflow, false, `mobile overflow on ${route}`);
    await page.screenshot({
      path: resolve(evidence, `mobile-${route.replaceAll('/', '-')}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await go('trade/trend');
  const after = await page.evaluate(() => ({
    series: window.AF.marketData.metrics('trend'),
    cash: window.AF.exchange.read().cash,
  }));
  assert.deepEqual(after, fixture);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(cspErrors, []);
  checks.push(
    'Original six strategy pages and all account sections preserved; mobile pages no horizontal overflow; fixture market unchanged; no page/CSP errors',
  );
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify({ status: 'PASSED', checks }, null, 2));
  console.log(JSON.stringify({ status: 'PASSED', evidence, checks }, null, 2));
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: resolve(evidence, 'failure.png'), fullPage: true, animations: 'disabled' })
      .catch(() => {});
    await writeFile(resolve(evidence, 'failure.txt'), await page.locator('body').innerText()).catch(() => {});
  }
  await writeFile(
    resolve(evidence, 'result.json'),
    JSON.stringify({ status: 'FAILED', checks, error: String(error) }, null, 2),
  );
  console.error('Browser evidence:', evidence);
  throw error;
} finally {
  if (browser) await browser.close();
  await app.close();
}

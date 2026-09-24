/* global window, document, innerWidth */
import assert from 'node:assert/strict';
import { verifyPrototypeBoundaries } from '../test/helpers/prototype-browser-boundaries.mjs';
import { verifyProductLateConfirmIsolation } from '../test/helpers/product-browser-late-confirm.mjs';
import {
  verifyPrototype69Shipped,
  verifyPrototype69StorageUnavailable,
} from '../test/prototype69-native.qualified.test.mjs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
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
const unsupportedChecks = [];
let legacyOnly = false;
const capabilityReport = () => (legacyOnly ? { capabilityProfile: 'legacy-only', unsupportedChecks } : {});
let browser;
let page;
let storageBrowser;
let storageApp;
let cleanupFailure;
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
  async function closePrototypeDialog() {
    const dialog = page.locator('#app-dialog[open]');
    assert.equal(await dialog.count(), 1, 'prototype dialog is open');
    await page.locator('#close-dialog').click();
    await dialog.waitFor({ state: 'hidden' });
  }
  async function prototypeState() {
    return page.evaluate(() => ({ local: window.AF.store.read(), exchange: window.AF.exchange.read() }));
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
  assert.deepEqual(requests, [], 'matching audit receipt must reconcile without a second POST');
  const auditResponse = await page.request.get(`${origin}/api/vaults/${aliceVault}/audit`);
  const audit = await auditResponse.json();
  assert.ok(audit.some((event) => event.command_id === lostBody.id));
  assert.equal(await page.evaluate(() => localStorage.getItem('quantpass.local.pending-command.v1')), null);
  assert.equal((await state())[0].idle, '7000000');
  checks.push('Lost POST response + page reload + audit reconciliation sends no second POST or deposit');
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
    legacyOnly = true;
    checks.push('Legacy backend capability explicitly detected; no claim of second-strategy or v1 support');
  }
  const v1Supported = v1Probe.status() === 200;

  // The production API catalogue is part of the same visible market page as the imported prototype.
  await go('market');
  await page.locator('[data-product-search]').fill('missing-api-strategy');
  assert.match(await page.locator('[data-product-catalogue]').textContent(), /No API strategies match/);
  await page.locator('[data-product-search]').fill('core-flow-demo');
  assert.match(await page.locator('[data-product-catalogue]').textContent(), /core-flow-demo/);
  await page.locator('[data-product-status-filter]').selectOption('stopped');
  assert.match(await page.locator('[data-product-catalogue]').textContent(), /core-flow-demo/);
  await page.locator('[data-product-environment-filter]').selectOption('TEST_ONLY');
  assert.match(await page.locator('[data-product-catalogue]').textContent(), /TEST_ONLY/);

  await go('home');
  await page.locator('[data-home-filter="Mean Reversion"]').click();
  assert.equal(await page.locator('#strategy-grid .strategy-card:visible').count(), 1);
  await page.locator('#strategy-search').fill('no-such-home-idea');
  assert.equal(await page.locator('#no-results').isVisible(), true);
  assert.equal(await page.locator('#result-count').textContent(), '00 SPECIMENS');
  await page.locator('#reset-search').click();
  assert.equal(await page.locator('#strategy-grid .strategy-card:visible').count(), 3);
  await page.locator('#press-button').click();
  await page.locator('#machine.issued').waitFor();
  assert.match(await page.locator('#press-button').textContent(), /Press again/);

  await go('market');
  await page.locator('[data-product-search]').fill('');
  await page.locator('[data-product-status-filter]').selectOption('all');
  await page.locator('[data-product-environment-filter]').selectOption('all');
  await page.locator('#market-search').fill('no-such-market-idea');
  assert.match(await page.locator('#market-results').textContent(), /We have not found that idea yet/);
  await page.locator('[data-action="market-reset"]').click();
  assert.equal(await page.locator('#market-results .market-card').count(), 6);
  await page.locator('[data-market-category="Trend"]').click();
  assert.equal(await page.locator('#market-results .market-card').count(), 2);
  await page.locator('#market-frequency').selectOption({ label: 'Medium' });
  assert.equal(await page.locator('#market-results .market-card').count(), 1);
  await page.locator('[data-market-category="All"]').click();
  await page.locator('#market-frequency').selectOption({ label: 'All frequencies' });
  await page.locator('#market-sort').selectOption('name');
  await page.locator('#market-results [data-save="trend"]').click();
  await page.locator('#only-saved').check();
  assert.equal(await page.locator('#market-results .market-card').count(), 1);
  await page.locator('#only-saved').uncheck();
  await page.locator('#market-results [data-compare="trend"]').check();
  await page.locator('#market-results [data-compare="factor"]').check();
  assert.equal(await page.locator('[data-action="compare-open"]').isEnabled(), true);
  await page.locator('[data-action="compare-open"]').click();
  assert.equal(await page.locator('#app-dialog[open] .compare-table').isVisible(), true);
  assert.match(await page.locator('#app-dialog[open]').textContent(), /Compare methods/);
  await closePrototypeDialog();
  await page.locator('[data-action="compare-clear"]').click();
  assert.equal(await page.locator('#compare-tray').textContent(), '');

  await go('rankings');
  await page.locator('[data-rank-mode="volume"]').click();
  await page.locator('[data-rank-range="30d"]').click();
  await page.locator('#rank-category').selectOption({ label: 'Trend' });
  assert.equal(await page.locator('[data-ranking-row]').count(), 2);
  await page.locator('#rank-search').fill('no-such-ranked-idea');
  assert.match(await page.locator('#ranking-results').textContent(), /No ideas match these filters yet/);
  await page.locator('#rank-search').fill('');
  await page.locator('#rank-saved').check();
  assert.equal(await page.locator('[data-ranking-row="trend"]').count(), 1);
  await page.locator('[data-v3-action="rank-method"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /Four questions/);
  await closePrototypeDialog();
  checks.push(
    'Prototype Home, Market, and Rankings filters expose selected, empty, reset, and comparison states',
  );

  await go('forum');
  await page.locator('#forum-search').fill('no-such-forum-question');
  assert.match(await page.locator('#forum-results').textContent(), /That question has not been written yet/);
  await page.locator('#forum-search').fill('');
  await page.locator('[data-forum-category="Build Logs"]').click();
  assert.match(await page.locator('#forum-results').textContent(), /Treat an unknown result/);
  await page.locator('#forum-sort').selectOption('replies');
  await page.locator('[data-forum-category="All"]').click();
  await page.locator('a[href="#/forum/post/backtest"]').first().click();
  await page.locator('[data-like="backtest"]').click();
  await page.locator('[data-bookmark="backtest"]').click();
  assert.equal(await page.locator('[data-like="backtest"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-bookmark="backtest"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#comment-body').fill('A visible local reply for the browser behavior contract.');
  await page.locator('#comment-form button[type="submit"]').click();
  assert.match(await page.locator('.comments-section').textContent(), /visible local reply/);

  await go('forum');
  await page.locator('[data-action="compose"]').first().click();
  await page.locator('#compose-title').fill('Visible browser note');
  await page
    .locator('#compose-body')
    .fill(
      'This local note verifies draft preservation, publication, reply, and deletion through visible controls.',
    );
  await page.locator('#compose-category').selectOption({ label: 'Workshop Proposals' });
  await page.locator('#compose-form [data-close]').click();
  await page.locator('#app-dialog').waitFor({ state: 'hidden' });
  await go('account/notes');
  assert.match(await page.locator('main').textContent(), /UNFINISHED \/ YOUR DRAFT/);
  assert.match(await page.locator('main').textContent(), /Visible browser note/);
  await page.locator('[data-action="compose"]').last().click();
  assert.equal(await page.locator('#compose-title').inputValue(), 'Visible browser note');
  await page.locator('#compose-form button[type="submit"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/forum/post/local-'));
  await page.locator('h1').filter({ hasText: 'Visible browser note' }).waitFor();
  assert.match(await page.locator('h1').textContent(), /Visible browser note/);
  await page.locator('#comment-body').fill('Reply on the local note before deletion.');
  await page.locator('#comment-form button[type="submit"]').click();
  assert.match(await page.locator('.comments-section').textContent(), /before deletion/);
  await page.locator('[data-delete-post]').click();
  await page.locator('[data-delete-post-confirm]').click();
  await page.waitForFunction(() => window.location.hash === '#/account/notes');
  await page.waitForFunction(
    () => !document.querySelector('main').textContent.includes('Visible browser note'),
  );
  assert.equal((await page.locator('main').textContent()).includes('Visible browser note'), false);

  await go('account/saved');
  assert.match(await page.locator('main').textContent(), /Ridgeline/);
  assert.match(await page.locator('main').textContent(), /A beautiful backtest/);
  await go('account/settings');
  await page.locator('[data-action="profile"]').first().click();
  await page.locator('#profile-name').fill('Browser Researcher');
  await page.locator('#profile-bio').fill('Visible local profile state.');
  await page.locator('#profile-form button[type="submit"]').click();
  await page.locator('.profile-details h2').filter({ hasText: 'Browser Researcher' }).waitFor();
  assert.equal(await page.locator('.profile-details h2').textContent(), 'Browser Researcher');
  await page.locator('[data-action="reset-confirm"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /Start a fresh demo/);
  await page.locator('#app-dialog[open] [data-close]').click();
  await page.locator('#app-dialog').waitFor({ state: 'hidden' });
  checks.push(
    'Prototype Forum and Account flows preserve bookmarks, drafts, local notes, replies, deletion, and profile edits',
  );

  await go('trade/core-flow-demo');
  await page.locator('[data-product-command="deposit"]').first().click();
  await page.locator('dialog[open] [name="amount"]').fill('0');
  await page.locator('dialog[open] [data-product-review]').click();
  assert.match(
    await page.locator('dialog[open] [data-product-dialog-error]').textContent(),
    /greater than zero/,
  );
  await page.locator('dialog[open] [data-close]').first().click();
  await page.locator('[data-product-refresh]').click();
  await waitReady();
  await page.locator('[data-product-command="cancelOrder"]').first().click();
  await page.locator('dialog[open] [data-product-review]').click();
  assert.match(
    await page.locator('dialog[open] [data-product-dialog-error]').textContent(),
    /Select an existing pending operation/,
  );
  await page.locator('dialog[open] [data-close]').first().click();
  await page.locator('[data-product-refresh]').click();
  await waitReady();

  await go('trade/factor');
  await page.locator('#trade-panel [data-trade-pane="pass"]').click();
  const localBeforeClaim = (await prototypeState()).local;
  await page.locator('#trade-panel [data-claim="factor"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /Claim demo Pass/);
  await page.locator('#app-dialog[open] [data-close]').click();
  assert.equal(Boolean((await prototypeState()).local.passes.factor), false);
  await page.locator('#trade-panel [data-claim="factor"]').click();
  await page.locator('#app-dialog[open] [data-action="commit"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /recorded locally/i);
  await closePrototypeDialog();
  let visibleState = await prototypeState();
  assert.equal(Boolean(visibleState.local.passes.factor), true);
  assert.equal(visibleState.local.idle, localBeforeClaim.idle);

  await page.locator('#trade-panel [data-trade-pane="funds"]').first().click();
  await page.locator('#allocate-amount').fill('1500');
  await page.locator('#allocate-form [name="consent"]').check();
  await page.locator('#allocate-form button[type="submit"]').click();
  assert.match(
    await page.locator('#allocate-error').textContent(),
    /exceeds the 1,000 DEMO allocation limit/,
  );
  await page.locator('#allocate-amount').fill('250');
  await page.locator('#allocate-form button[type="submit"]').click();
  await page.locator('#app-dialog[open] [data-action="commit"]').click();
  await closePrototypeDialog();
  visibleState = await prototypeState();
  assert.equal(visibleState.local.allocated.factor, 25_000);
  await page.locator('#trade-panel [data-release="factor"]').click();
  await page.locator('#cash-amount').fill('50');
  await page.locator('#cash-form button[type="submit"]').click();
  await page.locator('#app-dialog[open] [data-action="commit"]').click();
  await closePrototypeDialog();
  visibleState = await prototypeState();
  assert.equal(visibleState.local.allocated.factor, 20_000);

  await go('account/funds');
  await page.locator('[data-cash="deposit"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /Add demo funds/);
  await page.locator('#app-dialog[open] [data-close]').click();
  await page.locator('[data-cash="withdraw"]').click();
  await page.locator('#cash-amount').fill('999999');
  await page.locator('#cash-form button[type="submit"]').click();
  assert.match(await page.locator('#cash-error').textContent(), /Only idle demo funds can be withdrawn/);
  await page.locator('#cash-amount').fill('10');
  await page.locator('#cash-form button[type="submit"]').click();
  await page.locator('#app-dialog[open] [data-action="commit"]').click();
  await closePrototypeDialog();
  assert.equal((await prototypeState()).local.pending.length, 1);
  await page.locator('[data-withdraw-cancel]').click();
  await page.locator('#app-dialog[open] [data-action="commit"]').click();
  await closePrototypeDialog();
  visibleState = await prototypeState();
  assert.equal(visibleState.local.pending.length, 0);
  assert.equal(visibleState.local.netFunding, localBeforeClaim.netFunding);
  checks.push(
    'Product API and prototype trial controls expose zero or missing-operation errors, cancel, allocation, release, and withdrawal states',
  );

  await go('trade/trend');
  await page.locator('#trade-panel [data-trade-pane="market"]').click();
  await page.locator('[data-price-range="90d"]').click();
  assert.equal(await page.locator('[data-price-range="90d"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-price-style="line"]').click();
  assert.equal(await page.locator('[data-price-style="line"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-return-range="7d"]').click();
  assert.equal(await page.locator('[data-return-range="7d"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-v3-chart="price"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('#price-readout').textContent(), /UTC/);
  await page.locator('[data-asset="0"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /RESEARCH RELATION/);
  await closePrototypeDialog();
  await page.locator('#pass-qty').fill('0');
  await page.locator('#pass-order-form button[type="submit"]').click();
  assert.match(await page.locator('#pass-order-error').textContent(), /whole number of Passes/);
  await page.locator('#pass-qty').fill('2');
  await page.locator('.order-settings summary').click();
  await page.locator('#pass-slippage').selectOption('100');
  await page.locator('#pass-order-form button[type="submit"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /Review buy: 2 Passes/);
  await page.locator('#app-dialog[open] [data-close]').click();
  await page.locator('#pass-order-form button[type="submit"]').click();
  await page.locator('#app-dialog[open] [data-v3-action="commit-order"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /purchase recorded/);
  await closePrototypeDialog();
  visibleState = await prototypeState();
  assert.equal(visibleState.exchange.positions.trend.qty, 2);
  await page.locator('#trade-panel [data-pass-side="sell"]').click();
  await page.locator('#trade-panel [data-pass-shortcut="50%"]').click();
  assert.equal(await page.locator('#pass-qty').inputValue(), '1');
  await page.locator('#pass-order-form button[type="submit"]').click();
  await page.locator('#app-dialog[open] [data-v3-action="commit-order"]').click();
  assert.match(await page.locator('#app-dialog[open]').textContent(), /sale recorded/);
  await closePrototypeDialog();
  visibleState = await prototypeState();
  assert.equal(visibleState.exchange.positions.trend.qty, 1);
  assert.equal(visibleState.exchange.orders.length, 2);
  await go('account/trades');
  assert.equal(await page.locator('.fill-table tbody tr').count(), 2);
  assert.match(await page.locator('.portfolio-table').textContent(), /1 Pass/);
  await page.screenshot({
    path: resolve(evidence, 'visible-product-paths.png'),
    fullPage: true,
    animations: 'disabled',
  });
  checks.push(
    'Prototype Pass trading exposes chart controls, asset context, invalid input, reviewed buy and sell receipts, and account readback',
  );

  const boundaryCases = await verifyPrototypeBoundaries(page, { v1Supported, unsupportedChecks });
  await writeFile(
    resolve(evidence, 'prototype-boundaries.json'),
    JSON.stringify({ scope: 'LOCAL_DEMO_MODEL', assertions: boundaryCases }, null, 2) + '\n',
  );
  checks.push(
    `Prototype model: ${boundaryCases.length} rejection, atomicity, settlement, and corrupt-storage assertions`,
  );
  if (v1Supported) checks.push(...(await verifyProductLateConfirmIsolation(page, origin)));
  else
    unsupportedChecks.push({
      name: 'v1-late-confirm-claim-and-command',
      status: 'NOT_SUPPORTED',
      execution: 'NOT_RUN',
      requiredCapability: 'v1',
      equivalentCoverage: false,
    });
  checks.push(...(await verifyPrototype69Shipped(page, { origin })));

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

  // Keep the real unavailable-storage environment separate from the normal
  // journey, including browser cookies, fixture state, backend and SQLite file.
  const reservation = createServer();
  await new Promise((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', done);
  });
  const storagePort = reservation.address().port;
  await new Promise((done, reject) => reservation.close((error) => (error ? reject(error) : done())));
  const storageOrigin = `http://127.0.0.1:${storagePort}`;
  ({ app: storageApp } = await buildApp({
    dbPath: resolve(evidence, 'storage-ledger.sqlite'),
    env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
    origin: storageOrigin,
    webRoot: resolve('apps/web/dist'),
  }));
  await storageApp.listen({ host: '127.0.0.1', port: storagePort });
  storageBrowser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--disable-local-storage'],
  });
  const storageContext = await storageBrowser.newContext({ viewport: { width: 1440, height: 1000 } });
  const storagePage = await storageContext.newPage();
  checks.push(...(await verifyPrototype69StorageUnavailable(storagePage, { origin: storageOrigin })));
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: resolve(evidence, 'failure.png'), fullPage: true, animations: 'disabled' })
      .catch(() => {});
    try {
      await writeFile(resolve(evidence, 'failure.txt'), await page.locator('body').innerText());
    } catch {
      // A closed page must not hide the original failure or prevent its report.
    }
  }
  await writeFile(
    resolve(evidence, 'result.json'),
    JSON.stringify({ status: 'FAILED', checks, error: String(error), ...capabilityReport() }, null, 2),
  );
  console.error('Browser evidence:', evidence);
  throw error;
} finally {
  const cleanup = await Promise.allSettled([
    Promise.resolve().then(() => browser?.close()),
    Promise.resolve().then(() => app.close()),
    Promise.resolve().then(() => storageBrowser?.close()),
    Promise.resolve().then(() => storageApp?.close()),
  ]);
  cleanupFailure = cleanup.find((result) => result.status === 'rejected');
}
if (cleanupFailure) {
  await writeFile(
    resolve(evidence, 'result.json'),
    JSON.stringify(
      { status: 'FAILED', checks, error: String(cleanupFailure.reason), ...capabilityReport() },
      null,
      2,
    ),
  );
  throw cleanupFailure.reason;
}
await writeFile(
  resolve(evidence, 'result.json'),
  JSON.stringify({ status: 'PASSED', checks, ...capabilityReport() }, null, 2),
);
console.log(JSON.stringify({ status: 'PASSED', evidence, checks, ...capabilityReport() }, null, 2));

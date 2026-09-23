import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadCoverageTools, sha256 } from '../tools/coverage/toolchain.mjs';
import { instrumentSnapshot, prototypePath } from '../tools/coverage/inventory.mjs';
import { browserCoverageSources, replayBrowserCoverage } from '../tools/coverage/browser-evidence.mjs';
import { createBrowserCoverageLifecycle } from '../tools/coverage/browser-lifecycle.mjs';
import { mergeObserved } from '../tools/coverage/evidence.mjs';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, prototypePath), 'utf8');
// Branch IDs below belong only to this protected source, never to a changed graph.
const sourceSha256 = '949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45';
const origin = 'http://127.0.0.1:19469';
const trialKey = 'alphaforge.prototype.v3';
const exchangeKey = 'alphaforge.passmarket.v3';

test('protected prototype native and admitted persistence boundaries', { timeout: 120_000 }, async (t) => {
  assert.equal(sha256(source), sourceSha256);
  assert.equal(
    execFileSync('git', ['show', 'HEAD:' + prototypePath], { cwd: root, encoding: 'utf8' }),
    source,
  );
  assert.ok(process.env.AF_QUALIFIED_COVERAGE_TOOLS, 'qualified instrumenter required');
  assert.ok(process.env.AF_QUALIFIED_BROWSER_TOOLS, 'qualified browser required');
  const tools = await loadCoverageTools(root, {
    instrumentationDirectory: process.env.AF_QUALIFIED_COVERAGE_TOOLS,
    browserDirectory: process.env.AF_QUALIFIED_BROWSER_TOOLS,
  });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
  // A targeted source snapshot, explicitly not a full-candidate coverage report.
  const { manifest, generated } = await instrumentSnapshot(
    root,
    {
      candidateCommit: head,
      candidateTree: tree,
      trackedPaths: [prototypePath],
      sources: {},
      prototype: { path: prototypePath, sha256: sourceSha256, text: source },
    },
    tools,
  );
  assert.equal([...source.matchAll(/<script>[\s\S]*?<\/script>/g)].length, 1);
  const html = source.replace(
    /<script>[\s\S]*?<\/script>/,
    () => '<script>' + generated[prototypePath].code + '</script>',
  );
  const output = resolve(root, '.checks/prototype69-native', randomUUID());
  mkdirSync(output, { recursive: true });
  const write = (file, value) => writeFileSync(resolve(output, file), JSON.stringify(value, null, 2) + '\n');
  write('manifest.json', manifest);
  write('generated.json', generated);
  const tracker = createBrowserCoverageLifecycle({
    manifest,
    outputDirectory: resolve(output, 'raw'),
    loaded: new Set([prototypePath]),
    workflow: 'PROTOTYPE69_TARGETED',
  });
  const browser = await tools.chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  t.after(() => browser.close());
  const observations = [];
  const evidence = [];
  async function session(options = {}) {
    const { denied = false, ...browserOptions } = options;
    const context = await browser.newContext(browserOptions);
    t.after(() => context.close());
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) return route.abort();
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: denied ? { 'Content-Security-Policy': 'sandbox allow-scripts' } : {},
        body: html,
      });
    });
    const page = await context.newPage();
    tracker.registerPage(page);
    page.setDefaultTimeout(7_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/#/home');
    await page.locator('#press-button').waitFor();
    return { page, context, errors };
  }
  async function navigate(page, path, selector) {
    // Hash navigation is a public router input; no AF.view/private state writes.
    await page.evaluate('location.hash = ' + JSON.stringify('#' + path));
    await page.locator(selector).first().waitFor();
  }
  async function capture(s, name, targets, metadata = {}) {
    assert.deepEqual(s.errors, [], name + ': no uncaught page error');
    const raw = JSON.parse(await s.page.evaluate('JSON.stringify(globalThis.__coverage__)'));
    const canonical = browserCoverageSources(manifest, raw, new Set([prototypePath]));
    write(name + '-raw.json', raw);
    write(name + '-canonical.json', canonical);
    const hits = targets.map(([id, index]) => {
      const count = canonical[prototypePath].coverage.b[id][index];
      assert.ok(count > 0, name + ': expected branch ' + id + '/' + index);
      return { id, index, count };
    });
    observations.push({ name, targets: hits, ...metadata });
    write('observations.json', observations);
    await pageClose(s.page);
    await s.context.close();
  }
  async function pageClose(page) {
    // Original lifecycle owns capture/reset/close. Never sum browser counters here.
    await page.close();
  }
  async function closeDialog(page) {
    await page.locator('#close-dialog').click();
    await page.locator('#app-dialog').waitFor({ state: 'hidden' });
  }
  async function resetFromSecondWindow(s) {
    const other = await s.context.newPage();
    tracker.registerPage(other);
    other.setDefaultTimeout(7_000);
    other.on('pageerror', (error) => s.errors.push(error.message));
    await other.goto(origin + '/#/account/settings');
    await other.locator('[data-action="reset-confirm"]').click();
    await other.locator('[data-action="reset-run"]').click();
    await other.waitForFunction('AF.store.read().history.length === 0 && !AF.store.read().passes.factor');
    await other.close();
  }

  await t.test('trial allocation rejects unowned access and disables a full quota', async () => {
    const s = await session();
    const { page } = s;
    await navigate(page, '/trade/factor', '#pass-order-form');
    await page.locator('[data-trade-pane="pass"]').click();
    await page.locator('[data-trade-pane="funds"]').click();
    assert.equal(await page.locator('#allocate-form').count(), 0);
    assert.match(await page.locator('#trade-panel').innerText(), /Pass|access/i);
    await navigate(page, '/trade/trend', '#trade-panel');
    await page.locator('#allocate-form').waitFor();
    await page.locator('#allocate-amount').fill('1000');
    await page.locator('[name="consent"]').check();
    await page.locator('#allocate-form [type="submit"]').click();
    await page.locator('[data-action="commit"]').click();
    await closeDialog(page);
    assert.equal(await page.locator('#allocate-form [type="submit"]').isDisabled(), true);
    const state = await page.evaluate('AF.store.read()');
    assert.equal(state.allocated.trend, 100000);
    assert.equal(state.idle, 900000);
    assert.equal(state.netFunding, 1000000);
    await capture(s, 'trial-quota', [
      ['287', 0],
      ['289', 0],
    ]);
  });

  await t.test(
    'withdrawing all idle funds preserves pending money and disables a second request',
    async () => {
      const s = await session();
      const { page } = s;
      await navigate(page, '/account/funds', '[data-cash="withdraw"]');
      await page.locator('[data-cash="withdraw"]').click();
      await page.locator('#cash-form [name="amount"]').fill('10000');
      await page.locator('#cash-form [type="submit"]').click();
      await page.locator('[data-action="commit"]').click();
      await page.locator('[data-route="/account/funds"]').click();
      await page.locator('#app-dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-cash="withdraw"]').isDisabled(), true);
      const state = await page.evaluate('AF.store.read()');
      assert.equal(state.idle, 0);
      assert.equal(state.pending.length, 1);
      assert.equal(state.pending[0].amount, state.netFunding);
      await capture(s, 'withdraw-idle', [
        ['255', 0],
        ['383', 0],
      ]);
    },
  );

  await t.test('admitted persisted position hits the size guard without changing money', async () => {
    const s = await session();
    const { page } = s;
    const state = await page.evaluate('AF.exchange.read()');
    state.positions.trend = { qty: 1000000, cost: 0 };
    // External persisted-input fixture, never an AF private-state mutation.
    await page.evaluate(
      'localStorage.setItem(' +
        JSON.stringify(exchangeKey) +
        ',' +
        JSON.stringify(JSON.stringify(state)) +
        ')',
    );
    await page.reload();
    await navigate(page, '/trade/trend', '#pass-order-form');
    assert.deepEqual(await page.evaluate('AF.exchange.read()'), state, 'validator accepted fixture');
    await page.locator('#pass-qty').fill('1');
    await page.locator('#pass-order-form [type="submit"]').click();
    assert.match(await page.locator('#pass-order-error').innerText(), /position limit/);
    assert.equal(await page.locator('#app-dialog').isVisible(), false);
    assert.deepEqual(await page.evaluate('AF.exchange.read()'), state);
    await navigate(page, '/account/trades', '.portfolio-table');
    const pnl = page.locator('.portfolio-table tbody tr').first().locator('td').nth(3);
    assert.match(await pnl.getAttribute('class'), /up/);
    assert.match(await pnl.innerText(), /^\+/);
    await capture(
      s,
      'persisted-position',
      [
        ['151', 0],
        ['341', 0],
        ['342', 0],
      ],
      { inputClass: 'VALID_PERSISTENCE_FIXTURE' },
    );
  });

  await t.test('admitted legacy history safely renders absent type and retired strategy', async () => {
    const s = await session();
    const { page } = s;
    const state = await page.evaluate('AF.store.read()');
    state.history = [
      { id: 'audit-history', amount: 0, strategy: '<retired-sample>', at: '2026-09-12T00:00:00Z' },
    ];
    await page.evaluate(
      'localStorage.setItem(' + JSON.stringify(trialKey) + ',' + JSON.stringify(JSON.stringify(state)) + ')',
    );
    await page.reload();
    await navigate(page, '/account/funds', '.ledger-entry');
    assert.equal(await page.locator('.ledger-entry strong').innerText(), '');
    assert.match(await page.locator('.ledger-entry').innerText(), /<retired-sample>/);
    assert.equal(await page.locator('retired-sample').count(), 0);
    await capture(
      s,
      'persisted-history',
      [
        ['166', 1],
        ['254', 1],
      ],
      { inputClass: 'VALID_PERSISTENCE_FIXTURE' },
    );
  });

  await t.test('saved and comparison controls survive full renderer round trips', async () => {
    const s = await session();
    const { page } = s;
    await navigate(page, '/market', '#market-sort');
    await page.locator('[data-save="trend"]').first().click();
    await page.locator('[data-compare="trend"]').check();
    await page.locator('#market-sort').selectOption('saved');
    await page.locator('#only-saved').check();
    await navigate(page, '/rankings', '#rank-saved');
    await page.locator('#rank-saved').check();
    await navigate(page, '/market', '#market-sort');
    assert.equal(await page.locator('#market-sort').inputValue(), 'saved');
    assert.equal(await page.locator('#only-saved').isChecked(), true);
    assert.equal(await page.locator('[data-compare="trend"]').isChecked(), true);
    assert.equal(await page.locator('.market-card').count(), 1);
    await navigate(page, '/rankings', '#rank-saved');
    assert.equal(await page.locator('#rank-saved').isChecked(), true);
    await capture(s, 'saved-renderers', [
      ['185', 0],
      ['232', 0],
      ['234', 0],
      ['337', 0],
    ]);
  });

  await t.test('mobile price/returns charts and reduced-motion press use native input', async () => {
    const s = await session({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const { page } = s;
    await page.locator('#press-button').click();
    await page.waitForFunction(
      'AF.store.read().samplePass === true && !document.querySelector("#press-button").disabled',
    );
    await navigate(page, '/trade/trend', '[data-v3-chart="price"]');
    const box = await page.locator('[data-v3-chart="price"]').boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await page.locator('#price-cursor').getAttribute('visibility'), 'visible');
    await page.locator('[data-v3-chart="returns"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#returns-cursor').getAttribute('visibility'), 'visible');
    await page.locator('[data-trade-tab="research"]').click();
    assert.match(await page.locator('#trade-content').innerText(), /THE IDEA/);
    await navigate(page, '/account/not-a-tab', '.account-section');
    assert.match(await page.locator('.account-section').innerText(), /PASS COLLECTION/);
    await capture(s, 'mobile-native', [
      ['213', 0],
      ['460', 0],
      ['567', 0],
      ['281', 1],
      ['272', 1],
    ]);
  });

  await t.test(
    'native opaque-origin storage denial keeps settings, trading and draft status honest',
    async () => {
      const s = await session({ denied: true });
      const { page } = s;
      assert.equal(await page.evaluate('AF.store.available()'), false);
      assert.equal(await page.evaluate('AF.exchange.available()'), false);
      await navigate(page, '/account/settings', '.account-section');
      assert.match(await page.locator('.account-section').innerText(), /SESSION ONLY/);
      await navigate(page, '/trade/trend', '#pass-order-form');
      assert.match(await page.locator('#trade-panel').innerText(), /session|storage/i);
      await navigate(page, '/forum', '[data-action="compose"]');
      await page.locator('[data-action="compose"]').first().click();
      assert.match(await page.locator('#draft-status').innerText(), /session/i);
      await page.locator('#compose-title').fill('Session draft');
      await page.locator('#compose-body').fill('This draft belongs only to the current local session.');
      assert.match(await page.locator('#draft-status').innerText(), /session only/i);
      await closeDialog(page);
      await page.locator('[data-action="compose"]').first().click();
      assert.equal(await page.locator('#compose-title').inputValue(), 'Session draft');
      await capture(
        s,
        'native-storage-denied',
        [
          ['268', 1],
          ['269', 1],
          ['303', 0],
          ['394', 1],
          ['396', 1],
        ],
        { inputClass: 'NATIVE_CSP_SANDBOX_OPAQUE_ORIGIN' },
      );
    },
  );

  await t.test('exported APIs have explicit API-only coverage and preserve monetary state', async () => {
    const s = await session();
    const { page } = s;
    const before = await page.evaluate('({trial:AF.store.read(),exchange:AF.exchange.read()})');
    const checks = await page.evaluate(
      '(() => { const max=AF.exchange.maxBuy("trend"); const explicit=AF.exchange.maxBuy("trend",50); const spark=AF.charts.spark("trend"); const expected=AF.charts.spark("trend","7d"); AF.rankings.refresh(); const state=AF.store.dispatch({type:"last",strategy:"factor"}); return {max,explicit,spark,expected,state,exchange:AF.exchange.read()}; })()',
    );
    assert.equal(checks.max, checks.explicit);
    assert.equal(checks.spark, checks.expected);
    assert.equal(checks.state.lastStrategy, 'factor');
    assert.equal(checks.state.revision, before.trial.revision + 1);
    assert.equal(checks.state.idle, before.trial.idle);
    assert.deepEqual(checks.state.allocated, before.trial.allocated);
    assert.deepEqual(checks.exchange, before.exchange);
    const fixedInputs = await page.evaluate(
      '({rank7d:AF.marketData.ranking({mode:"price",range:"7d"}).map(s=>({id:s.id,change:s.market.change})),artKeys:AF.strategies.map(s=>({id:s.id,art:s.art,present:!!AF.art[s.art],short:s.short})),topicReplies:AF.topics.map(p=>({id:p.id,hasReplies:Array.isArray(p.replies)}))})',
    );
    write('fixed-inputs.json', fixedInputs);
    await capture(
      s,
      'exported-apis',
      [
        ['67', 5],
        ['165', 0],
        ['219', 0],
        ['334', 1],
      ],
      { inputClass: 'EXPORTED_API_ONLY' },
    );
  });

  await t.test('native cross-window reset and bookmark sync reject a stale allocation form', async () => {
    const s = await session();
    const { page } = s;
    await navigate(page, '/trade/factor', '#pass-order-form');
    await page.locator('[data-trade-pane="pass"]').click();
    await page.locator('[data-claim="factor"]').click();
    await page.locator('[data-action="commit"]').click();
    await closeDialog(page);
    await page.locator('[data-trade-pane="funds"]').first().click();
    await page.locator('#allocate-amount').fill('10');
    await page.locator('[name="consent"]').check();
    await resetFromSecondWindow(s);
    await page.locator('[data-save="factor"]').first().click();
    assert.equal(await page.locator('#allocate-form').count(), 1, 'old rendered form remains');
    const before = await page.evaluate('AF.store.read()');
    assert.equal(before.passes.factor, undefined, 'bookmark dispatch synced reset ledger');
    await page.locator('#allocate-form [type="submit"]').click();
    assert.match(await page.locator('#allocate-error').innerText(), /Claim the demo Pass/);
    assert.equal(await page.locator('#app-dialog').isVisible(), false);
    assert.deepEqual(await page.evaluate('AF.store.read()'), before);
    await capture(s, 'stale-allocation', [['405', 0]], { inputClass: 'NATIVE_TWO_WINDOWS' });
  });

  await t.test('stale claim after a real second-window reset yields an existing-Pass receipt', async () => {
    const s = await session();
    const { page } = s;
    const initial = await page.evaluate('AF.store.read()');
    initial.passes = {};
    await page.evaluate(
      'localStorage.setItem(' +
        JSON.stringify(trialKey) +
        ',' +
        JSON.stringify(JSON.stringify(initial)) +
        ')',
    );
    await page.reload();
    await navigate(page, '/trade/trend', '#pass-order-form');
    await page.locator('[data-trade-pane="pass"]').click();
    await page.locator('[data-claim="trend"]').waitFor();
    await resetFromSecondWindow(s);
    await page.locator('[data-save="trend"]').first().click();
    assert.equal(await page.locator('[data-claim="trend"]').count(), 1);
    const before = await page.evaluate('AF.store.read()');
    assert.ok(before.passes.trend);
    assert.deepEqual(before.history, []);
    await page.locator('[data-claim="trend"]').click();
    await page.locator('[data-action="commit"]').click();
    assert.match(await page.locator('#app-dialog').innerText(), /Existing demo Pass/);
    assert.deepEqual(await page.evaluate('AF.store.read()'), before);
    await capture(s, 'stale-claim-receipt', [['428', 1]], {
      inputClass: 'VALID_PERSISTENCE_THEN_NATIVE_TWO_WINDOWS',
    });
  });

  const lifecycle = await tracker.finish();
  const replay = replayBrowserCoverage({
    manifest,
    outputDirectory: resolve(output, 'raw'),
    index: lifecycle.index,
  });
  const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(replay.observations), byId(lifecycle.observations));
  const merged = mergeObserved(manifest, replay.observations);
  assert.deepEqual(merged.incomplete, []);
  write('lifecycle.json', lifecycle);
  write('replayed-coverage.json', merged);
  assert.equal(observations.length, 10, 'all ten assertion groups must finish before a receipt');
  evidence.push({
    scope: 'TARGETED_PROTOTYPE_ONLY_NOT_FULL_CANDIDATE_REPORT',
    sourceSha256,
    candidateCommit: head,
    candidateTree: tree,
    toolDigest: tools.descriptorSha256,
    browserVersion: browser.version(),
    testFileSha256: sha256(readFileSync(import.meta.filename)),
    observations: observations.length,
    sourceModified: false,
  });
  write('receipt.json', evidence);
  t.diagnostic('Prototype observations: ' + output);
});

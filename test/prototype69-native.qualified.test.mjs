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
const sourceSha256 = 'b9671bca14a388d08a7e5db492f831c5e02fcb15f8ff57baab8a65e863d4ff35';
const origin = 'http://127.0.0.1:19469';
const trialKey = 'alphaforge.prototype.v3';
const exchangeKey = 'alphaforge.passmarket.v3';

// The caller owns a separate real Chrome launched with --disable-local-storage.
// Use the driver's existing qualified launch path so its lifecycle owns all counts.
export async function verifyPrototype69StorageUnavailable(page, { origin: shippedOrigin }) {
  assert.equal(sha256(source), sourceSha256);
  const errors = [];
  const writes = [];
  const onError = (error) => errors.push(error.message);
  const onRequest = (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      writes.push({ method: request.method(), pathname: new URL(request.url()).pathname });
  };
  page.on('pageerror', onError);
  page.on('request', onRequest);
  try {
    await page.goto(shippedOrigin + '/#/account/settings');
    await page.locator('[data-product-state]').waitFor();
    assert.equal(
      await page.evaluate('localStorage === null'),
      true,
      'native Chrome storage-disable mode required',
    );
    assert.deepEqual(
      await page.evaluate('({trial:AF.store.available(),exchange:AF.exchange.available()})'),
      { trial: true, exchange: true },
      'fresh null-storage read recovery precedes the real persistence failure',
    );
    await page.locator('[data-action="reset-confirm"]').click();
    await page.locator('[data-action="reset-run"]').click();
    await page.evaluate('location.hash="#/account/settings"');
    await page.locator('.account-section').waitFor();
    assert.deepEqual(await page.evaluate('({trial:AF.store.available(),exchange:AF.exchange.available()})'), {
      trial: false,
      exchange: false,
    });
    assert.match(await page.locator('.account-section').innerText(), /SESSION ONLY/);
    await page.evaluate('location.hash="#/trade/trend"');
    await page.locator('#pass-order-form').waitFor();
    assert.match(
      await page.locator('#trade-panel').innerText(),
      /Storage restricted: trades last for this session only/,
    );
    await page.evaluate('location.hash="#/forum"');
    await page.locator('[data-action="compose"]').first().click();
    assert.match(await page.locator('#draft-status').innerText(), /session/i);
    await page.locator('#compose-title').fill('Native unavailable storage');
    await page.locator('#compose-body').fill('This draft stays only in the current native browser session.');
    assert.match(await page.locator('#draft-status').innerText(), /session only/i);
    await page.locator('#close-dialog').click();
    await page.locator('#app-dialog').waitFor({ state: 'hidden' });
    await page.locator('[data-action="compose"]').first().click();
    assert.equal(await page.locator('#compose-title').inputValue(), 'Native unavailable storage');
    assert.equal(await page.locator('[data-product-state]').count(), 1, 'product module remains active');
    assert.deepEqual(errors, [], 'storage-disabled shipped app has no uncaught page error');
    assert.deepEqual(writes, [], 'the storage failure journey sends no backend mutations');
    return [
      {
        name: 'native-chrome-disabled-storage',
        scope: 'SHIPPED_NATIVE_BROWSER_STORAGE_DISABLED',
        targets: [
          ['280', 1],
          ['281', 1],
          ['315', 0],
          ['406', 1],
          ['408', 1],
        ],
        browserCondition: '--disable-local-storage with native localStorage === null',
        inputClass: 'NATIVE_ENVIRONMENT_FAILURE',
        mutatingRequestCount: writes.length,
        productState: await page.locator('[data-product-state]').innerText(),
      },
    ];
  } finally {
    page.off('pageerror', onError);
    page.off('request', onRequest);
  }
}

// Called by the existing legacy driver on its already instrumented shipped page.
// This entry creates no manifest, collector, routes, scripts or mocked product APIs.
export async function verifyPrototype69Shipped(page, { origin: shippedOrigin }) {
  assert.equal(sha256(source), sourceSha256);
  assert.equal(new URL(page.url()).origin, shippedOrigin);
  assert.equal(await page.locator('[data-product-state]').count(), 1, 'product overlay must be loaded');
  const url = page.url();
  const viewport = page.viewportSize();
  assert.ok(viewport, 'driver must declare its viewport');
  const reducedMotion = await page.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches');
  const saved = await page.evaluate(
    '({trial:localStorage.getItem("alphaforge.prototype.v3"),exchange:localStorage.getItem("alphaforge.passmarket.v3")})',
  );
  const checks = [];
  const errors = [];
  const extraPages = new Set();
  const onError = (error) => errors.push(error.message);
  page.on('pageerror', onError);
  async function ready(target) {
    await target
      .locator('[data-product-state]')
      .filter({ hasText: /READY|EMPTY|ERROR/ })
      .waitFor();
  }
  async function navigate(target, path, selector) {
    await target.evaluate('location.hash = ' + JSON.stringify('#' + path));
    await ready(target);
    await target.locator(selector).first().waitFor();
    assert.equal(await target.locator('[data-product-state]').count(), 1);
  }
  async function closeDialog(target) {
    await target.locator('#close-dialog').click();
    await target.locator('#app-dialog').waitFor({ state: 'hidden' });
  }
  async function session(options = {}) {
    assert.equal(options.denied, undefined, 'opaque-origin raw fixture is not a shipped journey');
    await page.setViewportSize(options.viewport ?? viewport);
    await page.emulateMedia({ reducedMotion: options.reducedMotion ?? 'no-preference' });
    await page.goto(shippedOrigin + '/#/account/settings');
    await ready(page);
    await page.locator('[data-action="reset-confirm"]').click();
    await page.locator('[data-action="reset-run"]').click();
    await page.goto(shippedOrigin + '/#/home');
    await ready(page);
    await page.locator('#press-button').waitFor();
    const baseline = await page.evaluate('({trial:AF.store.read(),exchange:AF.exchange.read()})');
    assert.equal(baseline.trial.idle, 1000000);
    assert.equal(baseline.exchange.cash, 1000000);
    assert.deepEqual(baseline.trial.history, []);
    assert.deepEqual(baseline.exchange.orders, []);
    return { page, context: page.context(), errors };
  }
  async function resetFromSecondWindow(s) {
    const other = await s.context.newPage();
    extraPages.add(other);
    other.on('pageerror', onError);
    try {
      await other.goto(shippedOrigin + '/#/account/settings');
      await ready(other);
      await other.locator('[data-action="reset-confirm"]').click();
      await other.locator('[data-action="reset-run"]').click();
      await other.waitForFunction(
        () => globalThis.AF.store.read().history.length === 0 && !globalThis.AF.store.read().passes.factor,
      );
    } finally {
      await other.close();
      extraPages.delete(other);
    }
  }
  try {
    await runPrototype69Cases({
      run: async (name, body) => {
        // The raw opaque-origin document is not the shipped app.
        if (name.startsWith('native opaque-origin')) return;
        try {
          await body();
        } catch (error) {
          throw new Error('Shipped prototype group failed: ' + name, { cause: error });
        }
      },
      session,
      navigate,
      closeDialog,
      resetFromSecondWindow,
      capture: async (s, name, targets, metadata = {}) => {
        assert.deepEqual(s.errors, [], name + ': shipped page has no uncaught error');
        assert.equal(await page.locator('[data-product-state]').count(), 1);
        checks.push({
          name,
          scope:
            metadata.inputClass === 'EXPORTED_API_ONLY' ? 'SHIPPED_EXPORTED_API' : 'SHIPPED_LOCAL_MOCK_UI',
          targets,
          ...metadata,
        });
      },
      write: (name) => assert.equal(name, 'fixed-inputs.json', 'only read-only API diagnostics are omitted'),
    });
    // Temp-A's native sequence uses the existing 650ms press delay unchanged.
    const staleSession = await session({ reducedMotion: 'no-preference' });
    const backendSnapshot = async () => {
      const response = await page.request.get(shippedOrigin + '/api/vaults');
      assert.equal(response.status(), 200);
      return response.json();
    };
    const backendBefore = await backendSnapshot();
    const writes = [];
    const onRequest = (request) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
        writes.push({ method: request.method(), pathname: new URL(request.url()).pathname });
    };
    page.on('request', onRequest);
    const other = await staleSession.context.newPage();
    extraPages.add(other);
    other.on('pageerror', onError);
    other.on('request', onRequest);
    try {
      await navigate(page, '/account/funds', '[data-cash="withdraw"]');
      await page.locator('[data-cash="withdraw"]').click();
      await page.locator('#cash-amount').fill('3');
      await page.locator('#cash-form [type="submit"]').click();
      await page.locator('[data-action="commit"]').click();
      await page
        .locator('#dialog-body h2')
        .filter({ hasText: /Request recorded/ })
        .waitFor();
      await closeDialog(page);
      const pending = await page.evaluate('AF.store.read()');
      assert.equal(pending.pending.length, 1);
      await other.goto(shippedOrigin + '/#/account/funds');
      await ready(other);
      await other.locator('[data-withdraw-confirm]').click();
      await other.locator('[data-action="commit"]').click();
      await other
        .locator('#dialog-body h2')
        .filter({ hasText: /recorded/ })
        .waitFor();
      await closeDialog(other);
      assert.equal(await other.evaluate('AF.store.read().pending.length'), 0);
      assert.equal(
        await page.evaluate('AF.store.read().pending.length'),
        1,
        'the storage event does not itself synchronize the first window ledger',
      );
      await navigate(page, '/home', '#press-button');
      await page.locator('#press-button').click();
      await navigate(page, '/account/funds', '[data-withdraw-confirm]');
      assert.equal(await page.locator('[data-withdraw-confirm]').count(), 1);
      await page.waitForFunction(
        () =>
          globalThis.AF.store.read().samplePass === true && globalThis.AF.store.read().pending.length === 0,
        undefined,
        { timeout: 5000 },
      );
      assert.equal(
        await page.locator('[data-withdraw-confirm]').count(),
        1,
        'the delayed native press syncs state without rebuilding the funds page',
      );
      const beforeClick = await page.evaluate('({trial:AF.store.read(),exchange:AF.exchange.read()})');
      await page.locator('[data-withdraw-confirm]').click();
      await page.locator('#toast').filter({ hasText: 'This request has already been processed.' }).waitFor();
      assert.equal(await page.locator('[data-withdraw-confirm]').count(), 0);
      assert.equal(await page.locator('#app-dialog[open]').count(), 0);
      const afterClick = await page.evaluate('({trial:AF.store.read(),exchange:AF.exchange.read()})');
      assert.deepEqual(afterClick, beforeClick, 'the stale withdrawal click changes neither ledger');
      assert.equal(afterClick.trial.netFunding, pending.netFunding - 300);
      assert.equal(
        afterClick.trial.history.filter((row) => row.type === 'Confirm demo withdrawal').length,
        1,
      );
      assert.deepEqual(await backendSnapshot(), backendBefore);
      assert.deepEqual(writes, [], 'the cross-window trial flow sends no backend mutations');
      assert.deepEqual(errors, [], 'the cross-window flow causes no page error');
      checks.push({
        name: 'stale-withdrawal-after-delayed-press',
        scope: 'SHIPPED_LOCAL_MOCK_UI',
        inputClass: 'NATIVE_UI_CROSS_WINDOW_DELAYED_PRESS',
        targets: [['483', 0]],
      });
    } finally {
      page.off('request', onRequest);
      await other.close();
      extraPages.delete(other);
    }
    assert.equal(
      checks.length,
      10,
      'nine shipped UI groups and one explicit exported API group must complete',
    );
    return checks;
  } finally {
    for (const extra of extraPages) await extra.close();
    // Retire the old document and its delayed UI actions before restoring storage.
    await page.goto(shippedOrigin + '/#/account/settings');
    await ready(page);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    // Restore only the two fixture keys; backend identity/cookies and vaults are untouched.
    await page.evaluate(
      '(() => { const saved=' +
        JSON.stringify(saved) +
        '; for (const [key,value] of [["alphaforge.prototype.v3",saved.trial],["alphaforge.passmarket.v3",saved.exchange]]) { if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value); } })()',
    );
    await page.goto(url);
    await ready(page);
    assert.deepEqual(
      await page.evaluate(
        '({trial:localStorage.getItem("alphaforge.prototype.v3"),exchange:localStorage.getItem("alphaforge.passmarket.v3")})',
      ),
      saved,
      'original driver fixture storage restored exactly',
    );
    page.off('pageerror', onError);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
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
    const write = (file, value) =>
      writeFileSync(resolve(output, file), JSON.stringify(value, null, 2) + '\n');
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
      await other.waitForFunction(
        () => globalThis.AF.store.read().history.length === 0 && !globalThis.AF.store.read().passes.factor,
      );
      await other.close();
    }

    await runPrototype69Cases({
      run: (name, body) => t.test(name, body),
      session,
      navigate,
      capture,
      closeDialog,
      resetFromSecondWindow,
      write,
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

async function runPrototype69Cases({
  run,
  session,
  navigate,
  capture,
  closeDialog,
  resetFromSecondWindow,
  write,
}) {
  await run('trial allocation rejects unowned access and disables a full quota', async () => {
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
      ['299', 0],
      ['301', 0],
    ]);
  });

  await run('withdrawing all idle funds preserves pending money and disables a second request', async () => {
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
      ['267', 0],
      ['395', 0],
    ]);
  });

  await run('admitted persisted position hits the size guard without changing money', async () => {
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
        ['353', 0],
        ['354', 0],
      ],
      { inputClass: 'VALID_PERSISTENCE_FIXTURE' },
    );
  });

  await run('admitted legacy history safely renders absent type and retired strategy', async () => {
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
    assert.equal(await page.locator('.ledger-entry strong').innerText(), 'Activity type unavailable');
    assert.match(await page.locator('.ledger-entry').innerText(), /<retired-sample>/);
    assert.equal(await page.locator('retired-sample').count(), 0);
    await capture(
      s,
      'persisted-history',
      [
        // Invalid activity types now take the explicit display fallback before esc.
        ['262', 1],
        ['266', 1],
      ],
      { inputClass: 'VALID_PERSISTENCE_FIXTURE' },
    );
  });

  await run('saved and comparison controls survive full renderer round trips', async () => {
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
      ['188', 0],
      ['242', 0],
      ['244', 0],
      ['349', 0],
    ]);
  });

  await run('mobile price/returns charts and reduced-motion press use native input', async () => {
    const s = await session({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const { page } = s;
    await page.locator('#press-button').click();
    await page.waitForFunction(
      () =>
        globalThis.AF.store.read().samplePass === true &&
        !globalThis.document.querySelector('#press-button').disabled,
    );
    await navigate(page, '/trade/trend', '[data-v3-chart="price"]');
    await page.locator('[data-v3-chart="price"]').scrollIntoViewIfNeeded();
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
      ['223', 0],
      ['472', 0],
      ['579', 0],
      ['293', 1],
      ['284', 1],
    ]);
  });

  await run(
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
          ['280', 1],
          ['281', 1],
          ['315', 0],
          ['406', 1],
          ['408', 1],
        ],
        { inputClass: 'NATIVE_CSP_SANDBOX_OPAQUE_ORIGIN' },
      );
    },
  );

  await run('exported APIs have explicit API-only coverage and preserve monetary state', async () => {
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
    const dialogState = await page.evaluate(
      '({trial:AF.store.read(),exchange:AF.exchange.read(),trialStorage:localStorage.getItem("alphaforge.prototype.v3"),exchangeStorage:localStorage.getItem("alphaforge.passmarket.v3")})',
    );
    const shipped = (await page.locator('[data-product-state]').count()) === 1;
    const backendSnapshot = async () => {
      const response = await page.request.get(new URL('/api/vaults', page.url()).href);
      assert.equal(response.status(), 200, 'read the actual local backend vaults');
      return response.json();
    };
    const backendBefore = shipped ? await backendSnapshot() : null;
    const backendWrites = [];
    const onRequest = (request) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
        backendWrites.push({ method: request.method(), pathname: new URL(request.url()).pathname });
    };
    page.on('request', onRequest);
    try {
      await page.locator('#strategy-search').focus();
      await page.evaluate(
        'AF.app.openDialog(\'<p data-prototype-api-dialog>Public API content without a heading.</p><button type="button" data-close>Close API dialog</button>\')',
      );
      assert.equal(await page.locator('#app-dialog').isVisible(), true);
      assert.equal(await page.locator('#app-dialog').getAttribute('open'), '');
      assert.equal(await page.locator('#dialog-body h2').count(), 0);
      assert.equal(
        await page.locator('[data-prototype-api-dialog]').innerText(),
        'Public API content without a heading.',
      );
      assert.equal(
        await page.evaluate('document.activeElement === document.querySelector("#close-dialog")'),
        true,
        'without autofocus content, the public method focuses the real dialog close button',
      );
      await page.evaluate('AF.app.closeDialog()');
      await page.locator('#app-dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(
        () =>
          globalThis.document.activeElement === globalThis.document.querySelector('#strategy-search') &&
          globalThis.document.body.style.overflow === '',
      );
      assert.equal(await page.evaluate('document.body.style.overflow'), '');
      assert.deepEqual(
        await page.evaluate(
          '({trial:AF.store.read(),exchange:AF.exchange.read(),trialStorage:localStorage.getItem("alphaforge.prototype.v3"),exchangeStorage:localStorage.getItem("alphaforge.passmarket.v3")})',
        ),
        dialogState,
        'opening and closing the public dialog preserves both ledgers and exact stored bytes',
      );
      await navigate(page, '/trade/trend', '#pass-order-form');
      await page.locator('#pass-qty').fill('1');
      await page.locator('#pass-order-form [type="submit"]').click();
      await page.locator('#quote-countdown').waitFor();
      const quoteState = await page.evaluate(
        '({trial:AF.store.read(),exchange:AF.exchange.read(),trialStorage:localStorage.getItem("alphaforge.prototype.v3"),exchangeStorage:localStorage.getItem("alphaforge.passmarket.v3")})',
      );
      await page.evaluate(
        'AF.app.openDialog("<h2>Public dialog replacement</h2><p>Read-only replacement while a reviewed quote is open.</p>")',
      );
      assert.equal(await page.locator('#app-dialog[open]').count(), 1);
      assert.equal(await page.locator('#quote-countdown').count(), 0);
      // Allow the unchanged, real 1000ms quote interval to observe the replaced dialog.
      await page.waitForTimeout(1250);
      assert.equal(await page.locator('#app-dialog[open]').count(), 1);
      assert.equal(await page.locator('#dialog-body h2').innerText(), 'Public dialog replacement');
      assert.deepEqual(
        await page.evaluate(
          '({trial:AF.store.read(),exchange:AF.exchange.read(),trialStorage:localStorage.getItem("alphaforge.prototype.v3"),exchangeStorage:localStorage.getItem("alphaforge.passmarket.v3")})',
        ),
        quoteState,
        'public dialog replacement and the natural timer tick do not execute or mutate either ledger',
      );
      await closeDialog(page);
      if (shipped) assert.deepEqual(await backendSnapshot(), backendBefore);
      assert.deepEqual(backendWrites, [], 'public dialog operations send no backend mutations');
      assert.deepEqual(s.errors, [], 'public dialog operations cause no uncaught page error');
    } finally {
      page.off('request', onRequest);
    }
    await capture(
      s,
      'exported-apis',
      [
        ['67', 5],
        ['165', 0],
        ['229', 0],
        ['346', 1],
        ['397', 1],
        ['541', 0],
      ],
      { inputClass: 'EXPORTED_API_ONLY', fixedInputs },
    );
  });

  await run('native cross-window reset and bookmark sync reject a stale allocation form', async () => {
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
    await capture(s, 'stale-allocation', [['417', 0]], { inputClass: 'NATIVE_TWO_WINDOWS' });
  });

  await run('stale claim after a real second-window reset yields an existing-Pass receipt', async () => {
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
    await capture(s, 'stale-claim-receipt', [['440', 1]], {
      inputClass: 'VALID_PERSISTENCE_THEN_NATIVE_TWO_WINDOWS',
    });
  });
}

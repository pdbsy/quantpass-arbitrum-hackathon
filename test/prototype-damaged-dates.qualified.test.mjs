/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { buildApp } from '../apps/server/src/app.ts';
import { importUserUI } from '../tools/import-user-ui.mjs';

const root = resolve(import.meta.dirname, '..');
const browserModule =
  process.env.AF_DAMAGED_DATE_BROWSER_MODULE ||
  (process.env.AF_QUALIFIED_BROWSER_TOOLS && resolve(process.env.AF_QUALIFIED_BROWSER_TOOLS, 'index.mjs'));
const chromiumPath = process.env.CHROMIUM_PATH;
const key = 'alphaforge.prototype.v3';
const faultMode = process.env.AF_DAMAGED_DATE_FAULT;
const execFileAsync = promisify(execFile);

// Explicit test-only faults wrap public close APIs after their real cleanup has run.
// This keeps real resources isolated while exercising the harness rejection paths.
function injectCloseFault(resource, label) {
  if (!faultMode) return;
  const close = resource.close.bind(resource);
  resource.close = async (...args) => {
    await close(...args);
    process.stdout.write(`FAULT_INJECTED_CLOSED ${label}\n`);
    if (
      (faultMode === 'context' && label === 'context:1') ||
      faultMode === label ||
      (faultMode === 'case-and-cleanup' && ['context:1', 'browser', 'backend'].includes(label))
    )
      throw new Error(`FAULT_INJECTED_CLOSE_${label}`);
  };
}

const snapshot = (page) => page.evaluate(() => window.AF.store.read());
const frame = (page) => page.evaluate(() => new Promise(requestAnimationFrame));

// Explicit qualification avoids silently using an arbitrary globally installed browser.
test(
  'native date-corruption recovery preserves committed data and releases failed renders',
  {
    skip: !browserModule || !chromiumPath,
    timeout: 120_000,
  },
  async (t) => {
    const output = resolve(root, '.checks/prototype-damaged-dates');
    await mkdir(output, { recursive: true });
    const directory = await mkdtemp(resolve(output, 'run-'));
    const prototype = await readFile(resolve(root, 'apps/web/prototype/AlphaForge_v3_EN.html'), 'utf8');
    const receipt = {
      candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceSha256: createHash('sha256').update(prototype).digest('hex'),
      workingTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
      scope: faultMode
        ? 'FAULT_INJECTED_HARNESS_REGRESSION_NOT_PRODUCT_EVIDENCE'
        : 'LOCAL_MOCK_NATIVE_BROWSER_NOT_COVERAGE_EVIDENCE',
      faultMode: faultMode ?? null,
      harnessSha256: createHash('sha256')
        .update(await readFile(import.meta.filename))
        .digest('hex'),
      completed: false,
      cases: [],
      cleanup: [],
      errors: [],
    };
    const resources = [];
    const observedErrors = new Set();
    let firstError;
    function recordError(stage, error, entry) {
      if (observedErrors.size === 0) firstError = error;
      if (!observedErrors.has(error)) {
        observedErrors.add(error);
        receipt.errors.push({ stage, message: error?.message ?? String(error) });
      }
      if (entry) {
        entry.state = 'FAIL';
        entry.error ??= error?.message ?? String(error);
      }
    }
    function register(resource, name, entry) {
      const owned = { resource, name, entry, attempted: false };
      resources.push(owned);
      injectCloseFault(resource, name);
      return owned;
    }
    async function closeResource(owned) {
      if (owned.attempted) return;
      owned.attempted = true;
      const result = { resource: owned.name, state: 'RUNNING' };
      receipt.cleanup.push(result);
      try {
        await owned.resource.close();
        result.state = 'PASS';
      } catch (error) {
        result.state = 'FAIL';
        result.error = error?.message ?? String(error);
        recordError(`cleanup:${owned.name}`, error, owned.entry);
        return error;
      }
    }
    // One finalizer owns all resources: one rejection cannot skip later cleanup.
    t.after(async () => {
      for (const owned of [
        ...resources.filter(({ name }) => name.startsWith('context:')),
        ...resources.filter(({ name }) => !name.startsWith('context:')),
      ])
        await closeResource(owned);
      try {
        receipt.resourcesClosed = {
          contexts: resources
            .filter(({ name }) => name.startsWith('context:'))
            .every(({ resource }) => resource.pages().length === 0),
          browser: !resources.find(({ name }) => name === 'browser')?.resource.isConnected(),
          backend: !resources.find(({ name }) => name === 'backend')?.resource.server.listening,
        };
        assert.ok(Object.values(receipt.resourcesClosed).every(Boolean), 'owned resources must be closed');
        t.signal.throwIfAborted();
        assert.equal(receipt.completed, true, 'the scenario loop did not complete');
        assert.equal(receipt.cases.length, 11, 'all planned scenarios must run');
        assert.ok(
          receipt.cases.every((entry) => entry.state === 'PASS'),
          'every scenario must pass',
        );
      } catch (error) {
        // Existing failures already explain incomplete/failed scenarios; retain
        // the original error rather than replacing it with a summary assertion.
        if (!receipt.errors.length) recordError('completion', error);
      }
      receipt.firstError = receipt.errors[0] ?? null;
      receipt.state = receipt.errors.length ? 'FAIL' : 'PASS';
      t.diagnostic(`Evidence: ${resolve(directory, 'result.json')}`);
      await writeFile(resolve(directory, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
      if (receipt.errors.length) throw firstError;
    });
    try {
      const site = resolve(directory, 'site'),
        assets = resolve(directory, 'assets'),
        dist = resolve(directory, 'dist');
      await mkdir(site, { recursive: true });
      await importUserUI(prototype, site, assets);
      await build({
        configFile: false,
        root: site,
        publicDir: assets,
        logLevel: 'silent',
        plugins: [
          {
            name: 'qualified-real-product-entry',
            enforce: 'pre',
            resolveId(id) {
              if (id === '/src/product-ui.ts') return resolve(root, 'apps/web/src/product-ui.ts');
            },
          },
        ],
        build: { outDir: dist, emptyOutDir: true },
      });
      const { chromium } = await import(pathToFileURL(resolve(browserModule)).href);
      const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
      register(browser, 'browser');
      receipt.browser = browser.version();
      const port = Number(process.env.AF_DAMAGED_DATE_PORT || 19604);
      const origin = `http://127.0.0.1:${port}`;
      const { app } = await buildApp({
        origin,
        dbPath: resolve(directory, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        webRoot: dist,
      });
      register(app, 'backend');
      if (faultMode === 'setup') throw new Error('FAULT_INJECTED_SETUP');
      await app.listen({ host: '127.0.0.1', port });

      async function scenario(name, action) {
        t.signal.throwIfAborted();
        await t.test(name, async () => {
          const entry = { name, state: 'RUNNING', pageErrors: [], cspErrors: [] };
          receipt.cases.push(entry);
          let owned;
          let scenarioError;
          let actionFailed = false;
          try {
            const context = await browser.newContext({
              viewport: { width: 1440, height: 1000 },
              reducedMotion: 'reduce',
              timezoneId: 'UTC',
            });
            owned = register(context, `context:${receipt.cases.length}`, entry);
            const page = await context.newPage();
            page.setDefaultTimeout(5_000);
            page.on('pageerror', (error) => entry.pageErrors.push(error.message));
            page.on('console', (message) => {
              if (/Content Security Policy|Refused to (?:apply|execute)/i.test(message.text()))
                entry.cspErrors.push(message.text());
            });
            await context.route('**/*', (route) =>
              new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
            );
            await page.goto(`${origin}/#/account/funds`);
            await page.locator('[data-product-login="alice"]').click();
            await page
              .locator('[data-product-state]')
              .filter({ hasText: /^(READY|EMPTY)$/ })
              .waitFor();
            if (faultMode === 'case-and-cleanup' && receipt.cases.length === 1)
              throw new Error('FAULT_INJECTED_CASE');
            await action({ page, context, entry });
            assert.deepEqual(entry.cspErrors, []);
          } catch (error) {
            scenarioError = error;
            actionFailed = true;
            recordError(`case:${receipt.cases.length}`, error, entry);
          } finally {
            if (owned) {
              const cleanupError = await closeResource(owned);
              if (!actionFailed) scenarioError = cleanupError;
            }
          }
          if (entry.state === 'FAIL') throw scenarioError;
          entry.state = 'PASS';
        });
      }
      async function corrupt(context, value) {
        const other = await context.newPage();
        await other.goto(`${origin}/#/home`);
        await other.locator('#press-button').waitFor();
        await other.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
          key,
          value,
        });
        await other.close();
      }
      async function deposit(page) {
        await page.locator('[data-cash="deposit"]').click();
        await page.locator('#cash-amount').fill('3');
        await page.locator('#cash-form button[type="submit"]').click();
        await page.locator('[data-action="commit"]').click();
        await page
          .locator('#dialog-body h2')
          .filter({ hasText: /recorded/ })
          .waitFor();
        await page.locator('#close-dialog').click();
        await page.locator('#app-dialog').waitFor({ state: 'hidden' });
      }
      for (const [label, value] of [
        ['non-coercible object', { toString: null }],
        ['invalid string', 'not-a-date'],
        ['null', null],
        ['array', []],
        ['out-of-range number', 1e20],
      ]) {
        await scenario(
          `history ${label}: profile save and later navigation preserve the ledger`,
          async ({ page, context, entry }) => {
            await deposit(page);
            const before = await snapshot(page);
            assert.equal(before.history.length, 1);
            await page.locator('[data-action="profile"]').first().click();
            await page.locator('#profile-name').fill('Date boundary');
            const damaged = structuredClone(before);
            damaged.revision++;
            damaged.history[0].at = value;
            await corrupt(context, damaged);
            await page.locator('#profile-form button[type="submit"]').click();
            assert.match(await page.locator('#toast').textContent(), /Local profile updated/);
            assert.match(await page.locator('#main').textContent(), /Date unavailable/);
            if (label === 'non-coercible object') {
              await page.locator('.ledger-entry').first().scrollIntoViewIfNeeded();
              entry.screenshot = resolve(directory, 'history-recovered.png');
              await page.screenshot({ path: entry.screenshot });
            }
            const after = await snapshot(page);
            assert.deepEqual(after, {
              ...damaged,
              revision: damaged.revision + 1,
              profile: { ...damaged.profile, name: 'Date boundary' },
            });
            await page.locator('a[href="#/home"]').first().click();
            await page.locator('#press-button').waitFor();
            assert.equal(await page.evaluate(() => window.AF.route.name), 'home');
            assert.deepEqual(await snapshot(page), after);
            assert.deepEqual(entry.pageErrors, []);
            entry.idle = after.idle;
            entry.netFunding = after.netFunding;
          },
        );
        await scenario(
          `post ${label}: discussion sorting and native resize keep both charts`,
          async ({ page, context, entry }) => {
            await page.locator('a[href="#/forum"]').first().click();
            await page.locator('[data-action="compose"]').first().click();
            await page.locator('#compose-title').fill('Date boundary research');
            await page
              .locator('#compose-body')
              .fill('A genuine local note created through the shipped form for date boundary recovery.');
            await page.locator('#compose-form button[type="submit"]').click();
            await page.locator('.article-page').waitFor();
            await page.locator('a[href="#/home"]').first().click();
            await page.locator('[data-route="/trade/trend"]').first().click();
            await page.locator('[data-trade-tab="discussion"]').click();
            await page.locator('a[href="#/home"]').first().click();
            await page.locator('#press-button').waitFor();
            const before = await snapshot(page);
            assert.equal(before.posts.length, 1);
            const damaged = structuredClone(before);
            damaged.revision++;
            damaged.posts[0].date = value;
            await corrupt(context, damaged);
            await page.locator('#press-button').click();
            await page.waitForFunction(() => window.AF.store.read().samplePass === true);
            const expected = { ...damaged, samplePass: true, revision: damaged.revision + 1 };
            assert.deepEqual(await snapshot(page), expected);
            await page.locator('[data-route="/trade/trend"]').first().click();
            await frame(page);
            assert.deepEqual(entry.pageErrors, []);
            assert.equal(await page.locator('#trade-price').count(), 1);
            assert.equal(await page.locator('#trade-returns').count(), 1);
            await page.setViewportSize({ width: 600, height: 900 });
            await page.waitForFunction(() =>
              document.querySelector('#trade-price svg')?.getAttribute('viewBox')?.endsWith('540'),
            );
            assert.equal(await page.locator('#trade-returns svg').count(), 1);
            await page.locator('#main a[href="#/forum"]').first().click();
            await page.locator('#forum-results').waitFor();
            const row = page.locator('.journal-row').filter({ hasText: 'Date boundary research' });
            assert.match(await row.textContent(), /Date unavailable/);
            if (label === 'non-coercible object') {
              await row.scrollIntoViewIfNeeded();
              entry.screenshot = resolve(directory, 'post-recovered.png');
              await page.screenshot({ path: entry.screenshot });
            }
            const ordered = await page.evaluate(() => window.AF.ui.posts().map((post) => post.id));
            assert.equal(ordered.at(-1), before.posts[0].id, 'invalid dates sort after all valid dates');
            assert.deepEqual(await snapshot(page), expected);
            assert.deepEqual(entry.pageErrors, []);
          },
        );
      }
      await scenario(
        'a failing public renderer exposes the error but does not lock subsequent native navigation',
        async ({ page, entry }) => {
          const before = await snapshot(page);
          assert.deepEqual(
            await page.evaluate(() => [window.AF.ui.date('2026-09-12T12:00:00.000Z'), window.AF.ui.date(0)]),
            ['09/12', '01/01'],
          );
          await page.evaluate(() => {
            window.AF.pages.market = () => {
              throw new Error('QUALIFIED_RENDER_FAILURE');
            };
          });
          const error = page.waitForEvent('pageerror', {
            predicate: (error) => error.message === 'QUALIFIED_RENDER_FAILURE',
          });
          await page.locator('a[href="#/market"]').first().click();
          await error;
          assert.ok(
            entry.pageErrors.includes('QUALIFIED_RENDER_FAILURE'),
            'the original renderer error is observable',
          );
          await page.locator('a[href="#/home"]').first().click();
          await page.locator('#press-button').waitFor();
          assert.equal(await page.evaluate(() => window.AF.route.name), 'home');
          assert.deepEqual(await snapshot(page), before);
          assert.ok(entry.pageErrors.every((message) => message === 'QUALIFIED_RENDER_FAILURE'));
        },
      );
      receipt.completed = true;
    } catch (error) {
      recordError('run', error);
      throw error;
    }
  },
);

// These child processes must genuinely exit nonzero. A green parent means the
// harness accurately recorded the injected failure, never a successful UI run.
for (const mode of faultMode ? [] : ['context', 'browser', 'backend', 'case-and-cleanup', 'setup']) {
  test(
    `FAULT_INJECTED ${mode}: failed run records FAIL after all resource cleanup`,
    { skip: !browserModule || !chromiumPath, timeout: 120_000 },
    async (t) => {
      let failure;
      try {
        await execFileAsync(process.execPath, ['--test', '--test-isolation=none', import.meta.filename], {
          cwd: root,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_')),
            ),
            AF_DAMAGED_DATE_FAULT: mode,
          },
          timeout: 90_000,
          maxBuffer: 2 * 1024 * 1024,
        });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure, 'the fault-injected child must fail, not pass');
      assert.equal(failure.code, 1, 'a test failure must exit with status 1');
      const match = failure.stdout.match(/Evidence: ([^\r\n]+\/result\.json)/);
      assert.ok(match, 'the failed child must leave a receipt');
      t.diagnostic(`FAULT_INJECTED ${mode} receipt: ${match[1]}`);
      await writeFile(resolve(dirname(match[1]), 'child-output.log'), failure.stdout + failure.stderr);
      await writeFile(
        resolve(dirname(match[1]), 'child-process.json'),
        JSON.stringify(
          {
            mode,
            exitCode: failure.code,
            signal: failure.signal ?? null,
            killed: failure.killed,
            receiptPath: match[1],
          },
          null,
          2,
        ) + '\n',
      );
      const receipt = JSON.parse(await readFile(match[1], 'utf8'));
      assert.equal(receipt.state, 'FAIL', 'a failed child must never leave a PASS/NOT_RUN receipt');
      assert.equal(receipt.scope, 'FAULT_INJECTED_HARNESS_REGRESSION_NOT_PRODUCT_EVIDENCE');
      assert.equal(receipt.completed, mode !== 'setup');
      assert.equal(receipt.cases.length, mode === 'setup' ? 0 : 11);
      assert.equal(receipt.cleanup.length, mode === 'setup' ? 2 : 13);
      assert.deepEqual(
        receipt.cleanup.map((entry) => entry.resource),
        [
          ...Array.from({ length: mode === 'setup' ? 0 : 11 }, (_, i) => `context:${i + 1}`),
          'browser',
          'backend',
        ],
      );
      assert.ok(receipt.cleanup.every((entry) => ['PASS', 'FAIL'].includes(entry.state)));
      assert.deepEqual(receipt.resourcesClosed, { contexts: true, browser: true, backend: true });
      const expectedErrors = {
        context: ['FAULT_INJECTED_CLOSE_context:1'],
        browser: ['FAULT_INJECTED_CLOSE_browser'],
        backend: ['FAULT_INJECTED_CLOSE_backend'],
        'case-and-cleanup': [
          'FAULT_INJECTED_CASE',
          'FAULT_INJECTED_CLOSE_context:1',
          'FAULT_INJECTED_CLOSE_browser',
          'FAULT_INJECTED_CLOSE_backend',
        ],
        setup: ['FAULT_INJECTED_SETUP'],
      };
      assert.deepEqual(
        receipt.errors.map((entry) => entry.message),
        expectedErrors[mode],
      );
      assert.equal(receipt.firstError.message, expectedErrors[mode][0]);
      assert.deepEqual(
        receipt.cleanup.filter((entry) => entry.state === 'FAIL').map((entry) => entry.resource),
        {
          context: ['context:1'],
          browser: ['browser'],
          backend: ['backend'],
          'case-and-cleanup': ['context:1', 'browser', 'backend'],
          setup: [],
        }[mode],
      );
      if (mode === 'context' || mode === 'case-and-cleanup') assert.equal(receipt.cases[0].state, 'FAIL');
      for (const entry of receipt.cleanup)
        assert.ok(failure.stdout.includes(`FAULT_INJECTED_CLOSED ${entry.resource}`));
    },
  );
}

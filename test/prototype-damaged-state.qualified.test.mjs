/* global window */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { buildApp } from '../apps/server/src/app.ts';
import { importUserUI } from '../tools/import-user-ui.mjs';
import { verifyInstallation } from '../tools/coverage/toolchain.mjs';

const root = resolve(import.meta.dirname, '..');
const browserDirectory = process.env.AF_QUALIFIED_BROWSER_TOOLS;
const chrome = process.env.CHROMIUM_PATH;
const trialKey = 'alphaforge.prototype.v3';
const sourcePath = 'apps/web/prototype/AlphaForge_v3_EN.html';
const sourceSha = '499c1bda91a8637a9d9fc12547790236947d2d19151173b3d4865f891ef52161';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const snapshot = (page) =>
  page.evaluate(() => ({ trial: window.AF.store.read(), exchange: window.AF.exchange.read() }));

// Characterize defensive behavior for parseable, damaged persistence. Native UI
// cannot create these JSON values. No renderer, DOM method or guard is replaced.
// Removing the submit catch, render finally, or either resize guard must break
// the corresponding observable error/recovery assertions. No coverage is claimed.
test(
  'damaged persistence preserves one profile commit and safe resize after failed trade rendering',
  { skip: !browserDirectory || !chrome, timeout: 90_000 },
  async (t) => {
    const output = resolve(root, '.checks/prototype-damaged-state');
    await mkdir(output, { recursive: true });
    const directory = await mkdtemp(resolve(output, 'run-'));
    const receipt = {
      candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      workingTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceSha256: digest(await readFile(resolve(root, sourcePath))),
      harnessSha256: digest(await readFile(import.meta.filename)),
      scope: 'PARSEABLE_DAMAGED_PERSISTENCE_NATIVE_CONTROLS_NOT_COVERAGE_ADMISSION',
      state: 'RUNNING',
      completed: false,
      cases: [],
      cleanup: [],
      errors: [],
    };
    const resources = [];
    let firstError;
    const record = (stage, error) => {
      firstError ??= error;
      receipt.errors.push({ stage, message: error.message ?? String(error) });
    };
    const own = (name, resource) => {
      const entry = { name, resource, closed: false };
      resources.push(entry);
      return entry;
    };
    async function close(entry) {
      if (entry.closed) return;
      entry.closed = true;
      try {
        await entry.resource.close();
        receipt.cleanup.push({ resource: entry.name, state: 'PASS' });
      } catch (error) {
        receipt.cleanup.push({ resource: entry.name, state: 'FAIL' });
        record(`cleanup:${entry.name}`, error);
      }
    }
    t.after(async () => {
      for (const entry of [...resources].reverse()) await close(entry);
      try {
        assert.equal(digest(await readFile(resolve(root, sourcePath))), sourceSha);
        assert.equal(receipt.completed, true);
        assert.equal(receipt.cases.length, 2);
        assert.ok(receipt.cases.every((entry) => entry.state === 'PASS'));
        for (const { name, resource } of resources) {
          if (name.startsWith('context')) assert.equal(resource.pages().length, 0);
          if (name === 'browser') assert.equal(resource.isConnected(), false);
          if (name === 'backend') assert.equal(resource.server.listening, false);
        }
        t.signal.throwIfAborted();
      } catch (error) {
        if (!firstError) record('completion', error);
      }
      receipt.state = firstError ? 'FAIL' : 'PASS';
      await writeFile(resolve(directory, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
      t.diagnostic(`Evidence: ${resolve(directory, 'result.json')}`);
      if (firstError) throw firstError;
    });
    try {
      assert.equal(receipt.sourceSha256, sourceSha, 'fixed prototype source required');
      const lock = JSON.parse(await readFile(resolve(root, 'planning/coverage-toolchain.lock.json')));
      assert.equal(process.versions.node, lock.node);
      receipt.browserToolInventory = verifyInstallation(
        resolve(browserDirectory),
        lock.browser.installedFiles,
      );
      const site = resolve(directory, 'site');
      const assets = resolve(directory, 'assets');
      const dist = resolve(directory, 'dist');
      await mkdir(site);
      await importUserUI(await readFile(resolve(root, sourcePath), 'utf8'), site, assets);
      await build({
        configFile: false,
        root: site,
        publicDir: assets,
        logLevel: 'silent',
        plugins: [
          {
            name: 'real-product-entry',
            enforce: 'pre',
            resolveId(id) {
              if (id === '/src/product-ui.ts') return resolve(root, 'apps/web/src/product-ui.ts');
            },
          },
        ],
        build: { outDir: dist, emptyOutDir: true },
      });
      const { chromium } = await import(pathToFileURL(resolve(browserDirectory, 'index.mjs')).href);
      const browser = own(
        'browser',
        await chromium.launch({ executablePath: chrome, headless: true }),
      ).resource;
      receipt.browserVersion = browser.version();
      const port = Number(process.env.AF_DAMAGED_STATE_PORT || 19614);
      assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
      const origin = `http://127.0.0.1:${port}`;
      const { app } = await buildApp({
        origin,
        dbPath: resolve(directory, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        webRoot: dist,
      });
      own('backend', app);
      await app.listen({ host: '127.0.0.1', port });
      const ready = (page) =>
        page
          .locator('[data-product-state]')
          .filter({ hasText: /^(READY|EMPTY)$/ })
          .waitFor();
      async function backend(page) {
        const response = await page.request.get(`${origin}/api/vaults`);
        assert.equal(response.status(), 200);
        return response.json();
      }
      async function corrupt(context, value) {
        const peer = await context.newPage();
        try {
          await peer.goto(`${origin}/#/home`);
          await peer.locator('#press-button').waitFor();
          await peer.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
            key: trialKey,
            value,
          });
        } finally {
          await peer.close();
        }
      }
      async function scenario(name, body) {
        await t.test(name, async () => {
          const entry = {
            name,
            state: 'RUNNING',
            pageErrors: [],
            cspErrors: [],
            forbiddenRequests: [],
            writes: [],
          };
          receipt.cases.push(entry);
          let context;
          try {
            context = own(
              `context:${receipt.cases.length}`,
              await browser.newContext({
                viewport: { width: 1440, height: 1000 },
                reducedMotion: 'reduce',
                timezoneId: 'UTC',
              }),
            );
            await context.resource.route('**/*', async (route) => {
              const request = route.request();
              const url = new URL(request.url());
              if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) entry.writes.push(url.pathname);
              if (url.origin !== origin) {
                entry.forbiddenRequests.push(url.origin);
                await route.abort();
              } else await route.continue();
            });
            const page = await context.resource.newPage();
            page.setDefaultTimeout(5_000);
            page.on('pageerror', (error) =>
              entry.pageErrors.push({ name: error.name, message: error.message }),
            );
            page.on('console', (message) => {
              if (/Content Security Policy|Refused to (?:apply|execute)/i.test(message.text()))
                entry.cspErrors.push(message.text());
            });
            await page.goto(`${origin}/#/account/funds`);
            await page.locator('[data-product-login="alice"]').click();
            await ready(page);
            const beforeBackend = await backend(page);
            await body(page, context.resource, entry);
            assert.deepEqual(
              await backend(page),
              beforeBackend,
              'local damaged-state actions cannot change API funds',
            );
            assert.deepEqual(entry.writes, ['/api/demo/session']);
            assert.deepEqual(entry.forbiddenRequests, []);
            assert.deepEqual(entry.cspErrors, []);
            entry.state = 'PASS';
          } catch (error) {
            entry.state = 'FAIL';
            entry.error = error.message;
            record(name, error);
            throw error;
          } finally {
            if (context) await close(context);
          }
        });
      }
      await scenario(
        'profile error remains visible after exactly one saved edit; navigation and reload recover',
        async (page, context, entry) => {
          const before = await snapshot(page);
          assert.equal(before.trial.idle, 1000000);
          assert.equal(before.trial.netFunding, 1000000);
          await page.locator('[data-action="profile"]').first().click();
          await page.locator('#profile-name').fill('Damaged history');
          const damaged = structuredClone(before.trial);
          damaged.revision++;
          damaged.history = [
            {
              id: 'damaged-history',
              amount: 0,
              type: { toString: null },
              strategy: 'trend',
              at: '2026-09-12T00:00:00Z',
            },
          ];
          await corrupt(context, damaged);
          await page.locator('#profile-form button[type="submit"]').click();
          await page.locator('#app-dialog').waitFor({ state: 'hidden' });
          const toast = await page.locator('#toast').innerText();
          assert.match(toast, /Cannot convert object to primitive value/i);
          assert.doesNotMatch(toast, /profile updated/i);
          const expected = {
            trial: {
              ...damaged,
              revision: damaged.revision + 1,
              profile: { ...damaged.profile, name: 'Damaged history' },
            },
            exchange: before.exchange,
          };
          assert.deepEqual(
            await snapshot(page),
            expected,
            'save committed exactly once despite the render error',
          );
          assert.deepEqual(entry.pageErrors, [], 'submit catch must expose the error through the toast');
          await page.locator('a[href="#/home"]').first().click();
          await page.locator('#press-button').waitFor();
          await page.reload();
          await ready(page);
          await page.locator('#press-button').waitFor();
          assert.deepEqual(await snapshot(page), expected);
          await page.locator('a[href="#/account/settings"]').first().click();
          await page.locator('[data-action="profile"]').first().click();
          assert.equal(await page.locator('#profile-name').inputValue(), 'Damaged history');
          await page.locator('#close-dialog').click();
          assert.deepEqual(entry.pageErrors, []);
          assert.deepEqual(await snapshot(page), expected);
          entry.productDefect =
            'OPEN: damaged history.type still breaks Funds rendering; recovery does not repair persistence';
          entry.handledError = toast;
          entry.final = expected;
        },
      );
      await scenario(
        'malformed note ID leaves absent charts safe during native resize and later navigation',
        async (page, context, entry) => {
          await page.locator('a[href="#/forum"]').first().click();
          await page.locator('[data-action="compose"]').first().click();
          await page.locator('#compose-title').fill('Damaged ID research');
          await page
            .locator('#compose-body')
            .fill('A local note created with real controls before a damaged persistence import.');
          await page.locator('#compose-form button[type="submit"]').click();
          await page.locator('.article-page').waitFor();
          await page.locator('a[href="#/home"]').first().click();
          await page.locator('[data-route="/trade/trend"]').first().click();
          await page.locator('[data-trade-tab="discussion"]').click();
          await page.locator('a[href="#/home"]').first().click();
          await page.locator('#press-button').waitFor();
          const before = await snapshot(page);
          assert.equal(before.trial.posts.length, 1);
          const damaged = structuredClone(before.trial);
          damaged.revision++;
          damaged.posts[0].id = 'local-\ud800';
          damaged.posts[0].strategy = 'trend';
          await corrupt(context, damaged);
          await page.locator('#press-button').click();
          await page.waitForFunction(() => window.AF.store.read().samplePass === true);
          const expected = {
            trial: { ...damaged, revision: damaged.revision + 1, samplePass: true },
            exchange: before.exchange,
          };
          assert.deepEqual(await snapshot(page), expected);
          assert.deepEqual(entry.pageErrors, []);
          const failure = page.waitForEvent('pageerror', {
            predicate: (error) => /URI malformed/i.test(error.message),
          });
          await page.locator('[data-route="/trade/trend"]').first().click();
          await failure;
          await page.waitForTimeout(150);
          assert.deepEqual(
            await page.evaluate(() => ({ route: window.AF.route, tab: window.AF.view.tradeTab })),
            { route: { name: 'trade', id: 'trend' }, tab: 'discussion' },
          );
          assert.equal(
            await page.locator('#press-button').count(),
            1,
            'old home DOM survives failed template evaluation',
          );
          assert.equal(await page.locator('#trade-price').count(), 0);
          assert.equal(await page.locator('#trade-returns').count(), 0);
          assert.ok(
            entry.pageErrors.length > 0 &&
              entry.pageErrors.every((error) => /URI malformed/i.test(error.message)),
          );
          const errorsBeforeResize = structuredClone(entry.pageErrors);
          for (const width of [600, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.waitForTimeout(200); // Native resize debounce is 80ms.
            assert.deepEqual(
              entry.pageErrors,
              errorsBeforeResize,
              'absent chart nodes cause no extra resize error',
            );
            assert.deepEqual(await snapshot(page), expected);
          }
          await page.locator('a[href="#/home"]').first().click();
          await page.waitForFunction(() => window.AF.route.name === 'home');
          await page.locator('#press-button').waitFor();
          await page.reload();
          await ready(page);
          await page.locator('#press-button').waitFor();
          assert.deepEqual(await snapshot(page), expected);
          assert.deepEqual(
            entry.pageErrors,
            errorsBeforeResize,
            'native navigation and reload remain usable',
          );
          await page.locator('a[href="#/account/settings"]').first().click();
          await page.locator('[data-action="profile"]').first().waitFor();
          assert.deepEqual(await snapshot(page), expected);
          assert.deepEqual(entry.pageErrors, errorsBeforeResize);
          entry.productDefect =
            'OPEN: accepted lone-surrogate post ID still breaks Discussion rendering; recovery does not repair persistence';
          entry.expectedRenderErrors = errorsBeforeResize;
          entry.final = expected;
        },
      );
      receipt.completed = true;
    } catch (error) {
      if (firstError !== error) record('run', error);
      throw error;
    }
  },
);

/* global window, document, requestAnimationFrame */
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

const root = resolve(import.meta.dirname, '..');
const browserModule = process.env.AF_DAMAGED_DATE_BROWSER_MODULE;
const chromiumPath = process.env.CHROMIUM_PATH;
const key = 'alphaforge.prototype.v3';
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
      scope: 'LOCAL_MOCK_NATIVE_BROWSER_NOT_COVERAGE_EVIDENCE',
      cases: [],
    };
    t.after(async () => {
      receipt.state =
        receipt.cases.length === 11 && receipt.cases.every((entry) => entry.state === 'PASS')
          ? 'PASS'
          : receipt.cases.length
            ? 'FAIL'
            : 'NOT_RUN';
      await writeFile(resolve(directory, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
      t.diagnostic(`Evidence: ${resolve(directory, 'result.json')}`);
    });
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
    t.after(() => browser.close());
    receipt.browser = browser.version();
    const port = Number(process.env.AF_DAMAGED_DATE_PORT || 19604);
    const origin = `http://127.0.0.1:${port}`;
    const { app } = await buildApp({
      origin,
      dbPath: resolve(directory, 'ledger.sqlite'),
      env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
      webRoot: dist,
    });
    t.after(() => app.close());
    await app.listen({ host: '127.0.0.1', port });

    async function scenario(name, action) {
      await t.test(name, async () => {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          reducedMotion: 'reduce',
          timezoneId: 'UTC',
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5_000);
        const entry = { name, state: 'RUNNING', pageErrors: [], cspErrors: [] };
        receipt.cases.push(entry);
        page.on('pageerror', (error) => entry.pageErrors.push(error.message));
        page.on('console', (message) => {
          if (/Content Security Policy|Refused to (?:apply|execute)/i.test(message.text()))
            entry.cspErrors.push(message.text());
        });
        await context.route('**/*', (route) =>
          new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
        );
        try {
          await page.goto(`${origin}/#/account/funds`);
          await page.locator('[data-product-login="alice"]').click();
          await page
            .locator('[data-product-state]')
            .filter({ hasText: /^(READY|EMPTY)$/ })
            .waitFor();
          await action({ page, context, entry });
          assert.deepEqual(entry.cspErrors, []);
          entry.state = 'PASS';
        } catch (error) {
          entry.state = 'FAIL';
          entry.error = error.message;
          throw error;
        } finally {
          await context.close();
        }
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
  },
);

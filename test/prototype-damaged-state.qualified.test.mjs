/* global window, document */
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
const sourceSha = 'b9671bca14a388d08a7e5db492f831c5e02fcb15f8ff57baab8a65e863d4ff35';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const snapshot = (page) =>
  page.evaluate(() => ({ trial: window.AF.store.read(), exchange: window.AF.exchange.read() }));

// Exercise display-only degradation for parseable, damaged persistence. Native UI
// cannot create these JSON values. No renderer, DOM method or guard is replaced.
// Removing either field boundary must break the visible fallback or no-error
// assertions; resetting records breaks full persisted-state equality. No coverage is claimed.
test(
  'damaged persistence degrades visibly without losing records or valid interactions',
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
      async function assertPersisted(page, expected) {
        assert.deepEqual(await snapshot(page), expected);
        const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), trialKey);
        assert.deepEqual(
          saved,
          expected.trial,
          'display fallback never rewrites saved fields or relationships',
        );
      }
      async function home(page) {
        await page.locator('a[href="#/home"]').first().click();
        await page.waitForFunction(() => window.AF.route.name === 'home');
        await page.locator('#press-button').waitFor();
      }
      async function forum(page) {
        await page.locator('a[href="#/forum"]').first().click();
        await page.locator('#forum-results').waitFor();
      }
      const badTypes = [
        ['object', { toString: null }],
        ['null', null],
        ['array', []],
        ['number', 42],
        ['empty', ''],
        ['whitespace', ' \t '],
      ];
      const validType = '  <b>Actual activity</b> & recorded  ';
      await scenario(
        'invalid activity types remain stored and render unavailable while profile saves exactly once',
        async (page, context, entry) => {
          const before = await snapshot(page);
          assert.equal(before.trial.idle, 1000000);
          assert.equal(before.trial.netFunding, 1000000);
          await page.locator('[data-action="profile"]').first().click();
          await page.locator('#profile-name').fill('Damaged history');
          const damaged = structuredClone(before.trial);
          damaged.revision++;
          damaged.history = [...badTypes, ['valid', validType]].map(([id, type]) => ({
            id: 'history-' + id,
            type,
            amount: 0,
            strategy: 'trend',
            at: '2026-09-12T00:00:00Z',
          }));
          await corrupt(context, damaged);
          await page.locator('#profile-form button[type="submit"]').click();
          await page.locator('#app-dialog').waitFor({ state: 'hidden' });
          const toast = await page.locator('#toast').innerText();
          entry.profileToast = toast;
          assert.equal(
            toast,
            'Local profile updated.',
            'profile save and its subsequent render must both succeed',
          );
          const expected = {
            trial: {
              ...damaged,
              revision: damaged.revision + 1,
              profile: { ...damaged.profile, name: 'Damaged history' },
            },
            exchange: before.exchange,
          };
          async function historyLabels() {
            const rows = page.locator('.ledger-entry');
            await rows.first().waitFor();
            assert.equal(await rows.count(), 7, 'damaged rows are retained');
            assert.deepEqual(await rows.locator('strong').allTextContents(), [
              ...badTypes.map(() => 'Activity type unavailable'),
              validType,
            ]);
            assert.equal(
              await rows.locator('strong b').count(),
              0,
              'valid text is escaped, never inserted as markup',
            );
          }
          await historyLabels();
          await assertPersisted(page, expected);
          assert.deepEqual(entry.pageErrors, []);
          await home(page);
          await page.locator('a[href="#/account/settings"]').first().click();
          await page.locator('[data-action="profile"]').first().click();
          assert.equal(await page.locator('#profile-name').inputValue(), 'Damaged history');
          await page.locator('#close-dialog').click();
          await page.locator('a[href="#/account/funds"]').first().click();
          await historyLabels();
          await page.reload();
          await ready(page);
          await historyLabels();
          await assertPersisted(page, expected);
          assert.deepEqual(entry.pageErrors, []);
          entry.historyTypes = damaged.history.map(({ type }) => type);
          entry.final = expected;
        },
      );
      await scenario(
        'malformed note links degrade without losing content, relationships, charts or valid native interactions',
        async (page, context, entry) => {
          await forum(page);
          await page.locator('[data-action="compose"]').first().click();
          await page.locator('#compose-title').fill('Native unaffected note');
          await page
            .locator('#compose-body')
            .fill('A normal local note remains readable and interactive beside damaged saved note links.');
          await page.locator('#compose-form button[type="submit"]').click();
          await page.locator('.article-page').waitFor();
          await home(page);
          await page.locator('[data-route="/trade/trend"]').first().click();
          await page.locator('[data-trade-tab="discussion"]').click();
          await home(page);
          const before = await snapshot(page);
          assert.equal(before.trial.posts.length, 1);
          const original = before.trial.posts[0];
          const invalidNotes = [
            { id: 'local-\ud800', title: 'High surrogate note' },
            { id: 'local-\udc00', title: 'Low surrogate note' },
          ];
          const validNotes = [
            { id: 'local-中文', title: 'Chinese route note', hash: '#/forum/post/local-%E4%B8%AD%E6%96%87' },
            {
              id: 'local-emoji-😀',
              title: 'Emoji route note',
              hash: '#/forum/post/local-emoji-%F0%9F%98%80',
            },
            { id: 'local-space note', title: 'Space route note', hash: '#/forum/post/local-space%20note' },
            { id: 'local-100%', title: 'Percent route note', hash: '#/forum/post/local-100%25' },
          ];
          const damaged = structuredClone(before.trial);
          damaged.revision++;
          for (const { id, title } of [...invalidNotes, ...validNotes]) {
            damaged.posts.push({
              ...original,
              id,
              title,
              body: 'Retained body for ' + title,
              excerpt: 'Retained excerpt for ' + title,
              strategy: 'trend',
            });
          }
          damaged.likes = [...damaged.likes, ...invalidNotes.map(({ id }) => id)];
          damaged.bookmarks = [...damaged.bookmarks, ...invalidNotes.map(({ id }) => id), validNotes[0].id];
          for (const [i, note] of invalidNotes.entries())
            damaged.comments.push({
              id: 'retained-reply-' + i,
              post: note.id,
              body: 'Keep this linked reply',
              author: damaged.profile.name,
              at: '2026-09-12T00:00:00Z',
              local: true,
            });
          await corrupt(context, damaged);
          await page.locator('#press-button').click();
          await page.waitForFunction(() => window.AF.store.read().samplePass === true);
          let expected = {
            trial: { ...damaged, revision: damaged.revision + 1, samplePass: true },
            exchange: before.exchange,
          };
          await assertPersisted(page, expected);
          entry.badRowAudits = [];
          async function badRows(surface) {
            for (const note of invalidNotes) {
              const row = page
                .locator('.journal-row')
                .filter({ has: page.locator('h3', { hasText: note.title }) });
              await row.waitFor();
              assert.equal(await row.count(), 1);
              assert.match(await row.innerText(), /Saved note link unavailable/);
              assert.match(await row.innerText(), /1 reply/);
              assert.match(await row.innerText(), /Liked/);
              assert.ok((await row.innerText()).includes('Retained excerpt for ' + note.title));
              assert.equal(await row.getByRole('link').count(), 0);
              const interactive = await row.evaluate((node) =>
                [node, ...node.querySelectorAll('*')]
                  .filter(
                    (element) =>
                      element.matches(
                        'a,button,input,textarea,select,[href],[data-route],[onclick],[onkeydown],[onkeyup],[role="link"],[role="button"],[contenteditable="true"]',
                      ) || element.tabIndex >= 0,
                  )
                  .map((element) => element.outerHTML),
              );
              assert.deepEqual(
                interactive,
                [],
                'unavailable note has no pointer or keyboard navigation control',
              );
              entry.badRowAudits.push({ surface, title: note.title, interactiveCount: interactive.length });
            }
          }
          await page.locator('[data-route="/trade/trend"]').first().click();
          await page.waitForTimeout(150);
          assert.deepEqual(
            entry.pageErrors,
            [],
            'damaged note links must not throw during real Discussion rendering',
          );
          await page.locator('#trade-price svg').waitFor();
          assert.equal(await page.locator('#trade-returns svg').count(), 1);
          await badRows('Discussion');
          const desktopBox = await page.locator('#trade-price svg').getAttribute('viewBox');
          for (const width of [600, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.waitForFunction(
              ({ compact, desktopBox }) => {
                const box = document.querySelector('#trade-price svg')?.getAttribute('viewBox');
                return compact ? box?.endsWith('540') : box === desktopBox;
              },
              { compact: width === 600, desktopBox },
            );
            assert.equal(await page.locator('#trade-returns svg').count(), 1);
            assert.deepEqual(entry.pageErrors, []);
            await assertPersisted(page, expected);
          }
          await forum(page);
          await badRows('Forum');
          await page.locator('a[href="#/account/settings"]').first().click();
          await page.locator('a[href="#/account/notes"]').first().click();
          await badRows('Notes');
          await page.locator('a[href="#/account/saved"]').first().click();
          await badRows('Saved');
          await page.reload();
          await ready(page);
          await badRows('Saved after reload');
          await assertPersisted(page, expected);
          for (const note of validNotes) {
            await forum(page);
            const row = page
              .locator('.journal-row')
              .filter({ has: page.locator('h3', { hasText: note.title }) });
            assert.deepEqual(
              await row.locator('a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href'))),
              [note.hash, note.hash],
            );
            await row.locator('.read-link').click();
            await page.locator('.article-page').waitFor();
            assert.equal(new URL(page.url()).hash, note.hash);
            assert.equal(await page.locator('.article-page h1').innerText(), note.title);
            assert.equal(await page.locator('.article-prose').innerText(), 'Retained body for ' + note.title);
            await page.reload();
            await ready(page);
            assert.equal(await page.locator('.article-page h1').innerText(), note.title);
            await assertPersisted(page, expected);
          }
          await forum(page);
          await page
            .locator('.journal-row')
            .filter({ hasText: 'Native unaffected note' })
            .locator('.read-link')
            .click();
          await page.locator('.article-page').waitFor();
          await page.locator('[data-like]').click();
          expected = {
            ...expected,
            trial: {
              ...expected.trial,
              revision: expected.trial.revision + 1,
              likes: [...expected.trial.likes, original.id],
            },
          };
          await assertPersisted(page, expected);
          await page.locator('[data-bookmark]').click();
          expected = {
            ...expected,
            trial: {
              ...expected.trial,
              revision: expected.trial.revision + 1,
              bookmarks: [...expected.trial.bookmarks, original.id],
            },
          };
          await assertPersisted(page, expected);
          const replyBody = 'Native reply remains attached to the original valid note.';
          await page.locator('#comment-body').fill(replyBody);
          await page.locator('#comment-form button[type="submit"]').click();
          const afterReply = await snapshot(page);
          const reply = afterReply.trial.comments.at(-1);
          assert.equal(afterReply.trial.comments.length, expected.trial.comments.length + 1);
          assert.deepEqual(Object.keys(reply).sort(), ['at', 'author', 'body', 'id', 'local', 'post']);
          assert.equal(typeof reply.id, 'string');
          assert.ok(
            reply.id.length > 0 && !expected.trial.comments.some((comment) => comment.id === reply.id),
          );
          assert.ok(Number.isFinite(Date.parse(reply.at)));
          assert.deepEqual(reply, {
            id: reply.id,
            at: reply.at,
            post: original.id,
            body: replyBody,
            author: expected.trial.profile.name,
            local: true,
          });
          expected = {
            ...expected,
            trial: {
              ...expected.trial,
              revision: expected.trial.revision + 1,
              comments: [...expected.trial.comments, reply],
            },
          };
          await assertPersisted(page, expected);
          await page.reload();
          await ready(page);
          assert.equal(await page.locator('.article-page h1').innerText(), 'Native unaffected note');
          assert.equal(await page.locator('[data-like]').getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('[data-bookmark]').getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('.comment').filter({ hasText: replyBody }).count(), 1);
          await home(page);
          await page.locator('a[href="#/account/settings"]').first().click();
          await page.locator('a[href="#/account/funds"]').first().click();
          await page.locator('.balance-notebook').waitFor();
          await assertPersisted(page, expected);
          assert.deepEqual(entry.pageErrors, []);
          entry.validRoutes = validNotes;
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

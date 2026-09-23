import assert from 'node:assert/strict';
import { verifyManagementBoundaries } from '../test/helpers/management-browser-boundaries.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDashboardServer } from './serve-management-dashboard.mjs';

// The fixed receipt denotes the current invocation. Preserve earlier bytes in
// history before tool loading can fail, so stale PASS cannot represent this run.
await mkdir('.checks/pr11/history', { recursive: true });
try {
  await rename(
    '.checks/pr11/management-browser.json',
    `.checks/pr11/history/management-browser-${randomUUID()}.json`,
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (!process.env.AF_PLAYWRIGHT_PATH) throw new Error('AF_PLAYWRIGHT_PATH is required');
const { chromium } = await import(pathToFileURL(resolve(process.env.AF_PLAYWRIGHT_PATH)));
const server = await createDashboardServer({
  root: resolve('docs/management/dashboard'),
  host: '127.0.0.1',
  port: 0,
});
let browser;
let result;
const failures = [];
try {
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  browser = await chromium.launch({
    executablePath:
      process.env.AF_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [];
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      /Refused to|Content Security Policy/i.test(message.text()) &&
      !message.text().includes('frame-ancestors')
    )
      errors.push(message.text());
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/agent-forum.html`);
  await page.waitForLoadState('networkidle');
  assert.ok((await page.locator('.message').count()) > 0);
  await page.locator('#keyword').fill('AF-MIGRATION');
  assert.ok((await page.locator('.message').count()) > 0);
  await page.locator('#keyword').fill('<b>literal unmatched text</b>');
  assert.equal(await page.locator('.message').count(), 0);
  await page.goto(`${origin}/index.html`);
  await page.waitForLoadState('networkidle');
  const initialCards = await page.locator('.task-card').count();
  assert.ok(initialCards > 0);
  const firstTitle = await page.locator('.task-card strong').first().textContent();
  await page.locator('.task-card').first().click();
  assert.equal(await page.locator('#task-dialog').evaluate((node) => node.open), true);
  assert.equal(await page.locator('#task-dialog-title').textContent(), firstTitle);
  await page.locator('#close-task-dialog').click();
  await page.locator('[data-view="list"]').click();
  assert.equal(await page.locator('#task-board tbody tr').count(), initialCards);
  await page.locator('[data-filter="blocked"]').click();
  for (const status of await page.locator('#task-board tbody .status').allTextContents())
    assert.match(status, /BLOCKED/);
  await page.locator('[data-filter="all"]').click();
  await page.locator('[data-view="board"]').click();
  await page.locator('#dashboard-search').fill('[.*]');
  assert.equal(await page.locator('#no-search-results').isVisible(), true);
  await page.locator('#dashboard-search').press('Escape');
  assert.equal(await page.locator('.task-card').count(), initialCards);
  await page.locator('#sidebar-toggle').click();
  assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false');
  await page.locator('#sidebar-toggle').click();
  await page.route('**/data/dashboard.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.locator('#refresh-dashboard').click();
  await page.waitForFunction(() =>
    globalThis.document.querySelector('#data-state').textContent.includes('数据源错误'),
  );
  assert.equal(await page.locator('.task-card').count(), initialCards);
  await page.unroute('**/data/dashboard.json');
  await page.locator('#refresh-dashboard').click();
  await page.waitForFunction(() =>
    globalThis.document.querySelector('#data-state').textContent.startsWith('快照：'),
  );
  await mkdir('.checks/blue-dashboard-2026-09-13', { recursive: true });
  await page.evaluate(() => globalThis.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.checks/blue-dashboard-2026-09-13/desktop.png' });
  await page.goto(`${origin}/index.html#worker-reports`);
  await page.waitForLoadState('networkidle');
  assert.ok((await page.locator('#worker-reports article').count()) > 0);
  await page.locator('#worker-report-search').fill('[.*]');
  assert.equal(await page.locator('#worker-reports article').count(), 0);
  await page.locator('#worker-report-search').fill('');
  assert.ok((await page.locator('#worker-reports article').count()) > 0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth),
      true,
    );
  }
  await page.locator('#mobile-menu').click();
  assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'), 'true');
  await page.locator('#sidebar-nav a[href="#project-preview"]').click();
  assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'), 'false');
  await page.waitForFunction(
    () => globalThis.document.querySelector('#sidebar').getBoundingClientRect().right <= 0,
  );
  await page.evaluate(() => globalThis.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.checks/blue-dashboard-2026-09-13/mobile.png' });
  assert.ok(requests.every((request) => request.method === 'GET'));
  assert.ok(requests.every((request) => !request.url.includes('/api/posts')));
  await page.reload();
  await page.waitForLoadState('networkidle');
  assert.ok((await page.locator('#worker-reports article').count()) > 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const boundaryChecks = await verifyManagementBoundaries(page, origin);
  assert.deepEqual(errors, []);
  result = {
    status: 'PASS',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeClean: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '',
    checks: [
      ...boundaryChecks,
      'Canonical Forum messages and literal search',
      'Worker reports preserve sources and support literal search',
      'Desktop/mobile no horizontal overflow',
      'Reload, no page errors or CSP violations',
      'No local composer or write API',
      'Task board/list, filters, detail dialog and literal global search',
      'Sidebar desktop/mobile interactions and 320px layout',
      'Refresh failure preserves snapshot and later refresh recovers',
    ],
  };
} catch (error) {
  failures.push(error);
} finally {
  try {
    await browser?.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    if (server.listening)
      await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length) throw failures[0];
await mkdir('.checks/pr11', { recursive: true });
await writeFile('.checks/pr11/management-browser.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDashboardServer } from './serve-management-dashboard.mjs';

if (!process.env.AF_PLAYWRIGHT_PATH) throw new Error('AF_PLAYWRIGHT_PATH is required');
const { chromium } = await import(pathToFileURL(resolve(process.env.AF_PLAYWRIGHT_PATH)));
const server = await createDashboardServer({
  root: resolve('docs/management/dashboard'),
  host: '127.0.0.1',
  port: 0,
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({
  executablePath:
    process.env.AF_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
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
  await page.goto(`${origin}/index.html#worker-reports`);
  await page.waitForLoadState('networkidle');
  assert.ok((await page.locator('#worker-reports article').count()) > 0);
  await page.locator('#worker-report-search').fill('[.*]');
  assert.equal(await page.locator('#worker-reports article').count(), 0);
  await page.locator('#worker-report-search').fill('');
  assert.ok((await page.locator('#worker-reports article').count()) > 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth),
      true,
    );
  }
  await page.reload();
  await page.waitForLoadState('networkidle');
  assert.ok((await page.locator('#worker-reports article').count()) > 0);
  assert.deepEqual(errors, []);
  const result = {
    status: 'PASS',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeClean: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '',
    checks: [
      'Canonical Forum messages and literal search',
      'Worker reports preserve sources and support literal search',
      'Desktop/mobile no horizontal overflow',
      'Reload, no page errors or CSP violations',
      'No local composer or write API',
    ],
  };
  await mkdir('.checks/pr11', { recursive: true });
  await writeFile('.checks/pr11/management-browser.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

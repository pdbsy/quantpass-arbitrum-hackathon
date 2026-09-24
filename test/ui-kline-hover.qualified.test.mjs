/* global window, location */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { importUserUI } from '../tools/import-user-ui.mjs';
import { buildApp } from '../apps/server/src/app.ts';
import { verifyInstallation } from '../tools/coverage/toolchain.mjs';

const browserDirectory = process.env.AF_QUALIFIED_BROWSER_TOOLS;
const chrome = process.env.CHROMIUM_PATH;
// Real compiled product and native pointer/keyboard events. Removing the
// tooltip or picking an adjacent candle breaks the visible value assertions.
test(
  'K-line inspection shows the selected candle and clears stale selections',
  {
    skip: !browserDirectory || !chrome,
    timeout: 60000,
  },
  async (t) => {
    const root = resolve(import.meta.dirname, '..');
    const lock = JSON.parse(await readFile(resolve(root, 'planning/coverage-toolchain.lock.json')));
    verifyInstallation(resolve(browserDirectory), lock.browser.installedFiles);
    await mkdir(resolve(root, '.checks/kline-hover'), { recursive: true });
    const output = await mkdtemp(resolve(root, '.checks/kline-hover/run-'));
    const site = resolve(output, 'site');
    const assets = resolve(output, 'assets');
    const dist = resolve(output, 'dist');
    await mkdir(site);
    await importUserUI(
      await readFile(resolve(root, 'apps/web/prototype/AlphaForge_v3_EN.html'), 'utf8'),
      site,
      assets,
    );
    await build({
      configFile: false,
      root: site,
      publicDir: assets,
      logLevel: 'silent',
      plugins: [
        {
          name: 'product-entry',
          enforce: 'pre',
          resolveId(id) {
            if (id === '/src/product-ui.ts') return resolve(root, 'apps/web/src/product-ui.ts');
          },
        },
      ],
      build: { outDir: dist, emptyOutDir: true },
    });
    const origin = 'http://127.0.0.1:19641';
    const { app } = await buildApp({
      origin,
      dbPath: resolve(output, 'ledger.sqlite'),
      env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
      webRoot: dist,
    });
    t.after(() => app.close());
    await app.listen({ host: '127.0.0.1', port: 19641 });
    const { chromium } = await import(pathToFileURL(resolve(browserDirectory, 'index.mjs')).href);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    t.diagnostic(`Native browser: ${browser.version()}; executable: ${chrome}`);
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, hasTouch: true });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/#/trade/trend');
    const chart = page.locator('[data-v3-chart="price"]');
    await chart.waitFor();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(errors, [], 'product must initialize without browser errors');
    async function select(index) {
      await chart.scrollIntoViewIfNeeded();
      const point = await chart.evaluate((svg, i) => {
        const rows = window.AF.marketData.candles(svg.dataset.strategy, window.AF.view.priceRange);
        const g = window.AF.charts.G;
        const p = svg.createSVGPoint();
        p.x = g.L + ((i + 0.5) / rows.length) * (g.R - g.L);
        p.y = 150;
        const screen = p.matrixTransform(svg.getScreenCTM());
        return { x: screen.x, y: screen.y, row: rows[i] };
      }, index);
      await page.mouse.move(point.x, point.y);
      return point.row;
    }
    const money = (n) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 100);
    const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
    const percent = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%';
    const field = (key) => page.locator(`[data-candle-field="${key}"]`).textContent();
    async function assertUnobscured() {
      const geometry = await chart.evaluate((svg) => {
        const panel = svg.parentElement.querySelector('[data-candle-tooltip]');
        const bounds = (node) => node.getBoundingClientRect().toJSON();
        const circle = svg.querySelector('#price-cursor circle');
        const point = svg.createSVGPoint();
        point.x = Number(circle.getAttribute('cx'));
        point.y = Number(circle.getAttribute('cy'));
        const selected = point.matrixTransform(svg.getScreenCTM());
        return {
          chart: bounds(svg),
          panel: bounds(panel),
          section: bounds(svg.parentElement),
          note: bounds(svg.parentElement.querySelector('.chart-bottomnote')),
          selectedX: selected.x,
        };
      });
      const { chart: area, panel, section, note, selectedX } = geometry;
      assert.ok(
        panel.top >= area.bottom || selectedX < panel.left - 8 || selectedX > panel.right + 8,
        'detail panel must not cover the selected candle/crosshair',
      );
      assert.ok(
        panel.top >= section.top && panel.bottom <= section.bottom,
        'detail stays inside its chart section',
      );
      assert.ok(panel.bottom <= note.top, 'detail must not overlap the chart methodology/footer');
    }

    for (const index of [0, 12, 23]) {
      const row = await select(index);
      assert.equal(
        await page.locator('[data-candle-tooltip]').count(),
        1,
        'hover must expose a candle detail panel',
      );
      assert.equal(
        await field('time'),
        new Date(row.time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      );
      for (const key of ['open', 'high', 'low', 'close'])
        assert.equal(await field(key), money(row[key]) + ' DEMO');
      assert.equal(await field('change'), signed(row.close - row.open) + ' DEMO');
      assert.equal(await field('changePercent'), percent(((row.close - row.open) / row.open) * 100));
      assert.equal(await field('amplitude'), (((row.high - row.low) / row.open) * 100).toFixed(2) + '%');
      assert.equal(
        await field('volume'),
        new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(row.volume) + ' Pass',
      );
      assert.equal(await field('turnover'), money(row.quoteVolume) + ' DEMO');
      assert.equal(
        await chart.evaluate((svg) => Number(svg.querySelector('#price-cursor line').getAttribute('x1'))),
        16 + ((index + 0.5) / 24) * 802,
      );
      const box = await page.locator('[data-candle-tooltip]').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 1440, 'tooltip stays within viewport');
      await assertUnobscured();
    }
    await page.screenshot({ path: resolve(output, 'desktop.png') });
    await page.mouse.move(0, 0);
    assert.equal(await page.locator('[data-candle-tooltip]').count(), 0);
    assert.equal(await chart.locator('#price-cursor').getAttribute('visibility'), 'hidden');
    await chart.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('[data-candle-tooltip]').count(), 1);
    assert.equal(
      await field('time'),
      await chart.evaluate(
        (svg) =>
          new Date(window.AF.marketData.candles(svg.dataset.strategy, window.AF.view.priceRange)[22].time)
            .toISOString()
            .slice(0, 16)
            .replace('T', ' ') + ' UTC',
      ),
    );
    assert.equal(
      await chart.evaluate((svg) => Number(svg.querySelector('#price-cursor line').getAttribute('x1'))),
      16 + (22.5 / 24) * 802,
    );

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-candle-tooltip]').count(), 0);
    await select(12);
    await page.locator('[data-price-range="7d"]').click();
    assert.equal(await page.locator('[data-candle-tooltip]').count(), 0);
    const row7d = await select(55);
    assert.equal(
      await field('time'),
      new Date(row7d.time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    );
    await page.locator('[data-price-style="line"]').click();
    assert.equal(await page.locator('[data-candle-tooltip]').count(), 0);
    await select(0);
    await page.locator('[data-price-style="candle"]').click();
    await select(27);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150); // existing responsive chart debounce is 80 ms
    assert.equal(await page.locator('[data-candle-tooltip]').count(), 0, 'resize clears old candle details');
    await select(27);
    const mobileBox = await page.locator('[data-candle-tooltip]').boundingBox();
    assert.ok(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390);
    await assertUnobscured();
    await page.mouse.move(0, 0);
    const touchPoint = await chart.evaluate((svg) => {
      const p = svg.createSVGPoint();
      p.x = 16 + (10.5 / 56) * 802;
      p.y = 150;
      const screen = p.matrixTransform(svg.getScreenCTM());
      const row = window.AF.marketData.candles(svg.dataset.strategy, window.AF.view.priceRange)[10];
      return {
        x: screen.x,
        y: screen.y,
        time: new Date(row.time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      };
    });
    await page.touchscreen.tap(touchPoint.x, touchPoint.y);
    assert.equal(
      await page.locator('[data-candle-tooltip]').count(),
      1,
      'touch selection remains visible after release',
    );
    await assertUnobscured();
    assert.equal(await field('time'), touchPoint.time);
    assert.equal(
      await chart.evaluate((svg) => Number(svg.querySelector('#price-cursor line').getAttribute('x1'))),
      16 + (10.5 / 56) * 802,
    );
    await page.screenshot({ path: resolve(output, 'mobile.png') });
    // Browser-native touch input must pan the page without dismissing inline
    // details, including the trusted pointercancel emitted when Chrome takes over.
    const panel = page.locator('[data-candle-tooltip]');
    const startBox = await panel.boundingBox();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => {
      window.candlePanEvents = [];
      for (const type of ['pointerdown', 'pointercancel'])
        window.document.addEventListener(
          type,
          (event) => {
            window.candlePanEvents.push({
              type,
              trusted: event.isTrusted,
              touch: event.pointerType === 'touch',
            });
          },
          { once: true, capture: true },
        );
    });
    const cdp = await context.newCDPSession(page);
    const x = startBox.x + startBox.width / 2;
    const y = Math.min(startBox.y + 70, 700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 30 }],
      });
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    assert.equal(await panel.count(), 1, 'native touch pan from details must preserve the selected candle');
    await page.waitForFunction((before) => window.scrollY > before + 100, scrollBefore);
    assert.equal(await field('time'), touchPoint.time, 'panning does not switch the selected candle');
    const events = await page.evaluate(() => window.candlePanEvents);
    assert.ok(events.some((e) => e.type === 'pointerdown' && e.trusted && e.touch));
    assert.ok(events.some((e) => e.type === 'pointercancel' && e.trusted && e.touch));
    const foot = await panel.locator('p').boundingBox();
    assert.ok(
      foot.y >= 0 && foot.y + foot.height < 774,
      'full explanation is visible above the mobile dock after panning',
    );
    await page.screenshot({ path: resolve(output, 'mobile-scrolled.png') });
    await page.touchscreen.tap(5, 400);
    assert.equal(await panel.count(), 0, 'a genuine outside tap still clears details');

    await page.setViewportSize({ width: 900, height: 1000 });
    await page.waitForTimeout(150);
    for (const index of [0, 27, 55]) {
      await select(index);
      await assertUnobscured();
    }
    await page.screenshot({ path: resolve(output, 'narrow-desktop.png') });
    await page.evaluate(() => {
      location.hash = '#/home';
    });
    await page.locator('[data-v3-chart="price"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-candle-tooltip]').count(), 0);
    assert.deepEqual(errors, []);
    t.diagnostic(`Screenshots: ${output}`);
  },
);

/* global window, document */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';

const browserPackage =
  process.env.AF_UI_BROWSER_PACKAGE ??
  '/opt/alphaforge/mock-source/.checks/release-browser-tools/package/index.mjs';
const browserBinary =
  process.env.CHROMIUM_PATH ?? '/opt/alphaforge/mock-browser-cache/chromium-1234/chrome-linux64/chrome';
const available = await Promise.all([
  stat(browserPackage).catch(() => null),
  stat(browserBinary).catch(() => null),
]);

test(
  'native desktop and mobile PASS chart keeps actual small prices readable and hover aligned',
  {
    skip: available.some((entry) => !entry) ? 'NOT_RUN: qualified local browser tools unavailable' : false,
    timeout: 30_000,
  },
  async (t) => {
    const root = resolve(import.meta.dirname, '..');
    const directory = await mkdtemp(join(tmpdir(), 'af-pass-chart-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = join(directory, 'entry.js');
    await writeFile(
      entry,
      `import { installPassPriceChart } from ${JSON.stringify(resolve(root, 'apps/web/src/pass-price-chart.ts'))};
       import { installCandleInspection } from ${JSON.stringify(resolve(root, 'apps/web/src/kline-hover.ts'))};
       window.passChartModules = { installPassPriceChart, installCandleInspection };`,
    );
    const output = await build({
      configFile: false,
      logLevel: 'silent',
      build: { lib: { entry, formats: ['iife'], name: 'PassChartFixture' }, write: false },
    });
    const bundle = (Array.isArray(output) ? output[0] : output).output.find((file) => file.type === 'chunk');
    assert.ok(bundle);
    const prototype = await readFile(resolve(root, 'apps/web/prototype/AlphaForge_v3_EN.html'), 'utf8');
    const script = prototype.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const styles = prototype.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    const inspectionStyles = await readFile(resolve(root, 'apps/web/src/kline-hover.css'), 'utf8');
    assert.ok(script && styles);
    const boundary = script.indexOf('AF.homeHtml =');
    assert.ok(boundary > 0);
    const { chromium } = await import(pathToFileURL(browserPackage).href);
    const browser = await chromium.launch({
      executablePath: browserBinary,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    t.after(() => browser.close());
    for (const viewport of [
      { width: 1440, height: 1100 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(`<style>${styles}\n${inspectionStyles}</style>`);
      await page.addScriptTag({ content: script.slice(0, boundary) });
      await page.addScriptTag({ content: bundle.code });
      await page.evaluate(() => {
        const first = {
          time: Date.UTC(2026, 9, 10, 1, 20),
          open: 50,
          high: 50,
          low: 50,
          close: 50,
          volume: 0.01,
          quoteVolume: 1,
        };
        const second = {
          ...first,
          time: first.time + 900_000,
          open: 50.0001,
          high: 50.0002,
          low: 50.0001,
          close: 50.0001,
        };
        window.chartRows = [first, second];
        window.AF.passMarket = {
          candles: () => window.chartRows,
          metrics: () => ({ price: 50, change: null }),
        };
        window.AF.launchState = {
          snapshot: {
            markets: {
              AMZN: {
                state: 'LAUNCHED',
                pool: '0x0000000000000000000000000000000000000001',
                reserveUsdcRaw: '250000020097',
                reservePassRaw: '499999960108008183036872',
                mintPriceUsdcRaw: '500000',
              },
            },
          },
        };
        window.AF.view.priceRange = '24h';
        window.AF.view.priceStyle = 'candle';
        const original = window.AF.charts.priceBlock(window.AF.strategy('amzn'));
        const template = document.createElement('template');
        template.innerHTML = original;
        window.originalToolbar = template.content.querySelector('.chart-toolbar').outerHTML;
        window.originalStockChart = window.AF.charts.returnBlock(window.AF.strategy('amzn'));
        window.passChartModules.installPassPriceChart(window.AF);
        window.passChartModules.installCandleInspection(window.AF, document, {
          quoteUnit: 'AF-USDC',
          volumeUnit: 'AF-USDC',
          english: true,
          sourceLabel: 'Indexed chain swaps',
        });
        window.renderChart = () => {
          document.body.innerHTML = `<main class="wrap terminal-page">${window.AF.charts.priceBlock(window.AF.strategy('amzn'))}</main>`;
        };
        window.renderChart();
      });
      const chart = page.locator('[data-pass-price-chart]');
      await chart.scrollIntoViewIfNeeded();
      assert.equal(await chart.locator('rect').count(), 2);
      assert.match(await page.locator('#price-readout').textContent(), /H 0\.500002/);
      assert.match(await page.locator('.chart-data-scroll tbody').textContent(), /0\.500001/);
      assert.equal(
        await page.locator('.chart-data-scroll tbody tr').first().locator('td').last().textContent(),
        '0.01',
      );
      assert.match(
        await page.locator('.chart-bottomnote').textContent(),
        /5-minute candles · 2 indexed intervals/,
      );
      const headline = page.locator('.quote-headline > strong');
      assert.equal(await headline.textContent(), '0.500000080086');
      assert.match(await headline.getAttribute('title'), /Current pool spot: 0\.500000080086/);
      assert.match(await headline.getAttribute('aria-label'), /0\.500000080086 AF-USDC per PASS/);
      assert.equal(await headline.getAttribute('data-pool-reserve-usdc-raw'), '250000020097');
      assert.match(await page.locator('.price-unit').textContent(), /Current pool spot/);
      assert.match(await page.locator('#price-readout').textContent(), /^Execution · O 0\.500001/);
      assert.equal(await page.locator('.change-badge').textContent(), '— 24H');
      const fits = await headline.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const frame = element.closest('.terminal-chart').getBoundingClientRect();
        return bounds.left >= frame.left && bounds.right <= frame.right;
      });
      assert.ok(fits, 'the full twelve-decimal quote fits the existing desktop/mobile chart width');
      const unchanged = await page.evaluate(() => ({
        toolbar: document.querySelector('.chart-toolbar').outerHTML === window.originalToolbar,
        stock: window.AF.charts.returnBlock(window.AF.strategy('amzn')) === window.originalStockChart,
      }));
      assert.deepEqual(unchanged, { toolbar: true, stock: true });
      const point = await chart.evaluate((svg) => {
        const g = window.AF.charts.G;
        const local = svg.createSVGPoint();
        local.x = g.L + (1.5 / 2) * (g.R - g.L);
        local.y = 145;
        const screen = local.matrixTransform(svg.getScreenCTM());
        return { x: screen.x, y: screen.y };
      });
      await page.mouse.move(point.x, point.y);
      await page.locator('[data-candle-tooltip]').waitFor();
      assert.equal(await page.locator('[data-candle-field="high"]').textContent(), '0.500002 AF-USDC');
      assert.equal(await page.locator('[data-candle-field="close"]').textContent(), '0.500001 AF-USDC');
      const aligned = await chart.evaluate((svg) => {
        const cursor = svg.querySelector('#price-cursor circle');
        const candle = svg.querySelectorAll('rect')[1];
        return Math.abs(Number(cursor.getAttribute('cy')) - Number(candle.getAttribute('y'))) < 0.001;
      });
      assert.ok(aligned, 'hover uses the same vertical scale as rendered candles');
      await page.evaluate(() => {
        window.AF.view.priceStyle = 'line';
        window.renderChart();
      });
      const path = await chart.locator('path').getAttribute('d');
      assert.equal(Array.from(path.matchAll(/M/g)).length, 2);
      assert.doesNotMatch(path, /L/);
      await page.evaluate(() => {
        window.chartRows = [];
        window.AF.launchState.snapshot.markets.AMZN.reserveUsdcRaw = '250001000000';
        window.AF.launchState.snapshot.markets.AMZN.reservePassRaw = '500000000000000000000000';
        window.renderChart();
      });
      assert.equal(
        await headline.textContent(),
        '0.500002',
        'a fresh pool snapshot updates before candle indexing',
      );
      assert.match(await page.locator('#price-readout').textContent(), /No indexed swap candles/);
      assert.equal(await page.locator('[data-pass-price-chart]').count(), 0);
      await page.evaluate(() => {
        window.AF.launchState.snapshot.markets.AMZN.reservePassRaw = '0';
        window.renderChart();
      });
      assert.equal(
        await headline.textContent(),
        '—',
        'a live pool without usable reserves cannot show a reference quote',
      );
      assert.match(await page.locator('.price-unit').textContent(), /Price unavailable/);
      await page.evaluate(() => {
        window.AF.launchState.snapshot.markets.AMZN.reservePassRaw = '500000000000000000000000';
        window.AF.launchState.snapshot.markets.AMZN.pool = null;
        window.renderChart();
      });
      assert.equal(await headline.textContent(), '—', 'a missing live pool remains unavailable');
      await page.evaluate(() => {
        window.AF.launchState.snapshot.markets.AMZN.state = 'MINTING';
        window.renderChart();
      });
      assert.equal(await headline.textContent(), '0.50');
      assert.match(await page.locator('.price-unit').textContent(), /Initial reference/);
      assert.equal(await page.locator('[data-price-reference="0.5"]').count(), 1);
      assert.equal(await page.locator('[data-pass-price-chart]').count(), 0);
      assert.match(await page.locator('#price-readout').textContent(), /No executed market price/);
      assert.deepEqual(errors, []);
      await page.close();
    }
  },
);

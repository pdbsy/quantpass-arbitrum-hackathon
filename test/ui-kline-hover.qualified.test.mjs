/* global window, location, document, innerWidth */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { importUserUI } from '../tools/import-user-ui.mjs';
import { buildApp } from '../apps/server/src/app.ts';
import { verifyInstallation } from '../tools/coverage/toolchain.mjs';
import { StrategyClient } from '../tools/automata/strategy-client.mjs';
import { provisionEma, advanceEma } from '../tools/automata/ema-demo-runtime.mjs';
import { emaTargets } from '../packages/automata/src/ema-strategy.ts';
import { buildPublicTestnetApp } from '../apps/server/src/testnet-app.ts';
import { TradingChainRuntime } from '../apps/server/src/trading-chain-runtime.ts';
import { WalletAuthStore } from '../packages/testnet/src/wallet-auth.ts';
import { tradingInterface } from '../packages/testnet/src/trading-abi.ts';
import { tradingRpcFixture, tradingFixtureAddress } from './helpers/testnet-trading-rpc.ts';

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
        assert.equal(await field(key), money(row[key]) + ' ETH');
      assert.equal(await field('change'), signed(row.close - row.open) + ' ETH');
      assert.equal(await field('changePercent'), percent(((row.close - row.open) / row.open) * 100));
      assert.equal(await field('amplitude'), (((row.high - row.low) / row.open) * 100).toFixed(2) + '%');
      assert.equal(
        await field('volume'),
        new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(row.volume) + ' Pass',
      );
      assert.equal(await field('turnover'), money(row.quoteVolume) + ' ETH');
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

test(
  'two isolated Testnet tabs hide Alice data when the shared authenticated cookie becomes Bob',
  { skip: !browserDirectory || !chrome, timeout: 60000 },
  async (t) => {
    const root = resolve(import.meta.dirname, '..');
    const lock = JSON.parse(await readFile(resolve(root, 'planning/coverage-toolchain.lock.json')));
    verifyInstallation(resolve(browserDirectory), lock.browser.installedFiles);
    await mkdir(resolve(root, '.checks/w1-owner'), { recursive: true });
    const output = await mkdtemp(resolve(root, '.checks/w1-owner/run-'));
    const dist = resolve(output, 'dist');
    await importUserUI(
      await readFile(resolve(root, 'apps/web/prototype/AlphaForge_v3_EN.html'), 'utf8'),
      resolve(root, 'apps/web'),
      resolve(root, 'build/ui-import'),
    );
    await build({
      configFile: resolve(root, 'apps/web/vite.config.ts'),
      root: resolve(root, 'apps/web'),
      logLevel: 'silent',
      build: { outDir: dist, emptyOutDir: true },
    });
    const origin = 'https://w1-owner-fixture.example';
    const hash = '0x' + 'ab'.repeat(32),
      logs = [];
    const addLog = (name, args, block = 16) => {
      const encoded = tradingInterface.encodeEventLog(tradingInterface.getEvent(name), args),
        index = logs.length;
      logs.push({
        address: tradingFixtureAddress(50),
        blockNumber: '0x' + block.toString(16),
        blockHash: block === 16 ? hash : '0x' + block.toString(16).padStart(64, '0'),
        transactionHash: '0x' + String(index + 1).padStart(64, '0'),
        transactionIndex: '0x' + index.toString(16),
        logIndex: '0x' + index.toString(16),
        data: encoded.data,
        topics: encoded.topics,
        removed: false,
      });
    };
    addLog('Deposited', [1000000000n, 1000000000n, 1000n * 10n ** 18n], 1);
    addLog('CapitalChanged', [true, 900000000n, 900n * 10n ** 18n, 1n], 2);
    for (let index = 0; index < 3; index++)
      addLog('SwapExecuted', [
        BigInt(index + 2),
        1n,
        tradingFixtureAddress(10 + index),
        true,
        100000000n,
        10n ** 18n,
      ]);
    const fixture = tradingRpcFixture('NONE', {
      historical: true,
      head: 16,
      logs,
      hashAt: (number) => (number === 16 ? hash : '0x' + number.toString(16).padStart(64, '0')),
    });
    const aliceOwner = fixture.inventory.owner,
      bobOwner = tradingFixtureAddress(99);
    const runtime = new TradingChainRuntime({
      dbPath: resolve(output, 'chain.sqlite'),
      evidencePath: resolve(output, 'evidence.sqlite'),
      manifest: fixture.manifest,
      inventory: fixture.inventory,
      rpc: fixture.client,
    });
    t.after(() => runtime.close());
    await runtime.syncToHead();
    const auth = new WalletAuthStore(resolve(output, 'auth.sqlite'), origin, {
      challengeTtlMs: 60000,
      sessionTtlMs: 60000,
      maxRows: 100,
    });
    const app = await buildPublicTestnetApp({
      origin,
      auth,
      webRoot: dist,
      runtimes: [{ id: 'alice-fixture-vault', runtime }],
      verifyOwner: async (_message, signature) => signature === '0x01',
    });
    t.after(() => app.close());
    const { chromium } = await import(pathToFileURL(resolve(browserDirectory, 'index.mjs')).href);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    t.after(() => context.close());
    let envelopeFixtureUsed = false;
    // All HTTPS requests remain inside this test's app.inject composition.
    // Until W2 integration, the fixture supplies the manager-approved additive
    // owner envelope from the exact same authenticated request cookie.
    await context.route(origin + '/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const headers = {
        ...(await request.allHeaders()),
        host: url.host,
        origin,
        'x-forwarded-proto': 'https',
      };
      const response = await app.inject({
        method: request.method(),
        url: url.pathname + url.search,
        headers,
        payload: request.postData() ?? undefined,
      });
      let body = response.rawPayload;
      if (url.pathname === '/api/testnet/vaults' && response.statusCode === 200) {
        const value = response.json();
        if (!Object.hasOwn(value, 'owner')) {
          envelopeFixtureUsed = true;
          const token = /(?:^|;\s*)__Host-af_testnet=([^;]*)/.exec(headers.cookie ?? '')?.[1] ?? '';
          body = Buffer.from(JSON.stringify({ ...value, owner: auth.owner(token, Date.now()) }));
        }
      }
      const outgoing = Object.fromEntries(
        Object.entries(response.headers)
          .filter(([key]) => key !== 'content-length')
          .map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]),
      );
      await route.fulfill({ status: response.statusCode, headers: outgoing, body });
    });
    const alice = await context.newPage(),
      bob = await context.newPage();
    const errors = [];
    for (const [page, owner] of [
      [alice, aliceOwner],
      [bob, bobOwner],
    ]) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((identity) => {
        window.fixtureWallet = { owner: identity, signPrompts: 0, transactions: 0 };
        window.ethereum = {
          on() {},
          removeListener() {},
          async request({ method }) {
            if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [window.fixtureWallet.owner];
            if (method === 'eth_chainId') return '0xb626';
            if (method === 'personal_sign') {
              window.fixtureWallet.signPrompts++;
              return '0x01';
            }
            if (method === 'eth_sendTransaction') window.fixtureWallet.transactions++;
            throw new Error('UNEXPECTED_FIXTURE_WALLET_REQUEST');
          },
        };
      }, owner);
      await page.goto(origin + '/');
    }
    await alice.getByRole('button', { name: '连接钱包并登录' }).click();
    await alice.locator('main[data-testnet-phase="READY"]').waitFor();
    assert.equal(await alice.locator('.vault-card').count(), 1);
    await bob.getByRole('button', { name: '连接钱包并登录' }).click();
    await bob.locator('main[data-testnet-phase="EMPTY"]').waitFor();
    await alice.getByRole('button', { name: '刷新链上状态' }).click();
    await alice.locator('[data-testnet-identity-error]').waitFor();
    assert.equal(await alice.locator('main').getAttribute('data-testnet-phase'), 'DISCONNECTED');
    assert.equal(await alice.locator('.vault-card .metrics').count(), 0);
    assert.equal(await alice.getByRole('heading', { name: 'alice-fixture-vault', exact: true }).count(), 0);
    assert.equal(await alice.getByRole('button', { name: '预览待签交易' }).count(), 0);
    assert.match(
      await alice.locator('[data-testnet-identity-error]').textContent(),
      /重新连接钱包并登录.*不会自动请求签名/,
    );
    const wallet = await alice.evaluate(() => window.fixtureWallet);
    assert.deepEqual(wallet, { owner: aliceOwner, signPrompts: 1, transactions: 0 });
    assert.deepEqual(errors, []);
    await alice.screenshot({ path: resolve(output, 'owner-mismatch-mobile.png'), fullPage: true });
    await writeFile(
      resolve(output, 'owner-read-result.json'),
      JSON.stringify(
        {
          scope: 'ISOLATED_TEST_ONLY',
          initialPhase: 'READY',
          sharedSessionAfterBobLogin: bobOwner,
          aliceWallet: wallet,
          finalPhase: 'DISCONNECTED',
          visibleVaults: 0,
          automaticSignatures: 0,
          envelopeFixtureUsed,
        },
        null,
        2,
      ),
    );
    t.diagnostic(
      `Native two-tab private-cookie/compiled-owner regression: ${output}; additive envelope fixture used=${envelopeFixtureUsed}, no real wallet/signing/broadcast`,
    );
  },
);

// Native compiled-product regression: catches route/Escape label drift and
// verifies the actual exported file rather than a success toast.
test(
  'product account routes, mobile navigation and JSON export deliver usable local records',
  {
    skip: !browserDirectory || !chrome,
    timeout: 60000,
  },
  async (t) => {
    const root = resolve(import.meta.dirname, '..');
    const lock = JSON.parse(await readFile(resolve(root, 'planning/coverage-toolchain.lock.json')));
    verifyInstallation(resolve(browserDirectory), lock.browser.installedFiles);
    await mkdir(resolve(root, '.checks/w1-product'), { recursive: true });
    const output = await mkdtemp(resolve(root, '.checks/w1-product/run-'));
    const site = resolve(output, 'site'),
      assets = resolve(output, 'assets'),
      dist = resolve(output, 'dist');
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
    const origin = 'http://127.0.0.1:19642';
    const { app } = await buildApp({
      origin,
      dbPath: resolve(output, 'ledger.sqlite'),
      env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
      webRoot: dist,
    });
    t.after(() => app.close());
    await app.listen({ host: '127.0.0.1', port: 19642 });
    const { chromium } = await import(pathToFileURL(resolve(browserDirectory, 'index.mjs')).href);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/#/home');
    await page.locator('[data-product-login="bob"]').click();
    await page.waitForFunction(() => document.querySelector('[data-product-state]')?.textContent === 'EMPTY');
    const toggle = page.locator('.menu-toggle');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.locator('#nav-links [data-nav="market"]').click();
    await page.waitForFunction(
      () =>
        location.hash === '#/market' &&
        document.querySelector('.menu-toggle')?.getAttribute('aria-expanded') === 'false',
    );
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.getAttribute('aria-label'), 'Expand navigation');
    await toggle.click();
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-label'), 'Expand navigation');
    assert.equal(await toggle.evaluate((el) => el === document.activeElement), true);
    for (const tab of ['passes', 'saved', 'notes', 'trials', 'funds', 'settings']) {
      await page.goto(origin + '/#/account/' + tab);
      await page.waitForFunction(() => window.AF?.pages && !!document.querySelector('main h1'));
      assert.equal(await page.locator('[aria-label="M3 account chain status"]').count(), 0);
      assert.ok(await page.locator('main').textContent());
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        tab + ' should fit mobile',
      );
    }
    for (const tab of ['', 'trials', 'trial', 'activity', 'invalid-tab']) {
      await page.goto(origin + '/#/account' + (tab ? '/' + tab : ''));
      await page.waitForFunction(() => window.AF?.view?.accountTab === 'passes');
      assert.equal(await page.locator('[aria-label="M3 account chain status"]').count(), 0);
      assert.equal(await page.locator('[aria-current="page"][href="#/account/passes"]').count(), 1);
      assert.equal(await page.evaluate(() => location.hash), '#/account' + (tab ? '/' + tab : ''));
    }
    await page.goto(origin + '/#/not-a-route');
    await page.getByText('This page is not in the workshop yet.', { exact: true }).waitFor();
    await page.reload();
    await page.goto(origin + '/#/account/settings');
    await page.locator('main h1').waitFor();
    assert.equal(await page.locator('[aria-label="M3 account chain status"]').count(), 0);
    await page.goto(origin + '/#/account/trades');
    await page.locator('[data-wallet-account]').waitFor();
    assert.equal(await page.locator('[aria-label="Account sections"]').count(), 1);
    assert.equal(await page.locator('[aria-label="Account sections"] a[href="#/account/saved"]').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const strategy of ['trend', 'factor', 'mean', 'rotate', 'breakout', 'pairs']) {
      await page.goto(origin + '/#/trade/' + strategy);
      await page.locator('#pass-order-form').waitFor();
      assert.match(await page.locator('main').textContent(), /MOCK \/ FIXTURE/);
      for (const side of ['buy', 'sell']) {
        await page.locator(`[data-pass-side="${side}"]`).click();
        await page.locator('#pass-qty').fill('1');
        await page.locator('#pass-order-form button[type="submit"]').click();
        await page.locator('[data-v3-action="commit-order"]').click();
        await page.waitForFunction(() =>
          document.querySelector('#dialog-body h2')?.textContent?.includes('recorded'),
        );
        await page.locator('#app-dialog [data-close]').click();
      }
      assert.equal(await page.evaluate((id) => window.AF.exchange.read().positions[id].qty, strategy), 0);
      await page.reload();
      await page.locator('#pass-order-form').waitFor();
      await page.locator('[data-trade-tab="fills"]').click();
      assert.equal(await page.locator('.pass-fills tbody tr').count(), 2);
    }
    await page.goBack();
    await page.locator('main h1').waitFor();
    await page.goForward();
    await page.locator('#pass-order-form').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/#/account/settings');
    await page.evaluate(() => {
      window.AF.store.dispatch({ type: 'favorite', strategy: 'trend' });
      window.AF.store.dispatch({
        type: 'post',
        title: 'W1 export note',
        body: 'An isolated release test note with enough content.',
        category: 'Research Notes',
      });
      const post = window.AF.store.read().posts[0];
      window.AF.store.dispatch({ type: 'comment', post: post.id, body: 'W1 export reply' });
      window.AF.store.dispatch({ type: 'deposit', amount: 123 });
    });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'AlphaForge_local_demo.json');
    await download.saveAs(resolve(output, download.suggestedFilename()));
    const exported = JSON.parse(await readFile(resolve(output, download.suggestedFilename()), 'utf8'));
    assert.equal(exported.product, 'AlphaForge');
    assert.equal(exported.scope, 'LOCAL_PROTOTYPE_ONLY');
    assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
    assert.ok(Array.isArray(exported.state.favorites));
    assert.ok(exported.state.favorites.includes('trend'));
    assert.equal(exported.state.posts[0].title, 'W1 export note');
    assert.equal(exported.state.comments[0].body, 'W1 export reply');
    assert.equal(exported.state.history[0].amount, 123);
    assert.equal(exported.passMarket.orders.length, 12);
    await page.route('**/api/v1/product-snapshot', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"LOCAL_OPERATION_FAILED"}',
      }),
    );
    await page.locator('[data-product-refresh]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-product-state]')?.textContent === 'DISCONNECTED',
    );
    assert.match(await page.locator('[data-product-session-hint]').textContent(), /unavailable/);
    assert.equal(await page.locator('[aria-label="API account unavailable"]').count(), 1);
    assert.doesNotMatch(await page.locator('[aria-label="API account unavailable"]').textContent(), /EMPTY/);
    await page.unroute('**/api/v1/product-snapshot');
    await page.locator('[data-product-login="alice"]').click();
    await page.waitForFunction(() =>
      ['READY', 'EMPTY'].includes(document.querySelector('[data-product-state]')?.textContent),
    );
    assert.match(await page.locator('.local-backend-session').textContent(), /API alice/);
    await page.locator('[data-product-login="bob"]').click();
    await page.waitForFunction(() => document.querySelector('[data-product-state]')?.textContent === 'EMPTY');
    assert.match(await page.locator('.local-backend-session').textContent(), /API bob/);

    assert.deepEqual(errors, []);
    t.diagnostic(`Native browser ${browser.version()}; raw export and isolated SQLite: ${output}`);
  },
);

test(
  'isolated external JSON UI submits a current-frame decision and completes stop and exit',
  {
    skip: !browserDirectory || !chrome,
    timeout: 60000,
  },
  async (t) => {
    const root = resolve(import.meta.dirname, '..');
    const lock = JSON.parse(await readFile(resolve(root, 'planning/coverage-toolchain.lock.json')));
    verifyInstallation(resolve(browserDirectory), lock.browser.installedFiles);
    await mkdir(resolve(root, '.checks/w1-external'), { recursive: true });
    const output = await mkdtemp(resolve(root, '.checks/w1-external/run-'));
    await importUserUI(
      await readFile(resolve(root, 'apps/web/prototype/AlphaForge_v3_EN.html'), 'utf8'),
      resolve(root, 'apps/web'),
      resolve(root, 'build/ui-import'),
    );
    const dist = resolve(output, 'dist');
    await build({
      configFile: resolve(root, 'apps/web/vite.config.ts'),
      root: resolve(root, 'apps/web'),
      logLevel: 'silent',
      build: { outDir: dist, emptyOutDir: true },
    });
    const origin = 'http://127.0.0.1:19643';
    const { app } = await buildApp({
      origin,
      dbPath: resolve(output, 'ledger.sqlite'),
      env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
      webRoot: dist,
      automataReplay: false,
    });
    t.after(() => app.close());
    await app.listen({ host: '127.0.0.1', port: 19643 });
    const { chromium } = await import(pathToFileURL(resolve(browserDirectory, 'index.mjs')).href);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/testnet.html');
    await page.getByRole('navigation', { name: 'Testnet owner steps' }).waitFor();
    assert.equal(await page.locator('[data-product-login]').count(), 0);
    assert.match(await page.locator('main').textContent(), /普通 EOA|普通钱包/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto(origin + '/automata.html');
    await page.getByLabel('测试账户').selectOption('bob');
    await page.getByRole('button', { name: '建立测试 Vault' }).click();
    await page.getByLabel('存入 / 取出金额（模拟 AF-USDC）').fill('1000');
    await page.getByRole('button', { name: '存入并冻结 Pass' }).click();
    await page.getByLabel('运行资金（模拟 AF-USDC）').fill('100');
    await page.getByLabel('策略来源').selectOption('external');
    await page.getByRole('button', { name: '启动模拟运行' }).click();
    await page.getByRole('button', { name: '推进一帧' }).click();
    await page.getByText('策略接入与信号状态', { exact: true }).click();
    await page.getByLabel('外部策略目标 JSON').fill('{"rwa-a":3000}');
    await page.getByRole('button', { name: '预览 JSON 信号' }).click();
    await page.locator('[data-external-preview]').waitFor();
    assert.match(await page.locator('[data-external-preview]').textContent(), /"frameSeq": 1/);
    await page.getByRole('button', { name: '确认提交 JSON 信号' }).click();
    await page.waitForFunction(() =>
      document.querySelector('.af-run details')?.textContent?.includes('最近信号：'),
    );
    await page.reload();
    await page.getByRole('button', { name: '停止并立即清仓' }).click();
    await page.getByRole('button', { name: '将结算现金转为闲置' }).click();
    await page.getByRole('button', { name: '完整退出并释放全部 Pass' }).click();
    await page.getByText('Vault 已完整退出，Pass 已全部释放；此 Vault 保留历史，不再接收存入。').waitFor();
    await page.getByLabel('测试账户').selectOption('alice');
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="测试账户"]')?.value === 'alice' &&
        !document.querySelector('.af-run'),
    );
    assert.equal(await page.locator('.af-run').count(), 0);
    assert.equal(await page.locator('[data-external-preview]').count(), 0);
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const ema = new StrategyClient({
      baseUrl: origin,
      owner: 'alice',
      runId: 'qinfra-ema-demo',
      targets: {},
      selectTargets: emaTargets,
    });
    await ema.connect();
    await provisionEma(ema);
    for (let step = 0; step < 45; step++) await advanceEma(ema);
    await page.reload();
    await page.getByRole('heading', { name: '开源 EMA 测试策略' }).waitFor();
    let result = await (await ema.request('/api/v1/automata/qinfra-ema-demo')).json();
    assert.equal(result.state.trades.filter((trade) => trade.side === 'buy').length, 2);
    let outcome = '';
    for (let step = 0; step < 125 && outcome !== 'finished'; step++) outcome = await advanceEma(ema);
    assert.equal(outcome, 'finished');
    result = await (await ema.request('/api/v1/automata/qinfra-ema-demo')).json();
    assert.equal(result.state.trades.length, 4);
    assert.equal(result.state.positions['rwa-a'].quantity, '0');
    assert.equal(result.state.positions['rwa-b'].quantity, '0');
    await page.reload();
    await page.getByRole('button', { name: '启用本金冻结规则' }).click();
    await page.getByRole('button', { name: '将结算现金转为闲置' }).click();
    await page.getByRole('button', { name: '完整退出并释放全部 Pass' }).click();
    await page.getByText('Vault 已完整退出，Pass 已全部释放；此 Vault 保留历史，不再接收存入。').waitFor();
    await page.screenshot({ path: resolve(output, 'external-ema-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    t.diagnostic(
      `Current compiled Testnet no-wallet preview, external JSON and EMA UI closure, MOCK only: ${output}`,
    );
  },
);

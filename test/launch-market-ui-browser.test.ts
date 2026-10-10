import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { fixture, OWNER, HASH, NOW, location } from './helpers/launch-market-ui-fixture.ts';
import { marketInterfaces } from '../packages/launch-market/src/abi.ts';
import type { MarketQuote } from '../packages/launch-market/src/types.ts';

const browserPackage =
  process.env.AF_UI_BROWSER_PACKAGE ??
  '/opt/alphaforge/mock-source/.checks/release-browser-tools/package/index.mjs';
const browserBinary =
  process.env.CHROMIUM_PATH ?? '/opt/alphaforge/mock-browser-cache/chromium-1234/chrome-linux64/chrome';
const available = await Promise.all([
  stat(browserPackage).catch(() => null),
  stat(browserBinary).catch(() => null),
]);
const webRoot = resolve('apps/web/dist');

test(
  'desktop and mobile preserve Browser Wallet popup and chain market routing without browser asset ledgers',
  {
    skip: available.some((entry) => !entry) ? 'NOT_RUN: qualified local browser tools unavailable' : false,
    timeout: 30000,
  },
  async () => {
    const { chromium } = await import(pathToFileURL(browserPackage).href);
    const f = fixture();
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost');
      try {
        if (url.pathname === '/auth/me') {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ authKind: 'google', csrfToken: 'trusted-session-csrf-token' }));
          return;
        }
        if (url.pathname === '/api/session') {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ scope: 'TEST_ONLY', user: null }));
          return;
        }
        if (url.pathname === '/api/launch-market/events') {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.flushHeaders();
          return;
        }
        for (const name of ['history', 'candles', 'holders'] as const) {
          if (url.pathname !== `/api/launch-market/${name}`) continue;
          const records = {
            history: [
              {
                name: 'Swap',
                emitter: f.state.config.manifest!.strategies.AMZN.pool,
                strategyId: 'AMZN',
                timestamp: NOW,
                fields: { buy: true, amountIn: '10000000', amountOut: '20000000000000000000', fee: '30000' },
                location: { ...location(), transactionHash: HASH, logIndex: 1 },
              },
            ],
            candles: [
              {
                timestamp: NOW,
                openRaw: '500000',
                highRaw: '520000',
                lowRaw: '490000',
                closeRaw: '510000',
                volumeUsdcRaw: '10000000',
              },
            ],
            holders: [{ owner: OWNER, balanceRaw: '20000000000000000000' }],
          };
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({ [name]: records[name], location: location(), indexer: { state: 'HEALTHY' } }),
          );
          return;
        }
        if (url.pathname.startsWith('/api/launch-market/')) {
          let raw = '';
          for await (const chunk of request) raw += String(chunk);
          let result = await f.api(url.pathname + url.search, raw ? JSON.parse(raw) : undefined);
          if (url.pathname.endsWith('/quote')) {
            const quoted = result as MarketQuote;
            const now = Math.floor(Date.now() / 1000);
            const parsed = marketInterfaces.router.parseTransaction({ data: quoted.transaction.data })!;
            const native = { ...parsed.args[0].toObject(), issuedAt: now, deadline: now + 60 };
            result = {
              ...quoted,
              expiresAt: now + 60,
              reference: { ...quoted.reference, observedAt: now },
              transaction: {
                ...quoted.transaction,
                data: marketInterfaces.router.encodeFunctionData('buyNative', [native, '0x']),
              },
            };
          }
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(result));
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end('{"error":"TEST_FIXTURE_UNAVAILABLE"}');
          return;
        }
        const file = resolve(webRoot, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
        if (!file.startsWith(webRoot + sep)) throw new Error('Invalid asset path');
        const mime: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
        };
        response.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream');
        response.end(await readFile(file));
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const browser = await chromium.launch({
      executablePath: browserBinary,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors: string[] = [];
        page.on('pageerror', (error: Error) => errors.push(error.message));
        await page.addInitScript(
          ({ owner, hash }: { owner: string; hash: string }) => {
            const listeners = new Map<string, Set<(value: unknown) => void>>();
            const calls: string[] = [];
            const provider = {
              request: async ({ method }: { method: string }) => {
                calls.push(method);
                if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner];
                if (method === 'eth_chainId') return '0xb626';
                if (method === 'eth_call') return '0x';
                if (method === 'eth_sendTransaction') return hash;
                throw new Error(`Unexpected fixture method ${method}`);
              },
              on: (event: string, listener: (value: unknown) => void) => {
                const group = listeners.get(event) ?? new Set();
                group.add(listener);
                listeners.set(event, group);
              },
              removeListener: (event: string, listener: (value: unknown) => void) =>
                listeners.get(event)?.delete(listener),
            };
            Object.assign(window, { ethereum: provider, fixtureWalletCalls: calls });
          },
          { owner: OWNER, hash: HASH },
        );
        await page.goto(`http://127.0.0.1:${port}/#/trade/amzn`);
        await page.locator('[data-launch-order]').waitFor();
        assert.equal(await page.locator('#launch-payment').inputValue(), 'ETH');
        assert.equal(await page.locator('#launch-slippage').inputValue(), '100');
        await page.locator('.launch-candles').waitFor();
        assert.match(await page.locator('[data-launch-activity]').innerText(), /Volume 10 AF-USDC/);
        assert.match(await page.locator('[data-launch-activity]').innerText(), /Buy · 20 PASS · 10 AF-USDC/);
        await page.locator('[data-launch-connect]').click();
        await page.locator('#app-dialog').waitFor({ state: 'visible' });
        assert.match(await page.locator('#app-dialog').innerText(), /Browser Wallet/);
        assert.doesNotMatch(await page.locator('#app-dialog').innerText(), /Mock Wallet/);
        await page.locator('[data-launch-wallet-browser]').click();
        await page.waitForFunction(
          () =>
            document.querySelector('[data-launch-order] button[type="submit"]')?.hasAttribute('disabled') ===
            false,
        );
        assert.equal(await page.locator('#launch-payment').inputValue(), 'ETH');
        await page.locator('[data-launch-order] button[type="submit"]').click();
        await page.locator('[data-launch-confirm]').waitFor();
        assert.equal(
          await page.evaluate(
            () =>
              (window as unknown as { fixtureWalletCalls: string[] }).fixtureWalletCalls.filter(
                (method) => method === 'eth_sendTransaction',
              ).length,
          ),
          0,
        );
        await page.locator('[data-launch-confirm]').click();
        await page.locator('.launch-transaction strong').filter({ hasText: 'SUBMITTED' }).waitFor();
        assert.equal(
          await page.evaluate(
            () =>
              (window as unknown as { fixtureWalletCalls: string[] }).fixtureWalletCalls.filter(
                (method) => method === 'eth_sendTransaction',
              ).length,
          ),
          1,
        );
        await page.goto(`http://127.0.0.1:${port}/#/account/trades`);
        await page.locator('[data-launch-account]').waitFor();
        assert.equal(await page.locator('.wallet-pass-row').count(), 2);
        assert.doesNotMatch(await page.locator('main').innerText(), /Demo funds|Mock USDC|Trial Passes/);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        assert.equal(overflow, false, `No page overflow at ${viewport.width}px`);
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

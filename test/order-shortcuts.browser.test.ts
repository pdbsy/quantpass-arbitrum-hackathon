import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import {
  fixture,
  OWNER,
  HASH,
  location as chainLocation,
  quote,
} from './helpers/launch-market-ui-fixture.ts';
import { marketInterfaces } from '../packages/launch-market/src/abi.ts';
import type { MarketQuote, QuoteRequest } from '../packages/launch-market/src/types.ts';

const browserPackage =
  process.env.AF_UI_BROWSER_PACKAGE ??
  '/opt/alphaforge/mock-source/.checks/release-browser-tools/package/index.mjs';
const browserBinary =
  process.env.CHROMIUM_PATH ?? '/opt/alphaforge/mock-browser-cache/chromium-1234/chrome-linux64/chrome';
const available = await Promise.all([
  stat(browserPackage).catch(() => null),
  stat(browserBinary).catch(() => null),
]);
const unit = 10n ** 18n;

function freshQuote(input: QuoteRequest): MarketQuote {
  const base = quote(input);
  const now = Math.floor(Date.now() / 1000),
    deadline = now + 60;
  if (input.operation === 'MINT' && input.asset === 'ETH') {
    const launch = fixture().state.config.manifest!.strategies.TSLA.launch!;
    const usdc = (BigInt(input.amountRaw) * 500_000n) / unit;
    const price = 2_000_000_000n;
    const eth = (usdc * unit + price - 1n) / price;
    const native = {
      router: launch,
      payer: input.owner,
      accountId: HASH,
      operation: 0,
      pass: fixture().state.config.manifest!.strategies.TSLA.pass,
      amountIn: eth,
      usdcAmount: usdc,
      minOut: input.amountRaw,
      ethAmount: eth,
      ethUsdPrice: price,
      nonce: 1,
      issuedAt: now,
      deadline,
      epoch: 1,
    };
    return {
      ...base,
      expiresAt: deadline,
      amountInRaw: input.amountRaw,
      estimatedOutRaw: input.amountRaw,
      minOutRaw: input.amountRaw,
      feeUsdcRaw: '0',
      conversionFeeUsdcRaw: '0',
      reference: { ethUsdPriceRaw: String(price), observedAt: now },
      transaction: {
        to: launch,
        data: marketInterfaces.launch.encodeFunctionData('subscribeEth', [input.amountRaw, native, '0x']),
        value: String(eth),
      },
    };
  }
  if (input.asset === 'ETH') {
    const parsed = marketInterfaces.router.parseTransaction({ data: base.transaction.data })!;
    const native = { ...parsed.args[0].toObject(), issuedAt: now, deadline };
    return {
      ...base,
      expiresAt: deadline,
      reference: { ...base.reference!, observedAt: now },
      transaction: {
        ...base.transaction,
        data: marketInterfaces.router.encodeFunctionData('buyNative', [native, '0x']),
      },
    };
  }
  return {
    ...base,
    expiresAt: deadline,
    minOutRaw: input.operation === 'MINT' ? input.amountRaw : base.minOutRaw,
    transaction:
      input.operation === 'MINT'
        ? {
            ...base.transaction,
            data: marketInterfaces.launch.encodeFunctionData('subscribeUsdc', [input.amountRaw, deadline]),
          }
        : {
            ...base.transaction,
            data: marketInterfaces.pool.encodeFunctionData(input.operation === 'SELL' ? 'sell' : 'buy', [
              input.amountRaw,
              base.minOutRaw,
              input.owner,
              deadline,
            ]),
          },
  };
}

// The actual built SPA is served at its production mount. Fixtures refuse every wallet signature and broadcast.
test(
  'native order shortcuts fill drafts, calculate available Max and discard stale read-only probes',
  {
    skip: available.some((entry) => !entry) ? 'NOT_RUN: qualified local browser tools unavailable' : false,
    timeout: 60_000,
  },
  async (t) => {
    const { chromium } = await import(pathToFileURL(browserPackage).href);
    let f = fixture();
    const streams = new Set<ServerResponse>();
    const reviewed: QuoteRequest[] = [];
    const rejectedWrites: string[] = [];
    const webRoot = resolve('apps/web/dist');
    const reset = () => {
      f = fixture();
      f.state.snapshot = {
        ...f.state.snapshot,
        markets: {
          ...f.state.snapshot.markets,
          TSLA: {
            ...f.state.snapshot.markets.TSLA,
            remainingRaw: String(400n * unit),
            soldRaw: String(499_600n * unit),
          },
        },
      };
      f.state.wallet = {
        ...f.state.wallet,
        ethBalanceRaw: '20000000000000000',
        usdcBalanceRaw: '50123457',
        passes: {
          ...f.state.wallet.passes,
          AMZN: {
            availableRaw: '12345678901234567890',
            lockedRaw: String(7n * unit),
            balanceRaw: String(12_345_678_901_234_567_890n + 7n * unit),
          },
        },
      };
      reviewed.length = 0;
      rejectedWrites.length = 0;
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost');
      try {
        response.setHeader('content-type', 'application/json');
        if (url.pathname === '/auth/me')
          return response.end(
            JSON.stringify({ authKind: 'google', csrfToken: 'trusted-session-csrf-token' }),
          );
        if (url.pathname === '/api/session')
          return response.end(JSON.stringify({ scope: 'TEST_ONLY', user: null }));
        if (url.pathname === '/api/launch-market/wallet/test-session') {
          response.writeHead(401);
          response.end('{"error":"WALLET_TEST_SESSION_REQUIRED"}');
          return;
        }
        if (url.pathname === '/api/launch-market/events') {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.flushHeaders();
          streams.add(response);
          response.on('close', () => streams.delete(response));
          return;
        }
        if (request.method !== 'GET' && url.pathname !== '/api/launch-market/quote') {
          rejectedWrites.push(url.pathname);
          response.writeHead(403);
          response.end('{"error":"READ_ONLY_FIXTURE"}');
          return;
        }
        if (['history', 'candles', 'holders'].some((name) => url.pathname.endsWith(`/${name}`))) {
          const name = url.pathname.split('/').at(-1)!;
          response.end(
            JSON.stringify({ [name]: [], location: chainLocation(), indexer: { state: 'HEALTHY' } }),
          );
          return;
        }
        if (url.pathname === '/api/launch-market/quote') {
          let body = '';
          for await (const chunk of request) body += String(chunk);
          const input = JSON.parse(body) as QuoteRequest;
          reviewed.push(input);
          response.end(JSON.stringify(freshQuote(input)));
          return;
        }
        if (url.pathname.startsWith('/api/launch-market/')) {
          response.end(JSON.stringify(await f.api(url.pathname + url.search)));
          return;
        }
        const assetPath = url.pathname.replace(/^\/alphaforge(?=\/)/, '');
        const file = resolve(webRoot, `.${assetPath === '/' ? '/index.html' : assetPath}`);
        if (!file.startsWith(webRoot + sep)) throw new Error('Invalid asset path');
        response.setHeader(
          'content-type',
          { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[
            extname(file)
          ] ?? 'application/octet-stream',
        );
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
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(5000);
      await page.addInitScript((owner: string) => {
        const control = window as unknown as {
          shortcutWalletCalls: string[];
          shortcutGasMode: string;
          resolveShortcutGas?: (value: string) => void;
        };
        control.shortcutWalletCalls = [];
        control.shortcutGasMode = 'normal';
        Object.assign(window, {
          ethereum: {
            request: async ({ method }: { method: string }) => {
              control.shortcutWalletCalls.push(method);
              if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner];
              if (method === 'eth_chainId') return '0xb626';
              if (method === 'eth_gasPrice') {
                if (control.shortcutGasMode === 'fail')
                  throw new Error('Gas price is unavailable in this read-only fixture.');
                if (control.shortcutGasMode === 'defer')
                  return new Promise<string>((resolve) => {
                    control.resolveShortcutGas = resolve;
                  });
                return '0x3b9aca00';
              }
              throw new Error(`Read-only shortcut fixture refuses ${method}`);
            },
            on: () => {},
            removeListener: () => {},
          },
        });
      }, OWNER);
      const open = async (strategy: string) => {
        reset();
        await page.goto('about:blank');
        await page.goto(`http://127.0.0.1:${port}/alphaforge/#/trade/${strategy}`);
        await page.locator('[data-launch-connect]').click();
        await page.locator('[data-launch-wallet-browser]').click();
        await page.waitForFunction(
          () =>
            (window as unknown as { AF: { launchState: { wallet: unknown; busy: boolean } } }).AF.launchState
              .wallet !== null,
        );
      };
      const route = async (strategy: string) => {
        await page.evaluate((id: string) => {
          location.hash = `#/trade/${id}`;
        }, strategy);
        await page.locator(`[data-launch-order][data-strategy="${strategy.toUpperCase()}"]`).waitFor();
      };
      const input = page.locator('[data-launch-order] input[name="amount"]');
      const max = page.locator('[data-launch-shortcut="max"]');
      const publish = async (block: number) => {
        f.state.snapshot = { ...f.state.snapshot, location: chainLocation(block) };
        for (const stream of streams)
          stream.write(
            `data: ${JSON.stringify({ type: 'SNAPSHOT', location: f.state.snapshot.location, snapshot: f.state.snapshot })}\n\n`,
          );
        await page.waitForFunction(
          (expected: string) =>
            (
              window as unknown as {
                AF: { launchState: { snapshot: { location: { blockNumber: string } } } };
              }
            ).AF.launchState.snapshot.location.blockNumber === expected,
          String(block),
        );
      };
      const noWrites = async () => {
        const calls = await page.evaluate(
          () => (window as unknown as { shortcutWalletCalls: string[] }).shortcutWalletCalls,
        );
        assert.ok(
          calls.every((method: string) =>
            ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'eth_gasPrice'].includes(method),
          ),
          JSON.stringify(calls),
        );
        assert.deepEqual(rejectedWrites, []);
      };

      await t.test(
        'preset units, refresh retention, Mint balance/inventory quantum and unlocked fractional Sell Max',
        async () => {
          await open('tsla');
          for (const value of ['10', '50', '100']) {
            const preset = page.locator(`[data-launch-shortcut="${value}"]`);
            assert.equal(await preset.textContent(), `${value} PASS`);
            await preset.click();
            assert.equal(await input.inputValue(), value);
          }
          await publish(101);
          assert.equal(await input.inputValue(), '100');
          await page.locator('[data-launch-asset]').selectOption('AF_USDC');
          const remaining = 100_123_456_789_012_345_678n;
          f.state.snapshot = {
            ...f.state.snapshot,
            markets: {
              ...f.state.snapshot.markets,
              TSLA: {
                ...f.state.snapshot.markets.TSLA,
                remainingRaw: String(remaining),
                soldRaw: String(500_000n * unit - remaining),
              },
            },
          };
          await publish(102);
          await max.click();
          assert.equal(await input.inputValue(), '100.123456');
          f.state.snapshot = {
            ...f.state.snapshot,
            markets: {
              ...f.state.snapshot.markets,
              TSLA: {
                ...f.state.snapshot.markets.TSLA,
                remainingRaw: String(400n * unit),
                soldRaw: String(499_600n * unit),
              },
            },
          };
          await publish(103);
          await max.click();
          assert.equal(await input.inputValue(), '100.246914');
          await route('amzn');
          assert.equal(await page.locator('[data-launch-shortcut="0.0001"]').textContent(), '0.0001 ETH');
          await page.locator('[data-launch-shortcut="0.0001"]').click();
          assert.equal(await input.inputValue(), '0.0001');
          await page.locator('[data-launch-asset]').selectOption('AF_USDC');
          for (const value of ['10', '50', '100'])
            assert.equal(
              await page.locator(`[data-launch-shortcut="${value}"]`).textContent(),
              `${value} AF-USDC`,
            );
          await page.locator('[data-launch-side="SELL"]').click();
          await max.click();
          assert.equal(await input.inputValue(), '12.34567890123456789');
          assert.equal(reviewed.length, 0);
          assert.equal(await page.locator('[data-launch-confirm]').count(), 0);
          await noWrites();
        },
      );

      await t.test(
        'native Max leaves gas, probes Mint without confirmation and clears an old review on gas failure',
        async () => {
          await open('tsla');
          await max.click();
          await page.waitForFunction(
            () => !(window as unknown as { AF: { launchState: { busy: boolean } } }).AF.launchState.busy,
          );
          assert.equal(await input.inputValue(), '56');
          assert.equal(reviewed.length, 1);
          assert.equal(reviewed[0]!.amountRaw, '2000000000000');
          assert.equal(await page.locator('[data-launch-confirm]').count(), 0);
          await page.locator('[data-launch-order] button[type="submit"]').click();
          await page.locator('[data-launch-confirm]').waitFor();
          assert.equal(reviewed.length, 2);
          assert.equal(reviewed[1]!.amountRaw, String(56n * unit));
          await page.evaluate(() => {
            (window as unknown as { shortcutGasMode: string }).shortcutGasMode = 'fail';
          });
          await max.click();
          await page.waitForFunction(
            () => !(window as unknown as { AF: { launchState: { busy: boolean } } }).AF.launchState.busy,
          );
          assert.equal(await input.inputValue(), '56');
          assert.equal(reviewed.length, 2);
          assert.equal(await page.locator('[data-launch-confirm]').count(), 0);
          assert.match(await page.locator('#pass-order-error').textContent(), /Gas price is unavailable/);
          await route('amzn');
          await page.evaluate(() => {
            (window as unknown as { shortcutGasMode: string }).shortcutGasMode = 'normal';
          });
          await max.click();
          await page.waitForFunction(
            () => !(window as unknown as { AF: { launchState: { busy: boolean } } }).AF.launchState.busy,
          );
          assert.equal(await input.inputValue(), '0.018');
          assert.equal(reviewed.length, 2);
          assert.ok(BigInt('18000000000000000') < BigInt(f.state.wallet.ethBalanceRaw));
          assert.equal(await page.locator('[data-launch-confirm]').count(), 0);
          await noWrites();
        },
      );

      await t.test(
        'pending native Max is discarded after route away/back or a later input event',
        async () => {
          await open('amzn');
          await input.fill('0.004');
          const deferGas = async () => {
            await page.evaluate(() => {
              const control = window as unknown as {
                shortcutGasMode: string;
                resolveShortcutGas?: (value: string) => void;
              };
              control.shortcutGasMode = 'defer';
              delete control.resolveShortcutGas;
            });
            await max.click();
            await page.waitForFunction(
              () =>
                typeof (window as unknown as { resolveShortcutGas?: unknown }).resolveShortcutGas ===
                'function',
            );
          };
          const resolveGas = async () => {
            await page.evaluate(() => {
              (window as unknown as { resolveShortcutGas: (value: string) => void }).resolveShortcutGas(
                '0x3b9aca00',
              );
            });
            await page.waitForFunction(
              () => !(window as unknown as { AF: { launchState: { busy: boolean } } }).AF.launchState.busy,
            );
          };
          await deferGas();
          await page.evaluate(() => {
            location.hash = '#/market';
          });
          await page.locator('.market-grid').waitFor();
          await route('amzn');
          await resolveGas();
          assert.equal(await input.inputValue(), '0.004');
          await input.fill('0.003');
          await deferGas();
          // A late IME/autofill input may be delivered after Max has begun, even while native controls are disabled.
          await input.evaluate((element: HTMLInputElement) => {
            element.value = '0.007';
            element.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await resolveGas();
          assert.equal(await input.inputValue(), '0.007');
          assert.equal(reviewed.length, 0);
          assert.equal(await page.locator('[data-launch-confirm]').count(), 0);
          await noWrites();
        },
      );
      await page.close();
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

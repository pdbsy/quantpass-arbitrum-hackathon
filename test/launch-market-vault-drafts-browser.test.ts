import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { fixture, OWNER, location, quote } from './helpers/launch-market-ui-fixture.ts';
import { marketInterfaces } from '../packages/launch-market/src/abi.ts';
import type { QuoteRequest } from '../packages/launch-market/src/types.ts';

const browserPackage =
  process.env.AF_UI_BROWSER_PACKAGE ??
  '/opt/alphaforge/mock-source/.checks/release-browser-tools/package/index.mjs';
const browserBinary =
  process.env.CHROMIUM_PATH ?? '/opt/alphaforge/mock-browser-cache/chromium-1234/chrome-linux64/chrome';
const available = await Promise.all([
  stat(browserPackage).catch(() => null),
  stat(browserBinary).catch(() => null),
]);

// Isolated browser regression: the wallet and API are fixtures, and no signature or broadcast is allowed.
test(
  'Vault amount, focus and caret survive a streamed refresh and the real form reviews the typed amount',
  {
    skip: available.some((entry) => !entry) ? 'NOT_RUN: qualified local browser tools unavailable' : false,
    timeout: 30000,
  },
  async () => {
    const { chromium } = await import(pathToFileURL(browserPackage).href);
    const f = fixture();
    const vaultAddress = '0x3333333333333333333333333333333333333333';
    f.state.wallet = {
      ...f.state.wallet,
      vaults: [
        {
          strategyId: 'AMZN',
          address: vaultAddress,
          principalBasisRaw: '0',
          equityRaw: '0',
          cashRaw: '0',
          lockedPassRaw: '0',
          realizedPnlRaw: '0',
          unrealizedPnlRaw: '0',
          valuationState: 'FRESH',
          withdrawableProfitRaw: '0',
          withdrawablePrincipalRaw: '0',
          status: 'OPEN',
          holdings: [],
        },
      ],
    };
    const streams = new Set<ServerResponse>();
    const reviewed: QuoteRequest[] = [];
    const webRoot = resolve('apps/web/dist');
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost');
      try {
        response.setHeader('content-type', 'application/json');
        if (url.pathname === '/auth/me') {
          response.end(JSON.stringify({ authKind: 'google', csrfToken: 'trusted-session-csrf-token' }));
          return;
        }
        if (url.pathname === '/api/session') {
          response.end(JSON.stringify({ scope: 'TEST_ONLY', user: null }));
          return;
        }
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
        if (['history', 'candles', 'holders'].some((name) => url.pathname.endsWith(`/${name}`))) {
          const name = url.pathname.split('/').at(-1)!;
          response.end(JSON.stringify({ [name]: [], location: location(), indexer: { state: 'HEALTHY' } }));
          return;
        }
        if (url.pathname.endsWith('/quote')) {
          let raw = '';
          for await (const chunk of request) raw += String(chunk);
          const input = JSON.parse(raw) as QuoteRequest;
          reviewed.push(input);
          response.end(
            JSON.stringify({
              ...quote(input),
              expiresAt: Math.floor(Date.now() / 1000) + 60,
              estimatedOutRaw: input.amountRaw,
              minOutRaw: input.amountRaw,
              transaction: {
                to: vaultAddress,
                data: marketInterfaces.vault.encodeFunctionData('deposit', [input.amountRaw]),
                value: '0',
              },
            }),
          );
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
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
          }[extname(file)] ?? 'application/octet-stream',
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
        Object.assign(window, {
          ethereum: {
            request: async ({ method }: { method: string }) => {
              if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner];
              if (method === 'eth_chainId') return '0xb626';
              throw new Error(`Read-only browser fixture refuses ${method}`);
            },
            on: () => {},
            removeListener: () => {},
          },
        });
      }, OWNER);
      await page.goto(`http://127.0.0.1:${port}/#/account/vaults`);
      await page.locator('[data-launch-connect]').click();
      await page.locator('[data-launch-wallet-browser]').click();
      const input = page.locator('[data-launch-vault-order] input[name="amount"]');
      await input.waitFor();
      await input.fill('0.01');
      await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 4, 'backward'));
      const updated = { ...f.state.snapshot, location: location(101) };
      for (const stream of streams)
        stream.write(
          `data: ${JSON.stringify({ type: 'SNAPSHOT', location: updated.location, snapshot: updated })}\n\n`,
        );
      await page.waitForFunction(
        () =>
          (window as unknown as { AF: { launchState: { snapshot: { location: { blockNumber: string } } } } })
            .AF.launchState.snapshot.location.blockNumber === '101',
      );
      assert.deepEqual(
        await input.evaluate((element: HTMLInputElement) => ({
          value: element.value,
          focused: document.activeElement === element,
          start: element.selectionStart,
          end: element.selectionEnd,
          direction: element.selectionDirection,
        })),
        { value: '0.01', focused: true, start: 2, end: 4, direction: 'backward' },
      );
      await page.locator('[data-launch-vault-order] button[value="DEPOSIT"]').click();
      await page.locator('[data-launch-confirm]').waitFor();
      assert.equal(reviewed.length, 1);
      assert.equal(reviewed[0]!.amountRaw, '10000');
      assert.equal(reviewed[0]!.operation, 'DEPOSIT');
      assert.equal(reviewed[0]!.owner, OWNER);
      assert.equal(await input.inputValue(), '0.01');
      await page.locator('[data-launch-clear]').click();
      assert.equal(await input.inputValue(), '0.01');
      await page.close();
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

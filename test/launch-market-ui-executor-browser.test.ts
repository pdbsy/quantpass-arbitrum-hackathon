import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Interface } from 'ethers';
import { test } from 'node:test';
import {
  executorFixture,
  VAULT,
  FACTORY_CODE,
  permission,
} from './helpers/launch-market-executor-fixture.ts';
import { executorInterface } from '../apps/web/src/launch-market/executor.ts';
import { OWNER, OTHER, HASH, BLOCK } from './helpers/launch-market-ui-fixture.ts';

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
  'Vault DOM requires explicit owner review, exact configure/revoke calldata and current account/network',
  {
    skip: available.some((entry) => !entry) ? 'NOT_RUN: qualified local browser tools unavailable' : false,
    timeout: 45000,
  },
  async () => {
    const { chromium } = await import(pathToFileURL(browserPackage).href);
    const f = executorFixture();
    const webRoot = resolve('apps/web/dist');
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost');
      try {
        if (url.pathname === '/api/launch-market/events') {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.flushHeaders();
          return;
        }
        if (url.pathname === '/api/session') {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ scope: 'TEST_ONLY', user: null }));
          return;
        }
        if (url.pathname.startsWith('/api/launch-market/')) {
          let raw = '';
          for await (const chunk of request) raw += String(chunk);
          const result = await f.api(url.pathname + url.search, raw ? JSON.parse(raw) : undefined);
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(result));
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          response.writeHead(404);
          response.end();
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
      for (const scenario of ['CONFIGURE', 'WRONG_ACCOUNT', 'WRONG_CHAIN', 'REVOKE'] as const) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors: string[] = [];
        page.on('pageerror', (error: Error) => errors.push(error.message));
        const cfg = f.state.config.manifest!;
        const factory = new Interface(['function vaults(address,uint8) view returns(address)']);
        const grant = permission();
        const values: Record<string, unknown[]> = {
          owner: [OWNER],
          pass: [cfg.strategies.AMZN.pass],
          afUsdc: [cfg.usdc],
          closed: [false],
          executionVersion: [0],
          totalBuyUsdc: [0],
          grant: [OTHER, grant.expiresAt, grant.maxOrderUsdc, grant.maxTotalBuyUsdc, grant.maxSlippageBps],
        };
        const responses = Object.fromEntries(
          Object.entries(values).map(([name, args]) => [
            executorInterface.encodeFunctionData(name),
            executorInterface.encodeFunctionResult(name, args),
          ]),
        );
        responses[factory.encodeFunctionData('vaults', [OWNER, 1])] = factory.encodeFunctionResult('vaults', [
          VAULT,
        ]);
        await page.addInitScript(
          ({
            owner,
            hash,
            blockHash,
            code,
            responses,
          }: {
            owner: string;
            hash: string;
            blockHash: string;
            code: string;
            responses: Record<string, string>;
          }) => {
            const state = {
              owner,
              chain: '0xb626',
              sent: [] as { from: string; to: string; data: string; value: string }[],
            };
            const listeners = new Map<string, Set<(value: unknown) => void>>();
            const provider = {
              request: async ({ method, params }: { method: string; params?: unknown[] }) => {
                if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [state.owner];
                if (method === 'eth_chainId') return state.chain;
                if (method === 'eth_getBlockByNumber')
                  return {
                    number: '0x64',
                    hash: blockHash,
                    timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
                  };
                if (method === 'eth_getCode') return code;
                if (method === 'eth_estimateGas') return '0x186a0';
                if (method === 'eth_getTransactionReceipt') return null;
                if (method === 'eth_call') return responses[(params![0] as { data: string }).data] ?? '0x';
                if (method === 'eth_sendTransaction') {
                  state.sent.push(params![0] as (typeof state.sent)[number]);
                  return hash;
                }
                throw new Error(`Unexpected wallet method ${method}`);
              },
              on: (event: string, listener: (value: unknown) => void) => {
                const set = listeners.get(event) ?? new Set();
                set.add(listener);
                listeners.set(event, set);
              },
              removeListener: (event: string, listener: (value: unknown) => void) =>
                listeners.get(event)?.delete(listener),
            };
            Object.assign(window, { ethereum: provider, executorWalletFixture: state });
          },
          { owner: OWNER, hash: HASH, blockHash: BLOCK, code: FACTORY_CODE, responses },
        );
        await page.goto(`http://127.0.0.1:${port}/#/account/vaults`);
        await page.locator('[data-launch-connect]').click();
        await page.locator('[data-launch-wallet-browser]').click();
        await page.locator('[data-launch-executor-order]').waitFor({ state: 'attached' });
        assert.match(await page.locator('main').innerText(), /not real shares/);
        if (scenario === 'REVOKE') await page.locator('[data-launch-executor-revoke="AMZN"]').click();
        else {
          await page.locator('.launch-executor summary').click();
          await page.locator('#executor-AMZN').fill(OTHER);
          await page.locator('#executor-expiry-AMZN').fill(
            await page.evaluate(() => {
              const date = new Date(Date.now() + 3600000);
              const pad = (n: number) => String(n).padStart(2, '0');
              return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
            }),
          );
          await page.locator('#executor-order-AMZN').fill('10');
          await page.locator('#executor-total-AMZN').fill('50');
          await page.locator('#executor-slippage-AMZN').fill('100');
          await page.locator('[data-launch-executor-order] button[type="submit"]').click();
        }
        await page
          .locator('[data-launch-executor-confirm]')
          .waitFor()
          .catch(async (error: unknown) => {
            throw new Error(await page.locator('main').innerText(), { cause: error });
          });
        assert.match(
          await page.locator('[aria-label="Reviewed executor permission"]').innerText(),
          new RegExp(OTHER),
        );
        assert.equal(
          await page.evaluate(
            () =>
              (window as unknown as { executorWalletFixture: { sent: unknown[] } }).executorWalletFixture.sent
                .length,
          ),
          0,
        );
        if (scenario === 'WRONG_ACCOUNT')
          await page.evaluate((other: string) => {
            (window as unknown as { executorWalletFixture: { owner: string } }).executorWalletFixture.owner =
              other;
          }, OTHER);
        if (scenario === 'WRONG_CHAIN')
          await page.evaluate(() => {
            (window as unknown as { executorWalletFixture: { chain: string } }).executorWalletFixture.chain =
              '0x1';
          });
        await page.locator('[data-launch-executor-confirm]').click();
        if (scenario === 'WRONG_ACCOUNT' || scenario === 'WRONG_CHAIN') {
          await page
            .locator('.launch-feedback')
            .filter({ hasText: scenario === 'WRONG_ACCOUNT' ? 'Your wallet changed' : 'Switch your wallet' })
            .waitFor();
          assert.equal(
            await page.evaluate(
              () =>
                (window as unknown as { executorWalletFixture: { sent: unknown[] } }).executorWalletFixture
                  .sent.length,
            ),
            0,
          );
        } else {
          await page.locator('.launch-transaction strong').filter({ hasText: 'SUBMITTED' }).waitFor();
          const sent = await page.evaluate(
            () =>
              (
                window as unknown as {
                  executorWalletFixture: {
                    sent: { from: string; to: string; data: string; value: string }[];
                  };
                }
              ).executorWalletFixture.sent,
          );
          assert.equal(sent.length, 1);
          assert.equal(sent[0]!.from, OWNER);
          assert.equal(sent[0]!.to, VAULT);
          assert.equal(sent[0]!.value, '0x0');
          const parsed = executorInterface.parseTransaction(sent[0]!)!;
          assert.equal(parsed.name, scenario === 'REVOKE' ? 'revokeExecutor' : 'configureExecutor');
          if (scenario === 'CONFIGURE')
            assert.deepEqual(parsed.args[0].toArray().slice(2).map(String), ['10000000', '50000000', '100']);
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
          false,
        );
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

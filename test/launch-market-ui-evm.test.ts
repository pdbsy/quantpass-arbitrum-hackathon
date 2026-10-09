import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatUnits, parseEther } from 'ethers';
import { deployLocalMarket } from '../tools/launch-market/local-fixture.ts';
import { RpcMarketChain } from '../apps/server/src/launch-market-adapters/rpc-chain.ts';
import { MarketEventIndexer } from '../apps/server/src/launch-market/indexer.ts';
import { buildLaunchMarketServer } from '../apps/server/src/launch-market/server.ts';
import { LaunchMarketService } from '../packages/launch-market/src/service.ts';
import { LaunchMarketStore } from '../packages/launch-market/src/store.ts';
import { marketInterfaces } from '../packages/launch-market/src/abi.ts';
import type { MarketQuote } from '../packages/launch-market/src/types.ts';
import {
  installEvmBrowserWallet,
  localPort,
  offlineActor,
  offlineSession,
  registerOfflineWallet,
  startBrowserAnvil,
} from './helpers/launch-market-ui-evm.ts';

const browserPackage =
  process.env.AF_UI_BROWSER_PACKAGE ??
  '/opt/alphaforge/mock-source/.checks/release-browser-tools/package/index.mjs';
const browserBinary =
  process.env.CHROMIUM_PATH ?? '/opt/alphaforge/mock-browser-cache/chromium-1234/chrome-linux64/chrome';

test(
  'actual browser wallet signatures settle ETH Mint and AMZN ETH buy/sell with canonical receipts and Bob SSE',
  { timeout: 240000 },
  async (context) => {
    assert.ok(await stat(browserPackage), 'Qualified local Playwright package is available');
    assert.ok(await stat(browserBinary), 'Qualified local Chromium is available');
    assert.ok(
      await stat('apps/web/dist/index.html'),
      'Build the current maintained UI before this focused integration test',
    );
    const anvil = await startBrowserAnvil();
    const directory = await mkdtemp(join(tmpdir(), 'af-browser-evm-'));
    let cleanup = async () => {};
    try {
      const f = await deployLocalMarket(anvil.rpc);
      cleanup = async () => {
        f.provider.destroy();
      };
      await f.provider.send('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000) - 1]);
      await f.provider.send('anvil_mine', ['0x1']);
      let clock = Number((await f.provider.getBlock('latest'))!.timestamp);
      const port = await localPort(),
        origin = `http://127.0.0.1:${port}`;
      const store = new LaunchMarketStore(join(directory, 'market.sqlite'), origin);
      const chain = new RpcMarketChain(f.manifest, anvil.rpc);
      const service = new LaunchMarketService({
        manifest: f.manifest,
        store,
        chain,
        quoteSigner: f.operator,
        claimSigner: f.operator,
        now: () => clock,
        ethReference: { read: async () => ({ ethUsdPriceRaw: '2000000000', observedAt: clock }) },
      });
      const indexer = new MarketEventIndexer({
        path: join(directory, 'events.sqlite'),
        manifest: f.manifest,
        provider: chain.provider,
        service,
        pollIntervalMs: 5000,
      });
      const actors = [offlineActor('alice', f.alice, f.a), offlineActor('bob', f.bob, f.b)];
      const server = await buildLaunchMarketServer({
        service,
        indexer,
        origin,
        webRoot: resolve('apps/web/dist'),
        initialize: () => chain.initialize(),
        trustedIdentity: async (request) => {
          // Explicit offline verified Google session fixture only. Production still uses the existing trusted bridge.
          const actor = offlineSession(request, actors);
          if (!actor) return null;
          clock = Number((await f.provider.getBlock('latest'))!.timestamp);
          return {
            email: actor.name + '@example.test',
            subject: 'offline-browser-google-fixture-' + actor.session,
            emailVerified: true,
          };
        },
        dispose: async () => {
          chain.provider.destroy();
          store.close();
        },
      });
      registerOfflineWallet(
        server.app,
        actors,
        f.provider,
        [
          String(f.launch.target),
          String(f.router.target),
          String(f.usdc.target),
          String(f.tsla.target),
          String(f.amzn.target),
        ],
        origin,
      );
      cleanup = async () => {
        await server.stop();
        f.provider.destroy();
      };
      await server.start('127.0.0.1', port);
      const denied = await server.app.inject({
        method: 'POST',
        url: '/api/launch-market/wallet/challenge',
        headers: {
          host: new URL(origin).host,
          origin,
          cookie: 'offline_verified_session=' + actors[0]!.session,
        },
        payload: { owner: f.alice.address },
      });
      assert.equal(
        denied.statusCode,
        401,
        'The offline verified session fixture also requires mutation CSRF',
      );
      const unbound = await server.app.inject({
        method: 'GET',
        url: '/api/launch-market/wallet?owner=' + f.alice.address,
        headers: { host: new URL(origin).host, cookie: 'offline_verified_session=' + actors[0]!.session },
      });
      assert.equal(unbound.statusCode, 200);
      assert.equal(
        unbound.json().accountId,
        null,
        'A verified email session does not imply a signed wallet binding',
      );
      const { chromium } = await import(pathToFileURL(browserPackage).href);
      const browser = await chromium.launch({
        executablePath: browserBinary,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      try {
        const contexts = await Promise.all(
          actors.map(async (actor) => {
            const browserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            await browserContext.addCookies([
              {
                name: 'offline_verified_session',
                value: actor.session,
                url: origin,
                httpOnly: true,
                sameSite: 'Lax',
              },
            ]);
            const page = await browserContext.newPage();
            page.setDefaultTimeout(20000);
            await installEvmBrowserWallet(page);
            return { page, browserContext };
          }),
        );
        const alice = contexts[0]!.page,
          bob = contexts[1]!.page;
        const errors: string[] = [];
        alice.on('pageerror', (error: Error) => errors.push(error.message));
        bob.on('pageerror', (error: Error) => errors.push(error.message));
        const connect = async (page: typeof alice, strategy: string) => {
          await page.goto(`${origin}/#/trade/${strategy}`);
          await page.locator('[data-launch-order]').waitFor();
          assert.equal(await page.locator('#launch-payment').inputValue(), 'ETH');
          assert.equal(await page.locator('#launch-slippage').inputValue(), '100');
          await page.locator('[data-launch-connect]').click();
          await page.locator('[data-launch-wallet-browser]').click();
          await page.locator('[data-launch-bind]').waitFor();
          await page
            .locator('[data-launch-bind]')
            .click()
            .catch(async (error: unknown) => {
              throw new Error(
                `Binding DOM: ${await page.locator('main').innerText()} SSE count: ${await page.evaluate(() => (window as unknown as { localEvmSseEvidence: unknown[] }).localEvmSseEvidence.length)}`,
                { cause: error },
              );
            });
          await page.locator('[data-launch-bind-confirm]').click();
          await page.locator('[data-launch-bind]').waitFor({ state: 'hidden' });
        };
        await connect(alice, 'tsla');
        await connect(bob, 'amzn');
        assert.equal(actors[0]!.messages.length, 1);
        assert.equal(actors[1]!.messages.length, 1);
        assert.ok(actors[0]!.messages[0]!.includes(f.alice.address.toLowerCase()));
        assert.equal(
          (
            await service.wallet(
              f.alice.address,
              service.account({
                email: 'alice@example.test',
                subject: 'offline-browser-google-fixture-' + actors[0]!.session,
                emailVerified: true,
              }).id,
            )
          ).accountId !== null,
          true,
        );

        const review = async (operation: 'MINT' | 'BUY' | 'SELL', amount: string): Promise<MarketQuote> => {
          // Automined Anvil has no idle blocks. Publish an actual current-time block before each reference quote.
          const latest = (await f.provider.getBlock('latest'))!;
          await f.provider.send('evm_setNextBlockTimestamp', [
            Math.max(latest.timestamp + 1, Math.floor(Date.now() / 1000)),
          ]);
          await f.provider.send('anvil_mine', ['0x1']);
          await indexer.poll();
          await alice.locator('#launch-amount').fill(amount);
          const response = alice.waitForResponse(
            (response: { url: () => string; request: () => { method: () => string } }) =>
              response.url().endsWith('/api/launch-market/quote') && response.request().method() === 'POST',
          );
          await alice.locator('[data-launch-order] button[type="submit"]').click();
          const observed = await response;
          assert.equal(observed.status(), 200, await observed.text());
          const quote = (await observed.json()) as MarketQuote;
          assert.equal(JSON.parse(observed.request().postData()!).slippageBps, 100);
          assert.equal(quote.operation, operation);
          assert.equal(quote.asset, 'ETH');
          assert.equal(quote.owner.toLowerCase(), f.alice.address.toLowerCase());
          if (operation === 'BUY')
            assert.equal(BigInt(quote.minOutRaw), (BigInt(quote.estimatedOutRaw) * 9900n) / 10000n);
          if (operation === 'SELL') {
            // The pool floors the 1% minimum at AF-USDC precision before native conversion.
            const poolOutput = await chain.quoteAmm(
              'AMZN',
              'SELL',
              quote.amountInRaw,
              quote.location.blockHash,
            );
            const minimumUsdc = (BigInt(poolOutput.outputRaw) * 9900n) / 10000n;
            const calldata = marketInterfaces.router.parseTransaction(quote.transaction)!;
            assert.equal(calldata.args[0].usdcAmount, minimumUsdc);
            const feeBps = BigInt((await service.snapshot()).conversion.feeBps);
            const fee = (minimumUsdc * feeBps + 9999n) / 10000n;
            assert.equal(
              BigInt(quote.minOutRaw),
              ((minimumUsdc - fee) * 10n ** 18n) / BigInt(quote.reference!.ethUsdPriceRaw),
            );
          }
          await alice
            .locator('[data-launch-confirm]')
            .waitFor()
            .catch(async (error: unknown) => {
              throw new Error(`Quote review DOM (${operation}): ${await alice.locator('main').innerText()}`, {
                cause: error,
              });
            });
          return quote;
        };
        const send = async (): Promise<string> => {
          const count = actors[0]!.sent.length;
          await alice.locator('[data-launch-confirm]').click();
          await alice.locator('.launch-transaction strong').filter({ hasText: 'INCLUDED' }).waitFor();
          assert.equal(actors[0]!.sent.length, count + 1, 'The browser sends one actual signed transaction');
          assert.match(await alice.locator('.launch-transaction p').first().innerText(), /1 \/ 3 L2 blocks/);
          return actors[0]!.sent.at(-1)!.hash;
        };
        const complete = async (hash: string, intermediate = false): Promise<void> => {
          if (intermediate) {
            await f.provider.send('anvil_mine', ['0x1']);
            await indexer.poll();
            await alice
              .locator('.launch-transaction p')
              .first()
              .filter({ hasText: '2 / 3 L2 blocks' })
              .waitFor();
            assert.equal(await alice.locator('.launch-transaction strong').innerText(), 'INCLUDED');
            await f.provider.send('anvil_mine', ['0x1']);
          } else await f.provider.send('anvil_mine', ['0x2']);
          await indexer.poll();
          await alice.locator('.launch-transaction strong').filter({ hasText: 'COMPLETED' }).waitFor();
          assert.match(await alice.locator('.launch-transaction p').first().innerText(), /3 \/ 3 L2 blocks/);
          const receipt = await f.provider.getTransactionReceipt(hash);
          assert.ok(receipt && receipt.status === 1);
          const height = Number(BigInt(await f.provider.send('eth_blockNumber', [])));
          assert.equal(
            height - receipt.blockNumber + 1,
            3,
            'Inclusion plus two blocks satisfies the actual application policy',
          );
          assert.equal((await f.provider.getBlock(receipt.blockNumber))!.hash, receipt.blockHash);
        };
        const collector = String(await f.launch.getFunction('PROCEEDS_RECIPIENT')());
        const proceedsBefore = BigInt(await f.provider.send('eth_getBalance', [collector, 'latest']));
        const mint = await review('MINT', '10');
        assert.equal(mint.allowance, null);
        assert.equal(mint.simulation, 'READY');
        assert.equal(BigInt(mint.transaction.value), parseEther('0.0025'));
        const mintHash = await send();
        await complete(mintHash, true);
        assert.equal(await f.tsla.getFunction('balanceOf')(f.alice.address), 10n * 10n ** 18n);
        assert.equal(
          BigInt(await f.provider.send('eth_getBalance', [collector, 'latest'])) - proceedsBefore,
          BigInt(mint.transaction.value),
        );
        assert.equal((await service.snapshot()).markets.TSLA.state, 'MINTING');

        await alice.evaluate(() => {
          location.hash = '#/trade/amzn';
        });
        await alice.locator('[data-launch-order]').waitFor();
        const beforePool = (await service.snapshot()).markets.AMZN.reserveUsdcRaw;
        const gate = Promise.withResolvers<void>();
        // Hold Bob's polling snapshot fetches while actual EventSource messages update his UI.
        await bob.route('**/api/launch-market/snapshot', async (route: { continue: () => Promise<void> }) => {
          await gate.promise;
          await route.continue().catch(() => {});
        });
        try {
          const buy = await review('BUY', '0.01');
          assert.equal(buy.allowance, null);
          const buyHash = await send();
          await complete(buyHash);
          const afterPool = (await service.snapshot()).markets.AMZN.reserveUsdcRaw;
          assert.ok(BigInt(afterPool) > BigInt(beforePool));
          await bob.waitForFunction(
            (expected: string) =>
              (
                window as unknown as { localEvmSseEvidence: { usdcReserveRaw: string }[] }
              ).localEvmSseEvidence.some((event) => event.usdcReserveRaw === expected),
            afterPool,
          );
          const formatted =
            new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(
              Number(formatUnits(afterPool, 6)),
            ) + ' AF-USDC';
          await bob
            .locator('.launch-stats > div')
            .filter({ has: bob.locator('dt', { hasText: 'Pool AF-USDC reserve' }) })
            .locator('dd')
            .filter({ hasText: formatted })
            .waitFor();
          assert.equal(await f.amzn.getFunction('balanceOf')(f.alice.address), BigInt(buy.estimatedOutRaw));
          context.diagnostic(
            'Actual Mint and BUY canonical receipts completed; Bob observed the new AMZN reserves through SSE with polling snapshots held.',
          );
        } finally {
          gate.resolve();
          await bob.unroute('**/api/launch-market/snapshot');
        }

        await alice.locator('[data-launch-side="SELL"]').dispatchEvent('click');
        await alice.locator('[data-launch-order][data-operation="SELL"]').waitFor();
        assert.equal(await alice.locator('#launch-payment').inputValue(), 'ETH');
        const initialSell = await review('SELL', '1');
        assert.equal(initialSell.simulation, 'APPROVAL_REQUIRED');
        assert.equal(initialSell.allowance!.token.toLowerCase(), String(f.amzn.target).toLowerCase());
        assert.equal(initialSell.allowance!.spender.toLowerCase(), String(f.router.target).toLowerCase());
        assert.equal(initialSell.allowance!.amountRaw, String(10n ** 18n));
        assert.equal(initialSell.gasEstimateRaw, null);
        const approvalHash = await send();
        await complete(approvalHash);
        const sentBefore = actors[0]!.sent.length;
        const sell = await review('SELL', '1');
        assert.equal(sell.simulation, 'READY');
        assert.equal(sell.allowance, null);
        assert.equal(
          actors[0]!.sent.length,
          sentBefore,
          'Approval does not automatically send the asset sale',
        );
        const passBefore = await f.amzn.getFunction('balanceOf')(f.alice.address);
        const nativeBefore = BigInt(
          await f.provider.send('eth_getBalance', [String(f.reserve.target), 'latest']),
        );
        const sellHash = await send();
        await complete(sellHash);
        assert.equal(await f.amzn.getFunction('balanceOf')(f.alice.address), passBefore - 10n ** 18n);
        assert.equal(
          nativeBefore -
            BigInt(await f.provider.send('eth_getBalance', [String(f.reserve.target), 'latest'])),
          BigInt(sell.estimatedOutRaw),
        );
        assert.equal(actors[0]!.sent.length, 4);
        assert.equal(actors[1]!.sent.length, 0);
        assert.equal(indexer.status().state, 'HEALTHY');
        assert.ok(
          indexer
            .history('TSLA')
            .some((event) => event.name === 'Subscription' && event.location.transactionHash === mintHash),
        );
        assert.ok(
          indexer
            .history('AMZN')
            .some(
              (event) =>
                event.name === 'Swap' &&
                event.fields.buy === false &&
                event.location.transactionHash === sellHash,
            ),
        );
        assert.ok(indexer.candles('AMZN').length > 0);
        await alice.locator('.launch-candles').waitFor();
        // Isolate native-pointer tab usability after the real activity UI is hydrated.
        // Earlier tab event dispatch covered transport without relying on pointer timing during active trades.
        await alice.locator('[data-launch-side="BUY"]').click();
        await alice.locator('[data-launch-order][data-operation="BUY"]').waitFor();
        await alice.locator('[data-launch-side="SELL"]').click();
        await alice.locator('[data-launch-order][data-operation="SELL"]').waitFor();
        assert.deepEqual(errors, []);
        context.diagnostic(
          'PASS exact approval and native SELL completed at three inclusive canonical blocks; four actual Alice transactions, two real binding signatures, zero Bob transactions. Hydrated BUY/SELL tabs also passed native pointer clicks.',
        );
        await Promise.all(contexts.map(({ browserContext }) => browserContext.close()));
      } finally {
        await browser.close();
      }
    } finally {
      await cleanup();
      await anvil.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

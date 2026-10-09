import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Contract, Interface, Wallet, NonceManager, parseEther, toBeHex } from 'ethers';
import { deployLocalMarket, artifact } from '../tools/launch-market/local-fixture.ts';
import { LaunchMarketStore } from '../packages/launch-market/src/store.ts';
import { LaunchMarketService } from '../packages/launch-market/src/service.ts';
import { RpcMarketChain } from '../apps/server/src/launch-market-adapters/rpc-chain.ts';
import { buildVaultQuote } from '../apps/server/src/launch-market-adapters/vault-quotes.ts';
import { MarketEventIndexer } from '../apps/server/src/launch-market/indexer.ts';
import { registerLaunchMarketRoutes } from '../apps/server/src/launch-market/routes.ts';
import type {
  MarketQuote,
  MarketTrackedOperation,
  MarketWalletSnapshot,
} from '../packages/launch-market/src/types.ts';

test(
  'Alice and Bob use actual EVM claims, native mint/trading, owner Vaults and atomic Fair Launch',
  { timeout: 180_000 },
  async () => {
    const rpc = process.env.AF_LOCAL_EVM_RPC;
    assert.ok(
      rpc,
      'Run npm run test:fair-launch:evm with the pinned local Anvil; no external chain is accepted',
    );
    const f = await deployLocalMarket(rpc),
      dir = await mkdtemp(join(tmpdir(), 'af-fair-launch-'));
    const chain = new RpcMarketChain(f.manifest, rpc);
    await chain.initialize();
    let store = new LaunchMarketStore(join(dir, 'market.sqlite'), 'http://127.0.0.1:8547');
    let clock = Number((await f.provider.getBlock('latest'))!.timestamp);
    const options = () => ({
      manifest: f.manifest,
      store,
      chain,
      quoteSigner: f.operator,
      claimSigner: f.operator,
      now: () => clock,
      ethReference: { read: async () => ({ ethUsdPriceRaw: '2000000000', observedAt: clock }) },
      vaultQuote: (
        request: Parameters<typeof buildVaultQuote>[1],
        account: Parameters<typeof buildVaultQuote>[2],
        snapshot: Parameters<typeof buildVaultQuote>[3],
        expires: number,
      ) => buildVaultQuote(chain, request, account, snapshot, expires),
    });
    let service = new LaunchMarketService(options());
    let indexer = new MarketEventIndexer({
      path: join(dir, 'events.sqlite'),
      manifest: f.manifest,
      provider: chain.provider,
      service,
    });
    let app = Fastify();
    await app.register(cookie);
    // Explicit offline authentication fixture. The production bridge independently checks Google sessions and CSRF.
    const register = () =>
      registerLaunchMarketRoutes(app, {
        service,
        trustedIdentity: (request) => {
          const user = request.cookies['test_user'];
          return ['alice', 'bob'].includes(user ?? '')
            ? {
                email: user + '@example.test',
                subject: 'offline-google-fixture-' + user,
                emailVerified: true,
              }
            : null;
        },
      });
    register();
    const headers = (user: string) => ({ cookie: 'test_user=' + user });
    async function api(user: string, method: 'GET' | 'POST', url: string, payload?: object) {
      const response = await app.inject({
        method,
        url,
        headers: headers(user),
        ...(payload ? { payload } : {}),
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    }
    async function bind(user: string, actor: typeof f.alice) {
      const challenge = await api(user, 'POST', '/api/launch-market/wallet/challenge', {
        owner: actor.address,
      });
      return api(user, 'POST', '/api/launch-market/wallet/bind', {
        nonce: challenge.nonce,
        signature: await actor.signMessage(challenge.message),
      });
    }
    async function quote(
      user: string,
      operation: string,
      asset: string,
      amountRaw: string,
      strategyId = 'TSLA',
    ): Promise<MarketQuote> {
      clock = Number((await f.provider.getBlock('latest'))!.timestamp);
      return api(user, 'POST', '/api/launch-market/quote', {
        owner: user === 'alice' ? f.alice.address : f.bob.address,
        strategyId,
        operation,
        asset,
        amountRaw,
        slippageBps: 100,
      });
    }
    async function act(user: string, operation: string, asset: string, amount: string, strategy = 'TSLA') {
      const actor = user === 'alice' ? f.a : f.b;
      let q = await quote(user, operation, asset, amount, strategy);
      const approval = new Interface(['function approve(address,uint256)']);
      for (let count = 0; q.simulation === 'APPROVAL_REQUIRED'; count++) {
        assert.ok(count < 2, 'Only the actual USDC and PASS approval deficits may be requested');
        assert.ok(q.allowance);
        await (
          await actor.sendTransaction({
            to: q.allowance.token,
            data: approval.encodeFunctionData('approve', [q.allowance.spender, q.allowance.amountRaw]),
          })
        ).wait();
        await f.provider.send('anvil_mine', ['0x2']);
        q = await quote(user, operation, asset, amount, strategy);
      }
      assert.ok(q.gasEstimateRaw && BigInt(q.gasEstimateRaw) > 0n);
      const tx = await actor.sendTransaction({
        ...q.transaction,
        value: BigInt(q.transaction.value),
        gasLimit: (BigInt(q.gasEstimateRaw) * 12n) / 10n,
      });
      await tx.wait();
      const pending: MarketTrackedOperation = await api(user, 'POST', '/api/launch-market/submissions', {
        quoteId: q.id,
        transactionHash: tx.hash,
        owner: q.owner,
      });
      await f.provider.send('anvil_mine', ['0x2']);
      const completed: MarketTrackedOperation = await api(
        user,
        'GET',
        '/api/launch-market/operations/' + pending.id,
      );
      assert.equal(completed.state, 'COMPLETED');
      assert.equal(completed.confirmations >= 3, true);
      await indexer.poll();
      return { q, tx, completed };
    }
    try {
      await indexer.poll();
      await bind('alice', f.alice);
      await bind('bob', f.bob);
      const aliceIdentity = (await api('alice', 'GET', '/api/launch-market/account')).id;
      await act('alice', 'CLAIM', 'AF_USDC', '0');
      await act('bob', 'CLAIM', 'AF_USDC', '0');
      assert.equal(await f.usdc.getFunction('balanceOf')(f.alice.address), 1000_000000n);
      const receiver = await f.launch.getFunction('PROCEEDS_RECIPIENT')();
      const beforeNative = BigInt(await f.provider.send('eth_getBalance', [receiver, 'latest']));
      const nativeMint = await act('alice', 'MINT', 'ETH', (100n * 10n ** 18n).toString());
      assert.equal(
        BigInt(await f.provider.send('eth_getBalance', [receiver, 'latest'])) - beforeNative,
        BigInt(nativeMint.q.transaction.value),
      );
      await act('bob', 'MINT', 'AF_USDC', (200n * 10n ** 18n).toString());
      const amznBefore = (await service.snapshot()).markets.AMZN.reserveUsdcRaw;
      await act('alice', 'BUY', 'ETH', parseEther('0.05').toString(), 'AMZN');
      assert.ok(BigInt((await service.snapshot()).markets.AMZN.reserveUsdcRaw) > BigInt(amznBefore));
      const bobObserved = await api('bob', 'GET', '/api/launch-market/snapshot');
      assert.equal(
        bobObserved.markets.AMZN.reserveUsdcRaw,
        (await service.snapshot()).markets.AMZN.reserveUsdcRaw,
      );
      await act('bob', 'BUY', 'AF_USDC', '10000000', 'AMZN');
      await act('bob', 'SELL', 'AF_USDC', (5n * 10n ** 18n).toString(), 'AMZN');
      await act('alice', 'CREATE_VAULT', 'AF_USDC', '0');
      await act('alice', 'DEPOSIT', 'AF_USDC', '50000000');
      const wallet: MarketWalletSnapshot = await api(
        'alice',
        'GET',
        '/api/launch-market/wallet?owner=' + f.alice.address,
      );
      assert.equal(wallet.passes.TSLA.lockedRaw, (50n * 10n ** 18n).toString());
      assert.equal(wallet.passes.TSLA.balanceRaw, (100n * 10n ** 18n).toString());
      const vault = new Contract(
        wallet.vaults[0]!.address,
        (await artifact('AlphaForgeStrategyVault', 'AlphaForgeStrategyVault')).abi,
        f.a,
      );
      const crossOwner = await app.inject({
        method: 'POST',
        url: '/api/launch-market/quote',
        headers: headers('bob'),
        payload: {
          owner: f.alice.address,
          strategyId: 'TSLA',
          operation: 'WITHDRAW',
          asset: 'AF_USDC',
          amountRaw: '1000000',
          slippageBps: 100,
        },
      });
      assert.equal(crossOwner.statusCode, 403);
      clock = Number((await f.provider.getBlock('latest'))!.timestamp);
      await f.execute(vault, 'execute', true, 40_000000n, 4n * 10n ** 17n, clock + 60, 0);
      await f.provider.send('evm_increaseTime', [301]);
      await f.provider.send('anvil_mine', ['0x1']);
      clock = Number((await f.provider.getBlock('latest'))!.timestamp);
      const staleWallet = await chain.wallet(f.alice.address);
      assert.equal(staleWallet.vaults[0]!.valuationState, 'UNAVAILABLE');
      assert.equal(staleWallet.vaults[0]!.equityRaw, null);
      assert.equal(staleWallet.passes.TSLA.lockedRaw, (50n * 10n ** 18n).toString());
      await f.execute(f.feeds[0]!, 'update', 120_000000n, clock, '0x' + 'ab'.repeat(32));
      await f.execute(f.feeds[0]!, 'updateSession', clock, clock + 3600, clock, '0x' + 'cd'.repeat(32));
      await f.execute(vault, 'execute', false, 4n * 10n ** 17n, 48_000000n, clock + 60, 1);
      await act('alice', 'WITHDRAW', 'AF_USDC', '8000000');
      assert.equal(
        (await chain.wallet(f.alice.address)).passes.TSLA.lockedRaw,
        (50n * 10n ** 18n).toString(),
      );
      await act('alice', 'WITHDRAW', 'AF_USDC', '10000000');
      assert.equal(
        (await chain.wallet(f.alice.address)).passes.TSLA.lockedRaw,
        (40n * 10n ** 18n).toString(),
      );
      await act('alice', 'CLOSE', 'AF_USDC', '0');
      assert.equal((await chain.wallet(f.alice.address)).passes.TSLA.lockedRaw, '0');
      await act('alice', 'SELL', 'ETH', (10n * 10n ** 18n).toString(), 'AMZN');
      // Only the test operator supplies the rest of the local test funds. No faucet or live funding happens.
      const remaining = 500_000n * 10n ** 18n - BigInt(await f.launch.getFunction('sold')());
      await f.execute(f.usdc, 'transfer', f.alice.address, remaining / 2_000_000_000_000n);
      const final = await act('alice', 'MINT', 'AF_USDC', remaining.toString());
      const finalReceipt = await final.tx.wait();
      assert.ok(finalReceipt!.gasUsed < 6_000_000n);
      const market = (await service.snapshot()).markets.TSLA;
      assert.equal(market.state, 'LAUNCHED');
      assert.equal(market.soldRaw, (500_000n * 10n ** 18n).toString());
      assert.equal(market.reservePassRaw, (500_000n * 10n ** 18n).toString());
      assert.equal(market.reserveUsdcRaw, '250000000000');
      const pool = new Contract(
        market.pool!,
        (await artifact('AlphaForgePassPool', 'AlphaForgePassPool')).abi,
        f.a,
      );
      assert.ok((await pool.getFunction('balanceOf')(f.bob.address)) > 0n);
      await act('alice', 'BUY', 'ETH', parseEther('0.01').toString());
      assert.equal(indexer.status().state, 'HEALTHY');
      assert.ok(indexer.history('TSLA', 500).some((event) => event.name === 'Launch'));
      assert.ok(indexer.history('TSLA', 500).some((event) => event.name === 'Deposited'));
      assert.ok(indexer.candles('AMZN').length > 0);
      const indexedHolders = indexer.holders('TSLA', 500);
      assert.equal(
        indexedHolders.reduce((sum, holder) => sum + BigInt(holder.balanceRaw), 0n),
        1000000n * 10n ** 18n,
      );
      // A claim broadcast without registering its hash still reconciles from canonical chain logs.
      const charlie = Wallet.createRandom().connect(f.provider),
        charlieSigner = new NonceManager(charlie);
      await f.provider.send('anvil_setBalance', [charlie.address, toBeHex(parseEther('1'))]);
      const charlieAccount = service.account({
        email: 'charlie@example.test',
        subject: 'offline-google-charlie',
        emailVerified: true,
      });
      const challenge = store.bindingChallenge(charlieAccount.id, charlie.address, clock);
      store.bindWallet(
        charlieAccount.id,
        challenge.nonce,
        await charlie.signMessage(challenge.message),
        clock,
      );
      const orphanCheckpoint = await f.provider.send('evm_snapshot', []);
      const charlieQuote = await service.quote(
        {
          owner: charlie.address,
          strategyId: 'TSLA',
          operation: 'CLAIM',
          asset: 'AF_USDC',
          amountRaw: '0',
          slippageBps: 100,
        },
        charlieAccount.id,
      );
      await (
        await charlieSigner.sendTransaction({
          ...charlieQuote.transaction,
          value: BigInt(charlieQuote.transaction.value),
        })
      ).wait();
      await indexer.poll();
      assert.equal(store.voucher(charlieAccount.id)!.status, 'INCLUDED');
      await f.provider.send('anvil_mine', ['0x2']);
      await indexer.poll();
      assert.equal(store.voucher(charlieAccount.id)!.status, 'COMPLETED');
      await f.provider.send('evm_revert', [orphanCheckpoint]);
      await f.provider.send('anvil_mine', ['0x3']);
      await indexer.poll();
      assert.equal(await f.usdc.getFunction('balanceOf')(charlie.address), 0n);
      assert.equal(store.voucher(charlieAccount.id)!.status, 'REORGED');
      assert.equal((await service.snapshot()).claim.successfulClaims, 2);
      assert.equal(indexer.status().state, 'HEALTHY');
      const recorded = await api('alice', 'GET', '/api/launch-market/operations?owner=' + f.alice.address);
      assert.ok(recorded.operations.length >= 10);
      const beforeRestart = await chain.wallet(f.alice.address);
      await app.close();
      await indexer.close();
      store.close();
      store = new LaunchMarketStore(join(dir, 'market.sqlite'), 'http://127.0.0.1:8547');
      service = new LaunchMarketService(options());
      indexer = new MarketEventIndexer({
        path: join(dir, 'events.sqlite'),
        manifest: f.manifest,
        provider: chain.provider,
        service,
      });
      await indexer.poll();
      assert.equal(store.voucher(charlieAccount.id)!.status, 'REORGED');
      assert.ok(indexer.candles('AMZN').length > 0);
      app = Fastify();
      await app.register(cookie);
      register();
      assert.equal((await api('alice', 'GET', '/api/launch-market/account')).id, aliceIdentity);
      assert.equal(
        (await chain.wallet(f.alice.address)).passes.TSLA.balanceRaw,
        beforeRestart.passes.TSLA.balanceRaw,
      );
      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/launch-market/quote',
        headers: headers('alice'),
        payload: {
          owner: f.alice.address,
          strategyId: 'TSLA',
          operation: 'CLAIM',
          asset: 'AF_USDC',
          amountRaw: '0',
          slippageBps: 100,
        },
      });
      assert.equal(duplicate.statusCode, 409);
      // Token conservation over every holder recovered from real Transfer logs.
      const transfer = new Interface([
        'event Transfer(address indexed from,address indexed to,uint256 value)',
      ]);
      for (const token of [f.usdc, f.tsla, f.amzn]) {
        const logs = await f.provider.getLogs({
          address: String(token.target),
          fromBlock: Number(f.manifest.deploymentBlock),
          toBlock: 'latest',
          topics: [transfer.getEvent('Transfer')!.topicHash],
        });
        const holders = new Set<string>();
        for (const log of logs) {
          const parsed = transfer.parseLog(log)!;
          holders.add(parsed.args.from);
          holders.add(parsed.args.to);
        }
        let total = 0n;
        for (const holder of holders) total += BigInt(await token.getFunction('balanceOf')(holder));
        assert.equal(total, await token.getFunction('totalSupply')());
      }
      console.log(
        JSON.stringify({
          test: 'actual-local-EVM-Alice-Bob',
          chainId: 46630,
          finalMintGas: finalReceipt!.gasUsed.toString(),
          claims: String(await f.claim.getFunction('totalClaims')()),
          fixedSuppliesConserved: true,
          canonicalEventRebuild: true,
          unregisteredClaimReorgRecovered: true,
          restartRecovered: true,
        }),
      );
    } finally {
      await app.close();
      await indexer.close();
      store.close();
      chain.close();
      f.provider.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

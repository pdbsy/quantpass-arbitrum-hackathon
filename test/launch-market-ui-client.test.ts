import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marketInterfaces } from '../packages/launch-market/src/abi.ts';
import {
  LaunchMarketClient,
  MarketApiError,
  createLaunchApi,
  newerLocation,
} from '../apps/web/src/launch-market/client.ts';
import {
  fixture,
  OWNER,
  OTHER,
  HASH,
  BLOCK,
  NOW,
  location,
  quote,
} from './helpers/launch-market-ui-fixture.ts';
import type { QuoteRequest } from '../packages/launch-market/src/types.ts';
const buy: Omit<QuoteRequest, 'owner'> = {
  strategyId: 'AMZN',
  operation: 'BUY',
  asset: 'AF_USDC',
  amountRaw: '10000000',
  slippageBps: 50,
};
async function connected() {
  const f = fixture();
  const client = new LaunchMarketClient({ api: f.api, provider: f.provider, now: () => NOW });
  assert.equal(await client.initialize(), true);
  await client.connect();
  return { ...f, client };
}

test('absent chain-market route keeps the existing workshop; NOT_DEPLOYED performs no asset or wallet request', async () => {
  const missing = new LaunchMarketClient({
    api: async () => {
      throw new MarketApiError('NOT_FOUND', 404);
    },
  });
  assert.equal(await missing.initialize(), false);
  const f = fixture();
  f.state.config = { ...f.state.config, deployment: 'NOT_DEPLOYED', manifest: null };
  const client = new LaunchMarketClient({ api: f.api, provider: f.provider });
  assert.equal(await client.initialize(), true);
  assert.equal(client.state.snapshot, null);
  assert.deepEqual(f.provider.calls, []);
  assert.equal(f.state.requests.length, 1);
  await assert.rejects(client.review(buy), /MARKET_ACTION_UNAVAILABLE/);
});

test('quote review binds owner, strategy, asset, amount, recipient and slippage before a wallet send', async () => {
  const { client, state, provider } = await connected();
  const base = quote({ ...buy, owner: OWNER });
  state.quote = {
    ...base,
    transaction: {
      ...base.transaction,
      data: marketInterfaces.pool.encodeFunctionData('buy', [
        buy.amountRaw,
        base.minOutRaw,
        OTHER,
        base.expiresAt,
      ]),
    },
  };
  await assert.rejects(client.review(buy), /QUOTE_TRANSACTION_MISMATCH/);
  state.quote = {
    ...base,
    minOutRaw: '1',
    transaction: {
      ...base.transaction,
      data: marketInterfaces.pool.encodeFunctionData('buy', [buy.amountRaw, '1', OWNER, base.expiresAt]),
    },
  };
  await assert.rejects(client.review(buy), /QUOTE_SLIPPAGE_MISMATCH/);
  state.quote = { ...base, asset: 'ETH' };
  await assert.rejects(client.review(buy), /QUOTE_REQUEST_MISMATCH/);
  assert.equal(
    provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
});

test('ETH is native transaction value, with no token approval or AF-ETH substitution', async () => {
  const { client, provider } = await connected();
  await client.review({ ...buy, asset: 'ETH', amountRaw: '10000000000000000' });
  await client.confirm();
  const sent = provider.calls.find((call) => call.method === 'eth_sendTransaction');
  assert.equal((sent?.params?.[0] as { value: string }).value, '0x2386f26fc10000');
  assert.equal(client.state.transaction.state, 'SUBMITTED');
  assert.equal(client.state.transaction.hash, HASH);
});

test('a wallet network change invalidates the quote and prevents a new send', async () => {
  const { client, provider } = await connected();
  await client.review(buy);
  provider.chainId = '0x1';
  provider.emit('chainChanged', '0x1');
  assert.equal(client.state.quote, null);
  assert.equal(client.state.wallet, null);
  await assert.rejects(client.confirm(), /QUOTE_REVIEW_REQUIRED/);
  assert.equal(
    provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
});

test('explicit wallet rejection is distinct from an uncertain submitted outcome', async () => {
  const rejected = await connected();
  await rejected.client.review(buy);
  rejected.provider.sendError = { code: 4001 };
  await assert.rejects(rejected.client.confirm(), /WALLET_REJECTED/);
  assert.equal(rejected.client.state.transaction.state, 'REJECTED');
  assert.equal(rejected.client.state.transaction.hash, null);
  const uncertain = await connected();
  await uncertain.client.review(buy);
  uncertain.provider.sendError = { code: -32000 };
  await uncertain.client.confirm();
  assert.equal(uncertain.client.state.transaction.state, 'RECOVERY_REQUIRED');
  await assert.rejects(uncertain.client.review(buy), /MARKET_ACTION_UNAVAILABLE/);
  assert.equal(uncertain.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('registration failure preserves the hash and retries observation without broadcasting twice', async () => {
  const { client, provider, state } = await connected();
  await client.review(buy);
  state.registrationError = true;
  await assert.rejects(client.confirm(), /SYNC_UNAVAILABLE/);
  assert.equal(client.state.transaction.state, 'RECOVERY_REQUIRED');
  assert.equal(client.state.transaction.hash, HASH);
  state.registrationError = false;
  await client.refresh();
  assert.equal(client.state.transaction.state, 'SUBMITTED');
  assert.equal(provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('a returned hash or insufficient-depth projection cannot mark a transfer complete', async () => {
  const { client, state } = await connected();
  await client.review(buy);
  await client.confirm();
  assert.equal(client.state.transaction.state, 'SUBMITTED');
  state.operation = { ...state.operation, state: 'COMPLETED', confirmations: 2, location: location() };
  await assert.rejects(client.refreshTransaction(), /INSUFFICIENT_CONFIRMATION_EVIDENCE/);
  assert.equal(client.state.transaction.state, 'SUBMITTED');
  state.operation = { ...state.operation, confirmations: 3 };
  await client.refreshTransaction();
  assert.equal(client.state.transaction.state, 'COMPLETED');
});

test('exact ERC-20 approval is a separate transaction and waits three inclusive blocks', async () => {
  const { client, provider, state, tokenInterface } = await connected();
  const base = quote({ ...buy, owner: OWNER });
  state.quote = {
    ...base,
    allowance: { token: state.config.manifest!.usdc, spender: base.transaction.to, amountRaw: buy.amountRaw },
    gasEstimateRaw: null,
    simulation: 'APPROVAL_REQUIRED',
  };
  await client.review(buy);
  await client.confirm();
  const sent = provider.calls.find((call) => call.method === 'eth_sendTransaction')?.params?.[0] as {
    to: string;
    data: string;
    value: string;
  };
  const approval = tokenInterface.parseTransaction({ data: sent.data })!;
  assert.equal(sent.to, state.config.manifest!.usdc);
  assert.equal(sent.value, '0x0');
  assert.equal(approval.name, 'approve');
  assert.equal(approval.args[1], 10000000n);
  assert.equal(
    state.requests.some((request) => request.path.endsWith('/submissions')),
    false,
  );
  provider.receipt = {
    transactionHash: HASH,
    from: OWNER,
    blockNumber: '0x64',
    blockHash: BLOCK,
    status: '0x1',
  };
  provider.tip = '0x65';
  await client.refreshTransaction();
  assert.equal(client.state.transaction.confirmations, 2);
  assert.equal(client.state.transaction.state, 'INCLUDED');
  provider.tip = '0x66';
  await client.refreshTransaction();
  assert.equal(client.state.transaction.state, 'COMPLETED');
  assert.equal(client.state.quote, null);
  assert.match(client.state.notice!, /asset operation has not been sent/);
  assert.equal(provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('old synchronization messages cannot undo launch; reorg invalidates quote and rereads chain state', async () => {
  const { client, state } = await connected();
  const launched = {
    ...state.snapshot,
    location: location(102),
    markets: {
      ...state.snapshot.markets,
      TSLA: {
        ...state.snapshot.markets.TSLA,
        state: 'LAUNCHED' as const,
        soldRaw: state.snapshot.markets.TSLA.publicSupplyRaw,
        remainingRaw: '0',
        pool: state.config.manifest!.strategies.AMZN.pool,
        reservePassRaw: state.snapshot.markets.TSLA.lpPassRaw,
        reserveUsdcRaw: state.snapshot.markets.TSLA.lpUsdcRaw,
      },
    },
  };
  await client.stream({ type: 'SNAPSHOT', location: launched.location, snapshot: launched });
  await client.stream({ type: 'SNAPSHOT', location: state.snapshot.location, snapshot: state.snapshot });
  assert.equal(client.state.snapshot!.markets.TSLA.state, 'LAUNCHED');
  await client.review(buy);
  await client.stream({ type: 'REORG', location: location(100) });
  assert.equal(client.state.quote, null);
  assert.equal(client.state.snapshot!.markets.TSLA.state, 'MINTING');
  assert.equal(newerLocation({ ...location(100), blockHash: HASH }, location(100)), false);
});

test('same-origin mutations acquire session CSRF without asserting a browser supplied email', async () => {
  const calls: { path: string; options?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, options) => {
    calls.push({ path: String(input), ...(options ? { options } : {}) });
    return Response.json(
      String(input) === '/auth/session' ? { csrfToken: 'trusted-session-csrf-token' } : { ok: true },
    );
  };
  const api = createLaunchApi(fetcher);
  await api('/api/launch-market/wallet/challenge', { owner: OWNER });
  assert.equal(calls[0]!.path, '/auth/session');
  assert.equal(
    (calls[1]!.options!.headers as Record<string, string>)['x-csrf-token'],
    'trusted-session-csrf-token',
  );
  assert.equal(calls[1]!.options!.body, JSON.stringify({ owner: OWNER }));
  assert.equal(calls[1]!.options!.credentials, 'same-origin');
});

test('bounded nested production API error codes remain available for claim and ETH recovery messages', async () => {
  for (const code of ['CLAIM_RECOVERY_REQUIRED', 'ETH_PATH_UNAVAILABLE']) {
    const api = createLaunchApi(async () => Response.json({ error: { code } }, { status: 409 }));
    await assert.rejects(
      api('/api/launch-market/snapshot'),
      (error: unknown) => error instanceof Error && error.message === code,
    );
  }
  for (const code of ['x'.repeat(1000), '<script>alert(1)</script>']) {
    const api = createLaunchApi(async () => Response.json({ error: { code } }, { status: 503 }));
    await assert.rejects(api('/api/launch-market/snapshot'), /MARKET_API_UNAVAILABLE/);
  }
});

test('an API read failure cannot release the outstanding wallet confirmation lock', async () => {
  const { client, provider } = await connected();
  const response = Promise.withResolvers<unknown>();
  provider.sendResponse = response.promise;
  await client.review(buy);
  const pending = client.confirm();
  await provider.sendStarted.promise;
  client.setError(new Error('Temporary read failure'));
  assert.equal(client.state.busy, true);
  await assert.rejects(client.confirm(), /QUOTE_REVIEW_REQUIRED/);
  response.resolve(HASH);
  await pending;
  assert.equal(provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('reload recovers the durable outstanding operation without sending another transaction', async () => {
  const f = fixture();
  f.state.operations = [f.state.operation];
  const reloaded = new LaunchMarketClient({ api: f.api, provider: f.provider, now: () => NOW });
  await reloaded.initialize();
  await reloaded.connect();
  assert.equal(reloaded.state.transaction.hash, HASH);
  assert.equal(reloaded.state.transaction.id, 'operation_a');
  assert.equal(reloaded.state.transaction.state, 'SUBMITTED');
  await assert.rejects(reloaded.review(buy), /MARKET_ACTION_UNAVAILABLE/);
  assert.equal(
    f.provider.calls.some((call) => call.method === 'eth_sendTransaction'),
    false,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits, formatUnits, unsigned, signed, MAX_INTEGER } from '../packages/domain/src/money.ts';
import {
  createVault,
  execute,
  balances,
  assertInvariant,
  restoreVault,
  DomainError,
  type Command,
  type Actor,
  type SettlementPolicy,
} from '../packages/domain/src/vault.ts';
import { ZERO_FEE_FULL_SETTLEMENT } from '../packages/domain/src/fixtures.ts';

type Action = Command extends infer T
  ? T extends Command
    ? Omit<T, 'id' | 'expectedRevision'>
    : never
  : never;
const u = (value: string) => parseUnits(value, 6);
const owner: Actor = { id: 'alice', role: 'owner' };
const executor: Actor = { id: 'simulator', role: 'executor' };
const create = () =>
  createVault({
    id: 'vault-a',
    ownerId: 'alice',
    executorId: 'simulator',
    strategyId: 'fixed-demo',
    passes: '1000',
    scope: 'TEST_ONLY',
  });
function harness() {
  let state = create();
  return {
    get state() {
      return state;
    },
    step(action: Action, actor = owner, policy?: SettlementPolicy) {
      state = execute(
        state,
        actor,
        { ...action, id: `event-${state.revision + 1}`, expectedRevision: state.revision } as Command,
        policy,
      );
      return state;
    },
  };
}
function invested() {
  const h = harness();
  h.step({ type: 'deposit', amount: u('1500') });
  h.step({ type: 'allocate', amount: u('1000') });
  h.step({ type: 'start' });
  h.step({ type: 'reserveBuy', orderId: 'buy-1', amount: u('1000') }, executor);
  h.step({ type: 'fillBuy', orderId: 'buy-1' }, executor);
  return h;
}
const code = (expected: string) => (error: unknown) =>
  error instanceof DomainError && error.code === expected;

test('domain amounts roundtrip exactly and reject overflow, floats, exponents and malformed precision', () => {
  for (const [value, decimals] of [
    ['1000', 6],
    ['0.000001', 6],
    ['9007199254740993', 0],
    ['0.1', 18],
  ] as const) {
    const raw = parseUnits(value, decimals);
    assert.equal(parseUnits(formatUnits(raw, decimals), decimals), raw);
  }
  assert.equal(unsigned(MAX_INTEGER.toString()), MAX_INTEGER);
  assert.throws(() => unsigned((MAX_INTEGER + 1n).toString()));
  for (const bad of ['-1', '01', '1.1', '1e3', '', ' 1', 'NaN']) assert.throws(() => unsigned(bad));
  for (const bad of ['-0', '+1', '--1']) assert.throws(() => signed(bad));
  assert.throws(() => parseUnits('0.0000001', 6));
  assert.throws(() => parseUnits('1', -1));
  assert.throws(() => parseUnits('1', 1.5));
});

test('S01-S03: Pass is allowance, deposit creates idle cash, withdrawal requires confirmation', () => {
  const h = harness();
  assert.equal(balances(h.state).allowance, BigInt(u('1000')));
  assert.equal(balances(h.state).equity, 0n);
  h.step({ type: 'deposit', amount: u('1500') });
  assert.equal(h.state.activeCash, '0');
  h.step({ type: 'allocate', amount: u('1000') });
  assert.equal(h.state.idle, u('500'));
  h.step({ type: 'requestWithdrawal', amount: u('500') });
  assert.equal(h.state.withdrawalsPaid, '0');
  assert.equal(balances(h.state).pending, BigInt(u('500')));
  assert.equal(balances(h.state).equity, BigInt(u('1500')));
  h.step({ type: 'confirmWithdrawal', withdrawalId: 'event-3' }, executor);
  assert.equal(h.state.withdrawalsPaid, u('500'));
  assert.equal(h.state.activeCash, u('1000'));
  assert.equal(balances(h.state).equity, BigInt(u('1000')));
});

test('S04: losses do not silently refill from idle cash or change Pass allowance', () => {
  const h = invested();
  h.step({ type: 'markPosition', value: u('900') }, executor);
  assert.equal(h.state.idle, u('500'));
  assert.equal(balances(h.state).equity, BigInt(u('1400')));
  h.step({ type: 'settlePosition', proceeds: u('900') }, executor, ZERO_FEE_FULL_SETTLEMENT);
  assert.equal(h.state.activeCash, u('900'));
  assert.equal(h.state.idle, u('500'));
  assert.equal(h.state.realizedPnl, `-${u('100')}`);
});

test('S05-S06: unrealized gains stay in positions, isolated only after explicit fixture settlement', () => {
  const h = invested();
  h.step({ type: 'markPosition', value: u('1100') }, executor);
  assert.equal(h.state.idle, u('500'));
  assert.equal(h.state.activeCash, '0');
  assert.equal(balances(h.state).unrealized, BigInt(u('100')));
  assert.throws(() => h.step({ type: 'allocate', amount: u('1') }), code('ALLOWANCE_EXCEEDED'));
  const original = JSON.stringify(h.state);
  assert.throws(
    () => h.step({ type: 'settlePosition', proceeds: u('1100') }, executor),
    code('SETTLEMENT_POLICY_REQUIRED'),
  );
  assert.equal(JSON.stringify(h.state), original);
  h.step({ type: 'settlePosition', proceeds: u('1100') }, executor, ZERO_FEE_FULL_SETTLEMENT);
  assert.equal(h.state.activeCash, u('1000'));
  assert.equal(h.state.idle, u('600'));
  assert.equal(balances(h.state).unrealized, 0n);
  assert.equal(balances(h.state).equity, BigInt(u('1600')));
});

test('S07: order reservation is part of active assets, cannot consume idle cash or be filled twice', () => {
  const h = harness();
  h.step({ type: 'deposit', amount: u('1500') });
  h.step({ type: 'allocate', amount: u('1000') });
  h.step({ type: 'start' });
  h.step({ type: 'reserveBuy', orderId: 'order-a', amount: u('200') }, executor);
  assert.equal(h.state.activeCash, u('800'));
  assert.equal(balances(h.state).reserved, BigInt(u('200')));
  assert.equal(balances(h.state).equity, BigInt(u('1500')));
  assert.throws(
    () => h.step({ type: 'reserveBuy', orderId: 'order-b', amount: u('801') }, executor),
    code('INSUFFICIENT_ACTIVE_CASH'),
  );
  h.step({ type: 'fillBuy', orderId: 'order-a' }, executor);
  assert.throws(() => h.step({ type: 'fillBuy', orderId: 'order-a' }, executor), code('ORDER_NOT_PENDING'));
});

test('fee liabilities are cash-backed, cannot be withdrawn, and payment never deducts twice', () => {
  const h = invested();
  const fixture: SettlementPolicy = {
    scope: 'TEST_ONLY',
    id: 'fixture-fee-20',
    assess: () => ({ fee: BigInt(u('20')), excessToIdle: BigInt(u('80')) }),
  };
  h.step({ type: 'settlePosition', proceeds: u('1100') }, executor, fixture);
  assert.equal(h.state.activeCash, u('1020'));
  assert.equal(h.state.feeLiability, u('20'));
  assert.equal(h.state.idle, u('580'));
  assert.equal(balances(h.state).equity, BigInt(u('1580')));
  assert.throws(() => h.step({ type: 'deallocate', amount: u('1020') }), code('INSUFFICIENT_ACTIVE_CASH'));
  h.step({ type: 'payFees', amount: u('20') }, executor);
  assert.equal(h.state.activeCash, u('1000'));
  assert.equal(balances(h.state).equity, BigInt(u('1580')));
  assert.throws(() => h.step({ type: 'payFees', amount: u('20') }, executor), code('EXCESS_FEE_PAYMENT'));
});

test('N01-N03: allowance, idle withdrawals and actor boundaries reject without mutation', () => {
  const h = harness();
  h.step({ type: 'deposit', amount: u('1500') });
  const original = JSON.stringify(h.state);
  assert.throws(() => h.step({ type: 'allocate', amount: u('1001') }), code('ALLOWANCE_EXCEEDED'));
  assert.throws(() => h.step({ type: 'requestWithdrawal', amount: u('1501') }), code('INSUFFICIENT_IDLE'));
  for (const actor of [
    { id: 'bob', role: 'owner' },
    { id: 'simulator', role: 'executor' },
  ] as const) {
    assert.throws(() => h.step({ type: 'requestWithdrawal', amount: u('1') }, actor), code('FORBIDDEN'));
  }
  assert.equal(JSON.stringify(h.state), original);
  assert.ok(Object.isFrozen(h.state));
});

test('N04: replay is persisted across JSON restore; changed payload and stale revision reject', () => {
  const initial = create();
  const command: Command = { id: 'deposit-1', expectedRevision: 0, type: 'deposit', amount: u('1500') };
  const state = execute(initial, owner, command);
  assert.equal(execute(state, owner, command), state);
  const restored = restoreVault(JSON.stringify(state));
  assert.equal(execute(restored, owner, command), restored);
  assert.throws(() => execute(restored, owner, { ...command, amount: u('1') }), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(
    () => execute(restored, owner, { ...command, id: 'other-request' }),
    code('REVISION_CONFLICT'),
  );
  assert.throws(() => execute(restored, { id: 'bob', role: 'owner' }, command), code('FORBIDDEN'));
});

test('withdrawal cancellation restores only the pending amount; replay and stale confirmations do not pay it', () => {
  const h = harness();
  h.step({ type: 'deposit', amount: u('500') });
  h.step({ type: 'requestWithdrawal', amount: u('200') });
  h.step({ type: 'cancelWithdrawal', withdrawalId: 'event-2' });
  assert.equal(h.state.idle, u('500'));
  assert.throws(
    () => h.step({ type: 'confirmWithdrawal', withdrawalId: 'event-2' }, executor),
    code('WITHDRAWAL_NOT_PENDING'),
  );
});

test('stop is an exit request, not invented liquidation: pending orders can cancel, positions must settle', () => {
  const h = invested();
  h.step({ type: 'stop' });
  assert.equal(h.state.status, 'stopping');
  assert.throws(
    () => h.step({ type: 'reserveBuy', orderId: 'new-order', amount: u('1') }, executor),
    code('NOT_RUNNING'),
  );
  h.step({ type: 'settlePosition', proceeds: u('1000') }, executor, ZERO_FEE_FULL_SETTLEMENT);
  assert.equal(h.state.status, 'stopped');
  h.step({ type: 'deallocate', amount: u('1000') });
  assert.equal(h.state.idle, u('1500'));
});

test('malformed snapshots, impossible fee policy and oversize amounts cannot commit a transition', () => {
  const h = invested();
  for (const change of [{ idle: '-1' }, { deposits: '0' }, { revision: 999 }, { scope: 'production' }]) {
    assert.throws(() => restoreVault(JSON.stringify({ ...h.state, ...change })));
  }
  const snapshot = JSON.stringify(h.state);
  for (const result of [
    { fee: 1n, excessToIdle: 0n },
    { fee: 0n, excessToIdle: BigInt(u('1001')) },
  ]) {
    assert.throws(() =>
      h.step({ type: 'settlePosition', proceeds: u('1000') }, executor, {
        scope: 'TEST_ONLY',
        id: 'bad-policy',
        assess: () => result,
      }),
    );
  }
  assert.equal(JSON.stringify(h.state), snapshot);
});

test('deterministic state-machine sequences preserve balances and replay safety over 1500 operations', () => {
  let seed = 0x51ab23;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const h = harness();
  for (let i = 0; i < 1500; i++) {
    const type = (['deposit', 'allocate', 'deallocate', 'requestWithdrawal'] as const)[random() % 4]!;
    const action = { type, amount: u(String((random() % 100) + 1)) };
    const before = JSON.stringify(h.state);
    try {
      h.step(action);
    } catch (error) {
      assert.ok(error instanceof DomainError);
      assert.equal(JSON.stringify(h.state), before);
    }
    assertInvariant(h.state);
    assert.equal(restoreVault(JSON.stringify(h.state)).revision, h.state.revision);
  }
});

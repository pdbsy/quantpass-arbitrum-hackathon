import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault,
  execute,
  balances,
  restoreVault,
  type Command,
  type VaultState,
} from '../packages/domain/src/vault.ts';
import { ZERO_FEE_FULL_SETTLEMENT } from '../packages/domain/src/fixtures.ts';
const owner = { id: 'alice', role: 'owner' } as const;
const executor = { id: 'sim', role: 'executor' } as const;
function harness() {
  let state = createVault({
    id: 'v',
    ownerId: 'alice',
    executorId: 'sim',
    strategyId: 's',
    passes: '1000',
    scope: 'TEST_ONLY',
  });
  const step = (fields: Record<string, unknown>, exec = false) =>
    (state = execute(
      state,
      exec ? executor : owner,
      { ...fields, id: `c${state.revision}`, expectedRevision: state.revision } as Command,
      ZERO_FEE_FULL_SETTLEMENT,
    ));
  step({ type: 'enablePassLocking' });
  return {
    get state() {
      return state;
    },
    step,
  };
}
const lock = (s: VaultState) =>
  (
    s as VaultState & {
      passLock: {
        principal: string;
        closed: boolean;
        withdrawals: Record<string, { principal: string; profit: string }>;
      };
    }
  ).passLock;
test('deposit freezes exact principal and insufficient Pass is atomic', () => {
  const h = harness();
  h.step({ type: 'deposit', amount: '100000001' });
  assert.equal(lock(h.state).principal, '100000001');
  const before = h.state;
  assert.throws(() => h.step({ type: 'deposit', amount: '900000000' }), /INSUFFICIENT_FREE_PASS/);
  assert.equal(h.state, before);
  assert.equal(h.state.idle, '100000001');
  assert.equal(restoreVault(JSON.stringify(h.state)).idle, '100000001');
});
function settled(proceeds: string) {
  const h = harness();
  h.step({ type: 'deposit', amount: '1000000000' });
  h.step({ type: 'allocate', amount: '1000000000' });
  h.step({ type: 'start' });
  h.step({ type: 'reserveBuy', orderId: 'o', amount: '1000000000' }, true);
  h.step({ type: 'fillBuy', orderId: 'o' }, true);
  h.step({ type: 'settlePosition', proceeds }, true);
  h.step({ type: 'stop' });
  h.step({ type: 'deallocate', amount: h.state.activeCash });
  return h;
}
test('withdrawal reserves profit first, cancel does not unlock, confirmation unlocks principal once', () => {
  const h = settled('1100000000');
  const id = `c${h.state.revision}`;
  h.step({ type: 'requestWithdrawal', amount: '150000000' });
  assert.deepEqual(lock(h.state).withdrawals[id], { profit: '100000000', principal: '50000000' });
  assert.equal(lock(h.state).principal, '1000000000');
  h.step({ type: 'cancelWithdrawal', withdrawalId: id });
  assert.equal(lock(h.state).principal, '1000000000');
  const id2 = `c${h.state.revision}`;
  h.step({ type: 'requestWithdrawal', amount: '150000000' });
  const cmd = {
    type: 'confirmWithdrawal',
    withdrawalId: id2,
    id: `c${h.state.revision}`,
    expectedRevision: h.state.revision,
  } as const;
  const paid = execute(h.state, executor, cmd);
  assert.equal(lock(paid).principal, '950000000');
  assert.equal(paid.withdrawalsPaid, '150000000');
  assert.equal(execute(paid, executor, cmd), paid);
  assert.equal(balances(paid).equity, 950000000n);
});
test('pending requests cannot reuse reserved profit and confirmation rechecks open positions', () => {
  const h = settled('1100000000');
  h.step({ type: 'requestWithdrawal', amount: '100000000' });
  const principalId = `c${h.state.revision}`;
  h.step({ type: 'requestWithdrawal', amount: '100000000' });
  assert.deepEqual(lock(h.state).withdrawals[principalId], { profit: '0', principal: '100000000' });
  h.step({ type: 'allocate', amount: '100000000' });
  h.step({ type: 'start' });
  h.step({ type: 'reserveBuy', orderId: 'new', amount: '100000000' }, true);
  h.step({ type: 'fillBuy', orderId: 'new' }, true);
  assert.throws(
    () => h.step({ type: 'confirmWithdrawal', withdrawalId: principalId }, true),
    /OPEN_PASS_POSITIONS/,
  );
  assert.throws(() => h.step({ type: 'requestWithdrawal', amount: '1' }), /OPEN_PASS_POSITIONS/);
  h.step({ type: 'cancelWithdrawal', withdrawalId: principalId });
  assert.equal(lock(h.state).principal, '1000000000');
});
test('loss does not unlock Pass until full flat exit, closed Vault cannot receive deposits', () => {
  const h = settled('900000000');
  assert.equal(lock(h.state).principal, '1000000000');
  h.step({ type: 'closeVault' });
  assert.equal(h.state.withdrawalsPaid, '900000000');
  assert.equal(lock(h.state).principal, '0');
  assert.equal(lock(h.state).closed, true);
  assert.equal(balances(h.state).equity, 0n);
  assert.throws(() => h.step({ type: 'deposit', amount: '1' }), /VAULT_CLOSED/);
});
test('legacy state remains legacy and prior withdrawals cannot be guessed into Pass history', () => {
  let s = createVault({
    id: 'v',
    ownerId: 'alice',
    executorId: 'sim',
    strategyId: 's',
    passes: '1000',
    scope: 'TEST_ONLY',
  });
  s = execute(s, owner, { id: 'd', expectedRevision: 0, type: 'deposit', amount: '1500000000' });
  assert.equal(lock(s), undefined);
  assert.equal(restoreVault(JSON.stringify(s)).idle, '1500000000');
  assert.throws(
    () =>
      execute(s, owner, { id: 'enable', expectedRevision: s.revision, type: 'enablePassLocking' } as Command),
    /PASS_ADOPTION_UNSAFE/,
  );
});

test('full exit rejects pending withdrawals and exposure without changing balances', () => {
  const h = harness();
  h.step({ type: 'deposit', amount: '1000000' });
  h.step({ type: 'requestWithdrawal', amount: '1' });
  const pending = h.state;
  assert.throws(() => h.step({ type: 'closeVault' }), /VAULT_EXIT_NOT_READY/);
  assert.equal(h.state, pending);
  h.step({ type: 'cancelWithdrawal', withdrawalId: 'c2' });
  h.step({ type: 'allocate', amount: '1000000' });
  h.step({ type: 'start' });
  h.step({ type: 'reserveBuy', orderId: 'x', amount: '1000000' }, true);
  h.step({ type: 'fillBuy', orderId: 'x' }, true);
  h.step({ type: 'stop' });
  assert.throws(() => h.step({ type: 'closeVault' }), /VAULT_EXIT_NOT_READY/);
  assert.equal(lock(h.state).principal, '1000000');
});
test('safe explicit legacy adoption locks original deposits, never unrealized or realized profit', () => {
  let s = createVault({
    id: 'v',
    ownerId: 'alice',
    executorId: 'sim',
    strategyId: 's',
    passes: '1000',
    scope: 'TEST_ONLY',
  });
  s = execute(s, owner, { id: 'd', expectedRevision: 0, type: 'deposit', amount: '123456789' });
  const enabled = execute(s, owner, { id: 'e', expectedRevision: 1, type: 'enablePassLocking' });
  assert.equal(lock(enabled).principal, '123456789');
  assert.equal(enabled.idle, s.idle);
  assert.equal(enabled.deposits, s.deposits);
  s = execute(s, owner, { id: 'w', expectedRevision: 1, type: 'requestWithdrawal', amount: '1' });
  s = execute(s, executor, { id: 'c', expectedRevision: 2, type: 'confirmWithdrawal', withdrawalId: 'w' });
  assert.throws(
    () => execute(s, owner, { id: 'e', expectedRevision: 3, type: 'enablePassLocking' }),
    /PASS_ADOPTION_UNSAFE/,
  );
});
test('only realized liquid profit may be withdrawn while positions are open', () => {
  const h = settled('1100000000');
  h.step({ type: 'allocate', amount: '10000000' });
  h.step({ type: 'start' });
  h.step({ type: 'reserveBuy', orderId: 'tiny', amount: '10000000' }, true);
  h.step({ type: 'fillBuy', orderId: 'tiny' }, true);
  h.step({ type: 'markPosition', value: '500000000' }, true);
  // Cash 1090 minus principal 1000: only 90 of profit is independently liquid.
  assert.throws(() => h.step({ type: 'requestWithdrawal', amount: '90000001' }), /OPEN_PASS_POSITIONS/);
  const id = `c${h.state.revision}`;
  h.step({ type: 'requestWithdrawal', amount: '90000000' });
  h.step({ type: 'confirmWithdrawal', withdrawalId: id }, true);
  assert.equal(lock(h.state).principal, '1000000000');
  assert.equal(h.state.withdrawalsPaid, '90000000');
});

test('Pass projection uses 18 decimals while principal uses 6 without rounding', async () => {
  const { passAccounting, capacityToPassRaw, passRawToCapacity } =
    await import('../packages/domain/src/vault.ts');
  const h = harness();
  h.step({ type: 'deposit', amount: '100000001' });
  const a = passAccounting(h.state)!;
  assert.equal(a.lockedPassRaw, '100000001000000000000');
  assert.equal(a.freePassRaw, '899999999000000000000');
  assert.equal(a.passDecimals, 18);
  assert.equal(a.capacityDecimals, 6);
  assert.equal(capacityToPassRaw('1'), '1000000000000');
  assert.equal(passRawToCapacity('1000000000000'), '1');
  assert.throws(() => passRawToCapacity('1000000000001'), /INEXACT_PASS_AMOUNT/);
  assert.throws(() => capacityToPassRaw(((1n << 256n) - 1n).toString()), /AMOUNT_OVERFLOW/);
});

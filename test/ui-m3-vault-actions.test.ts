import test from 'node:test';
import assert from 'node:assert/strict';
import { createM3VaultActionFactory } from '../apps/web/src/m3-vault-actions.ts';
import { asAddress } from '../packages/chain-adapter/src/types.ts';

const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');

test('Vault action factory prepares exact deposit, withdraw and close calldata for the configured deployment', () => {
  const factory = createM3VaultActionFactory({ chainId: 46_630, target: CONTRACT });
  const deposit = factory.prepare(
    { operationId: 'deposit-1', type: 'deposit', usdcBaseUnits: '1000000' },
    OWNER,
  );
  const withdraw = factory.prepare(
    { operationId: 'withdraw-1', type: 'withdraw', usdcBaseUnits: '500000' },
    OWNER,
  );
  const close = factory.prepare({ operationId: 'close-1', type: 'close' }, OWNER);
  assert.equal(deposit.data, `0xb6b55f25${1_000_000n.toString(16).padStart(64, '0')}`);
  assert.equal(withdraw.data, `0x2e1a7d4d${500_000n.toString(16).padStart(64, '0')}`);
  assert.equal(close.data, '0x43d726d6');
  for (const prepared of [deposit, withdraw, close]) {
    assert.equal(prepared.chainId, 46_630);
    assert.equal(prepared.owner, OWNER);
    assert.equal(prepared.target, CONTRACT);
    assert.equal(prepared.value, 0n);
  }
});

test('Vault action factory rejects zero, signed, noncanonical and uint256-overflow amounts', () => {
  const factory = createM3VaultActionFactory({ chainId: 46_630, target: CONTRACT });
  for (const usdcBaseUnits of ['0', '-1', '+1', '01', '1.0', `${1n << 256n}`]) {
    assert.throws(
      () => factory.prepare({ operationId: 'bad', type: 'deposit', usdcBaseUnits }, OWNER),
      /INVALID_M3_VAULT_AMOUNT/,
    );
  }
});

test('Vault action factory prepares post-close token and native rescue calldata for the fixed Vault', () => {
  const factory = createM3VaultActionFactory({ chainId: 46_630, target: CONTRACT });
  let tokenRescue: ReturnType<typeof factory.prepare> | undefined;
  let nativeRescue: ReturnType<typeof factory.prepare> | undefined;
  try {
    tokenRescue = factory.prepare(
      {
        operationId: 'rescue-token-1',
        type: 'rescue-token',
        token: asAddress('0x3333333333333333333333333333333333333333'),
      },
      OWNER,
    );
    nativeRescue = factory.prepare({ operationId: 'rescue-native-1', type: 'rescue-native' }, OWNER);
  } catch {
    // The assertions below keep the missing behavior as an explicit RED failure.
  }

  assert.equal(
    tokenRescue?.data,
    `0x45f5030f${'3333333333333333333333333333333333333333'.padStart(64, '0')}`,
  );
  assert.equal(nativeRescue?.data, '0xfc82f084');
  for (const prepared of [tokenRescue, nativeRescue]) {
    assert.equal(prepared?.target, CONTRACT);
    assert.equal(prepared?.owner, OWNER);
    assert.equal(prepared?.value, 0n);
  }
});

test('Pass transfer factory preserves one raw unit at full eighteen-decimal precision', async () => {
  let prepared:
    | {
        readonly target: string;
        readonly owner: string;
        readonly value: bigint;
        readonly data: string;
      }
    | undefined;
  try {
    const { createM3PassTransferFactory } = await import('../apps/web/src/m3-pass-actions.ts');
    const factory = createM3PassTransferFactory({
      chainId: 46_630,
      target: asAddress('0x4444444444444444444444444444444444444444'),
    });
    prepared = factory.prepare(
      {
        operationId: 'pass-transfer-1',
        recipient: asAddress('0x5555555555555555555555555555555555555555'),
        passBaseUnits: '1',
      },
      OWNER,
    );
  } catch {
    // The assertions below keep a missing transfer factory as an explicit RED failure.
  }

  assert.equal(prepared?.target, '0x4444444444444444444444444444444444444444');
  assert.equal(prepared?.owner, OWNER);
  assert.equal(prepared?.value, 0n);
  assert.equal(
    prepared?.data,
    `0xa9059cbb${'5555555555555555555555555555555555555555'.padStart(64, '0')}${'1'.padStart(64, '0')}`,
  );
});

test('Pass transfer rejects invalid raw amounts and zero recipient before producing any wallet action', async () => {
  const { createM3PassTransferFactory } = await import('../apps/web/src/m3-pass-actions.ts');
  const factory = createM3PassTransferFactory({ chainId: 46630, target: CONTRACT });
  for (const passBaseUnits of ['0', '-1', '+1', '01', '1.0', '1e18', `${1n << 256n}`]) {
    assert.throws(
      () => factory.prepare({ operationId: 'invalid-pass', recipient: OWNER, passBaseUnits }, OWNER),
      /INVALID_M3_PASS_AMOUNT/,
    );
  }
  assert.throws(
    () =>
      factory.prepare(
        { operationId: 'zero-recipient', recipient: asAddress(`0x${'0'.repeat(40)}`), passBaseUnits: '1' },
        OWNER,
      ),
    /INVALID_M3_PASS_RECIPIENT/,
  );
  const maximum = (1n << 256n) - 1n;
  const valid = factory.prepare(
    { operationId: 'maximum-pass', recipient: OWNER, passBaseUnits: String(maximum) },
    OWNER,
  );
  assert.equal(valid.data, `0xa9059cbb${OWNER.slice(2).padStart(64, '0')}${'f'.repeat(64)}`);
});

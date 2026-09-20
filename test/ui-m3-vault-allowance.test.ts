import test from 'node:test';
import assert from 'node:assert/strict';
import { readM3VaultDepositAuthorization, M3AllowanceFailure } from '../apps/web/src/m3-vault-allowance.ts';
import type { Eip1193Provider, Eip1193Request } from '../apps/web/src/chain-wallet.ts';
import { asAddress, asHexData } from '../packages/chain-adapter/src/types.ts';

const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const VAULT = asAddress('0x2222222222222222222222222222222222222222');
const USDC = asAddress('0x3333333333333333333333333333333333333333');
const PASS = asAddress('0x4444444444444444444444444444444444444444');

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function addressResult(value: string): string {
  return `0x${value.slice(2).padStart(64, '0')}`;
}

class AllowanceProvider implements Eip1193Provider {
  readonly requests: Eip1193Request[] = [];
  readonly listeners = new Map<string, Set<(value: unknown) => void>>();
  usdcAllowance = 0n;
  passAllowance = 2_000_000_000_000_000_000n;

  on(event: string, listener: (value: unknown) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  removeListener(event: string, listener: (value: unknown) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
  async request(input: Eip1193Request): Promise<unknown> {
    this.requests.push(input);
    if (input.method === 'eth_chainId') return '0xb626';
    if (input.method === 'eth_accounts') return [OWNER];
    if (input.method !== 'eth_call') throw new Error('unexpected request');
    const transaction = input.params?.[0] as { to: string; data: string };
    if (transaction.to === VAULT && transaction.data === '0x8b5a851f') return addressResult(USDC);
    if (transaction.to === VAULT && transaction.data === '0xa7a1ed72') return addressResult(PASS);
    if (transaction.to === USDC && transaction.data.startsWith('0xdd62ed3e'))
      return asHexData(`0x${word(this.usdcAllowance)}`);
    if (transaction.to === PASS && transaction.data.startsWith('0xdd62ed3e'))
      return asHexData(`0x${word(this.passAllowance)}`);
    throw new Error('unexpected eth_call');
  }
}

test('live deposit authorization reads Vault token identities and both exact owner allowances', async () => {
  const provider = new AllowanceProvider();
  const authorization = await readM3VaultDepositAuthorization(provider, {
    chainId: 46_630,
    vault: VAULT,
    owner: OWNER,
    usdcBaseUnits: '1000000',
  });
  assert.deepEqual(authorization.summary, {
    vault: VAULT,
    owner: OWNER,
    afUsdc: USDC,
    pass: PASS,
    requiredUsdcBaseUnits: '1000000',
    requiredPassRaw: '1000000000000000000',
    usdcAllowance: '0',
    passAllowance: '2000000000000000000',
    usdcSufficient: false,
    passSufficient: true,
  });
  assert.deepEqual(provider.requests, [
    { method: 'eth_chainId' },
    { method: 'eth_accounts' },
    { method: 'eth_call', params: [{ to: VAULT, data: '0x8b5a851f' }, 'latest'] },
    { method: 'eth_call', params: [{ to: VAULT, data: '0xa7a1ed72' }, 'latest'] },
    {
      method: 'eth_call',
      params: [
        {
          to: USDC,
          data: `0xdd62ed3e${OWNER.slice(2).padStart(64, '0')}${VAULT.slice(2).padStart(64, '0')}`,
        },
        'latest',
      ],
    },
    {
      method: 'eth_call',
      params: [
        {
          to: PASS,
          data: `0xdd62ed3e${OWNER.slice(2).padStart(64, '0')}${VAULT.slice(2).padStart(64, '0')}`,
        },
        'latest',
      ],
    },
    { method: 'eth_accounts' },
    { method: 'eth_chainId' },
  ]);
});

test('approval factories fix token, spender and exact finite requirement with no arbitrary target', async () => {
  const authorization = await readM3VaultDepositAuthorization(new AllowanceProvider(), {
    chainId: 46_630,
    vault: VAULT,
    owner: OWNER,
    usdcBaseUnits: '1000000',
  });
  const usdc = authorization.usdcApproval.factory.prepare({ operationId: 'approve-usdc-1' }, OWNER);
  const pass = authorization.passApproval.factory.prepare({ operationId: 'approve-pass-1' }, OWNER);
  assert.equal(usdc.target, USDC);
  assert.equal(pass.target, PASS);
  assert.equal(usdc.value, 0n);
  assert.equal(pass.value, 0n);
  assert.equal(usdc.data, `0x095ea7b3${VAULT.slice(2).padStart(64, '0')}${word(1_000_000n)}`);
  assert.equal(pass.data, `0x095ea7b3${VAULT.slice(2).padStart(64, '0')}${word(1_000_000_000_000_000_000n)}`);
  assert.equal('spender' in authorization.usdcApproval.factory, false);
  assert.throws(
    () => authorization.usdcApproval.factory.prepare({ operationId: 'foreign-owner' }, VAULT),
    (error: unknown) => error instanceof M3AllowanceFailure && error.code === 'M3_ALLOWANCE_OWNER_CHANGED',
  );
});

test('allowance reads fail closed when the wallet session changes during live reads', async () => {
  const provider = new AllowanceProvider();
  const request = provider.request.bind(provider);
  provider.request = async (input) => {
    const result = await request(input);
    if (input.method === 'eth_call') provider.emit('chainChanged', '0x1');
    return result;
  };
  await assert.rejects(
    () =>
      readM3VaultDepositAuthorization(provider, {
        chainId: 46_630,
        vault: VAULT,
        owner: OWNER,
        usdcBaseUnits: '1',
      }),
    (error: unknown) => error instanceof M3AllowanceFailure && error.code === 'M3_ALLOWANCE_SESSION_CHANGED',
  );
  assert.equal(
    [...provider.listeners.values()].every((listeners) => listeners.size === 0),
    true,
  );
});

test('allowance reads fail closed on wrong chain, malformed responses and overflowed Pass requirement', async () => {
  const provider = new AllowanceProvider();
  provider.request = async (input) => (input.method === 'eth_chainId' ? '0x1' : '0x');
  await assert.rejects(
    () =>
      readM3VaultDepositAuthorization(provider, {
        chainId: 46_630,
        vault: VAULT,
        owner: OWNER,
        usdcBaseUnits: '1',
      }),
    (error: unknown) => error instanceof M3AllowanceFailure && error.code === 'M3_ALLOWANCE_WRONG_CHAIN',
  );

  await assert.rejects(
    () =>
      readM3VaultDepositAuthorization(new AllowanceProvider(), {
        chainId: 46_630,
        vault: VAULT,
        owner: OWNER,
        usdcBaseUnits: `${1n << 244n}`,
      }),
    (error: unknown) => error instanceof M3AllowanceFailure && error.code === 'M3_ALLOWANCE_INVALID_AMOUNT',
  );
});

test('allowance input rejects zero, malformed and out-of-range chain quantities', async () => {
  await assert.rejects(
    readM3VaultDepositAuthorization(new AllowanceProvider(), {
      chainId: 46_630,
      vault: VAULT,
      owner: OWNER,
      usdcBaseUnits: '0',
    }),
    (error: unknown) => error instanceof M3AllowanceFailure && error.code === 'M3_ALLOWANCE_INVALID_AMOUNT',
  );

  for (const value of [1, '0x01', '0x0', `0x${'f'.repeat(32)}`] as const) {
    const provider = new AllowanceProvider();
    provider.request = async (input) => (input.method === 'eth_chainId' ? value : [OWNER]);
    await assert.rejects(
      readM3VaultDepositAuthorization(provider, {
        chainId: 46_630,
        vault: VAULT,
        owner: OWNER,
        usdcBaseUnits: '1',
      }),
      (error: unknown) => error instanceof M3AllowanceFailure && error.code === 'M3_ALLOWANCE_READ_FAILED',
    );
  }
});

test('allowance reads bind both initial and final owner observations', async () => {
  const cases: Array<{ accounts: readonly unknown[][]; code: M3AllowanceFailure['code'] }> = [
    { accounts: [[], [OWNER]], code: 'M3_ALLOWANCE_OWNER_CHANGED' },
    { accounts: [['invalid'], [OWNER]], code: 'M3_ALLOWANCE_READ_FAILED' },
    { accounts: [[VAULT], [VAULT]], code: 'M3_ALLOWANCE_OWNER_CHANGED' },
    { accounts: [[OWNER], []], code: 'M3_ALLOWANCE_OWNER_CHANGED' },
    { accounts: [[OWNER], ['invalid']], code: 'M3_ALLOWANCE_READ_FAILED' },
    { accounts: [[OWNER], [VAULT]], code: 'M3_ALLOWANCE_OWNER_CHANGED' },
  ];
  for (const item of cases) {
    const provider = new AllowanceProvider();
    const request = provider.request.bind(provider);
    let reads = 0;
    provider.request = (input) => {
      if (input.method === 'eth_accounts') return Promise.resolve(item.accounts[Math.min(reads++, 1)]);
      return request(input);
    };
    await assert.rejects(
      readM3VaultDepositAuthorization(provider, {
        chainId: 46_630,
        vault: VAULT,
        owner: OWNER,
        usdcBaseUnits: '1',
      }),
      (error: unknown) => error instanceof M3AllowanceFailure && error.code === item.code,
    );
  }
});

test('allowance provider and listener failures remain sanitized and cleanup is best effort', async () => {
  const listenerFailure = new AllowanceProvider();
  listenerFailure.on = () => {
    throw new Error('listener detail');
  };
  await assert.rejects(
    readM3VaultDepositAuthorization(listenerFailure, {
      chainId: 46_630,
      vault: VAULT,
      owner: OWNER,
      usdcBaseUnits: '1',
    }),
    /M3_ALLOWANCE_READ_FAILED/,
  );

  for (const error of [new Error('provider detail'), new M3AllowanceFailure('M3_ALLOWANCE_READ_FAILED')]) {
    const provider = new AllowanceProvider();
    const request = provider.request.bind(provider);
    provider.request = (input) => (input.method === 'eth_call' ? Promise.reject(error) : request(input));
    await assert.rejects(
      readM3VaultDepositAuthorization(provider, {
        chainId: 46_630,
        vault: VAULT,
        owner: OWNER,
        usdcBaseUnits: '1',
      }),
      /M3_ALLOWANCE_READ_FAILED/,
    );
  }

  const cleanupFailure = new AllowanceProvider();
  cleanupFailure.removeListener = () => {
    throw new Error('cleanup detail');
  };
  const result = await readM3VaultDepositAuthorization(cleanupFailure, {
    chainId: 46_630,
    vault: VAULT,
    owner: OWNER,
    usdcBaseUnits: '1',
  });
  assert.equal(result.summary.owner, OWNER);
});

test('unexpected option access is converted to the public allowance failure', async () => {
  const options = new Proxy(
    { chainId: 46_630, vault: VAULT, owner: OWNER, usdcBaseUnits: '1' },
    {
      get(target, property, receiver) {
        if (property === 'chainId') throw new Error('private option detail');
        return Reflect.get(target, property, receiver);
      },
    },
  );
  await assert.rejects(
    readM3VaultDepositAuthorization(new AllowanceProvider(), options),
    (error: unknown) =>
      error instanceof M3AllowanceFailure &&
      error.code === 'M3_ALLOWANCE_READ_FAILED' &&
      !error.message.includes('private'),
  );
});

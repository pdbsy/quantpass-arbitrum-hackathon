import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEPLOYMENT_APPROVAL } from '../apps/web/src/deployment-approval.ts';
import {
  DEPLOYMENT_ADMIN,
  DEPLOYMENT_WALLET_LOCK,
  DeploymentWalletSession,
  parsePinnedDeploymentPayload,
  validateDeploymentPayload,
  withDeploymentWalletLock,
  type DeploymentJournal,
  type DeploymentLockManager,
  type DeploymentPayload,
  type DeploymentProvider,
} from '../apps/web/src/deployment-wallet.ts';

// Only a deterministic EIP-1193 fixture is used: no real wallet, RPC, identity, or transaction broadcast.
const publicBytes = readFileSync(new URL('../docs/deployment-approved.json', import.meta.url));
const approved = await parsePinnedDeploymentPayload(publicBytes, DEPLOYMENT_APPROVAL.payloadSha256);
const hex = (value: bigint | number) => '0x' + BigInt(value).toString(16);
const hash = (value: bigint | number) => '0x' + BigInt(value).toString(16).padStart(64, '0');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
class MockProvider implements DeploymentProvider {
  time = approved.approvalExpiresAt - 1000;
  chain = 46630n;
  wallet = DEPLOYMENT_ADMIN;
  head = 100n;
  latest = 0n;
  pending = 0n;
  balance = 20000000000000000n;
  estimate = 8946265n;
  executionLimit = 32000000n;
  baseFee = 1000000n;
  occupiedAdmin = false;
  occupiedTarget = false;
  canonicalChanged = false;
  walletError: unknown = null;
  walletReturn: unknown = undefined;
  switchError: unknown = null;
  switchCount = 0;
  calls: { method: string; params?: readonly unknown[] }[] = [];
  sends: Record<string, unknown>[] = [];
  transactions = new Map<string, Record<string, unknown>>();
  receipts = new Map<string, Record<string, unknown>>();
  deployed = new Set<string>();
  hook: ((method: string, params: readonly unknown[] | undefined) => void | Promise<void>) | null = null;
  async request(input: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push(input);
    await this.hook?.(input.method, input.params);
    const params = input.params ?? [];
    switch (input.method) {
      case 'eth_chainId':
        return hex(this.chain);
      case 'eth_accounts':
      case 'eth_requestAccounts':
        return [this.wallet];
      case 'wallet_switchEthereumChain':
        this.switchCount++;
        if (this.switchError) throw this.switchError;
        this.chain = 46630n;
        return null;
      case 'wallet_addEthereumChain':
        this.switchError = null;
        return null;
      case 'eth_getTransactionCount':
        return hex(params[1] === 'latest' ? this.latest : this.pending);
      case 'eth_getBalance':
        return hex(this.balance);
      case 'eth_gasPrice':
        return hex(this.baseFee);
      case 'eth_getCode':
        if (String(params[0]).toLowerCase() === DEPLOYMENT_ADMIN) return this.occupiedAdmin ? '0x6000' : '0x';
        return this.occupiedTarget || this.deployed.has(String(params[0]).toLowerCase()) ? '0x6000' : '0x';
      case 'eth_call':
        assert.deepEqual(params[0], { to: '0x000000000000000000000000000000000000006c', data: '0x612af178' });
        return (
          '0x' +
          [100000000n, 100000000n, this.executionLimit]
            .map((value) => value.toString(16).padStart(64, '0'))
            .join('')
        );
      case 'eth_getBlockByNumber': {
        const number = params[0] === 'latest' ? this.head : BigInt(String(params[0]));
        return {
          number: hex(number),
          hash: hash(this.canonicalChanged ? number + 100000n : number),
          timestamp: hex(this.time),
          gasLimit: hex(1000000000n),
          baseFeePerGas: hex(this.baseFee),
        };
      }
      case 'eth_estimateGas':
        return hex(this.estimate);
      case 'eth_getTransactionByHash':
        return this.transactions.get(String(params[0])) ?? null;
      case 'eth_getTransactionReceipt':
        return this.receipts.get(String(params[0])) ?? null;
      case 'eth_sendTransaction': {
        const sent = copy(params[0]) as Record<string, unknown>;
        this.sends.push(sent);
        if (this.walletError) throw this.walletError;
        const index = Number(BigInt(String(sent.nonce))),
          action = approved.plan.actions.filter((value) => value.unsigned !== null)[index]!;
        const transactionHash = hash(index + 1000),
          blockHash = hash(this.head),
          blockNumber = hex(this.head);
        this.transactions.set(transactionHash, {
          ...sent,
          to: sent.to ?? null,
          input: sent.data,
          hash: transactionHash,
          blockNumber,
          blockHash,
          accessList: [],
        });
        this.receipts.set(transactionHash, {
          transactionHash,
          from: sent.from,
          to: sent.to ?? null,
          contractAddress: sent.to ? null : action.contractAddress,
          status: '0x1',
          blockNumber,
          blockHash,
          gasUsed: hex(this.estimate),
          effectiveGasPrice: hex(this.baseFee),
        });
        if (!sent.to) this.deployed.add(action.contractAddress.toLowerCase());
        this.latest = BigInt(index + 1);
        this.pending = this.latest;
        return this.walletReturn === undefined ? transactionHash : this.walletReturn;
      }
      default:
        throw new Error('UNEXPECTED_MOCK_RPC:' + input.method);
    }
  }
}
function fixture(
  options: {
    save?: (journal: DeploymentJournal) => void;
    payload?: DeploymentPayload;
    journal?: DeploymentJournal;
    provider?: MockProvider;
  } = {},
) {
  const provider = options.provider ?? new MockProvider();
  let saved: DeploymentJournal | undefined;
  const session = new DeploymentWalletSession({
    provider,
    payload: options.payload ?? approved,
    payloadSha256: DEPLOYMENT_APPROVAL.payloadSha256,
    now: () => provider.time,
    save: (journal) => {
      options.save?.(journal);
      saved = copy(journal);
    },
    ...(options.journal ? { journal: options.journal } : {}),
  });
  return { provider, session, saved: () => saved };
}

test('exact approved public bytes are pinned; changed bytes, roles, supply and gas boundaries reject', async () => {
  assert.equal(approved.budget.maxGasPerTransactionRaw, '12000000');
  const changed = Uint8Array.from(publicBytes);
  changed[100] = changed[100]! ^ 1;
  await assert.rejects(
    parsePinnedDeploymentPayload(changed, DEPLOYMENT_APPROVAL.payloadSha256),
    /DIGEST_MISMATCH/,
  );
  for (const mutate of [
    (payload: DeploymentPayload) => {
      payload.plan.inputs.amznLpRecipient = '0x5a2acf1a388fe4f19aeffa404e07e916b5b07b77';
    },
    (payload: DeploymentPayload) => {
      payload.plan.inputs.usdcSupplyRaw = '2000000000001';
    },
    (payload: DeploymentPayload) => {
      payload.budget.maxGasPerTransactionRaw = '12000001';
    },
    (payload: DeploymentPayload) => {
      payload.budget.maxTotalGasCostWei = '10000000000000001';
    },
    (payload: DeploymentPayload) => {
      payload.plan.actions[0]!.nonce = 1;
    },
  ]) {
    const payload = copy(approved);
    mutate(payload);
    assert.throws(() => validateDeploymentPayload(payload));
  }
});

test('one wallet prompt has explicit chain/nonce/gas/fees, durable intent, and three inclusive canonical blocks before next', async () => {
  let sawIntent = false;
  const files = fixture({
    save: (journal) => {
      if (journal.entries.at(-1)?.state === 'INTENT') sawIntent = true;
    },
  });
  files.provider.hook = (method) => {
    if (method === 'eth_sendTransaction') assert.equal(sawIntent, true);
  };
  await files.session.connect();
  await files.session.sendNext();
  assert.equal(files.provider.sends.length, 1);
  const sent = files.provider.sends[0]!;
  assert.equal(sent.chainId, '0xb626');
  assert.equal(sent.nonce, '0x0');
  assert.equal(sent.maxPriorityFeePerGas, '0x0');
  assert.equal(sent.maxFeePerGas, hex(20000000n));
  assert.equal(sent.gas, hex(10735518n));
  assert.equal(sent.to, undefined);
  assert.equal(files.session.journal.entries[0]!.state, 'INCLUDED');
  await assert.rejects(files.session.sendNext(), /RECOVERY_REQUIRED/);
  assert.equal(files.provider.sends.length, 1);
  files.provider.head = 101n;
  await files.session.reconcile();
  assert.equal(files.session.journal.entries[0]!.state, 'INCLUDED');
  files.provider.head = 102n;
  await files.session.reconcile();
  assert.equal(files.session.journal.entries[0]!.state, 'CONFIRMED');
  await files.session.sendNext();
  assert.equal(files.provider.sends.length, 2);
  assert.equal(files.provider.sends[1]!.nonce, '0x1');
});

test('explicit Connect switches network, only 4902 adds the official network, and rejected switch never sends', async () => {
  const files = fixture();
  files.provider.chain = 1n;
  await files.session.connect();
  assert.equal(files.provider.chain, 46630n);
  assert.equal(files.provider.switchCount, 1);
  assert.equal(
    files.provider.calls.some((call) => call.method === 'wallet_addEthereumChain'),
    false,
  );
  const missing = fixture();
  missing.provider.chain = 1n;
  missing.provider.switchError = { code: 4902 };
  await missing.session.connect();
  const add = missing.provider.calls.find((call) => call.method === 'wallet_addEthereumChain')!.params![0];
  assert.deepEqual(add, {
    chainId: '0xb626',
    chainName: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
    blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
  });
  assert.equal(missing.provider.switchCount, 2);
  const rejected = fixture();
  rejected.provider.chain = 1n;
  rejected.provider.switchError = { code: 4001 };
  await assert.rejects(rejected.session.connect());
  assert.equal(rejected.provider.sends.length, 0);
  assert.equal(
    rejected.provider.calls.some((call) => call.method === 'wallet_addEthereumChain'),
    false,
  );
  await assert.rejects(rejected.session.sendNext(), /WRONG_NETWORK/);
  assert.equal(rejected.provider.switchCount, 1);
});

test('wrong wallet, nonce competition, funds, gas, real execution limit, EOA and CREATE collision stop before wallet', async () => {
  for (const [configure, reason] of [
    [
      (provider: MockProvider) => {
        provider.wallet = '0x5a2acf1a388fe4f19aeffa404e07e916b5b07b77';
      },
      /WRONG_WALLET/,
    ],
    [
      (provider: MockProvider) => {
        provider.pending = 1n;
      },
      /NONCE_COMPETITION/,
    ],
    [
      (provider: MockProvider) => {
        provider.balance = 1n;
      },
      /INSUFFICIENT_ETH/,
    ],
    [
      (provider: MockProvider) => {
        provider.estimate = 12000001n;
      },
      /GAS_LIMIT/,
    ],
    [
      (provider: MockProvider) => {
        provider.executionLimit = 8000000n;
      },
      /EXECUTION_GAS_LIMIT/,
    ],
    [
      (provider: MockProvider) => {
        provider.occupiedAdmin = true;
      },
      /ADMIN_MUST_BE_EOA/,
    ],
    [
      (provider: MockProvider) => {
        provider.occupiedTarget = true;
      },
      /CREATE_ADDRESS_OCCUPIED/,
    ],
    [
      (provider: MockProvider) => {
        provider.baseFee = 20000001n;
      },
      /FEE_CAP_TOO_LOW/,
    ],
  ] as const) {
    const files = fixture();
    configure(files.provider);
    await assert.rejects(files.session.sendNext(), reason);
    assert.equal(files.provider.sends.length, 0);
  }
});

test('async precheck and durable storage crossing expiry retain intent and never request a new signature', async () => {
  for (const crossDuringStorage of [false, true]) {
    const files = fixture({
      save: (journal) => {
        if (crossDuringStorage && journal.entries.at(-1)?.state === 'INTENT')
          files.provider.time = approved.approvalExpiresAt;
      },
    });
    files.provider.hook = (method) => {
      if (!crossDuringStorage && method === 'eth_estimateGas')
        files.provider.time = approved.approvalExpiresAt;
    };
    await assert.rejects(files.session.sendNext(), /APPROVAL_EXPIRED/);
    assert.equal(files.provider.sends.length, 0);
    assert.equal(files.saved()!.entries[0]!.state, 'INTENT');
    await assert.rejects(files.session.sendNext(), /RECOVERY_REQUIRED/);
    assert.equal(files.provider.sends.length, 0);
  }
});

test('balance, fee, nonce and confirmation anchor changing during estimation are rechecked before the wallet prompt', async () => {
  for (const [change, reason] of [
    [
      (provider: MockProvider) => {
        provider.balance = 0n;
      },
      /INSUFFICIENT_ETH/,
    ],
    [
      (provider: MockProvider) => {
        provider.baseFee = 20000001n;
      },
      /FEE_CAP_TOO_LOW/,
    ],
    [
      (provider: MockProvider) => {
        provider.pending = 1n;
      },
      /NONCE_COMPETITION/,
    ],
  ] as const) {
    const files = fixture();
    files.provider.hook = (method) => {
      if (method === 'eth_estimateGas') change(files.provider);
    };
    await assert.rejects(files.session.sendNext(), reason);
    assert.equal(files.provider.sends.length, 0);
  }
  const files = fixture();
  await files.session.sendNext();
  files.provider.head = 102n;
  await files.session.reconcile();
  files.provider.hook = (method) => {
    if (method === 'eth_estimateGas') files.provider.canonicalChanged = true;
  };
  await assert.rejects(files.session.sendNext(), /RECOVERY_REQUIRED/);
  assert.equal(files.provider.sends.length, 1);
});

test('uncertain wallet result never resends; manually supplied actual hash must match chain fields', async () => {
  const files = fixture();
  files.provider.walletReturn = 'not-a-hash';
  await assert.rejects(files.session.sendNext(), /WALLET_RESULT_UNKNOWN/);
  assert.equal(files.session.journal.entries[0]!.state, 'UNKNOWN');
  await assert.rejects(files.session.sendNext(), /RECOVERY_REQUIRED/);
  await assert.rejects(files.session.recover(hash(99999)), /RECOVERY_NOT_VERIFIED/);
  files.provider.head = 102n;
  await files.session.recover(hash(1000));
  assert.equal(files.session.nextIndex, 1);
  assert.equal(files.provider.sends.length, 1);
  assert.throws(() => files.session.verificationReceipts(), /ALL_RECEIPTS_REQUIRED/);
});

test('mutated chain transaction fields, revert and reorg invalidate saved confirmations', async () => {
  for (const [field, value] of [
    ['nonce', '0x1'],
    ['value', '0x1'],
    ['gas', '0x1'],
    ['input', '0x6000'],
    ['chainId', '0x1'],
    ['maxFeePerGas', '0x1'],
    ['to', DEPLOYMENT_ADMIN],
  ] as const) {
    const files = fixture();
    await files.session.sendNext();
    files.provider.transactions.get(hash(1000))![field] = value;
    await assert.rejects(files.session.reconcile(), /TRANSACTION_MISMATCH/);
    assert.equal(files.provider.sends.length, 1);
  }
  const reverted = fixture();
  await reverted.session.sendNext();
  reverted.provider.receipts.get(hash(1000))!.status = '0x0';
  await reverted.session.reconcile();
  assert.equal(reverted.session.journal.entries[0]!.state, 'REVERTED');
  await assert.rejects(reverted.session.sendNext(), /RECOVERY_REQUIRED/);
  const reorg = fixture();
  await reorg.session.sendNext();
  reorg.provider.head = 102n;
  await reorg.session.reconcile();
  const restored = fixture({ provider: reorg.provider, journal: reorg.session.journal });
  reorg.provider.canonicalChanged = true;
  await restored.session.reconcile();
  assert.equal(restored.session.journal.entries[0]!.state, 'REORGED');
  await assert.rejects(restored.session.sendNext(), /RECOVERY_REQUIRED/);
  assert.equal(reorg.provider.sends.length, 1);
});

test('durable storage failure cannot prompt before intent, and cannot prompt again after a returned actual hash', async () => {
  const before = fixture({
    save: () => {
      throw new Error('fixture full');
    },
  });
  await assert.rejects(before.session.sendNext(), /RECOVERY_STORAGE_FAILED/);
  assert.equal(before.provider.sends.length, 0);
  const after = fixture({
    save: (journal) => {
      if (journal.entries.at(-1)?.transactionHash) throw new Error('fixture full');
    },
  });
  await assert.rejects(after.session.sendNext(), /RECOVERY_STORAGE_FAILED/);
  assert.equal(after.provider.sends.length, 1);
  assert.equal(after.session.lastObservedHash, hash(1000));
  assert.equal(after.saved()!.entries[0]!.transactionHash, null);
  assert.equal(after.saved()!.entries[0]!.state, 'INTENT');
  await assert.rejects(after.session.sendNext(), /RECOVERY_STORAGE_FAILED/);
  assert.equal(after.provider.sends.length, 1);
  const restarted = fixture({ provider: after.provider, journal: after.saved()! });
  await assert.rejects(restarted.session.sendNext(), /RECOVERY_REQUIRED/);
  assert.equal(after.provider.sends.length, 1);
  after.provider.head = 102n;
  await restarted.session.recover(hash(1000));
  assert.equal(restarted.session.nextIndex, 1);
});

class MockLocks implements DeploymentLockManager {
  held = false;
  names: string[] = [];
  async request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    work: (lock: unknown | null) => Promise<T>,
  ): Promise<T> {
    this.names.push(name);
    assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
    if (this.held) return work(null);
    this.held = true;
    try {
      return await work({ name });
    } finally {
      this.held = false;
    }
  }
}
test('a global wallet lock prevents two prompts across tabs and reloads durable intent under the lock', async () => {
  const locks = new MockLocks(),
    provider = new MockProvider();
  let durable: DeploymentJournal | undefined;
  let release: () => void = () => {};
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  provider.hook = async (method) => {
    if (method === 'eth_sendTransaction') await pause;
  };
  const openTab = () =>
    withDeploymentWalletLock(locks, async () => {
      const files = fixture({
        provider,
        ...(durable ? { journal: durable } : {}),
        save: (journal) => {
          durable = copy(journal);
        },
      });
      return files.session.sendNext();
    });
  const first = openTab();
  while (!provider.calls.some((call) => call.method === 'eth_sendTransaction'))
    await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(openTab(), /ANOTHER_TAB_ACTIVE/);
  release();
  await first;
  await assert.rejects(openTab(), /RECOVERY_REQUIRED/);
  assert.equal(provider.sends.length, 1);
  assert.equal(
    locks.names.every((name) => name === DEPLOYMENT_WALLET_LOCK),
    true,
  );
  assert.equal(DEPLOYMENT_WALLET_LOCK.includes(DEPLOYMENT_APPROVAL.payloadSha256), false);
  await assert.rejects(
    withDeploymentWalletLock(undefined, async () => {}),
    /BROWSER_LOCKS_REQUIRED/,
  );
});

test('all 41 actual matched receipts are required before exporting hashes; saved hints alone are rechecked', async () => {
  const files = fixture();
  files.provider.estimate = 100000n;
  for (let index = 0; index < 41; index++) {
    await files.session.sendNext();
    files.provider.head += 2n;
    await files.session.reconcile();
  }
  assert.equal(files.provider.sends.length, 41);
  assert.deepEqual(files.session.verificationReceipts(), {
    schemaVersion: 1,
    payloadSha256: DEPLOYMENT_APPROVAL.payloadSha256,
    chainId: 46630,
    transactions: Array.from({ length: 41 }, (_, index) => hash(index + 1000)),
  });
  await assert.rejects(files.session.sendNext(), /PLAN_FINISHED/);
  assert.equal(files.provider.sends.length, 41);
  files.provider.transactions.delete(hash(1000));
  await files.session.reconcile();
  assert.throws(() => files.session.verificationReceipts(), /ALL_RECEIPTS_REQUIRED/);
});

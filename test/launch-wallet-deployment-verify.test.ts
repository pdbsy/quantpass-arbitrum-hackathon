import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Interface, JsonRpcProvider, Wallet, toBeHex, keccak256 } from 'ethers';
import { prepareDeployment, type DeploymentInputs } from '../tools/launch-market/prepare.ts';
import { validateManifest } from '../packages/launch-market/src/config.ts';
import {
  verifyWalletDeployment,
  verifyRuntimeIdentity,
  walletDeploymentReadonlyRpc,
  walletDeploymentVerifyCli,
  type DeploymentVerificationRpc,
  type WalletDeploymentPayload,
} from '../tools/launch-market/wallet-deployment-verify.ts';

const address = (n: number) => '0x' + n.toString(16).padStart(40, '0');
function inputs(owner = address(1)): DeploymentInputs {
  return {
    chainId: 46630,
    deployer: owner,
    administrator: owner,
    nonce: 0,
    quoteSigner: address(2),
    claimSigner: address(3),
    tslaLpRecipient: owner,
    amznLpRecipient: owner,
    usdcSupplyRaw: '2000000000000',
    conversionUsdcRaw: '100000000000',
    conversionEthRaw: '2000000000000000',
    stockReserveUsdcRaw: '100000000000',
    stockReserveUnitsRaw: '500000000000000000000000',
    ethPerTransactionRaw: '200000000000000',
    ethPerAccountDailyRaw: '1000000000000000',
    ethGlobalDailyRaw: '1600000000000000',
    ethMinimumReserveRaw: '200000000000000',
  };
}
const budget = {
  maxGasPerTransactionRaw: '12000000',
  maxFeePerGasRaw: '20000000',
  maxPriorityFeePerGasRaw: '0',
  maxTotalGasCostWei: '10000000000000000',
  maxTotalNativeValueWei: '2000000000000000',
  minimumRemainingEthRaw: '500000000000000',
  maxHeadAgeSeconds: 60,
};
async function payload(owner = address(1)): Promise<WalletDeploymentPayload> {
  return {
    schemaVersion: 1,
    chainId: 46630,
    approvedWallet: owner,
    approvalExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    plan: await prepareDeployment(inputs(owner)),
    budget,
  };
}
const hashes = Array.from(
  { length: 41 },
  (_, i) =>
    '0x' +
    BigInt(i + 1)
      .toString(16)
      .padStart(64, '0'),
);

test('receipt CLI transport is pinned to official chain and cannot discover, sign or broadcast accounts', async () => {
  let calls = 0;
  const rpc = walletDeploymentReadonlyRpc(undefined, async () => {
    calls++;
    throw new Error('NETWORK_NOT_EXPECTED');
  });
  for (const method of [
    'eth_accounts',
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'personal_sign',
    'eth_signTypedData_v4',
    'anvil_setBalance',
    'eth_getLogs',
  ])
    await assert.rejects(rpc.request(method, []), /WALLET_DEPLOYMENT_RPC_METHOD/);
  assert.equal(calls, 0);
  assert.throws(() => walletDeploymentReadonlyRpc('http://127.0.0.1:8545' as never), /RPC_ENDPOINT/);
});

test('production CLI rejects a replacement approval payload before any RPC or manifest write', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'af-wallet-verification-pin-'));
  const approvedFile = join(dir, 'replacement.json');
  const hashesFile = join(dir, 'hashes.json');
  const output = join(dir, 'manifest.json');
  const rpcSpy = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('RPC_MUST_NOT_RUN');
  });
  const errorSpy = t.mock.method(console, 'error', () => undefined);
  try {
    // A structurally valid local fixture still has no authority to replace the published approval.
    await writeFile(approvedFile, JSON.stringify(await payload()) + '\n', { mode: 0o600 });
    await writeFile(hashesFile, JSON.stringify(hashes) + '\n', { mode: 0o600 });
    assert.equal(await walletDeploymentVerifyCli([approvedFile, hashesFile, output]), 1);
    assert.equal(rpcSpy.mock.callCount(), 0);
    assert.deepEqual(
      errorSpy.mock.calls.map((call) => call.arguments),
      [['WALLET_DEPLOYMENT_VERIFICATION_REJECTED']],
    );
    await assert.rejects(access(output), { code: 'ENOENT' });
    await assert.rejects(access(output + '.verification.json'), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime identity masks only compiler-declared 32-byte immutable ranges and hashes actual bytes', () => {
  const object = '0x60' + '00'.repeat(32) + '00';
  const compiled = {
    abi: [],
    bytecode: { object: '0x00' },
    deployedBytecode: { object, immutableReferences: { '1': [{ start: 1, length: 32 }] } },
  };
  const real = '0x60' + '11'.repeat(32) + '00';
  assert.equal(verifyRuntimeIdentity(real, compiled), keccak256(real));
  assert.notEqual(verifyRuntimeIdentity(real, compiled), keccak256(object));
  assert.throws(() => verifyRuntimeIdentity('0x61' + real.slice(4), compiled), /RUNTIME_IDENTITY/);
  assert.throws(() => verifyRuntimeIdentity('0x', compiled), /RUNTIME_IDENTITY/);
  for (const ref of [
    { start: 1, length: 31 },
    { start: 34, length: 32 },
    { start: -1, length: 32 },
  ])
    assert.throws(
      () =>
        verifyRuntimeIdentity(real, {
          ...compiled,
          deployedBytecode: { object, immutableReferences: { '1': [ref] } },
        }),
      /IMMUTABLE_REFERENCES/,
    );
});

test('approved exact plan, signer isolation, finite budget and hash cardinality fail closed before RPC', async () => {
  const p = await payload();
  const rpc: DeploymentVerificationRpc = {
    request: async () => {
      throw new Error('UNEXPECTED_RPC');
    },
  };
  const changed = structuredClone(p);
  changed.plan.addresses.claim = address(42);
  await assert.rejects(verifyWalletDeployment(changed, hashes, rpc), /PLAN_MISMATCH/);
  await assert.rejects(
    verifyWalletDeployment({ ...p, approvedWallet: address(42) }, hashes, rpc),
    /APPROVED_WALLET/,
  );
  const userRole = structuredClone(p);
  userRole.plan = await prepareDeployment({
    ...inputs(),
    quoteSigner: '0x5a2acf1a388fe4f19aeffa404e07e916b5b07b77',
  });
  await assert.rejects(verifyWalletDeployment(userRole, hashes, rpc), /ORDINARY_USER_ROLE/);
  const sameSigner = structuredClone(p);
  sameSigner.plan = await prepareDeployment({ ...inputs(), claimSigner: address(2) });
  await assert.rejects(verifyWalletDeployment(sameSigner, hashes, rpc), /VOUCHER_SIGNER_ROLE/);
  await assert.rejects(
    verifyWalletDeployment({ ...p, budget: { ...budget, maxTotalGasCostWei: '1' } }, hashes, rpc),
    /BUDGET/,
  );
  await assert.rejects(verifyWalletDeployment(p, hashes.slice(1), rpc), /HASH_LIST/);
  await assert.rejects(
    verifyWalletDeployment(
      p,
      hashes.map(() => hashes[0]),
      rpc,
    ),
    /DUPLICATE_HASH/,
  );
  await assert.rejects(
    verifyWalletDeployment(
      p,
      { schemaVersion: 1, chainId: 46630, payloadSha256: 'a'.repeat(64), transactions: hashes },
      rpc,
      { payloadSha256: 'b'.repeat(64) },
    ),
    /EXPORTED_PAYLOAD_BINDING/,
  );
});

test(
  'actual 41-transaction local EVM initialization yields actual manifest and rejects damaged receipt evidence',
  { timeout: 180_000, skip: !process.env.AF_WALLET_VERIFY_LOCAL_RPC },
  async (t) => {
    const rpcUrl = process.env.AF_WALLET_VERIFY_LOCAL_RPC!;
    const url = new URL(rpcUrl);
    assert.equal(url.protocol, 'http:');
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1, batchStallTime: 1 });
    provider.pollingInterval = 10;
    try {
      assert.match(String(await provider.send('web3_clientVersion', [])), /anvil\/v1\.5\.1/);
      assert.equal(BigInt(await provider.send('eth_chainId', [])), 46630n);
      // Random key is local-only, memory-only and never a deployment credential for the target network.
      const wallet = Wallet.createRandom().connect(provider);
      await provider.send('anvil_setBalance', [wallet.address, toBeHex(100n * 10n ** 18n)]);
      const p = await payload(wallet.address);
      const executable = (
        p.plan.actions as { unsigned: { to: string | null; data: string; value: string } | null }[]
      ).filter((a) => a.unsigned);
      const actualHashes: string[] = [];
      for (const [index, action] of executable.entries()) {
        const unsigned = action.unsigned!;
        await provider.send('anvil_setNextBlockBaseFeePerGas', ['0x989680']);
        const estimated = await provider.estimateGas({
          ...(unsigned.to ? { to: unsigned.to } : {}),
          from: wallet.address,
          data: unsigned.data,
          value: BigInt(unsigned.value),
        });
        if (index === 14) t.diagnostic('LOCAL_FACTORY_ESTIMATE_GAS=' + estimated.toString());
        const tx = await wallet.sendTransaction({
          ...(unsigned.to ? { to: unsigned.to } : {}),
          data: unsigned.data,
          value: BigInt(unsigned.value),
          nonce: index,
          chainId: 46630,
          type: 2,
          gasLimit: (estimated * 120n + 99n) / 100n,
          maxFeePerGas: 20_000_000n,
          maxPriorityFeePerGas: 0n,
        });
        const receipt = await tx.wait();
        assert.equal(receipt?.status, 1);
        actualHashes.push(tx.hash);
        await provider.send('anvil_mine', ['0x2']);
      }
      const gasInfo = new Interface([
        'function getGasAccountingParams() view returns(uint256,uint256,uint256)',
      ]);
      const observedAt = Number((await provider.getBlock('latest'))!.timestamp);
      const cache = new Map<string, unknown>();
      const liveRpc: DeploymentVerificationRpc = {
        request: async (method, params) => {
          assert.ok(
            [
              'eth_chainId',
              'eth_getBlockByNumber',
              'eth_getTransactionByHash',
              'eth_getTransactionReceipt',
              'eth_getCode',
              'eth_call',
              'eth_getBalance',
            ].includes(method),
          );
          // Anvil has no ArbGasInfo precompile; isolated test supplies its bounded execution-limit response.
          const result =
            method === 'eth_call' &&
            String((params[0] as { to: string }).to).toLowerCase() ===
              '0x000000000000000000000000000000000000006c'
              ? gasInfo.encodeFunctionResult('getGasAccountingParams', [7_000_000, 32_000_000, 32_000_000])
              : await provider.send(method, [...params]);
          cache.set(JSON.stringify([method, params]), structuredClone(result));
          return result;
        },
      };
      const result = await verifyWalletDeployment(p, actualHashes, liveRpc, { now: () => observedAt });
      assert.equal(result.status, 'CANONICAL_INITIALIZATION_VERIFIED');
      assert.equal(result.transactionCount, 41);
      validateManifest(result.manifest);
      assert.equal(Object.keys(result.manifest.runtimeCodeHashes).length, 18);
      assert.equal(result.funding.unallocatedAdminUsdcRaw, '1100000000000');
      assert.equal(result.funding.amznPool, result.manifest.strategies.AMZN.pool);
      assert.equal(result.referenceStatus.TSLA?.status, 'FRESH_STOCK_REFERENCE_NOT_READY');
      assert.equal(result.referenceStatus.AMZN?.status, 'FRESH_STOCK_REFERENCE_NOT_READY');
      assert.equal(result.broadcastsByThisTool, 0);
      t.diagnostic(
        'LOCAL_EVM_ONLY: 15 deployments and 26 configurations; no target Testnet transactions or product-journey claim.',
      );
      const replay = (
        mutate: (method: string, params: readonly unknown[], result: unknown) => unknown,
      ): DeploymentVerificationRpc => ({
        request: async (method, params) => {
          const key = JSON.stringify([method, params]);
          assert.ok(cache.has(key), 'No unqualified read requested');
          return mutate(method, params, structuredClone(cache.get(key)));
        },
      });
      const serializedDigest = createHash('sha256').update(JSON.stringify(p)).digest('hex');
      const exportedResult = await verifyWalletDeployment(
        p,
        { schemaVersion: 1, chainId: 46630, payloadSha256: serializedDigest, transactions: actualHashes },
        replay((_method, _params, value) => value),
        { now: () => observedAt, payloadSha256: serializedDigest },
      );
      assert.deepEqual(exportedResult.manifest, result.manifest);
      const factoryAbi = new Interface(['function getPool(address) view returns(address)']);
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) =>
            method === 'eth_call' &&
            String((params[0] as { to: string }).to).toLowerCase() ===
              p.plan.addresses.poolFactory?.toLowerCase() &&
            String((params[0] as { data: string }).data).startsWith(
              factoryAbi.getFunction('getPool')!.selector,
            )
              ? factoryAbi.encodeFunctionResult('getPool', [address(42)])
              : value,
          ),
          { now: () => observedAt },
        ),
        /STATE:poolFactory:getPool/,
      );
      const poolAbi = new Interface([
        'function initialLpRecipient() view returns(address)',
        'function balanceOf(address) view returns(uint256)',
      ]);
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) =>
            method === 'eth_call' &&
            String((params[0] as { to: string }).to).toLowerCase() === result.funding.amznPool &&
            String((params[0] as { data: string }).data) === poolAbi.encodeFunctionData('initialLpRecipient')
              ? poolAbi.encodeFunctionResult('initialLpRecipient', [address(42)])
              : value,
          ),
          { now: () => observedAt },
        ),
        /STATE:amznPool:initialLpRecipient/,
      );
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) =>
            method === 'eth_call' &&
            String((params[0] as { to: string }).to).toLowerCase() === result.funding.amznPool &&
            String((params[0] as { data: string }).data).startsWith(
              poolAbi.getFunction('balanceOf')!.selector,
            )
              ? poolAbi.encodeFunctionResult('balanceOf', [0])
              : value,
          ),
          { now: () => observedAt },
        ),
        /STATE:amznPool:balanceOf/,
      );
      const txCases: [string, string, unknown][] = [
        ['from', 'TX_FROM', address(42)],
        ['nonce', 'TX_NONCE', '0x1'],
        ['chainId', 'TX_CHAIN', '0x1'],
        ['input', 'TX_DATA', '0x00'],
        ['maxFeePerGas', 'TX_FEE_OR_GAS', '0x1'],
        ['to', 'CREATE_RECIPIENT', address(42)],
        ['value', 'TX_VALUE', '0x1'],
      ];
      for (const [field, expected, bad] of txCases)
        await assert.rejects(
          verifyWalletDeployment(
            p,
            actualHashes,
            replay((method, params, value) =>
              method === 'eth_getTransactionByHash' && params[0] === actualHashes[0]
                ? { ...(value as object), [field]: bad }
                : value,
            ),
            { now: () => observedAt },
          ),
          new RegExp(expected),
        );
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) =>
            method === 'eth_getTransactionReceipt' && params[0] === actualHashes[0]
              ? { ...(value as object), status: '0x0' }
              : value,
          ),
          { now: () => observedAt },
        ),
        /REVERTED/,
      );
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) =>
            method === 'eth_getCode' &&
            String(params[0]).toLowerCase() === p.plan.addresses.usdc?.toLowerCase()
              ? '0x00'
              : value,
          ),
          { now: () => observedAt },
        ),
        /RUNTIME_IDENTITY/,
      );
      const firstBlock = '0x' + BigInt(result.transactions[0]!.blockNumber).toString(16);
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) =>
            method === 'eth_getBlockByNumber' && params[0] === firstBlock
              ? { ...(value as object), hash: '0x' + 'f'.repeat(64) }
              : value,
          ),
          { now: () => observedAt },
        ),
        /REORG/,
      );
      const fundedHash = result.transactions.find(
        (a) => a.operation === 'conversionReserve:fundNative',
      )!.transactionHash;
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) =>
            method === 'eth_getTransactionReceipt' && params[0] === fundedHash
              ? { ...(value as object), logs: [] }
              : value,
          ),
          { now: () => observedAt },
        ),
        /EVENT:conversionReserve:ReserveFunded/,
      );
      const usdcAbi = new Interface(['function balanceOf(address) view returns(uint256)']);
      const balanceSelector = usdcAbi.getFunction('balanceOf')!.selector;
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) =>
            method === 'eth_call' &&
            String((params[0] as { to: string }).to).toLowerCase() === p.plan.addresses.usdc?.toLowerCase() &&
            String((params[0] as { data: string }).data).startsWith(balanceSelector)
              ? usdcAbi.encodeFunctionResult('balanceOf', [0])
              : value,
          ),
          { now: () => observedAt },
        ),
        /STATE:usdc:balanceOf/,
      );
      let canonicalFirstReads = 0;
      await assert.rejects(
        verifyWalletDeployment(
          p,
          actualHashes,
          replay((method, params, value) => {
            if (method === 'eth_getBlockByNumber' && params[0] === firstBlock && ++canonicalFirstReads > 1)
              return { ...(value as object), hash: '0x' + 'e'.repeat(64) };
            return value;
          }),
          { now: () => observedAt },
        ),
        /FINAL_REORG/,
      );
    } finally {
      provider.destroy();
    }
  },
);

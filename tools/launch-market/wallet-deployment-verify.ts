import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, getCreateAddress, id, Interface, keccak256, ZeroAddress, ZeroHash } from 'ethers';
import { ROBINHOOD_CHAIN_TESTNET } from '../../packages/robinhood-chain/src/network.ts';
import { validateManifest } from '../../packages/launch-market/src/config.ts';
import { DEPLOYMENT_APPROVAL } from '../../apps/web/src/deployment-approval.ts';
import type { LaunchMarketManifest } from '../../packages/launch-market/src/types.ts';
import { readRegularBytes } from '../../packages/testnet/src/bounded-file.ts';
import { prepareDeployment, type DeploymentInputs } from './prepare.ts';
import { qualifyTargetArtifacts, targetPlanDigest } from './target-preflight.ts';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const ordinaryUser = '0x5a2acf1a388fe4f19aeffa404e07e916b5b07b77';
const million = 1_000_000n * 10n ** 18n;
const half = million / 2n;
const lpCash = 250_000n * 10n ** 6n;
const claimCash = 100_000n * 10n ** 6n;
const readonlyMethods = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getCode',
  'eth_call',
  'eth_getBalance',
]);
export interface DeploymentVerificationRpc {
  request(method: string, params: readonly unknown[]): Promise<unknown>;
}
export interface WalletDeploymentBudget {
  maxGasPerTransactionRaw: string;
  maxFeePerGasRaw: string;
  maxPriorityFeePerGasRaw: string;
  maxTotalGasCostWei: string;
  maxTotalNativeValueWei: string;
  minimumRemainingEthRaw: string;
  maxHeadAgeSeconds: number;
}
export interface WalletDeploymentPayload {
  schemaVersion: 1;
  chainId: 46630;
  approvedWallet: string;
  approvalExpiresAt: number;
  plan: Awaited<ReturnType<typeof prepareDeployment>>;
  budget: WalletDeploymentBudget;
}
interface Action {
  operation: string;
  chainId: number;
  caller: string;
  contractAddress: string;
  function: string;
  nonce?: number;
  constructorArguments?: unknown[];
  arguments?: unknown[];
  unsigned: { to: string | null; data: string; value: string } | null;
}
interface Compiled {
  abi: ConstructorParameters<typeof Interface>[0];
  bytecode: { object: string };
  deployedBytecode: {
    object: string;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
}
function fail(code: string): never {
  throw new Error('WALLET_DEPLOYMENT_' + code);
}
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('INPUT');
  return v as Record<string, unknown>;
}
function decimal(v: unknown, nonzero = false): bigint {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v)) fail('INTEGER');
  const n = BigInt(v);
  if (n >= 2n ** 256n || (nonzero && n === 0n)) fail('INTEGER');
  return n;
}
function quantity(v: unknown): bigint {
  if (typeof v !== 'string' || !/^0x(0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(v)) fail('RPC_QUANTITY');
  return BigInt(v);
}
function hash(v: unknown): string {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v)) fail('RPC_HASH');
  return v.toLowerCase();
}
function address(v: unknown, allowZero = false): string {
  if (typeof v !== 'string') fail('ADDRESS');
  let out: string;
  try {
    out = getAddress(v).toLowerCase();
  } catch {
    fail('ADDRESS');
  }
  if (!allowZero && out === ZeroAddress) fail('ADDRESS');
  return out;
}
function bytes(v: unknown): string {
  if (typeof v !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(v)) fail('RPC_BYTES');
  return v.toLowerCase();
}
function hex(n: bigint): string {
  return '0x' + n.toString(16);
}
function same(actual: unknown, expected: unknown, code = 'STATE'): void {
  const a = Array.isArray(actual) ? [...actual] : actual;
  const e = Array.isArray(expected) ? [...expected] : expected;
  if (typeof a === 'bigint' || typeof e === 'bigint') {
    if (BigInt(String(a)) !== BigInt(String(e))) fail(code);
  } else if (typeof e === 'string' && /^0x[0-9a-fA-F]+$/.test(e)) {
    if (typeof a !== 'string' || a.toLowerCase() !== e.toLowerCase()) fail(code);
  } else if (Array.isArray(e)) {
    if (!Array.isArray(a) || a.length !== e.length) fail(code);
    e.forEach((v, i) => same(a[i], v, code));
  } else if (a !== e) fail(code);
}

/** There is no account discovery, signer, raw transaction or RPC write method in this client. */
export function walletDeploymentReadonlyRpc(
  endpoint = ROBINHOOD_CHAIN_TESTNET.rpcUrl,
  fetcher: typeof fetch = fetch,
): DeploymentVerificationRpc {
  if (endpoint !== ROBINHOOD_CHAIN_TESTNET.rpcUrl) fail('RPC_ENDPOINT');
  let requestId = 0;
  return Object.freeze({
    request: async (method: string, params: readonly unknown[]) => {
      if (!readonlyMethods.has(method)) fail('RPC_METHOD');
      const rpcId = ++requestId;
      const response = await fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
      });
      if (response.status !== 200 || !response.body) fail('RPC_UNAVAILABLE');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 512 * 1024) fail('RPC_CAPACITY');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const result = record(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
      );
      if (
        result.jsonrpc !== '2.0' ||
        result.id !== rpcId ||
        result.error !== undefined ||
        !Object.hasOwn(result, 'result')
      )
        fail('RPC_RESPONSE');
      return result.result;
    },
  });
}

/** Compiler placeholders are never runtime hashes; only explicitly recorded immutable byte ranges may differ. */
export function verifyRuntimeIdentity(actualInput: unknown, compiled: Compiled): string {
  const actual = bytes(actualInput);
  const expected = bytes(compiled.deployedBytecode.object);
  if (actual === '0x' || actual.length !== expected.length) fail('RUNTIME_IDENTITY');
  const a = Buffer.from(actual.slice(2), 'hex');
  const e = Buffer.from(expected.slice(2), 'hex');
  const covered = new Set<number>();
  for (const refs of Object.values(compiled.deployedBytecode.immutableReferences ?? {})) {
    if (!Array.isArray(refs)) fail('IMMUTABLE_REFERENCES');
    for (const ref of refs) {
      if (
        !Number.isSafeInteger(ref.start) ||
        !Number.isSafeInteger(ref.length) ||
        ref.start < 0 ||
        ref.length !== 32 ||
        ref.start + ref.length > a.length
      )
        fail('IMMUTABLE_REFERENCES');
      for (let i = ref.start; i < ref.start + ref.length; i++) {
        if (covered.has(i)) fail('IMMUTABLE_REFERENCES');
        covered.add(i);
        a[i] = 0;
        e[i] = 0;
      }
    }
  }
  if (!a.equals(e)) fail('RUNTIME_IDENTITY');
  return keccak256(actual);
}
const files: Record<string, [string, string]> = {
  usdc: ['AlphaForgeTestAsset', 'AlphaForgeTestUSDC'],
  tslaPass: ['StrategyPass', 'StrategyPass'],
  amznPass: ['StrategyPass', 'StrategyPass'],
  poolFactory: ['AlphaForgePassFactory', 'AlphaForgePassFactory'],
  conversionReserve: ['AlphaForgeNativeReserve', 'AlphaForgeNativeReserve'],
  router: ['AlphaForgeMarketRouter', 'AlphaForgeMarketRouter'],
  tslaLaunch: ['AlphaForgeFairLaunch', 'AlphaForgeFairLaunch'],
  claim: ['AlphaForgeClaimReserve', 'AlphaForgeClaimReserve'],
  TSLAStock: ['AlphaForgeStrategyVault', 'AlphaForgeStrategyTestStock'],
  AMZNStock: ['AlphaForgeStrategyVault', 'AlphaForgeStrategyTestStock'],
  TSLAFeed: ['AlphaForgeStrategyVault', 'AlphaForgeStrategyReferenceFeed'],
  AMZNFeed: ['AlphaForgeStrategyVault', 'AlphaForgeStrategyReferenceFeed'],
  TSLAStockReserve: ['AlphaForgeStrategyVault', 'AlphaForgeStockReserve'],
  AMZNStockReserve: ['AlphaForgeStrategyVault', 'AlphaForgeStockReserve'],
  vaultFactory: ['AlphaForgeStrategyVault', 'AlphaForgeStrategyVaultFactory'],
  amznPool: ['AlphaForgePassPool', 'AlphaForgePassPool'],
  vaultCode: ['AlphaForgeStrategyVault', 'AlphaForgeStrategyVault'],
};

/** Qualifies exact approved intent and verifies real canonical receipts. It can only read the chain. */
export async function verifyWalletDeployment(
  payloadInput: unknown,
  hashesInput: unknown,
  rpc: DeploymentVerificationRpc,
  options: { now?: () => number; artifactRoot?: string; payloadSha256?: string } = {},
) {
  const input = record(payloadInput);
  if (
    input.schemaVersion !== 1 ||
    input.chainId !== 46630 ||
    !Number.isSafeInteger(input.approvalExpiresAt) ||
    Number(input.approvalExpiresAt) <= 0
  )
    fail('PAYLOAD');
  const supplied = record(input.plan);
  const inputs = record(supplied.inputs) as unknown as DeploymentInputs;
  const plan = await prepareDeployment(inputs);
  if (targetPlanDigest(plan) !== targetPlanDigest(supplied)) fail('PLAN_MISMATCH');
  const approved = address(input.approvedWallet);
  if (address(inputs.deployer) !== approved || address(inputs.administrator) !== approved)
    fail('APPROVED_WALLET');
  for (const role of [
    'deployer',
    'administrator',
    'quoteSigner',
    'claimSigner',
    'tslaLpRecipient',
    'amznLpRecipient',
  ] as const)
    if (address(inputs[role]) === ordinaryUser) fail('ORDINARY_USER_ROLE');
  if (
    address(inputs.quoteSigner) === address(inputs.claimSigner) ||
    [inputs.quoteSigner, inputs.claimSigner].some((v) => address(v) === approved)
  )
    fail('VOUCHER_SIGNER_ROLE');
  const budget = record(input.budget) as unknown as WalletDeploymentBudget;
  const gasLimit = decimal(budget.maxGasPerTransactionRaw, true);
  const feeCap = decimal(budget.maxFeePerGasRaw, true);
  const priorityCap = decimal(budget.maxPriorityFeePerGasRaw);
  const gasBudget = decimal(budget.maxTotalGasCostWei, true);
  const valueBudget = decimal(budget.maxTotalNativeValueWei, true);
  const retained = decimal(budget.minimumRemainingEthRaw, true);
  if (
    gasLimit > 32_000_000n ||
    priorityCap > feeCap ||
    !Number.isSafeInteger(budget.maxHeadAgeSeconds) ||
    budget.maxHeadAgeSeconds < 1 ||
    budget.maxHeadAgeSeconds > 60
  )
    fail('BUDGET');
  const actions = (plan.actions as Action[]).filter((a) => a.unsigned !== null);
  if (
    actions.length !== 41 ||
    41n * gasLimit * feeCap > gasBudget ||
    actions.reduce((sum, a) => sum + decimal(a.unsigned!.value), 0n) > valueBudget
  )
    fail('BUDGET');
  let hashesValue = hashesInput;
  if (!Array.isArray(hashesValue)) {
    const exported = record(hashesValue);
    if (
      exported.schemaVersion !== 1 ||
      exported.chainId !== 46630 ||
      typeof exported.payloadSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(exported.payloadSha256) ||
      exported.payloadSha256 !== options.payloadSha256
    )
      fail('EXPORTED_PAYLOAD_BINDING');
    hashesValue = exported.transactions;
  }
  if (!Array.isArray(hashesValue) || hashesValue.length !== actions.length) fail('HASH_LIST');
  const hashes = hashesValue.map(hash);
  if (new Set(hashes).size !== hashes.length) fail('DUPLICATE_HASH');
  const root = options.artifactRoot ?? repository;
  const artifactEvidence = qualifyTargetArtifacts(root);
  const compiled: Record<string, Compiled> = {};
  const interfaces: Record<string, Interface> = {};
  for (const [label, [file, name]] of Object.entries(files)) {
    const artifactBytes = readRegularBytes(
      resolve(root, '.checks/af-chain01/out', file + '.sol', name + '.json'),
      16 * 1024 * 1024,
    );
    if (createHash('sha256').update(artifactBytes).digest('hex') !== artifactEvidence.artifacts[name])
      fail('ARTIFACT_CHANGED');
    compiled[label] = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifactBytes)) as Compiled;
    interfaces[label] = new Interface(compiled[label]!.abi);
  }
  same(quantity(await rpc.request('eth_chainId', [])), 46630n, 'CHAIN');
  const startNow = options.now?.() ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(startNow) || startNow < 0) fail('TIME');
  const head = record(await rpc.request('eth_getBlockByNumber', ['latest', false]));
  const headHeight = quantity(head.number),
    headHash = hash(head.hash),
    headTime = quantity(head.timestamp);
  if (headTime > BigInt(startNow) || BigInt(startNow) - headTime > BigInt(budget.maxHeadAgeSeconds))
    fail('HEAD_STALE');
  const addr = Object.fromEntries(Object.entries(plan.addresses).map(([key, v]) => [key, address(v)]));
  const runtimeCodeHashes: Record<string, string> = {};
  const locations: {
    operation: string;
    transactionHash: string;
    blockNumber: string;
    blockHash: string;
    gasUsedRaw: string;
    effectiveGasPriceWei: string;
  }[] = [];
  const balances = new Map<string, { token: string; owner: string; value: bigint }>();
  const dirtyBalances = new Set<string>();
  const dirtyAllowances = new Set<string>();
  const allowances = new Map<string, { token: string; owner: string; spender: string; value: bigint }>();
  let amznPool: string | null = null,
    amznShares = 0n,
    nativeFunded = 0n;
  let actualGasCost = 0n,
    reservedGasCost = 0n,
    nativeValue = 0n,
    previousBlock = -1n;
  let pinnedBlock = '';
  const call = async (label: string, method: string, args: unknown[] = [], block = pinnedBlock) => {
    const iface = interfaces[label];
    if (!iface || !addr[label]) fail('CONTRACT_LABEL');
    const raw = bytes(
      await rpc.request('eth_call', [
        { to: addr[label], data: iface.encodeFunctionData(method, args) },
        block,
      ]),
    );
    try {
      return iface.decodeFunctionResult(method, raw);
    } catch {
      fail('CALL_RESULT');
    }
  };
  const check = async (label: string, method: string, expected: unknown, args: unknown[] = []) => {
    const result = await call(label, method, args);
    same(result.length === 1 ? result[0] : [...result], expected, 'STATE:' + label + ':' + method);
  };
  const code = async (label: string, block = pinnedBlock) => {
    const actual = await rpc.request('eth_getCode', [addr[label], block]);
    runtimeCodeHashes[addr[label]!] = verifyRuntimeIdentity(actual, compiled[label]!);
  };
  const logsFor = (receipt: Record<string, unknown>, label: string, event: string) => {
    if (!Array.isArray(receipt.logs)) fail('RECEIPT_LOGS');
    return receipt.logs
      .filter((item) => address(record(item).address) === addr[label])
      .flatMap((item) => {
        const log = record(item);
        if (
          hash(log.transactionHash) !== hash(receipt.transactionHash) ||
          hash(log.blockHash) !== hash(receipt.blockHash) ||
          quantity(log.blockNumber) !== quantity(receipt.blockNumber) ||
          log.removed !== false
        )
          fail('LOG_LOCATION');
        quantity(log.logIndex);
        quantity(log.transactionIndex);
        if (!Array.isArray(log.topics) || log.topics.length > 4) fail('LOG_TOPICS');
        const topics = log.topics.map(hash);
        let parsed;
        try {
          parsed = interfaces[label]!.parseLog({ topics, data: bytes(log.data) });
        } catch {
          fail('LOG_DECODE');
        }
        return parsed?.name === event ? [parsed] : [];
      });
  };
  const event = (receipt: Record<string, unknown>, label: string, name: string, expected: unknown[]) => {
    const found = logsFor(receipt, label, name).filter((v) => {
      try {
        same([...v.args], expected);
        return true;
      } catch {
        return false;
      }
    });
    if (found.length !== 1) fail('EVENT:' + label + ':' + name);
  };
  const balanceKey = (token: string, owner: string) => address(token) + ':' + address(owner);
  const setBalance = (token: string, owner: string, value: bigint) => {
    const key = balanceKey(token, owner);
    dirtyBalances.add(key);
    balances.set(key, { token: address(token), owner: address(owner), value });
  };
  const movement = (
    receipt: Record<string, unknown>,
    label: string,
    from: string,
    to: string,
    amount: bigint,
  ) => {
    const token = addr[label]!;
    event(receipt, label, 'Transfer', [from, to, amount]);
    const sender = balances.get(balanceKey(token, from));
    if (!sender || sender.value < amount) fail('FUNDING_LEDGER');
    const receiver = balances.get(balanceKey(token, to));
    if (address(from) !== address(to)) {
      setBalance(token, from, sender.value - amount);
      setBalance(token, to, (receiver?.value ?? 0n) + amount);
    }
  };
  const allowanceKey = (token: string, owner: string, spender: string) =>
    address(token) + ':' + address(owner) + ':' + address(spender);
  const consume = (token: string, owner: string, spender: string, amount: bigint) => {
    const entry = allowances.get(allowanceKey(token, owner, spender));
    if (!entry || entry.value < amount) fail('ALLOWANCE_LEDGER');
    entry.value -= amount;
    dirtyAllowances.add(allowanceKey(token, owner, spender));
  };
  const tokenLabel = (token: string) => {
    const label = Object.keys(addr).find((k) => addr[k] === address(token));
    if (!label || !['usdc', 'tslaPass', 'amznPass', 'TSLAStock', 'AMZNStock'].includes(label))
      fail('TOKEN_LABEL');
    return label;
  };
  async function checkLedgers(all = false) {
    const checks = [
      ...[...balances.entries()]
        .filter(([key]) => all || dirtyBalances.has(key))
        .map(([, entry]) => check(tokenLabel(entry.token), 'balanceOf', entry.value, [entry.owner])),
      ...[...allowances.entries()]
        .filter(([key]) => all || dirtyAllowances.has(key))
        .map(([, entry]) =>
          check(tokenLabel(entry.token), 'allowance', entry.value, [entry.owner, entry.spender]),
        ),
    ];
    await Promise.all(checks);
    dirtyBalances.clear();
    dirtyAllowances.clear();
  }
  async function deploymentState(label: string, action: Action, receipt: Record<string, unknown>) {
    await code(label);
    const args = action.constructorArguments!;
    if (['usdc', 'tslaPass', 'amznPass', 'TSLAStock', 'AMZNStock'].includes(label)) {
      const supply = label === 'usdc' ? decimal(inputs.usdcSupplyRaw) : million;
      await check(label, 'totalSupply', supply);
      await check(label, 'decimals', label === 'usdc' ? 6n : 18n);
      event(receipt, label, 'Transfer', [ZeroAddress, approved, supply]);
      setBalance(addr[label]!, approved, supply);
      if (label.endsWith('Pass'))
        await check(label, 'strategyId', id(label === 'tslaPass' ? 'TSLA' : 'AMZN'));
      if (label !== 'usdc') {
        await check(
          label,
          'name',
          String(
            label.endsWith('Pass')
              ? args[0]
              : label === 'TSLAStock'
                ? 'AlphaForge Test TSLA'
                : 'AlphaForge Test AMZN',
          ),
        );
        await check(
          label,
          'symbol',
          String(label.endsWith('Pass') ? args[1] : label === 'TSLAStock' ? 'AF-TEST-TSLA' : 'AF-TEST-AMZN'),
        );
      }
    } else if (label === 'poolFactory') {
      await check(label, 'owner', approved);
      await check(label, 'usdc', addr.usdc);
    } else if (label === 'conversionReserve') {
      for (const [method, expected] of Object.entries({
        owner: approved,
        usdc: addr.usdc,
        quoteSigner: inputs.quoteSigner,
        quoteEpoch: 1n,
        conversionFeeBps: 0n,
        ethInputPaused: false,
        ethOutputPaused: false,
        tradingRouter: ZeroAddress,
      }))
        await check(label, method, expected);
      await check(label, 'limits', [
        decimal(inputs.ethPerTransactionRaw),
        decimal(inputs.ethPerAccountDailyRaw),
        decimal(inputs.ethGlobalDailyRaw),
        decimal(inputs.ethMinimumReserveRaw),
      ]);
    } else if (label === 'router') {
      for (const [method, expected] of Object.entries({
        factory: addr.poolFactory,
        reserve: addr.conversionReserve,
        usdc: addr.usdc,
      }))
        await check(label, method, expected);
    } else if (label === 'tslaLaunch') {
      for (const [method, expected] of Object.entries({
        owner: approved,
        pass: addr.tslaPass,
        usdc: addr.usdc,
        factory: addr.poolFactory,
        conversionReserve: addr.conversionReserve,
        lpRecipient: inputs.tslaLpRecipient,
        PROCEEDS_RECIPIENT: plan.proceedsRecipient,
        state: 0n,
        sold: 0n,
        pool: ZeroAddress,
        lpShares: 0n,
        TOTAL_SUPPLY: million,
        PUBLIC_SUPPLY: half,
        LP_PASS: half,
        LP_USDC: lpCash,
      }))
        await check(label, method, expected);
    } else if (label === 'claim') {
      for (const [method, expected] of Object.entries({
        owner: approved,
        usdc: addr.usdc,
        claimSigner: inputs.claimSigner,
        claimEpoch: 1n,
        claimsOpened: false,
        paused: false,
        totalClaims: 0n,
        CLAIM_AMOUNT: 1_000_000_000n,
        MAX_CLAIMS: 100n,
      }))
        await check(label, method, expected);
    } else if (label.endsWith('Feed')) {
      const strategy = label.slice(0, 4);
      await check(label, 'keeper', approved);
      await check(label, 'referenceIdentity', id('TEST_ONLY:' + strategy));
      await check(label, 'price', [0n, 0n, ZeroHash]);
    } else if (label.endsWith('StockReserve')) {
      const strategy = label.slice(0, 4);
      for (const [method, expected] of Object.entries({
        owner: approved,
        usdc: addr.usdc,
        stock: addr[strategy + 'Stock'],
        feed: addr[strategy + 'Feed'],
        maxPriceAge: 60n,
        paused: false,
      }))
        await check(label, method, expected);
    } else if (label === 'vaultFactory') {
      for (const [index, strategy] of ['TSLA', 'AMZN'].entries()) {
        const result = await call(label, 'strategy', [index]);
        same(
          [...result[0]],
          [
            approved,
            addr[index === 0 ? 'tslaPass' : 'amznPass'],
            addr.usdc,
            addr[strategy + 'Stock'],
            addr[index === 0 ? 'AMZNStock' : 'TSLAStock'],
            addr[strategy + 'StockReserve'],
            addr[strategy + 'Feed'],
            id('All in ' + strategy),
            60n,
          ],
        );
      }
      const creation = bytes(compiled.vaultCode!.bytecode.object).slice(2);
      const midpoint = Math.floor(creation.length / 4) * 2;
      for (const [index, chunk] of [creation.slice(0, midpoint), creation.slice(midpoint)].entries()) {
        const part = getCreateAddress({ from: addr.vaultFactory!, nonce: index + 1 }).toLowerCase();
        const actual = bytes(await rpc.request('eth_getCode', [part, pinnedBlock]));
        same(actual, '0x00' + chunk, 'VAULT_CODE_PART');
        runtimeCodeHashes[part] = keccak256(actual);
      }
    } else fail('DEPLOYMENT_LABEL');
  }

  for (const [index, action] of actions.entries()) {
    const txHash = hashes[index]!;
    const [txInput, receiptInput] = await Promise.all([
      rpc.request('eth_getTransactionByHash', [txHash]),
      rpc.request('eth_getTransactionReceipt', [txHash]),
    ]);
    const tx = record(txInput),
      receipt = record(receiptInput);
    const height = quantity(receipt.blockNumber),
      blockHash = hash(receipt.blockHash);
    if (height <= previousBlock || headHeight < height + 2n) fail('CONFIRMATIONS_OR_ORDER');
    previousBlock = height;
    pinnedBlock = hex(height);
    const block = record(await rpc.request('eth_getBlockByNumber', [pinnedBlock, false]));
    same(hash(block.hash), blockHash, 'REORG');
    same(quantity(block.number), height, 'REORG');
    if (!Array.isArray(block.transactions) || !block.transactions.map(hash).includes(txHash))
      fail('BLOCK_TRANSACTION');
    same(hash(tx.hash), txHash, 'TX_HASH');
    same(hash(receipt.transactionHash), txHash, 'TX_HASH');
    same(hash(tx.blockHash), blockHash, 'TX_BLOCK');
    same(quantity(tx.blockNumber), height, 'TX_BLOCK');
    same(quantity(tx.transactionIndex), quantity(receipt.transactionIndex), 'TX_INDEX');
    same(block.transactions[Number(quantity(tx.transactionIndex))]?.toLowerCase(), txHash, 'TX_INDEX');
    same(address(tx.from), address(action.caller), 'TX_FROM');
    same(address(receipt.from), address(action.caller), 'RECEIPT_FROM');
    same(quantity(tx.chainId), 46630n, 'TX_CHAIN');
    same(quantity(tx.type), 2n, 'TX_TYPE');
    same(quantity(receipt.type), 2n, 'RECEIPT_TYPE');
    same(quantity(receipt.status), 1n, 'REVERTED');
    same(quantity(tx.nonce), BigInt(inputs.nonce + index), 'TX_NONCE');
    same(bytes(tx.input), bytes(action.unsigned!.data), 'TX_DATA');
    same(quantity(tx.value), decimal(action.unsigned!.value), 'TX_VALUE');
    const gas = quantity(tx.gas),
      used = quantity(receipt.gasUsed),
      fee = quantity(tx.maxFeePerGas),
      priority = quantity(tx.maxPriorityFeePerGas),
      effective = quantity(receipt.effectiveGasPrice);
    if (
      gas === 0n ||
      gas > gasLimit ||
      used === 0n ||
      used > gas ||
      fee !== feeCap ||
      priority !== priorityCap ||
      effective === 0n ||
      effective > fee
    )
      fail('TX_FEE_OR_GAS');
    if (tx.accessList !== undefined && (!Array.isArray(tx.accessList) || tx.accessList.length !== 0))
      fail('TX_ACCESS_LIST');
    const executionLimitCall = new Interface([
      'function getGasAccountingParams() view returns(uint256,uint256,uint256)',
    ]);
    const accounting = executionLimitCall.decodeFunctionResult(
      'getGasAccountingParams',
      bytes(
        await rpc.request('eth_call', [
          {
            to: '0x000000000000000000000000000000000000006c',
            data: executionLimitCall.encodeFunctionData('getGasAccountingParams'),
          },
          pinnedBlock,
        ]),
      ),
    );
    if (BigInt(accounting[2]) <= 0n || BigInt(accounting[2]) > 32_000_000n || gas > BigInt(accounting[2]))
      fail('CHAIN_GAS_LIMIT');
    actualGasCost += used * effective;
    reservedGasCost += gas * fee;
    nativeValue += quantity(tx.value);
    if (actualGasCost > gasBudget || reservedGasCost > gasBudget || nativeValue > valueBudget)
      fail('TOTAL_BUDGET');
    const label = action.operation.startsWith('DEPLOY_')
      ? action.operation.slice(7)
      : action.operation.split(':')[0]!;
    if (action.unsigned!.to === null) {
      if (tx.to !== null || receipt.to !== null) fail('CREATE_RECIPIENT');
      same(address(receipt.contractAddress), addr[label], 'CREATE_ADDRESS');
      same(addr[label], getCreateAddress({ from: approved, nonce: inputs.nonce + index }), 'CREATE_ADDRESS');
      await deploymentState(label, action, receipt);
    } else {
      same(address(tx.to), address(action.unsigned!.to), 'TX_TO');
      same(address(receipt.to), address(action.unsigned!.to), 'RECEIPT_TO');
      if (receipt.contractAddress !== null) fail('CALL_CONTRACT_ADDRESS');
      const args = action.arguments!;
      if (action.function === 'approve') {
        const spender = address(args[0]),
          amount = decimal(String(args[1]));
        event(receipt, label, 'Approval', [approved, spender, amount]);
        dirtyAllowances.add(allowanceKey(addr[label]!, approved, spender));
        allowances.set(allowanceKey(addr[label]!, approved, spender), {
          token: addr[label]!,
          owner: approved,
          spender,
          value: amount,
        });
      } else if (action.function === 'transfer') {
        movement(receipt, label, approved, address(args[0]), decimal(String(args[1])));
      } else if (action.function === 'configureInitializer') {
        event(receipt, label, 'InitializerConfigured', args);
        await check(label, 'initializer', args[1], [args[0]]);
      } else if (action.function === 'authorizeRouter') {
        event(receipt, label, 'RouterAuthorized', args);
        await check(label, 'authorizedRouter', true, args);
      } else if (action.function === 'configureTradingRouter') {
        event(receipt, label, 'TradingRouterConfigured', args);
        await check(label, 'tradingRouter', args[0]);
      } else if (action.function === 'fundNative') {
        nativeFunded += decimal(action.unsigned!.value);
        event(receipt, label, 'ReserveFunded', [approved, true, decimal(action.unsigned!.value)]);
        same(
          quantity(await rpc.request('eth_getBalance', [addr.conversionReserve, pinnedBlock])),
          nativeFunded,
          'NATIVE_RESERVE',
        );
      } else if (action.function === 'fundUsdc' || action.function === 'fund') {
        const token = args.length === 2 ? address(args[0]) : addr.usdc!,
          amount = decimal(String(args.at(-1)));
        movement(receipt, tokenLabel(token), approved, addr[label]!, amount);
        consume(token, approved, addr[label]!, amount);
        event(
          receipt,
          label,
          label.endsWith('StockReserve') ? 'Funded' : 'ReserveFunded',
          label.endsWith('StockReserve')
            ? [token, amount]
            : label === 'claim'
              ? [approved, amount]
              : [approved, false, amount],
        );
      } else if (action.function === 'openClaims') {
        event(receipt, label, 'ClaimsOpened', [claimCash, 100n]);
        await check(label, 'claimsOpened', true);
      } else if (action.function === 'createPool') {
        const found = logsFor(receipt, 'poolFactory', 'PoolCreated');
        if (found.length !== 1) fail('POOL_EVENT');
        const poolEvent = found[0]!.args;
        same(poolEvent[0], addr.amznPass);
        same(poolEvent[2], inputs.amznLpRecipient);
        amznPool = address(poolEvent[1]);
        amznShares = BigInt(poolEvent[3]);
        if (amznShares <= 0n || Object.values(addr).includes(amznPool)) fail('POOL_IDENTITY');
        addr.amznPool = amznPool;
        await check('poolFactory', 'getPool', amznPool, [addr.amznPass]);
        await code('amznPool');
        movement(receipt, 'amznPass', approved, amznPool, half);
        movement(receipt, 'usdc', approved, amznPool, lpCash);
        consume(addr.amznPass!, approved, addr.poolFactory!, half);
        consume(addr.usdc!, approved, addr.poolFactory!, lpCash);
        for (const [method, expected] of Object.entries({
          factory: addr.poolFactory,
          pass: addr.amznPass,
          usdc: addr.usdc,
          initialLpRecipient: inputs.amznLpRecipient,
          initialized: true,
          reservePass: half,
          reserveUsdc: lpCash,
          FEE_BPS: 30n,
          totalSupply: amznShares,
        }))
          await check('amznPool', method, expected);
        await check('amznPool', 'balanceOf', amznShares, [inputs.amznLpRecipient]);
        event(receipt, 'amznPool', 'Transfer', [ZeroAddress, inputs.amznLpRecipient, amznShares]);
        event(receipt, 'amznPool', 'LiquidityAdded', [inputs.amznLpRecipient, half, lpCash, amznShares]);
        event(receipt, 'amznPool', 'Sync', [half, lpCash]);
      } else if (action.function === 'openMint') {
        event(receipt, label, 'MintOpened', [half, half, lpCash, inputs.tslaLpRecipient]);
        await check(label, 'state', 1n);
        await check(label, 'sold', 0n);
        await check(label, 'remaining', half);
      } else fail('ACTION_FUNCTION');
    }
    await checkLedgers();
    locations.push({
      operation: action.operation,
      transactionHash: txHash,
      blockNumber: height.toString(),
      blockHash,
      gasUsedRaw: used.toString(),
      effectiveGasPriceWei: effective.toString(),
    });
  }
  await checkLedgers(true);
  if (!amznPool || nativeFunded !== decimal(inputs.conversionEthRaw)) fail('FINAL_INITIALIZATION');
  await check('tslaLaunch', 'state', 1n);
  await check('tslaLaunch', 'sold', 0n);
  await check('tslaLaunch', 'pool', ZeroAddress);
  await check('tslaLaunch', 'lpShares', 0n);
  await check('tslaPass', 'balanceOf', million, [addr.tslaLaunch]);
  await check('usdc', 'balanceOf', lpCash, [addr.tslaLaunch]);
  await check('poolFactory', 'getPool', ZeroAddress, [addr.tslaPass]);
  await check('amznPass', 'balanceOf', half, [plan.proceedsRecipient]);
  await check('claim', 'totalClaims', 0n);
  await check('claim', 'claimsOpened', true);
  await check('claim', 'paused', false);
  await check('usdc', 'balanceOf', claimCash, [addr.claim]);
  await check('conversionReserve', 'ready', true);
  await check('conversionReserve', 'tradingRouter', addr.router);
  await check('usdc', 'balanceOf', decimal(inputs.conversionUsdcRaw), [addr.conversionReserve]);
  same(
    quantity(await rpc.request('eth_getBalance', [addr.conversionReserve, pinnedBlock])),
    decimal(inputs.conversionEthRaw),
    'FINAL_NATIVE_RESERVE',
  );
  const remaining = decimal(inputs.usdcSupplyRaw) - decimal(plan.requiredInitialUsdcRaw);
  await check('usdc', 'balanceOf', remaining, [approved]);
  if (quantity(await rpc.request('eth_getBalance', [approved, pinnedBlock])) < retained)
    fail('RETAINED_NATIVE');
  // Manifest describes canonical historical initialization. Later genuine trading does not erase its receipts.
  // Code remains pinned at the observed head, and constructor/role checks above bind all immutable values.
  for (const label of Object.keys(addr)) await code(label, hex(headHeight));
  const initializationBlock = pinnedBlock;
  pinnedBlock = hex(headHeight);
  for (const [label, method, expected, args] of [
    ['conversionReserve', 'quoteSigner', inputs.quoteSigner, []],
    ['conversionReserve', 'quoteEpoch', 1n, []],
    ['conversionReserve', 'ethInputPaused', false, []],
    ['conversionReserve', 'ethOutputPaused', false, []],
    [
      'conversionReserve',
      'limits',
      [
        decimal(inputs.ethPerTransactionRaw),
        decimal(inputs.ethPerAccountDailyRaw),
        decimal(inputs.ethGlobalDailyRaw),
        decimal(inputs.ethMinimumReserveRaw),
      ],
      [],
    ],
    ['conversionReserve', 'tradingRouter', addr.router, []],
    ['conversionReserve', 'authorizedRouter', true, [addr.router]],
    ['conversionReserve', 'authorizedRouter', true, [addr.tslaLaunch]],
    ['claim', 'claimSigner', inputs.claimSigner, []],
    ['claim', 'claimEpoch', 1n, []],
    ['claim', 'claimsOpened', true, []],
    ['claim', 'paused', false, []],
    ['poolFactory', 'initializer', addr.tslaLaunch, [addr.tslaPass]],
    ['poolFactory', 'initializer', approved, [addr.amznPass]],
  ] as [string, string, unknown, unknown[]][])
    await check(label, method, expected, args);
  pinnedBlock = initializationBlock;
  const referenceStatus: Record<
    string,
    { executionAllowed: boolean; priceRaw: string; observedAt: string; sourceDigest: string; status: string }
  > = {};
  for (const strategy of ['TSLA', 'AMZN']) {
    const label = strategy + 'Feed';
    const value = await call(label, 'price', [], hex(headHeight));
    const allowed = (await call(label, 'executionAllowed', [], hex(headHeight)))[0] === true;
    const price = BigInt(value[0]),
      observed = BigInt(value[1]);
    referenceStatus[strategy] = {
      executionAllowed: allowed,
      priceRaw: price.toString(),
      observedAt: observed.toString(),
      sourceDigest: hash(value[2]),
      status:
        allowed && price > 0n && observed <= headTime && headTime - observed <= 60n
          ? 'ONCHAIN_REFERENCE_AVAILABLE_PROVIDER_VALIDATION_REQUIRED'
          : 'FRESH_STOCK_REFERENCE_NOT_READY',
    };
  }
  // Re-read every receipt block after all slower state reads; no stale pre-reorg manifest can escape.
  for (const location of locations) {
    const canonical = record(
      await rpc.request('eth_getBlockByNumber', [hex(BigInt(location.blockNumber)), false]),
    );
    if (
      hash(canonical.hash) !== location.blockHash ||
      quantity(canonical.number).toString() !== location.blockNumber
    )
      fail('FINAL_REORG');
  }
  const finalHead = record(await rpc.request('eth_getBlockByNumber', ['latest', false]));
  const oldHead = record(await rpc.request('eth_getBlockByNumber', [hex(headHeight), false]));
  const finishNow = options.now?.() ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(finishNow) ||
    finishNow < startNow ||
    hash(oldHead.hash) !== headHash ||
    quantity(oldHead.number) !== headHeight ||
    quantity(finalHead.number) < previousBlock + 2n ||
    quantity(finalHead.timestamp) > BigInt(finishNow) ||
    BigInt(finishNow) - quantity(finalHead.timestamp) > BigInt(budget.maxHeadAgeSeconds)
  )
    fail('FINAL_HEAD');
  same(quantity(await rpc.request('eth_chainId', [])), 46630n, 'FINAL_CHAIN');
  const manifest: LaunchMarketManifest = {
    schemaVersion: 1,
    chainId: 46630,
    deploymentBlock: locations[0]!.blockNumber,
    usdc: addr.usdc!,
    claim: addr.claim!,
    conversionReserve: addr.conversionReserve!,
    router: addr.router!,
    poolFactory: addr.poolFactory!,
    vaultFactory: addr.vaultFactory!,
    runtimeCodeHashes,
    strategies: {
      TSLA: {
        pass: addr.tslaPass!,
        launch: addr.tslaLaunch!,
        pool: null,
        lpRecipient: address(inputs.tslaLpRecipient),
      },
      AMZN: {
        pass: addr.amznPass!,
        launch: null,
        pool: amznPool,
        lpRecipient: address(inputs.amznLpRecipient),
      },
    },
  };
  validateManifest(manifest);
  return {
    schemaVersion: 1,
    kind: 'ALPHAFORGE_PERSONAL_WALLET_DEPLOYMENT_READONLY_VERIFICATION',
    status: 'CANONICAL_INITIALIZATION_VERIFIED',
    chainId: 46630,
    planDigest: targetPlanDigest(plan),
    artifactEvidence,
    observedAt: new Date(finishNow * 1000).toISOString(),
    observedBlock: headHeight.toString(),
    observedBlockHash: headHash,
    initializationBlock: previousBlock.toString(),
    transactionCount: locations.length,
    transactions: locations,
    gas: {
      actualGasCostWei: actualGasCost.toString(),
      reservedGasCostWei: reservedGasCost.toString(),
      nativeFundingWei: nativeValue.toString(),
    },
    funding: {
      supplyRaw: inputs.usdcSupplyRaw,
      unallocatedAdminUsdcRaw: remaining.toString(),
      initialSnapshotBlock: previousBlock.toString(),
      amznPool,
      amznLpSharesRaw: amznShares.toString(),
    },
    referenceStatus,
    confirmationPolicy: '3 L2 blocks including inclusion; no L1 finality claim',
    signer: 'USER_PERSONAL_WALLET_EXTERNAL_TO_THIS_READONLY_TOOL',
    broadcastsByThisTool: 0,
    productJourney: 'NOT_EVALUATED_BY_DEPLOYMENT_RECEIPT_VERIFICATION',
    manifest,
  };
}

/** Writes a reader manifest only after all real receipts pass; the official Testnet is the only CLI network. */
export async function walletDeploymentVerifyCli(args: readonly string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: wallet-deployment-verify.ts APPROVED_PAYLOAD.json HASHES.json OUTPUT_MANIFEST.json (official chain 46630; read-only)',
    );
    return 0;
  }
  if (args.length !== 3 || args.some((v) => v.startsWith('--'))) return 2;
  try {
    const payloadBytes = readRegularBytes(resolve(args[0]!), 2 * 1024 * 1024);
    const payloadSha256 = createHash('sha256').update(payloadBytes).digest('hex');
    if (payloadSha256 !== DEPLOYMENT_APPROVAL.payloadSha256) fail('APPROVAL_PIN');
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
    const hashes = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(resolve(args[1]!), 32 * 1024)),
    );
    const result = await verifyWalletDeployment(payload, hashes, walletDeploymentReadonlyRpc(), {
      payloadSha256,
    });
    const output = resolve(args[2]!);
    await mkdir(resolve(output, '..'), { recursive: true, mode: 0o700 });
    await writeFile(output, JSON.stringify(result.manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await writeFile(output + '.verification.json', JSON.stringify(result, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        status: result.status,
        transactionCount: result.transactionCount,
        manifestSha256: createHash('sha256')
          .update(JSON.stringify(result.manifest, null, 2) + '\n')
          .digest('hex'),
        referenceStatus: result.referenceStatus,
      }),
    );
    return 0;
  } catch {
    console.error('WALLET_DEPLOYMENT_VERIFICATION_REJECTED');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await walletDeploymentVerifyCli(process.argv.slice(2));

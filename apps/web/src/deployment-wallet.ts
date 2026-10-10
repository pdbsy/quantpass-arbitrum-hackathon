import { ROBINHOOD_CHAIN_TESTNET } from '../../../packages/robinhood-chain/src/network.ts';

/** A separate administrator workflow. Wallet authorization and canonical chain reads use separate transports. */
export const DEPLOYMENT_CHAIN_ID = 46630;
export const DEPLOYMENT_ADMIN = '0x86767116cd40bf6b4f8cf88e08d11e38b04364cf';
const ORDINARY_USER = '0x5a2acf1a388fe4f19aeffa404e07e916b5b07b77';
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const DEPLOYMENT_WALLET_LOCK = `alphaforge:deployment:${DEPLOYMENT_CHAIN_ID}:${DEPLOYMENT_ADMIN}`;
export interface DeploymentLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T>,
  ): Promise<T>;
}
/** The namespace includes the wallet and chain, so reissued signing windows cannot race an old tab. */
export async function withDeploymentWalletLock<T>(
  manager: DeploymentLockManager | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (!manager) fail('DEPLOYMENT_BROWSER_LOCKS_REQUIRED');
  return manager.request(DEPLOYMENT_WALLET_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) fail('DEPLOYMENT_ANOTHER_TAB_ACTIVE');
    return work();
  });
}
export interface DeploymentProvider {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...values: unknown[]) => void): void;
}
const DEPLOYMENT_READ_METHODS = new Set([
  'eth_chainId',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getBlockByNumber',
  'eth_getTransactionCount',
  'eth_getBalance',
  'eth_getCode',
  'eth_gasPrice',
  'eth_estimateGas',
  'eth_call',
]);
const MAX_RPC_REQUEST_BYTES = 128 * 1024;
const MAX_RPC_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEPLOYMENT_READ_RPC_URL = ROBINHOOD_CHAIN_TESTNET.rpcUrl;

/** This transport has one official endpoint and cannot request wallet access, sign, or broadcast. */
export function createDeploymentReadProvider(fetcher: typeof fetch = fetch): DeploymentProvider {
  let nextId = 0;
  return {
    async request(input) {
      const method = input.method;
      if (!DEPLOYMENT_READ_METHODS.has(method)) fail('DEPLOYMENT_READ_RPC_METHOD_FORBIDDEN');
      if (input.params !== undefined && (!Array.isArray(input.params) || input.params.length > 2))
        fail('DEPLOYMENT_READ_RPC_REQUEST_INVALID');
      if (!Number.isSafeInteger(++nextId)) fail('DEPLOYMENT_READ_RPC_REQUEST_INVALID');
      const id = nextId;
      let body: string;
      try {
        body = JSON.stringify({ jsonrpc: '2.0', id, method, params: input.params ?? [] });
      } catch {
        fail('DEPLOYMENT_READ_RPC_REQUEST_INVALID');
      }
      if (new TextEncoder().encode(body).byteLength > MAX_RPC_REQUEST_BYTES)
        fail('DEPLOYMENT_READ_RPC_REQUEST_TOO_LARGE');
      let response: Response;
      try {
        response = await fetcher(DEPLOYMENT_READ_RPC_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        fail('DEPLOYMENT_READ_RPC_UNAVAILABLE');
      }
      if (response.status !== 200 || !response.body) fail('DEPLOYMENT_READ_RPC_UNAVAILABLE');
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          let part: ReadableStreamReadResult<Uint8Array>;
          try {
            part = await reader.read();
          } catch {
            fail('DEPLOYMENT_READ_RPC_UNAVAILABLE');
          }
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_RPC_RESPONSE_BYTES) fail('DEPLOYMENT_READ_RPC_RESPONSE_TOO_LARGE');
          chunks.push(part.value);
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          // A closed or aborted network stream needs no further cleanup.
        }
      }
      const responseBytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        responseBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let envelope: Record<string, unknown>;
      try {
        envelope = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(responseBytes)));
      } catch {
        fail('DEPLOYMENT_READ_RPC_RESPONSE_INVALID');
      }
      if (
        envelope.jsonrpc !== '2.0' ||
        envelope.id !== id ||
        !Object.hasOwn(envelope, 'result') ||
        Object.hasOwn(envelope, 'error')
      )
        fail('DEPLOYMENT_READ_RPC_RESPONSE_INVALID');
      return envelope.result;
    },
  };
}
export interface DeploymentAction {
  operation: string;
  chainId: number;
  caller: string;
  contractAddress: string;
  function: string;
  recipient: string;
  nonce?: number;
  inputAssets: string[];
  inputAmounts: string[];
  expectedOutput: unknown;
  unsigned: { to: string | null; data: string; value: string } | null;
  status?: string;
}
export interface DeploymentBudget {
  maxGasPerTransactionRaw: string;
  maxFeePerGasRaw: string;
  maxPriorityFeePerGasRaw: string;
  maxTotalGasCostWei: string;
  maxTotalNativeValueWei: string;
  minimumRemainingEthRaw: string;
  maxHeadAgeSeconds: number;
}
export interface DeploymentPayload {
  schemaVersion: 1;
  chainId: 46630;
  approvedWallet: string;
  approvalExpiresAt: number;
  plan: {
    schemaVersion: 2;
    chainId: 46630;
    inputs: Record<string, string | number>;
    proceedsRecipient: string;
    actions: DeploymentAction[];
    addresses: Record<string, string>;
  };
  budget: DeploymentBudget;
}
export type DeploymentState =
  'INTENT' | 'SUBMITTED' | 'INCLUDED' | 'CONFIRMED' | 'UNKNOWN' | 'REVERTED' | 'REORGED';
export interface DeploymentEntry {
  index: number;
  state: DeploymentState;
  gasLimitRaw: string;
  maxFeePerGasRaw: string;
  maxPriorityFeePerGasRaw: string;
  transactionHash: string | null;
  blockNumber: string | null;
  blockHash: string | null;
  gasUsedRaw: string | null;
  effectiveGasPriceRaw: string | null;
}
export interface DeploymentJournal {
  schemaVersion: 1;
  payloadSha256: string;
  chainId: 46630;
  wallet: string;
  entries: DeploymentEntry[];
}
function fail(code: string): never {
  throw new Error(code);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_DEPLOYMENT_DATA');
  return value as Record<string, unknown>;
}
function raw(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) fail('INVALID_DEPLOYMENT_INTEGER');
  const result = BigInt(value);
  if (result >= 2n ** 256n) fail('INVALID_DEPLOYMENT_INTEGER');
  return result;
}
function quantity(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^0x(0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) {
    const kind =
      value === undefined
        ? 'missing'
        : value === null
          ? 'null'
          : typeof value !== 'string'
            ? 'non-string'
            : 'noncanonical';
    fail(`INVALID_WALLET_RPC_RESPONSE: ${field} (${kind})`);
  }
  return BigInt(value);
}
function address(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0+$/.test(value))
    fail('INVALID_DEPLOYMENT_ADDRESS');
  return value.toLowerCase();
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail('INVALID_TRANSACTION_HASH');
  return value.toLowerCase();
}
const hex = (value: bigint) => '0x' + value.toString(16);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function bytes(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !/^0x(?:[a-fA-F0-9]{2})+$/.test(value) || (value.length - 2) / 2 > limit)
    fail('INVALID_DEPLOYMENT_CALLDATA');
  return value.toLowerCase();
}

export function validateDeploymentPayload(value: unknown): DeploymentPayload {
  const envelope = object(value),
    plan = object(envelope.plan),
    inputs = object(plan.inputs),
    budget = object(envelope.budget);
  if (
    envelope.schemaVersion !== 1 ||
    envelope.chainId !== DEPLOYMENT_CHAIN_ID ||
    plan.schemaVersion !== 2 ||
    plan.chainId !== DEPLOYMENT_CHAIN_ID ||
    address(envelope.approvedWallet) !== DEPLOYMENT_ADMIN ||
    !Number.isSafeInteger(envelope.approvalExpiresAt) ||
    Number(envelope.approvalExpiresAt) < 1 ||
    inputs.nonce !== 0 ||
    address(plan.proceedsRecipient) !== DEPLOYMENT_ADMIN
  )
    fail('DEPLOYMENT_APPROVAL_MISMATCH');
  for (const role of ['deployer', 'administrator', 'tslaLpRecipient', 'amznLpRecipient'])
    if (address(inputs[role]) !== DEPLOYMENT_ADMIN) fail('DEPLOYMENT_ROLE_MISMATCH');
  const quoteSigner = address(inputs.quoteSigner),
    claimSigner = address(inputs.claimSigner);
  if (
    quoteSigner === claimSigner ||
    [quoteSigner, claimSigner].some((signer) => [ORDINARY_USER, DEPLOYMENT_ADMIN].includes(signer))
  )
    fail('DEPLOYMENT_SIGNER_SEPARATION');
  const approved = {
    usdcSupplyRaw: '2000000000000',
    conversionUsdcRaw: '100000000000',
    conversionEthRaw: '2000000000000000',
    ethPerTransactionRaw: '200000000000000',
    ethPerAccountDailyRaw: '1000000000000000',
    ethGlobalDailyRaw: '1600000000000000',
    ethMinimumReserveRaw: '200000000000000',
  };
  for (const [key, amount] of Object.entries(approved))
    if (inputs[key] !== amount) fail('DEPLOYMENT_FUNDING_MISMATCH');
  if (!Array.isArray(plan.actions) || plan.actions.length !== 43) fail('DEPLOYMENT_ACTION_COUNT');
  let transactionIndex = 0,
    nativeValue = 0n;
  for (const unknownAction of plan.actions) {
    const action = object(unknownAction);
    if (
      action.chainId !== DEPLOYMENT_CHAIN_ID ||
      address(action.caller) !== DEPLOYMENT_ADMIN ||
      typeof action.operation !== 'string' ||
      action.operation.length > 128 ||
      typeof action.function !== 'string' ||
      action.function.length > 128 ||
      !Array.isArray(action.inputAssets) ||
      !Array.isArray(action.inputAmounts) ||
      action.inputAssets.length !== action.inputAmounts.length
    )
      fail('DEPLOYMENT_ACTION_MISMATCH');
    address(action.contractAddress);
    address(action.recipient);
    action.inputAssets.forEach((asset) => {
      if (typeof asset !== 'string' || asset.length > 128) fail('DEPLOYMENT_ASSET_MISMATCH');
    });
    action.inputAmounts.forEach(raw);
    if (action.unsigned === null) {
      if (action.status !== 'REQUIRES_FRESH_TEST_REFERENCE') fail('DEPLOYMENT_UNSIGNED_ACTION_REQUIRED');
      continue;
    }
    const unsigned = object(action.unsigned);
    if (unsigned.to === null) {
      if (action.nonce !== transactionIndex || action.function !== 'constructor')
        fail('DEPLOYMENT_NONCE_MISMATCH');
      bytes(unsigned.data, 49152);
    } else {
      if (address(unsigned.to) !== address(action.contractAddress)) fail('DEPLOYMENT_TARGET_MISMATCH');
      bytes(unsigned.data, 4096);
    }
    const amount = raw(unsigned.value);
    if (amount !== (action.operation === 'conversionReserve:fundNative' ? 2000000000000000n : 0n))
      fail('DEPLOYMENT_NATIVE_VALUE_MISMATCH');
    nativeValue += amount;
    transactionIndex++;
  }
  if (transactionIndex !== 41 || nativeValue !== 2000000000000000n) fail('DEPLOYMENT_ACTION_COUNT');
  const gas = raw(budget.maxGasPerTransactionRaw),
    fee = raw(budget.maxFeePerGasRaw),
    priority = raw(budget.maxPriorityFeePerGasRaw),
    totalGas = raw(budget.maxTotalGasCostWei),
    nativeCap = raw(budget.maxTotalNativeValueWei),
    retained = raw(budget.minimumRemainingEthRaw);
  if (
    gas === 0n ||
    gas > 12000000n ||
    fee === 0n ||
    fee > 20000000n ||
    priority > fee ||
    totalGas === 0n ||
    totalGas > 10000000000000000n ||
    41n * gas * fee > totalGas ||
    nativeCap !== nativeValue ||
    retained < 500000000000000n ||
    !Number.isSafeInteger(budget.maxHeadAgeSeconds) ||
    Number(budget.maxHeadAgeSeconds) < 1 ||
    Number(budget.maxHeadAgeSeconds) > 60
  )
    fail('DEPLOYMENT_BUDGET_MISMATCH');
  return clone(value) as DeploymentPayload;
}

/** A compile-time digest qualifies the exact public bytes before any wallet can be requested. */
export async function parsePinnedDeploymentPayload(
  payloadBytes: Uint8Array,
  pinnedSha256: string,
): Promise<DeploymentPayload> {
  if (payloadBytes.byteLength > MAX_PAYLOAD_BYTES || !/^[0-9a-f]{64}$/.test(pinnedSha256))
    fail('DEPLOYMENT_PAYLOAD_PIN_REQUIRED');
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(payloadBytes));
  const actual = Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
  if (actual !== pinnedSha256) fail('DEPLOYMENT_PAYLOAD_DIGEST_MISMATCH');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  } catch {
    fail('INVALID_DEPLOYMENT_PAYLOAD');
  }
  return validateDeploymentPayload(value);
}

export async function loadPinnedDeploymentPayload(
  url: string,
  pinnedSha256: string,
): Promise<DeploymentPayload> {
  const endpoint = new URL(url, window.location.href);
  if (
    endpoint.origin !== window.location.origin ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.search
  )
    fail('DEPLOYMENT_PAYLOAD_ORIGIN_MISMATCH');
  const response = await fetch(endpoint, {
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !response.body) fail('DEPLOYMENT_PAYLOAD_UNAVAILABLE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_PAYLOAD_BYTES) fail('DEPLOYMENT_PAYLOAD_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return parsePinnedDeploymentPayload(body, pinnedSha256);
}

export class DeploymentWalletSession {
  readonly payload: DeploymentPayload;
  readonly actions: readonly DeploymentAction[];
  readonly payloadSha256: string;
  readonly #provider: DeploymentProvider;
  readonly #readProvider: DeploymentProvider;
  readonly #save: (journal: DeploymentJournal) => void;
  readonly #now: () => number;
  #journal: DeploymentJournal;
  #busy = false;
  #storageFailed = false;
  lastObservedHash: string | null = null;
  lastBalanceRaw: string | null = null;
  constructor(options: {
    provider: DeploymentProvider;
    readProvider?: DeploymentProvider;
    payload: DeploymentPayload;
    payloadSha256: string;
    save: (journal: DeploymentJournal) => void;
    journal?: unknown;
    now?: () => number;
  }) {
    this.payload = validateDeploymentPayload(options.payload);
    this.actions = this.payload.plan.actions.filter((action) => action.unsigned !== null);
    if (!/^[a-f0-9]{64}$/.test(options.payloadSha256)) fail('DEPLOYMENT_PAYLOAD_PIN_REQUIRED');
    this.payloadSha256 = options.payloadSha256;
    this.#provider = options.provider;
    this.#readProvider = options.readProvider ?? createDeploymentReadProvider();
    this.#save = options.save;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#journal = {
      schemaVersion: 1,
      payloadSha256: this.payloadSha256,
      chainId: 46630,
      wallet: DEPLOYMENT_ADMIN,
      entries: [],
    };
    if (options.journal !== undefined) this.#journal = this.#validateJournal(options.journal);
  }
  get journal(): DeploymentJournal {
    return clone(this.#journal);
  }
  verificationReceipts() {
    if (
      this.#journal.entries.length !== 41 ||
      this.#journal.entries.some((entry) => entry.state !== 'CONFIRMED' || !entry.transactionHash)
    )
      fail('DEPLOYMENT_ALL_RECEIPTS_REQUIRED');
    return {
      schemaVersion: 1,
      payloadSha256: this.payloadSha256,
      chainId: 46630,
      transactions: this.#journal.entries.map((entry) => hash(entry.transactionHash)),
    };
  }
  get nextIndex(): number {
    return this.#journal.entries.findIndex((entry) => entry.state !== 'CONFIRMED') >= 0
      ? this.#journal.entries.findIndex((entry) => entry.state !== 'CONFIRMED')
      : this.#journal.entries.length;
  }
  #validateJournal(value: unknown): DeploymentJournal {
    const journal = object(value);
    if (
      journal.schemaVersion !== 1 ||
      journal.payloadSha256 !== this.payloadSha256 ||
      journal.chainId !== 46630 ||
      address(journal.wallet) !== DEPLOYMENT_ADMIN ||
      !Array.isArray(journal.entries) ||
      journal.entries.length > 41
    )
      fail('DEPLOYMENT_JOURNAL_MISMATCH');
    journal.entries.forEach((unknownEntry, index) => {
      const entry = object(unknownEntry);
      if (
        entry.index !== index ||
        !['INTENT', 'SUBMITTED', 'INCLUDED', 'CONFIRMED', 'UNKNOWN', 'REVERTED', 'REORGED'].includes(
          String(entry.state),
        ) ||
        raw(entry.gasLimitRaw) === 0n ||
        raw(entry.gasLimitRaw) > raw(this.payload.budget.maxGasPerTransactionRaw) ||
        raw(entry.maxFeePerGasRaw) === 0n ||
        raw(entry.maxFeePerGasRaw) > raw(this.payload.budget.maxFeePerGasRaw) ||
        raw(entry.maxPriorityFeePerGasRaw) > raw(entry.maxFeePerGasRaw) ||
        raw(entry.maxPriorityFeePerGasRaw) > raw(this.payload.budget.maxPriorityFeePerGasRaw)
      )
        fail('DEPLOYMENT_JOURNAL_MISMATCH');
      if (entry.transactionHash !== null) hash(entry.transactionHash);
      if (entry.state === 'CONFIRMED' && entry.transactionHash === null) fail('DEPLOYMENT_JOURNAL_MISMATCH');
      if (entry.blockNumber !== null) raw(entry.blockNumber);
      if (entry.blockHash !== null) hash(entry.blockHash);
      if (entry.gasUsedRaw !== null) raw(entry.gasUsedRaw);
      if (entry.effectiveGasPriceRaw !== null) raw(entry.effectiveGasPriceRaw);
    });
    return clone(value) as DeploymentJournal;
  }
  #persist(journal: DeploymentJournal) {
    const checked = this.#validateJournal(journal);
    try {
      this.#save(clone(checked));
    } catch {
      this.#storageFailed = true;
      fail('DEPLOYMENT_RECOVERY_STORAGE_FAILED');
    }
    this.#journal = checked;
  }
  async #identity() {
    if (
      quantity(await this.#readProvider.request({ method: 'eth_chainId' }), 'eth_chainId.result') !== 46630n
    )
      fail('DEPLOYMENT_READ_RPC_WRONG_NETWORK');
    if (quantity(await this.#provider.request({ method: 'eth_chainId' }), 'eth_chainId.result') !== 46630n)
      fail('DEPLOYMENT_WRONG_NETWORK');
    const accounts = await this.#provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || accounts.length === 0 || address(accounts[0]) !== DEPLOYMENT_ADMIN)
      fail('DEPLOYMENT_WRONG_WALLET');
    if (quantity(await this.#provider.request({ method: 'eth_chainId' }), 'eth_chainId.result') !== 46630n)
      fail('DEPLOYMENT_WRONG_NETWORK');
  }
  async #walletNonceGuard(index: number) {
    // The wallet can know about a queued transaction before the public RPC sees its mempool entry.
    const latest = quantity(
        await this.#provider.request({
          method: 'eth_getTransactionCount',
          params: [DEPLOYMENT_ADMIN, 'latest'],
        }),
        'eth_getTransactionCount.result',
      ),
      pending = quantity(
        await this.#provider.request({
          method: 'eth_getTransactionCount',
          params: [DEPLOYMENT_ADMIN, 'pending'],
        }),
        'eth_getTransactionCount.result',
      );
    if (latest !== BigInt(index) || pending !== latest) fail('DEPLOYMENT_NONCE_COMPETITION');
  }
  async connect() {
    await this.#provider.request({ method: 'eth_requestAccounts' });
    if (quantity(await this.#provider.request({ method: 'eth_chainId' }), 'eth_chainId.result') !== 46630n) {
      const switchNetwork = () =>
        this.#provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex(46630n) }] });
      try {
        await switchNetwork();
      } catch (caught) {
        if (!caught || typeof caught !== 'object' || !('code' in caught) || caught.code !== 4902)
          throw caught;
        await this.#provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hex(46630n),
              chainName: ROBINHOOD_CHAIN_TESTNET.name,
              nativeCurrency: { name: 'Ether', symbol: ROBINHOOD_CHAIN_TESTNET.nativeCurrency, decimals: 18 },
              rpcUrls: [ROBINHOOD_CHAIN_TESTNET.rpcUrl],
              blockExplorerUrls: [ROBINHOOD_CHAIN_TESTNET.explorerUrl],
            },
          ],
        });
        await switchNetwork();
      }
    }
    await this.#identity();
  }
  #transaction(index: number, entry: DeploymentEntry) {
    const action = this.actions[index]!,
      unsigned = action.unsigned!;
    return {
      from: DEPLOYMENT_ADMIN,
      ...(unsigned.to === null ? {} : { to: address(unsigned.to) }),
      data: unsigned.data,
      value: hex(raw(unsigned.value)),
      chainId: hex(46630n),
      nonce: hex(BigInt(index)),
      type: '0x2',
      gas: hex(raw(entry.gasLimitRaw)),
      maxFeePerGas: hex(raw(entry.maxFeePerGasRaw)),
      maxPriorityFeePerGas: hex(raw(entry.maxPriorityFeePerGasRaw)),
    };
  }
  async #head() {
    const block = object(
      await this.#readProvider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }),
    );
    const age = this.#now() - Number(quantity(block.timestamp, 'eth_getBlockByNumber.timestamp'));
    if (age < 0 || age > this.payload.budget.maxHeadAgeSeconds) fail('DEPLOYMENT_STALE_HEAD');
    hash(block.hash);
    quantity(block.number, 'eth_getBlockByNumber.number');
    quantity(block.gasLimit, 'eth_getBlockByNumber.gasLimit');
    return block;
  }
  async #executionLimit(blockTag: string): Promise<bigint> {
    const encoded = await this.#readProvider.request({
      method: 'eth_call',
      params: [
        {
          to: '0x000000000000000000000000000000000000006c',
          data: '0x612af178',
        },
        blockTag,
      ],
    });
    if (typeof encoded !== 'string' || !/^0x[0-9a-fA-F]{192}$/.test(encoded))
      fail('DEPLOYMENT_EXECUTION_LIMIT_UNAVAILABLE');
    const limit = BigInt('0x' + encoded.slice(130, 194));
    if (limit === 0n || limit > 32000000n) fail('DEPLOYMENT_EXECUTION_LIMIT_UNAVAILABLE');
    return limit;
  }
  async #finalPreflight(index: number, entry: DeploymentEntry, remainingGas: bigint, remainingValue: bigint) {
    // Reload all prior receipts after estimation; local journal confirmations are only hints.
    await this.#reconcile();
    if (this.nextIndex !== index || this.#journal.entries.length !== index)
      fail('DEPLOYMENT_RECOVERY_REQUIRED');
    const head = await this.#head(),
      tag = String(head.number),
      budget = this.payload.budget;
    const limit = await this.#executionLimit(tag);
    if (raw(budget.maxGasPerTransactionRaw) > limit || raw(entry.gasLimitRaw) > limit)
      fail('DEPLOYMENT_EXECUTION_GAS_LIMIT');
    const code = await this.#readProvider.request({ method: 'eth_getCode', params: [DEPLOYMENT_ADMIN, tag] });
    if (code !== '0x') fail('DEPLOYMENT_ADMIN_MUST_BE_EOA');
    const target = this.actions[index]!;
    const targetCode = await this.#readProvider.request({
      method: 'eth_getCode',
      params: [target.contractAddress, tag],
    });
    if (
      target.unsigned!.to === null
        ? targetCode !== '0x'
        : typeof targetCode !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(targetCode)
    )
      fail(
        target.unsigned!.to === null
          ? 'DEPLOYMENT_CREATE_ADDRESS_OCCUPIED'
          : 'DEPLOYMENT_TARGET_NOT_DEPLOYED',
      );
    const balance = quantity(
      await this.#readProvider.request({ method: 'eth_getBalance', params: [DEPLOYMENT_ADMIN, tag] }),
      'eth_getBalance.result',
    );
    this.lastBalanceRaw = balance.toString();
    if (balance < remainingGas + remainingValue + raw(budget.minimumRemainingEthRaw))
      fail('DEPLOYMENT_INSUFFICIENT_ETH');
    if (
      (head.baseFeePerGas !== undefined &&
        quantity(head.baseFeePerGas, 'eth_getBlockByNumber.baseFeePerGas') +
          raw(budget.maxPriorityFeePerGasRaw) >
          raw(budget.maxFeePerGasRaw)) ||
      quantity(await this.#readProvider.request({ method: 'eth_gasPrice' }), 'eth_gasPrice.result') >
        raw(budget.maxFeePerGasRaw)
    )
      fail('DEPLOYMENT_FEE_CAP_TOO_LOW');
    await this.#identity();
    const latest = quantity(
        await this.#readProvider.request({
          method: 'eth_getTransactionCount',
          params: [DEPLOYMENT_ADMIN, 'latest'],
        }),
        'eth_getTransactionCount.result',
      ),
      pending = quantity(
        await this.#readProvider.request({
          method: 'eth_getTransactionCount',
          params: [DEPLOYMENT_ADMIN, 'pending'],
        }),
        'eth_getTransactionCount.result',
      );
    if (latest !== BigInt(index) || pending !== latest) fail('DEPLOYMENT_NONCE_COMPETITION');
    const previous = this.#journal.entries.at(-1);
    if (previous) {
      const anchor = object(
        await this.#readProvider.request({
          method: 'eth_getBlockByNumber',
          params: [hex(raw(previous.blockNumber!)), false],
        }),
      );
      if (
        hash(anchor.hash) !== previous.blockHash ||
        quantity(anchor.number, 'eth_getBlockByNumber.number') !== raw(previous.blockNumber!) ||
        quantity(head.number, 'eth_getBlockByNumber.number') < raw(previous.blockNumber!) + 2n
      )
        fail('DEPLOYMENT_CONFIRMATION_ANCHOR_CHANGED');
    }
    const canonicalHead = object(
      await this.#readProvider.request({ method: 'eth_getBlockByNumber', params: [tag, false] }),
    );
    if (
      hash(canonicalHead.hash) !== hash(head.hash) ||
      quantity(canonicalHead.number, 'eth_getBlockByNumber.number') !==
        quantity(head.number, 'eth_getBlockByNumber.number')
    )
      fail('DEPLOYMENT_HEAD_REORGED');
    if (
      this.#now() - Number(quantity(head.timestamp, 'eth_getBlockByNumber.timestamp')) >
      budget.maxHeadAgeSeconds
    )
      fail('DEPLOYMENT_STALE_HEAD');
    await this.#walletNonceGuard(index);
    await this.#identity();
    if (
      this.#now() - Number(quantity(head.timestamp, 'eth_getBlockByNumber.timestamp')) >
      budget.maxHeadAgeSeconds
    )
      fail('DEPLOYMENT_STALE_HEAD');
  }
  #matchesTransaction(value: unknown, index: number, entry: DeploymentEntry, transactionHash: string) {
    const transaction = object(value),
      action = this.actions[index]!,
      unsigned = action.unsigned!;
    if (
      hash(transaction.hash) !== transactionHash ||
      address(transaction.from) !== DEPLOYMENT_ADMIN ||
      (unsigned.to === null ? transaction.to !== null : address(transaction.to) !== address(unsigned.to)) ||
      quantity(transaction.chainId, 'eth_getTransactionByHash.chainId') !== 46630n ||
      quantity(transaction.nonce, 'eth_getTransactionByHash.nonce') !== BigInt(index) ||
      bytes(transaction.input, 65536) !== unsigned.data.toLowerCase() ||
      quantity(transaction.value, 'eth_getTransactionByHash.value') !== raw(unsigned.value) ||
      quantity(transaction.type, 'eth_getTransactionByHash.type') !== 2n ||
      quantity(transaction.gas, 'eth_getTransactionByHash.gas') !== raw(entry.gasLimitRaw) ||
      quantity(transaction.maxFeePerGas, 'eth_getTransactionByHash.maxFeePerGas') !==
        raw(entry.maxFeePerGasRaw) ||
      quantity(transaction.maxPriorityFeePerGas, 'eth_getTransactionByHash.maxPriorityFeePerGas') !==
        raw(entry.maxPriorityFeePerGasRaw) ||
      (transaction.accessList !== undefined &&
        (!Array.isArray(transaction.accessList) || transaction.accessList.length !== 0))
    )
      fail('DEPLOYMENT_TRANSACTION_MISMATCH');
    return transaction;
  }
  async #observe(entry: DeploymentEntry): Promise<DeploymentEntry> {
    if (!entry.transactionHash) return { ...entry, state: 'UNKNOWN' };
    const transactionHash = hash(entry.transactionHash),
      transaction = await this.#readProvider.request({
        method: 'eth_getTransactionByHash',
        params: [transactionHash],
      }),
      receiptValue = await this.#readProvider.request({
        method: 'eth_getTransactionReceipt',
        params: [transactionHash],
      });
    if (!transaction) return { ...entry, state: 'UNKNOWN' };
    const tx = this.#matchesTransaction(transaction, entry.index, entry, transactionHash);
    if (!receiptValue)
      return { ...entry, state: tx.blockNumber === null && tx.blockHash === null ? 'SUBMITTED' : 'UNKNOWN' };
    const receipt = object(receiptValue),
      action = this.actions[entry.index]!,
      unsigned = action.unsigned!,
      blockNumber = quantity(receipt.blockNumber, 'eth_getTransactionReceipt.blockNumber'),
      blockHash = hash(receipt.blockHash),
      transactionPending = tx.blockNumber === null && tx.blockHash === null;
    if (
      hash(receipt.transactionHash) !== transactionHash ||
      address(receipt.from) !== DEPLOYMENT_ADMIN ||
      (unsigned.to === null ? receipt.to !== null : address(receipt.to) !== address(unsigned.to)) ||
      (!transactionPending &&
        (hash(tx.blockHash) !== blockHash ||
          quantity(tx.blockNumber, 'eth_getTransactionByHash.blockNumber') !== blockNumber))
    )
      fail('DEPLOYMENT_RECEIPT_MISMATCH');
    const canonical = object(
      await this.#readProvider.request({ method: 'eth_getBlockByNumber', params: [hex(blockNumber), false] }),
    );
    if (quantity(canonical.number, 'eth_getBlockByNumber.number') !== blockNumber)
      fail('DEPLOYMENT_RECEIPT_MISMATCH');
    if (hash(canonical.hash) !== blockHash) return { ...entry, state: 'REORGED' };
    const status = quantity(receipt.status, 'eth_getTransactionReceipt.status');
    if (status === 0n) return { ...entry, state: 'REVERTED' };
    if (
      status !== 1n ||
      (unsigned.to === null
        ? address(receipt.contractAddress) !== address(action.contractAddress)
        : receipt.contractAddress !== null)
    )
      fail('DEPLOYMENT_RECEIPT_MISMATCH');
    const gasUsed = quantity(receipt.gasUsed, 'eth_getTransactionReceipt.gasUsed'),
      effectiveGasPrice = quantity(receipt.effectiveGasPrice, 'eth_getTransactionReceipt.effectiveGasPrice');
    if (gasUsed > raw(entry.gasLimitRaw) || effectiveGasPrice > raw(entry.maxFeePerGasRaw))
      fail('DEPLOYMENT_RECEIPT_BUDGET_MISMATCH');
    // RPC methods can observe inclusion at different times. Keep the known hash until both agree.
    if (transactionPending) return { ...entry, state: 'SUBMITTED' };
    const head = await this.#head();
    const canonicalAgain = object(
      await this.#readProvider.request({ method: 'eth_getBlockByNumber', params: [hex(blockNumber), false] }),
    );
    if (quantity(canonicalAgain.number, 'eth_getBlockByNumber.number') !== blockNumber)
      fail('DEPLOYMENT_RECEIPT_MISMATCH');
    if (hash(canonicalAgain.hash) !== blockHash) return { ...entry, state: 'REORGED' };
    const confirmed = quantity(head.number, 'eth_getBlockByNumber.number') >= blockNumber + 2n;
    return {
      ...entry,
      state: confirmed ? 'CONFIRMED' : 'INCLUDED',
      blockNumber: blockNumber.toString(),
      blockHash,
      gasUsedRaw: gasUsed.toString(),
      effectiveGasPriceRaw: effectiveGasPrice.toString(),
    };
  }
  async #reconcile() {
    await this.#identity();
    const journal = this.journal;
    for (let index = 0; index < journal.entries.length; index++) {
      journal.entries[index] = await this.#observe(journal.entries[index]!);
      if (journal.entries[index]!.state !== 'CONFIRMED') {
        // Later saved confirmations have no authority while an earlier dependency is unresolved.
        for (let later = index + 1; later < journal.entries.length; later++)
          journal.entries[later] = { ...journal.entries[later]!, state: 'UNKNOWN' };
        break;
      }
    }
    await this.#identity();
    this.#persist(journal);
    const spent = journal.entries.reduce(
      (sum, entry) =>
        sum + (entry.state === 'CONFIRMED' ? raw(entry.gasUsedRaw!) * raw(entry.effectiveGasPriceRaw!) : 0n),
      0n,
    );
    if (spent > raw(this.payload.budget.maxTotalGasCostWei)) fail('DEPLOYMENT_TOTAL_GAS_BUDGET');
  }
  async reconcile() {
    if (this.#busy) fail('DEPLOYMENT_REQUEST_IN_PROGRESS');
    this.#busy = true;
    try {
      await this.#reconcile();
      return this.journal;
    } finally {
      this.#busy = false;
    }
  }
  async sendNext() {
    if (this.#busy) fail('DEPLOYMENT_REQUEST_IN_PROGRESS');
    this.#busy = true;
    try {
      if (this.#storageFailed) fail('DEPLOYMENT_RECOVERY_STORAGE_FAILED');
      await this.#reconcile();
      const index = this.nextIndex;
      if (index !== this.#journal.entries.length) fail('DEPLOYMENT_RECOVERY_REQUIRED');
      if (index >= 41) fail('DEPLOYMENT_PLAN_FINISHED');
      if (this.#now() >= this.payload.approvalExpiresAt) fail('DEPLOYMENT_APPROVAL_EXPIRED');
      const latest = quantity(
          await this.#readProvider.request({
            method: 'eth_getTransactionCount',
            params: [DEPLOYMENT_ADMIN, 'latest'],
          }),
          'eth_getTransactionCount.result',
        ),
        pending = quantity(
          await this.#readProvider.request({
            method: 'eth_getTransactionCount',
            params: [DEPLOYMENT_ADMIN, 'pending'],
          }),
          'eth_getTransactionCount.result',
        );
      if (latest !== BigInt(index) || pending !== latest) fail('DEPLOYMENT_NONCE_COMPETITION');
      const head = await this.#head(),
        budget = this.payload.budget,
        balance = quantity(
          await this.#readProvider.request({
            method: 'eth_getBalance',
            params: [DEPLOYMENT_ADMIN, 'latest'],
          }),
          'eth_getBalance.result',
        );
      this.lastBalanceRaw = balance.toString();
      const remaining = this.actions.slice(index),
        remainingValue = remaining.reduce((sum, action) => sum + raw(action.unsigned!.value), 0n),
        spentGas = this.#journal.entries.reduce(
          (sum, entry) => sum + raw(entry.gasUsedRaw!) * raw(entry.effectiveGasPriceRaw!),
          0n,
        ),
        remainingGas =
          BigInt(remaining.length) * raw(budget.maxGasPerTransactionRaw) * raw(budget.maxFeePerGasRaw);
      if (spentGas + remainingGas > raw(budget.maxTotalGasCostWei)) fail('DEPLOYMENT_TOTAL_GAS_BUDGET');
      if (balance < remainingGas + remainingValue + raw(budget.minimumRemainingEthRaw))
        fail('DEPLOYMENT_INSUFFICIENT_ETH');
      if (
        head.baseFeePerGas !== undefined &&
        quantity(head.baseFeePerGas, 'eth_getBlockByNumber.baseFeePerGas') +
          raw(budget.maxPriorityFeePerGasRaw) >
          raw(budget.maxFeePerGasRaw)
      )
        fail('DEPLOYMENT_FEE_CAP_TOO_LOW');
      const entry: DeploymentEntry = {
        index,
        state: 'INTENT',
        gasLimitRaw: budget.maxGasPerTransactionRaw,
        maxFeePerGasRaw: budget.maxFeePerGasRaw,
        maxPriorityFeePerGasRaw: budget.maxPriorityFeePerGasRaw,
        transactionHash: null,
        blockNumber: null,
        blockHash: null,
        gasUsedRaw: null,
        effectiveGasPriceRaw: null,
      };
      const estimate = quantity(
        await this.#readProvider.request({
          method: 'eth_estimateGas',
          params: [this.#transaction(index, entry)],
        }),
        'eth_estimateGas.result',
      );
      if (estimate === 0n || estimate > raw(budget.maxGasPerTransactionRaw)) fail('DEPLOYMENT_GAS_LIMIT');
      const buffered = (estimate * 120n + 99n) / 100n;
      entry.gasLimitRaw = (
        buffered > raw(budget.maxGasPerTransactionRaw) ? raw(budget.maxGasPerTransactionRaw) : buffered
      ).toString();
      await this.#finalPreflight(index, entry, remainingGas, remainingValue);
      this.#persist({ ...this.journal, entries: [...this.#journal.entries, entry] });
      // No await occurs between this fresh deadline check and opening the wallet prompt.
      if (this.#now() >= this.payload.approvalExpiresAt) fail('DEPLOYMENT_APPROVAL_EXPIRED');
      let returned: unknown;
      try {
        returned = await this.#provider.request({
          method: 'eth_sendTransaction',
          params: [this.#transaction(index, entry)],
        });
      } catch {
        this.#persist({
          ...this.journal,
          entries: this.#journal.entries.map((current) =>
            current.index === index ? { ...current, state: 'UNKNOWN' } : current,
          ),
        });
        fail('DEPLOYMENT_WALLET_RESULT_UNKNOWN');
      }
      let transactionHash: string;
      try {
        transactionHash = hash(returned);
      } catch {
        this.#persist({
          ...this.journal,
          entries: this.#journal.entries.map((current) =>
            current.index === index ? { ...current, state: 'UNKNOWN' } : current,
          ),
        });
        fail('DEPLOYMENT_WALLET_RESULT_UNKNOWN');
      }
      this.lastObservedHash = transactionHash;
      this.#persist({
        ...this.journal,
        entries: this.#journal.entries.map((current) =>
          current.index === index ? { ...current, state: 'SUBMITTED', transactionHash } : current,
        ),
      });
      await this.#reconcile();
      return this.journal;
    } finally {
      this.#busy = false;
    }
  }
  /** Recovery only reads chain state; it never invokes a signing or submission method. */
  async recover(transactionHashInput: string) {
    if (this.#busy) fail('DEPLOYMENT_REQUEST_IN_PROGRESS');
    this.#busy = true;
    try {
      await this.#identity();
      const transactionHash = hash(transactionHashInput),
        index = this.nextIndex,
        entry = this.#journal.entries[index];
      if (!entry || entry.state === 'CONFIRMED') fail('DEPLOYMENT_RECOVERY_INTENT_REQUIRED');
      const recovered = await this.#observe({ ...entry, transactionHash });
      if (recovered.state === 'UNKNOWN' || recovered.state === 'REORGED')
        fail('DEPLOYMENT_RECOVERY_NOT_VERIFIED');
      await this.#identity();
      this.lastObservedHash = transactionHash;
      this.#persist({
        ...this.journal,
        entries: this.#journal.entries.map((current) => (current.index === index ? recovered : current)),
      });
      await this.#reconcile();
      return this.journal;
    } finally {
      this.#busy = false;
    }
  }
}

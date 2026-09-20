import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  type Address,
  type BlockHash,
  type HexData,
  type TransactionHash,
} from './types.ts';

export interface RpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params: readonly unknown[];
}

export interface RpcTransportResponse {
  readonly status: number;
  readonly body: string;
}

export type RpcTransport = (
  endpoint: string,
  request: RpcRequest,
  signal: AbortSignal,
  maxResponseBytes: number,
) => Promise<RpcTransportResponse>;

export class RpcFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable = false) {
    super(code);
    this.name = 'RpcFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ChainBlock {
  readonly number: bigint;
  readonly hash: BlockHash;
  readonly parentHash: BlockHash;
  readonly timestamp: bigint;
}

export interface ChainLog {
  readonly address: Address;
  readonly blockNumber: bigint;
  readonly blockHash: BlockHash;
  readonly transactionHash: TransactionHash;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly data: HexData;
  readonly topics: readonly HexData[];
  readonly removed: boolean;
}

export interface ChainReceipt {
  readonly transactionHash: TransactionHash;
  readonly blockNumber: bigint;
  readonly blockHash: BlockHash;
  readonly transactionIndex: number;
  readonly from: Address;
  readonly to: Address | null;
  readonly status: 'SUCCESS' | 'REVERTED';
  readonly logs: readonly ChainLog[];
}

export interface ChainLogFilter {
  readonly address: Address;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly topics?: readonly (HexData | null)[];
}

export interface ChainCall {
  readonly to: Address;
  readonly data: HexData;
}

export interface CanonicalBlockReference {
  readonly blockHash: BlockHash;
  readonly requireCanonical: true;
}

export type ChainCallBlock = bigint | 'latest' | CanonicalBlockReference;

export interface ReadonlyRpc {
  chainId(): Promise<number>;
  block(number: bigint | 'latest'): Promise<ChainBlock | null>;
  code(address: Address, block: bigint | 'latest'): Promise<HexData>;
  receipt(hash: TransactionHash): Promise<ChainReceipt | null>;
  logs(filter: ChainLogFilter): Promise<readonly ChainLog[]>;
  call(request: ChainCall, block: ChainCallBlock): Promise<HexData>;
}

interface RpcOptions {
  readonly transport?: RpcTransport;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly maxResponseBytes?: number;
}

async function boundedResponseBody(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && BigInt(contentLength) > BigInt(maximumBytes))
    throw new RpcFailure('RPC_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new RpcFailure('RPC_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RpcFailure('RPC_INVALID_RESPONSE');
  }
}

export function createFetchTransport(fetcher: typeof fetch = fetch): RpcTransport {
  return async (endpoint, request, signal, maxResponseBytes) => {
    const response = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (response.status < 200 || response.status >= 300) return { status: response.status, body: '' };
    return { status: response.status, body: await boundedResponseBody(response, maxResponseBytes) };
  };
}

const defaultTransport = createFetchTransport();

function endpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RpcFailure('RPC_INVALID_ENDPOINT');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new RpcFailure('RPC_INVALID_ENDPOINT');
  return url.toString();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RpcFailure('RPC_INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))
    throw new RpcFailure('RPC_INVALID_RESPONSE');
  return BigInt(value);
}

function safeIndex(value: unknown): number {
  const parsed = quantity(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new RpcFailure('RPC_INVALID_RESPONSE');
  return Number(parsed);
}

function hexQuantity(value: bigint): string {
  if (value < 0n) throw new RpcFailure('RPC_INVALID_REQUEST');
  return `0x${value.toString(16)}`;
}

function parseLog(value: unknown): ChainLog {
  const row = object(value);
  if (!Array.isArray(row.topics) || typeof row.removed !== 'boolean')
    throw new RpcFailure('RPC_INVALID_RESPONSE');
  try {
    const topics = row.topics.map((topic) => {
      if (typeof topic !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(topic))
        throw new RpcFailure('RPC_INVALID_RESPONSE');
      return asHexData(topic);
    });
    return Object.freeze({
      address: asAddress(String(row.address)),
      blockNumber: quantity(row.blockNumber),
      blockHash: asBlockHash(String(row.blockHash)),
      transactionHash: asTransactionHash(String(row.transactionHash)),
      transactionIndex: safeIndex(row.transactionIndex),
      logIndex: safeIndex(row.logIndex),
      data: asHexData(String(row.data)),
      topics: Object.freeze(topics),
      removed: row.removed,
    });
  } catch (error) {
    if (error instanceof RpcFailure) throw error;
    throw new RpcFailure('RPC_INVALID_RESPONSE');
  }
}

function parseBlock(value: unknown): ChainBlock | null {
  if (value === null) return null;
  const row = object(value);
  try {
    return Object.freeze({
      number: quantity(row.number),
      hash: asBlockHash(String(row.hash)),
      parentHash: asBlockHash(String(row.parentHash)),
      timestamp: quantity(row.timestamp),
    });
  } catch (error) {
    if (error instanceof RpcFailure) throw error;
    throw new RpcFailure('RPC_INVALID_RESPONSE');
  }
}

function parseReceipt(value: unknown): ChainReceipt | null {
  if (value === null) return null;
  const row = object(value);
  if (!Array.isArray(row.logs) || (row.to !== null && typeof row.to !== 'string'))
    throw new RpcFailure('RPC_INVALID_RESPONSE');
  try {
    const receiptStatus = quantity(row.status);
    if (receiptStatus !== 0n && receiptStatus !== 1n) throw new RpcFailure('RPC_INVALID_RESPONSE');
    return Object.freeze({
      transactionHash: asTransactionHash(String(row.transactionHash)),
      blockNumber: quantity(row.blockNumber),
      blockHash: asBlockHash(String(row.blockHash)),
      transactionIndex: safeIndex(row.transactionIndex),
      from: asAddress(String(row.from)),
      to: row.to === null ? null : asAddress(row.to),
      status: receiptStatus === 1n ? 'SUCCESS' : 'REVERTED',
      logs: Object.freeze(row.logs.map(parseLog)),
    });
  } catch (error) {
    if (error instanceof RpcFailure) throw error;
    throw new RpcFailure('RPC_INVALID_RESPONSE');
  }
}

export class JsonRpcClient implements ReadonlyRpc {
  readonly #endpoints: readonly string[];
  readonly #transport: RpcTransport;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #maxResponseBytes: number;
  #nextId = 1;

  constructor(endpoints: readonly string[], options: RpcOptions = {}) {
    if (!Array.isArray(endpoints) || endpoints.length < 1 || endpoints.length > 8)
      throw new RpcFailure('RPC_INVALID_ENDPOINTS');
    this.#endpoints = Object.freeze(endpoints.map(endpoint));
    this.#transport = options.transport ?? defaultTransport;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#maxAttempts = options.maxAttempts ?? Math.min(3, this.#endpoints.length);
    this.#maxResponseBytes = options.maxResponseBytes ?? 2_000_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 30_000)
      throw new RpcFailure('RPC_INVALID_POLICY');
    if (!Number.isSafeInteger(this.#maxAttempts) || this.#maxAttempts < 1 || this.#maxAttempts > 8)
      throw new RpcFailure('RPC_INVALID_POLICY');
    if (
      !Number.isSafeInteger(this.#maxResponseBytes) ||
      this.#maxResponseBytes < 64 ||
      this.#maxResponseBytes > 10_000_000
    )
      throw new RpcFailure('RPC_INVALID_POLICY');
  }

  async #request(method: string, params: readonly unknown[]): Promise<unknown> {
    const id = this.#nextId++;
    const request: RpcRequest = { jsonrpc: '2.0', id, method, params };
    for (let attempt = 0; attempt < this.#maxAttempts; attempt++) {
      const signal = AbortSignal.timeout(this.#timeoutMs);
      let response: RpcTransportResponse;
      try {
        response = await this.#transport(
          this.#endpoints[attempt % this.#endpoints.length]!,
          request,
          signal,
          this.#maxResponseBytes,
        );
      } catch (error) {
        if (error instanceof RpcFailure && !error.retryable) throw error;
        if (attempt + 1 < this.#maxAttempts) continue;
        throw new RpcFailure('RPC_UNAVAILABLE', true);
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt + 1 < this.#maxAttempts) continue;
        throw new RpcFailure('RPC_UNAVAILABLE', true);
      }
      if (response.status < 200 || response.status >= 300) throw new RpcFailure('RPC_HTTP_ERROR');
      if (Buffer.byteLength(response.body, 'utf8') > this.#maxResponseBytes)
        throw new RpcFailure('RPC_RESPONSE_TOO_LARGE');
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body);
      } catch {
        throw new RpcFailure('RPC_INVALID_RESPONSE');
      }
      const envelope = object(parsed);
      if (envelope.jsonrpc !== '2.0' || envelope.id !== id) throw new RpcFailure('RPC_INVALID_ENVELOPE');
      const hasResult = Object.hasOwn(envelope, 'result');
      const hasError = Object.hasOwn(envelope, 'error');
      if (hasResult === hasError) throw new RpcFailure('RPC_INVALID_ENVELOPE');
      if (hasError) throw new RpcFailure('RPC_REMOTE_ERROR');
      return envelope.result;
    }
    throw new RpcFailure('RPC_UNAVAILABLE', true);
  }

  async chainId(): Promise<number> {
    const parsed = quantity(await this.#request('eth_chainId', []));
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new RpcFailure('RPC_INVALID_RESPONSE');
    return Number(parsed);
  }

  async block(number: bigint | 'latest'): Promise<ChainBlock | null> {
    return parseBlock(
      await this.#request('eth_getBlockByNumber', [
        number === 'latest' ? number : hexQuantity(number),
        false,
      ]),
    );
  }

  async receipt(hash: TransactionHash): Promise<ChainReceipt | null> {
    return parseReceipt(await this.#request('eth_getTransactionReceipt', [hash]));
  }

  async code(address: Address, block: bigint | 'latest'): Promise<HexData> {
    const raw = await this.#request('eth_getCode', [
      address,
      block === 'latest' ? block : hexQuantity(block),
    ]);
    try {
      return asHexData(String(raw));
    } catch {
      throw new RpcFailure('RPC_INVALID_RESPONSE');
    }
  }

  async logs(filter: ChainLogFilter): Promise<readonly ChainLog[]> {
    if (filter.toBlock < filter.fromBlock) throw new RpcFailure('RPC_INVALID_REQUEST');
    const raw = await this.#request('eth_getLogs', [
      {
        address: filter.address,
        fromBlock: hexQuantity(filter.fromBlock),
        toBlock: hexQuantity(filter.toBlock),
        ...(filter.topics ? { topics: filter.topics } : {}),
      },
    ]);
    if (!Array.isArray(raw)) throw new RpcFailure('RPC_INVALID_RESPONSE');
    return Object.freeze(raw.map(parseLog));
  }

  async call(request: ChainCall, block: ChainCallBlock): Promise<HexData> {
    let reference: string | CanonicalBlockReference;
    if (typeof block === 'bigint') reference = hexQuantity(block);
    else if (block === 'latest') reference = block;
    else {
      if (
        !block ||
        block.requireCanonical !== true ||
        Object.keys(block).length !== 2 ||
        !Object.hasOwn(block, 'blockHash') ||
        !Object.hasOwn(block, 'requireCanonical')
      )
        throw new RpcFailure('RPC_INVALID_REQUEST');
      try {
        reference = Object.freeze({ blockHash: asBlockHash(block.blockHash), requireCanonical: true });
      } catch {
        throw new RpcFailure('RPC_INVALID_REQUEST');
      }
    }
    const raw = await this.#request('eth_call', [request, reference]);
    try {
      return asHexData(String(raw));
    } catch {
      throw new RpcFailure('RPC_INVALID_RESPONSE');
    }
  }
}

import { createHash } from 'node:crypto';
import { JsonRpcClient, RpcFailure, createFetchTransport } from '../../chain-adapter/src/rpc.ts';
import type {
  RpcTransport,
  RpcRequest,
  RpcTransportResponse,
  ChainBlock,
} from '../../chain-adapter/src/rpc.ts';
import { asAddress, asBlockHash, asHexData } from '../../chain-adapter/src/types.ts';
import { keccak256 } from '../../chain-adapter/src/keccak.ts';
import { address, requireValue } from './robinhood.ts';

interface ReadCall {
  id: string;
  data: string;
}
export interface PinnedStateRequest {
  chainId: 4663 | 46630;
  block: { number: string; hash: string | null };
  contracts: { address: string; calls: ReadCall[] }[];
}
export interface RpcReceipt {
  request: RpcRequest;
  startedAtMs: number;
  receivedAtMs: number | null;
  httpStatus: number | null;
  responseSha256: string | null;
}
export interface PinnedStateCapture {
  version: 'alphaforge-pinned-state-1';
  status: 'CAPTURED' | 'REJECTED';
  reason: string | null;
  request: PinnedStateRequest | null;
  block: { number: string; hash: string; parentHash: string; timestampSeconds: string } | null;
  contracts: { address: string; code: string; codeHash: string; calls: (ReadCall & { result: string })[] }[];
  receipts: RpcReceipt[];
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'INVALID_SNAPSHOT_REQUEST',
  );
  requireValue(
    Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k)),
    'INVALID_SNAPSHOT_FIELDS',
  );
  return value as Record<string, unknown>;
}
function blockHash(value: unknown): string {
  requireValue(
    typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/.test(value),
    'INVALID_BLOCK_HASH',
  );
  return value.toLowerCase();
}
export function parsePinnedStateRequest(input: unknown): PinnedStateRequest {
  const r = record(input, ['chainId', 'block', 'contracts']);
  requireValue(r.chainId === 4663 || r.chainId === 46630, 'UNSUPPORTED_CHAIN');
  const b = record(r.block, ['number', 'hash']);
  requireValue(typeof b.number === 'string', 'INVALID_BLOCK_SELECTOR');
  if (b.number === 'latest') requireValue(b.hash === null, 'INVALID_BLOCK_SELECTOR');
  else {
    requireValue(
      /^(0|[1-9][0-9]{0,77})$/.test(b.number) && BigInt(b.number) < 1n << 256n,
      'INVALID_BLOCK_SELECTOR',
    );
    blockHash(b.hash);
  }
  requireValue(
    Array.isArray(r.contracts) && r.contracts.length > 0 && r.contracts.length <= 16,
    'INVALID_CONTRACT_COUNT',
  );
  const seen = new Set<string>();
  let count = 0;
  const contracts = r.contracts.map((item: unknown) => {
    const c = record(item, ['address', 'calls']);
    const token = address(c.address);
    requireValue(!seen.has(token), 'DUPLICATE_CONTRACT');
    seen.add(token);
    requireValue(Array.isArray(c.calls) && c.calls.length <= 8, 'INVALID_CALL_COUNT');
    const ids = new Set<string>();
    const calls = c.calls.map((item: unknown) => {
      const call = record(item, ['id', 'data']);
      requireValue(
        typeof call.id === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(call.id) && !ids.has(call.id),
        'INVALID_CALL_ID',
      );
      requireValue(
        typeof call.data === 'string' && /^0x(?:[0-9a-fA-F]{2}){4,4096}$/.test(call.data),
        'INVALID_CALL_DATA',
      );
      ids.add(call.id);
      return { id: call.id, data: call.data.toLowerCase() };
    });
    count += 1 + calls.length;
    return { address: token, calls };
  });
  requireValue(count <= 32, 'SNAPSHOT_REQUEST_LIMIT');
  return {
    chainId: r.chainId,
    block: { number: b.number, hash: b.hash === null ? null : blockHash(b.hash) },
    contracts,
  };
}
function equalBlocks(a: ChainBlock, b: ChainBlock): boolean {
  return (
    a.number === b.number &&
    a.hash.toLowerCase() === b.hash.toLowerCase() &&
    a.parentHash.toLowerCase() === b.parentHash.toLowerCase() &&
    a.timestamp === b.timestamp
  );
}
async function abortable<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new RpcFailure('SNAPSHOT_ABORTED');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new RpcFailure('SNAPSHOT_ABORTED'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw new RpcFailure('SNAPSHOT_ABORTED');
        return action();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
/** Read-only diagnostic snapshot, not canonical deployment approval, finality or trading permission. */
export async function capturePinnedState(
  input: unknown,
  endpoint: string,
  transport: RpcTransport = createFetchTransport(),
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<PinnedStateCapture> {
  const result: PinnedStateCapture = {
    version: 'alphaforge-pinned-state-1',
    status: 'REJECTED',
    reason: null,
    request: null,
    block: null,
    contracts: [],
    receipts: [],
  };
  try {
    const requested = parsePinnedStateRequest(input);
    result.request = requested;
    const budget = AbortSignal.timeout(30000);
    const totalSignal = signal ? AbortSignal.any([budget, signal]) : budget;
    let previous = -1;
    const clock = () => {
      const n = now();
      if (!Number.isSafeInteger(n) || n < 0 || n < previous) throw new RpcFailure('INVALID_SNAPSHOT_CLOCK');
      previous = n;
      return n;
    };
    clock();
    const recorded: RpcTransport = async (e, r, s, maxBytes) => {
      requireValue(
        ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(r.method),
        'RPC_METHOD_FORBIDDEN',
      );
      requireValue(result.receipts.length < 36, 'SNAPSHOT_REQUEST_LIMIT');
      const receipt: RpcReceipt = {
        request: structuredClone(r),
        startedAtMs: clock(),
        receivedAtMs: null,
        httpStatus: null,
        responseSha256: null,
      };
      result.receipts.push(receipt);
      const combined = AbortSignal.any([s, totalSignal]);
      const response: RpcTransportResponse = await abortable(
        () => transport(e, r, combined, maxBytes),
        combined,
      );
      receipt.receivedAtMs = clock();
      receipt.httpStatus = response.status;
      requireValue(
        typeof response.body === 'string' && Buffer.byteLength(response.body) <= maxBytes,
        'RPC_RESPONSE_TOO_LARGE',
      );
      receipt.responseSha256 = createHash('sha256').update(response.body).digest('hex');
      return response;
    };
    // Do not rotate providers inside a snapshot or retry an access-denied response.
    const rpc = new JsonRpcClient([endpoint], {
      transport: recorded,
      maxAttempts: 1,
      maxResponseBytes: 262144,
      timeoutMs: 5000,
    });
    requireValue((await rpc.chainId()) === requested.chainId, 'RPC_CHAIN_MISMATCH');
    const block = await rpc.block(
      requested.block.number === 'latest' ? 'latest' : BigInt(requested.block.number),
    );
    requireValue(block, 'RPC_BLOCK_MISSING');
    blockHash(block.hash);
    requireValue(
      requested.block.number === 'latest' || block.number === BigInt(requested.block.number),
      'RPC_BLOCK_MISMATCH',
    );
    requireValue(
      requested.block.hash === null || block.hash.toLowerCase() === requested.block.hash,
      'RPC_BLOCK_MISMATCH',
    );
    requireValue(block.timestamp * 1000n <= BigInt(clock()), 'RPC_BLOCK_FROM_FUTURE');
    const reference = { blockHash: asBlockHash(block.hash), requireCanonical: true as const };
    const contracts: PinnedStateCapture['contracts'] = [];
    for (const contract of requested.contracts) {
      const code = await rpc.code(asAddress(contract.address), reference);
      requireValue(code !== '0x', 'RPC_CODE_MISSING');
      requireValue(code.length <= 2 + 65536 * 2, 'RPC_CODE_TOO_LARGE');
      const calls: (ReadCall & { result: string })[] = [];
      for (const call of contract.calls) {
        const raw = await rpc.call(
          { to: asAddress(contract.address), data: asHexData(call.data) },
          reference,
        );
        requireValue(raw.length <= 2 + 65536 * 2, 'RPC_CALL_TOO_LARGE');
        calls.push({ ...call, result: raw });
      }
      contracts.push({ address: contract.address, code, codeHash: keccak256(code), calls });
    }
    const finalBlock = await rpc.block(block.number);
    requireValue(finalBlock && equalBlocks(block, finalBlock), 'RPC_REORG_OR_BLOCK_DRIFT');
    requireValue((await rpc.chainId()) === requested.chainId, 'RPC_CHAIN_MISMATCH');
    clock();
    requireValue(!totalSignal.aborted, 'SNAPSHOT_ABORTED');
    result.block = {
      number: block.number.toString(),
      hash: block.hash.toLowerCase(),
      parentHash: block.parentHash.toLowerCase(),
      timestampSeconds: block.timestamp.toString(),
    };
    result.contracts = contracts;
    result.status = 'CAPTURED';
  } catch (error) {
    const last = result.receipts.at(-1);
    const message = error instanceof Error ? error.message : '';
    result.reason =
      last?.httpStatus === 401 || last?.httpStatus === 403
        ? 'RPC_ACCESS_DENIED'
        : /^[A-Z][A-Z0-9_]{1,80}$/.test(message)
          ? message
          : 'SNAPSHOT_FAILED';
    result.block = null;
    result.contracts = [];
  }
  return result;
}

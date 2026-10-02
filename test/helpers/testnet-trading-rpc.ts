import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Interface, keccak256 } from 'ethers';
import { JsonRpcClient } from '../../packages/chain-adapter/src/rpc.ts';
import { asAddress, asBlockHash } from '../../packages/chain-adapter/src/types.ts';
import {
  deploymentManifestDigest,
  validateDeploymentManifest,
} from '../../packages/chain-adapter/src/manifest.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../../packages/chain-adapter/src/pass-abi.ts';
import {
  tradingInterface,
  tradingAbiHash,
  tradingAbiVersion,
  tokenInterface,
  feedInterface,
  venueInterface,
  factoryInterface,
  poolInterface,
} from '../../packages/testnet/src/trading-abi.ts';
import { validateTradingInventory } from '../../packages/testnet/src/trading-inventory.ts';

export const tradingFixtureAddress = (i: number) => asAddress('0x' + i.toString(16).padStart(40, '0'));
const address = tradingFixtureAddress;
const hash = asBlockHash('0x' + 'ab'.repeat(32));
const codeHash = asBlockHash(keccak256('0x6000'));
const vault = address(50),
  pass = address(60);
// Explicit RPC-boundary fixture; not deployed bytecode or external-chain acceptance.
export function tradingRpcFixture(
  change:
    | 'NONE'
    | 'CHAIN'
    | 'CODE'
    | 'BACKING'
    | 'POOL'
    | 'REORG'
    | 'STALE'
    | 'PASS_BACKING'
    | 'ALLOWANCE'
    | 'SMART_OWNER' = 'NONE',
  options: {
    transaction?: Record<string, unknown> | null;
    head?: number;
    logs?: Record<string, unknown>[];
    receipt?: Record<string, unknown> | null;
    hashAt?: (n: number) => string;
    historical?: boolean;
  } = {},
) {
  const document = {
    schemaVersion: 1 as const,
    environment: 'robinhood-chain-testnet' as const,
    chainId: 46630 as const,
    contractName: 'AlphaForgeTradingVault',
    contractType: 'vault',
    contractAddress: vault,
    deploymentBlock: '1',
    abiVersion: tradingAbiVersion,
    abiHash: asBlockHash(tradingAbiHash),
    runtimeBytecodeHash: codeHash,
    strategyPassAddress: pass,
    strategyPassDeploymentBlock: '1',
    strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
    strategyPassRuntimeBytecodeHash: codeHash,
  };
  const manifestDigest = deploymentManifestDigest(document);
  const manifest = validateDeploymentManifest(
    { ...document, manifestDigest },
    { environment: 'robinhood-chain-testnet', chainId: 46630, manifestDigest },
  );
  const inventoryDocument = {
    schemaVersion: 1,
    chainId: 46630,
    kind: 'TEST_SUBSTITUTES',
    deploymentManifestDigest: manifestDigest,
    owner: address(1),
    passLocker: address(2),
    usdc: address(3),
    router: address(4),
    quoter: address(5),
    factory: address(6),
    maxPriceAge: 30,
    stocks: ['MSFT', 'NVDA', 'AAPL'].map((symbol, i) => ({
      symbol,
      token: address(10 + i),
      feed: address(20 + i),
      pool: address(30 + i),
      referenceIdentity: hash,
      keeper: address(40),
    })),
    codeHashes: [
      address(2),
      address(3),
      address(4),
      address(5),
      address(6),
      ...Array.from({ length: 3 }, (_, i) => [address(10 + i), address(20 + i), address(30 + i)]).flat(),
    ].map((address) => ({ address, hash: codeHash })),
  };
  const inventory = validateTradingInventory(
    inventoryDocument,
    '0x' + createHash('sha256').update(JSON.stringify(inventoryDocument)).digest('hex'),
    manifestDigest,
  );
  let reads = 0;
  const hashAt = (n: number) =>
    options.hashAt?.(n) ?? (n === 16 ? hash : '0x' + n.toString(16).padStart(64, '0'));
  const client = new JsonRpcClient(['https://fixture.invalid'], {
    maxAttempts: 1,
    transport: async (_endpoint, request) => {
      let result: unknown;
      if (request.method === 'eth_getTransactionByHash') result = options.transaction ?? null;
      else if (request.method === 'eth_chainId') result = change === 'CHAIN' ? '0x1237' : '0xb626';
      else if (request.method === 'eth_getTransactionReceipt') result = options.receipt ?? null;
      else if (request.method === 'eth_getLogs') {
        const filter = request.params[0] as { fromBlock: string; toBlock: string; address: string };
        result = (options.logs ?? []).filter(
          (log) =>
            BigInt(String(log.blockNumber)) >= BigInt(filter.fromBlock) &&
            BigInt(String(log.blockNumber)) <= BigInt(filter.toBlock) &&
            log.address === filter.address &&
            log.blockHash === hashAt(Number(BigInt(String(log.blockNumber)))),
        );
      } else if (request.method === 'eth_getBlockByNumber') {
        const n =
          request.params[0] === 'latest' ? (options.head ?? 16) : Number(BigInt(String(request.params[0])));
        result = {
          number: '0x' + n.toString(16),
          hash: change === 'REORG' && ++reads > 1 ? '0x' + 'cd'.repeat(32) : hashAt(n),
          parentHash: hashAt(n - 1),
          timestamp: '0x3e8',
        };
      } else if (request.method === 'eth_getCode') {
        const ref = request.params[1] as { blockHash: string; requireCanonical: boolean };
        assert.equal(ref.requireCanonical, true);
        assert.ok(
          Array.from({ length: Math.max(16, options.head ?? 16) + 1 }, (_, n) => hashAt(n)).includes(
            ref.blockHash,
          ),
        );
        result =
          request.params[0] === address(1)
            ? change === 'SMART_OWNER'
              ? '0x6000'
              : '0x'
            : change === 'CODE'
              ? '0x6001'
              : '0x6000';
      } else if (request.method === 'eth_call') {
        const ref = request.params[1] as { blockHash: string; requireCanonical: boolean };
        assert.equal(ref.requireCanonical, true);
        assert.ok(
          Array.from({ length: Math.max(16, options.head ?? 16) + 1 }, (_, n) => hashAt(n)).includes(
            ref.blockHash,
          ),
        );
        const c = request.params[0] as { to: string; data: string };
        const n = options.historical
          ? (Array.from({ length: Math.max(16, options.head ?? 16) + 1 }, (_, n) => n).find(
              (n) => hashAt(n) === ref.blockHash,
            ) ?? 16)
          : 16;
        let abi: Interface;
        if (c.to === vault) abi = tradingInterface;
        else if ([address(20), address(21), address(22)].includes(asAddress(c.to))) abi = feedInterface;
        else if ([address(30), address(31), address(32)].includes(asAddress(c.to))) abi = poolInterface;
        else if (c.to === address(6)) abi = factoryInterface;
        else if ([address(4), address(5)].includes(asAddress(c.to))) abi = venueInterface;
        else abi = tokenInterface;
        const call = abi.parseTransaction({ data: c.data });
        assert.ok(call);
        let values: unknown[];
        if (c.to === vault) {
          const state: Record<string, unknown> = {
            owner: address(1),
            pass,
            afUsdc: address(3),
            router: address(4),
            passLocker: address(2),
            maxPriceAge: 30n,
            strategyId: hash,
            stateVersion: 4n,
            grantVersion: 1n,
            principalBasis: 1000_000000n,
            idleCash: n < 2 ? 1000_000000n : 100_000000n,
            runtimeCash: n < 2 ? 0n : n < 16 ? 900_000000n : 600_000000n,
            runtimeUnits: n < 2 ? 0n : 900n * 10n ** 18n,
            totalBuyUsdc: n < 16 ? 0n : 300_000000n,
            openTrackedPositionCount: n < 16 ? 0n : 3n,
            liquidationUntil: 0n,
            lowerUnitNav: 0n,
            upperUnitNav: 0n,
            closed: false,
            liquidating: false,
          };
          values =
            call.name === 'stocks'
              ? [address(10 + Number(call.args[0]))]
              : call.name === 'feeds'
                ? [address(20 + Number(call.args[0]))]
                : call.name === 'trackedPosition'
                  ? [n < 16 ? 0n : 10n ** 18n]
                  : ['lowerPrice', 'upperPrice'].includes(call.name)
                    ? [0n]
                    : call.name === 'grant'
                      ? [address(40), 1100n, 60n, 300_000000n, 900_000000n, 40n]
                      : [state[call.name]];
        } else {
          values =
            call.name === 'factory'
              ? [address(6)]
              : call.name === 'getPool'
                ? [address(30 + Number(BigInt(call.args[1])) - 10)]
                : call.name === 'token0'
                  ? [address(3)]
                  : call.name === 'token1'
                    ? [address(10 + Number(BigInt(c.to)) - 30)]
                    : call.name === 'fee'
                      ? [change === 'POOL' ? 500n : 3000n]
                      : call.name === 'price'
                        ? [100_000000n, change === 'STALE' ? 960n : 1000n, hash]
                        : call.name === 'keeper'
                          ? [address(40)]
                          : call.name === 'referenceIdentity' || call.name === 'strategyId'
                            ? [hash]
                            : call.name === 'lockedBalance'
                              ? [1000n * 10n ** 18n]
                              : call.name === 'decimals'
                                ? [c.to === address(3) ? 6n : 18n]
                                : call.name === 'balanceOf'
                                  ? [
                                      c.to === pass && String(call.args[0]).toLowerCase() === address(2)
                                        ? change === 'PASS_BACKING'
                                          ? 999n * 10n ** 18n
                                          : 1000n * 10n ** 18n
                                        : c.to === address(3)
                                          ? change === 'BACKING'
                                            ? 699_000000n
                                            : 1000_000000n
                                          : 10n ** 18n,
                                    ]
                                  : call.name === 'allowance'
                                    ? [change === 'ALLOWANCE' && c.to === address(3) ? 1n : 0n]
                                    : [];
        }
        result = abi.encodeFunctionResult(call.name, values);
      } else throw new Error('unapproved read');
      return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) };
    },
  });
  return { client, manifest, inventory };
}

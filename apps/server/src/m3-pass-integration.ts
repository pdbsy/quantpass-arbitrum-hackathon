import type { ChainOperation } from '../../../packages/chain-adapter/src/lifecycle.ts';
import type { DeploymentManifest } from '../../../packages/chain-adapter/src/manifest.ts';
import {
  decodeM3StrategyPassCalldata,
  decodeM3StrategyPassEvent,
  encodeM3StrategyPassBalanceOf,
  M3_STRATEGY_PASS_DECIMALS_CALL,
  M3_STRATEGY_PASS_STRATEGY_ID_CALL,
} from '../../../packages/chain-adapter/src/pass-abi.ts';
import type {
  CanonicalContractEvent,
  ContractIntegration,
  ProjectionCandidate,
  ReconciliationResult,
} from '../../../packages/chain-adapter/src/reconciliation.ts';
import type { ChainBlock, ChainReceipt, ReadonlyRpc } from '../../../packages/chain-adapter/src/rpc.ts';
import {
  asAddress,
  sameAddress,
  type Address,
  type HexData,
} from '../../../packages/chain-adapter/src/types.ts';
import {
  decodeM3VaultBytes32Result,
  decodeM3VaultUintResult,
} from '../../../packages/chain-adapter/src/vault-abi.ts';

export const M3_PASS_PROJECTION_KEY = 'm3-strategy-pass';
const zeroAddress = asAddress('0x0000000000000000000000000000000000000000');
const zeroBytes32 = `0x${'00'.repeat(32)}`;

export interface M3StrategyPassProjectionState extends Readonly<Record<string, unknown>> {
  readonly owner: Address;
  readonly pass: Address;
  readonly strategyId: HexData;
  readonly decimals: 18;
  readonly balanceRaw: string;
}

function field(event: CanonicalContractEvent, name: string): string | null {
  const value = event.normalizedData[name];
  return typeof value === 'string' ? value : null;
}

function eventAddress(event: CanonicalContractEvent, name: 'from' | 'to'): Address | null {
  const value = field(event, name);
  try {
    return value === null ? null : asAddress(value);
  } catch {
    return null;
  }
}

async function readPassMetadata(
  rpc: ReadonlyRpc,
  manifest: DeploymentManifest,
  block: ChainBlock,
): Promise<Readonly<{ strategyId: HexData; decimals: 18 }>> {
  const reference = Object.freeze({ blockHash: block.hash, requireCanonical: true as const });
  const [strategyId, decimals] = await Promise.all([
    rpc
      .call({ to: manifest.contractAddress, data: M3_STRATEGY_PASS_STRATEGY_ID_CALL }, reference)
      .then(decodeM3VaultBytes32Result),
    rpc
      .call({ to: manifest.contractAddress, data: M3_STRATEGY_PASS_DECIMALS_CALL }, reference)
      .then(decodeM3VaultUintResult),
  ]);
  if (strategyId.toLowerCase() === zeroBytes32 || decimals !== 18n)
    throw new Error('M3_STRATEGY_PASS_STATE_MISMATCH');
  return Object.freeze({ strategyId, decimals: 18 });
}

async function readBalance(
  rpc: ReadonlyRpc,
  manifest: DeploymentManifest,
  block: ChainBlock,
  owner: Address,
): Promise<bigint> {
  return rpc
    .call(
      { to: manifest.contractAddress, data: encodeM3StrategyPassBalanceOf(owner) },
      { blockHash: block.hash, requireCanonical: true },
    )
    .then(decodeM3VaultUintResult);
}

export class M3StrategyPassContractIntegration implements ContractIntegration {
  decode = decodeM3StrategyPassEvent;

  async rebuildProjections(context: {
    readonly rpc: ReadonlyRpc;
    readonly manifest: DeploymentManifest;
    readonly events: readonly CanonicalContractEvent[];
    readonly block: ChainBlock;
  }): Promise<readonly ProjectionCandidate[]> {
    const owners = new Map<string, Address>();
    for (const event of context.events) {
      if (event.eventName !== 'Transfer') continue;
      for (const name of ['from', 'to'] as const) {
        const owner = eventAddress(event, name);
        if (owner && !sameAddress(owner, zeroAddress)) owners.set(owner.toLowerCase(), owner);
      }
    }
    const metadata = await readPassMetadata(context.rpc, context.manifest, context.block);
    const projections = await Promise.all(
      [...owners.values()].map(async (owner): Promise<ProjectionCandidate> => {
        const balance = await readBalance(context.rpc, context.manifest, context.block, owner);
        const state: M3StrategyPassProjectionState = Object.freeze({
          owner,
          pass: context.manifest.contractAddress,
          strategyId: metadata.strategyId,
          decimals: metadata.decimals,
          balanceRaw: balance.toString(),
        });
        return Object.freeze({
          owner,
          projectionKey: M3_PASS_PROJECTION_KEY,
          blockNumber: context.block.number,
          blockHash: context.block.hash,
          state,
        });
      }),
    );
    return Object.freeze(projections);
  }

  async reconcileOperation(context: {
    readonly rpc: ReadonlyRpc;
    readonly manifest: DeploymentManifest;
    readonly operation: ChainOperation;
    readonly receipt: ChainReceipt;
    readonly events: readonly CanonicalContractEvent[];
    readonly block: ChainBlock;
  }): Promise<ReconciliationResult> {
    const action = context.operation.calldata
      ? decodeM3StrategyPassCalldata(context.operation.calldata)
      : null;
    const transfers = context.events.filter((event) => event.eventName === 'Transfer');
    const transfer = transfers.length === 1 ? transfers[0]! : null;
    if (
      !action ||
      !transfer ||
      !sameAddress(eventAddress(transfer, 'from') ?? zeroAddress, context.operation.owner) ||
      !sameAddress(eventAddress(transfer, 'to') ?? zeroAddress, action.recipient) ||
      field(transfer, 'amountRaw') !== action.amountRaw.toString()
    )
      return { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };
    try {
      await Promise.all([
        readPassMetadata(context.rpc, context.manifest, context.block),
        readBalance(context.rpc, context.manifest, context.block, context.operation.owner),
        readBalance(context.rpc, context.manifest, context.block, action.recipient),
      ]);
      return { status: 'MATCH' };
    } catch {
      return { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' };
    }
  }
}

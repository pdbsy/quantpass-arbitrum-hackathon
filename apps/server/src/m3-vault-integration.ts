import type {
  CanonicalContractEvent,
  ContractIntegration,
  ProjectionCandidate,
  ReconciliationResult,
} from '../../../packages/chain-adapter/src/reconciliation.ts';
import type { ChainBlock, ChainReceipt, ReadonlyRpc } from '../../../packages/chain-adapter/src/rpc.ts';
import type { DeploymentManifest } from '../../../packages/chain-adapter/src/manifest.ts';
import type { ChainOperation } from '../../../packages/chain-adapter/src/lifecycle.ts';
import {
  decodeM3VaultAddressResult,
  decodeM3VaultBoolResult,
  decodeM3VaultBytes32Result,
  decodeM3VaultCalldata,
  decodeM3VaultEvent,
  decodeM3VaultUintResult,
  encodeM3VaultCall,
} from '../../../packages/chain-adapter/src/vault-abi.ts';
import { sameAddress, type Address, type HexData } from '../../../packages/chain-adapter/src/types.ts';

export const M3_VAULT_PROJECTION_KEY = 'm3-vault';

export interface M3VaultProjectionState extends Readonly<Record<string, unknown>> {
  readonly owner: Address;
  readonly strategyCreator: Address;
  readonly strategyId: HexData;
  readonly strategyRef: HexData;
  readonly pass: Address;
  readonly passStrategyId: HexData;
  readonly afUsdc: Address;
  readonly afEth: Address;
  readonly afBtc: Address;
  readonly passLocker: Address;
  readonly principalBasis: string;
  readonly trackedUsdcBalance: string;
  readonly realizedProfit: string;
  readonly withdrawableUsdc: string;
  readonly trackedAfEth: string;
  readonly trackedAfBtc: string;
  readonly openTrackedPositionCount: string;
  readonly closed: boolean;
}

async function readVault(
  rpc: ReadonlyRpc,
  manifest: DeploymentManifest,
  block: ChainBlock,
): Promise<M3VaultProjectionState> {
  const blockReference = Object.freeze({ blockHash: block.hash, requireCanonical: true as const });
  const call = (data: HexData) => rpc.call({ to: manifest.contractAddress, data }, blockReference);
  const [
    owner,
    strategyCreator,
    strategyId,
    strategyRef,
    pass,
    afUsdc,
    afEth,
    afBtc,
    passLocker,
    principalBasis,
    trackedUsdcBalance,
    realizedProfit,
    withdrawableUsdc,
    openTrackedPositionCount,
    closed,
  ] = await Promise.all([
    call(encodeM3VaultCall('owner()', [])).then(decodeM3VaultAddressResult),
    call(encodeM3VaultCall('strategyCreator()', [])).then(decodeM3VaultAddressResult),
    call(encodeM3VaultCall('strategyId()', [])).then(decodeM3VaultBytes32Result),
    call(encodeM3VaultCall('strategyRef()', [])).then(decodeM3VaultBytes32Result),
    call(encodeM3VaultCall('pass()', [])).then(decodeM3VaultAddressResult),
    call(encodeM3VaultCall('afUsdc()', [])).then(decodeM3VaultAddressResult),
    call(encodeM3VaultCall('afEth()', [])).then(decodeM3VaultAddressResult),
    call(encodeM3VaultCall('afBtc()', [])).then(decodeM3VaultAddressResult),
    call(encodeM3VaultCall('passLocker()', [])).then(decodeM3VaultAddressResult),
    call(encodeM3VaultCall('principalBasis()', [])).then(decodeM3VaultUintResult),
    call(encodeM3VaultCall('trackedUsdcBalance()', [])).then(decodeM3VaultUintResult),
    call(encodeM3VaultCall('realizedProfit()', [])).then(decodeM3VaultUintResult),
    call(encodeM3VaultCall('withdrawableUsdc()', [])).then(decodeM3VaultUintResult),
    call(encodeM3VaultCall('openTrackedPositionCount()', [])).then(decodeM3VaultUintResult),
    call(encodeM3VaultCall('closed()', [])).then(decodeM3VaultBoolResult),
  ]);

  // The tracked-asset calls must use the addresses read from this same block.
  const [exactTrackedAfEth, exactTrackedAfBtc, passStrategyId] = await Promise.all([
    call(encodeM3VaultCall('trackedPosition(address)', [afEth])).then(decodeM3VaultUintResult),
    call(encodeM3VaultCall('trackedPosition(address)', [afBtc])).then(decodeM3VaultUintResult),
    rpc
      .call({ to: pass, data: encodeM3VaultCall('strategyId()', []) }, blockReference)
      .then(decodeM3VaultBytes32Result),
  ]);
  if (passStrategyId.toLowerCase() !== strategyId.toLowerCase())
    throw new Error('M3_VAULT_STRATEGY_PASS_MISMATCH');
  if (!sameAddress(pass, manifest.strategyPassAddress)) throw new Error('M3_VAULT_STRATEGY_PASS_MISMATCH');
  return Object.freeze({
    owner,
    strategyCreator,
    strategyId,
    strategyRef,
    pass,
    passStrategyId,
    afUsdc,
    afEth,
    afBtc,
    passLocker,
    principalBasis: principalBasis.toString(),
    trackedUsdcBalance: trackedUsdcBalance.toString(),
    realizedProfit: realizedProfit.toString(),
    withdrawableUsdc: withdrawableUsdc.toString(),
    trackedAfEth: exactTrackedAfEth.toString(),
    trackedAfBtc: exactTrackedAfBtc.toString(),
    openTrackedPositionCount: openTrackedPositionCount.toString(),
    closed,
  });
}

function field(event: CanonicalContractEvent, name: string): string | null {
  const value = event.normalizedData[name];
  return typeof value === 'string' ? value : null;
}

function expectedEvent(
  events: readonly CanonicalContractEvent[],
  name: string,
): CanonicalContractEvent | null {
  const matches = events.filter((event) => event.eventName === name);
  return matches.length === 1 ? matches[0]! : null;
}

function eventOwnerMatches(event: CanonicalContractEvent, owner: Address): boolean {
  const value = field(event, 'owner');
  if (!value) return false;
  return sameAddress(value as Address, owner);
}

function eventUint(event: CanonicalContractEvent, name: string): bigint | null {
  const value = field(event, name);
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  return BigInt(value);
}

export class M3VaultContractIntegration implements ContractIntegration {
  decode = decodeM3VaultEvent;

  async rebuildProjections(context: {
    readonly rpc: ReadonlyRpc;
    readonly manifest: DeploymentManifest;
    readonly events: readonly CanonicalContractEvent[];
    readonly block: ChainBlock;
  }): Promise<readonly ProjectionCandidate[]> {
    const state = await readVault(context.rpc, context.manifest, context.block);
    return Object.freeze([
      Object.freeze({
        owner: state.owner,
        projectionKey: M3_VAULT_PROJECTION_KEY,
        blockNumber: context.block.number,
        blockHash: context.block.hash,
        state,
      }),
    ]);
  }

  async reconcileOperation(context: {
    readonly rpc: ReadonlyRpc;
    readonly manifest: DeploymentManifest;
    readonly operation: ChainOperation;
    readonly receipt: ChainReceipt;
    readonly events: readonly CanonicalContractEvent[];
    readonly block: ChainBlock;
  }): Promise<ReconciliationResult> {
    const calldata = context.operation.calldata;
    if (!calldata) return { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };
    const action = decodeM3VaultCalldata(calldata);
    if (!action) return { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };

    let event: CanonicalContractEvent | null;
    switch (action.kind) {
      case 'DEPOSIT':
        event = expectedEvent(context.events, 'Deposited');
        if (
          !event ||
          !eventOwnerMatches(event, context.operation.owner) ||
          field(event, 'usdcAmount') !== action.usdcAmount.toString() ||
          eventUint(event, 'passRaw') !== action.usdcAmount * 1_000_000_000_000n
        )
          return { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };
        break;
      case 'WITHDRAW': {
        event = expectedEvent(context.events, 'Withdrawn');
        const profitAmount = event ? eventUint(event, 'profitAmount') : null;
        const principalAmount = event ? eventUint(event, 'principalAmount') : null;
        if (
          !event ||
          !eventOwnerMatches(event, context.operation.owner) ||
          field(event, 'usdcAmount') !== action.usdcAmount.toString() ||
          profitAmount === null ||
          principalAmount === null ||
          profitAmount + principalAmount !== action.usdcAmount ||
          eventUint(event, 'passRawUnlocked') !== principalAmount * 1_000_000_000_000n
        )
          return { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };
        break;
      }
      case 'CLOSE':
        event = expectedEvent(context.events, 'Closed');
        if (!event || !eventOwnerMatches(event, context.operation.owner))
          return { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };
        break;
      case 'RESCUE_UNTRACKED_TOKEN':
        event = expectedEvent(context.events, 'UntrackedTokenRescued');
        if (
          !event ||
          !eventOwnerMatches(event, context.operation.owner) ||
          field(event, 'token')?.toLowerCase() !== action.token.toLowerCase()
        )
          return { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };
        break;
      case 'RESCUE_NATIVE':
        event = expectedEvent(context.events, 'NativeRescued');
        if (!event || !eventOwnerMatches(event, context.operation.owner))
          return { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' };
        break;
    }

    try {
      const state = await readVault(context.rpc, context.manifest, context.block);
      if (!sameAddress(state.owner, context.operation.owner))
        return { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' };
      if (
        action.kind === 'CLOSE' &&
        (!state.closed ||
          state.principalBasis !== '0' ||
          state.trackedUsdcBalance !== '0' ||
          state.openTrackedPositionCount !== '0')
      )
        return { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' };
      if ((action.kind === 'RESCUE_NATIVE' || action.kind === 'RESCUE_UNTRACKED_TOKEN') && !state.closed)
        return { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' };
      return { status: 'MATCH' };
    } catch {
      return { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' };
    }
  }
}

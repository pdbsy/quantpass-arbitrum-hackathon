import type { VaultState } from '../../../packages/domain/src/vault.ts';
import { SIMULATION_STATISTICS } from './simulation.ts';
const balances = SIMULATION_STATISTICS.snapshot;
import { TEST_CASH, unsigned } from '../../../packages/domain/src/money.ts';

import { STRATEGIES } from './strategy-catalog.ts';
export const PRODUCT_ASSET = Object.freeze({ assetId: TEST_CASH.id, decimals: TEST_CASH.decimals });

export function relation(ownerId: string, strategyId: string, state?: VaultState) {
  return { ownerId, strategyId, vaultId: state?.id ?? null, status: state?.status ?? 'not_started' };
}

export function view(state: VaultState) {
  const calculated = balances(state);
  return {
    schemaVersion: 1,
    scope: state.scope,
    vaultId: state.id,
    asset: PRODUCT_ASSET,
    passBalance: {
      strategyId: state.strategyId,
      total: state.passes,
      allowance: balances(state).allowance.toString(),
    },
    id: state.id,
    ownerId: state.ownerId,
    strategyId: state.strategyId,
    passes: state.passes,
    status: state.status,
    revision: state.revision,
    idle: state.idle,
    activeCash: state.activeCash,
    positionCost: state.positionCost,
    positionValue: state.positionValue,
    feeLiability: state.feeLiability,
    withdrawalsPaid: state.withdrawalsPaid,
    orders: state.orders,
    pendingWithdrawals: state.pendingWithdrawals,
    pendingOperations: pendingOperations(state),
    balances: {
      asset: PRODUCT_ASSET,
      idle: state.idle,
      activeCash: state.activeCash,
      positionCost: state.positionCost,
      positionValue: state.positionValue,
      feeLiability: state.feeLiability,
      deposits: state.deposits,
      withdrawalsPaid: state.withdrawalsPaid,
      realizedPnl: state.realizedPnl,
      feesAccrued: state.feesAccrued,
      feesPaid: state.feesPaid,
      reserved: calculated.reserved.toString(),
      pending: calculated.pending.toString(),
      unrealized: calculated.unrealized.toString(),
      activeGross: calculated.activeGross.toString(),
      activeNet: calculated.activeNet.toString(),
      equity: calculated.equity.toString(),
      allowance: calculated.allowance.toString(),
    },
  };
}

function pendingOperations(state: VaultState) {
  return [
    ...Object.entries(state.pendingWithdrawals).map(([operationId, amount]) => ({
      operationId,
      kind: 'withdrawal',
      status: 'pending',
      amount,
    })),
    ...Object.entries(state.orders).map(([operationId, amount]) => ({
      operationId,
      kind: 'order',
      status: 'pending',
      amount,
    })),
  ];
}

// Aggregate the existing domain balances, without creating another ledger model.
export function accountView(
  owner: string,
  states: Iterable<VaultState>,
  page: {
    items: VaultState[];
    nextCursor: string | null;
  },
  limit: number,
) {
  let passes = 0n,
    idle = 0n,
    vaultCount = 0;
  let status: VaultState['status'] | null = null;
  const totals = {
    reserved: 0n,
    pending: 0n,
    unrealized: 0n,
    activeGross: 0n,
    activeNet: 0n,
    equity: 0n,
    allowance: 0n,
  };
  const strategies: ReturnType<typeof relation>[] = [];
  const passBalances: { strategyId: string; total: string; allowance: string }[] = [];
  for (const state of states) {
    vaultCount++;
    passes += unsigned(state.passes);
    idle += unsigned(state.idle);
    const value = balances(state);
    strategies.push(relation(owner, state.strategyId, state));
    passBalances.push({
      strategyId: state.strategyId,
      total: state.passes,
      allowance: value.allowance.toString(),
    });
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += value[key];
    if (state.status === 'stopping') status = 'stopping';
    else if (status !== 'stopping' && state.status === 'running') status = 'running';
    else if (status === null) status = 'stopped';
  }
  for (const strategy of STRATEGIES) {
    if (!strategies.some((item) => item.strategyId === strategy.id)) {
      strategies.push(relation(owner, strategy.id));
      passBalances.push({ strategyId: strategy.id, total: '0', allowance: '0' });
    }
  }
  strategies.sort((a, b) => a.strategyId.localeCompare(b.strategyId));
  passBalances.sort((a, b) => a.strategyId.localeCompare(b.strategyId));
  return {
    schemaVersion: 1,
    ownerId: owner,
    strategies,
    passBalances,
    scope: 'TEST_ONLY',
    identity: { id: owner, mode: 'DEMO' },
    asset: PRODUCT_ASSET,
    passes: passes.toString(),
    vaultCount,
    status,
    idle: idle.toString(),
    balances: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toString()])),
    vaults: page.items.map(view),
    pagination: { limit, nextCursor: page.nextCursor },
  };
}

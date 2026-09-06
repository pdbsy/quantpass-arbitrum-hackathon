import { balances, type Actor, type Command, type VaultState } from '../../../packages/domain/src/vault.ts';
import { ZERO_FEE_FULL_SETTLEMENT } from '../../../packages/domain/src/fixtures.ts';
import type { LocalStore } from './store.ts';

// Application ports. The competition demo has no signing key or transaction-submission path yet.
export interface ExecutionPort {
  submit(owner: string, vaultId: string, command: Command): { state: VaultState; replayed: boolean };
}
export interface IndexerPort {
  events(owner: string, vaultId: string): ReturnType<LocalStore['audit']>;
}
export interface StatisticsPort {
  snapshot(state: VaultState): ReturnType<typeof balances>;
}
export const SIMULATION_STATISTICS: StatisticsPort = Object.freeze({ snapshot: balances });
export function localSimulation(store: LocalStore): {
  execution: ExecutionPort;
  indexer: IndexerPort;
  statistics: StatisticsPort;
} {
  return {
    execution: {
      submit(owner, vaultId, command) {
        const executorTypes = [
          'reserveBuy',
          'fillBuy',
          'markPosition',
          'settlePosition',
          'confirmWithdrawal',
          'payFees',
        ];
        const actor: Actor = executorTypes.includes(command.type)
          ? { id: 'local-simulator', role: 'executor' }
          : { id: owner, role: 'owner' };
        return store.command(
          owner,
          vaultId,
          actor,
          command,
          command.type === 'settlePosition' ? ZERO_FEE_FULL_SETTLEMENT : undefined,
        );
      },
    },
    indexer: { events: (owner, vaultId) => store.audit(owner, vaultId) },
    statistics: SIMULATION_STATISTICS,
  };
}

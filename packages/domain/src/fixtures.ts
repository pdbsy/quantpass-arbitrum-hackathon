import type { SettlementPolicy } from './vault.ts';

// Explicit fixture only. No production fee, buffer or allocation policy is implied.
export const ZERO_FEE_FULL_SETTLEMENT: SettlementPolicy = Object.freeze<SettlementPolicy>({
  scope: 'TEST_ONLY',
  id: 'fixture-full-settlement-zero-fee-v1',
  assess({ cash, proceeds, existingFeeLiability, allowance }) {
    const netCash = cash + proceeds - existingFeeLiability;
    return { fee: 0n, excessToIdle: netCash > allowance ? netCash - allowance : 0n };
  },
});

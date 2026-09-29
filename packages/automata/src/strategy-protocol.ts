import { requireThat } from './model.ts';

export const STRATEGY_PROTOCOL = 'alphaforge-targets-v1' as const;
export interface StrategyDecision {
  protocol: typeof STRATEGY_PROTOCOL;
  runId: string;
  id: string;
  expectedRevision: number;
  frameSeq: number;
  targets: Record<string, number>;
}
export function validateTargets(targets: Record<string, number>, eligible: string[]) {
  requireThat(!!targets && typeof targets === 'object' && !Array.isArray(targets), 'STRATEGY_TARGETS');
  const entries = Object.entries(targets);
  requireThat(
    entries.length <= eligible.length &&
      entries.every(
        ([id, weight]) =>
          eligible.includes(id) && Number.isSafeInteger(weight) && weight >= 0 && weight <= 10000,
      ) &&
      entries.reduce((n, [, weight]) => n + weight, 0) <= 10000,
    'STRATEGY_TARGETS',
  );
}
export function validateDecision(decision: StrategyDecision, runId: string, eligible: string[]) {
  requireThat(decision.protocol === STRATEGY_PROTOCOL && decision.runId === runId, 'STRATEGY_PROTOCOL');
  requireThat(typeof decision.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(decision.id), 'INVALID_ID');
  requireThat(
    Number.isSafeInteger(decision.expectedRevision) &&
      decision.expectedRevision >= 0 &&
      Number.isSafeInteger(decision.frameSeq) &&
      decision.frameSeq > 0,
    'STRATEGY_FRAME',
  );
  validateTargets(decision.targets, eligible);
}

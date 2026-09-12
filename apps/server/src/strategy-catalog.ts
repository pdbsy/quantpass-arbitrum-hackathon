import { TEST_CASH } from '../../../packages/domain/src/money.ts';

export const CATALOG_VERSION = '1';
// Registered local fixtures only. They share the existing simulator, never live execution.
export const STRATEGIES = Object.freeze([
  Object.freeze({
    schemaVersion: 1,
    strategyId: 'core-flow-demo',
    id: 'core-flow-demo',
    name: '核心资金流程样例',
    description: '验证 SaaS 额度与独立余额，不运行真实量化交易。',
    scope: 'TEST_ONLY',
    testPasses: '1000',
    catalogVersion: CATALOG_VERSION,
    asset: Object.freeze({ assetId: TEST_CASH.id, decimals: TEST_CASH.decimals }),
  }),
  Object.freeze({
    schemaVersion: 1,
    strategyId: 'satellite-flow-demo',
    id: 'satellite-flow-demo',
    name: '独立策略隔离样例',
    description: '使用同一本地模拟器验证第二个策略的独立 Vault，不代表真实交易策略。',
    scope: 'TEST_ONLY',
    testPasses: '1000',
    catalogVersion: CATALOG_VERSION,
    asset: Object.freeze({ assetId: TEST_CASH.id, decimals: TEST_CASH.decimals }),
  }),
]);

export function strategyDetail(id: string) {
  const summary = STRATEGIES.find((strategy) => strategy.id === id);
  return summary
    ? {
        ...summary,
        capabilities: {
          execution: 'LOCAL_SIMULATION',
          claim: 'TEST_PASSES_ONLY',
          arbitraryStrategies: false,
          realFunds: false,
        },
      }
    : undefined;
}

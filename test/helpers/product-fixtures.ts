import assert from 'node:assert/strict';
import { productHarness } from './product-api.ts';

const scenarios = ['NORMAL', 'EMPTY', 'PENDING', 'ERROR', 'RUNNING', 'STOPPED'] as const;
export async function generateProductFixtures() {
  const results: Record<string, unknown> = {};
  for (const scenario of scenarios) {
    const h = await productHarness();
    try {
      const cookie = await h.login();
      const strategySummary = (await h.request(cookie, '/api/v1/strategies')).json().items[0];
      let strategyDetail = (await h.request(cookie, '/api/v1/strategies/core-flow-demo')).json();
      let vault = null;
      if (scenario !== 'EMPTY' && scenario !== 'ERROR') {
        vault = await h.claim(cookie);
        const steps = [
          { id: 'deposit', type: 'deposit', amount: '1500000000' },
          ...(scenario !== 'NORMAL'
            ? [
                { id: 'allocate', type: 'allocate', amount: '1000000000' },
                { id: 'start', type: 'start' },
              ]
            : []),
          ...(scenario === 'PENDING'
            ? [
                { id: 'withdraw', type: 'requestWithdrawal', amount: '500000000' },
                { id: 'reserve', type: 'reserveBuy', orderId: 'buy', amount: '200000000' },
                { id: 'stop', type: 'stop' },
              ]
            : []),
          ...(scenario === 'STOPPED' ? [{ id: 'stop', type: 'stop' }] : []),
        ];
        for (const step of steps) {
          const response = await h.request(cookie, `/api/v1/vaults/${vault.id}/commands`, {
            ...step,
            expectedRevision: vault.revision,
          });
          assert.equal(response.statusCode, 200, response.body);
          vault = response.json().vault;
        }
      }
      const account = await h.request(
        cookie,
        scenario === 'ERROR' ? '/api/v1/account?limit=0' : '/api/v1/account',
      );
      assert.equal(account.statusCode, scenario === 'ERROR' ? 400 : 200);
      strategyDetail = (await h.request(cookie, '/api/v1/strategies/core-flow-demo')).json();
      const data = {
        strategySummary,
        strategyDetail,
        accountSummary: scenario === 'ERROR' ? null : account.json(),
        vault,
        pendingOperation: vault?.pendingOperations[0] ?? null,
        error: scenario === 'ERROR' ? account.json() : null,
      };
      // Random persistence IDs are normalized; no sessions, headers or credentials enter fixtures.
      results[scenario] = JSON.parse(
        vault
          ? JSON.stringify(data).replaceAll(vault.id, 'vault_alice_core_flow_demo')
          : JSON.stringify(data),
      );
    } finally {
      await h.app.close();
    }
  }
  return { schemaVersion: 1, scope: 'TEST_ONLY', source: 'LOCAL_API_JOURNEYS', scenarios: results };
}

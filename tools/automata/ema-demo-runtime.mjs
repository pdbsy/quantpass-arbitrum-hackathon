export const EMA_RUN_ID = 'qinfra-ema-demo';
export const EMA_PARAMETERS = Object.freeze({
  strategyMode: 'external',
  weights: { 'rwa-a': 5000, 'rwa-b': 5000 },
  deviationBps: 1,
  intervalMs: 1000,
  feeBps: 10,
  maxSlippageBps: 100,
  limits: { mode: 'percent', upperBps: 5000, lowerBps: -2000 },
});
async function request(client, path, body) {
  const response = await client.request(path, body === undefined ? undefined : JSON.stringify(body));
  if (!response.ok) throw new Error(`Demo request rejected (${response.status})`);
  return response.json();
}
export async function provisionEma(client) {
  if (client.runId !== EMA_RUN_ID) throw new Error('Unexpected EMA demo run');
  const existing = await client.request(`/api/v1/automata/${EMA_RUN_ID}`);
  if (existing.ok) {
    const run = await existing.json();
    if (
      run.datasetId !== 'ema-cycle' ||
      JSON.stringify(run.state.parameters) !== JSON.stringify(EMA_PARAMETERS)
    )
      throw new Error('Existing run is not the pinned EMA demo');
    return run;
  }
  if (existing.status !== 404) throw new Error('Cannot inspect EMA demo');
  const vault = await request(client, '/api/v1/vaults', { strategyId: 'core-flow-demo' });
  await request(client, `/api/v1/vaults/${vault.id}/commands`, {
    id: 'ema-demo-deposit',
    expectedRevision: 0,
    type: 'deposit',
    amount: '1000000000',
  });
  return request(client, '/api/v1/automata', {
    id: EMA_RUN_ID,
    vaultId: vault.id,
    amount: '500000000',
    datasetId: 'ema-cycle',
    parameters: EMA_PARAMETERS,
  });
}
export async function advanceEma(client) {
  // Resolve a durable uncertain decision before advancing the market clock.
  await client.tick();
  const context = await request(client, `/api/v1/automata/${client.runId}/strategy-context`);
  if (context.status === 'stopped') return 'finished';
  const type = context.replayComplete ? 'stop' : 'step';
  const response = await client.request(
    `/api/v1/automata/${client.runId}/actions`,
    JSON.stringify({
      id: `ema_${type}_${context.frameSeq}_${context.revision}`,
      expectedRevision: context.revision,
      type,
    }),
  );
  if (response.status === 409) return 'waiting';
  if (!response.ok) throw new Error(`Demo clock request rejected (${response.status})`);
  const view = await response.json();
  return view.state.status === 'stopped' ? 'finished' : 'advanced';
}

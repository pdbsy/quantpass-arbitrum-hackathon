import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { STRATEGY_PROTOCOL, validateTargets } from '../../packages/automata/src/strategy-protocol.ts';

// A small local/mock reference adapter. A real strategy replaces targets, not the executor.
export class StrategyClient {
  constructor({ baseUrl = 'http://127.0.0.1:4180', owner, runId, targets, fetcher = fetch }) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Only a loopback HTTP origin is supported');
    if (
      !['alice', 'bob'].includes(owner) ||
      typeof runId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(runId)
    )
      throw new Error('Invalid local owner or run ID');
    validateTargets(targets, ['rwa-a', 'rwa-b']);
    this.baseUrl = url.origin;
    this.owner = owner;
    this.runId = runId;
    this.targets = structuredClone(targets);
    this.fetcher = fetcher;
    this.cookie = '';
    this.pending = null;
  }
  async request(path, body) {
    return this.fetcher(`${this.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        'content-type': 'application/json',
        'x-quantpass-demo': '1',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      ...(body === undefined ? {} : { body }),
    });
  }
  async connect() {
    const response = await this.request('/api/demo/session', JSON.stringify({ user: this.owner }));
    if (!response.ok) throw new Error(`Demo session rejected (${response.status})`);
    this.cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    if (!this.cookie) throw new Error('Demo session missing');
  }
  async tick() {
    if (!this.cookie) throw new Error('Connect to a local demo session first');
    if (!this.pending) {
      const response = await this.request(`/api/v1/automata/${this.runId}/strategy-context`);
      if (!response.ok) throw new Error(`Strategy context rejected (${response.status})`);
      const context = await response.json();
      if (
        context.protocol !== STRATEGY_PROTOCOL ||
        context.scope !== 'TEST_ONLY' ||
        context.runId !== this.runId
      )
        throw new Error('Unsupported strategy context');
      if (context.status === 'stopped') return 'finished';
      if (!context.ready || context.lastDecision?.frameSeq === context.frameSeq)
        return context.replayComplete ? 'finished' : 'waiting';
      validateTargets(this.targets, context.eligibleAssets);
      this.pending = JSON.stringify({
        protocol: STRATEGY_PROTOCOL,
        runId: this.runId,
        id: randomUUID(),
        expectedRevision: context.revision,
        frameSeq: context.frameSeq,
        targets: this.targets,
      });
    }
    // Network/5xx/invalid-response uncertainty retains the exact serialized request.
    const response = await this.request(`/api/v1/automata/${this.runId}/decisions`, this.pending);
    if (response.status === 409) {
      const result = await response.json();
      this.pending = null;
      if (['REVISION_CONFLICT', 'STRATEGY_FRAME'].includes(result.error)) return 'stale';
      throw new Error('Strategy decision conflicts with current run state');
    }
    if (!response.ok) {
      if (response.status < 500) this.pending = null;
      throw new Error(`Strategy decision rejected (${response.status})`);
    }
    await response.json();
    this.pending = null;
    return 'accepted';
  }
}
export async function runStrategy(
  client,
  { maxPolls = 120, intervalMs = 1000, signal, onStatus = () => {} } = {},
) {
  if (
    !Number.isSafeInteger(maxPolls) ||
    maxPolls < 1 ||
    maxPolls > 1000 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1
  )
    throw new Error('Invalid polling bounds');
  for (let i = 0; i < maxPolls && !signal?.aborted; i++) {
    let status;
    try {
      status = await client.tick();
    } catch (error) {
      if (!client.pending) throw error;
      status = 'retrying';
    }
    onStatus(status);
    if (status === 'finished') return;
    if (i + 1 < maxPolls && !signal?.aborted)
      await delay(intervalMs, undefined, { signal }).catch((error) => {
        if (error.name !== 'AbortError') throw error;
      });
  }
  if (client.pending) throw new Error('Decision outcome unresolved; save and retry the same pending request');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runId, targetJson = '{"rwa-a":5000,"rwa-b":5000}', owner = 'alice', baseUrl] = process.argv.slice(2);
  if (!runId) {
    console.error(
      'Usage: node tools/automata/strategy-client.mjs RUN_ID TARGETS_JSON [alice|bob] [LOOPBACK_ORIGIN]',
    );
    process.exitCode = 1;
  } else {
    let client;
    try {
      client = new StrategyClient({ runId, targets: JSON.parse(targetJson), owner, baseUrl });
      await client.connect();
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      await runStrategy(client, { signal: controller.signal, onStatus: (s) => console.log(s) });
    } catch (error) {
      console.error(error.message);
      if (client?.pending) console.error(client.pending);
      process.exitCode = 1;
    }
  }
}

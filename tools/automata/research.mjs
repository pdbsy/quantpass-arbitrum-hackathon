import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRun, transition, equity } from '../../packages/automata/src/engine.ts';
import { datasetFrames } from '../../packages/automata/src/fixtures.ts';
import { emaTargets, EMA_STRATEGY } from '../../packages/automata/src/ema-strategy.ts';
const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const root = new URL('../../', import.meta.url);
const parameters = (feeBps) => ({
  strategyMode: 'external',
  weights: { 'rwa-a': 5000, 'rwa-b': 5000 },
  deviationBps: 1,
  intervalMs: 1000,
  feeBps,
  maxSlippageBps: 100,
  limits: { mode: 'off' },
});
export function beginResearch({ feeBps = 10, slippageBps = 0 } = {}) {
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 100)
    throw new Error('Research slippage must be 0..100 bps');
  return {
    run: createRun('ema-research', '1000000000', parameters(feeBps)),
    slippageBps,
    observations: [],
    pending: null,
    decisions: [],
  };
}
export function advanceResearch(previous, raw) {
  const result = structuredClone(previous),
    frame = structuredClone(raw);
  for (const q of frame.quotes) q.slippageBps = result.slippageBps;
  result.run = transition(result.run, { type: 'frame', frame });
  if (frame.seq !== result.observations.length + 1)
    throw new Error('Research requires ordered unique frames');
  result.observations.push(frame);
  if (result.pending && result.run.status === 'running') {
    result.run = transition(result.run, {
      type: 'decision',
      id: `signal_${result.pending.signalFrame}`,
      frameSeq: frame.seq,
      targets: result.pending.targets,
    });
    result.decisions.push({ ...result.pending, executionFrame: frame.seq });
  }
  result.pending = null;
  if (result.run.status === 'running') {
    const targets = emaTargets({
      observations: result.observations,
      frameSeq: frame.seq,
      parameters: result.run.parameters,
      positions: result.run.positions,
    });
    if (targets !== null) result.pending = { signalFrame: frame.seq, targets };
  }
  return result;
}
export function replayResearch({ frames = datasetFrames('ema-cycle'), feeBps = 10, slippageBps = 0 } = {}) {
  return frames.reduce(advanceResearch, beginResearch({ feeBps, slippageBps }));
}
function fixedPathCosts() {
  return [
    { feeBps: 0, slippageBps: 0 },
    { feeBps: 10, slippageBps: 0 },
    { feeBps: 10, slippageBps: 25 },
    { feeBps: 10, slippageBps: 50 },
  ].map((model) => {
    let run = createRun('fixed-cost-path', '1000000000', {
      ...parameters(model.feeBps),
      weights: { 'rwa-a': 5000 },
    });
    for (const frame of datasetFrames('trend')) {
      for (const q of frame.quotes) q.slippageBps = model.slippageBps;
      run = transition(run, { type: 'frame', frame });
      if (frame.seq === 1 || frame.seq === 120)
        run = transition(run, {
          type: 'decision',
          id: `fixed_${frame.seq}`,
          frameSeq: frame.seq,
          targets: frame.seq === 1 ? { 'rwa-a': 5000 } : {},
        });
    }
    let grossPnl = 0n;
    for (const t of run.trades) {
      const n = BigInt(t.quantity) * BigInt(t.price);
      const gross = t.side === 'buy' ? (n + 999999n) / 1000000n : n / 1000000n;
      grossPnl += t.side === 'buy' ? -gross : gross;
    }
    return {
      ...model,
      endEquity: equity(run).toString(),
      grossPnl: grossPnl.toString(),
      fees: run.fees,
      trades: run.trades.length,
    };
  });
}
export function researchReport({ frames = datasetFrames('ema-cycle'), feeBps = 10, slippageBps = 0 } = {}) {
  const codeFiles = [
    'packages/automata/src/engine.ts',
    'packages/automata/src/model.ts',
    'packages/automata/src/strategy-protocol.ts',
    'packages/automata/src/fixtures.ts',
    'packages/automata/src/ema-strategy.ts',
    'tools/automata/research.mjs',
  ];
  const manifest = {
    scope: 'SYNTHETIC_RESEARCH_ONLY',
    protocol: 'alphaforge-research-v1',
    strategy: EMA_STRATEGY,
    strategySource: 'ebd7268d68609ae85f73de8290d9673afb1992ac',
    runtime: process.version,
    clock: 'synthetic-period-ms',
    ordering: 'closed-observation signal -> next event execution',
    arithmetic: 'integer currency micro-units; EMA 12-decimal floor',
    randomness: 'none',
    endPolicy: 'keep positions and pending signal; no fabricated final fill',
    model: { version: 'bid-ask-plus-adverse-bps-v1', feeBps, slippageBps },
    parameters: parameters(feeBps),
    dataSha256: hash(frames),
    codeSha256: Object.fromEntries(
      codeFiles.map((path) => [path, hash(readFileSync(new URL(path, root), 'utf8'))]),
    ),
  };
  const checkpoint = replayResearch({ frames, feeBps, slippageBps });
  const stress = [0, 25, 50].map((slippageBps) => {
    const c = replayResearch({ frames, feeBps, slippageBps });
    return {
      slippageBps,
      endEquity: equity(c.run).toString(),
      fees: c.run.fees,
      trades: c.run.trades.length,
      resultHash: hash(c),
    };
  });
  return {
    manifestId: hash(manifest),
    manifest,
    inputs: frames,
    resultHash: hash(checkpoint),
    checkpoint,
    emaCostScenarios: stress,
    fixedPathCosts: fixedPathCosts(),
    notRun: [
      'real historical bars/corporate actions',
      'real-time market connection',
      'venue-calibrated liquidity/latency/gas',
      'LEAN numerical parity',
      'production sustained operation',
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = researchReport();
  const checkout = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    trackedDirty:
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: root,
        encoding: 'utf8',
      }).trim() !== '',
  };
  console.log(JSON.stringify({ ...report, checkout }, null, 2));
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeObserved } from '../tools/coverage/evidence.mjs';
const graph = {
  path: 'a.ts',
  statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
  fnMap: {},
  branchMap: {
    0: {
      type: 'if',
      line: 1,
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      locations: [
        { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
        { start: { line: 1, column: 3 }, end: { line: 1, column: 4 } },
      ],
    },
  },
  s: { 0: 0 },
  f: {},
  b: { 0: [0, 0] },
};
const manifest = {
  candidateCommit: 'a'.repeat(40),
  candidateTree: 'b'.repeat(40),
  toolDigest: 'c'.repeat(64),
  sources: {
    'a.ts': { sha256: 'd'.repeat(64), coverage: graph },
    'never.ts': { sha256: 'e'.repeat(64), coverage: { ...structuredClone(graph), path: 'never.ts' } },
  },
};
function observation(id = 'node', b = [1, 0]) {
  return {
    candidateCommit: manifest.candidateCommit,
    candidateTree: manifest.candidateTree,
    toolDigest: manifest.toolDigest,
    id,
    complete: true,
    sources: {
      'a.ts': { sha256: 'd'.repeat(64), coverage: { ...structuredClone(graph), s: { 0: 1 }, b: { 0: b } } },
    },
  };
}
test('verified complementary observations retain unexecuted denominator without mutating raw input', () => {
  const rows = [observation(), observation('browser', [0, 1])];
  const before = JSON.stringify(rows);
  const result = mergeObserved(manifest, rows);
  assert.deepEqual(result.coverage['a.ts'].b, { 0: [1, 1] });
  assert.deepEqual(result.coverage['never.ts'].b, { 0: [0, 0] });
  assert.equal(result.coverage['never.ts'].s[0], 0);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(result.lowerBound, true);
});
test('missing and incomplete lifecycles contribute no inferred hits', () => {
  const incomplete = observation();
  incomplete.complete = false;
  const result = mergeObserved(manifest, [incomplete]);
  assert.deepEqual(result.coverage['a.ts'].b, { 0: [0, 0] });
  assert.deepEqual(mergeObserved(manifest, []).coverage['never.ts'].s, { 0: 0 });
  assert.deepEqual(result.incomplete, ['node']);
});
for (const [label, mutate] of [
  ['candidate', (r) => (r.candidateCommit = 'f'.repeat(40))],
  ['tree', (r) => (r.candidateTree = 'f'.repeat(40))],
  ['tool', (r) => (r.toolDigest = 'f'.repeat(64))],
  ['source', (r) => (r.sources['a.ts'].sha256 = 'f'.repeat(64))],
  ['unknown source', (r) => (r.sources['alien.ts'] = r.sources['a.ts'])],
  ['graph', (r) => (r.sources['a.ts'].coverage.branchMap[0].type = 'cond-expr')],
  ['path', (r) => (r.sources['a.ts'].coverage.path = '../a.ts')],
  ['counter ID', (r) => (r.sources['a.ts'].coverage.s[1] = 2)],
  ['missing counter', (r) => delete r.sources['a.ts'].coverage.s[0]],
  ['branch length', (r) => r.sources['a.ts'].coverage.b[0].push(1)],
  ['negative', (r) => (r.sources['a.ts'].coverage.s[0] = -1)],
  ['fraction', (r) => (r.sources['a.ts'].coverage.s[0] = 0.5)],
  ['unsafe', (r) => (r.sources['a.ts'].coverage.s[0] = Number.MAX_SAFE_INTEGER + 1)],
  ['lifecycle', (r) => (r.complete = 'yes')],
  ['unreported source digest', (r) => delete r.sources['a.ts'].sha256],
])
  test(`rejects ${label} mismatch before aggregation`, () => {
    const r = observation();
    mutate(r);
    assert.throws(() => mergeObserved(manifest, [r]));
  });
test('duplicate observation is rejected rather than replay counted', () =>
  assert.throws(() => mergeObserved(manifest, [observation(), observation()])));
test('unsafe accumulated counters are rejected', () => {
  const a = observation(),
    b = observation('two');
  a.sources['a.ts'].coverage.s[0] = Number.MAX_SAFE_INTEGER;
  assert.throws(() => mergeObserved(manifest, [a, b]));
});
test('manifest cannot seed hits or escape canonical paths', () => {
  let m = structuredClone(manifest);
  m.sources['a.ts'].coverage.s[0] = 1;
  assert.throws(() => mergeObserved(m, []));
  m = structuredClone(manifest);
  m.sources['../a.ts'] = m.sources['a.ts'];
  assert.throws(() => mergeObserved(m, []));
});

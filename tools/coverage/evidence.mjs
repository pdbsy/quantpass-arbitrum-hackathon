import assert from 'node:assert/strict';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (a, b) => assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
function canonicalPath(path) {
  assert.equal(typeof path, 'string');
  assert.ok(
    path.length > 0 &&
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.includes(':') &&
      path.split('/').every((x) => x && x !== '.' && x !== '..'),
  );
}
function counter(n) {
  assert.ok(Number.isSafeInteger(n) && n >= 0, 'invalid coverage counter');
}
function coverageShape(value, path, zero = false) {
  assert.ok(object(value));
  assert.equal(value.path, path);
  for (const key of ['statementMap', 'fnMap', 'branchMap', 's', 'f', 'b']) assert.ok(object(value[key]));
  for (const [map, counts] of [
    ['statementMap', 's'],
    ['fnMap', 'f'],
    ['branchMap', 'b'],
  ]) {
    sameKeys(value[map], value[counts]);
    for (const id of Object.keys(value[map])) {
      assert.match(id, /^(0|[1-9][0-9]*)$/);
      const values = counts === 'b' ? value.b[id] : [value[counts][id]];
      assert.ok(Array.isArray(values));
      if (counts === 'b') {
        assert.ok(Array.isArray(value.branchMap[id].locations));
        assert.equal(values.length, value.branchMap[id].locations.length);
      }
      for (const n of values) {
        counter(n);
        if (zero) assert.equal(n, 0, 'manifest must contain zero counters');
      }
    }
  }
}
export function mergeObserved(manifest, observations) {
  assert.ok(object(manifest) && object(manifest.sources) && Array.isArray(observations));
  for (const key of ['candidateCommit', 'candidateTree']) assert.match(manifest[key], /^[a-f0-9]{40}$/);
  assert.match(manifest.toolDigest, /^[a-f0-9]{64}$/);
  const coverage = Object.create(null);
  const seen = new Set();
  const incomplete = [];
  for (const [path, entry] of Object.entries(manifest.sources)) {
    canonicalPath(path);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    coverageShape(entry.coverage, path, true);
    coverage[path] = structuredClone(entry.coverage);
  }
  assert.ok(Object.keys(coverage).length > 0, 'empty source universe');
  for (const row of observations) {
    assert.ok(object(row));
    for (const key of ['candidateCommit', 'candidateTree', 'toolDigest'])
      assert.equal(row[key], manifest[key]);
    assert.equal(typeof row.id, 'string');
    assert.ok(row.id.length > 0 && !seen.has(row.id), 'duplicate or absent lifecycle ID');
    seen.add(row.id);
    assert.equal(typeof row.complete, 'boolean');
    assert.ok(object(row.sources));
    for (const [path, entry] of Object.entries(row.sources)) {
      assert.ok(Object.hasOwn(manifest.sources, path), 'unknown source');
      const expected = manifest.sources[path];
      assert.equal(entry.sha256, expected.sha256);
      coverageShape(entry.coverage, path);
      for (const key of ['statementMap', 'fnMap', 'branchMap'])
        assert.deepEqual(entry.coverage[key], expected.coverage[key]);
    }
    if (!row.complete) {
      incomplete.push(row.id);
      continue;
    }
    for (const [path, entry] of Object.entries(row.sources))
      for (const key of ['s', 'f', 'b'])
        for (const [id, n] of Object.entries(entry.coverage[key])) {
          if (key === 'b')
            coverage[path].b[id] = n.map((hit, i) => {
              const total = coverage[path].b[id][i] + hit;
              counter(total);
              return total;
            });
          else {
            const total = coverage[path][key][id] + n;
            counter(total);
            coverage[path][key][id] = total;
          }
        }
  }
  return { coverage, lowerBound: true, incomplete };
}

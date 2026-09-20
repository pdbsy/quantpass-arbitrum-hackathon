import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export const browserDigest = (value) => createHash('sha256').update(value).digest('hex');
export const browserManifestDigest = (manifest) => browserDigest(JSON.stringify(manifest, null, 2) + '\n');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysEqual = (left, right) => assert.deepEqual(Object.keys(left).sort(), Object.keys(right).sort());

function canonicalPath(path) {
  assert.ok(typeof path === 'string' && !path.includes('\\') && !path.includes(':'));
  assert.ok(path.split('/').every((part) => part && part !== '.' && part !== '..'));
}

export function verifyBrowserSource({ root, manifest, generated, path, source }) {
  canonicalPath(path);
  const alias = manifest.aliases?.[path];
  const canonical = alias?.canonical || path;
  const entry = manifest.sources[canonical];
  assert.ok(entry, `unregistered browser source: ${path}`);
  const absolute = resolve(root, path);
  assert.ok(realpathSync(absolute).startsWith(realpathSync(root) + sep), 'browser source escaped root');
  const stat = lstatSync(absolute);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'browser source must be a regular file');
  const expected = alias?.sha256 || entry.sha256;
  assert.equal(browserDigest(readFileSync(absolute)), expected, `changed browser source: ${path}`);
  if (source !== undefined)
    assert.equal(browserDigest(source), expected, `changed transform source: ${path}`);
  const item = generated[canonical];
  assert.ok(item && typeof item.code === 'string', `missing generated browser source: ${path}`);
  assert.equal(browserDigest(item.code), entry.generatedSha256, `changed generated source: ${path}`);
  if (entry.sourceMapSha256)
    assert.equal(
      browserDigest(JSON.stringify(item.map)),
      entry.sourceMapSha256,
      `changed source map: ${path}`,
    );
  return item;
}

export function browserHelperBootstrap({ root, manifest, generated, parser, paths }) {
  const helpers = new Map();
  for (const path of paths) {
    const { code } = verifyBrowserSource({ root, manifest, generated, path });
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: manifest.sources[path].options?.parserPlugins || [],
    });
    const found = ast.program.body.filter(
      (node) => node.type === 'FunctionDeclaration' && node.id?.name.startsWith('cov_'),
    );
    assert.equal(found.length, 1, `missing or ambiguous coverage helper: ${path}`);
    const node = found[0];
    assert.ok(!helpers.has(node.id.name), 'duplicate coverage helper');
    helpers.set(node.id.name, code.slice(node.start, node.end));
  }
  // Defining helpers does not execute them or add source hits.
  return [...helpers]
    .map(([name, code]) => `${code}\nglobalThis[${JSON.stringify(name)}]=${name};`)
    .join('\n');
}

export function browserCoverageSources(manifest, raw, loaded) {
  assert.ok(object(raw), 'invalid raw browser coverage');
  const sources = {};
  for (const [path, coverage] of Object.entries(raw)) {
    assert.ok(
      Object.hasOwn(manifest.sources, path) && loaded.has(path),
      `unregistered browser graph: ${path}`,
    );
    const entry = manifest.sources[path];
    const runtime = entry.runtimeCoverage || entry.coverage;
    assert.equal(coverage.path, path);
    for (const [map, counters] of [
      ['statementMap', 's'],
      ['fnMap', 'f'],
      ['branchMap', 'b'],
    ]) {
      assert.deepEqual(coverage[map], runtime[map], `browser runtime graph mismatch: ${path}/${map}`);
      assert.ok(object(coverage[counters]), 'invalid browser counters');
      keysEqual(coverage[counters], runtime[counters]);
      keysEqual(runtime[map], entry.coverage[map]);
      for (const id of Object.keys(runtime[counters])) {
        const counts = counters === 'b' ? coverage.b[id] : [coverage[counters][id]];
        assert.ok(Array.isArray(counts));
        if (counters === 'b') assert.equal(counts.length, runtime.b[id].length);
        for (const count of counts)
          assert.ok(Number.isSafeInteger(count) && count >= 0, 'invalid browser hit count');
      }
    }
    const canonical = structuredClone(coverage);
    for (const key of ['statementMap', 'fnMap', 'branchMap'])
      canonical[key] = structuredClone(entry.coverage[key]);
    sources[path] = { sha256: entry.sha256, coverage: canonical };
  }
  return sources;
}

export function writeBrowserArtifact(directory, kind, data) {
  const file = `${kind}-${randomUUID()}.json`;
  const bytes = typeof data === 'string' ? `${data}\n` : `${JSON.stringify(data)}\n`;
  writeFileSync(resolve(directory, file), bytes, { flag: 'wx' });
  return { kind, file, sha256: browserDigest(bytes), bytes: Buffer.byteLength(bytes) };
}

function readArtifact(directory, reference) {
  assert.ok(reference && /^[a-z]+-[a-f0-9-]+\.json$/.test(reference.file), 'invalid browser artifact path');
  const path = resolve(directory, reference.file);
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'browser artifact must be a regular file');
  const bytes = readFileSync(path);
  assert.equal(bytes.length, reference.bytes, 'browser artifact byte count changed');
  assert.equal(browserDigest(bytes), reference.sha256, 'browser artifact digest changed');
  return JSON.parse(bytes);
}

export function replayBrowserCoverage({ manifest, outputDirectory, index }) {
  const collection = readArtifact(outputDirectory, index);
  const manifestSha256 = browserManifestDigest(manifest);
  const binding = {
    candidateCommit: manifest.candidateCommit,
    candidateTree: manifest.candidateTree,
    toolDigest: manifest.toolDigest,
    manifestSha256,
  };
  for (const [key, value] of Object.entries(binding)) assert.equal(collection[key], value);
  const starts = new Map();
  const completes = new Map();
  const files = new Map();
  for (const reference of collection.artifacts) {
    assert.ok(!files.has(reference.file), 'duplicate browser artifact');
    files.set(reference.file, { reference, value: readArtifact(outputDirectory, reference) });
    if (reference.kind === 'started' || reference.kind === 'complete') {
      const value = files.get(reference.file).value;
      for (const [key, expected] of Object.entries(binding)) assert.equal(value[key], expected);
      const target = reference.kind === 'started' ? starts : completes;
      assert.ok(typeof value.id === 'string' && !target.has(value.id), 'duplicate browser lifecycle');
      target.set(value.id, value);
    }
  }
  for (const id of completes.keys()) assert.ok(starts.has(id), 'browser completion has no start');
  const observations = [];
  const consumedRaw = new Set();
  for (const [id, start] of starts) {
    const row = completes.get(id);
    if (!row) {
      observations.push({ ...start, complete: false, empty: true, sources: {}, reason: 'UNFLUSHED' });
      continue;
    }
    for (const key of ['pageId', 'sequence', 'workflow']) assert.equal(row[key], start[key]);
    assert.equal(typeof row.complete, 'boolean');
    if (row.raw) {
      assert.ok(!consumedRaw.has(row.raw.file), 'browser raw artifact reused by multiple intervals');
      consumedRaw.add(row.raw.file);
      const raw = files.get(row.raw.file);
      assert.ok(raw && raw.reference.kind === 'raw', 'missing browser raw artifact');
      assert.deepEqual(row.raw, raw.reference);
      if (row.complete) {
        const sources = browserCoverageSources(manifest, raw.value, new Set(row.loadedSources));
        assert.deepEqual(row.sources, sources, 'browser observation differs from raw replay');
        assert.equal(row.empty, Object.keys(raw.value).length === 0);
      }
    } else assert.equal(row.complete, false, 'complete browser interval requires raw capture');
    if (!row.complete) assert.deepEqual(row.sources, {}, 'incomplete interval must contribute zero');
    observations.push(row);
  }
  return { observations, artifacts: collection.artifacts };
}

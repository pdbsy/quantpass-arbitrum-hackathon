import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadCoverageTools, sha256 } from './toolchain.mjs';
import { readSourceSnapshot, instrumentSnapshot } from './inventory.mjs';
import { mergeObserved } from './evidence.mjs';

export async function prepareCoverage(root, options) {
  const snapshot = readSourceSnapshot(root);
  const tools = await loadCoverageTools(root, options);
  const { manifest, generated } = await instrumentSnapshot(root, snapshot, tools);
  const sourceBase = options.sourceBase;
  assert.match(sourceBase, /^[a-f0-9]{40}$/);
  execFileSync('git', ['merge-base', '--is-ancestor', sourceBase, snapshot.candidateCommit], {
    cwd: root,
    stdio: 'pipe',
  });
  manifest.baseCommit = sourceBase;
  mergeObserved(manifest, []);
  const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  const directory = resolve(options.output || resolve(root, 'outputs/phase1-local-closeout/coverage'), runId);
  mkdirSync(directory, { recursive: true });
  const bytes = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(resolve(directory, 'manifest.json'), bytes, { flag: 'wx' });
  writeFileSync(resolve(directory, 'generated.json'), JSON.stringify(generated) + '\n', { flag: 'wx' });
  const result = {
    schemaVersion: 1,
    provider: 'LOCAL',
    status: 'PREPARED_NOT_MEASURED',
    runId,
    sourceCommit: manifest.candidateCommit,
    sourceTree: manifest.candidateTree,
    baseCommit: sourceBase,
    manifestSha256: sha256(bytes),
    generatedSha256: sha256(JSON.stringify(generated) + '\n'),
    toolDigest: manifest.toolDigest,
    sources: Object.keys(manifest.sources).length,
    aliases: Object.keys(manifest.aliases).length,
  };
  writeFileSync(resolve(directory, 'preparation.json'), JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
  });
  return { directory, ...result };
}
export async function verifyPrepared(root, directory, options) {
  function read(name) {
    const path = resolve(directory, name);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'coverage artifact must be a regular file');
    return readFileSync(path);
  }
  const preparation = JSON.parse(read('preparation.json'));
  const manifestBytes = read('manifest.json');
  const generatedBytes = read('generated.json');
  assert.equal(preparation.schemaVersion, 1);
  assert.equal(preparation.provider, 'LOCAL');
  assert.equal(preparation.status, 'PREPARED_NOT_MEASURED');
  assert.equal(sha256(manifestBytes), preparation.manifestSha256);
  assert.equal(sha256(generatedBytes), preparation.generatedSha256);
  assert.equal(options.sourceBase, preparation.baseCommit);
  const snapshot = readSourceSnapshot(root);
  assert.equal(snapshot.candidateCommit, preparation.sourceCommit);
  assert.equal(snapshot.candidateTree, preparation.sourceTree);
  execFileSync(
    'git',
    ['--no-replace-objects', 'merge-base', '--is-ancestor', options.sourceBase, snapshot.candidateCommit],
    { cwd: root, stdio: 'pipe', timeout: 15000 },
  );
  const tools = await loadCoverageTools(root, options);
  assert.equal(tools.descriptorSha256, preparation.toolDigest);
  const expected = await instrumentSnapshot(root, snapshot, tools);
  expected.manifest.baseCommit = options.sourceBase;
  const manifest = JSON.parse(manifestBytes);
  const generated = JSON.parse(generatedBytes);
  assert.deepEqual(manifest, expected.manifest, 'manifest does not match regenerated source graph');
  assert.deepEqual(generated, expected.generated, 'generated instrumentation changed');
  assert.equal(Object.keys(manifest.sources).length, preparation.sources);
  assert.equal(Object.keys(manifest.aliases).length, preparation.aliases);
  mergeObserved(manifest, []);
  return { preparation, manifest, generated, tools };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const pairs = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < pairs.length; i += 2) {
    const key = { '--tools': 'instrumentationDirectory', '--base': 'sourceBase', '--output': 'output' }[
      pairs[i]
    ];
    assert.ok(key && pairs[i + 1] && !Object.hasOwn(options, key), 'invalid coverage prepare arguments');
    options[key] = pairs[i + 1];
  }
  console.log(JSON.stringify(await prepareCoverage(root, options), null, 2));
}

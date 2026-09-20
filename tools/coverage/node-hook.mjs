import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { threadId } from 'node:worker_threads';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const root = process.env.AF_COVERAGE_ROOT;
const directory = process.env.AF_COVERAGE_PREPARED;
const raw = process.env.AF_COVERAGE_RAW;
assert.ok(root && directory && raw && process.env.AF_COVERAGE_WORKFLOW);
const manifestBytes = readFileSync(resolve(directory, 'manifest.json'));
const generatedBytes = readFileSync(resolve(directory, 'generated.json'));
assert.equal(digest(manifestBytes), process.env.AF_COVERAGE_MANIFEST_SHA);
assert.equal(digest(generatedBytes), process.env.AF_COVERAGE_GENERATED_SHA);
const manifest = JSON.parse(manifestBytes);
const generated = JSON.parse(generatedBytes);
const id = `${process.pid}-${threadId}-${randomUUID()}`;
const loaded = new Set(['tools/coverage/node-hook.mjs']);
const metadata = {
  candidateCommit: manifest.candidateCommit,
  candidateTree: manifest.candidateTree,
  toolDigest: manifest.toolDigest,
  manifestSha256: digest(manifestBytes),
  id,
  workflow: process.env.AF_COVERAGE_WORKFLOW,
  pid: process.pid,
  threadId,
  kind: 'NODE_PROCESS',
  command: process.argv,
};
function save(name, data) {
  const file = resolve(raw, name);
  writeFileSync(file + '.tmp', JSON.stringify(data) + '\n', { flag: 'wx' });
  renameSync(file + '.tmp', file);
}
save(`started-${id}.json`, metadata);
registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith('file:')) return result;
    const path = relative(root, fileURLToPath(url)).split(sep).join('/');
    const alias = manifest.aliases[path];
    const canonical = alias?.canonical || path;
    if (!Object.hasOwn(manifest.sources, canonical)) return result;
    const entry = manifest.sources[canonical];
    assert.ok(entry.sourceMapSha256, 'browser inline source is not a Node module');
    const source =
      typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    assert.equal(digest(source), alias?.sha256 || entry.sha256, `changed coverage source: ${path}`);
    const item = generated[canonical];
    assert.equal(digest(item.code), entry.generatedSha256);
    assert.equal(digest(JSON.stringify(item.map)), entry.sourceMapSha256);
    loaded.add(canonical);
    return { ...result, source: item.code };
  },
});
process.on('exit', (exitCode) => {
  const sources = {};
  for (const [path, coverage] of Object.entries(JSON.parse(JSON.stringify(globalThis.__coverage__ || {})))) {
    assert.ok(loaded.has(path), `unregistered instrumented source: ${path}`);
    sources[path] = { sha256: manifest.sources[path].sha256, coverage };
  }
  save(`complete-${id}.json`, { ...metadata, complete: true, exitCode, sources });
});

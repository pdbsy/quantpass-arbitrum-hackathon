import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { verifyPrepared } from './prepare.mjs';
import { sha256 } from './toolchain.mjs';
import { loadLifecycleArtifacts } from './artifacts.mjs';
import { mergeObserved } from './evidence.mjs';
const json = (value) => JSON.stringify(value, null, 2) + '\n';
function bootstrapSource(environment, hook, launch) {
  return `Object.assign(process.env, ${JSON.stringify(environment)});\nawait import(${JSON.stringify(pathToFileURL(hook).href)});\nawait import(${JSON.stringify(pathToFileURL(launch).href)});\n`;
}
function artifactRecord(directory, file) {
  assert.match(file, /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
  const path = join(directory, file);
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'artifact must be a regular file');
  const bytes = readFileSync(path);
  return { file, bytes: bytes.length, sha256: sha256(bytes) };
}
function rawInventory(directory) {
  return readdirSync(directory)
    .sort()
    .map((file) => {
      const path = join(directory, file);
      const stat = lstatSync(path);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'raw artifact must be a regular file');
      const bytes = readFileSync(path);
      return { file, bytes: bytes.length, sha256: sha256(bytes) };
    });
}
export async function collectNodeWorkflow(root, preparedDirectory, options) {
  const { runLocal } = await import('../local-ci/runner.mjs');
  const { preparation, manifest, generated } = await verifyPrepared(root, preparedDirectory, options);
  assert.match(options.id, /^[a-z][a-z0-9-]{0,63}$/);
  assert.ok(
    Array.isArray(options.args) &&
      options.args.length > 0 &&
      options.args.every((x) => typeof x === 'string' && !x.includes('\0')),
  );
  const directory = resolve(preparedDirectory, `workflow-${options.id}-${randomUUID()}`);
  mkdirSync(directory);
  const raw = join(directory, 'raw');
  mkdirSync(raw);
  const hook = join(directory, 'node-hook.mjs');
  writeFileSync(hook, generated['tools/coverage/node-hook.mjs'].code, { flag: 'wx' });
  const environment = {
    AF_COVERAGE_ROOT: resolve(root),
    AF_COVERAGE_PREPARED: resolve(preparedDirectory),
    AF_COVERAGE_MANIFEST_SHA: preparation.manifestSha256,
    AF_COVERAGE_GENERATED_SHA: preparation.generatedSha256,
    AF_COVERAGE_RAW: raw,
    AF_COVERAGE_WORKFLOW: options.id,
    AF_COVERAGE_COMMAND: JSON.stringify(options.args),
    NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
    NODE_DISABLE_COMPILE_CACHE: '1',
  };
  const bootstrap = join(directory, 'bootstrap.mjs');
  const bootstrapBytes = bootstrapSource(environment, hook, resolve(root, 'tools/coverage/launch.mjs'));
  writeFileSync(bootstrap, bootstrapBytes, { flag: 'wx' });
  const expected = {
    base: manifest.baseCommit,
    head: manifest.candidateCommit,
    tree: manifest.candidateTree,
    node: process.versions.node,
  };
  const jobs = [
    {
      id: options.id,
      executable: process.execPath,
      args: [bootstrap],
      timeoutMs: options.timeoutMs,
      platform: process.platform,
      arch: process.arch,
    },
  ];
  const run = await runLocal({ cwd: root, outputRoot: join(directory, 'execution'), expected, jobs });
  const receipt = {
    schemaVersion: 1,
    provider: 'LOCAL',
    id: options.id,
    args: options.args,
    expected,
    manifestSha256: preparation.manifestSha256,
    executionDirectory: run.directory,
    environment,
    bootstrapSha256: sha256(bootstrapBytes),
    hookSha256: sha256(readFileSync(hook)),
    jobs,
    rawArtifacts: rawInventory(raw),
    artifacts: (options.artifactFiles || []).map((file) => artifactRecord(directory, file)),
    state: run.state,
  };
  writeFileSync(join(directory, 'workflow.json'), json(receipt), { flag: 'wx' });
  return { directory, executionDirectory: run.directory, state: run.state };
}
export async function verifyNodeWorkflow(directory, manifest, manifestSha256, configuration) {
  const { verifyRun } = await import('../local-ci/runner.mjs');
  const r = JSON.parse(readFileSync(join(directory, 'workflow.json')));
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.provider, 'LOCAL');
  assert.equal(r.manifestSha256, manifestSha256);
  assert.deepEqual(
    { id: r.id, args: r.args },
    configuration,
    'workflow command differs from required configuration',
  );
  const expected = {
    base: manifest.baseCommit,
    head: manifest.candidateCommit,
    tree: manifest.candidateTree,
    node: process.versions.node,
  };
  assert.deepEqual(r.expected, expected);
  const hook = join(directory, 'node-hook.mjs');
  assert.equal(sha256(readFileSync(hook)), manifest.sources['tools/coverage/node-hook.mjs'].generatedSha256);
  assert.equal(r.hookSha256, manifest.sources['tools/coverage/node-hook.mjs'].generatedSha256);
  const bootstrap = join(directory, 'bootstrap.mjs');
  assert.equal(sha256(readFileSync(bootstrap)), r.bootstrapSha256);
  assert.equal(
    readFileSync(bootstrap, 'utf8'),
    bootstrapSource(
      r.environment,
      hook,
      resolve(r.environment.AF_COVERAGE_ROOT, 'tools/coverage/launch.mjs'),
    ),
  );
  assert.equal(r.environment.AF_COVERAGE_MANIFEST_SHA, manifestSha256);
  assert.equal(r.environment.AF_COVERAGE_WORKFLOW, r.id);
  assert.equal(r.environment.AF_COVERAGE_COMMAND, JSON.stringify(r.args));
  assert.equal(r.environment.AF_COVERAGE_RAW, join(directory, 'raw'));
  const run = JSON.parse(readFileSync(join(r.executionDirectory, 'report.json')));
  assert.deepEqual(run.manifest, r.jobs);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].id, r.id);
  assert.equal(r.jobs[0].executable, process.execPath);
  assert.deepEqual(r.jobs[0].args, [bootstrap]);
  const verified = verifyRun(r.executionDirectory, expected);
  assert.ok(['PASS', 'FAIL', 'NOT_RUN'].includes(verified.state), 'workflow evidence blocked');
  assert.equal(verified.state, r.state);
  assert.ok(Array.isArray(r.artifacts));
  assert.equal(new Set(r.artifacts.map((record) => record.file)).size, r.artifacts.length);
  for (const record of r.artifacts)
    assert.deepEqual(artifactRecord(directory, record.file), record, 'workflow artifact changed');
  assert.deepEqual(rawInventory(join(directory, 'raw')), r.rawArtifacts, 'raw coverage artifact changed');
  const observations = loadLifecycleArtifacts(join(directory, 'raw'), manifest, manifestSha256, r.id);
  if (verified.state === 'PASS') {
    const root = observations.find((row) => row.pid === run.jobs[0].pid && row.threadId === 0);
    assert.ok(root?.complete && root.exitCode === 0, 'root workflow lifecycle incomplete');
  }
  mergeObserved(manifest, observations);
  return { state: verified.state, observations, artifacts: r.artifacts };
}

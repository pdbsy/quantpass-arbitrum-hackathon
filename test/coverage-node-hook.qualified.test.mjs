import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  readdirSync,
  copyFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareCoverage } from '../tools/coverage/prepare.mjs';
import { collectNodeWorkflow, verifyNodeWorkflow } from '../tools/coverage/collect.mjs';
import { reportCoverage } from '../tools/coverage/report.mjs';
import { mergeObserved } from '../tools/coverage/evidence.mjs';
const repository = resolve(import.meta.dirname, '..');
const instrumentationDirectory = process.env.AF_QUALIFIED_COVERAGE_TOOLS;
assert.ok(instrumentationDirectory);
async function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-node-hook-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  git('init', '-q');
  git('config', 'user.name', 'Coverage fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(root, 'planning'));
  mkdirSync(join(root, 'tools/coverage'), { recursive: true });
  for (const f of ['coverage-toolchain.lock.json', 'coverage-instrumentation.package-lock.json'])
    copyFileSync(join(repository, 'planning', f), join(root, 'planning', f));
  copyFileSync(join(repository, 'tools/coverage/node-hook.mjs'), join(root, 'tools/coverage/node-hook.mjs'));
  for (const chunk of JSON.parse(readFileSync(join(repository, 'planning/coverage-toolchain.lock.json')))
    .instrumentation.installedFileChunks)
    copyFileSync(join(repository, chunk.path), join(root, chunk.path));
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(root, '.gitignore'), 'outputs/\n');
  writeFileSync(join(root, 'choice.ts'), 'export function choose(x: boolean) { return x ? 7 : 9; }\n');
  writeFileSync(join(root, 'unused.mjs'), 'export function unused() { return 10; }\n');
  copyFileSync(join(repository, 'tools/coverage/launch.mjs'), join(root, 'tools/coverage/launch.mjs'));
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const prepared = await prepareCoverage(root, {
    instrumentationDirectory,
    sourceBase: git('rev-parse', 'HEAD').trim(),
  });
  const generated = JSON.parse(readFileSync(join(prepared.directory, 'generated.json')));
  const hook = join(prepared.directory, 'hook.mjs');
  writeFileSync(hook, generated['tools/coverage/node-hook.mjs'].code);
  const raw = join(prepared.directory, 'raw');
  mkdirSync(raw);
  const env = {
    ...process.env,
    NODE_OPTIONS: '',
    NODE_DISABLE_COMPILE_CACHE: '1',
    AF_COVERAGE_ROOT: root,
    AF_COVERAGE_PREPARED: prepared.directory,
    AF_COVERAGE_MANIFEST_SHA: prepared.manifestSha256,
    AF_COVERAGE_GENERATED_SHA: prepared.generatedSha256,
    AF_COVERAGE_RAW: raw,
    AF_COVERAGE_WORKFLOW: 'fixture',
  };
  const run = (code, beforeHook = []) =>
    spawnSync(
      process.execPath,
      [...beforeHook, '--import', pathToFileURL(hook).href, '--input-type=module', '-e', code],
      {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 10000,
      },
    );
  return {
    root,
    prepared,
    raw,
    run,
    manifest: JSON.parse(readFileSync(join(prepared.directory, 'manifest.json'))),
  };
}
test('real Node hook unions original TypeScript branches and retains never-loaded zero graph', async (t) => {
  const f = await fixture(t);
  for (const x of ['true', 'false']) {
    const r = f.run(
      `import {choose} from './choice.ts';if(choose(${x})!==${x === 'true' ? 7 : 9})process.exit(4);`,
    );
    assert.equal(r.status, 0, r.stderr);
  }
  const rows = readdirSync(f.raw)
    .filter((n) => n.startsWith('complete-'))
    .map((n) => JSON.parse(readFileSync(join(f.raw, n))));
  assert.equal(rows.length, 2);
  const merged = mergeObserved(f.manifest, rows);
  assert.deepEqual(Object.values(merged.coverage['choice.ts'].b), [[1, 1]]);
  assert.deepEqual(Object.values(merged.coverage['unused.mjs'].f), [0]);
  assert.ok(rows.every((r) => r.sources['tools/coverage/node-hook.mjs']));
});
test('changed source fails and killed lifecycle keeps its start without inventing complete hits', async (t) => {
  const f = await fixture(t);
  writeFileSync(join(f.root, 'choice.ts'), 'export const changed=1;');
  const failed = f.run("await import('./choice.ts')");
  assert.notEqual(failed.status, 0);
  const killed = f.run("process.kill(process.pid,'SIGKILL')");
  assert.equal(killed.signal, 'SIGKILL');
  const starts = readdirSync(f.raw).filter((n) => n.startsWith('started-'));
  const completes = readdirSync(f.raw).filter((n) => n.startsWith('complete-'));
  assert.equal(starts.length, 2);
  assert.equal(completes.length, 1);
  const completed = JSON.parse(readFileSync(join(f.raw, completes[0])));
  assert.notEqual(completed.exitCode, 0);
});

test('Node hook accepts unchanged UTF-8 string loader results and preserves their actual branch hit', async (t) => {
  const f = await fixture(t);
  const loader = `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);return result.source&&typeof result.source!=='string'?{...result,source:Buffer.from(result.source).toString('utf8')}:result;}});`;
  const result = f.run("import {choose} from './choice.ts';if(choose(false)!==9)process.exit(4);", [
    '--import',
    `data:text/javascript,${encodeURIComponent(loader)}`,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const rows = readdirSync(f.raw)
    .filter((name) => name.startsWith('complete-'))
    .map((name) => JSON.parse(readFileSync(join(f.raw, name))));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sources['choice.ts'].coverage.b['0'], [0, 1]);
});

test('uninstrumented diagnostic hook with no loaded sources records empty evidence instead of seeded hits', async (t) => {
  const f = await fixture(t);
  const rawHook = join(f.prepared.directory, 'unmeasured-hook.mjs');
  copyFileSync(join(repository, 'tools/coverage/node-hook.mjs'), rawHook);
  // A deliberately uninstrumented bootstrap is only a lower-bound diagnostic.
  // The qualified collector separately requires its exact generated hook hash.
  const bootstrap = `await import(${JSON.stringify(pathToFileURL(rawHook).href)});`;
  const manifestBytes = readFileSync(join(f.prepared.directory, 'manifest.json'));
  const generatedBytes = readFileSync(join(f.prepared.directory, 'generated.json'));
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', bootstrap], {
    cwd: f.root,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      AF_COVERAGE_ROOT: f.root,
      AF_COVERAGE_PREPARED: f.prepared.directory,
      AF_COVERAGE_RAW: f.raw,
      AF_COVERAGE_WORKFLOW: 'diagnostic',
      AF_COVERAGE_MANIFEST_SHA: digest(manifestBytes),
      AF_COVERAGE_GENERATED_SHA: digest(generatedBytes),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const rows = readdirSync(f.raw)
    .filter((name) => name.startsWith('complete-'))
    .map((name) => JSON.parse(readFileSync(join(f.raw, name))));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sources, {});
  assert.deepEqual(Object.values(mergeObserved(f.manifest, rows).coverage['choice.ts'].b), [[0, 0]]);
});

test('bounded real workflow preserves pass/failure and rejects missing execution logs', async (t) => {
  const f = await fixture(t);
  const options = {
    instrumentationDirectory,
    sourceBase: f.manifest.baseCommit,
    id: 'qualified-check',
    args: [
      '--input-type=module',
      '-e',
      "import {choose} from './choice.ts'; import {writeFileSync} from 'node:fs'; import {resolve} from 'node:path'; if(choose(true)!==7) process.exit(9); writeFileSync(resolve(process.env.AF_COVERAGE_RAW, '../proof.json'), '{}');",
    ],
    timeoutMs: 10000,
    artifactFiles: ['proof.json'],
  };
  const passed = await collectNodeWorkflow(f.root, f.prepared.directory, options);
  assert.equal(passed.state, 'PASS');
  const replay = await verifyNodeWorkflow(passed.directory, f.manifest, f.prepared.manifestSha256, {
    id: options.id,
    args: options.args,
  });
  assert.equal(replay.state, 'PASS');
  assert.ok(replay.observations.length >= 2);
  const failedOptions = { ...options };
  delete failedOptions.artifactFiles;
  const failed = await collectNodeWorkflow(f.root, f.prepared.directory, {
    ...failedOptions,
    id: 'qualified-failure',
    args: ['-e', 'process.exit(7)'],
  });
  assert.equal(failed.state, 'FAIL');
  const failedReplay = await verifyNodeWorkflow(failed.directory, f.manifest, f.prepared.manifestSha256, {
    id: 'qualified-failure',
    args: ['-e', 'process.exit(7)'],
  });
  assert.equal(failedReplay.state, 'FAIL');
  const measured = await reportCoverage(f.root, f.prepared.directory, {
    ...options,
    workflows: [{ id: options.id, args: options.args, directory: passed.directory }],
  });
  assert.equal(measured.report.functionalState, 'PASS');
  assert.equal(measured.report.thresholdMet, false);
  assert.equal(measured.report.files.find((x) => x.path === 'unused.mjs').summary.functions.pct, 0);
  assert.equal(measured.report.files.find((x) => x.path === 'choice.ts').summary.branches.pct, 50);
  const proof = join(passed.directory, 'proof.json');
  writeFileSync(proof, '{"altered":true}');
  await assert.rejects(
    verifyNodeWorkflow(passed.directory, f.manifest, f.prepared.manifestSha256, {
      id: options.id,
      args: options.args,
    }),
  );
  writeFileSync(proof, '{}');
  const rawDirectory = join(passed.directory, 'raw');
  const artifact = readdirSync(rawDirectory).find((name) => name.startsWith('complete-'));
  const artifactPath = join(rawDirectory, artifact);
  const originalArtifact = readFileSync(artifactPath);
  const alteredArtifact = JSON.parse(originalArtifact);
  const firstSource = Object.values(alteredArtifact.sources)[0].coverage;
  firstSource.s[Object.keys(firstSource.s)[0]] += 1;
  writeFileSync(artifactPath, JSON.stringify(alteredArtifact));
  await assert.rejects(
    verifyNodeWorkflow(passed.directory, f.manifest, f.prepared.manifestSha256, {
      id: options.id,
      args: options.args,
    }),
  );
  writeFileSync(artifactPath, originalArtifact);
  rmSync(join(passed.executionDirectory, 'qualified-check.stdout.log'));
  await assert.rejects(
    verifyNodeWorkflow(passed.directory, f.manifest, f.prepared.manifestSha256, {
      id: options.id,
      args: options.args,
    }),
  );
});

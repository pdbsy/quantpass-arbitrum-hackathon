import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
function execute(args, env = process.env) {
  return spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
}

test('management CLIs reject unsupported options without binding servers or producing success evidence', () => {
  for (const [script, args, message] of [
    ['tools/run-management-checks.mjs', ['--profile=invalid'], /Management checks failed: Invalid profile/],
    [
      'tools/build-management-dashboard.mjs',
      ['--observed-at=invalid'],
      /Management dashboard build failed: Invalid observed-at/,
    ],
    [
      'tools/serve-management-dashboard.mjs',
      ['--host=0.0.0.0'],
      /Management dashboard server failed: Unknown argument/,
    ],
  ]) {
    const run = execute([script, ...args]);
    assert.equal(run.status, 1, `${script}: ${run.stderr}`);
    assert.match(run.stderr, message);
    assert.equal(run.stdout, '');
  }
});

test('configuration CLI refuses omitted and production modes and only reports explicit mock configuration', () => {
  for (const env of [
    { ...process.env, QP_MODE: '', QP_ADAPTER: '' },
    { ...process.env, QP_MODE: 'production', QP_ADAPTER: 'mock' },
    { ...process.env, QP_MODE: 'local', QP_ADAPTER: 'mock', NODE_ENV: 'production' },
  ]) {
    const run = execute(['tools/check-config.ts'], env);
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /Only explicit QP_MODE=local|Mock configuration must not run/);
  }
  const valid = execute(['tools/check-config.ts'], {
    ...process.env,
    QP_MODE: 'local',
    QP_ADAPTER: 'mock',
    NODE_ENV: 'test',
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), { mode: 'local', adapter: 'mock', realFundsEnabled: false });
});

test('artifact checkers reject stale, missing and unreadable assets without rewriting committed output', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'alphaforge-artifact-admission-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const stale = join(temporary, 'stale.html');
  const directory = join(temporary, 'directory');
  await writeFile(stale, 'This is a stale generated artifact.\n');
  await mkdir(directory);
  for (const [module, exportName, output, scenarios] of [
    ['tools/build-planning.mjs', 'buildPlanning', 'TODO.md', ['stale', 'missing', 'directory']],
    ['tools/build-agent-forum.mjs', 'build', 'docs/management/dashboard/agent-forum.html', ['stale']],
  ]) {
    const target = resolve(root, output);
    const before = await readFile(target);
    for (const scenario of scenarios) {
      const fixture =
        scenario === 'stale' ? stale : scenario === 'directory' ? directory : join(temporary, 'absent');
      // Redirect only the input asset read to a real private fixture. The original
      // generator, renderer and comparison remain unchanged; production files are untouched.
      const program = `
        import assert from 'node:assert/strict';
        import fs from 'node:fs/promises';
        import { syncBuiltinESMExports } from 'node:module';
        const [module, exportName, target, fixture, scenario] = process.argv.slice(1);
        const original = fs.readFile;
        let intercepted = 0;
        fs.readFile = function(path, ...args) {
          if (path === target) { intercepted++; return original.call(this, fixture, ...args); }
          return original.call(this, path, ...args);
        };
        syncBuiltinESMExports();
        const generator = await import(module);
        await assert.rejects(generator[exportName]({ check: true }), scenario === 'directory' ? { code: 'EISDIR' } : /stale/);
        assert.equal(intercepted, 1);
        console.log('PASS rejected actual artifact ' + scenario);
      `;
      const run = execute([
        '--input-type=module',
        '--eval',
        program,
        new URL(`../${module}`, import.meta.url).href,
        exportName,
        target,
        fixture,
        scenario,
      ]);
      assert.equal(run.status, 0, `${module}/${scenario}: ${run.stderr}`);
      assert.match(run.stdout, /PASS rejected actual artifact/);
      assert.deepEqual(await readFile(target), before);
    }
  }
});

test(
  'management collector records a real npm signal termination without TMPDIR as failure',
  {
    skip: process.platform === 'win32',
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'alphaforge-management-signal-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'alphaforge-signal-fixture',
        private: true,
        scripts: { lint: 'kill -TERM $$' },
      }),
    );
    const program = `
    import { runCheck } from ${JSON.stringify(new URL('../tools/management-dashboard/checks.mjs', import.meta.url).href)};
    const result = await runCheck('lint', {
      root: process.argv[1], commit: 'a'.repeat(40), runId: 'native-signal',
    });
    console.log(JSON.stringify(result));
  `;
    const env = { ...process.env };
    delete env.TMPDIR;
    const run = execute(['--input-type=module', '--eval', program, directory], env);
    assert.equal(run.error, undefined);
    assert.equal(run.signal, null);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.record.status, 'FAIL');
    assert.equal(result.record.exitCode, 127);
    assert.match(result.log, /kill -TERM/);
    assert.doesNotMatch(result.log, /PROCESS_ERROR|TIMEOUT/);
  },
);

test('planning, governance and threat CLIs reject real input failures without publishing success', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'alphaforge-governance-cli-boundary-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const malformed = join(temporary, 'malformed.json');
  await writeFile(malformed, '{ invalid json');
  for (const [script, relative, fixture, message] of [
    ['tools/check-governance-v2.mjs', 'planning/security-boundary.json', malformed, /JSON|property name/],
    [
      'tools/check-governance-v2.mjs',
      'docs/reviews/GOV-001.json',
      temporary,
      /governance review record cannot be read/,
    ],
    ['tools/build-planning.mjs', 'planning/roadmap.json', malformed, /JSON|property name/],
    ['tools/check-threat-model.mjs', 'planning/risk-register.json', malformed, /JSON|property name/],
  ]) {
    const target = resolve(root, relative);
    const before = await readFile(target).catch((error) => {
      assert.equal(error.code, 'ENOENT');
      return null;
    });
    const hook = `
      import fs from 'node:fs/promises';
      import {syncBuiltinESMExports} from 'node:module';
      const original = fs.readFile;
      fs.readFile = (path, ...args) => original(path === ${JSON.stringify(target)} ? ${JSON.stringify(fixture)} : path, ...args);
      syncBuiltinESMExports();
    `;
    const run = execute(['--import', `data:text/javascript,${encodeURIComponent(hook)}`, script]);
    assert.equal(run.error, undefined);
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, message);
    assert.deepEqual(
      await readFile(target).catch((error) => {
        assert.equal(error.code, 'ENOENT');
        return null;
      }),
      before,
    );
  }
});

test('importing the management collector from eval does not execute checks or rewrite evidence', async () => {
  const target = resolve(root, '.checks/management/latest.json');
  const before = await readFile(target);
  const program = `
    import assert from 'node:assert/strict';
    assert.equal(process.argv[1], undefined);
    const collector = await import(${JSON.stringify(new URL('../tools/run-management-checks.mjs', import.meta.url).href)});
    assert.equal(typeof collector.main, 'function');
  `;
  const run = execute(['--input-type=module', '--eval', program]);
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '');
  assert.deepEqual(await readFile(target), before);
});

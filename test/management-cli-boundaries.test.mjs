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

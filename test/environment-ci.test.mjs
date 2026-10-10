import assert from 'node:assert/strict';
import test from 'node:test';
import { verify } from '../tools/verify-ci.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  CANONICAL_REPOSITORY,
  CANONICAL_REPOSITORY_ID,
  HISTORICAL_REPOSITORY,
} from '../tools/environment/policy.mjs';

test('CI wrapper runs fixed full gate and rejects failures or changed source inputs', () => {
  const good = { exitCode: 0, head: 'a', tree: 'b', lockSha256: 'c' };
  let calls = [];
  assert.equal(
    verify({
      inspect: () => good,
      run: () => {
        calls.push('check');
        return 7;
      },
      emit: () => {},
    }),
    7,
  );
  assert.deepEqual(calls, ['check']);
  calls = [];
  assert.equal(
    verify({
      inspect: () => ({ ...good, exitCode: 2 }),
      run: () => {
        calls.push('check');
        return 0;
      },
      emit: () => {},
    }),
    2,
  );
  assert.deepEqual(calls, []);
  let n = 0;
  assert.equal(
    verify({ inspect: () => (n++ ? { ...good, tree: 'changed' } : good), run: () => 0, emit: () => {} }),
    1,
  );
  assert.equal(verify({ inspect: () => good, run: () => 0, emit: () => {} }), 0);
});

test('exact npm bootstrap recognizes the approved rename before allowing any installation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-bootstrap-rename-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const marker = join(directory, 'install-calls.txt');
  const preload = join(directory, 'observe-bootstrap.mjs');
  const bootstrap = fileURLToPath(new URL('../tools/bootstrap-ci-npm.mjs', import.meta.url));
  const npm = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ).packageManager.slice(4);
  // Run the real bootstrap entry point, while intercepting only its npm child:
  // no global installation or network call is possible in this fixture.
  writeFileSync(
    preload,
    `import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
childProcess.spawnSync = (command, args) => {
  if (!args.includes('install') && !args.includes('--version')) throw new Error('unexpected bootstrap child');
  appendFileSync(${JSON.stringify(marker)}, args.includes('install') ? 'install\\n' : 'version\\n');
  return { status: 0, stdout: ${JSON.stringify(npm + '\n')}, stderr: '' };
};
syncBuiltinESMExports();
`,
  );
  const run = (repository, id) => {
    writeFileSync(marker, '');
    const result = spawnSync(process.execPath, ['--import', preload, bootstrap], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_REPOSITORY: repository,
        ...(id === undefined ? {} : { GITHUB_REPOSITORY_ID: id }),
      },
    });
    return { result, calls: readFileSync(marker, 'utf8') };
  };
  for (const [repository, id] of [
    [CANONICAL_REPOSITORY, String(CANONICAL_REPOSITORY_ID)],
    [HISTORICAL_REPOSITORY, undefined],
  ]) {
    const { result, calls } = run(repository, id);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(calls, 'install\nversion\n');
  }
  for (const [repository, id] of [
    ['other/Alphaforge', String(CANONICAL_REPOSITORY_ID)],
    ['pdbsy/other', String(CANONICAL_REPOSITORY_ID)],
    [CANONICAL_REPOSITORY, String(CANONICAL_REPOSITORY_ID + 1)],
    [CANONICAL_REPOSITORY, undefined],
  ]) {
    const { result, calls } = run(repository, id);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /BLOCKED at inputs/);
    assert.equal(calls, '');
  }
});

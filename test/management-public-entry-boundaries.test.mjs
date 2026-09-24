import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';

test('registered integration executes the approved Node and confirms cleanup without inherited PATH', async (t) => {
  // Detects a launcher that relies on PATH, dispatches the wrong registered
  // arguments, skips the real child, or claims success without confirmed cleanup.
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), 'alphaforge-management-public-entry-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const nonce = randomUUID();
  const receiptPath = join(root, 'receipt.json');
  const testPath = join(root, 'test/server.test.ts');
  await mkdir(join(root, 'test'));
  await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n');
  await writeFile(
    testPath,
    `import { writeFileSync } from 'node:fs';
import test from 'node:test';
test('private registered integration receipt', () => {
  writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({
    nonce: ${JSON.stringify(nonce)}, executable: process.execPath,
    cwd: process.cwd(), testPath: process.argv[1], path: process.env.PATH,
  }), { flag: 'wx' });
});
`,
  );
  const parentPath = Object.entries(process.env).filter(([key]) => key.toUpperCase() === 'PATH');
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.toUpperCase() === 'PATH') delete environment[key];
  const program = `
import assert from 'node:assert/strict';
import { runCheck } from ${JSON.stringify(new URL('../tools/management-dashboard/checks.mjs', import.meta.url).href)};
assert.equal(Object.keys(process.env).some(key => key.toUpperCase() === 'PATH'), false);
const result = await runCheck('integration', {
  root: ${JSON.stringify(root)}, commit: 'a'.repeat(40), runId: 'public-entry-no-path',
});
process.stdout.write(JSON.stringify({ nonce: ${JSON.stringify(nonce)}, result }));
`;
  // The outer watchdog exceeds the fixed 120s production timeout plus cleanup.
  // The fixture has no timers, server, or descendant process of its own.
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 150_000,
    maxBuffer: 256 * 1024,
  });
  assert.equal(run.error, undefined);
  assert.equal(run.signal, null);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.deepEqual(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() === 'PATH'),
    parentPath,
  );
  const observed = JSON.parse(run.stdout);
  assert.equal(observed.nonce, nonce);
  assert.equal(observed.result.record.id, 'integration');
  assert.equal(observed.result.record.status, 'PASS');
  assert.equal(observed.result.record.exitCode, 0);
  assert.equal(observed.result.cleanupConfirmed, true);
  assert.doesNotMatch(observed.result.log, /PROCESS_ERROR|TIMEOUT|CLEANUP_UNCONFIRMED/);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.nonce, nonce);
  assert.equal(realpathSync.native(receipt.executable), realpathSync.native(process.execPath));
  assert.equal(realpathSync.native(receipt.cwd), root);
  assert.equal(realpathSync.native(resolve(root, receipt.testPath)), realpathSync.native(testPath));
  assert.equal(receipt.path, dirname(process.execPath) + delimiter);
  t.diagnostic(JSON.stringify({ nonce, launcher: observed.result.record.id, cleanupConfirmed: true }));
});

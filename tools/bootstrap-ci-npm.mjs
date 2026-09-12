import { dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readInputs, npmCli, ROOT } from './environment/observe.mjs';
import { overrideKinds } from './environment/policy.mjs';
let stage = 'inputs';
// Explicit bootstrap, separate from the offline doctor. Hosted ephemeral Node only.
try {
  const inputs = readInputs(ROOT);
  if (
    process.argv.length !== 2 ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    process.env.GITHUB_REPOSITORY !== inputs.supply.repository ||
    process.versions.node !== inputs.node ||
    overrideKinds(process.env).length
  )
    throw new Error('Bootstrap context unavailable');
  stage = 'npm-location';
  const cli = npmCli();
  const nodeDirectory = dirname(realpathSync(process.execPath));
  const prefix = process.platform === 'win32' ? nodeDirectory : resolve(nodeDirectory, '..');
  stage = 'install';
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'install',
      '--global',
      '--prefix=' + prefix,
      inputs.package.packageManager,
      '--ignore-scripts',
      '--strict-ssl=true',
      '--registry=' + inputs.supply.dependencyPolicy.registryOrigin + '/',
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 180000, shell: false },
  );
  if (result.status !== 0) throw new Error('Bootstrap failed');
  stage = 'version-verification';
  const actual = spawnSync(process.execPath, [npmCli(), '--version'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
    shell: false,
  });
  if (actual.status !== 0 || actual.stdout.trim() !== inputs.package.packageManager.slice(4))
    throw new Error('Bootstrap version mismatch');
  process.stdout.write('Exact npm bootstrap PASS; registry/TLS/lifecycle controls retained.\n');
} catch {
  process.stderr.write(
    'Exact npm bootstrap BLOCKED at ' +
      stage +
      '; no project dependencies installed, no raw download/configuration values disclosed.\n',
  );
  process.exitCode = 2;
}

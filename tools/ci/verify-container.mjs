import { createHash } from 'node:crypto';
import { npmCli } from '../environment/observe.mjs';
import { inspect, assertUnchanged, run, emit, main } from './context.mjs';

export function validateContainerHost(host) {
  if (
    host.platform !== 'linux' ||
    host.arch !== 'x64' ||
    host.dockerOS !== 'linux' ||
    host.dockerArch !== 'x86_64'
  )
    throw new Error('Container CI requires native Linux x64 host and daemon');
}
const imageId = (text) => {
  const id = text.trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('Immutable image ID required');
  return id;
};
const lifecycleResults = [
  'REAL_TLS_LIVENESS_MOCK_NOT_DEPLOYMENT',
  'PUBLIC_EXECUTOR_RECOVERY_ISOLATION',
  'NONROOT_IDENTITIES_CAPABILITY_DROP',
  'SIGTERM_GRACEFUL_STOP',
  'COLD_SNAPSHOT_VERIFIED_INDEPENDENT_COPY',
  'IMAGE_REPLACEMENT_PERSISTENCE_AFTER_BACKUP',
  'CHILD_DEATH_STOPS_PEERS_PRESERVES_LEASE_NO_RESTART',
];
export function runContainerStages(execute) {
  const stages = [],
    images = {};
  const stage = (name, file, args) => {
    const result = execute(file, args);
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const incomplete = Boolean(result.error || result.signal || !Number.isInteger(result.status));
    stages.push({
      name,
      command: [file, ...args],
      exitCode: result.status,
      incomplete,
      logBytes: Buffer.byteLength(output),
      logSha256: createHash('sha256').update(output).digest('hex'),
    });
    if (incomplete || result.status !== 0) {
      const error = new Error('Container stage failed: ' + name);
      error.state = incomplete ? 'BLOCKED' : 'FAIL';
      throw error;
    }
    return result.stdout ?? '';
  };
  try {
    const tests = stage('container-tests', process.execPath, [npmCli(), 'run', 'container:test']);
    const totals = Object.fromEntries(
      ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((name) => [
        name,
        Number(new RegExp('^# ' + name + ' (\\d+)$', 'm').exec(tests)?.[1] ?? NaN),
      ]),
    );
    if (
      !(totals.tests > 0) ||
      totals.pass !== totals.tests ||
      ['fail', 'cancelled', 'skipped', 'todo'].some((name) => totals[name] !== 0)
    )
      throw new Error('Complete positive container TAP with zero skips required');
    images.runtime = imageId(
      stage('build-runtime', 'docker', [
        'build',
        '--quiet',
        '--platform',
        'linux/amd64',
        '--target',
        'runtime',
        '.',
      ]),
    );
    const admission = JSON.parse(
      stage('runtime-admission', process.execPath, [
        'deploy/container/verify-runtime-image.mjs',
        images.runtime,
      ]),
    );
    if (
      admission.scope !== 'ACTUAL_PRODUCTION_BINARY_ADMISSION_AND_NEGATIVE_STARTUP_NOT_READINESS' ||
      admission.image !== images.runtime ||
      admission.checks !== 14 ||
      admission.fail !== 0 ||
      admission.productionEmptyConfig !== 'REJECTED' ||
      admission.productionMockFixture !== 'ABSENT'
    )
      throw new Error('Complete production admission report required');
    images.verification = imageId(
      stage('build-verification', 'docker', [
        'build',
        '--quiet',
        '--platform',
        'linux/amd64',
        '--target',
        'verification',
        '.',
      ]),
    );
    const lifecycle = JSON.parse(
      stage('mock-lifecycle', process.execPath, ['deploy/container/lifecycle.mjs', images.verification]),
    );
    if (
      lifecycle.scope !== 'MOCK_CONTAINER_LIFECYCLE_NOT_REAL_CHAIN' ||
      lifecycle.image !== images.verification ||
      lifecycle.checks !== 7 ||
      lifecycle.fail !== 0 ||
      lifecycle.retainedEvidence !== true ||
      JSON.stringify(lifecycle.results) !== JSON.stringify(lifecycleResults)
    )
      throw new Error('Complete isolated lifecycle report required');
    return {
      state: 'PASS',
      stages,
      images,
      tests: totals,
      admission,
      lifecycle,
      chainReadiness: 'NOT_RUN',
      sustained24h: 'WAIVED_BY_USER',
    };
  } catch (error) {
    return {
      state: error.state ?? 'BLOCKED',
      reason: error.message,
      stages,
      images,
      chainReadiness: 'NOT_RUN',
      sustained24h: 'WAIVED_BY_USER',
    };
  }
}
await main(import.meta.url, () => {
  const before = inspect();
  assertUnchanged(before, before);
  const daemon = run('docker', ['info', '--format', '{{json .}}']);
  if (daemon.status !== 0 || daemon.error || daemon.signal)
    throw new Error('Docker daemon observation unavailable');
  const value = JSON.parse(daemon.stdout);
  validateContainerHost({
    platform: process.platform,
    arch: process.arch,
    dockerOS: value.OSType,
    dockerArch: value.Architecture,
  });
  const report = runContainerStages((file, args) => {
    const result = run(file, args, { timeout: 20 * 60 * 1000 });
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    return result;
  });
  assertUnchanged(before, inspect());
  emit({
    gate: 'container-testnet',
    ...before,
    docker: { os: value.OSType, arch: value.Architecture, serverVersion: value.ServerVersion },
    ...report,
    boundary: 'production binary admission and isolated mock lifecycle only; no deployed Vault/RPC/signing',
  });
});

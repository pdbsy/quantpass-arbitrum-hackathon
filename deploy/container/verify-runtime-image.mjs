// Actual production-image admission and negative startup checks. No deployment inputs/RPC/signing.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const requestedImage = process.argv[2];
if (process.argv.length !== 3 || !/^[-a-zA-Z0-9._/:@]+$/.test(requestedImage ?? ''))
  throw new Error('RUNTIME_IMAGE_USAGE');
const root = resolve('.checks/container-admission', randomUUID());
mkdirSync(root, { recursive: true });
let count = 0;
function command(args, env = process.env) {
  const result = spawnSync('docker', args, {
    env,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(
    join(root, String(++count).padStart(2, '0') + '.log'),
    JSON.stringify({ args, exit: result.status, signal: result.signal }) +
      '\n' +
      (result.stdout ?? '') +
      (result.stderr ?? ''),
  );
  return result;
}
const inspected = command(['image', 'inspect', requestedImage]);
assert.equal(inspected.status, 0);
const metadata = JSON.parse(inspected.stdout)[0],
  image = metadata.Id;
assert.deepEqual(metadata.Config.Entrypoint, ['node', 'deploy/container/supervisor.mjs']);
const rendered = command(['compose', 'config', '--format', 'json'], {
  ...process.env,
  AF_PUBLIC_CONFIG_DIR: root,
  AF_EXECUTOR_CONFIG_DIR: root,
  AF_TLS_DIR: root,
  AF_PUBLIC_RPC_FILE: join(root, 'not-supplied-public-rpc'),
  AF_EXECUTOR_RPC_FILE: join(root, 'not-supplied-executor-rpc'),
  AF_RELEASE_IDENTITY_FILE: '/etc/alphaforge/public/release-identity.json',
  AF_TEST_RESULTS_FILE: '/etc/alphaforge/public/test-results.json',
});
assert.equal(rendered.status, 0);
const environment = JSON.parse(rendered.stdout).services.application.environment;
const envArgs = (extra = {}) =>
  Object.entries({ ...environment, ...extra }).flatMap(([k, v]) => ['-e', k + '=' + v]);
const run = (extra, source) =>
  command([
    'run',
    '--rm',
    '--network',
    'none',
    '--platform',
    'linux/amd64',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=67108864,mode=1777',
    '--entrypoint',
    'node',
    ...envArgs(extra),
    image,
    '--input-type=module',
    '-e',
    source,
  ]);
const admission = `import {runtimeAdmission} from './deploy/container/runtime-admission.mjs';console.log(JSON.stringify(runtimeAdmission()));`;
const positive = run({}, admission);
assert.equal(positive.status, 0);
const observations = JSON.parse(positive.stdout);
assert.equal(observations.scope, 'LINUX_CONTAINER_BINARY_ADMISSION_NOT_DEPLOYMENT_READINESS');
const alteredLock = join(root, 'altered-package-lock.json');
writeFileSync(alteredLock, readFileSync('package-lock.json', 'utf8') + '\n');
const lockRejected = command([
  'run',
  '--rm',
  '--network',
  'none',
  '--platform',
  'linux/amd64',
  '--read-only',
  '--tmpfs',
  '/tmp:rw,noexec,nosuid,size=67108864,mode=1777',
  '--entrypoint',
  'node',
  ...envArgs(),
  '-v',
  alteredLock + ':/opt/alphaforge/package-lock.json:ro',
  image,
  '--input-type=module',
  '-e',
  admission,
]);
assert.equal(lockRejected.status, 1);
assert.match(lockRejected.stderr, /CONTAINER_LOCKFILE_BYTES/);
const negatives = [
  ['AF_EXECUTOR_RPC_FILE', '/tmp/wrong-rpc'],
  ['AF_RELEASE_IDENTITY_FILE', '/tmp/wrong-descriptor'],
  ['AF_TEST_RESULTS_FILE', '/tmp/wrong-tests'],
  ['AF_CONTAINER_MODE', 'sign'],
  ['AF_EXECUTOR_NONCE_DIRECTORY', '/tmp/signing'],
  ['AF_TESTNET_EXECUTOR_PRIVATE_KEY', 'MOCK_REJECT_THIS_VALUE'],
  ['HTTPS_PROXY', 'https://proxy.example.invalid'],
  ['NODE_EXTRA_CA_CERTS', '/tmp/not-supplied-ca'],
  ['NODE_OPTIONS', '--trace-warnings'],
  ['CI', 'true'],
];
for (const [key, value] of negatives) {
  const rejected = run({ [key]: value }, admission);
  assert.equal(rejected.status, 1, key);
  assert.match(rejected.stderr, /CONTAINER_/, key);
}
assert.equal(
  run(
    {},
    `import {existsSync} from 'node:fs';if(existsSync('test/container-fixtures/runtime.mjs'))process.exit(1);`,
  ).status,
  0,
);
for (const folder of ['public', 'executor']) {
  mkdirSync(join(root, folder));
  const config = JSON.parse(
    readFileSync('deploy/testnet/' + (folder === 'public' ? 'public-server' : 'executor') + '.example.json'),
  );
  config.dataDirectory = '/var/lib/alphaforge/' + folder;
  config.maxStorageBytes = 3500000000;
  // Existing examples have no deployed Vaults; they must remain inadmissible operational inputs.
  assert.deepEqual(config.vaults, []);
  writeFileSync(join(root, folder, 'operator.json'), JSON.stringify(config));
}
const startup = command([
  'run',
  '--rm',
  '--network',
  'none',
  '--platform',
  'linux/amd64',
  '--read-only',
  ...envArgs(),
  '-v',
  join(root, 'public') + ':/etc/alphaforge/public:ro',
  '-v',
  join(root, 'executor') + ':/etc/alphaforge/executor:ro',
  image,
]);
assert.equal(startup.status, 1);
assert.match(startup.stderr, /CONTAINER_STARTUP_REJECTED/);
const report = {
  scope: 'ACTUAL_PRODUCTION_BINARY_ADMISSION_AND_NEGATIVE_STARTUP_NOT_READINESS',
  requestedImage,
  image,
  root,
  observations,
  checks: 1 + negatives.length + 3,
  fail: 0,
  productionEmptyConfig: 'REJECTED',
  productionMockFixture: 'ABSENT',
};
writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));

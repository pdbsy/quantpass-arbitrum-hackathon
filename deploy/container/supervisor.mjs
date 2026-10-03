import { mkdirSync, chownSync, chmodSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DATA, LIMIT, RESERVE, USERS, regularBytes, servicePlan } from './boundary.mjs';
import { initializeVolume, retainedBytes, acquireLease } from './volume.mjs';
import { runtimeAdmission } from './runtime-admission.mjs';
import { supervise } from './supervision.mjs';
let lease;
try {
  if (process.argv.length !== 2 || process.getuid() !== 0) throw new Error();
  runtimeAdmission();
  const plan = servicePlan(
    JSON.parse(regularBytes('/etc/alphaforge/public/operator.json')),
    JSON.parse(regularBytes('/etc/alphaforge/executor/operator.json')),
  );
  initializeVolume(DATA);
  if (retainedBytes(DATA) + RESERVE >= LIMIT) throw new Error();
  lease = acquireLease(DATA);
  chownSync(DATA + '/.container-lease', USERS.supervisor.uid, USERS.supervisor.gid);
  mkdirSync('/run/alphaforge', { recursive: true, mode: 0o755 });
  chownSync('/run/alphaforge', USERS.supervisor.uid, USERS.supervisor.gid);
  chmodSync('/run/alphaforge', 0o755);
  // Recovery is immutable while this exclusive lease exists; count it as root before identity drop.
  const recoveryBaseline = retainedBytes(DATA, ['public', 'executor', 'status', '.container-lease']);
  const environment = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', LANG: 'C.UTF-8' };
  const services = [
    {
      name: 'public',
      ...USERS.public,
      command: process.execPath,
      args: plan.public,
      env: {
        ...environment,
        ...(process.env.AF_RELEASE_IDENTITY_FILE
          ? { AF_RELEASE_IDENTITY_FILE: process.env.AF_RELEASE_IDENTITY_FILE }
          : {}),
        ...(process.env.AF_TEST_RESULTS_FILE
          ? { AF_TEST_RESULTS_FILE: process.env.AF_TEST_RESULTS_FILE }
          : {}),
      },
      rpcFile: '/run/secrets/public-rpc',
      storageRoots: [DATA + '/public'],
      readyToken: 'ALPHAFORGE_PUBLIC_TESTNET_LOOPBACK_READY',
    },
    {
      name: 'executor',
      ...USERS.executor,
      command: process.execPath,
      args: plan.executor,
      env: { ...environment, AF_EXECUTOR_STATUS_EXPORT_FILE: DATA + '/status/execution-status.json' },
      rpcFile: '/run/secrets/executor-rpc',
      storageRoots: [DATA + '/executor', DATA + '/status'],
      readyToken: 'ALPHAFORGE_TESTNET_WATCH_ONLY_NO_SIGNING',
    },
    {
      name: 'proxy',
      ...USERS.proxy,
      command: process.execPath,
      args: ['deploy/container/proxy.mjs', plan.origin],
      env: environment,
      readyToken: 'CONTAINER_HTTPS_READY',
    },
  ];
  await supervise(services, {
    dropIdentity() {
      process.setgroups([]);
      process.setgid(USERS.supervisor.gid);
      process.setuid(USERS.supervisor.uid);
    },
    checkStorage(childBytes) {
      if (childBytes + recoveryBaseline + regularBytes(DATA + '/.container-lease').length + RESERVE >= LIMIT)
        throw new Error('CONTAINER_TOTAL_CAPACITY');
    },
    onReady() {
      writeFileSync(
        '/run/alphaforge/ready.json',
        JSON.stringify({
          mode: 'WATCH_ONLY',
          signingEnabled: false,
          origin: plan.origin,
          scope: 'PROCESS_LIVENESS_NOT_CHAIN_READINESS',
        }) + '\n',
        { mode: 0o644, flag: 'wx' },
      );
      console.log('CONTAINER_WATCH_ONLY_READY');
    },
    onStopped(result) {
      try {
        unlinkSync('/run/alphaforge/ready.json');
      } catch {
        /* Missing ephemeral state is safe; durable lease is retained on errors. */
      }
      if (result.clean) {
        lease.release();
        lease = undefined;
      } else
        writeFileSync(
          DATA + '/recovery/failed-stop-' + randomUUID() + '.json',
          JSON.stringify(result) + '\n',
          { mode: 0o600, flag: 'wx' },
        );
    },
  });
} catch {
  console.error('CONTAINER_STARTUP_REJECTED');
  process.exitCode = 1;
  // Startup/shutdown failure keeps its durable lease for explicit stopped-service review.
}

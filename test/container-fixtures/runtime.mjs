// Dedicated disposable MOCK composition. Never copied into the production runtime target.
import { writeFileSync, chownSync, mkdirSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DATA, USERS, LIMIT, RESERVE, regularBytes } from '../../deploy/container/boundary.mjs';
import { initializeVolume, acquireLease, retainedBytes } from '../../deploy/container/volume.mjs';
import { runtimeAdmission } from '../../deploy/container/runtime-admission.mjs';
import { supervise } from '../../deploy/container/supervision.mjs';
if (process.argv[2] !== '--mock-no-signing') throw new Error('MOCK_EXPLICIT_ENTRY_REQUIRED');
console.log(JSON.stringify(runtimeAdmission()));
initializeVolume(DATA);
const lease = acquireLease(DATA);
chownSync(DATA + '/.container-lease', 10005, 10005);
mkdirSync('/run/alphaforge', { recursive: true });
chownSync('/run/alphaforge', 10005, 10005);
const recoveryBaseline = retainedBytes(DATA, ['public', 'executor', 'status', '.container-lease']);
const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', LANG: 'C.UTF-8' };
await supervise(
  [
    {
      name: 'public',
      ...USERS.public,
      command: process.execPath,
      args: ['tools/testnet/server.ts', '--serve', '/etc/alphaforge/public/operator.json', '4190'],
      env,
      storageRoots: [DATA + '/public'],
      readyToken: 'ALPHAFORGE_PUBLIC_TESTNET_LOOPBACK_READY',
    },
    {
      name: 'executor',
      ...USERS.executor,
      command: process.execPath,
      args: ['test/container-fixtures/mock-executor.mjs'],
      env,
      storageRoots: [DATA + '/executor', DATA + '/status'],
      readyToken: 'MOCK_EXECUTOR_NO_SIGNING_READY',
    },
    {
      name: 'proxy',
      ...USERS.proxy,
      command: process.execPath,
      args: ['deploy/container/proxy.mjs', 'https://testnet.example.invalid'],
      env,
      readyToken: 'CONTAINER_HTTPS_READY',
    },
  ],
  {
    dropIdentity() {
      process.setgroups([]);
      process.setgid(10005);
      process.setuid(10005);
    },
    onReady() {
      writeFileSync(
        '/run/alphaforge/ready.json',
        JSON.stringify({
          mode: 'WATCH_ONLY',
          signingEnabled: false,
          origin: 'https://testnet.example.invalid',
          scope: 'MOCK_CONTAINER_LIFECYCLE_NOT_DEPLOYMENT',
        }),
      );
      console.log('MOCK_CONTAINER_READY');
    },
    checkStorage(bytes) {
      if (bytes + recoveryBaseline + regularBytes(DATA + '/.container-lease').length + RESERVE >= LIMIT)
        throw new Error();
    },
    onStopped(result) {
      try {
        unlinkSync('/run/alphaforge/ready.json');
      } catch {
        /* Ephemeral readiness may already be absent. */
      }
      if (result.clean) lease.release();
      else
        writeFileSync(
          DATA + '/recovery/failed-stop-' + randomUUID() + '.json',
          JSON.stringify(result) + '\n',
          { mode: 0o600, flag: 'wx' },
        );
    },
  },
);

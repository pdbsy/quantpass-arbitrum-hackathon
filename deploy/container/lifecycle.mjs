// Explicit disposable MOCK verifier. It refuses production entrypoints and never uses RPC/keys.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const requestedImage = process.argv[2];
let image = requestedImage;
if (process.argv.length !== 3 || !/^[-a-zA-Z0-9._/:@]+$/.test(image ?? ''))
  throw new Error('MOCK_LIFECYCLE_USAGE');
const id = randomUUID(),
  name = 'af-w3-mock-' + id,
  volume = name + '-data',
  root = resolve('.checks/container-lifecycle', id);
mkdirSync(root, { recursive: true });
const results = [];
let counter = 0;
function command(binary, args, { allowFailure = false } = {}) {
  const r = spawnSync(binary, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(
    join(root, String(++counter).padStart(2, '0') + '.log'),
    JSON.stringify({ binary, args, exit: r.status, signal: r.signal }) +
      '\n' +
      (r.stdout ?? '') +
      (r.stderr ?? ''),
  );
  if (!allowFailure && r.status !== 0) throw new Error('MOCK_COMMAND_FAILED_' + counter);
  return r;
}
const docker = (args) => command('docker', args);
const exec = (source) => docker(['exec', name, 'node', '--input-type=module', '-e', source]).stdout.trim();
const wait = async () => {
  for (let i = 0; i < 90; i++) {
    const r = command('docker', ['exec', name, 'node', 'deploy/container/healthcheck.mjs'], {
      allowFailure: true,
    });
    if (r.status === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('MOCK_HEALTH_TIMEOUT');
};
try {
  const inspected = JSON.parse(docker(['image', 'inspect', image]).stdout)[0];
  image = inspected.Id;
  const config = inspected.Config;
  assert.deepEqual(config.Entrypoint, ['node', 'test/container-fixtures/runtime.mjs', '--mock-no-signing']);
  const input = join(root, 'input');
  mkdirSync(join(input, 'public'), { recursive: true });
  mkdirSync(join(input, 'tls'));
  const operator = JSON.parse(readFileSync('deploy/testnet/public-server.example.json'));
  operator.dataDirectory = '/var/lib/alphaforge/public';
  operator.maxStorageBytes = 3500000000;
  writeFileSync(join(input, 'public/operator.json'), JSON.stringify(operator));
  command('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(input, 'tls/privkey.pem'),
    '-out',
    join(input, 'tls/fullchain.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=testnet.example.invalid',
    '-addext',
    'subjectAltName=DNS:testnet.example.invalid',
  ]);
  docker([
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--entrypoint',
    'node',
    '-v',
    input + ':/qa',
    image,
    '-e',
    `const f=require('node:fs');for(const [p,u,g,m] of [['/qa/public',10001,10003,448],['/qa/public/operator.json',10001,10003,384],['/qa/tls',10004,10004,448],['/qa/tls/privkey.pem',10004,10004,384],['/qa/tls/fullchain.pem',10004,10004,420]]){f.chownSync(p,u,g);f.chmodSync(p,m)}`,
  ]);
  docker(['volume', 'create', '--label', 'alphaforge.mock=true', volume]);
  const args = [
    'run',
    '-d',
    '--name',
    name,
    '--platform',
    'linux/amd64',
    '--read-only',
    '--cap-drop',
    'ALL',
    ...['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'SETUID', 'SETGID'].flatMap((c) => ['--cap-add', c]),
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '128',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=67108864,mode=1777',
    '--tmpfs',
    '/run/alphaforge:rw,noexec,nosuid,size=1048576,mode=0755',
    '-v',
    volume + ':/var/lib/alphaforge',
    '-v',
    join(input, 'public') + ':/etc/alphaforge/public:ro',
    '-v',
    join(input, 'tls') + ':/etc/alphaforge/tls:ro',
    image,
  ];
  docker(args);
  await wait();
  results.push('REAL_TLS_LIVENESS_MOCK_NOT_DEPLOYMENT');
  const permission = docker([
    'exec',
    '--user',
    '10001:10003',
    name,
    'node',
    '-e',
    `const f=require('node:fs');for(const p of ['/var/lib/alphaforge/executor/unknown-order.txt','/var/lib/alphaforge/recovery']){let denied=false;try{f.readFileSync(p)}catch(e){denied=e.code==='EACCES'}if(!denied)process.exit(1)}const s=JSON.parse(f.readFileSync('/var/lib/alphaforge/status/execution-status.json'));if(s.signingEnabled!==false)process.exit(1);for(const p of ['/var/lib/alphaforge/status/forged','/var/lib/alphaforge/forged']){try{f.writeFileSync(p,'x');process.exit(1)}catch(e){if(e.code!=='EACCES')process.exit(1)}}`,
  ]);
  assert.equal(permission.status, 0);
  results.push('PUBLIC_EXECUTOR_RECOVERY_ISOLATION');
  const identities = exec(
    `import {readFileSync,readdirSync} from 'node:fs';const rows=[];for(const p of readdirSync('/proc').filter(p=>/^[0-9]+$/.test(p))){try{const c=readFileSync('/proc/'+p+'/cmdline','utf8');if(c.includes('worker.mjs')||p==='1'){const s=readFileSync('/proc/'+p+'/status','utf8');rows.push({pid:p,uid:Number(s.match(/^Uid:\\s+(\\d+)/m)[1]),caps:s.match(/^CapEff:\\s+(\\w+)/m)[1]});}}catch{}}console.log(JSON.stringify(rows));`,
  );
  const rows = JSON.parse(identities);
  assert.equal(rows.find((r) => r.pid === '1').uid, 10005);
  for (const uid of [10001, 10002, 10004])
    assert.ok(rows.some((r) => r.uid === uid && r.caps === '0000000000000000'));
  results.push('NONROOT_IDENTITIES_CAPABILITY_DROP');
  docker(['stats', '--no-stream', '--format', '{{json .}}', name]);
  docker(['stop', '--time', '30', name]);
  assert.equal(JSON.parse(docker(['inspect', name]).stdout)[0].State.ExitCode, 0);
  results.push('SIGTERM_GRACEFUL_STOP');
  const recovery = (action, arg) =>
    docker([
      'run',
      '--rm',
      '--network',
      'none',
      '--platform',
      'linux/amd64',
      '--entrypoint',
      'node',
      '-v',
      volume + ':/var/lib/alphaforge',
      image,
      'deploy/container/recovery.mjs',
      action,
      ...(arg ? [arg] : []),
    ]).stdout.trim();
  const snapshot = recovery('snapshot');
  recovery('verify', snapshot);
  const copy = recovery('restore-copy', snapshot);
  assert.match(copy, /\/recovery\/restored-/);
  results.push('COLD_SNAPSHOT_VERIFIED_INDEPENDENT_COPY');
  docker(['rm', name]);
  docker(args);
  await wait();
  assert.equal(
    exec(
      `import {readFileSync} from 'node:fs';console.log(readFileSync('/var/lib/alphaforge/executor/unknown-order.txt','utf8'));`,
    ),
    'MOCK_RESERVED_NONCE_17_UNKNOWN',
  );
  results.push('IMAGE_REPLACEMENT_PERSISTENCE_AFTER_BACKUP');
  const kill = command(
    'docker',
    [
      'exec',
      '--user',
      '10002:10003',
      name,
      'node',
      '--input-type=module',
      '-e',
      `import {readFileSync,readdirSync} from 'node:fs';const matches=readdirSync('/proc').filter(p=>/^[0-9]+$/.test(p)&&p!==String(process.pid)).filter(p=>{try{return readFileSync('/proc/'+p+'/cmdline','utf8').split(String.fromCharCode(0)).includes('test/container-fixtures/mock-executor.mjs')}catch{return false}});if(matches.length!==1)throw new Error('MOCK_TARGET_NOT_UNIQUE');process.kill(Number(matches[0]),'SIGKILL');console.log('MOCK_EXECUTOR_KILLED');`,
    ],
    { allowFailure: true },
  );
  assert.ok([0, 137].includes(kill.status));
  for (let i = 0; i < 30; i++) {
    const s = JSON.parse(docker(['inspect', name]).stdout)[0].State;
    if (!s.Running) {
      assert.equal(s.ExitCode, 1);
      break;
    }
    if (i === 29) throw new Error('MOCK_DEATH_NOT_SUPERVISED');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const retained = docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--platform',
    'linux/amd64',
    '--entrypoint',
    'node',
    '-v',
    volume + ':/var/lib/alphaforge',
    image,
    '-e',
    `const f=require('node:fs');if(!f.existsSync('/var/lib/alphaforge/.container-lease')||!f.readdirSync('/var/lib/alphaforge/recovery').some(p=>p.startsWith('failed-stop-')))process.exit(1)`,
  ]);
  assert.equal(retained.status, 0);
  results.push('CHILD_DEATH_STOPS_PEERS_PRESERVES_LEASE_NO_RESTART');
  const report = {
    scope: 'MOCK_CONTAINER_LIFECYCLE_NOT_REAL_CHAIN',
    requestedImage,
    image,
    volume,
    name,
    root,
    results,
    checks: results.length,
    fail: 0,
    retainedEvidence: true,
  };
  writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  command('docker', ['logs', name], { allowFailure: true });
  command('docker', ['inspect', name], { allowFailure: true });
  writeFileSync(
    join(root, 'failure.json'),
    JSON.stringify({ scope: 'MOCK', image, volume, name, root, results, error: error.message }) + '\n',
  );
  command('docker', ['stop', '--time', '30', name], { allowFailure: true });
  console.error(JSON.stringify({ root, error: error.message }));
  process.exitCode = 1;
}

import {
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  renameSync,
  unlinkSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CHECK_IDS, CONFIG } from './policy.mjs';
const keys =
  'schemaVersion generatedAt mode scope exitCode eligibleForEvidence node npm git platform arch image head tree base sourceHead sourceTree context baseObservedAt remoteFreshness lockSha256 checks commands'
    .split(' ')
    .sort();
const valid = (value) => {
  if (!value) throw new Error('Invalid environment report');
};
export function validateReport(r, binding = {}) {
  valid(r && JSON.stringify(Object.keys(r).sort()) === JSON.stringify(keys));
  valid(
    r.schemaVersion === 1 && ['dev', 'ci'].includes(r.mode) && r.scope === 'offline-local-mock-admission',
  );
  const age = Date.now() - Date.parse(r.generatedAt);
  valid(Number.isFinite(age) && age >= -60000 && age <= 900000);
  valid(r.remoteFreshness === 'NOT_RUN' && Number.isFinite(Date.parse(r.baseObservedAt)));
  valid(/^[a-f0-9]{64}$/.test(r.lockSha256));
  for (const key of ['head', 'tree', 'base', 'sourceHead', 'sourceTree'])
    valid(r[key] === null || /^[a-f0-9]{40}$/.test(r[key]));
  for (const key of ['node', 'npm', 'git', 'image'])
    valid(r[key] === null || /^[0-9][0-9A-Za-z.+-]{0,60}$/.test(r[key]));
  valid([null, 'darwin', 'win32', 'linux'].includes(r.platform) && [null, 'arm64', 'x64'].includes(r.arch));
  valid([null, 'local', 'push', 'pull_request', 'merge_group', 'workflow_dispatch'].includes(r.context));
  valid(Array.isArray(r.checks) && JSON.stringify(r.checks.map((c) => c.id)) === JSON.stringify(CHECK_IDS));
  for (const c of r.checks)
    valid(
      Object.keys(c).length === 2 &&
        ['PASS', 'WARN', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(c.status) &&
        (c.status !== 'NOT_RUN' || c.id === 'contracts') &&
        (c.status !== 'WARN' || (c.id === 'workspace' && r.mode === 'dev')),
    );
  valid(r.checks.at(-1).status === 'NOT_RUN');
  const exit = r.checks.some((c) => c.status === 'FAIL')
    ? 1
    : r.checks.some((c) => c.status === 'BLOCKED')
      ? 2
      : 0;
  valid(
    r.exitCode === exit &&
      r.eligibleForEvidence === (exit === 0 && !r.checks.some((c) => c.status === 'WARN')),
  );
  if (r.eligibleForEvidence)
    for (const key of [
      'head',
      'tree',
      'base',
      'sourceHead',
      'sourceTree',
      'node',
      'npm',
      'git',
      'platform',
      'arch',
      'context',
    ])
      valid(r[key] !== null);
  for (const [key, value] of Object.entries(binding))
    valid(['head', 'tree', 'lockSha256'].includes(key) && r[key] === value);
  valid(Array.isArray(r.commands) && r.commands.length <= 80);
  for (const c of r.commands)
    valid(
      Object.keys(c).length === 2 &&
        [
          ...[
            'version',
            'rev-parse',
            'remote',
            'show',
            'cat-file',
            'merge-base',
            'branch',
            'status',
            'ls-files',
            'config',
          ].map((k) => 'git-' + k),
          'npm-version',
          ...[...Object.keys(CONFIG), 'registry', 'proxy', 'https-proxy'].map((k) => 'npm-config-' + k),
          'host-uname',
          'host-native',
          'host-fnm',
          'host-fnm-current',
          'ports-proc',
          'ports-lsof',
          'ports-netstat',
        ].includes(c.id) &&
        (c.exitCode === null || (Number.isInteger(c.exitCode) && c.exitCode >= 0 && c.exitCode <= 255)),
    );
  valid(Buffer.byteLength(JSON.stringify(r)) <= 65536);
  return r;
}
export function writeReport(root, report) {
  validateReport(report);
  const canonical = realpathSync(root);
  valid(canonical === realpathSync(resolve(root)));
  const parents = [canonical];
  for (const part of ['.checks', 'environment']) {
    const path = join(parents.at(-1), part);
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    const st = lstatSync(path);
    valid(st.isDirectory() && !st.isSymbolicLink() && realpathSync(path) === path);
    parents.push(path);
  }
  const destination = join(parents.at(-1), 'report.json');
  const snapshots = parents.map((p) => lstatSync(p, { bigint: true }));
  const recheck = () =>
    parents.forEach((p, index) => {
      const st = lstatSync(p, { bigint: true });
      valid(
        st.isDirectory() &&
          !st.isSymbolicLink() &&
          st.ino === snapshots[index].ino &&
          st.dev === snapshots[index].dev,
      );
    });
  if (existsSync(destination)) {
    const st = lstatSync(destination);
    valid(st.isFile() && !st.isSymbolicLink() && st.nlink === 1);
  }
  const temp = join(parents.at(-1), `.report-${randomBytes(12).toString('hex')}.tmp`);
  let fd;
  try {
    recheck();
    fd = openSync(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(fd, JSON.stringify(report, null, 2) + '\n');
    closeSync(fd);
    fd = undefined;
    recheck();
    if (existsSync(destination)) {
      const st = lstatSync(destination);
      valid(st.isFile() && !st.isSymbolicLink() && st.nlink === 1);
    }
    renameSync(temp, destination);
    recheck();
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
  return destination;
}

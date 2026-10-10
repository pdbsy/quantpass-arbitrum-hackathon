import {
  writeFileSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  chownSync,
  openSync,
  readSync,
  closeSync,
  fsyncSync,
  renameSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inventory, retainedBytes, acquireLease, syncDirectory } from './volume.mjs';
import { DATA, LIMIT, RESERVE, regularBytes } from './boundary.mjs';
function hash(file) {
  const fd = openSync(file, 'r'),
    h = createHash('sha256'),
    buffer = Buffer.alloc(65536);
  try {
    let n;
    while ((n = readSync(fd, buffer, 0, buffer.length, null))) h.update(buffer.subarray(0, n));
    return h.digest('hex');
  } finally {
    closeSync(fd);
  }
}
const safeId = (id) => {
  if (!/^snapshot-[a-f0-9-]{36}$/.test(id)) throw new Error('CONTAINER_BACKUP_ID');
  return id;
};
function metadata(root) {
  return inventory(root, ['recovery', '.container-lease']).map((item) => ({
    ...item,
    ...(!item.directory ? { sha256: hash(join(root, item.path)) } : {}),
  }));
}
function copyEntries(from, to, entries) {
  mkdirSync(to, { mode: 0o700 });
  for (const item of entries) {
    if (
      !['public', 'executor', 'status'].includes(item.path.split('/')[0]) ||
      item.path.includes('\\') ||
      item.path.split('/').some((p) => !p || p === '.' || p === '..')
    )
      throw new Error('CONTAINER_BACKUP_PATH');
    const file = join(to, item.path);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    if (item.directory) mkdirSync(file, { recursive: true, mode: item.mode });
    else copyFileSync(join(from, item.path), file);
    if (process.getuid() === 0) chownSync(file, item.uid, item.gid);
    chmodSync(file, item.mode);
    if (!item.directory) {
      const fd = openSync(file, 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
  }
  for (const item of [...entries].reverse()) if (item.directory) syncDirectory(join(to, item.path));
  syncDirectory(to);
  syncDirectory(dirname(to));
}
export function snapshot(root, { limit = LIMIT, reserve = RESERVE } = {}) {
  const lease = acquireLease(root);
  try {
    const files = metadata(root),
      bytes = files.reduce((n, f) => n + f.size, 0);
    if (retainedBytes(root) + bytes + JSON.stringify(files).length + 2048 + reserve >= limit)
      throw new Error('CONTAINER_BACKUP_CAPACITY');
    const id = 'snapshot-' + randomUUID(),
      folder = join(root, 'recovery', id);
    mkdirSync(folder, { mode: 0o700 });
    copyEntries(root, join(folder, 'payload'), files);
    writeFileSync(
      join(folder, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'STOPPED_VOLUME_BYTE_SNAPSHOT_NOT_APPLICATION_REPLAY',
        files,
      }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    const manifest = openSync(join(folder, 'manifest.json'), 'r');
    try {
      fsyncSync(manifest);
    } finally {
      closeSync(manifest);
    }
    syncDirectory(folder);
    syncDirectory(join(root, 'recovery'));
    verifySnapshot(root, id);
    if (retainedBytes(root) + reserve >= limit) throw new Error('CONTAINER_BACKUP_CAPACITY');
    return id;
  } finally {
    lease.release();
  }
}
export function verifySnapshot(root, id) {
  const folder = join(root, 'recovery', safeId(id)),
    manifest = JSON.parse(regularBytes(join(folder, 'manifest.json'), 16 * 1024 * 1024));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'STOPPED_VOLUME_BYTE_SNAPSHOT_NOT_APPLICATION_REPLAY' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 100000
  )
    throw new Error('CONTAINER_BACKUP_MANIFEST');
  const current = inventory(join(folder, 'payload'));
  if (current.length !== manifest.files.length) throw new Error('CONTAINER_BACKUP_FILESET');
  for (let i = 0; i < current.length; i++) {
    const a = current[i],
      b = manifest.files[i];
    for (const field of ['path', 'directory', 'size', 'mode', 'uid', 'gid'])
      if (a[field] !== b[field]) throw new Error('CONTAINER_BACKUP_METADATA');
    if (!a.directory && hash(join(folder, 'payload', a.path)) !== b.sha256)
      throw new Error('CONTAINER_BACKUP_DIGEST');
  }
  return manifest;
}
export function restoreCopy(root, id, { limit = LIMIT, reserve = RESERVE } = {}) {
  const lease = acquireLease(root);
  try {
    const manifest = verifySnapshot(root, id),
      bytes = manifest.files.reduce((n, f) => n + f.size, 0);
    if (retainedBytes(root) + bytes + reserve >= limit) throw new Error('CONTAINER_RESTORE_CAPACITY');
    const target = join(root, 'recovery', 'restored-' + randomUUID());
    copyEntries(join(root, 'recovery', id, 'payload'), target, manifest.files);
    return target;
  } finally {
    lease.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [action, id] = process.argv.slice(2);
    if (action === 'snapshot' && !id) console.log(snapshot(DATA));
    else if (action === 'verify' && id) console.log(JSON.stringify(verifySnapshot(DATA, id)));
    else if (action === 'restore-copy' && id) console.log(restoreCopy(DATA, id));
    else if (action === 'quarantine-stopped-lease' && !id) {
      renameSync(join(DATA, '.container-lease'), join(DATA, 'recovery', 'quarantined-lease-' + randomUUID()));
      syncDirectory(DATA);
      syncDirectory(join(DATA, 'recovery'));
      console.log('LEASE_QUARANTINED_OPERATOR_MUST_VERIFY_NO_RUNNING_SERVICE');
    } else throw new Error();
  } catch {
    console.error('CONTAINER_RECOVERY_REJECTED');
    process.exitCode = 1;
  }
}

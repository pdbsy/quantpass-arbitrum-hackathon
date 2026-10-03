import {
  statfsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  mkdirSync,
  chmodSync,
  chownSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { USERS } from './boundary.mjs';
export function inventory(root, excluded = []) {
  const result = [];
  let count = 0;
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory())
    throw new Error('CONTAINER_STORAGE_ROOT');
  function visit(base, prefix) {
    for (const name of readdirSync(base).sort()) {
      if (!prefix && excluded.includes(name)) continue;
      const file = join(base, name),
        relative = prefix ? prefix + '/' + name : name,
        stat = lstatSync(file);
      if (
        ++count > 100000 ||
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && !stat.isFile()) ||
        (stat.isFile() && stat.nlink !== 1)
      )
        throw new Error('CONTAINER_STORAGE_LINK_OR_TYPE');
      result.push({
        path: relative,
        size: stat.isFile() ? stat.size : 0,
        directory: stat.isDirectory(),
        mode: stat.mode & 0o7777,
        uid: stat.uid,
        gid: stat.gid,
      });
      if (stat.isDirectory()) visit(file, relative);
    }
  }
  visit(root, '');
  return result;
}
export function retainedBytes(root, excluded = []) {
  return inventory(root, excluded).reduce((n, item) => n + item.size, 0);
}
export function syncDirectory(root) {
  const fd = openSync(root, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function acquireLease(root) {
  const file = join(root, '.container-lease'),
    token = randomUUID();
  const fd = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        token,
        createdAt: new Date().toISOString(),
        scope: 'WATCH_ONLY_OR_OFFLINE_RECOVERY',
      }) + '\n',
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(root);
  return {
    token,
    release() {
      if (JSON.parse(readFileSync(file, 'utf8')).token !== token) throw new Error('CONTAINER_LEASE_CHANGED');
      unlinkSync(file);
      syncDirectory(root);
    },
  };
}
export function initializeVolume(root) {
  if (process.platform !== 'linux' || ![0xef53, 0x58465342, 0x9123683e].includes(statfsSync(root).type))
    throw new Error('CONTAINER_LOCAL_DISK_REQUIRED');
  const stat = lstatSync(root);
  if (!stat.isDirectory() || realpathSync(root) !== root) throw new Error('CONTAINER_VOLUME_ROOT');
  if (stat.uid !== USERS.supervisor.uid) {
    if (readdirSync(root).length) throw new Error('CONTAINER_VOLUME_OWNER');
    chownSync(root, USERS.supervisor.uid, USERS.supervisor.gid);
    chmodSync(root, 0o755);
  }
  const current = lstatSync(root);
  if (
    current.uid !== USERS.supervisor.uid ||
    current.gid !== USERS.supervisor.gid ||
    (current.mode & 0o7777) !== 0o755
  )
    throw new Error('CONTAINER_VOLUME_PERMISSIONS');
  for (const [folder, owner, mode] of [
    ['public', USERS.public, 0o700],
    ['executor', USERS.executor, 0o700],
    ['status', USERS.executor, 0o2750],
    ['recovery', USERS.supervisor, 0o700],
  ]) {
    const file = join(root, folder);
    try {
      mkdirSync(file, { mode });
      chownSync(file, owner.uid, owner.gid);
      chmodSync(file, mode);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const s = lstatSync(file);
    if (
      !s.isDirectory() ||
      realpathSync(file) !== file ||
      s.uid !== owner.uid ||
      s.gid !== owner.gid ||
      (s.mode & 0o7777) !== mode
    )
      throw new Error('CONTAINER_PRIVATE_DIRECTORY');
  }
  inventory(root);
}

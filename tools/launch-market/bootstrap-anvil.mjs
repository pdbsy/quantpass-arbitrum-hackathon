import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const lock = JSON.parse(await readFile(new URL('./anvil-lock.json', import.meta.url), 'utf8'));
if (process.platform + '-' + process.arch !== lock.platform)
  throw new Error('PINNED_ANVIL_PLATFORM_REQUIRED');
const target = join(root, '.checks/af-chain01/toolchain/bin/anvil');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
let existing;
try {
  existing = await readFile(target);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (existing && digest(existing) !== lock.binarySha256) throw new Error('EXISTING_ANVIL_HASH_MISMATCH');
if (!existing) {
  const response = await fetch(lock.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || Number(response.headers.get('content-length')) > 16 * 1024 * 1024)
    throw new Error('PINNED_ANVIL_FETCH_FAILED');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > 16 * 1024 * 1024 ||
    'sha512-' + createHash('sha512').update(bytes).digest('base64') !== lock.integrity
  )
    throw new Error('ANVIL_INTEGRITY_MISMATCH');
  const dir = await mkdtemp(join(tmpdir(), 'af-anvil-'));
  try {
    await writeFile(join(dir, 'anvil.tgz'), bytes, { mode: 0o600 });
    execFileSync('tar', ['-xzf', join(dir, 'anvil.tgz'), '-C', dir, 'package/bin/anvil']);
    const binary = await readFile(join(dir, 'package/bin/anvil'));
    if (digest(binary) !== lock.binarySha256) throw new Error('ANVIL_BINARY_HASH_MISMATCH');
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(join(dir, 'package/bin/anvil'), target);
    await chmod(target, 0o700);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const version = execFileSync(target, ['--version'], { encoding: 'utf8' });
if (!version.includes('1.5.1') || !version.includes(lock.commit)) throw new Error('ANVIL_VERSION_MISMATCH');
console.log('Pinned Anvil 1.5.1 integrity verified.');

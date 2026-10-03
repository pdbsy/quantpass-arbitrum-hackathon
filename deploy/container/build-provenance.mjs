import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { npmCli } from '../../tools/environment/observe.mjs';
const lock = JSON.parse(readFileSync('deploy/container/image.lock.json'));
if (['bootstrap-npm', 'bootstrap-npm-offline'].includes(process.argv[2])) {
  let bytes;
  if (process.argv[2] === 'bootstrap-npm-offline') bytes = readFileSync('/reviewed/npm.tgz');
  else {
    const response = await fetch(lock.npm.url);
    if (!response.ok) throw new Error('NPM_DOWNLOAD');
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (
    createHash('sha256').update(bytes).digest('hex') !== lock.npm.sha256 ||
    'sha512-' + createHash('sha512').update(bytes).digest('base64') !== lock.npm.integrity
  )
    throw new Error('NPM_ARTIFACT_BYTES');
  writeFileSync('/tmp/npm-reviewed.tgz', bytes, { mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [
      npmCli(),
      'install',
      '--global',
      '/tmp/npm-reviewed.tgz',
      '--ignore-scripts',
      '--registry=https://registry.npmjs.org/',
      '--strict-ssl=true',
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('NPM_BOOTSTRAP');
} else {
  const nodePath = realpathSync(process.execPath),
    npmPath = npmCli(),
    version = spawnSync(nodePath, [npmPath, '--version'], { encoding: 'utf8' });
  if (
    version.status !== 0 ||
    version.stdout.trim() !== lock.npm.version ||
    process.versions.node !== '24.21.0' ||
    process.arch !== 'x64' ||
    process.platform !== 'linux'
  )
    throw new Error('BUILD_RUNTIME_VERSION');
  const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(
    'deploy/container/runtime-provenance.json',
    JSON.stringify({
      schemaVersion: 1,
      platform: 'linux',
      arch: 'x64',
      nodeVersion: process.versions.node,
      npmVersion: version.stdout.trim(),
      nodePath,
      npmPath,
      nodeSha256: hash(nodePath),
      npmSha256: hash(npmPath),
      nodeImage: lock.nodeImage,
      npmArtifactSha256: lock.npm.sha256,
      lockSha256: hash('package-lock.json'),
    }) + '\n',
  );
}

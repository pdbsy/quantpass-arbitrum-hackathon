import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { realpathSync, readFileSync } from 'node:fs';
import { CONFIG, overrideKinds } from '../../tools/environment/policy.mjs';
import { npmCli } from '../../tools/environment/observe.mjs';
import { checkEnvironment, regularBytes } from './boundary.mjs';
export function validateProvenance(manifest, observed) {
  for (const field of ['platform', 'arch', 'nodeVersion', 'npmVersion', 'nodePath', 'npmPath'])
    if (manifest[field] !== observed[field]) throw new Error('CONTAINER_RUNTIME_PROVENANCE');
  if (
    manifest.platform !== 'linux' ||
    manifest.arch !== 'x64' ||
    manifest.nodeVersion !== '24.21.0' ||
    manifest.npmVersion !== '11.19.1'
  )
    throw new Error('CONTAINER_RUNTIME_VERSION');
  for (const name of ['node', 'npm'])
    if (
      createHash('sha256')
        .update(readFileSync(realpathSync(manifest[name + 'Path'])))
        .digest('hex') !== manifest[name + 'Sha256']
    )
      throw new Error('CONTAINER_RUNTIME_BYTES');
}
export function runtimeAdmission(env = process.env) {
  checkEnvironment(env);
  if (overrideKinds(env).length) throw new Error('CONTAINER_RUNTIME_OVERRIDE');
  const nodePath = realpathSync(process.execPath),
    npmPath = npmCli();
  const run = (args) => {
    const result = spawnSync(nodePath, [npmPath, ...args], {
      cwd: '/opt/alphaforge',
      env,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
    });
    if (result.status !== 0) throw new Error('CONTAINER_NPM_OBSERVATION');
    return result.stdout.trim();
  };
  const observed = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    npmVersion: run(['--version']),
    nodePath,
    npmPath,
  };
  const manifest = JSON.parse(regularBytes('/opt/alphaforge/deploy/container/runtime-provenance.json'));
  validateProvenance(manifest, observed);
  if (
    createHash('sha256').update(regularBytes('/opt/alphaforge/package-lock.json')).digest('hex') !==
    manifest.lockSha256
  )
    throw new Error('CONTAINER_LOCKFILE_BYTES');
  for (const [key, want] of Object.entries({
    ...CONFIG,
    registry: 'https://registry.npmjs.org/',
    proxy: '',
    'https-proxy': '',
  }))
    if (run(['config', 'get', key]).replace(/^null$/, '') !== want)
      throw new Error('CONTAINER_NPM_CONFIGURATION');
  return {
    scope: 'LINUX_CONTAINER_BINARY_ADMISSION_NOT_DEPLOYMENT_READINESS',
    nodeVersion: observed.nodeVersion,
    npmVersion: observed.npmVersion,
    platform: observed.platform,
    arch: observed.arch,
  };
}

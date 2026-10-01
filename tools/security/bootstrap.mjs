import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { root, run, cleanEnvironment } from '../ci/context.mjs';

export function verifyBytes(bytes, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('Scanner artifact SHA-256 mismatch');
}
export function selectPlatform(platform, arch) {
  const key = `${platform}-${arch}`;
  if (!['darwin-arm64', 'linux-x64'].includes(key)) throw new Error('Unsupported scanner host');
  return key;
}

export function scannerEnvironment(directory) {
  return {
    ...cleanEnvironment(),
    HOME: directory,
    XDG_CACHE_HOME: join(directory, 'cache'),
    SEMGREP_SEND_METRICS: 'off',
    SEMGREP_ENABLE_VERSION_CHECK: '0',
    SEMGREP_SETTINGS_FILE: join(directory, 'settings.yml'),
    OTEL_SDK_DISABLED: 'true',
    NO_COLOR: '1',
  };
}

function directory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path)
    throw new Error('Scanner installation path must not contain symlinks');
  return path;
}

export async function downloadArtifact(artifact, cache) {
  const url = new URL(artifact.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['github.com', 'files.pythonhosted.org'].includes(url.hostname) ||
    basename(artifact.filename) !== artifact.filename ||
    artifact.filename.includes('\\')
  )
    throw new Error('Unqualified scanner artifact location');
  const target = join(directory(cache), artifact.filename);
  if (existsSync(target)) {
    if (!lstatSync(target).isFile() || realpathSync(target) !== target)
      throw new Error('Invalid cached scanner asset');
    verifyBytes(readFileSync(target), artifact.sha256);
    return target;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (
    !response.ok ||
    !['github.com', 'release-assets.githubusercontent.com', 'files.pythonhosted.org'].includes(
      new URL(response.url).hostname,
    )
  )
    throw new Error('Scanner artifact download unavailable');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 180 * 1024 * 1024) throw new Error('Scanner artifact exceeds size limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  verifyBytes(bytes, artifact.sha256);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, target);
  return target;
}

export function validateDerivedWheel(artifact, tool) {
  const patch = tool.dependencyPatch;
  const source = tool.wheels[artifact.derivedFrom];
  if (
    tool.version !== '1.177.0' ||
    patch?.buildId !== 'AlphaForge-Semgrep-1.177.0-pyjwt-2.15-patch2' ||
    patch.recipe !== 'tools/security/patch_semgrep.py' ||
    patch.patch !== 'tools/security/semgrep-pyjwt.patch' ||
    !/^[a-f0-9]{64}$/.test(patch.recipeSha256) ||
    !/^[a-f0-9]{64}$/.test(patch.patchSha256) ||
    !source ||
    source.derivedFrom ||
    source.name !== 'semgrep' ||
    source.version !== tool.version ||
    artifact.version !== tool.version ||
    artifact.name !== 'semgrep' ||
    basename(source.filename) !== source.filename ||
    !source.filename.startsWith('semgrep-1.177.0-') ||
    !source.filename.endsWith('.whl') ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    artifact.filename !== source.filename.replace('semgrep-1.177.0-', 'semgrep-1.177.0-1alphaforge2-')
  )
    throw new Error('Unqualified AlphaForge wheel derivation');
  return source;
}

async function prepareDerivedWheel(artifact, tool, cache, env) {
  const source = validateDerivedWheel(artifact, tool);
  const patch = tool.dependencyPatch;
  verifyBytes(readFileSync(join(root, patch.recipe)), patch.recipeSha256);
  verifyBytes(readFileSync(join(root, patch.patch)), patch.patchSha256);
  const qualification = run('python3.12', [join(root, 'tools/security/test_patch_semgrep.py')], { env });
  if (qualification.status !== 0 || qualification.signal || qualification.error)
    throw new Error('AlphaForge wheel recipe qualification failed');
  const upstream = await downloadArtifact(source, cache);
  const target = join(cache, artifact.filename);
  if (existsSync(target)) {
    if (!lstatSync(target).isFile() || realpathSync(target) !== target)
      throw new Error('Invalid cached derived wheel');
    verifyBytes(readFileSync(target), artifact.sha256);
    return target;
  }
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    const result = run('python3.12', [join(root, patch.recipe), upstream, temporary, source.sha256], { env });
    if (result.status !== 0 || result.signal || result.error || result.stdout.trim() !== artifact.sha256)
      throw new Error('AlphaForge derived wheel mismatch');
    verifyBytes(readFileSync(temporary), artifact.sha256);
    renameSync(temporary, target);
    return target;
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function installScanner(name) {
  if (!['semgrep', 'osv', 'gitleaks'].includes(name)) throw new Error('Unknown scanner');
  const platform = selectPlatform(process.platform, process.arch);
  const lockBytes = readFileSync(join(root, 'planning/security-scanners.lock.json'));
  const lock = JSON.parse(lockBytes);
  if (lock.schemaVersion !== 1 || lock.python !== '3.12.9') throw new Error('Unsupported scanner lock');
  const tool = lock[name];
  const selected = tool.platforms[platform];
  const base = directory(resolve(root, '.checks/security-scanners'));
  const cache = directory(join(base, 'downloads'));
  const install = mkdtempSync(join(base, `${name}-`));
  const env = scannerEnvironment(directory(join(install, 'home')));
  let binary;
  try {
    if (name === 'semgrep') {
      const probe = run(
        'python3.12',
        ['-c', 'import platform; print(platform.python_version()); print(platform.machine())'],
        { env },
      );
      if (
        probe.status !== 0 ||
        probe.stdout.trim() !== `${lock.python}\n${platform === 'darwin-arm64' ? 'arm64' : 'x86_64'}`
      )
        throw new Error('Scanner requires exact native CPython 3.12.9');
      const requirements = join(root, selected.requirements);
      if (
        !selected.requirements.startsWith('tools/security/requirements-semgrep-') ||
        resolve(requirements) !== requirements
      )
        throw new Error('Invalid scanner requirements path');
      verifyBytes(readFileSync(requirements), selected.requirementsSha256);
      if (!Array.isArray(selected.wheelFiles) || selected.wheelFiles.length < 1)
        throw new Error('Missing scanner wheel graph');
      const wheelhouse = directory(join(install, 'wheels'));
      for (const filename of selected.wheelFiles) {
        const artifact = tool.wheels[filename];
        if (artifact?.filename !== filename || !filename.endsWith('.whl'))
          throw new Error('Scanner must use qualified binary wheels');
        const asset = artifact.derivedFrom
          ? await prepareDerivedWheel(artifact, tool, cache, env)
          : await downloadArtifact(artifact, cache);
        const staged = join(wheelhouse, filename);
        copyFileSync(asset, staged);
        verifyBytes(readFileSync(staged), artifact.sha256);
      }
      const venv = join(install, 'venv');
      const create = run('python3.12', ['-m', 'venv', venv], { env });
      if (create.status !== 0 || create.signal || create.error)
        throw new Error('Scanner environment creation failed');
      const pip = run(
        join(venv, 'bin/python'),
        [
          '-m',
          'pip',
          '--isolated',
          'install',
          '--no-index',
          '--find-links',
          wheelhouse,
          '--require-hashes',
          '--only-binary=:all:',
          '-r',
          requirements,
        ],
        { env, timeout: 600000 },
      );
      if (pip.status !== 0 || pip.signal || pip.error)
        throw new Error('Hash-locked scanner installation failed');
      const check = run(join(venv, 'bin/python'), ['-m', 'pip', '--isolated', 'check'], { env });
      if (check.status !== 0 || check.signal || check.error)
        throw new Error('Incomplete scanner dependency graph');
      env.SSL_CERT_FILE = join(venv, 'lib/python3.12/site-packages/certifi/cacert.pem');
      binary = join(venv, 'bin/semgrep');
    } else {
      const asset = await downloadArtifact(selected, cache);
      binary = join(install, name);
      if (name === 'gitleaks') {
        const extracted = run('tar', ['-xOf', asset, 'gitleaks'], {
          env,
          encoding: 'buffer',
          maxBuffer: 64 * 1024 * 1024,
        });
        if (extracted.status !== 0 || extracted.signal || extracted.error)
          throw new Error('Gitleaks archive extraction failed');
        writeFileSync(binary, extracted.stdout, { flag: 'wx', mode: 0o700 });
      } else writeFileSync(binary, readFileSync(asset), { flag: 'wx', mode: 0o700 });
      chmodSync(binary, 0o700);
    }
    const probe = run(binary, [name === 'gitleaks' ? 'version' : '--version'], { env });
    const output = probe.stdout?.trim();
    if (
      probe.status !== 0 ||
      probe.signal ||
      probe.error ||
      (name === 'osv'
        ? !output.startsWith(`osv-scanner version: ${tool.version}\n`)
        : output !== tool.version)
    )
      throw new Error('Scanner executable version mismatch');
    return {
      binary,
      env,
      directory: install,
      version: tool.version,
      buildId: tool.dependencyPatch?.buildId ?? null,
      wheelSha256:
        name === 'semgrep'
          ? selected.wheelFiles
              .filter((filename) => tool.wheels[filename].name === 'semgrep')
              .map((filename) => tool.wheels[filename].sha256)
          : [],
      lockSha256: createHash('sha256').update(lockBytes).digest('hex'),
      cleanup: () => rmSync(install, { recursive: true, force: true }),
    };
  } catch {
    rmSync(install, { recursive: true, force: true });
    throw new Error(`Qualified ${name} bootstrap failed; inspect local installation prerequisites`);
  }
}

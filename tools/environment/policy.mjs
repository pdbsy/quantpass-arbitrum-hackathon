import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const CHECK_IDS = [
  'inputs',
  'tools',
  'platform',
  'repository',
  'history',
  'workspace',
  'index',
  'identity',
  'files',
  'isolation',
  'ports',
  'overrides',
  'npm-config',
  'local-mock',
  'manager',
  'contracts',
];
export const CONFIG = {
  'engine-strict': 'true',
  'save-exact': 'true',
  'ignore-scripts': 'true',
  'strict-ssl': 'true',
  omit: '',
  'legacy-peer-deps': 'false',
  'script-shell': '',
  'node-options': '',
  force: 'false',
  optional: '',
  production: '',
  global: 'false',
  'package-lock': 'true',
  'install-strategy': 'hoisted',
  'allow-scripts': '',
};
const exact = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const digest = (value) => createHash('sha256').update(value).digest('hex');
const requireInput = (value) => {
  if (!value) throw new Error('Invalid environment inputs');
};
export function validateInputs(i) {
  requireInput(exact.test(i.node) && /^npm@\d+\.\d+\.\d+$/.test(i.package.packageManager));
  const npm = i.package.packageManager.slice(4);
  requireInput(exact.test(npm) && isDeepStrictEqual(i.package.engines, { node: i.node, npm }));
  requireInput(i.lock.lockfileVersion === 3 && i.lock.requires === true);
  for (const field of [
    'name',
    'version',
    'engines',
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ])
    requireInput(isDeepStrictEqual(i.package[field], i.lock.packages[''][field]));
  const p = i.policy;
  requireInput(
    isDeepStrictEqual(
      Object.keys(p).sort(),
      [
        'schemaVersion',
        'versionSources',
        'supplyPolicy',
        'platforms',
        'runnerJobs',
        'macDeveloperManager',
        'networkProfile',
        'contractProfile',
        'report',
      ].sort(),
    ),
  );
  requireInput(
    p.schemaVersion === 1 &&
      isDeepStrictEqual(p.versionSources, { node: '.node-version', npm: 'package.json#packageManager' }) &&
      p.supplyPolicy === 'planning/supply-chain-policy.json',
  );
  requireInput(isDeepStrictEqual(p.platforms, { darwin: ['arm64', 'x64'], linux: ['x64'], win32: ['x64'] }));
  requireInput(
    isDeepStrictEqual(p.runnerJobs, {
      verify: { platform: 'linux', arch: 'x64', label: 'ubuntu-24.04' },
      'verify-windows': { platform: 'win32', arch: 'x64', label: 'windows-2025' },
      'verify-macos': { platform: 'darwin', arch: 'arm64', label: 'macos-15' },
      'verify-macos-intel': { platform: 'darwin', arch: 'x64', label: 'macos-15-intel' },
    }),
  );
  requireInput(
    p.macDeveloperManager === 'fnm' && p.networkProfile === 'local-mock' && p.contractProfile === 'inactive',
  );
  requireInput(
    isDeepStrictEqual(p.report, {
      path: '.checks/environment/report.json',
      maxBytes: 65536,
      maxAgeSeconds: 900,
    }),
  );
  requireInput(
    i.supply.repository === 'pdbsy/quantpass-arbitrum-hackathon' && i.supply.defaultBranch === 'master',
  );
  requireInput(i.supply.dependencyPolicy.registryOrigin === 'https://registry.npmjs.org');
  return i;
}

export function overrideKinds(env) {
  const kinds = new Set();
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (/^NODE_(OPTIONS|PATH|EXTRA_CA_CERTS|USE_SYSTEM_CA)$/.test(key)) kinds.add('node');
    if (/^NODE_TLS_REJECT_UNAUTHORIZED$/.test(key) && value !== '1') kinds.add('tls');
    if (
      /^GIT_(DIR|WORK_TREE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|INDEX_FILE|REPLACE_REF_BASE|SHALLOW_FILE|EXEC_PATH)$/.test(
        key,
      )
    )
      kinds.add('git');
    if (/^FNM_NODE_DIST_MIRROR$/.test(key) && value !== 'https://nodejs.org/dist')
      kinds.add('download-source');
    if (/^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)$/i.test(key)) kinds.add('proxy');
    if (
      /^npm_config_/i.test(key) &&
      !/^npm_config_(allow_scripts|global_prefix|npm_version|registry|engine_strict|save_exact|ignore_scripts|strict_ssl|omit|legacy_peer_deps|user_agent|userconfig|globalconfig|prefix|cache|local_prefix|noproxy|node_gyp|init_module)$/i.test(
        key,
      )
    )
      kinds.add('npm');
  }
  return [...kinds].sort();
}
export function nativePackagesValid(lock, platform, arch) {
  if (!lock || !lock.packages || typeof lock.packages !== 'object') return false;
  const matches = (rules, value) =>
    rules === undefined ||
    (Array.isArray(rules) &&
      rules.every((r) => typeof r === 'string') &&
      !rules.includes('!' + value) &&
      (rules.every((r) => r.startsWith('!')) || rules.includes(value)));
  return Object.values(lock.packages).every((p) => p && matches(p.os, platform) && matches(p.cpu, arch));
}

export function evaluate(inputs, o, mode) {
  validateInputs(inputs);
  if (!['dev', 'ci'].includes(mode)) throw new Error('Invalid environment mode');
  const checks = [];
  const check = (id, ok, missing = false) =>
    checks.push({ id, status: ok ? 'PASS' : missing ? 'BLOCKED' : 'FAIL' });
  check('inputs', true);
  check('tools', o.node === inputs.node && o.npm === inputs.package.packageManager.slice(4), !o.npm);
  const target = inputs.policy.runnerJobs[o.job];
  check(
    'platform',
    inputs.policy.platforms[o.platform]?.includes(o.arch) &&
      o.nativeArch === o.arch &&
      o.runtimeAligned &&
      o.nativeDependenciesValid &&
      (mode !== 'ci' || (target?.platform === o.platform && target?.arch === o.arch)),
    o.nativeArch === null || o.runtimeAligned === null,
  );
  check('repository', o.rootValid && o.originValid);
  check('history', o.historyValid, !o.historyValid);
  checks.push({ id: 'workspace', status: o.clean ? 'PASS' : mode === 'dev' ? 'WARN' : 'FAIL' });
  check('index', o.hiddenIndex === false);
  check('identity', mode === 'ci' || o.authorConfigured, mode === 'dev' && !o.authorConfigured);
  check('files', o.filesValid);
  check('isolation', o.isolated);
  checks.push({ id: 'ports', status: ['PASS', 'FAIL', 'BLOCKED'].includes(o.ports) ? o.ports : 'BLOCKED' });
  check('overrides', o.overrides.length === 0);
  check(
    'npm-config',
    Object.entries(CONFIG).every(([k, v]) => o.config[k] === v) &&
      [
        inputs.supply.dependencyPolicy.registryOrigin,
        inputs.supply.dependencyPolicy.registryOrigin + '/',
      ].includes(o.config.registry) &&
      !o.config.proxy &&
      !o.config['https-proxy'],
    !o.config.registry,
  );
  check('local-mock', o.localMock);
  check(
    'manager',
    o.platform !== 'darwin' || mode === 'ci' || o.fnm === true,
    o.platform === 'darwin' && mode === 'dev' && o.fnm !== true,
  );
  checks.push({ id: 'contracts', status: 'NOT_RUN' });
  const exitCode = checks.some((c) => c.status === 'FAIL')
    ? 1
    : checks.some((c) => c.status === 'BLOCKED')
      ? 2
      : 0;
  const sha = (value) => (/^[a-f0-9]{40}$/.test(value) ? value : null);
  const version = (value) =>
    typeof value === 'string' && /^[0-9][0-9A-Za-z.+-]{0,60}$/.test(value) ? value : null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    scope: 'offline-local-mock-admission',
    exitCode,
    eligibleForEvidence: exitCode === 0 && o.clean === true,
    node: version(o.node),
    npm: version(o.npm),
    git: version(o.git),
    platform: ['darwin', 'linux', 'win32'].includes(o.platform) ? o.platform : null,
    arch: ['arm64', 'x64'].includes(o.arch) ? o.arch : null,
    image: version(o.image),
    head: sha(o.head),
    tree: sha(o.tree),
    base: sha(o.base),
    sourceHead: sha(o.sourceHead),
    sourceTree: sha(o.sourceTree),
    context: ['local', 'push', 'pull_request', 'merge_group', 'workflow_dispatch'].includes(o.context)
      ? o.context
      : null,
    baseObservedAt: new Date().toISOString(),
    remoteFreshness: 'NOT_RUN',
    lockSha256: digest(inputs.lockText ?? JSON.stringify(inputs.lock)),
    checks,
    commands: o.commands.map((c) => ({ id: c.id, exitCode: c.exitCode })),
  };
}

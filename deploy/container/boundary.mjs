import { lstatSync, realpathSync, readFileSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
export const DATA = '/var/lib/alphaforge';
export const LIMIT = 8000000000;
export const RESERVE = 64 * 1024 * 1024;
export const USERS = {
  public: { uid: 10001, gid: 10003 },
  executor: { uid: 10002, gid: 10003 },
  proxy: { uid: 10004, gid: 10004 },
  supervisor: { uid: 10005, gid: 10005 },
};
export function checkEnvironment(env) {
  const allowed = new Set([
    'PATH',
    'HOME',
    'HOSTNAME',
    'TERM',
    'LANG',
    'LC_ALL',
    'TZ',
    'NODE_VERSION',
    'YARN_VERSION',
    'UV_USE_IO_URING',
    'AF_CONTAINER_MODE',
    'AF_PUBLIC_RPC_FILE',
    'AF_EXECUTOR_RPC_FILE',
    'AF_RELEASE_IDENTITY_FILE',
    'AF_TEST_RESULTS_FILE',
  ]);
  for (const [key, value] of Object.entries(env))
    if (value && !allowed.has(key)) throw new Error('CONTAINER_ENVIRONMENT_REJECTED');
  if (env.AF_CONTAINER_MODE !== undefined && env.AF_CONTAINER_MODE !== 'watch')
    throw new Error('CONTAINER_SIGNING_DISABLED');
  if (env.UV_USE_IO_URING !== undefined && env.UV_USE_IO_URING !== '0')
    throw new Error('CONTAINER_UV_ENVIRONMENT');
  if (env.NODE_VERSION && env.NODE_VERSION !== '24.21.0') throw new Error('CONTAINER_NODE_VERSION');
  for (const [key, file] of [
    ['AF_RELEASE_IDENTITY_FILE', '/etc/alphaforge/public/release-identity.json'],
    ['AF_TEST_RESULTS_FILE', '/etc/alphaforge/public/test-results.json'],
  ])
    if (env[key] && env[key] !== file) throw new Error('CONTAINER_DESCRIPTOR_PATH');
  for (const [key, file] of [
    ['AF_PUBLIC_RPC_FILE', '/run/secrets/public-rpc'],
    ['AF_EXECUTOR_RPC_FILE', '/run/secrets/executor-rpc'],
  ])
    if (env[key] !== undefined && env[key] !== file) throw new Error('CONTAINER_RPC_FILE');
}
export function regularBytes(file, max = 1048576) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > max || realpathSync(file) !== file)
    throw new Error('CONTAINER_FILE_REJECTED');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd);
    if (current.ino !== stat.ino || current.dev !== stat.dev) throw new Error('CONTAINER_FILE_CHANGED');
    const bytes = readFileSync(fd);
    if (bytes.length > max) throw new Error('CONTAINER_FILE_TOO_LARGE');
    return bytes;
  } finally {
    closeSync(fd);
  }
}
export function servicePlan(web, executor) {
  const origin = new URL(web.origin);
  if (origin.protocol !== 'https:' || origin.origin !== web.origin || origin.username || origin.password)
    throw new Error('CONTAINER_ORIGIN');
  for (const [config, profile, folder] of [
    [web, 'PUBLIC_TESTNET', 'public'],
    [executor, 'RESTRICTED_TESTNET_EXECUTOR', 'executor'],
  ])
    if (
      config.chainId !== 46630 ||
      config.profile !== profile ||
      config.dataDirectory !== DATA + '/' + folder ||
      !Array.isArray(config.vaults) ||
      !config.vaults.length ||
      !Number.isSafeInteger(config.maxStorageBytes) ||
      config.maxStorageBytes < RESERVE
    )
      throw new Error('CONTAINER_CONFIGURATION');
  if (web.maxStorageBytes + executor.maxStorageBytes > 7500000000) throw new Error('CONTAINER_QUOTA_TOTAL');
  if (web.executorStatus && web.executorStatus.file !== DATA + '/status/execution-status.json')
    throw new Error('CONTAINER_STATUS_PATH');
  return {
    origin: web.origin,
    public: ['tools/testnet/server.ts', '--serve', '/etc/alphaforge/public/operator.json', '4190'],
    executor: ['tools/testnet/executor.ts', '--watch', '/etc/alphaforge/executor/operator.json'],
  };
}
export function proxyHeaders(headers, remote, originText) {
  const origin = new URL(originText);
  if (
    headers.host !== origin.host ||
    (headers.origin !== undefined && headers.origin !== origin.origin) ||
    headers['sec-fetch-site'] === 'cross-site'
  )
    throw new Error('CONTAINER_INGRESS_REJECTED');
  const result = { ...headers };
  for (const key of Object.keys(result))
    if (
      key === 'forwarded' ||
      key.startsWith('x-forwarded-') ||
      [
        'connection',
        'upgrade',
        'proxy-authorization',
        'proxy-connection',
        'keep-alive',
        'te',
        'trailer',
        'transfer-encoding',
      ].includes(key)
    )
      delete result[key];
  return { ...result, host: origin.host, 'x-forwarded-proto': 'https', 'x-forwarded-for': remote };
}

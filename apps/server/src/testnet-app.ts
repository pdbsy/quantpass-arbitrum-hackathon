import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { join } from 'node:path';
import {
  WalletAuthStore,
  verifyWalletMessage,
  walletAddress,
} from '../../../packages/testnet/src/wallet-auth.ts';
import type { TradingChainRuntime } from './trading-chain-runtime.ts';
import { registerTradingRoutes } from './trading-routes.ts';
import type { ServerBackupReport } from '../../../packages/testnet/src/server-backups.ts';

const cookieName = '__Host-af_testnet';
const address = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', maxLength: 42 };
const body = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export interface PublicTestnetAppOptions {
  readonly executionStatus?: (owner: string, vault: string) => unknown;
  readonly origin: string;
  readonly auth: WalletAuthStore;
  readonly now?: () => number;
  readonly webRoot?: string;
  readonly verifyOwner?: (message: string, signature: string, owner: string) => Promise<boolean>;
  readonly runtimes?: readonly Readonly<{ id: string; runtime: TradingChainRuntime }>[];
  readonly canWrite?: () => boolean;
  readonly backup?: () => Promise<ServerBackupReport>;
  readonly backupStatus?: () => Readonly<{
    lastVerifiedAt: number | null;
    lastBackupId: string | null;
    state: string;
  }>;
}
/** Dedicated public surface. No local demo, mock funds, owner key or executor routes are registered. */
export async function buildPublicTestnetApp(options: PublicTestnetAppOptions) {
  const origin = new URL(options.origin);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== options.origin ||
    options.auth.origin !== options.origin
  )
    throw new Error('PUBLIC_TESTNET_ORIGIN');
  const now = options.now ?? Date.now;
  const app = Fastify({
    logger: false,
    bodyLimit: 16384,
    requestTimeout: 10000,
    trustProxy: ['127.0.0.1', '::1'],
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  await app.register(cookie);
  const limits = new Map<string, { expires: number; count: number }>();
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Strict-Transport-Security', 'max-age=31536000')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
    if (
      request.headers.host !== origin.host ||
      request.protocol !== 'https' ||
      (request.headers.origin && request.headers.origin !== origin.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      return reply.code(403).send({ error: 'TESTNET_INGRESS_REJECTED' });
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      (request.headers.origin !== origin.origin || request.headers['x-alphaforge-client'] !== '1')
    )
      return reply.code(403).send({ error: 'TESTNET_INGRESS_REJECTED' });
    const timestamp = now();
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      request.url !== '/api/testnet/auth/logout' &&
      options.canWrite &&
      !options.canWrite()
    )
      return reply.code(503).send({ error: 'TESTNET_STORAGE_BLOCKED' });
    for (const [key, value] of limits) if (value.expires <= timestamp) limits.delete(key);
    let limit = limits.get(request.ip);
    if (!limit) {
      if (limits.size >= 1024) return reply.code(429).send({ error: 'TESTNET_RATE_LIMIT' });
      limit = { expires: timestamp + 60000, count: 0 };
      limits.set(request.ip, limit);
    }
    if (++limit.count > 120) return reply.code(429).send({ error: 'TESTNET_RATE_LIMIT' });
  });
  app.setErrorHandler((error, _request, reply) => {
    const problem = error instanceof Error ? error : new Error('UNKNOWN_ERROR');
    const code = 'statusCode' in problem ? problem.statusCode : undefined;
    const status =
      code === 400
        ? 400
        : code === 413
          ? 413
          : ['AUTH_CAPACITY', 'BACKUP_MANUAL_RATE_LIMIT'].includes(problem.message)
            ? 429
            : 500;
    reply.code(status).send({ error: 'TESTNET_REQUEST_REJECTED' });
  });
  app.addHook('onClose', async () => options.auth.close());
  app.get('/api/health', async () => ({
    name: 'AlphaForge',
    mode: 'PUBLIC_TESTNET',
    chainId: 46630,
    testAssets: true,
    strategyEncryption: 'EXCLUDED',
    deployment: options.runtimes?.length ? 'CONFIGURED_VERIFY_STATUS_PER_VAULT' : 'NOT_CONFIGURED',
    orderExecution: options.runtimes?.length ? 'OWNER_WALLET_ONLY' : 'DISABLED',
    commercialSettlement: 'SIMULATION_ONLY',
    restrictedExecutor: 'SEPARATE_OPERATOR_SERVICE',
    storage: options.canWrite && !options.canWrite() ? 'BLOCKED' : 'AVAILABLE',
    backups: options.backupStatus?.() ?? {
      state: 'NOT_CONFIGURED',
      lastVerifiedAt: null,
      lastBackupId: null,
    },
  }));
  app.post<{ Body: { owner: string } }>(
    '/api/testnet/auth/challenge',
    { schema: { body: body({ owner: address }) } },
    async (request) => options.auth.issue(walletAddress(request.body.owner), now()),
  );
  app.post<{ Body: { owner: string; nonce: string; signature: string } }>(
    '/api/testnet/auth/verify',
    {
      schema: {
        body: body({
          owner: address,
          nonce: { type: 'string', pattern: '^[a-f0-9]{48}$', maxLength: 48 },
          signature: { type: 'string', pattern: '^0x[0-9a-fA-F]+$', maxLength: 8194 },
        }),
      },
    },
    async (request, reply) => {
      const challenge = options.auth.consume(request.body.nonce, request.body.owner, now());
      const valid =
        challenge &&
        (options.verifyOwner
          ? await options.verifyOwner(challenge.message, request.body.signature, challenge.owner)
          : verifyWalletMessage(challenge.message, request.body.signature, challenge.owner));
      if (!valid || !challenge) return reply.code(401).send({ error: 'WALLET_LOGIN_REJECTED' });
      const session = options.auth.createSession(challenge.owner, now());
      reply.setCookie(cookieName, session.token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: Math.floor(options.auth.policy.sessionTtlMs / 1000),
      });
      return { owner: challenge.owner, chainId: 46630, expiresAt: session.expiresAt };
    },
  );
  app.get('/api/testnet/auth/session', async (request, reply) => {
    const owner = options.auth.owner(request.cookies[cookieName] ?? '', now());
    if (!owner) return reply.code(401).send({ error: 'WALLET_LOGIN_REQUIRED' });
    return { owner, chainId: 46630 };
  });
  app.post('/api/testnet/auth/logout', { schema: { body: body({}) } }, async (request, reply) => {
    options.auth.logout(request.cookies[cookieName] ?? '');
    reply.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    return { loggedOut: true };
  });
  let lastManualBackup: number | null = null;
  app.post('/api/testnet/backups', { schema: { body: body({}) } }, async (request, reply) => {
    const owner = options.auth.owner(request.cookies[cookieName] ?? '', now());
    if (!owner) return reply.code(401).send({ error: 'WALLET_LOGIN_REQUIRED' });
    if (!options.backup || !options.runtimes?.some((entry) => entry.runtime.inventory.owner === owner))
      return reply.code(404).send({ error: 'BACKUP_NOT_CONFIGURED' });
    const timestamp = now();
    if (lastManualBackup !== null && timestamp - lastManualBackup < 3600000)
      throw new Error('BACKUP_MANUAL_RATE_LIMIT');
    lastManualBackup = timestamp;
    const report = await options.backup();
    return { id: report.id, createdAt: report.createdAt, state: report.state };
  });
  if (options.webRoot) {
    await app.register(staticFiles, { root: options.webRoot, serve: false });
    app.get('/', async (_request, reply) => reply.sendFile('testnet.html'));
    app.get('/testnet.html', async (_request, reply) => reply.sendFile('testnet.html'));
    app.get<{ Params: { file: string } }>('/assets/:file', async (request, reply) => {
      if (!/^[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(request.params.file))
        return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.sendFile(request.params.file, join(options.webRoot!, 'assets'));
    });
  }
  registerTradingRoutes(
    app,
    options.runtimes ?? [],
    (token) => options.auth.owner(token ?? '', now()),
    options.executionStatus,
  );
  await app.ready();
  return app;
}

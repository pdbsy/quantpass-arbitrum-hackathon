import Fastify, { type FastifyRequest, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../../../packages/config/src/index.ts';
import { DomainError, type VaultState, type Command } from '../../../packages/domain/src/vault.ts';
import { localSimulation, SIMULATION_STATISTICS } from './simulation.ts';
import { LocalStore } from './store.ts';

export const STRATEGIES = [
  {
    id: 'core-flow-demo',
    name: '核心资金流程样例',
    description: '验证 SaaS 额度与独立余额，不运行真实量化交易。',
    scope: 'TEST_ONLY',
    testPasses: '1000',
  },
];
const idSchema = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$', maxLength: 80 };
const amountSchema = { type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$', maxLength: 78 };
const base = { id: idSchema, expectedRevision: { type: 'integer', minimum: 0, maximum: 10000 } };
const shape = (types: string[], fields: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'expectedRevision', 'type', ...Object.keys(fields)],
  properties: { ...base, type: { enum: types }, ...fields },
});
const commandSchema = {
  oneOf: [
    shape(['deposit', 'allocate', 'deallocate', 'requestWithdrawal', 'payFees'], { amount: amountSchema }),
    shape(['start', 'stop']),
    shape(['reserveBuy'], { orderId: idSchema, amount: amountSchema }),
    shape(['cancelOrder', 'fillBuy'], { orderId: idSchema }),
    shape(['confirmWithdrawal', 'cancelWithdrawal'], { withdrawalId: idSchema }),
    shape(['markPosition'], { value: amountSchema }),
    shape(['settlePosition'], { proceeds: amountSchema }),
  ],
};
export function view(state: VaultState) {
  return {
    scope: state.scope,
    id: state.id,
    ownerId: state.ownerId,
    strategyId: state.strategyId,
    passes: state.passes,
    status: state.status,
    revision: state.revision,
    idle: state.idle,
    activeCash: state.activeCash,
    positionCost: state.positionCost,
    positionValue: state.positionValue,
    feeLiability: state.feeLiability,
    withdrawalsPaid: state.withdrawalsPaid,
    orders: state.orders,
    pendingWithdrawals: state.pendingWithdrawals,
    balances: Object.fromEntries(
      Object.entries(SIMULATION_STATISTICS.snapshot(state)).map(([key, value]) => [key, value.toString()]),
    ),
  };
}
export async function buildApp(options: {
  dbPath: string;
  env: Readonly<Record<string, string | undefined>>;
  origin: string;
  webRoot?: string;
}) {
  readConfig(options.env);
  const origin = new URL(options.origin);
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname))
    throw new Error('LOOPBACK_ORIGIN_REQUIRED');
  const store = new LocalStore(options.dbPath);
  const simulation = localSimulation(store);
  const app = Fastify({
    logger: false,
    bodyLimit: 16384,
    requestTimeout: 10000,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const sessions = new Map<string, { owner: string; expires: number }>();
  const rate = new Map<string, { count: number; expires: number }>();
  const session = (request: FastifyRequest) => {
    const token = request.cookies.qp_demo;
    const identity = token ? sessions.get(token) : undefined;
    if (!identity || identity.expires < Date.now()) throw new DomainError('SESSION_REQUIRED');
    return identity.owner;
  };
  app.addHook('onClose', async () => {
    store.close();
  });
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (request.headers.host !== origin.host) return reply.code(403).send({ error: 'HOST_REJECTED' });
    if (request.headers.origin && request.headers.origin !== origin.origin)
      return reply.code(403).send({ error: 'ORIGIN_REJECTED' });
    if (request.headers['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send({ error: 'CROSS_SITE_REJECTED' });
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-quantpass-demo'] !== '1')
      return reply.code(403).send({ error: 'DEMO_HEADER_REQUIRED' });
    const now = Date.now();
    let counter = rate.get(request.ip);
    if (!counter || counter.expires < now) {
      counter = { count: 0, expires: now + 60000 };
      rate.set(request.ip, counter);
    }
    if (++counter.count > 500) return reply.code(429).send({ error: 'RATE_LIMITED' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError)
      return reply
        .code(
          error.code === 'SESSION_REQUIRED'
            ? 401
            : error.code === 'VAULT_NOT_FOUND'
              ? 404
              : error.code === 'FORBIDDEN'
                ? 403
                : 409,
        )
        .send({ error: error.code });
    const httpError = error as Partial<FastifyError>;
    if (httpError.validation || (httpError.statusCode && httpError.statusCode < 500))
      return reply.code(httpError.statusCode || 400).send({ error: 'INVALID_REQUEST' });
    return reply.code(500).send({ error: 'LOCAL_OPERATION_FAILED' });
  });
  app.get('/api/health', async () => ({ scope: 'TEST_ONLY', ready: true, realFundsEnabled: false }));
  app.post<{ Body: { user: 'alice' | 'bob' } }>(
    '/api/demo/session',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['user'],
          properties: { user: { enum: ['alice', 'bob'] } },
        },
      },
    },
    async (request, reply) => {
      const now = Date.now();
      for (const [token, value] of sessions) if (value.expires < now) sessions.delete(token);
      if (request.cookies.qp_demo) sessions.delete(request.cookies.qp_demo);
      if (sessions.size >= 100) throw new DomainError('SESSION_LIMIT');
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { owner: request.body.user, expires: now + 8 * 60 * 60 * 1000 });
      reply.setCookie('qp_demo', token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: false,
        maxAge: 8 * 60 * 60,
      });
      return { scope: 'TEST_ONLY', user: request.body.user };
    },
  );
  app.get('/api/session', async (request) => ({ scope: 'TEST_ONLY', user: session(request) }));
  app.get('/api/strategies', async (request) => {
    session(request);
    return STRATEGIES;
  });
  app.get('/api/vaults', async (request) => store.list(session(request)).map(view));
  app.post<{ Body: { strategyId: string } }>(
    '/api/vaults',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['strategyId'],
          properties: { strategyId: idSchema },
        },
      },
    },
    async (request) => {
      const owner = session(request);
      if (!STRATEGIES.some((s) => s.id === request.body.strategyId))
        throw new DomainError('UNKNOWN_STRATEGY');
      return view(store.obtainTestPasses(owner, request.body.strategyId));
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/vaults/:id',
    { schema: { params: { type: 'object', required: ['id'], properties: { id: idSchema } } } },
    async (request) => view(store.get(request.params.id, session(request))),
  );
  app.get<{ Params: { id: string } }>('/api/vaults/:id/audit', async (request) =>
    simulation.indexer.events(session(request), request.params.id),
  );
  app.post<{ Params: { id: string }; Body: Command }>(
    '/api/vaults/:id/commands',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: idSchema } },
        body: commandSchema,
      },
    },
    async (request) => {
      const owner = session(request);
      const result = simulation.execution.submit(owner, request.params.id, request.body);
      return { vault: view(result.state), replayed: result.replayed };
    },
  );
  if (options.webRoot)
    await app.register(staticFiles, {
      root: options.webRoot,
      index: ['index.html'],
      wildcard: true,
      dotfiles: 'deny',
    });
  await app.ready();
  return { app, store };
}

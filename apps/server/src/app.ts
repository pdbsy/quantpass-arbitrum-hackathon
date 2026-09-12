import Fastify, { type FastifyRequest, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../../../packages/config/src/index.ts';
import { DomainError, type Command } from '../../../packages/domain/src/vault.ts';
import { localSimulation } from './simulation.ts';
import { LocalStore } from './store.ts';
import { unsigned } from '../../../packages/domain/src/money.ts';
import { STRATEGIES, strategyDetail } from './strategy-catalog.ts';
import { apiError } from './api-errors.ts';
import { view, accountView } from './product-views.ts';

import { registerProductRoutes } from './product-routes.ts';
import { idSchema, amountSchema, limitSchema } from './api-schema.ts';

export { STRATEGIES } from './strategy-catalog.ts';
const errorBody = (_request: FastifyRequest, code: string) => {
  const { body } = apiError(code);
  return { error: body.error };
};
type PageQuery = { limit?: string; after?: string };
const pageSchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  properties: { limit: limitSchema, after: idSchema, ...extra },
});
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
export { view } from './product-views.ts';
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
    if (request.headers.host !== origin.host)
      return reply.code(403).send(errorBody(request, 'HOST_REJECTED'));
    if (request.headers.origin && request.headers.origin !== origin.origin)
      return reply.code(403).send(errorBody(request, 'ORIGIN_REJECTED'));
    if (request.headers['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send(errorBody(request, 'CROSS_SITE_REJECTED'));
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-quantpass-demo'] !== '1')
      return reply.code(403).send(errorBody(request, 'DEMO_HEADER_REQUIRED'));
    const now = Date.now();
    let counter = rate.get(request.ip);
    if (!counter || counter.expires < now) {
      counter = { count: 0, expires: now + 60000 };
      rate.set(request.ip, counter);
    }
    if (++counter.count > 500)
      return reply.code(429).header('Retry-After', '60').send(errorBody(request, 'RATE_LIMITED'));
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      const response = apiError(error.code);
      return reply.code(response.status).send(errorBody(request, error.code));
    }
    const httpError = error as Partial<FastifyError>;
    if (httpError.validation || (httpError.statusCode && httpError.statusCode < 500))
      return reply.code(httpError.statusCode || 400).send(errorBody(request, 'INVALID_REQUEST'));
    return reply.code(500).send(errorBody(request, 'LOCAL_OPERATION_FAILED'));
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send(errorBody(request, 'INVALID_REQUEST')));
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
  app.get<{ Querystring: PageQuery }>(
    '/api/strategies',
    { schema: { querystring: pageSchema() } },
    async (request, reply) => {
      session(request);
      const limit = Number(request.query.limit ?? '50');
      const items = STRATEGIES.filter((strategy) => strategy.id > (request.query.after ?? '')).slice(
        0,
        limit + 1,
      );
      if (items.length > limit) reply.header('X-Next-Cursor', items[limit - 1]!.id);
      reply.header('X-Page-Limit', limit);
      return items.slice(0, limit);
    },
  );
  app.get<{ Params: { strategyId: string } }>(
    '/api/strategies/:strategyId',
    {
      schema: { params: { type: 'object', required: ['strategyId'], properties: { strategyId: idSchema } } },
    },
    async (request) => {
      session(request);
      const strategy = strategyDetail(request.params.strategyId);
      if (!strategy) throw new DomainError('UNKNOWN_STRATEGY');
      return strategy;
    },
  );
  app.get<{ Params: { strategyId: string } }>(
    '/api/strategies/:strategyId/vault',
    {
      schema: { params: { type: 'object', required: ['strategyId'], properties: { strategyId: idSchema } } },
    },
    async (request) => {
      const owner = session(request);
      if (!strategyDetail(request.params.strategyId)) throw new DomainError('UNKNOWN_STRATEGY');
      return view(store.forStrategy(owner, request.params.strategyId));
    },
  );
  app.get<{ Querystring: PageQuery & { strategyId?: string } }>(
    '/api/vaults',
    { schema: { querystring: pageSchema({ strategyId: idSchema }) } },
    async (request, reply) => {
      const owner = session(request);
      const { limit = '50', ...query } = request.query;
      // The original UI treats states[0] as core-flow-demo. Keep its default binding.
      // New clients use /api/account or explicitly filter by strategyId.
      const page = store.listPage(owner, { strategyId: 'core-flow-demo', ...query, limit: Number(limit) });
      reply.header('X-Page-Limit', limit);
      if (page.nextCursor) reply.header('X-Next-Cursor', page.nextCursor);
      return page.items.map(view);
    },
  );
  app.get<{ Querystring: PageQuery }>(
    '/api/account',
    { schema: { querystring: pageSchema() } },
    async (request) => {
      const owner = session(request);
      const { limit = '50', ...query } = request.query;
      // One read transaction makes global totals and the page agree even with another connection writing.
      store.db.exec('BEGIN');
      try {
        const page = store.listPage(owner, { ...query, limit: Number(limit) });
        const result = accountView(owner, store.owned(owner), page, Number(limit));
        store.db.exec('COMMIT');
        return result;
      } catch (error) {
        if (store.db.isTransaction) store.db.exec('ROLLBACK');
        throw error;
      }
    },
  );
  for (const url of ['/api/vaults', '/api/v1/vaults'])
    app.post<{ Body: { strategyId: string } }>(
      url,
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
  app.get<{ Params: { id: string }; Querystring: { limit?: string; beforeRevision?: string } }>(
    '/api/vaults/:id/audit',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: idSchema } },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: limitSchema,
            beforeRevision: { type: 'string', pattern: '^([1-9][0-9]{0,3}|10000)$', maxLength: 5 },
          },
        },
      },
    },
    async (request, reply) => {
      const limit = Number(request.query.limit ?? '100');
      const page = store.auditPage(session(request), request.params.id, {
        limit,
        ...(request.query.beforeRevision ? { beforeRevision: Number(request.query.beforeRevision) } : {}),
      });
      reply.header('X-Page-Limit', limit);
      if (page.nextCursor) reply.header('X-Next-Cursor', page.nextCursor);
      return page.items;
    },
  );
  for (const url of ['/api/vaults/:id/commands', '/api/v1/vaults/:id/commands'])
    app.post<{ Params: { id: string }; Body: Command }>(
      url,
      {
        schema: {
          params: { type: 'object', required: ['id'], properties: { id: idSchema } },
          body: commandSchema,
        },
      },
      async (request) => {
        const owner = session(request);
        try {
          for (const field of ['amount', 'value', 'proceeds'] as const)
            if (field in request.body) unsigned((request.body as unknown as Record<string, string>)[field]!);
        } catch {
          throw new DomainError('INVALID_REQUEST');
        }
        const result = simulation.execution.submit(owner, request.params.id, request.body);
        return { vault: view(result.state), replayed: result.replayed };
      },
    );
  registerProductRoutes(app, store, session);
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

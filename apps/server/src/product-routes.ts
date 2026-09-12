import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DomainError } from '../../../packages/domain/src/vault.ts';
import type { LocalStore } from './store.ts';
import { STRATEGIES, strategyDetail } from './strategy-catalog.ts';
import { view, relation, accountView } from './product-views.ts';
import { productCursors } from './product-cursors.ts';
import { idSchema, limitSchema } from './api-schema.ts';

type Query = { cursor?: string; limit?: string; strategyId?: string };
const querySchema = (filter = false) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: limitSchema,
    cursor: { type: 'string', minLength: 1, maxLength: 1024 },
    ...(filter ? { strategyId: idSchema } : {}),
  },
});
const params = (name: string) => ({ type: 'object', required: [name], properties: { [name]: idSchema } });

export function registerProductRoutes(
  app: FastifyInstance,
  store: LocalStore,
  session: (request: FastifyRequest) => string,
) {
  const cursors = productCursors();
  app.get<{ Querystring: Query }>(
    '/api/v1/strategies',
    { schema: { querystring: querySchema() } },
    async (request) => {
      const owner = session(request),
        scope = `strategies:${owner}`;
      const after = cursors.decode(request.query.cursor, scope) ?? '';
      const limit = Number(request.query.limit ?? '50');
      const all = STRATEGIES.filter((strategy) => strategy.id > after).slice(0, limit + 1);
      const items = all.slice(0, limit);
      return { items, nextCursor: all.length > limit ? cursors.encode(scope, items.at(-1)!.id) : null };
    },
  );
  app.get<{ Params: { strategyId: string } }>(
    '/api/v1/strategies/:strategyId',
    { schema: { params: params('strategyId') } },
    async (request) => {
      const owner = session(request),
        strategyId = request.params.strategyId;
      const detail = strategyDetail(strategyId);
      if (!detail) throw new DomainError('UNKNOWN_STRATEGY');
      let state;
      try {
        state = store.forStrategy(owner, strategyId);
      } catch (error) {
        if (!(error instanceof DomainError && error.code === 'VAULT_NOT_FOUND')) throw error;
      }
      return { ...detail, accountStrategy: relation(owner, strategyId, state) };
    },
  );
  app.get<{ Querystring: Query }>(
    '/api/v1/vaults',
    { schema: { querystring: querySchema(true) } },
    async (request) => {
      const owner = session(request),
        scope = `vaults:${owner}:${request.query.strategyId ?? ''}`;
      const after = cursors.decode(request.query.cursor, scope);
      const page = store.listPage(owner, {
        limit: Number(request.query.limit ?? '50'),
        ...(after ? { after } : {}),
        ...(request.query.strategyId ? { strategyId: request.query.strategyId } : {}),
      });
      return {
        items: page.items.map(view),
        nextCursor: page.nextCursor ? cursors.encode(scope, page.nextCursor) : null,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/vaults/:id',
    { schema: { params: params('id') } },
    async (request) => view(store.get(request.params.id, session(request))),
  );
  app.get<{ Querystring: Query }>(
    '/api/v1/account',
    { schema: { querystring: querySchema() } },
    async (request) => {
      const owner = session(request),
        scope = `account:${owner}`,
        limit = Number(request.query.limit ?? '50');
      const after = cursors.decode(request.query.cursor, scope);
      store.db.exec('BEGIN');
      try {
        const page = store.listPage(owner, { limit, ...(after ? { after } : {}) });
        const account = accountView(owner, store.owned(owner), page, limit);
        const result = {
          ...account,
          pagination: { limit, nextCursor: page.nextCursor ? cursors.encode(scope, page.nextCursor) : null },
        };
        store.db.exec('COMMIT');
        return result;
      } catch (error) {
        if (store.db.isTransaction) store.db.exec('ROLLBACK');
        throw error;
      }
    },
  );
  app.get<{ Params: { id: string }; Querystring: Query }>(
    '/api/v1/vaults/:id/audit',
    { schema: { params: params('id'), querystring: querySchema() } },
    async (request) => {
      const owner = session(request),
        scope = `audit:${owner}:${request.params.id}`;
      const before = cursors.decode(request.query.cursor, scope);
      const page = store.auditPage(owner, request.params.id, {
        limit: Number(request.query.limit ?? '50'),
        ...(before ? { beforeRevision: Number(before) } : {}),
      });
      return {
        items: page.items.map((row) => ({
          revision: row.revision,
          commandId: row.command_id,
          commandType: row.command_type,
          actorId: row.actor_id,
          recordedAt: row.recorded_at,
        })),
        nextCursor: page.nextCursor ? cursors.encode(scope, page.nextCursor) : null,
      };
    },
  );
}

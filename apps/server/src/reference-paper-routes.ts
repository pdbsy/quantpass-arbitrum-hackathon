import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ReferencePaperService } from '../../../packages/automata/src/reference-paper-service.ts';
import { idSchema, amountSchema, limitSchema } from './api-schema.ts';
const fund = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'direction', 'amount6'],
  properties: { type: { const: 'fund' }, direction: { enum: ['in', 'out'] }, amount6: amountSchema },
};
const stop = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: { type: { const: 'stop' } },
};
export function registerReferencePaperRoutes(
  app: FastifyInstance,
  runtime: ReferencePaperService,
  session: (request: FastifyRequest) => string,
): void {
  const guarded = async (reply: FastifyReply, owner: string, work: () => unknown | Promise<unknown>) => {
    try {
      return await work();
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
          ? error.message
          : 'PAPER_SERVICE_FAILED';
      const status =
        code === 'PAPER_NOT_FOUND'
          ? 404
          : code.startsWith('INVALID_')
            ? 400
            : [
                  'PAPER_SERVICE_FAILED',
                  'PAPER_STEP_INTEGRITY',
                  'PAPER_BACKUP_INTEGRITY',
                  'PAPER_REPLAY_MISMATCH',
                ].includes(code)
              ? 500
              : 409;
      return reply.code(status).send({
        error: { code },
        ...(code === 'INSUFFICIENT_CASH' ? { maxWithdraw6: runtime.view(owner).account.cash6 } : {}),
      });
    }
  };
  app.get('/api/v1/reference-paper', async (request, reply) => {
    const owner = session(request);
    return guarded(reply, owner, () => runtime.view(owner));
  });
  app.get<{ Querystring: { before?: string; limit?: string } }>(
    '/api/v1/reference-paper/history',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { before: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' }, limit: limitSchema },
        },
      },
    },
    async (request, reply) => {
      const owner = session(request);
      return guarded(reply, owner, () =>
        runtime.history(
          owner,
          request.query.before ? Number(request.query.before) : undefined,
          Number(request.query.limit ?? '100'),
        ),
      );
    },
  );
  app.post(
    '/api/v1/reference-paper/controls',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'expectedRevision', 'action'],
          properties: {
            id: idSchema,
            expectedRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            action: { oneOf: [fund, stop] },
          },
        },
      },
    },
    async (request, reply) => {
      const owner = session(request);
      return guarded(reply, owner, () => runtime.control(owner, request.body));
    },
  );
  app.post<{ Body: { id: string } }>(
    '/api/v1/reference-paper/backups',
    {
      schema: {
        body: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: idSchema } },
      },
    },
    async (request, reply) => {
      const owner = session(request);
      return guarded(reply, owner, () => runtime.backup(owner, request.body.id));
    },
  );
}

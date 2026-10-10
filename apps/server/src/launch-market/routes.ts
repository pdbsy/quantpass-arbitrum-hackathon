import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { LaunchMarketService } from '../../../../packages/launch-market/src/service.ts';
import {
  LaunchMarketError,
  type QuoteRequest,
  type TrustedEmailIdentity,
  type MarketStreamUpdate,
} from '../../../../packages/launch-market/src/types.ts';

export interface LaunchMarketRoutesOptions {
  readonly service: LaunchMarketService;
  /** Must validate a server-issued account session and CSRF for mutations, never request email fields. */
  readonly trustedIdentity: (
    request: FastifyRequest,
  ) => Promise<TrustedEmailIdentity | null> | TrustedEmailIdentity | null;
}
const ownerSchema = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', maxLength: 42 };
const idSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' };
const rawSchema = { type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$', maxLength: 78 };
const body = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export function registerLaunchMarketRoutes(app: FastifyInstance, options: LaunchMarketRoutesOptions): void {
  const service = options.service,
    clients = new Set<ServerResponse>();
  const account = async (request: FastifyRequest) => {
    const identity = await options.trustedIdentity(request);
    if (!identity) throw new LaunchMarketError('VERIFIED_EMAIL_REQUIRED', 401);
    return service.account(identity);
  };
  const routeError = (error: unknown) => {
    if (error instanceof LaunchMarketError) return error;
    return new LaunchMarketError('MARKET_OPERATION_UNAVAILABLE', 503);
  };
  // A route-scoped wrapper preserves the application's existing error policy.
  const execute = async <T>(work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw routeError(error);
    }
  };
  app.get('/api/launch-market/config', async () => service.config());
  app.get('/api/launch-market/snapshot', async () => execute(() => service.snapshot()));
  app.get('/api/launch-market/account', async (request) =>
    execute(async () => {
      const current = await account(request),
        voucher = service.options.store.voucher(current.id);
      return {
        id: current.id,
        accountKey: current.accountKey,
        wallet: current.wallet,
        emailVerified: true,
        claimStatus: voucher?.status ?? 'ELIGIBLE',
      };
    }),
  );
  app.get<{ Querystring: { owner: string } }>(
    '/api/launch-market/wallet',
    { schema: { querystring: body({ owner: ownerSchema }) } },
    async (request) =>
      execute(async () => {
        const identity = await options.trustedIdentity(request),
          current = identity ? service.account(identity) : null;
        return service.wallet(request.query.owner, current?.id ?? null);
      }),
  );
  app.post<{ Body: { owner: string } }>(
    '/api/launch-market/wallet/challenge',
    { schema: { body: body({ owner: ownerSchema }) } },
    async (request) =>
      execute(async () => {
        const current = await account(request);
        return service.options.store.bindingChallenge(current.id, request.body.owner, service.now());
      }),
  );
  app.post<{ Body: { nonce: string; signature: string } }>(
    '/api/launch-market/wallet/bind',
    {
      schema: {
        body: body({
          nonce: { type: 'string', pattern: '^[a-f0-9]{48}$', maxLength: 48 },
          signature: { type: 'string', pattern: '^0x[0-9a-fA-F]{130}$', maxLength: 132 },
        }),
      },
    },
    async (request) =>
      execute(async () => {
        const current = await account(request),
          bound = service.options.store.bindWallet(
            current.id,
            request.body.nonce,
            request.body.signature,
            service.now(),
          );
        return { id: bound.id, wallet: bound.wallet, emailVerified: true };
      }),
  );
  app.post<{ Body: QuoteRequest }>(
    '/api/launch-market/quote',
    {
      schema: {
        body: body({
          owner: ownerSchema,
          strategyId: { enum: ['TSLA', 'AMZN'] },
          operation: {
            enum: ['MINT', 'BUY', 'SELL', 'CLAIM', 'CREATE_VAULT', 'DEPOSIT', 'WITHDRAW', 'CLOSE'],
          },
          asset: { enum: ['ETH', 'AF_USDC'] },
          amountRaw: rawSchema,
          slippageBps: { type: 'integer', minimum: 0, maximum: 500 },
        }),
      },
    },
    async (request) => execute(async () => service.quote(request.body, (await account(request)).id)),
  );
  app.post<{ Body: { quoteId: string; transactionHash: string; owner: string } }>(
    '/api/launch-market/submissions',
    {
      schema: {
        body: body({
          quoteId: idSchema,
          transactionHash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$', maxLength: 66 },
          owner: ownerSchema,
        }),
      },
    },
    async (request) =>
      execute(async () =>
        service.submit(
          (await account(request)).id,
          request.body.quoteId,
          request.body.transactionHash,
          request.body.owner,
        ),
      ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/launch-market/operations/:id',
    { schema: { params: body({ id: idSchema }) } },
    async (request) => execute(async () => service.operation((await account(request)).id, request.params.id)),
  );
  app.get<{ Querystring: { owner: string } }>(
    '/api/launch-market/operations',
    { schema: { querystring: body({ owner: ownerSchema }) } },
    async (request) =>
      execute(async () => ({
        operations: service.options.store.operations((await account(request)).id, request.query.owner),
      })),
  );
  app.get('/api/launch-market/events', async (request, reply) => {
    const snapshot = await execute(() => service.snapshot());
    const response = reply.raw;
    const send = (event: MarketStreamUpdate) => {
      if (response.destroyed || response.writableEnded) return;
      if (response.writableLength > 65_536) {
        response.end();
        return;
      }
      response.write(`id: ${event.location.version}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = service.broker.subscribe(send);
    reply.hijack();
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    clients.add(response);
    send({ type: 'SNAPSHOT', location: snapshot.location, snapshot });
    const heartbeat = setInterval(() => {
      if (response.writableLength > 65_536) response.end();
      else response.write(': heartbeat\n\n');
    }, 20_000);
    heartbeat.unref();
    response.once('close', () => {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      clients.delete(response);
    });
    request.raw.once('aborted', () => response.end());
  });
  // Fastify waits for open connections before onClose. End hijacked SSE sockets before that wait.
  app.addHook('preClose', async () => {
    for (const client of clients) client.end();
    clients.clear();
  });
}

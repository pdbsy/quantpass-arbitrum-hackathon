import type { FastifyInstance } from 'fastify';
import type { TradingChainRuntime } from './trading-chain-runtime.ts';

const cookieName = '__Host-af_testnet';
const body = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
/** Session identity gates personal evidence; no route signs, broadcasts or starts an executor. */
export function registerTradingRoutes(
  app: FastifyInstance,
  runtimes: readonly Readonly<{ id: string; runtime: TradingChainRuntime }>[],
  sessionOwner: (cookie: string | undefined) => string | null,
  executionStatus?: (owner: string, vault: string) => unknown,
) {
  const runtimeFor = (id: string, owner: string) =>
    runtimes.find((entry) => entry.id === id && entry.runtime.inventory.owner === owner)?.runtime;
  app.get('/api/testnet/vaults', async (request, reply) => {
    const owner = sessionOwner(request.cookies[cookieName]);
    if (!owner) return reply.code(401).send({ error: 'WALLET_LOGIN_REQUIRED' });
    return {
      owner,
      chainId: 46630,
      vaults: runtimes
        .filter((entry) => entry.runtime.inventory.owner === owner)
        .map(({ id, runtime }) => ({
          id,
          manifest: {
            vault: runtime.manifest.contractAddress,
            pass: runtime.manifest.strategyPassAddress,
            usdc: runtime.inventory.usdc,
            stocks: runtime.inventory.stocks,
            manifestDigest: runtime.manifest.manifestDigest,
          },
          ...runtime.ownedView(owner),
          execution: executionStatus?.(owner, runtime.manifest.contractAddress) ?? {
            state: 'NOT_CONFIGURED',
          },
        })),
    };
  });
  app.post<{ Params: { id: string }; Body: { action: Record<string, unknown> } }>(
    '/api/testnet/vaults/:id/prepare',
    { schema: { body: body({ action: { type: 'object', minProperties: 1, maxProperties: 8 } }) } },
    async (request, reply) => {
      const owner = sessionOwner(request.cookies[cookieName]);
      if (!owner) return reply.code(401).send({ error: 'WALLET_LOGIN_REQUIRED' });
      const runtime = runtimeFor(request.params.id, owner);
      if (!runtime) return reply.code(404).send({ error: 'VAULT_NOT_FOUND' });
      return runtime.prepareOwnerAction(owner, request.body.action);
    },
  );
  app.post<{ Params: { id: string }; Body: { operationId: string; transactionHash: string } }>(
    '/api/testnet/vaults/:id/observe',
    {
      schema: {
        body: body({
          operationId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
          transactionHash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' },
        }),
      },
    },
    async (request, reply) => {
      const owner = sessionOwner(request.cookies[cookieName]);
      if (!owner) return reply.code(401).send({ error: 'WALLET_LOGIN_REQUIRED' });
      const runtime = runtimeFor(request.params.id, owner);
      if (!runtime) return reply.code(404).send({ error: 'VAULT_NOT_FOUND' });
      return runtime.observeOwnerSubmission(owner, request.body.operationId, request.body.transactionHash);
    },
  );
  app.get<{ Params: { id: string; operationId: string } }>(
    '/api/testnet/vaults/:id/operations/:operationId',
    async (request, reply) => {
      const owner = sessionOwner(request.cookies[cookieName]);
      if (!owner) return reply.code(401).send({ error: 'WALLET_LOGIN_REQUIRED' });
      const runtime = runtimeFor(request.params.id, owner);
      if (!runtime) return reply.code(404).send({ error: 'VAULT_NOT_FOUND' });
      return {
        ...runtime.operationView(owner, request.params.operationId),
        failedFinalConfirmed: await runtime.verifiedFailure(owner, request.params.operationId),
      };
    },
  );
}

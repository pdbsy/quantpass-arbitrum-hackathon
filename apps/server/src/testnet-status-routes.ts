import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PublicTestnetAppOptions } from './testnet-app.ts';
import { liveRuntimeViews } from '../../../packages/testnet/src/runtime-status.ts';

const names = ['alphaforge_status', 'alphaforge_test_results', 'alphaforge_readiness'] as const;
/** Stateless JSON-RPC MCP compatibility surface; every request uses a current wallet session. */
export function registerTestnetStatusRoutes(
  app: FastifyInstance,
  options: PublicTestnetAppOptions,
  now: () => number,
) {
  const ownerFor = (request: FastifyRequest) => {
    const bearer =
      request.url === '/api/testnet/mcp' && typeof request.headers.authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.authorization)?.[1]
        : undefined;
    return options.auth.owner(bearer ?? request.cookies['__Host-af_testnet'] ?? '', now());
  };
  for (const [url, view] of [
    ['status', 'status'],
    ['readiness', 'readiness'],
    ['test-results', 'testResults'],
  ] as const)
    app.get('/api/testnet/' + url, async (request, reply) => {
      const owner = ownerFor(request);
      if (!owner) return reply.code(401).send({ error: 'WALLET_LOGIN_REQUIRED' });
      return liveRuntimeViews(options, owner, now())[view];
    });
  app.post<{ Body: Record<string, unknown> }>('/api/testnet/mcp', async (request, reply) => {
    const owner = ownerFor(request);
    if (!owner) return reply.code(401).send({ error: 'WALLET_LOGIN_REQUIRED' });
    const b = request.body;
    const id =
      b && ((typeof b.id === 'string' && b.id.length <= 128) || Number.isSafeInteger(b.id)) ? b.id : null;
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (
      !b ||
      Array.isArray(b) ||
      b.jsonrpc !== '2.0' ||
      typeof b.method !== 'string' ||
      Object.keys(b).some((key) => !['jsonrpc', 'id', 'method', 'params'].includes(key))
    )
      return error(-32600, 'Invalid request');
    if (b.method === 'notifications/initialized' && b.id === undefined) return reply.code(202).send();
    if (id === null) return error(-32600, 'Request ID required');
    const params = (b.params ?? {}) as Record<string, unknown>;
    if (!params || typeof params !== 'object' || Array.isArray(params))
      return error(-32602, 'Invalid params');
    let result: unknown;
    if (b.method === 'initialize') {
      if (!['2024-11-05', '2025-03-26', '2025-06-18'].includes(String(params.protocolVersion)))
        return error(-32602, 'Unsupported protocol version');
      result = {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'AlphaForge read-only Testnet', version: '1.0.0' },
        instructions: 'Owner-scoped reads only. Heartbeat is process liveness; archives are historical.',
      };
    } else if (b.method === 'ping') result = {};
    else if (b.method === 'tools/list') {
      if (Object.keys(params).length) return error(-32602, 'Invalid params');
      result = {
        tools: names.map((name) => ({
          name,
          description: 'Authenticated owner-scoped read-only ' + name,
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        })),
      };
    } else if (b.method === 'tools/call') {
      if (
        !names.includes(params.name as (typeof names)[number]) ||
        Object.keys(params).some((key) => !['name', 'arguments'].includes(key)) ||
        (params.arguments !== undefined &&
          (!params.arguments ||
            typeof params.arguments !== 'object' ||
            Array.isArray(params.arguments) ||
            Object.keys(params.arguments).length))
      )
        return error(-32602, 'Invalid tool arguments');
      const views = liveRuntimeViews(options, owner, now());
      const structuredContent =
        params.name === names[0]
          ? views.status
          : params.name === names[1]
            ? views.testResults
            : views.readiness;
      result = {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
        isError: false,
      };
    } else return error(-32601, 'Method not found');
    return { jsonrpc: '2.0', id, result };
  });
}

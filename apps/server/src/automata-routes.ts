import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ASSETS } from '../../../packages/automata/src/model.ts';
import { DATASETS } from '../../../packages/automata/src/fixtures.ts';
import { AutomataStore, type CreateRun, type RunCommand } from './automata-store.ts';
import type { LocalStore } from './store.ts';

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const int = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$', maxLength: 80 };
const money = { type: 'string', pattern: '^[1-9][0-9]{0,23}$', maxLength: 24 };
const asset = { enum: ASSETS.map((a) => a.id) };
const limits = {
  oneOf: [
    object({ mode: { const: 'off' } }),
    {
      ...object({ mode: { const: 'percent' }, upperBps: int(1, 1000000), lowerBps: int(-10000, -1) }, [
        'mode',
      ]),
      anyOf: [{ required: ['upperBps'] }, { required: ['lowerBps'] }],
    },
    {
      ...object({ mode: { const: 'price' }, assetId: asset, upper: money, lower: money }, [
        'mode',
        'assetId',
      ]),
      anyOf: [{ required: ['upper'] }, { required: ['lower'] }],
    },
  ],
};
const parameters = object({
  weights: { ...object(Object.fromEntries(ASSETS.map((a) => [a.id, int(0, 10000)])), []), minProperties: 1 },
  deviationBps: int(1, 10000),
  intervalMs: int(1000, 86400000),
  feeBps: int(0, 1000),
  maxSlippageBps: int(0, 1000),
  limits,
});
export function registerAutomataRoutes(
  app: FastifyInstance,
  local: LocalStore,
  session: (request: FastifyRequest) => string,
  autoReplay = false,
) {
  const bots = new AutomataStore(local);
  let failedRuns: string[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  if (autoReplay)
    app.addHook('onReady', async () => {
      timer = setInterval(() => {
        try {
          failedRuns = bots.tick();
        } catch {
          failedRuns = ['scheduler'];
        }
      }, 1000);
      timer.unref();
    });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
  const summary = (owner: string) =>
    bots.list(owner).map((run) => ({
      ...run,
      runtimeError:
        failedRuns.includes(run.state.id) || failedRuns.includes('scheduler')
          ? '回放执行失败，请检查本地存储并重试'
          : null,
    }));
  app.get('/api/v1/automata/catalog', async (request) => {
    session(request);
    return { scope: 'TEST_ONLY', assets: ASSETS, datasets: DATASETS, autoReplay };
  });
  app.get('/api/v1/automata', async (request) => ({ items: summary(session(request)) }));
  app.get<{ Params: { id: string } }>(
    '/api/v1/automata/:id',
    { schema: { params: object({ id }) } },
    async (request) => bots.get(session(request), request.params.id),
  );
  app.post<{ Body: CreateRun }>(
    '/api/v1/automata',
    {
      schema: {
        body: object({
          id,
          vaultId: id,
          amount: money,
          datasetId: { enum: DATASETS.map((d) => d.id) },
          parameters,
        }),
      },
    },
    async (request) => bots.create(session(request), request.body),
  );
  const common = { id, expectedRevision: int(0, 10000) };
  app.post<{ Params: { id: string }; Body: RunCommand }>(
    '/api/v1/automata/:id/actions',
    {
      schema: {
        params: object({ id }),
        body: {
          oneOf: [
            object({ ...common, type: { enum: ['step', 'stop', 'pause', 'resume'] } }),
            object({ ...common, type: { const: 'fund' }, direction: { enum: ['in', 'out'] }, amount: money }),
          ],
        },
      },
    },
    async (request) => bots.command(session(request), request.params.id, request.body),
  );
  return bots;
}

import { buildApp } from '../../apps/server/src/app.ts';
if (!process.argv[2] || !process.send) throw new Error('TEST_HARNESS_ONLY');
const { app } = await buildApp({
  dbPath: process.argv[2],
  env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
  origin: 'http://127.0.0.1:4180',
});
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('MISSING_TEST_ADDRESS');
process.send({ port: address.port });
process.on('message', (message) => {
  if (message === 'close') void app.close().then(() => process.disconnect());
});

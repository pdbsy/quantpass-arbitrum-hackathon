import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';

const root = new URL('../../../', import.meta.url);
await mkdir(new URL('.data/', root), { recursive: true });
const { app } = await buildApp({
  dbPath: fileURLToPath(new URL('.data/demo.sqlite', root)),
  env: process.env,
  origin: 'http://127.0.0.1:4180',
  webRoot: fileURLToPath(new URL('apps/web/dist/', root)),
});
await app.listen({ host: '127.0.0.1', port: 4180 });
console.log('AlphaForge LOCAL SIMULATION: http://127.0.0.1:4180');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });

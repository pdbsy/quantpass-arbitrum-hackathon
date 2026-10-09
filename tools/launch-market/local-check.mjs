import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const binary = resolve(root, '.checks/af-chain01/toolchain/bin/anvil');
const lock = JSON.parse(await readFile(new URL('./anvil-lock.json', import.meta.url), 'utf8'));
if (
  createHash('sha256')
    .update(await readFile(binary))
    .digest('hex') !== lock.binarySha256
)
  throw new Error('ANVIL_BINARY_HASH_MISMATCH');
const port = await new Promise((done, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const selected = server.address().port;
    server.close(() => done(selected));
  });
});
const url = `http://127.0.0.1:${port}`;
const anvil = spawn(
  binary,
  [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--chain-id',
    '46630',
    '--gas-limit',
    '30000000',
    '--silent',
  ],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
);
const stopped = new Promise((done) => anvil.once('exit', done));
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(1000),
      });
      ready = BigInt((await response.json()).result) === 46630n;
      if (ready) break;
    } catch {
      /* Bounded startup retry. */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!ready) throw new Error('LOCAL_ANVIL_START_FAILED');
  const child = spawn(
    process.execPath,
    ['--test', '--test-isolation=none', 'test/launch-market-local-evm.test.ts'],
    { cwd: root, env: { ...process.env, AF_LOCAL_EVM_RPC: url }, stdio: 'inherit' },
  );
  process.exitCode = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => done(signal ? 1 : (code ?? 1)));
  });
} finally {
  anvil.kill('SIGTERM');
  await stopped;
}

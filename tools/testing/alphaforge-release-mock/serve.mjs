import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createReleaseSession } from './session.mjs';

// Standalone local TEST entry, never imported by a production CLI. The secure
// public-app ingress is exercised via its local inject transport; this listener
// itself is HTTP MOCK and cannot qualify a deployed TLS proxy.
export async function serveReleaseMock({ directory, port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MOCK_LOOPBACK_PORT');
  const s = await createReleaseSession({ ...(directory ? { directory: resolve(directory) } : {}) });
  const server = createServer(async (req, res) => {
    try {
      if (
        req.headers.host !== `127.0.0.1:${server.address().port}` ||
        req.headers['x-release-mock'] !== '1'
      ) {
        res.writeHead(403);
        res.end('MOCK_LOOPBACK_INGRESS');
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 16384) throw new Error('MOCK_BODY_LIMIT');
      }
      const response = await s.request(
        req.url,
        req.method === 'GET' ? undefined : JSON.parse(body || '{}'),
        req.headers.cookie ?? '',
      );
      res.writeHead(response.statusCode, {
        'content-type': 'application/json',
        'x-alphaforge-mode': 'MOCK',
        ...(response.headers['set-cookie'] ? { 'set-cookie': response.headers['set-cookie'] } : {}),
      });
      res.end(response.body);
    } catch {
      res.writeHead(400);
      res.end('MOCK_REQUEST_REJECTED');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  return {
    s,
    port: server.address().port,
    async close() {
      await new Promise((resolveClose) => server.close(resolveClose));
      await s.close();
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !arg.startsWith('--session=') && !arg.startsWith('--port=')))
    throw new Error('MOCK_ARGUMENT');
  const directory = args.find((arg) => arg.startsWith('--session='))?.slice(10);
  const port = Number(args.find((arg) => arg.startsWith('--port='))?.slice(7) ?? '0');
  const server = await serveReleaseMock({ ...(directory ? { directory } : {}), port });
  process.stdout.write(
    JSON.stringify({ mode: 'MOCK', directory: server.s.directory, port: server.port }) + '\n',
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    process.exitCode = 0;
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

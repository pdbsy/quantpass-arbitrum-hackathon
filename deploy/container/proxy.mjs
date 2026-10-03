import https from 'node:https';
import http from 'node:http';
import { resolve } from 'node:path';
import { lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { regularBytes, proxyHeaders } from './boundary.mjs';
export async function startProxy({ origin, key, cert, host = '0.0.0.0', port = 8443, upstreamPort = 4190 }) {
  const server = https.createServer(
    { key, cert, minVersion: 'TLSv1.2', maxHeaderSize: 16384, requestTimeout: 10000, headersTimeout: 10000 },
    (request, response) => {
      let headers;
      try {
        headers = proxyHeaders(request.headers, request.socket.remoteAddress, origin);
      } catch {
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end('{"error":"CONTAINER_INGRESS_REJECTED"}');
        return;
      }
      if (request.headers.upgrade || Number(request.headers['content-length'] ?? 0) > 16384) {
        response.writeHead(413);
        response.end();
        return;
      }
      const upstream = http.request(
        {
          host: '127.0.0.1',
          port: upstreamPort,
          path: request.url,
          method: request.method,
          headers,
          timeout: 10000,
        },
        (incoming) => {
          response.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(response);
        },
      );
      let bytes = 0;
      request.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 16384) {
          upstream.destroy();
          if (!response.headersSent) response.writeHead(413);
          response.end();
          request.destroy();
        }
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"error":"CONTAINER_UPSTREAM_UNAVAILABLE"}');
      });
      request.on('aborted', () => upstream.destroy());
      request.pipe(upstream);
    },
  );
  server.on('tlsClientError', () => {});
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, host, done);
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error();
    const origin = process.argv[2],
      url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error();
    const keyStat = lstatSync('/etc/alphaforge/tls/privkey.pem');
    if (keyStat.uid !== process.getuid() || (keyStat.mode & 0o777) !== 0o600) throw new Error();
    const server = await startProxy({
      origin,
      key: regularBytes('/etc/alphaforge/tls/privkey.pem'),
      cert: regularBytes('/etc/alphaforge/tls/fullchain.pem'),
    });
    const stop = () => {
      server.close(() => {});
      server.closeIdleConnections();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    console.log('CONTAINER_HTTPS_READY');
  } catch {
    console.error('CONTAINER_HTTPS_REJECTED');
    process.exitCode = 1;
  }
}

import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { buildApp as buildActualApp } from '../../apps/server/src/app.ts';

// A real loopback legacy-only HTTP surface over the original local/mock store.
// APIRequestContext requests do not pass through page.route; every /api/v1
// request receives a real 404 here, including after the driver's capability probe.
export async function buildApp(options) {
  const mode = process.env.AF_BROWSER_CAPABILITY_MODE || 'legacy';
  if (
    !['legacy', 'canonical', '401', '403', '429', '500', '503', 'malformed-200', 'connection-reset'].includes(
      mode,
    )
  )
    throw new Error('UNKNOWN_CAPABILITY_FIXTURE_MODE');
  const { app: actual, store } = await buildActualApp(options);
  const log = (value) =>
    appendFileSync(options.dbPath + '.legacy-observations.jsonl', JSON.stringify(value) + '\n');
  log({ event: 'created', dbPath: options.dbPath, initialVaults: store.list('alice') });
  let upstreamPort;
  let forwarded = 0;
  let windowStartedAt = 0;
  let windowRequests = 0;
  let safeAfterAt = null;
  let maxWindowRequests = 0;
  const budgetFile =
    process.env.AF_BROWSER_INPUT_BUDGET &&
    `${process.env.AF_BROWSER_INPUT_BUDGET}.${new URL(options.origin).port}`;
  const publishBudget = () => {
    if (budgetFile)
      writeFileSync(budgetFile, JSON.stringify({ windowStartedAt, windowRequests, safeAfterAt }));
  };
  publishBudget();
  const facade = createServer((incoming, outgoing) => {
    const isProbe = incoming.url === '/api/v1/strategies?limit=1';
    const logProbe = (status) =>
      log({
        event: 'capability-probe',
        method: incoming.method,
        url: incoming.url,
        status,
        headers: {
          userAgent: incoming.headers['user-agent'],
          secFetchMode: incoming.headers['sec-fetch-mode'] ?? null,
        },
        aliceVaults: store.list('alice'),
      });
    if (mode !== 'canonical' && new URL(incoming.url, options.origin).pathname.startsWith('/api/v1/')) {
      if (isProbe && mode === 'connection-reset') {
        logProbe(null);
        outgoing.destroy();
        return;
      }
      const status = !isProbe || mode === 'legacy' ? 404 : mode === 'malformed-200' ? 200 : Number(mode);
      const body = JSON.stringify({
        error: isProbe && mode !== 'legacy' ? 'CONTROLLED_PROBE_RESPONSE' : 'LEGACY_API_ONLY',
      });
      outgoing.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      outgoing.end(body);
      if (isProbe) logProbe(outgoing.statusCode);
      return;
    }
    forwarded++;
    const now = Date.now();
    if (windowRequests === 0 || (safeAfterAt !== null && now > safeAfterAt)) {
      windowStartedAt = now;
      windowRequests = 0;
      safeAfterAt = null;
    }
    windowRequests++;
    maxWindowRequests = Math.max(maxWindowRequests, windowRequests);
    const firstInWindow = windowRequests === 1;
    const requestWindow = windowStartedAt;
    publishBudget();
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: upstreamPort,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
        agent: false,
      },
      (response) => {
        if (firstInWindow)
          response.once('end', () => {
            if (requestWindow !== windowStartedAt) return;
            const firstResponseCompletedAt = Date.now();
            safeAfterAt = firstResponseCompletedAt + 60100;
            publishBudget();
            log({ event: 'conservative-window', windowStartedAt, firstResponseCompletedAt, safeAfterAt });
          });
        if (isProbe) logProbe(response.statusCode);
        if (response.statusCode >= 400) {
          let body = '';
          response.on('data', (chunk) => {
            if (body.length < 2048) body += chunk;
          });
          response.on('end', () =>
            log({
              event: 'upstream-error',
              method: incoming.method,
              url: incoming.url,
              status: response.statusCode,
              body,
            }),
          );
        }
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', (error) => outgoing.destroy(error));
    incoming.on('error', (error) => upstream.destroy(error));
    incoming.pipe(upstream);
  });
  return {
    store,
    app: {
      async listen({ host, port }) {
        if (host !== '127.0.0.1') throw new Error('LEGACY_FIXTURE_REQUIRES_LOOPBACK');
        await actual.listen({ host: '127.0.0.1', port: 0 });
        upstreamPort = actual.server.address().port;
        await new Promise((done, reject) => {
          facade.once('error', reject);
          facade.listen(port, host, done);
        });
        log({ event: 'listening', publicPort: facade.address().port, upstreamPort });
      },
      async close() {
        const outcomes = await Promise.allSettled([
          new Promise((done, reject) => {
            if (!facade.listening) return done();
            facade.close((error) => (error ? reject(error) : done()));
          }),
          actual.close(),
        ]);
        const failure = outcomes.find((outcome) => outcome.status === 'rejected');
        if (failure) throw failure.reason;
        log({
          event: 'closed',
          publicListening: facade.listening,
          upstreamListening: actual.server.listening,
        });
        log({ event: 'input-budget-complete', forwarded, maxWindowRequests });
      },
    },
  };
}

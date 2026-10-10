import https from 'node:https';
import { regularBytes } from './boundary.mjs';
try {
  if (process.getuid() === 0) {
    process.setgroups([]);
    process.setgid(10004);
    process.setuid(10004);
  }
  const ready = JSON.parse(regularBytes('/run/alphaforge/ready.json')),
    origin = new URL(ready.origin);
  if (ready.mode !== 'WATCH_ONLY' || ready.signingEnabled !== false) throw new Error();
  const req = https.request(
    {
      hostname: '127.0.0.1',
      port: 8443,
      path: '/api/health',
      servername: origin.hostname,
      headers: { host: origin.host },
      ca: regularBytes('/etc/alphaforge/tls/fullchain.pem'),
      allowPartialTrustChain: true,
      timeout: 3000,
    },
    (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      res.on('end', () => {
        try {
          const h = JSON.parse(body);
          if (
            res.statusCode !== 200 ||
            h.mode !== 'PUBLIC_TESTNET' ||
            h.chainId !== 46630 ||
            h.storage !== 'AVAILABLE'
          )
            throw new Error();
        } catch {
          process.exitCode = 1;
        }
      });
    },
  );
  req.on('error', () => {
    process.exitCode = 1;
  });
  req.on('timeout', () => req.destroy());
  req.end();
} catch {
  process.exitCode = 1;
}

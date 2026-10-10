import { existsSync, writeFileSync, readFileSync } from 'node:fs';
const file = '/var/lib/alphaforge/executor/unknown-order.txt';
if (!existsSync(file)) writeFileSync(file, 'MOCK_RESERVED_NONCE_17_UNKNOWN', { mode: 0o600 });
if (readFileSync(file, 'utf8') !== 'MOCK_RESERVED_NONCE_17_UNKNOWN') throw new Error();
writeFileSync(
  '/var/lib/alphaforge/status/execution-status.json',
  JSON.stringify({ scope: 'MOCK', signingEnabled: false, observedAt: Date.now() }),
  { mode: 0o640 },
);
const timer = setInterval(() => {}, 1000);
process.on('SIGTERM', () => {
  clearInterval(timer);
  writeFileSync('/var/lib/alphaforge/executor/graceful-stop.txt', 'MOCK_GRACEFUL', { mode: 0o600 });
});
console.log('MOCK_EXECUTOR_NO_SIGNING_READY');

import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { regularBytes } from './boundary.mjs';
import { retainedBytes } from './volume.mjs';
let child,
  timer,
  stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  if (child) {
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 20000);
    force.unref();
  } else process.exit(0);
}
process.on('message', (message) => {
  if (message.type === 'shutdown') {
    stop();
    return;
  }
  if (message.type !== 'start' || child) return;
  try {
    const env = { ...message.env };
    if (message.rpcFile) {
      const s = lstatSync(message.rpcFile);
      if (s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600) throw new Error();
      const rpc = new TextDecoder('utf-8', { fatal: true })
          .decode(regularBytes(message.rpcFile, 4096))
          .trim(),
        url = new URL(rpc);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
      env.AF_TESTNET_RPC_URL = rpc;
    }
    child = spawn(message.command, message.args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '';
    const relay = (data) => {
      pending += data.toString();
      if (pending.length > 8192) {
        stop();
        return;
      }
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i).trim();
        pending = pending.slice(i + 1);
        if (message.readyToken && line.startsWith(message.readyToken)) {
          process.send?.({ type: 'ready' });
          console.log(message.readyToken);
        } else if (/^[A-Z][A-Z0-9_]{1,100}$/.test(line)) console.error(line);
      }
    };
    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
    child.on('error', () => {
      process.send?.({ type: 'failed' });
      process.exitCode = 1;
    });
    child.on('close', (code, signal) => {
      clearInterval(timer);
      process.send?.({ type: 'closed', code, signal });
      process.exit(stopping && code === 0 ? 0 : 1);
    });
    if (!message.readyToken) child.once('spawn', () => process.send?.({ type: 'ready' }));
    const report = () => {
      try {
        const bytes = (message.storageRoots ?? []).reduce((n, root) => n + retainedBytes(root), 0);
        process.send?.({ type: 'storage', bytes });
      } catch {
        process.send?.({ type: 'failed' });
        stop();
      }
    };
    report();
    timer = setInterval(report, 1000);
  } catch {
    process.send?.({ type: 'failed' });
    process.exit(1);
  }
});
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

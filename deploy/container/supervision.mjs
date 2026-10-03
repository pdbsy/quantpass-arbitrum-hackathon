import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export async function supervise(
  plans,
  {
    shutdownMs = 25000,
    onReady = () => {},
    checkStorage = () => {},
    dropIdentity = () => {},
    onStopped = () => {},
  } = {},
) {
  let stopping = false,
    failed = false,
    remaining = plans.length,
    resolveDone,
    force,
    monitor,
    startup;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const children = [],
    reports = new Map(),
    outcomes = new Map(),
    ready = new Set();
  const launchedAt = Date.now();
  function shutdown(error = false) {
    failed ||= error;
    if (stopping) return;
    stopping = true;
    clearInterval(monitor);
    clearTimeout(startup);
    for (const child of children)
      if (child.connected)
        child.send({ type: 'shutdown' }, (error) => {
          if (error) failed = true;
        });
    force = setTimeout(() => {
      failed = true;
      process.exit(1);
    }, shutdownMs);
    force.unref();
  }
  const signal = () => shutdown();
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  for (const plan of plans) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url))], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: plan.env,
      ...(plan.uid !== undefined ? { uid: plan.uid, gid: plan.gid } : {}),
    });
    children.push(child);
    child.on('message', (m) => {
      if (m.type === 'ready') {
        ready.add(plan.name);
        if (ready.size === plans.length) {
          clearTimeout(startup);
          try {
            onReady();
          } catch {
            shutdown(true);
          }
        }
      } else if (m.type === 'storage' && Number.isSafeInteger(m.bytes) && m.bytes >= 0)
        reports.set(plan.name, { bytes: m.bytes, at: Date.now() });
      else if (m.type === 'failed') shutdown(true);
      else if (m.type === 'closed')
        outcomes.set(plan.name, { name: plan.name, applicationCode: m.code, applicationSignal: m.signal });
    });
    child.once('error', () => shutdown(true));
    child.once('close', (code, signal) => {
      outcomes.set(plan.name, {
        ...(outcomes.get(plan.name) ?? { name: plan.name }),
        launcherCode: code,
        launcherSignal: signal,
      });
      if (code !== 0 || signal !== null) failed = true;
      remaining--;
      if (!stopping) shutdown(true);
      if (!remaining) resolveDone();
    });
    child.send({ type: 'start', ...plan }, (error) => {
      if (error) shutdown(true);
    });
  }
  try {
    dropIdentity();
  } catch {
    shutdown(true);
  }
  startup = setTimeout(() => shutdown(true), 90000);
  monitor = setInterval(() => {
    try {
      for (const plan of plans)
        if (Date.now() - (reports.get(plan.name)?.at ?? launchedAt) > 10000) throw new Error();
      checkStorage([...reports.values()].reduce((n, v) => n + v.bytes, 0));
    } catch {
      shutdown(true);
    }
  }, 1000);
  await done;
  clearInterval(monitor);
  clearTimeout(startup);
  clearTimeout(force);
  process.removeListener('SIGTERM', signal);
  process.removeListener('SIGINT', signal);
  onStopped({ clean: !failed, outcomes: [...outcomes.values()] });
  process.exitCode = failed ? 1 : 0;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
const moduleUrl = new URL('../deploy/container/supervision.mjs', import.meta.url).href;
function run(t, first, peerExit = 0) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'af-process-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const peer = `import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(join(dir, 'stopped'))},'graceful');process.exit(${peerExit})});setInterval(()=>{},100);`;
  const source = `import {supervise} from ${JSON.stringify(moduleUrl)};const child={command:process.execPath,args:['--input-type=module','-e',${JSON.stringify(peer)}],env:{PATH:process.env.PATH}};await supervise([{name:'peer',...child},{name:'trigger',command:process.execPath,args:['-e',${JSON.stringify(first)}],env:{PATH:process.env.PATH}}],{shutdownMs:2000});`;
  return {
    child: spawn(process.execPath, ['--input-type=module', '-e', source], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
    dir,
  };
}
test('one process death terminates peer gracefully and returns failure without retry', async (t) => {
  const { child, dir } = run(t, 'setTimeout(()=>process.exit(7),600)');
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.equal(readFileSync(join(dir, 'stopped'), 'utf8'), 'graceful');
});
test('PID1 SIGTERM reaches children and returns orderly success', async (t) => {
  const { child, dir } = run(t, "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},100)");
  const closed = once(child, 'close');
  await new Promise((r) => setTimeout(r, 600));
  child.kill('SIGTERM');
  const [code] = await closed;
  assert.equal(code, 0);
  assert.equal(readFileSync(join(dir, 'stopped'), 'utf8'), 'graceful');
});

test('a child that exits nonzero during SIGTERM shutdown is failure', async (t) => {
  const { child } = run(t, "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},100)", 7);
  const done = once(child, 'close');
  await new Promise((r) => setTimeout(r, 600));
  child.kill('SIGTERM');
  const [code] = await done;
  assert.equal(code, 1);
});
test('forced signal during stop and child start error are failed outcomes', async (t) => {
  const moduleUrl = new URL('../deploy/container/supervision.mjs', import.meta.url).href;
  for (const mode of ['signal', 'spawn']) {
    const source = `import {supervise} from ${JSON.stringify(moduleUrl)};await supervise([{name:'failure',command:${mode === 'spawn' ? JSON.stringify('/definitely-missing-af-child') : 'process.execPath'},args:${mode === 'spawn' ? '[]' : JSON.stringify(['-e', "process.on('SIGTERM',()=>process.kill(process.pid,'SIGKILL'));setInterval(()=>{},100)"])},env:{PATH:process.env.PATH}}],{shutdownMs:2000,onStopped:r=>console.log(JSON.stringify(r))});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    const done = once(child, 'close');
    if (mode === 'signal') {
      await new Promise((r) => setTimeout(r, 500));
      child.kill('SIGTERM');
    }
    const [code] = await done;
    assert.equal(code, 1);
    assert.equal(JSON.parse(out.trim()).clean, false);
  }
  t.assert.ok(true);
});

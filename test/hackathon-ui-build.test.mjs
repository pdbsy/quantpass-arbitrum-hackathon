import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('Hackathon build ships the original UI and keeps the existing Chinese task board usable', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'alphaforge-web-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  execFileSync(process.execPath, ['tools/import-user-ui.mjs'], { stdio: 'pipe' });
  execFileSync(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'build',
      'apps/web',
      '--config',
      'apps/web/vite.config.ts',
      '--outDir',
      out,
    ],
    { stdio: 'pipe' },
  );
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.ok(html.includes('/user-ui.css'));
  assert.ok(html.includes('/user-ui.js'));
  assert.ok(html.includes('AlphaForge'));
  assert.equal(
    await readFile(join(out, 'task-board.html'), 'utf8'),
    await readFile('docs/task-board.html', 'utf8'),
  );
  assert.equal(
    await readFile(join(out, 'task-board.js'), 'utf8'),
    await readFile('docs/task-board.js', 'utf8'),
  );
  const source = await readFile('apps/web/prototype/AlphaForge_v3_EN.html', 'utf8');
  assert.equal(
    await readFile(join(out, 'user-ui.css'), 'utf8'),
    source.match(/<style>([\s\S]*?)<\/style>/)[1],
  );
  assert.ok((await readFile(join(out, 'user-ui.js'), 'utf8')).includes('data-user-style'));
});

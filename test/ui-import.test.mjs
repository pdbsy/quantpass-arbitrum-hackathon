import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importUserUI, normalizeStyles } from '../tools/import-user-ui.mjs';
test('actual importer preserves exact source, CSS, script except scoped style hydration markers and shell', async () => {
  const source = await readFile('apps/web/prototype/AlphaForge_v3_EN.html', 'utf8');
  assert.equal(Buffer.byteLength(source), 285969);
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    '949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45',
  );
  const out = await mkdtemp(join(tmpdir(), 'af-import-'));
  await importUserUI(source, out);
  const html = await readFile(join(out, 'index.html'), 'utf8');
  const css = await readFile(join(out, 'public/user-ui.css'), 'utf8');
  const js = await readFile(join(out, 'public/user-ui.js'), 'utf8');
  assert.equal(css, source.match(/<style>([\s\S]*?)<\/style>/)[1]);
  assert.equal(js, normalizeStyles(source.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.equal(
    html,
    normalizeStyles(
      source
        .replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/user-ui.css">')
        .replace(
          /<script>[\s\S]*?<\/script>/,
          '<script src="/user-ui.js"></script>\n<script type="module" src="/src/product-ui.ts"></script>',
        ),
    ),
  );
  assert.doesNotMatch(html, /<style>|<script>/);
  assert.doesNotMatch(js, /\sstyle=/);
  assert.ok(js.includes('data-price-style'));
  assert.ok(js.includes('font-style'));
  await importUserUI(source, out);
  assert.equal(await readFile(join(out, 'index.html'), 'utf8'), html);
});
test('mechanical style normalization preserves escaped JSON and unrelated attribute names', () => {
  assert.equal(
    normalizeStyles(' style=\\"color:red\\" data-price-style="x" font-style="italic"'),
    ' data-user-style=\\"color:red\\" data-price-style="x" font-style="italic"',
  );
});

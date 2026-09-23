import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifiedPrototypeArtifacts } from './helpers/prototype-artifact.mjs';
import { importUserUI, normalizeStyles } from '../tools/import-user-ui.mjs';
test('actual importer preserves the reviewed repair and the historical original artifact', async (t) => {
  const { current: source } = await verifiedPrototypeArtifacts(resolve(import.meta.dirname, '..'));
  const out = await mkdtemp(join(tmpdir(), 'af-import-'));
  t.after(() => rm(out, { recursive: true, force: true }));
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
  assert.equal(await readFile(join(out, 'public/user-ui.css'), 'utf8'), css);
  assert.equal(await readFile(join(out, 'public/user-ui.js'), 'utf8'), js);
});
test('mechanical style normalization preserves escaped JSON and unrelated attribute names', () => {
  assert.equal(
    normalizeStyles(' style=\\"color:red\\" data-price-style="x" font-style="italic"'),
    ' data-user-style=\\"color:red\\" data-price-style="x" font-style="italic"',
  );
});

test('UI importer refuses ambiguous or absent executable blocks before writing output', async (t) => {
  const { rm, readdir } = await import('node:fs/promises');
  const out = await mkdtemp(join(tmpdir(), 'af-import-invalid-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  for (const source of [
    '<style>a{}</style>',
    '<script>void 0</script>',
    '<style>a{}</style><style>b{}</style><script>void 0</script>',
    '<style>a{}</style><script>void 0</script><script>void 1</script>',
  ]) {
    await assert.rejects(importUserUI(source, out), /EXPECTED_ONE_STYLE_AND_SCRIPT/);
    assert.deepEqual(await readdir(out), []);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPrototypeMap } from '../tools/coverage/prototype-map.mjs';
import { normalizeStyles, importUserUI } from '../tools/import-user-ui.mjs';

test('prototype mapping preserves extraction and insertion positions including UTF-16 columns', () => {
  const html = '<h1>Intro 😀</h1>\n<script>\nconst x = "😀 style=color";\nconst y = 1;\n</script>\n';
  const result = buildPrototypeMap(html);
  assert.ok(result, 'mapping must exist');
  assert.equal(result.generated, '\nconst x = "😀 data-user-style=color";\nconst y = 1;\n');
  assert.deepEqual(result.originalPosition({ line: 2, column: 0 }), { line: 3, column: 0 });
  assert.deepEqual(result.originalPosition({ line: 3, column: 0 }), { line: 4, column: 0 });
  const at = result.generated.indexOf('data-user-style=');
  const original = html.indexOf('style=');
  for (let i = 0; i < 10; i++) assert.equal(result.originalOffset(at + i), original);
  assert.equal(result.originalOffset(at + 10), original);
  assert.equal(result.originalOffset(at + 16), original + 6);
  assert.equal(result.originalOffset(result.generated.length), html.indexOf('</script>'));
  assert.throws(() => result.originalOffset(-1));
  assert.throws(() => result.originalOffset(result.generated.length + 1));
  assert.throws(() => result.originalPosition({ line: 0, column: 0 }));
  assert.throws(() => result.originalPosition({ line: 2, column: 999 }));
});

test('missing, ambiguous and malformed script sources cannot produce a mapping', () => {
  for (const src of ['', '<script>x', '<script>x</script><script>y</script>'])
    assert.throws(() => buildPrototypeMap(src));
});

test('mapper extracts exact mixed-case script range without mistaking quoted delimiters for tags', () => {
  const html =
    "<!-- <script>inert</script> -->\n<div data-note='a > b <script>inert</script>'></div><Script>\nconst answer=42;\n</sCrIpT>";
  const mapped = buildPrototypeMap(html);
  assert.equal(mapped.original, '\nconst answer=42;\n');
  assert.equal(mapped.generated, '\nconst answer=42;\n');
  assert.deepEqual(mapped.originalPosition({ line: 2, column: 0 }), { line: 3, column: 0 });
  assert.equal(mapped.originalOffset(mapped.generated.length), html.indexOf('</sCrIpT>'));
});

test('mapper excludes real external and JSON blocks but refuses a second executable block', () => {
  const prefix = '<script src="external.js"></script><script type="application/json">{}</script>';
  assert.equal(buildPrototypeMap(prefix + '<SCRIPT>const answer=42;</SCRIPT>').generated, 'const answer=42;');
  assert.throws(() => buildPrototypeMap('<script>first()</script><SCRIPT>second()</SCRIPT>'));
});

test('mapper uses only an appropriate end tag and preserves exact ASCII whitespace offsets', () => {
  const html = '<script\t\n>const text="</scripture>";</SCRIPT\f\r >';
  const mapped = buildPrototypeMap(html);
  assert.equal(mapped.generated, 'const text="</scripture>";');
  assert.deepEqual(mapped.originalPosition({ line: 1, column: 0 }), { line: 2, column: 1 });
  assert.equal(mapped.originalOffset(0), html.indexOf('const text'));
  assert.throws(() => buildPrototypeMap('<script/>text</script>'));
  assert.throws(() => buildPrototypeMap('<script>text</script/>'));
});

for (const attributes of [
  'type="text/plain"',
  'nomodule',
  'type="module"',
  'async',
  'defer',
  'nonce="fixture"',
  'data-src="fixture"',
]) {
  test(`mapper refuses extraction that would discard script attributes: ${attributes}`, () => {
    assert.throws(
      () => buildPrototypeMap('<script ' + attributes + '>globalThis.visible=1</script>'),
      /attribute/,
    );
  });
}

test('mapper fails closed on ambiguous lexical boundaries instead of returning a partial script', () => {
  for (const html of [
    '<script>first()</script\n ignored>',
    '<script type="text/javascript" TYPE="application/json">first()</script>',
    '<script data-note="unfinished>first()</script>',
    '<script><!--<script>first()</script>second()</script>',
    '<textarea><script>not an admitted range</script></textarea><script>first()</script>',
    '<!-- --!><script>first()</script>',
    '<svg><script>first()</script></svg>',
  ])
    assert.throws(() => buildPrototypeMap(html));
});

test('actual tracked prototype maps exactly to the served bytes across all seventeen substitutions', async (t) => {
  const html = readFileSync('apps/web/prototype/AlphaForge_v3_EN.html', 'utf8');
  const result = buildPrototypeMap(html);
  assert.ok(result, 'mapping must exist');
  const output = mkdtempSync(join(tmpdir(), 'alphaforge-prototype-map-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  await importUserUI(html, output);
  const served = readFileSync(join(output, 'public/user-ui.js'), 'utf8');
  assert.equal(result.generated, served);
  assert.equal(result.generated, normalizeStyles(result.original));
  assert.equal(result.insertions.length, 17);
  for (const edit of result.insertions) {
    assert.equal(result.originalOffset(edit.generatedStart - 1), result.scriptStart + edit.originalStart - 1);
    assert.equal(result.originalOffset(edit.generatedStart), result.scriptStart + edit.originalStart);
    assert.equal(result.originalOffset(edit.generatedStart + 10), result.scriptStart + edit.originalStart);
    assert.equal(
      result.originalOffset(edit.generatedStart + 16),
      result.scriptStart + edit.originalStart + 6,
    );
  }
  for (let pos = 0; pos < result.generated.length; pos++) {
    const mapped = result.originalOffset(pos);
    if (!result.insertions.some((x) => pos >= x.generatedStart && pos < x.generatedStart + 10))
      assert.equal(result.generated[pos], html[mapped]);
  }
});

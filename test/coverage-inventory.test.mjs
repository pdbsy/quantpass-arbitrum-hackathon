import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readSourceSnapshot, isTypeOnly } from '../tools/coverage/inventory.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-cov-source-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  git('init', '-q');
  git('config', 'user.name', 'Coverage fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  for (const p of ['src', 'test', 'docs', 'apps']) mkdirSync(join(root, p));
  writeFileSync(join(root, 'src/unused.ts'), 'export function unused() { return 3; }\n');
  writeFileSync(join(root, 'src/types.d.ts'), 'export interface Value { id: string }\n');
  writeFileSync(join(root, 'docs/task-board.js'), 'globalThis.visible = true;\n');
  writeFileSync(join(root, 'test/example.test.mjs'), 'throw new Error("fixture test excluded");\n');
  git('add', '.');
  git('commit', '-qm', 'source fixture');
  return { root, git };
}
test('Git inventory retains never-run, declarations, and non-app executable paths', (t) => {
  const { root } = fixture(t);
  const r = readSourceSnapshot(root);
  assert.deepEqual(Object.keys(r.sources), ['docs/task-board.js', 'src/types.d.ts', 'src/unused.ts']);
  assert.match(r.candidateCommit, /^[a-f0-9]{40}$/);
  assert.match(r.candidateTree, /^[a-f0-9]{40}$/);
  assert.match(r.sources['src/unused.ts'].text, /return 3/);
});
test('changed and untracked source cannot inherit clean-candidate evidence', (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'src/new.js'), 'export const x=1;');
  assert.throws(() => readSourceSnapshot(root));
  rmSync(join(root, 'src/new.js'));
  writeFileSync(join(root, 'src/unused.ts'), 'export const changed=1;');
  assert.throws(() => readSourceSnapshot(root));
});
test('unregistered executable HTML inline source prevents an incomplete denominator', (t) => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, 'apps/other.html'), '<script>globalThis.hidden = 1;</script>');
  git('add', '.');
  git('commit', '-qm', 'new inline source');
  assert.throws(() => readSourceSnapshot(root));
});
test('type-only proof does not mistake runtime imports and re-exports for erased syntax', () => {
  assert.equal(isTypeOnly({ type: 'TSInterfaceDeclaration' }), true);
  assert.equal(
    isTypeOnly({
      type: 'ExportNamedDeclaration',
      exportKind: 'value',
      declaration: { type: 'TSTypeAliasDeclaration' },
    }),
    true,
  );
  assert.equal(isTypeOnly({ type: 'ImportDeclaration', importKind: 'value', specifiers: [] }), false);
  assert.equal(isTypeOnly({ type: 'ExportAllDeclaration', exportKind: 'value' }), false);
  assert.equal(isTypeOnly({ type: 'ExportDefaultDeclaration' }), false);
});
test('hidden index flags cannot make modified configuration inherit a source identity', (t) => {
  const { root, git } = fixture(t);
  for (const flag of ['assume-unchanged', 'skip-worktree']) {
    git('update-index', `--${flag}`, '.gitattributes');
    assert.throws(() => readSourceSnapshot(root), /hidden index flag/);
    git('update-index', `--no-${flag}`, '.gitattributes');
  }
});

for (const [name, html] of [
  [
    'foreign integration cannot pop the scanner into HTML',
    '<svg><g><foreignObject><div></svg></div></foreignObject><script src="data:text/javascript,">globalThis.hidden=1</script>',
  ],
  [
    'SVG description is not an admitted HTML integration point',
    '<svg><desc><div></svg></div></desc><script src="fixture">globalThis.hidden=1</script>',
  ],
  ['foreign breakout requires browser tree recovery', '<svg><g><div></div></g></svg>'],
  [
    'MathML integration is outside the admitted subset',
    '<math><annotation-xml encoding="text/html"><div></math></div></annotation-xml><script src="fixture">globalThis.hidden=1</script>',
  ],
  ['end tag attributes', '<script>globalThis.hidden=1</script\t\n bar>'],
  ['data-src is not src', '<script data-src="fixture">globalThis.hidden=1</script>'],
  ['data-type is not type', '<script data-type="application/json">globalThis.hidden=1</script>'],
  [
    'quoted attribute contains a misleading type',
    '<script data-note=\'type="application/json" >\'>globalThis.hidden=1</script>',
  ],
  [
    'duplicate type attributes',
    '<script type="text/javascript" TYPE="application/json">globalThis.hidden=1</script>',
  ],
  ['duplicate src attributes', '<script src="first" SRC="second">globalThis.hidden=1</script>'],
  [
    'encoded type is not silently classified',
    '<script type="application&#47;json">globalThis.hidden=1</script>',
  ],
  ['script escape state is outside admission', '<script><!--<script>one</script>two</script>'],
  [
    'foreign script src cannot hide inline code',
    '<svg><script src="fixture">globalThis.hidden=1</script></svg>',
  ],
  [
    'raw text in foreign content is not an HTML exclusion',
    '<svg><title><script>globalThis.hidden=1</script></title></svg>',
  ],
  ['malformed comment ending', '<!-- --!><script>globalThis.hidden=1</script>'],
  ['self-closing start does not suppress HTML script', '<script/>globalThis.hidden=1</script>'],
  ['self-closing end tag requires error recovery', '<script>globalThis.hidden=1</script/>'],
  ['scripture is not a script close', '<script>globalThis.hidden=1</scripture>'],
  [
    'raw text may not hide scripts in select context',
    '<select><style><script>globalThis.hidden=1</script></style></select>',
  ],
]) {
  test(`committed HTML cannot hide executable input: ${name}`, (t) => {
    const { root, git } = fixture(t);
    writeFileSync(join(root, 'apps/other.html'), html);
    git('add', '.');
    git('commit', '-qm', 'HTML admission fixture');
    assert.throws(() => readSourceSnapshot(root));
  });
}

test('real attributes and inert quoted or commented text retain their inventory semantics', (t) => {
  const { root, git } = fixture(t);
  writeFileSync(
    join(root, 'apps/other.html'),
    [
      '<div title="<script>quoted text</script>"></div>',
      '<!-- <script>commented text</script> -->',
      '<title>Page title</title><textarea>Ordinary text</textarea>',
      '<SCRIPT SRC="/external.js">external fallback</SCRIPT>',
      '<script type="application/json">{"value":1}</script>',
      "<script type='application/ld+json'>{}</script>",
    ].join('\n'),
  );
  git('add', '.');
  git('commit', '-qm', 'non-executable HTML fixture');
  assert.equal(readSourceSnapshot(root).prototype, null);
});

for (const [name, html] of [
  ['NUL', '<div>\0</div>'],
  ['processing instruction', '<?xml version="1.0"?>'],
  ['CDATA', '<![CDATA[<script>hidden()</script>]]>'],
  ['unterminated declaration', '<!doctype html'],
  ['unclosed comment', '<!-- unfinished'],
  ['abrupt comment close', '<!-->ignored-->'],
  ['nested comment', '<!-- <!-- -->'],
  ['invalid tag name', '</>'],
  ['unseparated attributes', '<div a="x"b="y">'],
  ['invalid attribute name', '<div @name="value">'],
  ['unquoted angle bracket', '<div a=x<y>'],
  ['missing attribute value', '<div a=>'],
  ['unterminated tag', '<div'],
  ['unterminated quoted value', '<div a="unfinished>'],
  ['unclosed foreign content', '<svg><path /></svg><math>'],
  ['foreign boundary mismatch', '<svg></math>'],
  ['plaintext', '<plaintext>unbounded'],
  ['unmatched raw-text end', '</textarea>'],
]) {
  test(`uncertain HTML structure is rejected rather than classified as empty: ${name}`, (t) => {
    const { root, git } = fixture(t);
    writeFileSync(join(root, 'apps/other.html'), html);
    git('add', '.');
    git('commit', '-qm', 'unsupported HTML fixture');
    assert.throws(() => readSourceSnapshot(root), /UNSUPPORTED_HTML_SOURCE/);
  });
}

test('supported HTML delimiters retain external/JSON semantics without consuming quoted fake tags', (t) => {
  const { root, git } = fixture(t);
  writeFileSync(
    join(root, 'apps/other.html'),
    '<!DOCTYPE html>\n<div hidden data-note=fixture title="<script>quoted</script>">1 < 2</div>' +
      '<svg><svg/><path d="M0 0"/></svg>' +
      '<script\tSRC=fixture defer\n>fallback</SCRIPT\f\r >' +
      '<script type=application/json>{}</script><script type=" APPLICATION/LD+JSON ">{}</script>' +
      '<noscript>Enable JavaScript</noscript><style>p{color:red}</style>',
  );
  git('add', '.');
  git('commit', '-qm', 'supported HTML boundaries');
  assert.equal(readSourceSnapshot(root).prototype, null);
});

test('registered prototype counts mixed-case inline blocks and never treats data attributes as exclusions', (t) => {
  const { root, git } = fixture(t);
  mkdirSync(join(root, 'apps/web/prototype'), { recursive: true });
  const path = join(root, 'apps/web/prototype/AlphaForge_v3_EN.html');
  const one =
    '<ScRiPt data-src="fixture" data-type="application/json" data-note="a > b">globalThis.visible=1</sCrIpT>';
  writeFileSync(path, one);
  git('add', '.');
  git('commit', '-qm', 'registered inline source');
  assert.equal(readSourceSnapshot(root).prototype.text, one);
  writeFileSync(path, one + '<SCRIPT>globalThis.second=1</SCRIPT>');
  git('add', '.');
  git('commit', '-qm', 'ambiguous registered source');
  assert.throws(() => readSourceSnapshot(root), /ambiguous/);
});

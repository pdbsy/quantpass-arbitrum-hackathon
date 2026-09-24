import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('importer replaces exact mixed-case ranges and preserves inert attributes and comments', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'af-import-ranges-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const source =
    '<!-- <script>inert</script> --><div title="<style>inert</style>"></div>' +
    '<STYLE>p{color:red}</sTyLe>' +
    '<Script>const answer=42;</sCrIpT>' +
    '<script src="external.js"></script><script type="application/json">{}</script>';
  await importUserUI(source, out);
  assert.equal(await readFile(join(out, 'public/user-ui.css'), 'utf8'), 'p{color:red}');
  assert.equal(await readFile(join(out, 'public/user-ui.js'), 'utf8'), 'const answer=42;');
  assert.equal(
    await readFile(join(out, 'index.html'), 'utf8'),
    '<!-- <script>inert</script> --><div title="<style>inert</style>"></div>' +
      '<link rel="stylesheet" href="/user-ui.css">' +
      '<script src="/user-ui.js"></script>\n<script type="module" src="/src/product-ui.ts"></script>' +
      '<script src="external.js"></script><script type="application/json">{}</script>',
  );
});

test('importer refuses hidden extra scripts and ambiguous boundaries before any writes', async (t) => {
  const { readdir } = await import('node:fs/promises');
  const out = await mkdtemp(join(tmpdir(), 'af-import-admission-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  for (const source of [
    '<style>p{}</style><script>first()</script><SCRIPT>second()</SCRIPT>',
    '<style>p{}</style><script>first()</script\t\n ignored>',
    '<style>p{}</style><script data-src="x">first()</script><script>second()</script>',
    '<style>p{}</style><script type="text/javascript" TYPE="application/json">first()</script>',
    '<style>p{}</style><script><!--<script>first()</script>second()</script>',
    '<style>p{}</style><!-- --!><script>first()</script>',
    '<style>p{}</style><svg><script>first()</script></svg>',
  ]) {
    await assert.rejects(importUserUI(source, out));
    assert.deepEqual(await readdir(out), []);
  }
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
  test(`importer never turns attributed script into a classic script: ${attributes}`, async (t) => {
    const { readdir } = await import('node:fs/promises');
    const out = await mkdtemp(join(tmpdir(), 'af-import-script-mode-'));
    t.after(() => rm(out, { recursive: true, force: true }));
    await assert.rejects(
      importUserUI('<style>p{}</style><script ' + attributes + '>globalThis.visible=1</script>', out),
      /attribute/,
    );
    assert.deepEqual(await readdir(out), []);
  });
}

test('importer does not discard a style media constraint', async (t) => {
  const { readdir } = await import('node:fs/promises');
  const out = await mkdtemp(join(tmpdir(), 'af-import-style-mode-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await assert.rejects(
    importUserUI('<style media="print">p{}</style><script>void 0</script>', out),
    /attribute/,
  );
  assert.deepEqual(await readdir(out), []);
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

test('retained UI history validates a tree-identical master integration without accepting unrelated refs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'af-ui-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'repo');
  const root = resolve(import.meta.dirname, '..');
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_AUTHOR_NAME: 'UI fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'UI fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const execute = (at, args, input) =>
    execFileSync(
      'git',
      ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
      {
        cwd: at,
        env,
        input,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    ).trim();
  execute(directory, ['clone', '--no-hardlinks', '--no-checkout', '--single-branch', root, cwd]);
  const git = (...args) => execute(cwd, args);
  const base = '18f5352070910a867b9729b031aa2e3951785e01';
  const sourceRef = 'refs/remotes/origin/macbeth01/m3-phase1-closeout';
  const masterRef = 'refs/remotes/origin/master';
  const admitted = await verifiedPrototypeArtifacts(root);
  let directSource = true;
  try {
    execute(root, ['merge-base', '--is-ancestor', admitted.repairCommit, 'HEAD']);
  } catch (error) {
    if (error.status !== 1 || error.signal) throw error;
    directSource = false;
  }
  // A real post-integration checkout already has rewritten ancestry. Preserve
  // its admitted source reference instead of mislabelling that master as source.
  const source = execute(root, ['rev-parse', '--verify', directSource ? 'HEAD' : sourceRef]);
  execute(cwd, ['fetch', '--no-tags', root, source]);
  const tree = git('rev-parse', `${source}^{tree}`);
  const master = execute(cwd, ['commit-tree', tree, '-p', base], 'Local squash-shaped fixture only\n');
  git('checkout', '--force', '--detach', master);
  git('update-ref', masterRef, master);
  git('update-ref', sourceRef, source);
  assert.equal(git('status', '--porcelain'), '');
  await t.test('exact retained source and master tree qualify after squash', async () => {
    const artifacts = await verifiedPrototypeArtifacts(cwd);
    assert.equal(Buffer.byteLength(artifacts.original), 285969);
    assert.equal(Buffer.byteLength(artifacts.current), 286508);
    assert.notEqual(artifacts.current, artifacts.original);
  });
  await t.test(
    'an unrelated master change and its feature descendant retain the integration proof',
    async () => {
      const blob = execute(cwd, ['hash-object', '-w', '--stdin'], 'Unrelated fixture content\n');
      git('update-index', '--add', '--cacheinfo', `100644,${blob},integration-fixture.txt`);
      const changedTree = git('write-tree');
      assert.notEqual(changedTree, tree);
      const laterMaster = execute(cwd, ['commit-tree', changedTree, '-p', master], 'Later master fixture\n');
      const feature = execute(
        cwd,
        ['commit-tree', changedTree, '-p', laterMaster],
        'Feature descendant fixture\n',
      );
      git('update-ref', masterRef, laterMaster);
      git('checkout', '--force', '--detach', feature);
      try {
        assert.equal(git('status', '--porcelain'), '');
        const artifacts = await verifiedPrototypeArtifacts(cwd);
        assert.equal(Buffer.byteLength(artifacts.current), 286508);
      } finally {
        git('checkout', '--force', '--detach', master);
        git('update-ref', masterRef, master);
      }
    },
  );
  await t.test('missing master history cannot qualify a squash-shaped local head', async () => {
    git('update-ref', '-d', masterRef);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', masterRef, master);
    }
  });
  await t.test('tree equality on an orphan master cannot bypass the fixed base', async () => {
    const orphan = execute(cwd, ['commit-tree', tree], 'Orphan fixture\n');
    git('checkout', '--force', '--detach', orphan);
    git('update-ref', masterRef, orphan);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('checkout', '--force', '--detach', master);
      git('update-ref', masterRef, master);
    }
  });
  await t.test(
    'an unrelated same-tree parent cannot become a bridge by later merging the fixed base',
    async () => {
      const unrelated = execute(cwd, ['commit-tree', tree], 'Unrelated matching-tree parent\n');
      const blob = execute(cwd, ['hash-object', '-w', '--stdin'], 'Master differs from retained source\n');
      git('update-index', '--add', '--cacheinfo', `100644,${blob},bridge-fixture.txt`);
      const changedTree = git('write-tree');
      const joined = execute(
        cwd,
        ['commit-tree', changedTree, '-p', unrelated, '-p', base],
        'Base joins unrelated first-parent history\n',
      );
      git('checkout', '--force', '--detach', joined);
      git('update-ref', masterRef, joined);
      try {
        git('merge-base', '--is-ancestor', base, joined);
        await assert.rejects(verifiedPrototypeArtifacts(cwd));
      } finally {
        git('checkout', '--force', '--detach', master);
        git('update-ref', masterRef, master);
      }
    },
  );
  await t.test('a non-commit retained ref is rejected', async () => {
    const blob = git('rev-parse', `${source}:apps/web/prototype/AlphaForge_v3_EN.html`);
    git('update-ref', sourceRef, blob);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', sourceRef, source);
    }
  });
  await t.test('a matching source tree does not qualify an unrelated local head', async () => {
    git('update-ref', masterRef, base);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', masterRef, master);
    }
  });
  await t.test('a retained source with a different tree is rejected', async () => {
    const wrong = execute(
      cwd,
      ['commit-tree', `${base}^{tree}`, '-p', source],
      'Different source tree fixture\n',
    );
    git('update-ref', sourceRef, wrong);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', sourceRef, source);
    }
  });
  await t.test('a tree-identical source lacking the original ancestors is rejected', async () => {
    git('update-ref', sourceRef, master);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', sourceRef, source);
    }
  });
  await t.test('missing retained source cannot qualify master', async () => {
    git('update-ref', '-d', sourceRef);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', sourceRef, source);
    }
  });
  await t.test('direct source ancestry does not require integration compatibility refs', async () => {
    git('checkout', '--force', '--detach', source);
    git('update-ref', '-d', sourceRef);
    git('update-ref', '-d', masterRef);
    const artifacts = await verifiedPrototypeArtifacts(cwd);
    assert.equal(Buffer.byteLength(artifacts.current), 286508);
  });
  assert.equal(git('status', '--porcelain'), '');
});

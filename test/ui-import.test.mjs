import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  // This fixture exercises the retained repair, independently of later wallet
  // or maintenance bytes at the current repository HEAD.
  const source = execute(root, ['rev-parse', '--verify', sourceRef]);
  const sourceArtifact = execFileSync(
    'git',
    ['--no-replace-objects', 'show', `${source}:apps/web/prototype/AlphaForge_v3_EN.html`],
    { cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
  );
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
    assert.equal(artifacts.current, sourceArtifact);
    assert.equal(artifacts.currentSha256, admitted.repairedSha256);
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
        assert.equal(artifacts.current, sourceArtifact);
        assert.equal(artifacts.currentSha256, admitted.repairedSha256);
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
    assert.equal(artifacts.current, sourceArtifact);
    assert.equal(artifacts.currentSha256, admitted.repairedSha256);
  });
  assert.equal(git('status', '--porcelain'), '');
});

test('wallet UI revisions retain an exact source bridge after protected squash merge', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'af-wallet-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = resolve(import.meta.dirname, '..');
  const cwd = join(directory, 'repo');
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
      { cwd: at, env, input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
    ).trim();
  const git = (...args) => execute(cwd, args);
  const base = '05a7e16be347ea56bfa51ced4d5277cfdd55058c';
  const sourceRef = 'refs/remotes/origin/macbeth01/account-wallet-eth';
  const oldSourceRef = 'refs/remotes/origin/macbeth01/m3-phase1-closeout';
  const masterRef = 'refs/remotes/origin/master';
  const admitted = await verifiedPrototypeArtifacts(root);
  const source = execute(root, ['rev-parse', '--verify', sourceRef]);
  const sourceArtifact = execFileSync(
    'git',
    ['--no-replace-objects', 'show', `${source}:apps/web/prototype/AlphaForge_v3_EN.html`],
    { cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const oldSource = execute(root, ['rev-parse', '--verify', oldSourceRef]);
  execute(directory, ['clone', '--no-hardlinks', '--no-checkout', '--single-branch', root, cwd]);
  git('fetch', '--no-tags', root, source, oldSource);
  git('update-ref', sourceRef, source);
  git('update-ref', oldSourceRef, oldSource);
  const tree = git('rev-parse', `${source}^{tree}`);
  const master = execute(cwd, ['commit-tree', tree, '-p', base], 'Wallet squash fixture only\n');
  git('checkout', '--force', '--detach', master);
  git('update-ref', masterRef, master);
  await t.test('exact source bytes and complete tree qualify after squash', async () => {
    const result = await verifiedPrototypeArtifacts(cwd);
    assert.equal(result.current, sourceArtifact);
    assert.equal(result.currentSha256, admitted.usdcSha256);
  });
  await t.test('missing retained wallet source fails closed', async () => {
    git('update-ref', '-d', sourceRef);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', sourceRef, source);
    }
  });
  await t.test('matching source bytes without the exact whole tree are insufficient', async () => {
    const blob = execute(cwd, ['hash-object', '-w', '--stdin'], 'Unrelated source tree\n');
    git('update-index', '--add', '--cacheinfo', `100644,${blob},source-extra.txt`);
    const wrongTree = git('write-tree');
    const wrongSource = execute(cwd, ['commit-tree', wrongTree, '-p', source], 'Wrong source tree fixture\n');
    git('update-ref', sourceRef, wrongSource);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', sourceRef, source);
      git('reset', '--hard', master);
    }
  });
  await t.test('a same-tree source without the retained revision ancestors is rejected', async () => {
    git('update-ref', sourceRef, master);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', sourceRef, source);
    }
  });
  await t.test('an unrelated same-tree head cannot borrow master integration evidence', async () => {
    const orphan = execute(cwd, ['commit-tree', tree], 'Unrelated wallet fixture\n');
    git('checkout', '--force', '--detach', orphan);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('checkout', '--force', '--detach', master);
    }
  });
  assert.equal(git('status', '--porcelain'), '');
});

test('Mock Pass maintenance preserves its real source and the prior wallet integration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'af-mock-pass-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = resolve(import.meta.dirname, '..');
  const cwd = join(directory, 'repo');
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
      { cwd: at, env, input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
    ).trim();
  const git = (...args) => execute(cwd, args);
  const admitted = await verifiedPrototypeArtifacts(root);
  const sourceRef = 'refs/remotes/origin/macbeth01/account-wallet-eth';
  const oldSourceRef = 'refs/remotes/origin/macbeth01/m3-phase1-closeout';
  const masterRef = 'refs/remotes/origin/master';
  const refs = [sourceRef, oldSourceRef, masterRef].map((ref) => [
    ref,
    execute(root, ['rev-parse', '--verify', ref]),
  ]);
  execute(directory, ['clone', '--no-hardlinks', '--no-checkout', '--single-branch', root, cwd]);
  git('fetch', '--no-tags', root, admitted.mockHoldingsCommit, ...refs.map(([, sha]) => sha));
  for (const [ref, sha] of refs) git('update-ref', ref, sha);
  git('checkout', '--force', '--detach', admitted.mockHoldingsCommit);
  const prototypePath = join(cwd, 'apps/web/prototype/AlphaForge_v3_EN.html');
  const sourceArtifact = await readFile(prototypePath, 'utf8');
  await t.test('committed maintenance bytes qualify with their retained history', async () => {
    const result = await verifiedPrototypeArtifacts(cwd);
    assert.equal(result.current, sourceArtifact);
    assert.equal(result.currentSha256, admitted.mockHoldingsSha256);
    assert.notEqual(result.currentSha256, admitted.usdcSha256);
  });
  await t.test('direct maintenance ancestry still requires the old wallet source bridge', async () => {
    const [, source] = refs.find(([ref]) => ref === sourceRef);
    git('update-ref', '-d', sourceRef);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd));
    } finally {
      git('update-ref', sourceRef, source);
    }
  });
  await t.test('same maintenance bytes on an unrelated tree do not qualify', async () => {
    const orphan = execute(
      cwd,
      ['commit-tree', `${admitted.mockHoldingsCommit}^{tree}`],
      'Unrelated Mock Pass fixture\n',
    );
    git('checkout', '--force', '--detach', orphan);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd), /actual maintenance source ancestry/);
    } finally {
      git('checkout', '--force', '--detach', admitted.mockHoldingsCommit);
    }
  });
  await t.test('an unrecorded prototype edit is rejected', async () => {
    await writeFile(
      prototypePath,
      sourceArtifact.replace('<script>', '<script>\n// Unrecorded fixture edit\n'),
    );
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd), /only exact recorded artifact revisions/);
    } finally {
      await writeFile(prototypePath, sourceArtifact);
    }
  });
  await t.test('a maintenance descendant cannot roll back to the prior wallet bytes', async () => {
    const previous = execFileSync(
      'git',
      [
        '--no-replace-objects',
        'show',
        `${admitted.maintenanceBaseCommit}:apps/web/prototype/AlphaForge_v3_EN.html`,
      ],
      { cwd, env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    await writeFile(prototypePath, previous);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd), /must not roll back/);
    } finally {
      await writeFile(prototypePath, sourceArtifact);
    }
  });
  assert.equal(git('status', '--porcelain'), '');
});

test('native market admission binds reviewed bytes to their real source history', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'af-native-market-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = resolve(import.meta.dirname, '..');
  const cwd = join(directory, 'repo');
  const admitted = await verifiedPrototypeArtifacts(root);
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
      { cwd: at, env, input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
    ).trim();
  const git = (...args) => execute(cwd, args);
  execute(directory, ['clone', '--no-hardlinks', '--no-checkout', '--single-branch', root, cwd]);
  for (const ref of [
    'refs/remotes/origin/macbeth01/account-wallet-eth',
    'refs/remotes/origin/macbeth01/m3-phase1-closeout',
    'refs/remotes/origin/master',
  ]) {
    const source = execute(root, ['rev-parse', '--verify', ref]);
    git('fetch', '--no-tags', root, source);
    git('update-ref', ref, source);
  }
  git('checkout', '--force', '--detach', admitted.nativeMarketCommit);
  const prototypePath = join(cwd, 'apps/web/prototype/AlphaForge_v3_EN.html');
  const sourceArtifact = await readFile(prototypePath, 'utf8');
  await t.test('exact reviewed native source qualifies without changing historical identities', async () => {
    const result = await verifiedPrototypeArtifacts(cwd);
    assert.equal(result.current, sourceArtifact);
    assert.equal(result.currentSha256, admitted.nativeMarketSha256);
    assert.notEqual(result.currentSha256, admitted.mockHoldingsSha256);
    assert.equal(git('rev-parse', `${result.nativeMarketCommit}^`), result.nativeMarketParentCommit);
  });
  await t.test('an unrecorded HTML change cannot borrow the native boundary admission', async () => {
    await writeFile(prototypePath, sourceArtifact.replace('<title>', '<!-- Unreviewed edit --><title>'));
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd), /only exact recorded artifact revisions/);
    } finally {
      await writeFile(prototypePath, sourceArtifact);
    }
  });
  await t.test('same native bytes on an unrelated tree cannot borrow source ancestry', async () => {
    const orphan = execute(
      cwd,
      ['commit-tree', `${admitted.nativeMarketCommit}^{tree}`],
      'Unrelated native market fixture\n',
    );
    git('checkout', '--force', '--detach', orphan);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd), /actual reviewed source ancestry/);
    } finally {
      git('checkout', '--force', '--detach', admitted.nativeMarketCommit);
    }
  });
  await t.test('a native descendant cannot roll back to historical mock market bytes', async () => {
    const previous = execFileSync(
      'git',
      [
        '--no-replace-objects',
        'show',
        `${admitted.mockHoldingsCommit}:apps/web/prototype/AlphaForge_v3_EN.html`,
      ],
      { cwd, env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    await writeFile(prototypePath, previous);
    try {
      await assert.rejects(verifiedPrototypeArtifacts(cwd), /must not roll back/);
    } finally {
      await writeFile(prototypePath, sourceArtifact);
    }
  });
  assert.equal(git('status', '--porcelain'), '');
});

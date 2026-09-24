import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gitIdentity } from '../tools/environment/observe.mjs';
import { fixtureExec } from './helpers/git-fixture.mjs';

test('public Git identity rejects real SHA-256 object IDs before branch and ancestry probes', (t) => {
  // Detects removal of the SHA-1 identity boundary or continuing to later
  // Git probes after an unsupported object format has already been observed.
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-environment-public-entry-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  // Establish LF rules before any fixture content can be staged.
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  const git = (...args) =>
    fixtureExec('git', ['--no-replace-objects', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    }).trim();
  try {
    git('init', '--quiet', '--object-format=sha256', '-b', 'fixture');
  } catch (error) {
    const diagnostic = String(error.stderr ?? '');
    if (/unknown hash algorithm ['"]?sha256|unknown option [`'"]?object-format/i.test(diagnostic)) {
      t.skip('NOT_RUN: installed Git does not support SHA-256 fixture repositories');
      return;
    }
    throw error;
  }
  writeFileSync(join(root, 'source.txt'), 'AlphaForge isolated identity fixture\n');
  git('add', '.gitattributes', 'source.txt');
  git('commit', '--quiet', '-m', 'Create isolated identity fixture');
  const head = git('rev-parse', '--verify', 'HEAD');
  const tree = git('rev-parse', '--verify', 'HEAD^{tree}');
  git('update-ref', 'refs/remotes/origin/master', head);
  const base = git('rev-parse', '--verify', 'refs/remotes/origin/master^{commit}');
  assert.equal(git('rev-parse', '--show-object-format'), 'sha256');
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
  for (const objectId of [head, tree, base]) assert.match(objectId, /^[a-f0-9]{64}$/);
  assert.equal(git('show', 'HEAD:.gitattributes'), '* text=auto eol=lf');
  assert.equal(readFileSync(join(root, 'source.txt'), 'utf8'), 'AlphaForge isolated identity fixture\n');
  const probes = [];
  const identity = gitIdentity((args) => {
    // Observe calls without replacing their real Git results, even unexpected calls.
    probes.push([...args]);
    return git(...args);
  }, {});
  assert.deepEqual(identity, {
    head,
    tree,
    base,
    sourceHead: head,
    sourceTree: tree,
    context: 'local',
    historyValid: false,
  });
  assert.deepEqual(probes, [
    ['rev-parse', '--verify', 'HEAD'],
    ['rev-parse', '--verify', 'HEAD^{tree}'],
    ['rev-parse', '--verify', 'refs/remotes/origin/master^{commit}'],
    ['rev-parse', '--is-shallow-repository'],
  ]);
  assert.equal(git('status', '--porcelain'), '');
  t.diagnostic(JSON.stringify({ objectFormat: 'sha256', head, tree, base, probes: probes.length }));
});

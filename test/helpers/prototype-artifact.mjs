import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = 'apps/web/prototype/AlphaForge_v3_EN.html';
const originalCommit = 'ebf8df18647f72afd7dafadf80638ed2f4c7a44b';
const previousRepairCommit = '7f66f0bf37b35f102cce00861dc55714ac9f2411';
const repairCommit = '3e0e4303dc6d6621aa71b450752e2446faec759b';
const originalSha256 = '949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45';
const previousRepairedSha256 = '499c1bda91a8637a9d9fc12547790236947d2d19151173b3d4865f891ef52161';
const repairedSha256 = 'b9671bca14a388d08a7e5db492f831c5e02fcb15f8ff57baab8a65e863d4ff35';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Keep the original artifact in the complete, immutable Git history. The current
// file is bound to the reviewed repair; absence of either object fails closed.
export async function verifiedPrototypeArtifacts(root) {
  const git = (...args) =>
    execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
  assert.equal(git('rev-parse', '--is-shallow-repository').trim(), 'false');
  const original = git('show', `${originalCommit}:${path}`);
  const previousRepair = git('show', `${previousRepairCommit}:${path}`);
  const repaired = git('show', `${repairCommit}:${path}`);
  assert.equal(Buffer.byteLength(original), 285969);
  assert.equal(digest(original), originalSha256, 'original artifact must remain exact');
  assert.equal(Buffer.byteLength(previousRepair), 286242);
  assert.equal(digest(previousRepair), previousRepairedSha256, 'previous reviewed repair must remain exact');
  assert.equal(Buffer.byteLength(repaired), 286508);
  assert.equal(digest(repaired), repairedSha256, 'reviewed repair must remain exact');
  const current = await readFile(resolve(root, path), 'utf8');
  assert.equal(digest(current), repairedSha256, 'current artifact must match the reviewed repair');
  assert.equal(current, repaired);
  const commit = (ref) => {
    const sha = git('rev-parse', '--verify', ref).trim();
    assert.match(sha, /^[a-f0-9]{40}$/);
    assert.equal(git('cat-file', '-t', sha).trim(), 'commit');
    return sha;
  };
  const ancestor = (before, after) => {
    try {
      git('merge-base', '--is-ancestor', before, after);
      return true;
    } catch (error) {
      if (error.status === 1 && !error.signal) return false;
      throw error;
    }
  };
  const head = commit('HEAD');
  assert.ok(ancestor(originalCommit, previousRepairCommit), 'original must precede the first repair');
  assert.ok(ancestor(previousRepairCommit, repairCommit), 'reviewed repairs must retain their exact chain');
  if (
    !ancestor(originalCommit, head) ||
    !ancestor(previousRepairCommit, head) ||
    !ancestor(repairCommit, head)
  ) {
    // A squash/rebase preserves the reviewed source branch but changes ancestry.
    // Require an exact whole-tree integration bridge on actual master history;
    // matching only this HTML, or merely possessing the old objects, is not enough.
    const master = commit('refs/remotes/origin/master');
    const retained = commit('refs/remotes/origin/macbeth01/m3-phase1-closeout');
    const base = '18f5352070910a867b9729b031aa2e3951785e01';
    for (const [before, after] of [
      [base, master],
      [base, retained],
      [originalCommit, retained],
      [previousRepairCommit, retained],
      [repairCommit, retained],
    ])
      assert.ok(ancestor(before, after), 'retained source and master must preserve their fixed history');
    const sourceTree = git('rev-parse', `${retained}^{tree}`).trim();
    const rows = git('log', '--first-parent', '--max-count=4096', '--format=%H %T', `${base}..${master}`)
      .trim()
      .split('\n')
      .filter(Boolean);
    const bridges = rows
      .map((row) => {
        assert.match(row, /^[a-f0-9]{40} [a-f0-9]{40}$/);
        const [sha, tree] = row.split(' ');
        return { sha, tree };
      })
      .filter(({ tree }) => tree === sourceTree);
    assert.ok(
      bridges.some(({ sha }) => ancestor(base, sha) && ancestor(sha, head)),
      'candidate must descend from the exact retained-source integration tree on master',
    );
  }

  // Exact fixed-hash artifacts only, not an arbitrary HTML sanitizer. Keep this
  // oracle independent from the production HTML extractor under test.
  const block = (source, tag) => {
    const opening = '<' + tag + '>';
    const closing = '</' + tag + '>';
    const start = source.indexOf(opening);
    const end = source.indexOf(closing, start + opening.length);
    assert.ok(start >= 0 && end > start, 'fixed literal block is required');
    assert.equal(source.indexOf(opening, start + opening.length), -1, 'one fixed opening tag');
    assert.equal(source.indexOf(closing, end + closing.length), -1, 'one fixed closing tag');
    return { start, end, content: source.slice(start, end + closing.length) };
  };
  const blocks = (source) => {
    const script = block(source, 'script');
    return {
      style: block(source, 'style').content,
      outsideScript: source.slice(0, script.start + '<script>'.length) + source.slice(script.end),
    };
  };
  const before = blocks(original);
  const prior = blocks(previousRepair);
  assert.equal(prior.style, before.style, 'prior repair CSS remains byte-identical');
  assert.equal(prior.outsideScript, before.outsideScript, 'prior script boundary remains exact');
  const after = blocks(current);
  assert.equal(after.style, before.style, 'the original CSS remains byte-identical');
  assert.equal(after.outsideScript, before.outsideScript, 'HTML outside the repaired script remains exact');
  return {
    original,
    current,
    originalCommit,
    previousRepairCommit,
    repairCommit,
    originalSha256,
    previousRepairedSha256,
    repairedSha256,
  };
}

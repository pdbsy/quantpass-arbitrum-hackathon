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
const currencyCommit = 'c6494f081f4a04839dd3f4ec1d74e5d219d07e79';
const currencySha256 = '03941534370f22cf858fba1aa1bd999d93f9ef4a283279cb0a806eede8bc0ad7';
const tradeCommit = '094b780d71629ac18f5e7f74967f3ab496cbb8e2';
const tradeSha256 = 'b6f9ab6cd85ece3ee8db293982989293c8bb3c16dcf0c713eafb93bf02eade22';
const fundingCommit = 'a6bee70e7ef0c4cdfed373a898b92309a977e94f';
const fundingSha256 = 'a1b637d33bf78a549a0cee1691a32ab5c2bb778ae4593145a4c850600452a639';
const usdcCommit = 'd820d2bc1a13329a79a46a9aae55a2e4e794a213';
const usdcSha256 = 'abd0d7671d4af239c3e33cafebd3084e16372c7865681ad1e47c57eccd2c2b80';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Keep the original artifact in the complete, immutable Git history. The current
// file is bound to an exact recorded revision; historical repair fixtures remain
// independently verifiable. New display bytes require their real source commit.
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
  const currentSha256 = digest(current);
  const recorded = [
    { commit: currencyCommit, hash: currencySha256, bytes: 286457 },
    { commit: tradeCommit, hash: tradeSha256, bytes: 286498 },
    { commit: fundingCommit, hash: fundingSha256, bytes: 290335 },
    { commit: usdcCommit, hash: usdcSha256, bytes: 292005 },
  ];
  const selected = recorded.find((revision) => revision.hash === currentSha256);
  for (const revision of recorded) {
    const content = git('show', `${revision.commit}:${path}`);
    assert.equal(Buffer.byteLength(content), revision.bytes);
    assert.equal(digest(content), revision.hash, 'recorded source revision must remain exact');
    if (revision === selected) assert.equal(current, content);
  }
  if (!selected) {
    assert.equal(currentSha256, repairedSha256, 'only exact recorded artifact revisions are admitted');
    assert.equal(current, repaired);
  }
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
  const required = [...recorded].reverse().find((revision) => ancestor(revision.commit, head));
  if (required)
    assert.equal(currentSha256, required.hash, 'a later candidate must not roll back the recorded revision');
  for (let i = 1; i < recorded.length; i++)
    assert.ok(
      ancestor(recorded[i - 1].commit, recorded[i].commit),
      'revisions must preserve prior source history',
    );
  if (selected && !ancestor(selected.commit, head)) {
    // Protected master uses squash merges. Keep the original source branch and
    // require its complete tree to occur on master, not just matching UI bytes.
    const base = '05a7e16be347ea56bfa51ced4d5277cfdd55058c';
    const master = commit('refs/remotes/origin/master');
    const source = commit('refs/remotes/origin/macbeth01/account-wallet-eth');
    for (const [before, after] of [
      [base, source],
      [base, master],
      [usdcCommit, source],
    ])
      assert.ok(ancestor(before, after), 'wallet integration must retain its exact source ancestry');
    assert.equal(currentSha256, usdcSha256, 'integrated wallet cannot roll back its final source');
    const tree = git('rev-parse', `${source}^{tree}`).trim();
    const bridges = git('log', '--first-parent', '--max-count=4096', '--format=%H %T', `${base}..${master}`)
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((row) => {
        assert.match(row, /^[a-f0-9]{40} [a-f0-9]{40}$/);
        const [sha, sourceTree] = row.split(' ');
        return { sha, sourceTree };
      });
    assert.ok(
      bridges.some(
        ({ sha, sourceTree }) => sourceTree === tree && ancestor(base, sha) && ancestor(sha, head),
      ),
      'wallet source must have an exact whole-tree integration on master',
    );
  }
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
    currencyCommit,
    currencySha256,
    tradeCommit,
    tradeSha256,
    fundingCommit,
    fundingSha256,
    usdcCommit,
    usdcSha256,
    currentSha256,
  };
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = 'apps/web/prototype/AlphaForge_v3_EN.html';
const originalCommit = 'ebf8df18647f72afd7dafadf80638ed2f4c7a44b';
const repairCommit = '7f66f0bf37b35f102cce00861dc55714ac9f2411';
const originalSha256 = '949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45';
const repairedSha256 = '499c1bda91a8637a9d9fc12547790236947d2d19151173b3d4865f891ef52161';
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
  const repaired = git('show', `${repairCommit}:${path}`);
  assert.equal(Buffer.byteLength(original), 285969);
  assert.equal(digest(original), originalSha256, 'original artifact must remain exact');
  assert.equal(Buffer.byteLength(repaired), 286242);
  assert.equal(digest(repaired), repairedSha256, 'reviewed repair must remain exact');
  const current = await readFile(resolve(root, path), 'utf8');
  assert.equal(digest(current), repairedSha256, 'current artifact must match the reviewed repair');
  assert.equal(current, repaired);
  git('merge-base', '--is-ancestor', originalCommit, 'HEAD');
  git('merge-base', '--is-ancestor', repairCommit, 'HEAD');

  const blocks = (source) => {
    const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
    const styles = [...source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)];
    assert.equal(scripts.length, 1, 'exactly one original inline script is admitted');
    assert.equal(styles.length, 1, 'exactly one original inline style is admitted');
    assert.equal(scripts[0][1], '', 'script attributes must remain unchanged');
    assert.equal(styles[0][1], '', 'style attributes must remain unchanged');
    assert.ok(scripts[0][0].startsWith('<script>') && scripts[0][0].endsWith('</script>'));
    return {
      style: styles[0][0],
      outsideScript:
        source.slice(0, scripts[0].index + '<script>'.length) +
        source.slice(scripts[0].index + scripts[0][0].length - '</script>'.length),
    };
  };
  const before = blocks(original);
  const after = blocks(current);
  assert.equal(after.style, before.style, 'the original CSS remains byte-identical');
  assert.equal(after.outsideScript, before.outsideScript, 'HTML outside the repaired script remains exact');
  return { original, current, originalCommit, repairCommit, originalSha256, repairedSha256 };
}

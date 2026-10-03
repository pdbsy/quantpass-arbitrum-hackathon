import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function summarizeTap(bytes, exitCode) {
  const totals = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...bytes.matchAll(new RegExp(`^# ${key} ([0-9]+)$`, 'gm'))];
    totals[key] = matches.length === 1 ? Number(matches[0][1]) : null;
  }
  const complete = Object.values(totals).every((n) => Number.isSafeInteger(n) && n >= 0);
  return {
    ...totals,
    eligible:
      exitCode === 0 &&
      complete &&
      totals.tests > 0 &&
      totals.pass === totals.tests &&
      totals.fail === 0 &&
      totals.cancelled === 0 &&
      totals.skipped === 0 &&
      totals.todo === 0,
  };
}
export function acceptanceState({ sourceEligible, sourceUnchanged, browserRun, phases }) {
  if (!sourceUnchanged || !phases.length || phases.some((p) => p.exitCode !== 0 || !p.eligible))
    return 'FAIL';
  if (!sourceEligible) return 'DIAGNOSTIC_ONLY';
  if (!browserRun) return 'NOT_RUN_BROWSER';
  return 'PASS';
}
export function sourceIdentity(root) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return {
    head: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    branch: git(['branch', '--show-current']),
    fullHistory: git(['rev-parse', '--is-shallow-repository']) === 'false',
    dirty: git(['status', '--porcelain']).length > 0,
    lockSha256: digest(readFileSync(join(root, 'package-lock.json'))),
    node: process.versions.node,
    npm: execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim(),
    platform: process.platform,
    arch: process.arch,
  };
}
export function fileRecords(directory, root = directory) {
  const records = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('MOCK_EVIDENCE_SYMLINK');
    if (stat.isDirectory()) records.push(...fileRecords(path, root));
    else if (stat.isFile())
      records.push({ path: relative(root, path), bytes: stat.size, sha256: digest(readFileSync(path)) });
  }
  return records;
}

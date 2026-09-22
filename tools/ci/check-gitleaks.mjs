import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { root, git, inspect, assertUnchanged, run, emit, main, cleanEnvironment } from './context.mjs';
import { installScanner } from '../security/bootstrap.mjs';
import { classifyGitleaks, decodeReport } from '../security/results.mjs';
import { adjudicateGitleaksHistory, readGitleaksExceptionProof } from '../security/gitleaks-disposition.mjs';
import { stageSources } from '../security/staging.mjs';

function gitIn(cwd, args) {
  const result = run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: {
      ...cleanEnvironment(),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  if (result.status !== 0 || result.error || result.signal)
    throw new Error('Gitleaks Git history prerequisite failed');
  return result.stdout.trim();
}

export function historyCoverage(cwd) {
  if (gitIn(cwd, ['rev-parse', '--is-shallow-repository']) !== 'false')
    throw new Error('Gitleaks requires complete non-shallow history');
  gitIn(cwd, ['fsck', '--connectivity-only', '--no-dangling']);
  const refs = gitIn(cwd, ['for-each-ref', '--format=%(refname) %(objectname)'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, sha, ...extra] = line.split(' ');
      if (extra.length || !name.startsWith('refs/') || !/^[a-f0-9]{40}$/.test(sha))
        throw new Error('Invalid Git reference coverage');
      return { name, sha };
    });
  const commits = Number(gitIn(cwd, ['rev-list', '--all', 'HEAD', '--count']));
  if (!refs.length || !Number.isSafeInteger(commits) || commits < 1)
    throw new Error('Empty Git history coverage');
  return { refs, commits, refsSha256: createHash('sha256').update(JSON.stringify(refs)).digest('hex') };
}

export function assertNoSourceIgnore(target) {
  // Gitleaks 8.30.1 reads source/.gitleaksignore in addition to the explicit
  // --gitleaks-ignore-path. The approved history disposition is applied only
  // after complete, unsuppressed scanning; source-controlled ignores cannot apply.
  try {
    lstatSync(join(target, '.gitleaksignore'));
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw new Error('Gitleaks source ignore path could not be verified', { cause: error });
  }
  throw new Error('Gitleaks source ignore files are not permitted');
}

function scan(tool, mode, target, reportName) {
  assertNoSourceIgnore(target);
  const path = join(tool.directory, reportName);
  const args = [
    mode,
    '--config',
    join(tool.directory, 'gitleaks.toml'),
    '--gitleaks-ignore-path',
    join(tool.directory, 'empty-ignore'),
    '--ignore-gitleaks-allow',
    '--redact=100',
    '--exit-code=10',
    '--report-format=json',
    `--report-path=${path}`,
    '--log-level=error',
    '--no-banner',
    '--timeout=300',
    '--max-archive-depth=2',
    '--max-decode-depth=5',
  ];
  if (mode === 'git') args.push('--log-opts=--all HEAD --full-history --root -m');
  args.push(target);
  const result = run(tool.binary, args, { cwd: tool.directory, env: tool.env, timeout: 330000 });
  assertNoSourceIgnore(target);
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    /* absent report is BLOCKED */
  }
  const scanValue = { ...result, report: decodeReport(text) };
  return { classification: classifyGitleaks(scanValue), text, scanValue };
}

export function verifySecretCanary(tool) {
  const cwd = join(tool.directory, 'canary');
  mkdirSync(cwd);
  const invoke = (...args) =>
    gitIn(cwd, ['-c', 'user.name=Scanner Fixture', '-c', 'user.email=fixture@example.test', ...args]);
  invoke('init', '-b', 'main');
  writeFileSync(join(cwd, '.gitattributes'), '* text=auto eol=lf\n');
  const canary = [
    'ghp',
    '_',
    createHash('sha256')
      .update('AlphaForge public synthetic scanner fixture, never an issued credential')
      .digest('hex')
      .slice(0, 36),
  ].join('');
  writeFileSync(join(cwd, 'deleted.txt'), `credential = "${canary}"\n`);
  invoke('add', '.');
  invoke('commit', '-m', 'synthetic root canary');
  invoke('tag', 'root-canary');
  unlinkSync(join(cwd, 'deleted.txt'));
  invoke('add', '-u');
  invoke('commit', '-m', 'delete synthetic canary');
  invoke('switch', '-c', 'side');
  writeFileSync(join(cwd, 'side.txt'), `credential = "${canary}"\n`);
  invoke('add', '.');
  invoke('commit', '-m', 'side canary');
  invoke('switch', 'main');
  writeFileSync(join(cwd, 'main.txt'), 'safe\n');
  invoke('add', '.');
  invoke('commit', '-m', 'main');
  invoke('merge', '--no-ff', '--no-commit', 'side');
  writeFileSync(join(cwd, 'merge-only.txt'), `credential = "${canary}"\n`);
  invoke('add', '.');
  invoke('commit', '-m', 'merge-only canary');
  invoke('switch', '-c', 'tag-only');
  writeFileSync(join(cwd, 'tag-only.txt'), `credential = "${canary}"\n`);
  invoke('add', '.');
  invoke('commit', '-m', 'tag-only canary');
  invoke('tag', 'only-tag');
  invoke('switch', 'main');
  invoke('branch', '-D', 'tag-only');
  const scanResult = scan(tool, 'git', cwd, 'canary-history.json');
  if (
    scanResult.classification.state !== 'FAIL' ||
    scanResult.text.includes(canary) ||
    !scanResult.classification.findings.some((x) => x.file === 'deleted.txt') ||
    !['side.txt', 'merge-only.txt', 'tag-only.txt'].every((file) =>
      scanResult.classification.findings.some((x) => x.file === file),
    )
  )
    throw new Error('Gitleaks history/redaction canary failed');
  const current = scan(tool, 'dir', cwd, 'canary-tree.json');
  if (current.classification.state !== 'FAIL' || current.text.includes(canary))
    throw new Error('Gitleaks current-file/redaction canary failed');
  return { canary: 'PASS', rootDeletedSideTagMerge: true, redaction: 'PASS' };
}

await main(import.meta.url, async () => {
  const before = inspect();
  assertUnchanged(before, before);
  const history = historyCoverage(root);
  if (!history.refs.some((x) => x.name === 'refs/remotes/origin/master'))
    throw new Error('Fetched master ref required for history coverage');
  const tool = await installScanner('gitleaks');
  try {
    writeFileSync(join(tool.directory, 'gitleaks.toml'), '[extend]\nuseDefault = true\n');
    writeFileSync(join(tool.directory, 'empty-ignore'), '');
    const canary = verifySecretCanary(tool);
    const historyScan = scan(tool, 'git', root, 'history.json');
    const historyResult = historyScan.classification;
    const historyDisposition = adjudicateGitleaksHistory(
      historyScan.scanValue,
      historyResult.state === 'FAIL' ? readGitleaksExceptionProof(root) : null,
    );
    const source = join(tool.directory, 'source');
    mkdirSync(source);
    const coverage = stageSources(root, source, git('ls-files', '-z').split('\0').filter(Boolean));
    const filesResult = scan(tool, 'dir', source, 'files.json').classification;
    const after = historyCoverage(root);
    if (JSON.stringify(history) !== JSON.stringify(after))
      throw new Error('History refs changed during Gitleaks scan');
    assertUnchanged(before, inspect());
    const state = [historyDisposition.state, filesResult.state].includes('BLOCKED')
      ? 'BLOCKED'
      : [historyDisposition.state, filesResult.state].includes('FAIL')
        ? 'FAIL'
        : 'PASS';
    emit({
      gate: 'gitleaks',
      ...before,
      state,
      version: tool.version,
      scannerLockSha256: tool.lockSha256,
      ...canary,
      ...coverage,
      commits: history.commits,
      refs: history.refs,
      refsSha256: history.refsSha256,
      history: historyResult,
      historyDisposition,
      historyReportSha256: createHash('sha256').update(historyScan.text).digest('hex'),
      historyScannerExit: historyScan.scanValue.status,
      currentFiles: filesResult,
      boundary:
        'Pinned CLI default detectors on all locally fetched refs plus HEAD and tracked current files. No remote credential validity check; no coverage of unavailable/deleted remote refs or untracked personal files.',
    });
  } finally {
    tool.cleanup();
  }
});

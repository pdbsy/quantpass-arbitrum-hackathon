import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, opendir, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { parseTaskRecord, parseWorkerLog } from './markdown.mjs';
import { redactValue } from './redact.mjs';

const execFileAsync = promisify(execFile);
const maximumSourceBytes = 1024 * 1024;
const maximumSourceEntries = 256;
const maximumSourceFiles = 128;
const maximumAggregateSourceBytes = 4 * 1024 * 1024;
const maximumGitOutputBytes = 1024 * 1024;
const maximumRestrictedDescendantCommits = 16;
const gitCommitPattern = /^[0-9a-f]{40}$/;
const generatedSnapshotClosurePaths = Object.freeze([
  'docs/management/dashboard/data/build-log.json',
  'docs/management/dashboard/data/dashboard.json',
]);
const managementReportClosurePaths = Object.freeze(['.checks/management/latest.json']);
const githubIdentityKeys = Object.freeze([
  'GITHUB_ACTIONS',
  'GITHUB_EVENT_NAME',
  'GITHUB_REF',
  'GITHUB_SHA',
  'GITHUB_BASE_REF',
  'GITHUB_HEAD_REF',
]);

class SourceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function contained(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function available(source, observedAt, data) {
  return { status: 'READY', source, observedAt, data: redactValue(data) };
}

function unavailable(source, observedAt) {
  return { status: 'NOT_AVAILABLE', source, observedAt };
}

function sourceFailure(source, observedAt, error) {
  return {
    status: 'DATA_SOURCE_ERROR',
    source,
    observedAt,
    error: error instanceof SourceError ? error.code : 'READ_FAILED',
  };
}

function createSourceBudget() {
  return { entries: 0, files: 0, bytes: 0 };
}

function consumeEntryBudget(budget) {
  if (budget.entries >= maximumSourceEntries) throw new SourceError('SOURCE_ENTRY_BUDGET_EXCEEDED');
  budget.entries += 1;
}

function consumeFileBudget(budget, bytes) {
  if (budget.files >= maximumSourceFiles) throw new SourceError('SOURCE_FILE_BUDGET_EXCEEDED');
  if (budget.bytes + bytes > maximumAggregateSourceBytes)
    throw new SourceError('SOURCE_AGGREGATE_BYTES_EXCEEDED');
  budget.files += 1;
  budget.bytes += bytes;
}

async function readBoundedFile(path, budget) {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new SourceError('NOT_A_FILE');
    if (metadata.size > maximumSourceBytes) throw new SourceError('SOURCE_TOO_LARGE');
    consumeFileBudget(budget, metadata.size);

    const contents = Buffer.alloc(metadata.size + 1);
    let offset = 0;
    while (offset < contents.length) {
      const { bytesRead } = await handle.read(contents, offset, contents.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > metadata.size) throw new SourceError('SOURCE_CHANGED_DURING_READ');
    return contents.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function readBoundedSource(root, source, budget) {
  const repositoryRoot = await realpath(root);
  const candidate = resolve(repositoryRoot, source);
  if (!contained(repositoryRoot, candidate)) throw new SourceError('PATH_OUTSIDE_REPOSITORY');
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new SourceError('NOT_AVAILABLE');
    throw new SourceError('READ_FAILED');
  }
  if (!contained(repositoryRoot, resolved)) throw new SourceError('PATH_OUTSIDE_REPOSITORY');
  if (resolved !== candidate) throw new SourceError('SYMLINK_NOT_ALLOWED');
  return readBoundedFile(resolved, budget);
}

async function collectJson(root, source, observedAt, budget) {
  try {
    const text = await readBoundedSource(root, source, budget);
    try {
      return available(source, observedAt, JSON.parse(text));
    } catch {
      throw new SourceError('INVALID_JSON');
    }
  } catch (error) {
    return error instanceof SourceError && error.code === 'NOT_AVAILABLE'
      ? unavailable(source, observedAt)
      : sourceFailure(source, observedAt, error);
  }
}

async function collectMarkdown(root, source, observedAt, parser, budget) {
  try {
    const text = await readBoundedSource(root, source, budget);
    const data = parser ? parser(text) : { text };
    return available(source, observedAt, data);
  } catch (error) {
    if (error instanceof SourceError && error.code === 'NOT_AVAILABLE')
      return unavailable(source, observedAt);
    if (!(error instanceof SourceError))
      return sourceFailure(source, observedAt, new SourceError('MALFORMED_MARKDOWN'));
    return sourceFailure(source, observedAt, error);
  }
}

async function resolveContainedDirectory(root, directory) {
  const repositoryRoot = await realpath(root);
  const candidate = resolve(repositoryRoot, directory);
  if (!contained(repositoryRoot, candidate)) throw new SourceError('PATH_OUTSIDE_REPOSITORY');
  const resolvedDirectory = await realpath(candidate);
  if (!contained(repositoryRoot, resolvedDirectory)) throw new SourceError('PATH_OUTSIDE_REPOSITORY');
  if (resolvedDirectory !== candidate) throw new SourceError('SYMLINK_NOT_ALLOWED');
  const metadata = await stat(resolvedDirectory);
  if (!metadata.isDirectory()) throw new SourceError('NOT_A_DIRECTORY');
  return resolvedDirectory;
}

async function collectDirectoryEntries(root, directory, budget) {
  const resolvedDirectory = await resolveContainedDirectory(root, directory);
  const entries = [];
  const handle = await opendir(resolvedDirectory);
  for await (const entry of handle) {
    consumeEntryBudget(budget);
    entries.push(entry);
  }
  return entries;
}

async function collectTaskRecords(root, observedAt, budget) {
  const directory = 'docs/management/tasks';
  let entries;
  try {
    entries = await collectDirectoryEntries(root, directory, budget);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    return [
      sourceFailure(
        directory,
        observedAt,
        error instanceof SourceError ? error : new SourceError('READ_FAILED'),
      ),
    ];
  }
  const records = [];
  for (const entry of entries
    .filter((item) => item.isFile() && item.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name)))
    records.push(
      await collectMarkdown(root, `${directory}/${entry.name}`, observedAt, parseTaskRecord, budget),
    );
  return records;
}

async function collectDocumentLinks(root, directory, observedAt, budget) {
  try {
    const entries = await collectDirectoryEntries(root, directory, budget);
    const links = [];
    for (const entry of entries
      .filter((item) => item.isFile() && item.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      consumeFileBudget(budget, 0);
      links.push(`${directory}/${entry.name}`);
    }
    return links.length > 0 ? available(directory, observedAt, links) : unavailable(directory, observedAt);
  } catch (error) {
    if (error?.code === 'ENOENT') return unavailable(directory, observedAt);
    return sourceFailure(
      directory,
      observedAt,
      error instanceof SourceError ? error : new SourceError('READ_FAILED'),
    );
  }
}

export async function collectRepositorySources(root, options = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const budget = createSourceBudget();
  return {
    observedAt,
    roadmap: await collectJson(root, 'planning/roadmap.json', observedAt, budget),
    riskRegister: await collectJson(root, 'planning/risk-register.json', observedAt, budget),
    securityBoundary: await collectJson(root, 'planning/security-boundary.json', observedAt, budget),
    workers: {
      workerA: await collectMarkdown(
        root,
        'docs/management/workers/worker-a.md',
        observedAt,
        parseWorkerLog,
        budget,
      ),
      workerB: await collectMarkdown(
        root,
        'docs/management/workers/worker-b.md',
        observedAt,
        parseWorkerLog,
        budget,
      ),
    },
    management: {
      currentStatus: await collectMarkdown(
        root,
        'docs/management/CURRENT-STATUS.md',
        observedAt,
        undefined,
        budget,
      ),
      workQueue: await collectMarkdown(root, 'docs/management/WORK-QUEUE.md', observedAt, undefined, budget),
      decisions: await collectMarkdown(root, 'docs/management/DECISIONS.md', observedAt, undefined, budget),
      changelog: await collectMarkdown(root, 'docs/management/CHANGELOG.md', observedAt, undefined, budget),
    },
    taskRecords: await collectTaskRecords(root, observedAt, budget),
    documents: {
      architecture: await collectDocumentLinks(root, 'docs/adr', observedAt, budget),
      security: await collectDocumentLinks(root, 'docs/security', observedAt, budget),
      host: await collectDocumentLinks(root, 'docs/management/host', observedAt, budget),
      project: await collectDocumentLinks(root, 'docs', observedAt, budget),
    },
  };
}

function validateRefName(value, maximumLength) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('@{') ||
    value.includes('//') ||
    value.includes('\\') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  )
    throw new Error('Invalid base ref');
  return value;
}

function validateBaseRef(value) {
  return validateRefName(value, 128);
}

function githubBranchRef(value) {
  const prefix = 'refs/heads/';
  if (typeof value !== 'string' || !value.startsWith(prefix))
    throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
  try {
    return validateRefName(value.slice(prefix.length), 256);
  } catch {
    throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
  }
}

function emptyGitHubPullRefs(values) {
  return [undefined, ''].includes(values.GITHUB_BASE_REF) && [undefined, ''].includes(values.GITHUB_HEAD_REF);
}

function environmentValue(environment, key) {
  if (!Object.prototype.hasOwnProperty.call(environment, key)) return undefined;
  const value = environment[key];
  if (typeof value !== 'string' || value.length > 512)
    throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
  return value;
}

function parseGitHubActionsContext(environment, baseBranch, recordedBranch) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment))
    throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
  const values = Object.fromEntries(
    githubIdentityKeys.map((key) => [key, environmentValue(environment, key)]),
  );
  if (values.GITHUB_ACTIONS === undefined) {
    if (githubIdentityKeys.slice(1).some((key) => values[key] !== undefined))
      throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
    return { kind: 'local' };
  }
  if (values.GITHUB_ACTIONS !== 'true') throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
  if (!gitCommitPattern.test(values.GITHUB_SHA ?? ''))
    throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');

  if (['push', 'workflow_dispatch'].includes(values.GITHUB_EVENT_NAME)) {
    const branch = githubBranchRef(values.GITHUB_REF);
    if (!emptyGitHubPullRefs(values)) throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
    if (branch === recordedBranch) return { kind: 'branch', branch, sha: values.GITHUB_SHA };
    if (values.GITHUB_EVENT_NAME === 'push' && branch === baseBranch && recordedBranch !== baseBranch)
      return { kind: 'integrated_branch', branch, sha: values.GITHUB_SHA };
    throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
  }

  if (values.GITHUB_EVENT_NAME === 'pull_request') {
    const pullRequestMatch = /^refs\/pull\/([1-9][0-9]{0,9})\/merge$/.exec(values.GITHUB_REF ?? '');
    if (
      !pullRequestMatch ||
      values.GITHUB_BASE_REF !== baseBranch ||
      values.GITHUB_HEAD_REF !== recordedBranch
    )
      throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
    return {
      kind: 'pull_request',
      number: pullRequestMatch[1],
      sha: values.GITHUB_SHA,
    };
  }

  if (values.GITHUB_EVENT_NAME === 'merge_group') {
    const branch = githubBranchRef(values.GITHUB_REF);
    if (!branch.startsWith(`gh-readonly-queue/${baseBranch}/`) || !emptyGitHubPullRefs(values))
      throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
    return { kind: 'merge_group', branch, sha: values.GITHUB_SHA };
  }

  throw new SourceError('RECORDED_GIT_CI_CONTEXT_INVALID');
}

function validateDirtyPathExclusions(values = []) {
  if (!Array.isArray(values) || values.length > 16) throw new Error('Invalid dirty-path exclusion list');
  return new Set(
    values.map((value) => {
      if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 256 ||
        value.startsWith('/') ||
        value.endsWith('/') ||
        value.includes('..') ||
        value.includes('\\') ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
      )
        throw new Error('Invalid dirty-path exclusion');
      return value;
    }),
  );
}

function dirtyEntryPaths(line) {
  const pathText = line.slice(3);
  return pathText.includes(' -> ') ? pathText.split(' -> ') : [pathText];
}

function dirtyStatusLines(statusOutput) {
  return statusOutput.split('\n').filter((line) => line && !line.startsWith('## '));
}

function requireNormalIndex(indexOutput, errorCode) {
  const entries = indexOutput.split('\0').filter(Boolean);
  if (entries.some((entry) => entry.length < 3 || entry[0] !== 'H' || entry[1] !== ' '))
    throw new SourceError(errorCode);
}

function parseRecentCommits(logOutput) {
  return logOutput
    ? logOutput.split('\n').map((line) => {
        const [hash, author, authoredAt, subject] = line.split('\x1f');
        return redactValue({ hash, author, authoredAt, subject });
      })
    : [];
}

async function git(root, args) {
  const env = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    PATH: process.env.PATH,
  };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  const command = ['-c', 'core.fsmonitor=false', ...args];
  const { stdout } = await execFileAsync('git', command, {
    cwd: root,
    encoding: 'utf8',
    env,
    maxBuffer: maximumGitOutputBytes,
    shell: false,
    timeout: 5000,
    windowsHide: true,
  });
  return stdout.trimEnd();
}

function localBranchRef(branch) {
  return `refs/heads/${branch}`;
}

function remoteBranchRef(branch) {
  return `refs/remotes/origin/${branch}`;
}

async function exactRefExists(root, ref) {
  try {
    await git(root, ['show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function resolveExactCommit(root, ref) {
  const commit = await git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!gitCommitPattern.test(commit)) throw new SourceError('RECORDED_GIT_QUERY_FAILED');
  return commit;
}

async function resolveExactTree(root, ref) {
  const tree = await git(root, ['rev-parse', '--verify', `${ref}^{tree}`]);
  if (!gitCommitPattern.test(tree)) throw new SourceError('RECORDED_GIT_QUERY_FAILED');
  return tree;
}

async function resolveBaseCommit(root, baseBranch, context) {
  const remoteRef = remoteBranchRef(baseBranch);
  if (context.kind !== 'local') return { ref: remoteRef, commit: await resolveExactCommit(root, remoteRef) };
  const localRef = localBranchRef(baseBranch);
  if (await exactRefExists(root, localRef))
    return { ref: localRef, commit: await resolveExactCommit(root, localRef) };
  return { ref: remoteRef, commit: await resolveExactCommit(root, remoteRef) };
}

async function requireRecordedAncestor(root, recordedCommit, logicalHead) {
  try {
    await git(root, ['merge-base', '--is-ancestor', recordedCommit, logicalHead]);
  } catch (error) {
    if (error?.code === 1) throw new SourceError('RECORDED_GIT_COMMIT_MISMATCH');
    throw error;
  }
}

async function mergeBase(root, first, second) {
  let commit;
  try {
    commit = await git(root, ['merge-base', first, second]);
  } catch (error) {
    if (error?.code === 1) throw new SourceError('RECORDED_GIT_GRAPH_MISMATCH');
    throw error;
  }
  if (!gitCommitPattern.test(commit)) throw new SourceError('RECORDED_GIT_GRAPH_MISMATCH');
  return commit;
}

async function changedPathsBetween(root, ancestor, descendant) {
  if (ancestor === descendant) return [];
  await requireRecordedAncestor(root, ancestor, descendant);
  const history = await git(root, [
    'rev-list',
    '--reverse',
    '--topo-order',
    '--parents',
    `${ancestor}..${descendant}`,
  ]);
  const commits = history.split('\n').filter(Boolean);
  if (commits.length === 0 || commits.length > maximumRestrictedDescendantCommits)
    throw new SourceError('RECORDED_GIT_GRAPH_MISMATCH');

  const changedPaths = [];
  let expectedParent = ancestor;
  for (const line of commits) {
    const identities = line.trim().split(/\s+/);
    if (
      identities.length !== 2 ||
      identities.some((identity) => !gitCommitPattern.test(identity)) ||
      identities[1] !== expectedParent
    )
      throw new SourceError('RECORDED_GIT_GRAPH_MISMATCH');
    const [commit, parent] = identities;
    const output = await git(root, ['diff', '--name-only', '-z', '--no-renames', parent, commit, '--']);
    changedPaths.push(...output.split('\0').filter(Boolean));
    expectedParent = commit;
  }
  if (expectedParent !== descendant) throw new SourceError('RECORDED_GIT_GRAPH_MISMATCH');
  return changedPaths;
}

async function requireRestrictedDescendant(root, ancestor, descendant, allowedPaths, errorCode) {
  const changedPaths = await changedPathsBetween(root, ancestor, descendant);
  if (changedPaths.some((path) => !allowedPaths.includes(path))) throw new SourceError(errorCode);
}

export async function isGitCommitAncestor(root, ancestor, descendant) {
  if (!gitCommitPattern.test(ancestor ?? '') || !gitCommitPattern.test(descendant ?? '')) return false;
  try {
    await Promise.all([resolveExactCommit(root, ancestor), resolveExactCommit(root, descendant)]);
    await requireRecordedAncestor(root, ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

export async function isGitCommitTree(root, commit, tree) {
  if (!gitCommitPattern.test(commit ?? '') || !gitCommitPattern.test(tree ?? '')) return false;
  try {
    return (await resolveExactTree(root, commit)) === tree;
  } catch {
    return false;
  }
}

export async function isManagementReportCommitFresh(root, reportCommit, sourceCommit) {
  if (!gitCommitPattern.test(reportCommit ?? '') || !gitCommitPattern.test(sourceCommit ?? '')) return false;
  try {
    await Promise.all([resolveExactCommit(root, reportCommit), resolveExactCommit(root, sourceCommit)]);
    await requireRestrictedDescendant(
      root,
      reportCommit,
      sourceCommit,
      managementReportClosurePaths,
      'CHECK_REPORT_GIT_MISMATCH',
    );
    return true;
  } catch {
    return false;
  }
}

function parseAheadBehind(counts) {
  const match = /^(\d+)\s+(\d+)$/.exec(counts.trim());
  if (!match) throw new SourceError('RECORDED_GIT_QUERY_FAILED');
  return { ahead: Number(match[2]), behind: Number(match[1]) };
}

export async function collectGitState(root, baseRef = 'master', options = {}) {
  const validatedBase = validateBaseRef(baseRef);
  const excludedDirtyPaths = validateDirtyPathExclusions(options.excludeDirtyPaths);
  const observedAt = new Date().toISOString();
  try {
    const [branch, commit, tree, statusOutput, indexOutput, logOutput, base] = await Promise.all([
      git(root, ['branch', '--show-current']),
      resolveExactCommit(root, 'HEAD'),
      resolveExactTree(root, 'HEAD'),
      git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--branch']),
      git(root, ['ls-files', '-v', '-z']),
      git(root, ['log', '--max-count=20', '--date=iso-strict', '--format=%H%x1f%an%x1f%aI%x1f%s']),
      resolveBaseCommit(root, validatedBase, { kind: 'local' }),
    ]);
    const [, counts] = await Promise.all([
      mergeBase(root, base.commit, commit),
      git(root, ['rev-list', '--left-right', '--count', `${base.commit}...${commit}`]),
    ]);
    requireNormalIndex(indexOutput, 'GIT_INDEX_FLAGS_UNSAFE');
    const dirtyLines = dirtyStatusLines(statusOutput);
    const [behindText, aheadText] = counts.trim().split(/\s+/);
    const recentCommits = parseRecentCommits(logOutput);
    return {
      status: 'READY',
      source: '.git',
      observedAt,
      branch,
      commit,
      tree,
      dirtyFiles: dirtyLines.filter(
        (line) => !dirtyEntryPaths(line).every((path) => excludedDirtyPaths.has(path)),
      ).length,
      aheadBehind: { ahead: Number(aheadText), behind: Number(behindText) },
      recentCommits,
    };
  } catch {
    return { status: 'DATA_SOURCE_ERROR', source: '.git', observedAt, error: 'GIT_QUERY_FAILED' };
  }
}

export async function collectRecordedGitState(root, baseRef, recorded, options = {}) {
  const observedAt = options.observedAt ?? recorded?.observedAt ?? new Date().toISOString();
  let validatedBase;
  let recordedBranch;
  let context;
  try {
    validatedBase = validateBaseRef(baseRef);
    recordedBranch = validateBaseRef(recorded?.branch);
    if (!gitCommitPattern.test(recorded?.commit ?? '')) throw new SourceError('RECORDED_GIT_COMMIT_INVALID');
    if (!gitCommitPattern.test(recorded?.tree ?? '')) throw new SourceError('RECORDED_GIT_TREE_INVALID');
    if (recorded?.dirtyFiles !== 0) throw new SourceError('RECORDED_GIT_NOT_CLEAN');
    context = parseGitHubActionsContext(
      options.environment === undefined ? {} : options.environment,
      validatedBase,
      recordedBranch,
    );
  } catch (error) {
    return sourceFailure(
      '.git',
      observedAt,
      error instanceof SourceError ? error : new SourceError('RECORDED_GIT_INVALID'),
    );
  }

  try {
    const [currentBranch, head, base, statusOutput, indexOutput] = await Promise.all([
      git(root, ['branch', '--show-current']),
      resolveExactCommit(root, 'HEAD'),
      resolveBaseCommit(root, validatedBase, context),
      git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--branch']),
      git(root, ['ls-files', '-v', '-z']),
    ]);
    if (dirtyStatusLines(statusOutput).length > 0) throw new SourceError('RECORDED_GIT_NOT_CLEAN');
    requireNormalIndex(indexOutput, 'RECORDED_GIT_INDEX_FLAGS_UNSAFE');
    let logicalHead;
    let comparisonBaseCommit = base.commit;

    if (context.kind === 'pull_request') {
      if (currentBranch !== '') throw new SourceError('RECORDED_GIT_BRANCH_MISMATCH');
      if (context.sha !== head) throw new SourceError('RECORDED_GIT_HEAD_MISMATCH');
      const mergeRef = `refs/remotes/pull/${context.number}/merge`;
      const [mergeRefCommit, parentOutput, sourceHead] = await Promise.all([
        resolveExactCommit(root, mergeRef),
        git(root, ['rev-list', '--parents', '--max-count=1', 'HEAD']),
        resolveExactCommit(root, remoteBranchRef(recordedBranch)),
      ]);
      const parents = parentOutput.trim().split(/\s+/);
      if (
        mergeRefCommit !== head ||
        parents.length !== 3 ||
        parents.some((commit) => !gitCommitPattern.test(commit)) ||
        parents[0] !== head ||
        parents[1] !== base.commit ||
        parents[2] !== sourceHead
      )
        throw new SourceError('RECORDED_GIT_GRAPH_MISMATCH');
      logicalHead = parents[2];
    } else if (context.kind === 'merge_group') {
      if (![context.branch, ''].includes(currentBranch))
        throw new SourceError('RECORDED_GIT_BRANCH_MISMATCH');
      if (context.sha !== head) throw new SourceError('RECORDED_GIT_HEAD_MISMATCH');
      const [queueHead, sourceHead] = await Promise.all([
        resolveExactCommit(root, remoteBranchRef(context.branch)),
        resolveExactCommit(root, remoteBranchRef(recordedBranch)),
      ]);
      if (queueHead !== head) throw new SourceError('RECORDED_GIT_GRAPH_MISMATCH');
      await Promise.all([
        requireRecordedAncestor(root, base.commit, head),
        requireRecordedAncestor(root, sourceHead, head),
      ]);
      logicalHead = sourceHead;
    } else if (
      context.kind === 'integrated_branch' ||
      (context.kind === 'local' && currentBranch === validatedBase && recordedBranch !== validatedBase)
    ) {
      if (![validatedBase, ''].includes(currentBranch)) throw new SourceError('RECORDED_GIT_BRANCH_MISMATCH');
      if ((context.kind === 'integrated_branch' && context.sha !== head) || base.commit !== head)
        throw new SourceError('RECORDED_GIT_HEAD_MISMATCH');
      const sourceHead = await resolveExactCommit(root, remoteBranchRef(recordedBranch));
      const [headTree, sourceTree, commonBase] = await Promise.all([
        resolveExactTree(root, head),
        resolveExactTree(root, sourceHead),
        mergeBase(root, sourceHead, head),
      ]);
      if (headTree !== sourceTree) throw new SourceError('RECORDED_GIT_GRAPH_MISMATCH');
      await Promise.all([
        requireRecordedAncestor(root, commonBase, sourceHead),
        requireRecordedAncestor(root, commonBase, head),
      ]);
      logicalHead = sourceHead;
      comparisonBaseCommit = commonBase;
    } else {
      if (currentBranch !== recordedBranch) throw new SourceError('RECORDED_GIT_BRANCH_MISMATCH');
      const sourceHead = await resolveExactCommit(root, localBranchRef(recordedBranch));
      if (sourceHead !== head) throw new SourceError('RECORDED_GIT_BRANCH_MISMATCH');
      if (context.kind === 'branch' && context.sha !== head)
        throw new SourceError('RECORDED_GIT_HEAD_MISMATCH');
      logicalHead = sourceHead;
    }

    await mergeBase(root, base.commit, logicalHead);

    await requireRestrictedDescendant(
      root,
      recorded.commit,
      logicalHead,
      generatedSnapshotClosurePaths,
      'RECORDED_GIT_DESCENDANT_PATH_MISMATCH',
    );
    const [recordedTree, logOutput, counts] = await Promise.all([
      resolveExactTree(root, recorded.commit),
      git(root, [
        'log',
        recorded.commit,
        '--max-count=20',
        '--date=iso-strict',
        '--format=%H%x1f%an%x1f%aI%x1f%s',
      ]),
      git(root, ['rev-list', '--left-right', '--count', `${comparisonBaseCommit}...${recorded.commit}`]),
    ]);
    if (recordedTree !== recorded.tree) throw new SourceError('RECORDED_GIT_TREE_MISMATCH');
    return {
      status: 'READY',
      source: '.git',
      observedAt,
      branch: recordedBranch,
      commit: recorded.commit,
      tree: recorded.tree,
      dirtyFiles: 0,
      aheadBehind: parseAheadBehind(counts),
      recentCommits: parseRecentCommits(logOutput),
    };
  } catch (error) {
    return sourceFailure(
      '.git',
      observedAt,
      error instanceof SourceError ? error : new SourceError('RECORDED_GIT_QUERY_FAILED'),
    );
  }
}

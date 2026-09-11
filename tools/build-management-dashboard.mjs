import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format as formatWithPrettier } from 'prettier';

import { CHECK_REGISTRY } from './management-dashboard/checks.mjs';
import { redactValue, sanitizeLog } from './management-dashboard/redact.mjs';
import { validateCheckReport, validateDashboardSnapshot } from './management-dashboard/schema.mjs';
import {
  collectGitState,
  collectRecordedGitState,
  collectRepositorySources,
  isGitCommitTree,
  isManagementReportCommitFresh,
} from './management-dashboard/sources.mjs';

const generatorVersion = '1.0.0';
const generatedMetadata = Object.freeze({
  doNotEdit: true,
  command: 'npm run management:build',
  source: 'tools/build-management-dashboard.mjs',
});
const maximumCheckReportBytes = 1024 * 1024;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = 'docs/management/dashboard/data';

const roadmapStatuses = Object.freeze({
  done: 'DONE',
  in_progress: 'IN_PROGRESS',
  ready: 'READY',
  blocked: 'BLOCKED',
  backlog: 'NOT_STARTED',
  partial: 'PARTIAL',
});

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function taskStatus(value, field) {
  const status = roadmapStatuses[value];
  requireCondition(status, `MANDATORY_SOURCE_ERROR: ${field} has unknown status ${String(value)}`);
  return status;
}

function normalizeTask(task, source, observedAt) {
  requireCondition(task && typeof task === 'object', `MANDATORY_SOURCE_ERROR: ${source} task is invalid`);
  requireCondition(typeof task.id === 'string' && task.id, `MANDATORY_SOURCE_ERROR: ${source} task ID`);
  requireCondition(
    typeof task.title === 'string' && task.title,
    `MANDATORY_SOURCE_ERROR: ${source} task ${task.id} title`,
  );
  return {
    id: task.id,
    title: task.title,
    status: taskStatus(task.status, `${source} task ${task.id}`),
    source,
    observedAt,
    owner: task.owner ?? 'NOT_AVAILABLE',
    priority: task.priority ?? 'NOT_AVAILABLE',
    risk: task.risk ?? 'NOT_AVAILABLE',
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    blockedBy: task.blockedReason ?? 'NONE',
    acceptance: Array.isArray(task.acceptance) ? task.acceptance : [],
    evidence: Array.isArray(task.evidence) ? task.evidence : [],
    lastUpdate: task.updatedAt ?? 'NOT_AVAILABLE',
  };
}

function normalizeWorker(id, label, collected, observedAt) {
  if (collected.status !== 'READY')
    return { id, label, status: collected.status, source: collected.source, observedAt };
  const current = collected.data?.current;
  if (!current || typeof current.status !== 'string')
    return {
      id,
      label,
      status: 'DATA_SOURCE_ERROR',
      source: collected.source,
      observedAt,
      error: 'MALFORMED_WORKER_STATE',
    };
  return {
    id,
    label,
    status: current.status,
    source: collected.source,
    observedAt,
    current,
    activities: collected.data.activities ?? [],
  };
}

function flattenSources(sources, checkState, git, observedAt) {
  const entries = [
    sources.roadmap,
    sources.riskRegister,
    sources.securityBoundary,
    sources.workers.workerA,
    sources.workers.workerB,
    sources.management.currentStatus,
    sources.management.workQueue,
    sources.management.decisions,
    sources.management.changelog,
    ...sources.taskRecords,
    ...Object.values(sources.documents),
    git,
    checkState,
  ];
  return entries.filter(Boolean).map((entry) => ({
    status: entry.status,
    source: entry.source,
    observedAt: entry.observedAt ?? observedAt,
    ...('error' in entry ? { error: entry.error } : {}),
  }));
}

function normalizeCheckState(input, observedAt) {
  if (!input)
    return {
      status: 'NOT_AVAILABLE',
      source: '.checks/management/latest.json',
      observedAt,
    };
  if ('status' in input) return input;
  return {
    status: 'READY',
    source: '.checks/management/latest.json',
    observedAt: input.finishedAt ?? observedAt,
    data: input,
  };
}

function validateRegisteredCheckReport(value) {
  const report = validateCheckReport(value);
  requireCondition(['quick', 'full'].includes(report.profile), 'CHECK_REPORT_PROFILE_INVALID');
  const expectedChecks = CHECK_REGISTRY.filter((check) => check.profiles.includes(report.profile));
  requireCondition(report.checks.length === expectedChecks.length, 'CHECK_REPORT_INCOMPLETE');
  for (const [index, expected] of expectedChecks.entries()) {
    const actual = report.checks[index];
    requireCondition(actual.id === expected.id, 'CHECK_REPORT_REGISTRY_MISMATCH');
    if (expected.available) {
      requireCondition(['PASS', 'FAIL'].includes(actual.status), 'CHECK_REPORT_STATUS_INVALID');
    } else {
      requireCondition(actual.status === expected.status, 'CHECK_REPORT_STATUS_INVALID');
      requireCondition(actual.reason === expected.reason, 'CHECK_REPORT_REASON_INVALID');
      requireCondition(actual.exitCode === null, 'CHECK_REPORT_EXIT_CODE_INVALID');
    }
  }
  return report;
}

function aggregateChecks(checkState, git, observedAt) {
  if (checkState.status !== 'READY') {
    const unavailableStatus = checkState.status === 'DATA_SOURCE_ERROR' ? 'DATA_SOURCE_ERROR' : 'NOT_RUN';
    return {
      status: unavailableStatus,
      source: checkState.source,
      observedAt,
      items: CHECK_REGISTRY.map((check) => ({
        id: check.id,
        status: 'NOT_RUN',
        source: checkState.source,
        observedAt,
        reason:
          checkState.status === 'DATA_SOURCE_ERROR' ? 'CHECK_REPORT_INVALID' : 'CHECK_REPORT_NOT_AVAILABLE',
      })),
    };
  }

  const report = validateRegisteredCheckReport(checkState.data);
  const items = report.checks.map((check) => ({
    ...check,
    commit: report.commit,
    source: checkState.source,
    observedAt: report.finishedAt,
  }));
  const stale = git.status !== 'READY' || (report.commit !== git.commit && checkState.gitFresh !== true);
  let status = 'PASS';
  if (items.some((check) => check.status === 'FAIL')) status = 'FAIL';
  else if (items.every((check) => check.status === 'NOT_RUN')) status = 'NOT_RUN';
  if (stale) status = 'BLOCKED';
  return {
    status,
    source: checkState.source,
    observedAt: report.finishedAt,
    commit: report.commit,
    profile: report.profile ?? 'full',
    items,
    ...(stale ? { reason: 'STALE_COMMIT: check report does not match current Git HEAD' } : {}),
  };
}

function aggregateBuild(tests, observedAt) {
  const check = tests.items.find((item) => item.id === 'build');
  if (!check)
    return {
      status: tests.status === 'DATA_SOURCE_ERROR' ? 'DATA_SOURCE_ERROR' : 'NOT_RUN',
      source: tests.source,
      observedAt,
      reason: 'BUILD_CHECK_NOT_RECORDED',
    };
  return {
    ...check,
    status: tests.status === 'BLOCKED' && check.status === 'PASS' ? 'BLOCKED' : check.status,
    source: tests.source,
    observedAt: check.observedAt ?? observedAt,
    ...(tests.status === 'BLOCKED' ? { reason: tests.reason } : {}),
  };
}

function aggregateLinks(sources, linkStates, observedAt) {
  const links = [];
  for (const [kind, collected] of Object.entries(sources.documents)) {
    if (collected.status !== 'READY') continue;
    for (const path of collected.data ?? []) {
      const valid = linkStates[path] === true;
      links.push({
        label: path,
        path,
        kind,
        status: valid ? 'READY' : 'DATA_SOURCE_ERROR',
        source: collected.source,
        observedAt,
        ...(valid ? {} : { error: 'BROKEN_INTERNAL_LINK' }),
      });
    }
  }
  return links;
}

function releaseGateStatus(gate) {
  if (!gate) return 'NOT_AVAILABLE';
  if (gate.status === 'passed') return 'DONE';
  if (gate.status === 'blocked') return 'BLOCKED';
  if (gate.status === 'open') return 'NOT_STARTED';
  return 'DATA_SOURCE_ERROR';
}

function sectionItems(record, section) {
  const value = record.data?.sections?.[section];
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.filter((item) => typeof item === 'string' && item.trim() && !/^NONE\b/i.test(item.trim()));
}

function validatedRisks(collected) {
  if (collected.status !== 'READY') return [];
  const error = `INVALID_RISK_REGISTER: ${collected.source}`;
  const risks = collected.data?.risks;
  requireCondition(Array.isArray(risks) && risks.length <= 1000, error);
  for (const risk of risks) {
    requireCondition(risk && typeof risk === 'object' && !Array.isArray(risk), error);
    for (const field of ['id', 'title'])
      requireCondition(
        typeof risk[field] === 'string' && risk[field].trim() && risk[field].length <= 4096,
        error,
      );
    requireCondition(['critical', 'high', 'medium', 'low'].includes(risk.severity), error);
    requireCondition(['open', 'mitigated', 'accepted'].includes(risk.status), error);
    for (const field of ['owner', 'scenario', 'verification', 'residualRisk'])
      if (risk[field] !== undefined)
        requireCondition(typeof risk[field] === 'string' && risk[field].length <= 4096, error);
    for (const field of ['boundaries', 'mitigationTasks'])
      if (risk[field] !== undefined)
        requireCondition(
          Array.isArray(risk[field]) &&
            risk[field].length <= 1000 &&
            risk[field].every((item) => typeof item === 'string' && item.length <= 4096),
          error,
        );
  }
  return risks;
}

export function buildDashboardSnapshot(context) {
  const { sources, git } = context;
  const observedAt = context.observedAt ?? sources?.observedAt;
  requireCondition(
    typeof observedAt === 'string' && !Number.isNaN(Date.parse(observedAt)),
    'INVALID_OBSERVED_AT',
  );
  requireCondition(sources?.roadmap, 'MANDATORY_SOURCE_ERROR: planning/roadmap.json');
  requireCondition(sources.roadmap.status === 'READY', `MANDATORY_SOURCE_ERROR: ${sources.roadmap.source}`);
  const roadmap = sources.roadmap.data;
  requireCondition(
    roadmap?.project && Array.isArray(roadmap.tasks) && Array.isArray(roadmap.releaseGates),
    'MANDATORY_SOURCE_ERROR: planning/roadmap.json malformed structure',
  );
  const tasks = roadmap.tasks.map((task) => normalizeTask(task, sources.roadmap.source, observedAt));
  const checkState = normalizeCheckState(context.checkReport, observedAt);
  const tests = aggregateChecks(checkState, git, observedAt);
  const risks = validatedRisks(sources.riskRegister);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const risk of risks) if (risk.severity in counts) counts[risk.severity]++;
  const openSevereRisks = risks.filter(
    (risk) => ['critical', 'high'].includes(risk.severity) && !['closed', 'accepted'].includes(risk.status),
  );
  const links = aggregateLinks(sources, context.linkStates ?? {}, observedAt);
  const brokenLinks = links.filter((link) => link.status === 'DATA_SOURCE_ERROR');
  const optionalSources = flattenSources(sources, checkState, git, observedAt).filter(
    (entry) => entry.status === 'NOT_AVAILABLE',
  );
  const sourceErrors = flattenSources(sources, checkState, git, observedAt).filter(
    (entry) => entry.status === 'DATA_SOURCE_ERROR',
  );
  const staleChecks = tests.status === 'BLOCKED';
  const taskIssueSections = ['Known limitations', 'Not fully resolved', 'Deferred work', 'Residual risks'];
  const taskReportIssues = sources.taskRecords
    .filter((record) => record.status === 'READY')
    .flatMap((record) =>
      taskIssueSections.flatMap((section) =>
        sectionItems(record, section).map((title, index) => ({
          id: `task:${record.data.id}:${section.toLowerCase().replaceAll(' ', '-')}:${index}`,
          title,
          category: section,
          task: record.data.id,
          status: 'PARTIAL',
          source: record.source,
        })),
      ),
    );
  const taskReportBlockers = sources.taskRecords
    .filter((record) => record.status === 'READY')
    .flatMap((record) =>
      sectionItems(record, 'Blockers').map((title, index) => ({
        id: `task:${record.data.id}:blocker:${index}`,
        title,
        task: record.data.id,
        source: record.source,
        severity: 'NOT_AVAILABLE',
      })),
    );
  const knownIssues = [
    ...optionalSources.map((entry) => ({
      id: `missing:${entry.source}`,
      title: 'Optional source is unavailable',
      status: 'NOT_AVAILABLE',
      source: entry.source,
    })),
    ...sourceErrors.map((entry) => ({
      id: `error:${entry.source}`,
      title: 'Source collection failed',
      status: 'DATA_SOURCE_ERROR',
      source: entry.source,
      error: entry.error ?? 'UNKNOWN_SOURCE_ERROR',
    })),
    ...brokenLinks.map((link) => ({
      id: `broken-link:${link.path}`,
      title: 'Repository document link is unavailable',
      status: 'DATA_SOURCE_ERROR',
      source: link.path,
      error: link.error,
    })),
    ...(git.status === 'READY' && git.dirtyFiles > 0
      ? [
          {
            id: 'git:dirty',
            title: `${git.dirtyFiles} uncommitted path(s) observed`,
            status: 'IN_PROGRESS',
            source: '.git',
          },
        ]
      : []),
    ...(staleChecks
      ? [
          {
            id: 'checks:stale',
            title: tests.reason,
            status: 'BLOCKED',
            source: tests.source,
          },
        ]
      : []),
    ...taskReportIssues,
  ];
  const blockers = [
    ...tasks
      .filter((task) => task.status === 'BLOCKED')
      .map((task) => ({ id: task.id, title: task.title, source: task.source, severity: task.risk })),
    ...openSevereRisks.map((risk) => ({
      id: risk.id,
      title: risk.title,
      source: sources.riskRegister.source,
      severity: risk.severity,
      owner: risk.owner ?? 'NOT_AVAILABLE',
    })),
    ...taskReportBlockers,
  ];
  const dashboardLog = [
    ...optionalSources.map((entry) => ({
      level: 'warning',
      code: 'OPTIONAL_SOURCE_NOT_AVAILABLE',
      source: entry.source,
    })),
    ...sourceErrors.map((entry) => ({
      level: 'error',
      code: 'DATA_SOURCE_ERROR',
      source: entry.source,
      detail: entry.error ?? 'UNKNOWN_SOURCE_ERROR',
    })),
    ...brokenLinks.map((link) => ({
      level: 'error',
      code: 'BROKEN_INTERNAL_LINK',
      source: link.path,
      detail: link.error,
    })),
    ...(staleChecks ? [{ level: 'warning', code: 'STALE_CHECK_EVIDENCE', source: tests.source }] : []),
  ];
  const securityStatus =
    sources.riskRegister.status !== 'READY'
      ? sources.riskRegister.status
      : openSevereRisks.length > 0
        ? 'BLOCKED'
        : 'READY';
  const boundary = sources.securityBoundary.data?.environment;
  const networkStatus =
    sources.securityBoundary.status !== 'READY'
      ? sources.securityBoundary.status
      : boundary?.chainId === 46630 &&
          boundary.mainnetSupported === false &&
          boundary.realFundsSupported === false
        ? 'READY'
        : 'BLOCKED';
  const g4 = roadmap.releaseGates.find((gate) => gate.id === 'G4');
  const phases = Array.isArray(roadmap.phases) ? roadmap.phases : [];
  const activePhaseIds = [
    ...new Set(roadmap.tasks.filter((task) => task.status === 'in_progress').map((task) => task.phase)),
  ].filter(Boolean);
  const currentWave =
    activePhaseIds.length > 0
      ? activePhaseIds
          .map((id) => {
            const phase = phases.find((item) => item.id === id);
            return phase ? `${id} · ${phase.name}` : id;
          })
          .join(' / ')
      : 'NOT_AVAILABLE';
  const hostTask = sources.taskRecords.find(
    (record) => record.status === 'READY' && record.data?.id === 'B3',
  );

  const snapshot = {
    schemaVersion: 1,
    generatedAt: observedAt,
    generatorVersion,
    generated: { ...generatedMetadata },
    project: {
      status: 'READY',
      source: sources.roadmap.source,
      observedAt,
      name: roadmap.project.name,
      branch: git.status === 'READY' ? git.branch : '[UNAVAILABLE]',
      network: roadmap.project.network ?? 'NOT_AVAILABLE',
      chainId: roadmap.project.chainId ?? 'NOT_AVAILABLE',
      currentWave,
    },
    integration: {
      status:
        git.status !== 'READY' ? 'DATA_SOURCE_ERROR' : git.aheadBehind?.ahead > 0 ? 'IN_PROGRESS' : 'READY',
      source: git.source,
      observedAt,
      ...(git.status === 'READY'
        ? { aheadBehind: git.aheadBehind, dirtyFiles: git.dirtyFiles }
        : { error: git.error ?? 'GIT_QUERY_FAILED' }),
    },
    workers: [
      normalizeWorker('worker-a', 'Worker A', sources.workers.workerA, observedAt),
      normalizeWorker('worker-b', 'Worker B / Macbeth', sources.workers.workerB, observedAt),
    ],
    tasks,
    decisions: {
      status: sources.management.decisions.status,
      source: sources.management.decisions.source,
      observedAt,
      items:
        sources.management.decisions.status === 'READY'
          ? [{ id: 'decision-log', text: sources.management.decisions.data.text }]
          : [],
    },
    management: {
      currentStatus: sources.management.currentStatus,
      workQueue: sources.management.workQueue,
      changelog: sources.management.changelog,
    },
    security: {
      status: securityStatus,
      source: sources.riskRegister.source,
      observedAt,
      counts,
      findings: risks.map((risk) => ({
        id: risk.id,
        title: risk.title,
        severity: risk.severity,
        status: risk.status,
        owner: risk.owner ?? 'NOT_AVAILABLE',
        component: Array.isArray(risk.boundaries) ? risk.boundaries : [],
        attackPath: risk.scenario ?? 'NOT_AVAILABLE',
        mitigation: Array.isArray(risk.mitigationTasks) ? risk.mitigationTasks : [],
        task: Array.isArray(risk.mitigationTasks) ? risk.mitigationTasks : [],
        evidence: risk.verification ?? 'NOT_AVAILABLE',
        residualRisk: risk.residualRisk ?? 'NOT_AVAILABLE',
      })),
    },
    tests,
    git: { ...git, observedAt },
    build: aggregateBuild(tests, observedAt),
    hackathon: {
      status: releaseGateStatus(g4),
      source: sources.roadmap.source,
      observedAt,
      gate: g4 ?? null,
      releaseGates: roadmap.releaseGates,
    },
    network: {
      status: networkStatus,
      source: sources.securityBoundary.source,
      observedAt,
      ...(boundary ? { chainId: boundary.chainId, environment: boundary } : {}),
    },
    host: hostTask
      ? {
          status: hostTask.data.status,
          source: hostTask.source,
          observedAt,
          title: hostTask.data.title,
          summary: hostTask.data.sections?.Summary ?? 'NOT_AVAILABLE',
          links: links.filter((link) => link.kind === 'host'),
        }
      : {
          status: 'NOT_AVAILABLE',
          source: 'docs/management/tasks/B3.md',
          observedAt,
          links: links.filter((link) => link.kind === 'host'),
        },
    knownIssues,
    blockers,
    links,
    sourceHealth: flattenSources(sources, checkState, git, observedAt),
    dashboardLog,
  };
  return validateDashboardSnapshot(snapshot);
}

async function formatJson(value) {
  return formatWithPrettier(JSON.stringify(value), {
    parser: 'json',
    printWidth: 110,
    endOfLine: 'lf',
  });
}

async function artifactContents(snapshot) {
  const redactedSnapshot = redactValue(snapshot);
  validateDashboardSnapshot(redactedSnapshot);
  return {
    dashboard: await formatJson(redactedSnapshot),
    buildLog: await formatJson({
      schemaVersion: 1,
      generatedAt: redactedSnapshot.generatedAt,
      generatorVersion: redactedSnapshot.generatorVersion,
      generated: { ...generatedMetadata },
      status: redactedSnapshot.dashboardLog.some((item) => item.level === 'error')
        ? 'ERROR'
        : redactedSnapshot.dashboardLog.length > 0
          ? 'WARNING'
          : 'READY',
      diagnostics: redactedSnapshot.dashboardLog,
      sources: redactedSnapshot.sourceHealth,
    }),
  };
}

async function containedOutputDirectory(root, relativeDirectory, options = {}) {
  const realRoot = await realpath(root);
  let current = realRoot;
  for (const component of relativeDirectory.split('/')) {
    const candidate = resolve(current, component);
    requireCondition(contained(realRoot, candidate), 'OUTPUT_DIRECTORY_OUTSIDE_REPOSITORY');
    let metadata;
    try {
      metadata = await lstat(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT' || options.create !== true)
        throw new Error('OUTPUT_DIRECTORY_NOT_AVAILABLE', { cause: error });
      try {
        await mkdir(candidate, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      metadata = await lstat(candidate);
    }
    requireCondition(!metadata.isSymbolicLink(), 'OUTPUT_DIRECTORY_SYMLINK');
    requireCondition(metadata.isDirectory(), 'OUTPUT_DIRECTORY_NOT_A_DIRECTORY');
    const canonical = await realpath(candidate);
    requireCondition(contained(realRoot, canonical), 'OUTPUT_DIRECTORY_OUTSIDE_REPOSITORY');
    current = canonical;
  }
  return { directory: current, root: realRoot };
}

async function verifyOutputDirectory(realRoot, directory) {
  const metadata = await lstat(directory);
  requireCondition(!metadata.isSymbolicLink(), 'OUTPUT_DIRECTORY_SYMLINK');
  requireCondition(metadata.isDirectory(), 'OUTPUT_DIRECTORY_NOT_A_DIRECTORY');
  const canonical = await realpath(directory);
  requireCondition(
    canonical === directory && contained(realRoot, canonical),
    'OUTPUT_DIRECTORY_OUTSIDE_REPOSITORY',
  );
}

async function verifyArtifactDirectoryContents(directory) {
  const allowed = new Set(['build-log.json', 'dashboard.json']);
  const entries = await readdir(directory, { withFileTypes: true });
  requireCondition(
    entries.every((entry) => allowed.has(entry.name) && entry.isFile() && !entry.isSymbolicLink()),
    'OUTPUT_DIRECTORY_UNEXPECTED_CONTENT',
  );
}

export async function writeDashboardArtifacts(root, snapshot, options = {}) {
  const contents = await artifactContents(snapshot);
  const output = await containedOutputDirectory(root, dataDirectory, { create: true });
  const parent = dirname(output.directory);
  const nonce = `${process.pid}-${randomUUID()}`;
  const staging = resolve(parent, `.data.staging-${nonce}`);
  const backup = resolve(parent, `.data.backup-${nonce}`);
  const renamePath = options.rename ?? rename;
  requireCondition(typeof renamePath === 'function', 'OUTPUT_RENAME_INVALID');
  requireCondition(
    contained(output.root, staging) && contained(output.root, backup),
    'OUTPUT_PATH_OUTSIDE_DIRECTORY',
  );
  await verifyArtifactDirectoryContents(output.directory);
  await mkdir(staging, { mode: 0o700 });
  let installed = false;
  try {
    await Promise.all([
      writeFile(resolve(staging, 'build-log.json'), contents.buildLog, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      }),
      writeFile(resolve(staging, 'dashboard.json'), contents.dashboard, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      }),
    ]);
    await Promise.all([
      verifyOutputDirectory(output.root, parent),
      verifyOutputDirectory(output.root, output.directory),
      verifyArtifactDirectoryContents(output.directory),
    ]);
    await renamePath(output.directory, backup);
    try {
      await renamePath(staging, output.directory);
      installed = true;
    } catch (installError) {
      try {
        await renamePath(backup, output.directory);
      } catch (rollbackError) {
        throw new AggregateError([installError, rollbackError], 'OUTPUT_DIRECTORY_ROLLBACK_FAILED', {
          cause: rollbackError,
        });
      }
      throw installError;
    }
    await rm(backup, { recursive: true, force: true });
  } finally {
    if (!installed) await rm(staging, { recursive: true, force: true }).catch(() => {});
    // If rollback fails, the original pair intentionally remains at the bounded backup path.
  }
}

export async function checkDashboardArtifacts(root, snapshot) {
  const contents = await artifactContents(snapshot);
  try {
    const output = await containedOutputDirectory(root, dataDirectory);
    const [dashboard, buildLog] = await Promise.all([
      readFile(resolve(output.directory, 'dashboard.json'), 'utf8'),
      readFile(resolve(output.directory, 'build-log.json'), 'utf8'),
    ]);
    return dashboard === contents.dashboard && buildLog === contents.buildLog;
  } catch {
    return false;
  }
}

function validIsoInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  const normalized = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  return new Date(value).toISOString() === normalized;
}

export function parseBuildArgs(args) {
  requireCondition(args.length <= 1, 'Only one build argument is allowed');
  if (args.length === 0) return { mode: 'write' };
  if (args[0] === '--check') return { mode: 'check' };
  if (args[0].startsWith('--observed-at=')) {
    const observedAt = args[0].slice('--observed-at='.length);
    requireCondition(validIsoInstant(observedAt), 'Invalid observed-at timestamp');
    return { mode: 'write', observedAt };
  }
  throw new Error(`Unknown argument: ${args[0]}`);
}

function contained(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function readOptionalCheckReport(root, observedAt) {
  const source = '.checks/management/latest.json';
  try {
    const realRoot = await realpath(root);
    const candidate = resolve(realRoot, source);
    const realCandidate = await realpath(candidate);
    requireCondition(contained(realRoot, realCandidate), 'CHECK_REPORT_OUTSIDE_REPOSITORY');
    requireCondition(realCandidate === candidate, 'CHECK_REPORT_SYMLINK_NOT_ALLOWED');
    const metadata = await stat(realCandidate);
    requireCondition(metadata.isFile(), 'CHECK_REPORT_NOT_A_FILE');
    requireCondition(metadata.size <= maximumCheckReportBytes, 'CHECK_REPORT_TOO_LARGE');
    const data = JSON.parse(await readFile(realCandidate, 'utf8'));
    validateRegisteredCheckReport(data);
    return { status: 'READY', source, observedAt: data.finishedAt, data };
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'NOT_AVAILABLE', source, observedAt };
    return {
      status: 'DATA_SOURCE_ERROR',
      source,
      observedAt,
      error: 'CHECK_REPORT_INVALID',
    };
  }
}

async function linkStatesFor(root, sources) {
  const states = {};
  const realRoot = await realpath(root);
  for (const collected of Object.values(sources.documents)) {
    if (collected.status !== 'READY') continue;
    for (const path of collected.data ?? []) {
      try {
        const resolved = await realpath(resolve(realRoot, path));
        const metadata = await stat(resolved);
        states[path] = contained(realRoot, resolved) && metadata.isFile();
      } catch {
        states[path] = false;
      }
    }
  }
  return states;
}

export async function main(args = process.argv.slice(2), options = {}) {
  const parsed = parseBuildArgs(args);
  const root = options.root ?? repositoryRoot;
  let observedAt = parsed.observedAt;
  let comparisonSnapshot;
  if (!observedAt && parsed.mode === 'check') {
    try {
      const output = await containedOutputDirectory(root, dataDirectory);
      comparisonSnapshot = JSON.parse(await readFile(resolve(output.directory, 'dashboard.json'), 'utf8'));
      validateDashboardSnapshot(comparisonSnapshot);
      observedAt = comparisonSnapshot.generatedAt;
    } catch {
      throw new Error('GENERATED_ARTIFACT_MISSING');
    }
  }
  observedAt ??= new Date().toISOString();
  const gitStatePromise = comparisonSnapshot
    ? collectRecordedGitState(root, 'master', comparisonSnapshot.git, {
        observedAt,
        environment: options.environment === undefined ? process.env : options.environment,
      })
    : collectGitState(root, 'master', {
        excludeDirtyPaths: [
          'docs/management/dashboard/data/dashboard.json',
          'docs/management/dashboard/data/build-log.json',
        ],
      });
  const [sources, git, collectedCheckReport] = await Promise.all([
    collectRepositorySources(root, { observedAt }),
    gitStatePromise,
    readOptionalCheckReport(root, observedAt),
  ]);
  requireCondition(git.status === 'READY', git.error ?? 'GIT_QUERY_FAILED');
  let checkReport = collectedCheckReport;
  if (checkReport.status === 'READY') {
    const [treeMatches, commitIsFresh] = await Promise.all([
      isGitCommitTree(root, checkReport.data.commit, checkReport.data.tree),
      isManagementReportCommitFresh(root, checkReport.data.commit, git.commit),
    ]);
    if (!treeMatches || !commitIsFresh || checkReport.data.branch !== git.branch) {
      checkReport = {
        status: 'DATA_SOURCE_ERROR',
        source: checkReport.source,
        observedAt,
        error: 'CHECK_REPORT_GIT_MISMATCH',
      };
    } else {
      checkReport = { ...checkReport, gitFresh: true };
    }
  }
  if (parsed.mode === 'check') {
    requireCondition(
      checkReport.status === 'READY',
      checkReport.status === 'NOT_AVAILABLE'
        ? 'CHECK_REPORT_NOT_AVAILABLE'
        : (checkReport.error ?? 'CHECK_REPORT_INVALID'),
    );
  }
  git.observedAt = observedAt;
  const linkStates = await linkStatesFor(root, sources);
  const snapshot = buildDashboardSnapshot({ sources, git, checkReport, observedAt, linkStates });
  const brokenLink = snapshot.links.find((link) => link.status === 'DATA_SOURCE_ERROR');
  requireCondition(!brokenLink, `BROKEN_INTERNAL_LINK: ${brokenLink?.path ?? 'UNKNOWN'}`);
  if (parsed.mode === 'check') {
    requireCondition(await checkDashboardArtifacts(root, snapshot), 'GENERATED_ARTIFACT_DRIFT');
    return snapshot;
  }
  await writeDashboardArtifacts(root, snapshot);
  return snapshot;
}

if (
  process.argv[1] &&
  relative(dirname(fileURLToPath(import.meta.url)), resolve(process.argv[1])) ===
    'build-management-dashboard.mjs'
)
  main()
    .then((snapshot) => {
      console.log(
        `Management dashboard ${snapshot.project.name} generated at ${snapshot.generatedAt}; ${snapshot.dashboardLog.length} diagnostic(s)`,
      );
    })
    .catch((error) => {
      console.error(
        `Management dashboard build failed: ${sanitizeLog(error?.message ?? 'UNKNOWN_ERROR', { maxBytes: 512 })}`,
      );
      process.exitCode = 1;
    });

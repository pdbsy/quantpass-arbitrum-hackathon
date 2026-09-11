export const TASK_STATUSES = Object.freeze([
  'DONE',
  'VERIFIED_DONE',
  'PARTIAL',
  'IN_PROGRESS',
  'READY',
  'BLOCKED',
  'NOT_STARTED',
  'NOT_AVAILABLE',
  'DATA_SOURCE_ERROR',
]);
export const CHECK_STATUSES = Object.freeze([
  'PASS',
  'FAIL',
  'NOT_RUN',
  'BLOCKED',
  'NOT_AVAILABLE',
  'DATA_SOURCE_ERROR',
]);

const taskStatuses = new Set(TASK_STATUSES);
const checkStatuses = new Set(CHECK_STATUSES);
const findingSeverities = new Set(['critical', 'high', 'medium', 'low']);
const commitPattern = /^[0-9a-f]{40}$/;

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid dashboard data: ${message}`);
}

function requireObject(value, field) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value), `${field} must be an object`);
}

function requireString(value, field) {
  requireCondition(
    typeof value === 'string' && value.trim().length > 0,
    `${field} must be a non-empty string`,
  );
  requireCondition(value.length <= 4096, `${field} exceeds 4096 characters`);
}

function requireArray(value, field) {
  requireCondition(Array.isArray(value), `${field} must be an array`);
  requireCondition(value.length <= 1000, `${field} exceeds 1000 items`);
}

function requireIsoInstant(value, field) {
  requireString(value, field);
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  const normalized = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  requireCondition(
    pattern.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === normalized,
    `${field} must be ISO UTC`,
  );
}

function requireTaskSection(value, field) {
  requireObject(value, field);
  requireCondition(
    taskStatuses.has(value.status),
    `${field} has unknown task status ${String(value.status)}`,
  );
  requireString(value.source, `${field}.source`);
  requireIsoInstant(value.observedAt, `${field}.observedAt`);
}

function requireLink(value, field) {
  requireTaskSection(value, field);
  requireString(value.label, `${field}.label`);
  requireString(value.path, `${field}.path`);
  requireString(value.kind, `${field}.kind`);
  requireCondition(
    !value.path.startsWith('/') &&
      !value.path.includes('..') &&
      !value.path.includes('\\') &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value.path),
    `${field}.path must be a conservative repository-relative path`,
  );
  requireCondition(
    ['architecture', 'host', 'project', 'security'].includes(value.kind),
    `${field}.kind is unknown`,
  );
}

function requireCheckItem(value, field, inheritedCommit) {
  requireObject(value, field);
  requireString(value.id, `${field}.id`);
  requireCondition(
    checkStatuses.has(value.status),
    `${field} has unknown check status ${String(value.status)}`,
  );
  if ('source' in value) requireString(value.source, `${field}.source`);
  if ('observedAt' in value) requireIsoInstant(value.observedAt, `${field}.observedAt`);
  if (value.status === 'PASS') {
    const commit = value.commit ?? inheritedCommit;
    requireCondition(
      commitPattern.test(commit ?? '') &&
        typeof value.evidence === 'string' &&
        value.evidence.trim().length > 0,
      `${field} PASS requires a 40-character commit and evidence`,
    );
    requireString(value.evidence, `${field}.evidence`);
    if ('exitCode' in value) requireCondition(value.exitCode === 0, `${field} PASS requires exitCode 0`);
  }
  if (value.status === 'FAIL' && 'exitCode' in value)
    requireCondition(
      Number.isInteger(value.exitCode) && value.exitCode !== 0,
      `${field} FAIL requires non-zero exitCode`,
    );
}

export function validateDashboardSnapshot(value) {
  requireObject(value, 'root');
  requireCondition(value.schemaVersion === 1, 'schemaVersion must be 1');
  requireIsoInstant(value.generatedAt, 'generatedAt');
  requireString(value.generatorVersion, 'generatorVersion');
  requireObject(value.generated, 'generated');
  requireCondition(value.generated.doNotEdit === true, 'generated.doNotEdit must be true');
  requireString(value.generated.command, 'generated.command');
  requireString(value.generated.source, 'generated.source');

  for (const field of [
    'project',
    'integration',
    'decisions',
    'security',
    'git',
    'hackathon',
    'network',
    'host',
  ])
    requireTaskSection(value[field], field);
  requireString(value.project.name, 'project.name');
  requireString(value.project.branch, 'project.branch');

  requireArray(value.workers, 'workers');
  value.workers.forEach((worker, index) => {
    requireTaskSection(worker, `workers[${index}]`);
    requireString(worker.id, `workers[${index}].id`);
  });
  requireCondition(
    value.workers.length === 2 && value.workers[0].id === 'worker-a' && value.workers[1].id === 'worker-b',
    'workers must contain worker-a and worker-b exactly once in canonical order',
  );
  requireArray(value.tasks, 'tasks');
  value.tasks.forEach((task, index) => {
    requireTaskSection(task, `tasks[${index}]`);
    requireString(task.id, `tasks[${index}].id`);
    requireString(task.title, `tasks[${index}].title`);
  });

  requireArray(value.decisions.items, 'decisions.items');
  requireObject(value.management, 'management');
  for (const field of ['currentStatus', 'workQueue', 'changelog'])
    requireTaskSection(value.management[field], `management.${field}`);

  requireObject(value.security.counts, 'security.counts');
  for (const severity of ['critical', 'high', 'medium', 'low'])
    requireCondition(
      Number.isInteger(value.security.counts[severity]) && value.security.counts[severity] >= 0,
      `security.counts.${severity} must be a non-negative integer`,
    );
  requireArray(value.security.findings, 'security.findings');
  value.security.findings.forEach((finding, index) => {
    const field = `security.findings[${index}]`;
    requireObject(finding, field);
    requireCondition(
      findingSeverities.has(finding.severity),
      `${field}.severity is unknown: ${String(finding.severity)}`,
    );
  });

  requireObject(value.tests, 'tests');
  requireCondition(
    checkStatuses.has(value.tests.status),
    `tests has unknown check status ${String(value.tests.status)}`,
  );
  requireString(value.tests.source, 'tests.source');
  requireIsoInstant(value.tests.observedAt, 'tests.observedAt');
  requireArray(value.tests.items, 'tests.items');
  value.tests.items.forEach((item, index) => requireCheckItem(item, `tests.items[${index}]`));

  requireObject(value.build, 'build');
  requireCondition(
    checkStatuses.has(value.build.status),
    `build has unknown check status ${String(value.build.status)}`,
  );
  requireString(value.build.source, 'build.source');
  requireIsoInstant(value.build.observedAt, 'build.observedAt');

  requireArray(value.host.links, 'host.links');
  value.host.links.forEach((link, index) => requireLink(link, `host.links[${index}]`));

  for (const field of ['knownIssues', 'blockers', 'links', 'sourceHealth', 'dashboardLog'])
    requireArray(value[field], field);
  value.links.forEach((link, index) => requireLink(link, `links[${index}]`));
  value.sourceHealth.forEach((sourceRecord, index) =>
    requireTaskSection(sourceRecord, `sourceHealth[${index}]`),
  );
  value.dashboardLog.forEach((diagnostic, index) => {
    const field = `dashboardLog[${index}]`;
    requireObject(diagnostic, field);
    requireCondition(['warning', 'error'].includes(diagnostic.level), `${field}.level is unknown`);
    requireString(diagnostic.code, `${field}.code`);
    requireString(diagnostic.source, `${field}.source`);
    if ('detail' in diagnostic) requireString(diagnostic.detail, `${field}.detail`);
  });
  return value;
}

export function validateCheckReport(value) {
  requireObject(value, 'check report');
  requireCondition(value.schemaVersion === 1, 'check report schemaVersion must be 1');
  requireCondition(value.complete === true, 'check report complete must be true');
  requireString(value.branch, 'check report branch');
  requireCondition(
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(value.branch) &&
      !value.branch.includes('..') &&
      !value.branch.includes('@{'),
    'check report branch is invalid',
  );
  requireCondition(
    commitPattern.test(value.commit ?? ''),
    'check report commit must contain 40 lowercase hex characters',
  );
  requireCondition(
    commitPattern.test(value.tree ?? ''),
    'check report tree must contain 40 lowercase hex characters',
  );
  requireIsoInstant(value.startedAt, 'check report startedAt');
  requireIsoInstant(value.finishedAt, 'check report finishedAt');
  requireArray(value.checks, 'check report checks');
  requireCondition(value.checks.length > 0, 'check report checks must not be empty');
  value.checks.forEach((check, index) => {
    const field = `check report checks[${index}]`;
    requireCheckItem(check, field, value.commit);
    requireIsoInstant(check.startedAt, `${field}.startedAt`);
    requireIsoInstant(check.finishedAt, `${field}.finishedAt`);
    requireCondition(
      Number.isFinite(check.durationMs) && check.durationMs >= 0,
      `${field}.durationMs must be non-negative`,
    );
    requireCondition(
      check.exitCode === null || Number.isInteger(check.exitCode),
      `${field}.exitCode must be an integer or null`,
    );
  });
  return value;
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildDashboardSnapshot,
  checkDashboardArtifacts,
  main,
  parseBuildArgs,
  writeDashboardArtifacts,
} from '../tools/build-management-dashboard.mjs';
import { CHECK_REGISTRY } from '../tools/management-dashboard/checks.mjs';
import { validateDashboardSnapshot } from '../tools/management-dashboard/schema.mjs';

const observedAt = '2026-09-08T15:30:00.000Z';
const currentCommit = '5555555555555555555555555555555555555555';
const currentTree = '6666666666666666666666666666666666666666';
const staleCommit = '7777777777777777777777777777777777777777';

function source(sourcePath, data, status = 'READY') {
  return { status, source: sourcePath, observedAt, ...(data === undefined ? {} : { data }) };
}

function fixtureSources() {
  return {
    observedAt,
    roadmap: source('planning/roadmap.json', {
      project: { name: 'QuantPass', network: 'Robinhood Chain Testnet', chainId: 46630 },
      phases: [
        { id: 'P0', name: '基线' },
        { id: 'P1', name: '治理与威胁模型' },
      ],
      tasks: [
        {
          id: 'BASE-001',
          phase: 'P0',
          title: '公开基线',
          status: 'done',
          priority: 'P1',
          risk: 'medium',
          acceptance: ['public'],
          evidence: ['README.md'],
          dependsOn: [],
          updatedAt: '2026-09-07',
        },
        {
          id: 'THREAT-001',
          phase: 'P1',
          title: '威胁模型',
          status: 'in_progress',
          priority: 'P0',
          risk: 'critical',
          acceptance: ['reviewed'],
          evidence: [],
          dependsOn: ['BASE-001'],
          blockedReason: '等待独立复核',
          updatedAt: '2026-09-08',
        },
      ],
      releaseGates: [
        { id: 'G0', name: '公开基线', status: 'passed', checks: [] },
        { id: 'G4', name: '比赛提交', status: 'open', checks: [] },
      ],
    }),
    riskRegister: source('planning/risk-register.json', {
      risks: [
        {
          id: 'R-001',
          title: '信任根替换',
          severity: 'critical',
          status: 'open',
          owner: 'security',
          scenario: '攻击者替换信任根',
          mitigationTasks: ['TRUST-001'],
          verification: '固定摘要',
          residualRisk: '发布链仍需独立保护',
        },
        { id: 'R-002', title: '可恢复性', severity: 'high', status: 'mitigated', owner: 'runtime' },
      ],
    }),
    securityBoundary: source('planning/security-boundary.json', {
      environment: { chainId: 46630, mainnetSupported: false, realFundsSupported: false },
    }),
    workers: {
      workerA: source('docs/management/workers/worker-a.md', undefined, 'NOT_AVAILABLE'),
      workerB: source('docs/management/workers/worker-b.md', {
        current: {
          currentTask: 'B5',
          status: 'IN_PROGRESS',
          branch: 'macbeth/dashboard',
          lastKnownCommit: currentCommit,
          blocker: 'NONE',
          lastActivity: '2026-09-08T23:07:02+08:00',
        },
        activities: [],
      }),
    },
    management: {
      currentStatus: source('docs/management/CURRENT-STATUS.md', undefined, 'NOT_AVAILABLE'),
      workQueue: source('docs/management/WORK-QUEUE.md', undefined, 'NOT_AVAILABLE'),
      decisions: source('docs/management/DECISIONS.md', undefined, 'NOT_AVAILABLE'),
      changelog: source('docs/management/CHANGELOG.md', undefined, 'NOT_AVAILABLE'),
    },
    taskRecords: [
      source('docs/management/tasks/B3.md', {
        id: 'B3',
        title: 'VERIFY REMOTE ACCESS + TMUX',
        status: 'BLOCKED',
        sections: {
          'Known limitations': ['LAN SSH remains enabled'],
          'Not fully resolved': ['authorized key cleanup'],
          'Deferred work': ['NONE'],
          Blockers: ['USER_DECISION'],
          'Residual risks': ['approved key remains authorized'],
        },
      }),
    ],
    documents: {
      architecture: source('docs/adr', ['docs/adr/0001.md']),
      security: source('docs/security', ['docs/security/report.md']),
      host: source('docs/management/host', ['docs/management/host/HOST-SETUP.md']),
      project: source('docs', ['docs/ROBINHOOD-CHAIN.md']),
    },
  };
}

function gitState() {
  return {
    status: 'READY',
    source: '.git',
    observedAt,
    branch: 'macbeth/dashboard',
    commit: currentCommit,
    tree: currentTree,
    dirtyFiles: 3,
    aheadBehind: { ahead: 4, behind: 0 },
    recentCommits: [],
  };
}

function completeCheckReport(commit, profile = 'full', tree = currentTree, branch = 'macbeth/dashboard') {
  const timestamp = '2026-09-08T15:20:00.000Z';
  return {
    schemaVersion: 1,
    complete: true,
    profile,
    branch,
    commit,
    tree,
    startedAt: timestamp,
    finishedAt: timestamp,
    checks: CHECK_REGISTRY.filter((check) => check.profiles.includes(profile)).map((check) =>
      check.available
        ? {
            id: check.id,
            status: 'PASS',
            startedAt: timestamp,
            finishedAt: timestamp,
            durationMs: 0,
            exitCode: 0,
            evidence: `.checks/management/run/${check.id}.log`,
          }
        : {
            id: check.id,
            status: 'NOT_RUN',
            startedAt: timestamp,
            finishedAt: timestamp,
            durationMs: 0,
            exitCode: null,
            reason: 'APPROVED_TOOLCHAIN_NOT_AVAILABLE',
          },
    ),
  };
}

function checkReport(commit = currentCommit) {
  return completeCheckReport(commit, 'quick');
}

test('builder produces every required section without upgrading roadmap completion', () => {
  const snapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    checkReport: checkReport(),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': true,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });

  assert.equal(validateDashboardSnapshot(snapshot), snapshot);
  assert.equal(snapshot.project.name, 'QuantPass');
  assert.equal(snapshot.project.branch, 'macbeth/dashboard');
  assert.equal(snapshot.project.currentWave, 'P1 · 治理与威胁模型');
  assert.equal(snapshot.tasks.find((task) => task.id === 'BASE-001').status, 'DONE');
  assert.equal(snapshot.tasks.find((task) => task.id === 'THREAT-001').status, 'IN_PROGRESS');
  assert.equal(snapshot.tasks.find((task) => task.id === 'THREAT-001').blockedBy, '等待独立复核');
  assert.equal(
    snapshot.tasks.some((task) => task.status === 'VERIFIED_DONE'),
    false,
  );
  assert.deepEqual(snapshot.security.counts, { critical: 1, high: 1, medium: 0, low: 0 });
  assert.equal(snapshot.security.status, 'BLOCKED');
  assert.equal(snapshot.security.findings[0].attackPath, '攻击者替换信任根');
  assert.deepEqual(snapshot.security.findings[0].mitigation, ['TRUST-001']);
  assert.equal(snapshot.tests.status, 'PASS');
  assert.equal(snapshot.build.status, 'PASS');
  assert.equal(snapshot.hackathon.status, 'NOT_STARTED');
  assert.deepEqual(
    snapshot.hackathon.releaseGates.map((gate) => gate.id),
    ['G0', 'G4'],
  );
  assert.ok(snapshot.sourceHealth.every((item) => item.source && item.status));
  assert.equal(snapshot.host.status, 'BLOCKED');
  assert.ok(snapshot.knownIssues.some((item) => item.title === 'authorized key cleanup'));
  assert.ok(snapshot.knownIssues.some((item) => item.title === 'approved key remains authorized'));
  assert.ok(snapshot.blockers.some((item) => item.title === 'USER_DECISION'));
});

test('builder exposes unavailable sources, open blockers, and stale check evidence', () => {
  const snapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    checkReport: checkReport(staleCommit),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': true,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });

  assert.equal(snapshot.workers.find((worker) => worker.id === 'worker-a').status, 'NOT_AVAILABLE');
  assert.equal(snapshot.decisions.status, 'NOT_AVAILABLE');
  assert.equal(snapshot.tests.status, 'BLOCKED');
  assert.match(snapshot.tests.reason, /STALE_COMMIT/);
  assert.ok(snapshot.blockers.some((item) => item.id === 'R-001'));
  assert.ok(snapshot.knownIssues.some((item) => item.source === 'docs/management/DECISIONS.md'));
  assert.ok(snapshot.dashboardLog.some((item) => item.code === 'OPTIONAL_SOURCE_NOT_AVAILABLE'));
});

test('builder fails closed for mandatory data and records broken links as actionable diagnostics', () => {
  const malformed = fixtureSources();
  malformed.roadmap = source('planning/roadmap.json', undefined, 'DATA_SOURCE_ERROR');
  assert.throws(
    () =>
      buildDashboardSnapshot({
        sources: malformed,
        git: gitState(),
        observedAt,
        linkStates: {},
      }),
    /MANDATORY_SOURCE_ERROR.*planning\/roadmap\.json/,
  );

  const brokenLinkSnapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': false,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });
  assert.equal(
    brokenLinkSnapshot.links.find((link) => link.path === 'docs/adr/0001.md').status,
    'DATA_SOURCE_ERROR',
  );
  assert.ok(
    brokenLinkSnapshot.dashboardLog.some(
      (item) => item.code === 'BROKEN_INTERNAL_LINK' && item.source === 'docs/adr/0001.md',
    ),
  );

  for (const invalidRiskData of [
    {},
    { risks: 'invalid' },
    { risks: [{ id: 'R-invalid', title: 'invalid', severity: 'unknown', status: 'open' }] },
    { risks: [{ id: '', title: 'invalid', severity: 'low', status: 'open' }] },
  ]) {
    const invalidRisks = fixtureSources();
    invalidRisks.riskRegister = source('planning/risk-register.json', invalidRiskData);
    assert.throws(
      () =>
        buildDashboardSnapshot({
          sources: invalidRisks,
          git: gitState(),
          observedAt,
          linkStates: {},
        }),
      /INVALID_RISK_REGISTER: planning\/risk-register\.json/,
    );
  }
});

test('ordinary build preserves the last valid artifact pair when a collected link becomes invalid', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-broken-link-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linkPath = join(root, 'docs/adr/0001.md');
  const dashboardPath = join(root, 'docs/management/dashboard/data/dashboard.json');
  const buildLogPath = join(root, 'docs/management/dashboard/data/build-log.json');

  await mkdir(join(root, 'planning'), { recursive: true });
  await mkdir(join(root, 'docs/adr'), { recursive: true });
  await writeFile(
    join(root, 'planning/roadmap.json'),
    `${JSON.stringify({
      project: { name: 'QuantPass', network: 'Robinhood Chain Testnet', chainId: 46630 },
      tasks: [],
      releaseGates: [],
    })}\n`,
  );
  await writeFile(linkPath, '# Architecture decision\n');
  const lastValidSnapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    checkReport: checkReport(),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': true,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });
  await writeDashboardArtifacts(root, lastValidSnapshot);
  const originalDashboard = await readFile(dashboardPath, 'utf8');
  const originalBuildLog = await readFile(buildLogPath, 'utf8');
  execFileSync('git', ['init', '--quiet', '-b', 'master'], { cwd: root });
  execFileSync('git', ['add', '--all'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'last valid dashboard',
    ],
    { cwd: root },
  );

  const originalObjectValues = Object.values;
  let invalidated = false;
  Object.values = function valuesWithPostCollectionInvalidation(value) {
    const values = originalObjectValues(value);
    if (
      !invalidated &&
      value?.architecture?.source === 'docs/adr' &&
      value.architecture.data?.includes('docs/adr/0001.md')
    ) {
      unlinkSync(linkPath);
      invalidated = true;
    }
    return values;
  };
  try {
    await assert.rejects(
      () => main([`--observed-at=${observedAt}`], { root, environment: {} }),
      /BROKEN_INTERNAL_LINK: docs\/adr\/0001\.md/,
    );
  } finally {
    Object.values = originalObjectValues;
  }

  assert.equal(invalidated, true);
  assert.equal(await readFile(dashboardPath, 'utf8'), originalDashboard);
  assert.equal(await readFile(buildLogPath, 'utf8'), originalBuildLog);
});

test('artifact writes are deterministic, checkable, atomic, and retain the last valid output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const snapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    checkReport: checkReport(),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': true,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });
  const generatedBearer = ['generated', 'bearer', 'credential', '0123456789'].join('-');
  const generatedClientSecret = ['generated', 'client', 'secret', '0123456789'].join('-');
  const generatedJsonToken = ['generated', 'json', 'oauth', '0123456789'].join('-');
  const generatedBareBearer = ['generated', 'bare', 'bearer', '0123456789'].join('-');
  const generatedDeviceCode = ['generated', 'device', 'code', '0123456789'].join('-');
  snapshot.knownIssues.push({
    id: 'synthetic-redaction-check',
    title: `Authorization: Bearer ${generatedBearer}`,
    detail: `https://auth.example.test/callback?client_secret=${generatedClientSecret}`,
    source: 'test fixture',
  });
  snapshot.knownIssues.push({
    id: 'synthetic-oauth-boundary-check',
    title: `Bearer ${generatedBareBearer}`,
    detail: `https://auth.example.test/device?device_code=${generatedDeviceCode}`,
    source: 'test fixture',
  });
  snapshot.knownIssues.push({
    id: 'synthetic-json-redaction-check',
    title: `{"Authorization":"Bearer ${generatedJsonToken}"}`,
    source: 'test fixture',
  });

  await writeDashboardArtifacts(root, snapshot);
  const dashboardPath = join(root, 'docs/management/dashboard/data/dashboard.json');
  const buildLogPath = join(root, 'docs/management/dashboard/data/build-log.json');
  const original = await readFile(dashboardPath, 'utf8');
  const dashboard = JSON.parse(original);
  const buildLog = JSON.parse(await readFile(buildLogPath, 'utf8'));
  assert.doesNotMatch(
    original,
    new RegExp(
      `${generatedBearer}|${generatedClientSecret}|${generatedJsonToken}|${generatedBareBearer}|${generatedDeviceCode}`,
    ),
  );
  assert.match(original, /\[REDACTED\]|%5BREDACTED%5D/);
  assert.equal(await checkDashboardArtifacts(root, snapshot), true);
  assert.equal(original.endsWith('\n'), true);
  assert.deepEqual(dashboard.generated, {
    doNotEdit: true,
    command: 'npm run management:build',
    source: 'tools/build-management-dashboard.mjs',
  });
  assert.deepEqual(buildLog.generated, dashboard.generated);
  assert.equal(buildLog.status, 'WARNING');
  assert.ok(dashboard.dashboardLog.some((item) => item.code === 'OPTIONAL_SOURCE_NOT_AVAILABLE'));
  assert.ok(buildLog.diagnostics.some((item) => item.code === 'OPTIONAL_SOURCE_NOT_AVAILABLE'));
  assert.deepEqual(
    (await readdir(join(root, 'docs/management/dashboard/data'))).filter((name) => name.endsWith('.tmp')),
    [],
  );

  const changed = structuredClone(snapshot);
  changed.project.name = 'drift';
  assert.equal(await checkDashboardArtifacts(root, changed), false);

  await assert.rejects(() => writeDashboardArtifacts(root, { ...snapshot, generatedAt: 'invalid' }));
  assert.equal(await readFile(dashboardPath, 'utf8'), original);
});

test('artifact writer rejects a symlinked output directory without touching external files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-build-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-build-target-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(root, 'docs/management/dashboard'), { recursive: true });
  await symlink(outside, join(root, 'docs/management/dashboard/data'));
  const sentinelDashboard = 'external dashboard must remain unchanged\n';
  const sentinelLog = 'external log must remain unchanged\n';
  await writeFile(join(outside, 'dashboard.json'), sentinelDashboard);
  await writeFile(join(outside, 'build-log.json'), sentinelLog);
  const snapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    checkReport: checkReport(),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': true,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });

  await assert.rejects(
    () => writeDashboardArtifacts(root, snapshot),
    /OUTPUT_DIRECTORY_(?:SYMLINK|OUTSIDE_REPOSITORY)/,
  );
  assert.equal(await readFile(join(outside, 'dashboard.json'), 'utf8'), sentinelDashboard);
  assert.equal(await readFile(join(outside, 'build-log.json'), 'utf8'), sentinelLog);
  assert.deepEqual(
    (await readdir(outside)).filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('artifact writer rejects a symlinked output parent without creating external artifacts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-build-parent-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-build-parent-target-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(root, 'docs/management'), { recursive: true });
  await symlink(outside, join(root, 'docs/management/dashboard'));
  await writeFile(join(outside, 'sentinel.txt'), 'external sentinel\n');
  const snapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    checkReport: checkReport(),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': true,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });

  await assert.rejects(
    () => writeDashboardArtifacts(root, snapshot),
    /OUTPUT_DIRECTORY_(?:SYMLINK|OUTSIDE_REPOSITORY)/,
  );
  assert.equal(await readFile(join(outside, 'sentinel.txt'), 'utf8'), 'external sentinel\n');
  assert.deepEqual(await readdir(outside), ['sentinel.txt']);
});

test('artifact pair replacement rolls back both files when installation is interrupted', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-build-transaction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const snapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    checkReport: checkReport(),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': true,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });
  await writeDashboardArtifacts(root, snapshot);
  const outputDirectory = join(root, 'docs/management/dashboard/data');
  const originalDashboard = await readFile(join(outputDirectory, 'dashboard.json'), 'utf8');
  const originalBuildLog = await readFile(join(outputDirectory, 'build-log.json'), 'utf8');
  const changed = structuredClone(snapshot);
  changed.project.name = 'transaction-interrupted';
  let renameCount = 0;

  await assert.rejects(
    () =>
      writeDashboardArtifacts(root, changed, {
        rename: async (source, destination) => {
          renameCount += 1;
          if (renameCount === 2) throw new Error('SIMULATED_INSTALL_FAILURE');
          return rename(source, destination);
        },
      }),
    /SIMULATED_INSTALL_FAILURE/,
  );

  assert.equal(await readFile(join(outputDirectory, 'dashboard.json'), 'utf8'), originalDashboard);
  assert.equal(await readFile(join(outputDirectory, 'build-log.json'), 'utf8'), originalBuildLog);
  assert.deepEqual(
    (await readdir(join(root, 'docs/management/dashboard'))).filter(
      (name) => name.includes('.staging-') || name.includes('.backup-'),
    ),
    [],
  );
});

test('builder CLI accepts only deterministic documented modes', () => {
  assert.deepEqual(parseBuildArgs([]), { mode: 'write' });
  assert.deepEqual(parseBuildArgs(['--check']), { mode: 'check' });
  assert.deepEqual(parseBuildArgs([`--observed-at=${observedAt}`]), {
    mode: 'write',
    observedAt,
  });
  assert.throws(() => parseBuildArgs(['--output=/tmp/file']), /Unknown argument/);
  assert.throws(() => parseBuildArgs(['--observed-at=not-a-date']), /Invalid observed-at/);
  assert.throws(() => parseBuildArgs(['--observed-at=2026-02-30T12:00:00.000Z']), /Invalid observed-at/);
});

test('snapshot sections retain provenance and unavailable modules remain explicit', () => {
  const snapshot = buildDashboardSnapshot({
    sources: fixtureSources(),
    git: gitState(),
    checkReport: checkReport(),
    observedAt,
    linkStates: {
      'docs/adr/0001.md': true,
      'docs/security/report.md': true,
      'docs/management/host/HOST-SETUP.md': true,
      'docs/ROBINHOOD-CHAIN.md': true,
    },
  });
  for (const section of [
    snapshot.project,
    snapshot.integration,
    snapshot.decisions,
    snapshot.security,
    snapshot.tests,
    snapshot.git,
    snapshot.build,
    snapshot.hackathon,
    snapshot.network,
    snapshot.host,
    ...snapshot.workers,
    ...snapshot.tasks,
    ...Object.values(snapshot.management),
    ...snapshot.knownIssues,
    ...snapshot.blockers,
    ...snapshot.links,
    ...snapshot.sourceHealth,
    ...snapshot.dashboardLog,
  ])
    assert.equal(typeof section.source, 'string');
  assert.equal(snapshot.management.currentStatus.status, 'NOT_AVAILABLE');
  assert.equal(snapshot.management.workQueue.status, 'NOT_AVAILABLE');
  assert.equal(snapshot.management.changelog.status, 'NOT_AVAILABLE');
  assert.equal(snapshot.workers.find((worker) => worker.id === 'worker-a').status, 'NOT_AVAILABLE');
  assert.equal(snapshot.decisions.status, 'NOT_AVAILABLE');
  assert.ok(snapshot.links.every((link) => link.status === 'READY'));
});

test('Dashboard operations guide documents only implemented package commands', async () => {
  const repositoryRoot = new URL('../', import.meta.url);
  const [guide, packageText] = await Promise.all([
    readFile(new URL('docs/management/dashboard/README.md', repositoryRoot), 'utf8'),
    readFile(new URL('package.json', repositoryRoot), 'utf8'),
  ]);
  const packageDocument = JSON.parse(packageText);
  for (const command of ['management:checks', 'management:build', 'management:check', 'management:serve']) {
    assert.equal(typeof packageDocument.scripts[command], 'string');
    assert.match(guide, new RegExp(`npm run ${command.replace(':', '\\:')}`));
  }
  for (const path of [
    'test/management-dashboard-schema.test.mjs',
    'test/management-dashboard-sources.test.mjs',
    'test/management-dashboard-checks.test.mjs',
    'test/management-dashboard-build.test.mjs',
    'test/management-dashboard-ui.test.mjs',
    'test/management-dashboard-server.test.mjs',
    'test/public-metadata.test.mjs',
  ])
    assert.match(packageDocument.scripts.test, new RegExp(path.replaceAll('.', '\\.')));
  assert.match(guide, /http:\/\/127\.0\.0\.1:4181/);
  assert.match(guide, /不得绑定.*LAN|LAN.*不得绑定/);
});

test('check mode remains reproducible after the generated snapshot is committed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-check-mode-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'planning'), { recursive: true });
  await writeFile(
    join(root, 'planning/roadmap.json'),
    `${JSON.stringify({
      project: { name: 'QuantPass', network: 'Robinhood Chain Testnet', chainId: 46630 },
      tasks: [],
      releaseGates: [],
    })}\n`,
  );
  execFileSync('git', ['init', '--quiet', '-b', 'master'], { cwd: root });
  execFileSync('git', ['add', '--all'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'baseline',
    ],
    { cwd: root },
  );
  execFileSync('git', ['switch', '--quiet', '-c', 'macbeth/dashboard'], { cwd: root });
  const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const baselineTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  await mkdir(join(root, '.checks/management'), { recursive: true });
  await writeFile(
    join(root, '.checks/management/latest.json'),
    `${JSON.stringify(completeCheckReport(baselineCommit, 'full', baselineTree), null, 2)}\n`,
  );
  execFileSync('git', ['add', '--all'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'version check report',
    ],
    { cwd: root },
  );

  await main([`--observed-at=${observedAt}`], { root });
  execFileSync('git', ['add', '--all'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'generated dashboard',
    ],
    { cwd: root },
  );

  await assert.doesNotReject(() => main(['--check'], { root, environment: {} }));
});

test('check mode uses a versioned report in local, push, PR, queue, and integration layouts', async (t) => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-source-repository-'));
  const cloneParent = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-clean-clone-'));
  const cloneRoot = join(cloneParent, 'checkout');
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  t.after(() => rm(cloneParent, { recursive: true, force: true }));
  await mkdir(join(sourceRoot, 'planning'), { recursive: true });
  await writeFile(
    join(sourceRoot, '.gitignore'),
    '.checks/*\n!.checks/management/\n.checks/management/*\n!.checks/management/latest.json\n',
  );
  await writeFile(
    join(sourceRoot, 'planning/roadmap.json'),
    `${JSON.stringify({
      project: { name: 'QuantPass', network: 'Robinhood Chain Testnet', chainId: 46630 },
      tasks: [],
      releaseGates: [],
    })}\n`,
  );
  await writeFile(
    join(sourceRoot, '.gitattributes'),
    await readFile(new URL('../.gitattributes', import.meta.url), 'utf8'),
  );
  execFileSync('git', ['init', '--quiet', '-b', 'master'], { cwd: sourceRoot });
  execFileSync('git', ['add', '--all'], { cwd: sourceRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'baseline',
    ],
    { cwd: sourceRoot },
  );
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim();
  const baseTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['switch', '--quiet', '-c', 'attacker/report'], { cwd: sourceRoot });
  await writeFile(join(sourceRoot, 'forged.txt'), 'forged sibling\n');
  execFileSync('git', ['add', 'forged.txt'], { cwd: sourceRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'forged sibling',
    ],
    { cwd: sourceRoot },
  );
  const forgedReportCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['switch', '--quiet', 'master'], { cwd: sourceRoot });
  execFileSync('git', ['switch', '--quiet', '-c', 'macbeth/dashboard'], { cwd: sourceRoot });
  await writeFile(join(sourceRoot, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: sourceRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'feature',
    ],
    { cwd: sourceRoot },
  );
  const reportCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim();
  const reportTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim();
  const reportPath = join(sourceRoot, '.checks/management/latest.json');
  await mkdir(join(sourceRoot, '.checks/management'), { recursive: true });
  const validReport = completeCheckReport(reportCommit, 'full', reportTree);

  const missingReportSnapshot = await main([`--observed-at=${observedAt}`], {
    root: sourceRoot,
    environment: {},
  });
  assert.equal(missingReportSnapshot.tests.status, 'NOT_RUN');
  await assert.rejects(
    () => main(['--check'], { root: sourceRoot, environment: {} }),
    /RECORDED_GIT_NOT_CLEAN/,
  );

  const incompleteReport = structuredClone(validReport);
  incompleteReport.checks.pop();
  const reorderedReport = structuredClone(validReport);
  [reorderedReport.checks[0], reorderedReport.checks[1]] = [
    reorderedReport.checks[1],
    reorderedReport.checks[0],
  ];
  const duplicateReport = structuredClone(validReport);
  duplicateReport.checks[1] = structuredClone(duplicateReport.checks[0]);
  const unknownReport = structuredClone(validReport);
  unknownReport.checks[0].id = 'unknown-check';
  const statusTamperedReport = structuredClone(validReport);
  const unavailableCheck = statusTamperedReport.checks.find((check) => check.id === 'foundry');
  unavailableCheck.status = 'PASS';
  unavailableCheck.exitCode = 0;
  unavailableCheck.evidence = '.checks/management/forged/foundry.log';
  delete unavailableCheck.reason;
  for (const invalidReport of [
    incompleteReport,
    reorderedReport,
    duplicateReport,
    unknownReport,
    statusTamperedReport,
  ]) {
    await writeFile(reportPath, `${JSON.stringify(invalidReport, null, 2)}\n`);
    const invalidSnapshot = await main([`--observed-at=${observedAt}`], {
      root: sourceRoot,
      environment: {},
    });
    assert.equal(invalidSnapshot.tests.status, 'DATA_SOURCE_ERROR');
    assert.ok(invalidSnapshot.tests.items.every((item) => item.reason === 'CHECK_REPORT_INVALID'));
  }

  const forgedCommitReport = structuredClone(validReport);
  forgedCommitReport.commit = forgedReportCommit;
  await writeFile(reportPath, `${JSON.stringify(forgedCommitReport, null, 2)}\n`);
  const forgedCommitSnapshot = await main([`--observed-at=${observedAt}`], {
    root: sourceRoot,
    environment: {},
  });
  assert.equal(forgedCommitSnapshot.tests.status, 'DATA_SOURCE_ERROR');

  const staleAncestorReport = completeCheckReport(baseCommit, 'full', baseTree);
  await writeFile(reportPath, `${JSON.stringify(staleAncestorReport, null, 2)}\n`);
  const staleAncestorSnapshot = await main([`--observed-at=${observedAt}`], {
    root: sourceRoot,
    environment: {},
  });
  assert.equal(staleAncestorSnapshot.tests.status, 'DATA_SOURCE_ERROR');

  const forgedTreeReport = structuredClone(validReport);
  forgedTreeReport.tree = 'f'.repeat(40);
  await writeFile(reportPath, `${JSON.stringify(forgedTreeReport, null, 2)}\n`);
  const forgedTreeSnapshot = await main([`--observed-at=${observedAt}`], {
    root: sourceRoot,
    environment: {},
  });
  assert.equal(forgedTreeSnapshot.tests.status, 'DATA_SOURCE_ERROR');

  const forgedBranchReport = structuredClone(validReport);
  forgedBranchReport.branch = 'attacker/dashboard';
  await writeFile(reportPath, `${JSON.stringify(forgedBranchReport, null, 2)}\n`);
  const forgedBranchSnapshot = await main([`--observed-at=${observedAt}`], {
    root: sourceRoot,
    environment: {},
  });
  assert.equal(forgedBranchSnapshot.tests.status, 'DATA_SOURCE_ERROR');

  const validReportText = `${JSON.stringify(validReport, null, 2)}\n`;
  await writeFile(reportPath, validReportText);
  execFileSync('git', ['add', '.checks/management/latest.json'], { cwd: sourceRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'record check evidence',
    ],
    { cwd: sourceRoot },
  );
  assert.equal(
    execFileSync('git', ['check-ignore', '-q', '.checks/management/run/output.log'], {
      cwd: sourceRoot,
    }).toString(),
    '',
  );
  assert.throws(() =>
    execFileSync('git', ['check-ignore', '-q', '.checks/management/latest.json'], {
      cwd: sourceRoot,
      stdio: 'ignore',
    }),
  );

  await main([`--observed-at=${observedAt}`], { root: sourceRoot, environment: {} });
  execFileSync('git', ['add', '--all'], { cwd: sourceRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'generated dashboard',
    ],
    { cwd: sourceRoot },
  );
  const checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', [
    'clone',
    '--quiet',
    '--no-local',
    '--branch',
    'macbeth/dashboard',
    sourceRoot,
    cloneRoot,
  ]);
  const clonedReportPath = join(cloneRoot, '.checks/management/latest.json');
  assert.equal(await readFile(clonedReportPath, 'utf8'), validReportText);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: cloneRoot, encoding: 'utf8' }), '');

  const dashboardPath = join(cloneRoot, 'docs/management/dashboard/data/dashboard.json');
  const buildLogPath = join(cloneRoot, 'docs/management/dashboard/data/build-log.json');
  const before = await Promise.all([readFile(dashboardPath, 'utf8'), readFile(buildLogPath, 'utf8')]);

  await assert.doesNotReject(() => main(['--check'], { root: cloneRoot, environment: {} }));
  const afterLocal = await Promise.all([readFile(dashboardPath, 'utf8'), readFile(buildLogPath, 'utf8')]);
  assert.deepEqual(afterLocal, before);

  await rm(clonedReportPath);
  await assert.rejects(
    () => main(['--check'], { root: cloneRoot, environment: {} }),
    /RECORDED_GIT_NOT_CLEAN/,
  );
  const internalReportTarget = join(cloneRoot, 'private-report.json');
  await writeFile(internalReportTarget, validReportText);
  await symlink('../../private-report.json', clonedReportPath);
  await assert.rejects(
    () => main(['--check'], { root: cloneRoot, environment: {} }),
    /RECORDED_GIT_NOT_CLEAN/,
  );
  await Promise.all([rm(clonedReportPath), rm(internalReportTarget)]);
  await writeFile(clonedReportPath, validReportText);

  for (const invalidReportText of [
    '{malformed-json',
    `${JSON.stringify(incompleteReport, null, 2)}\n`,
    `${JSON.stringify(reorderedReport, null, 2)}\n`,
    `${JSON.stringify(duplicateReport, null, 2)}\n`,
    `${JSON.stringify(unknownReport, null, 2)}\n`,
    `${JSON.stringify(statusTamperedReport, null, 2)}\n`,
  ]) {
    await writeFile(clonedReportPath, invalidReportText);
    await assert.rejects(
      () => main(['--check'], { root: cloneRoot, environment: {} }),
      /RECORDED_GIT_NOT_CLEAN/,
    );
  }
  await writeFile(clonedReportPath, validReportText);

  await writeFile(clonedReportPath, `${JSON.stringify(forgedCommitReport, null, 2)}\n`);
  await assert.rejects(
    () => main(['--check'], { root: cloneRoot, environment: {} }),
    /RECORDED_GIT_NOT_CLEAN/,
  );
  await writeFile(clonedReportPath, validReportText);

  await assert.doesNotReject(() =>
    main(['--check'], {
      root: cloneRoot,
      environment: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/macbeth/dashboard',
        GITHUB_SHA: checkoutCommit,
      },
    }),
  );
  await assert.doesNotReject(() =>
    main(['--check'], {
      root: cloneRoot,
      environment: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/macbeth/dashboard',
        GITHUB_SHA: checkoutCommit,
      },
    }),
  );

  execFileSync('git', ['switch', '--quiet', '--detach', baseCommit], { cwd: cloneRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'merge',
      '--quiet',
      '--no-ff',
      '-m',
      'synthetic pull request merge',
      'refs/remotes/origin/macbeth/dashboard',
    ],
    { cwd: cloneRoot },
  );
  const mergeCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: cloneRoot,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['update-ref', 'refs/remotes/pull/7/merge', mergeCommit], { cwd: cloneRoot });
  execFileSync('git', ['branch', '-D', 'macbeth/dashboard'], { cwd: cloneRoot });
  await assert.doesNotReject(() =>
    main(['--check'], {
      root: cloneRoot,
      environment: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_REF: 'refs/pull/7/merge',
        GITHUB_SHA: mergeCommit,
        GITHUB_BASE_REF: 'master',
        GITHUB_HEAD_REF: 'macbeth/dashboard',
      },
    }),
  );
  const queueBranch = `gh-readonly-queue/master/pr-7-${checkoutCommit}`;
  execFileSync('git', ['update-ref', `refs/remotes/origin/${queueBranch}`, mergeCommit], {
    cwd: cloneRoot,
  });
  await assert.doesNotReject(() =>
    main(['--check'], {
      root: cloneRoot,
      environment: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'merge_group',
        GITHUB_REF: `refs/heads/${queueBranch}`,
        GITHUB_SHA: mergeCommit,
      },
    }),
  );

  execFileSync('git', ['switch', '--quiet', '-C', 'master', baseCommit], { cwd: cloneRoot });
  execFileSync('git', ['merge', '--quiet', '--squash', 'refs/remotes/origin/macbeth/dashboard'], {
    cwd: cloneRoot,
  });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Macbeth',
      '-c',
      'user.email=pdbsy@users.noreply.github.com',
      'commit',
      '--quiet',
      '-m',
      'synthetic linear-history integration',
    ],
    { cwd: cloneRoot },
  );
  const integratedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: cloneRoot,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['update-ref', 'refs/remotes/origin/master', integratedCommit], { cwd: cloneRoot });
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: cloneRoot, encoding: 'utf8' }).trim(),
    execFileSync('git', ['rev-parse', `${checkoutCommit}^{tree}`], {
      cwd: cloneRoot,
      encoding: 'utf8',
    }).trim(),
  );
  await assert.doesNotReject(() => main(['--check'], { root: cloneRoot, environment: {} }));
  await assert.doesNotReject(() =>
    main(['--check'], {
      root: cloneRoot,
      environment: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/master',
        GITHUB_SHA: integratedCommit,
      },
    }),
  );
  const afterCiLayouts = await Promise.all([readFile(dashboardPath, 'utf8'), readFile(buildLogPath, 'utf8')]);
  assert.deepEqual(afterCiLayouts, before);
});

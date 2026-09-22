import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildEvidenceDetails,
  buildOverview,
  loadDashboard,
  safeLink,
  severityClass,
  statusLabel,
} from '../docs/management/dashboard/app.js';

const dashboardRoot = new URL('../docs/management/dashboard/', import.meta.url);
const navigation = [
  '项目预览',
  '任务看板',
  '经理控制面板',
  'Worker A 日志',
  'Worker B 日志',
  '决策日志',
  '安全发现',
  '测试 / CI 状态',
  'Git / 提交历史',
  '构建状态',
  '黑客松合规',
  '发布门禁',
  '已知问题',
  '阻塞项',
  '架构 / ADR',
  '项目文档',
  'Robinhood 测试网',
  '项目变更日志',
  'SSH 主机状态',
  '原始证据 / 报告',
];

test('HTML is a CSP-constrained Chinese shell with all required navigation', async () => {
  const html = await readFile(new URL('index.html', dashboardRoot), 'utf8');
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /ALPHAFORGE CONTROL CENTER/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ])
    assert.match(html, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /href="#main-content"/);
  assert.match(html, /<main[^>]+id="main-content"/);
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css"\s*\/?>/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /<style\b|<script(?![^>]+src=)[^>]*>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<form\b|https?:\/\//i);
  for (const label of navigation) assert.match(html, new RegExp(label.replace('/', '\\/')));
});

test('renderer source uses text-only DOM writes and no HTML injection sinks', async () => {
  const script = await readFile(new URL('app.js', dashboardRoot), 'utf8');
  assert.match(script, /\.textContent\s*=/);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.style\.cssText/);
  assert.doesNotMatch(script, /setAttribute\(\s*['"]on/i);
});

test('closed UI status labels reject unknown values', () => {
  assert.equal(statusLabel('VERIFIED_DONE'), '已验证完成');
  assert.equal(statusLabel('NOT_AVAILABLE'), '不可用');
  assert.equal(statusLabel('FAIL'), '失败');
  assert.throws(() => statusLabel('ALL_GREEN'), /UNKNOWN_STATUS/);
  assert.equal(severityClass('critical'), 'severity-critical');
  assert.throws(() => severityClass('critical injected-class'), /UNKNOWN_SEVERITY/);
});

test('links use immutable allowlisted GitHub blobs, fragments, and the fixed loopback preview', () => {
  const commit = '8888888888888888888888888888888888888888';
  assert.equal(
    safeLink('docs/adr/0001.md', commit),
    `https://github.com/pdbsy/quantpass-arbitrum-hackathon/blob/${commit}/docs/adr/0001.md`,
  );
  assert.equal(safeLink('#task-board'), '#task-board');
  assert.equal(safeLink('http://127.0.0.1:4180/'), 'http://127.0.0.1:4180/');
  for (const value of [
    'javascript:alert(1)',
    'https://attacker.example/',
    '../outside',
    '/absolute',
    'docs\\secret',
  ])
    assert.equal(safeLink(value, commit), null);
  assert.equal(safeLink('docs/adr/0001.md', 'not-a-commit'), null);
});

test('raw-evidence model exposes bounded source and diagnostic details, not just counts', () => {
  const details = buildEvidenceDetails({
    sourceHealth: [
      { source: 'docs/missing.md', status: 'NOT_AVAILABLE', observedAt: '2026-09-08T22:19:53.000Z' },
      { source: 'planning/roadmap.json', status: 'READY', observedAt: '2026-09-08T22:19:53.000Z' },
    ],
    dashboardLog: [
      {
        code: 'OPTIONAL_SOURCE_NOT_AVAILABLE',
        level: 'warning',
        source: 'docs/missing.md',
        detail: 'NOT_AVAILABLE',
      },
    ],
  });
  assert.deepEqual(details.sources, [
    {
      source: 'docs/missing.md',
      status: 'NOT_AVAILABLE',
      observedAt: '2026-09-08T22:19:53.000Z',
    },
  ]);
  assert.deepEqual(details.diagnostics, [
    {
      code: 'OPTIONAL_SOURCE_NOT_AVAILABLE',
      level: 'warning',
      source: 'docs/missing.md',
      detail: 'NOT_AVAILABLE',
    },
  ]);
});

test('overview keeps unavailable and blocked state visible', () => {
  const model = buildOverview({
    project: { name: 'AlphaForge', status: 'READY' },
    integration: { status: 'IN_PROGRESS' },
    tasks: [{ status: 'DONE' }, { status: 'BLOCKED' }, { status: 'NOT_STARTED' }],
    security: { status: 'BLOCKED', counts: { critical: 2, high: 1, medium: 0, low: 0 } },
    tests: { status: 'NOT_RUN', items: [] },
    build: { status: 'NOT_RUN' },
    hackathon: { status: 'NOT_STARTED' },
    sourceHealth: [{ status: 'NOT_AVAILABLE' }, { status: 'READY' }],
  });
  assert.deepEqual(model.taskCounts, { total: 3, done: 1, blocked: 1, pending: 1 });
  assert.equal(model.sourceProblems, 1);
  assert.equal(model.tests.status, 'NOT_RUN');
  assert.equal(model.security.status, 'BLOCKED');
});

test('data load failures return an explicit safe error state', async () => {
  const networkFailure = await loadDashboard(async () => {
    throw new Error('sensitive local path');
  });
  assert.deepEqual(networkFailure, {
    state: 'error',
    status: 'DATA_SOURCE_ERROR',
    message: '无法读取 Dashboard 数据。请运行本地生成命令后重试。',
  });

  const invalid = await loadDashboard(async () => ({
    ok: true,
    json: async () => ({ schemaVersion: 999 }),
  }));
  assert.equal(invalid.status, 'DATA_SOURCE_ERROR');
  assert.doesNotMatch(JSON.stringify(invalid), /999|sensitive local path/);

  const dashboard = {
    schemaVersion: 1,
    project: { status: 'READY' },
    integration: { status: 'READY' },
    security: { status: 'READY', findings: [] },
    tests: { status: 'PASS', items: [] },
    build: { status: 'PASS' },
    hackathon: { status: 'NOT_STARTED' },
    network: { status: 'READY' },
    host: { status: 'NOT_AVAILABLE' },
    management: {
      currentStatus: { status: 'NOT_AVAILABLE' },
      workQueue: { status: 'NOT_AVAILABLE' },
      changelog: { status: 'NOT_AVAILABLE' },
    },
    workers: [
      { id: 'worker-a', status: 'NOT_AVAILABLE' },
      { id: 'worker-b', status: 'READY' },
    ],
    tasks: [],
    knownIssues: [],
    blockers: [],
    links: [],
    sourceHealth: [],
    dashboardLog: [],
  };
  dashboard.workers = dashboard.workers.filter((worker) => worker.id !== 'worker-a');
  const missingWorker = await loadDashboard(async () => ({ ok: true, json: async () => dashboard }));
  assert.equal(missingWorker.status, 'DATA_SOURCE_ERROR');
});

test('read-only Worker reports preserve source details and literal bounded search', async () => {
  const { buildWorkerReportPosts, filterWorkerReports } = await import('../docs/management/dashboard/app.js');
  const workers = [
    {
      id: 'worker-a',
      label: 'Worker A',
      source: 'docs/management/WORKER-A.md',
      activities: [
        { timestamp: '2026-09-12T00:00:00Z', task: 'older', result: 'done', unresolved: 'External review' },
        {
          timestamp: '2026-09-13T00:00:00Z',
          task: 'newer',
          result: '<b>literal text</b>',
          tests: 'PASS',
          decision: 'Do not merge',
        },
      ],
    },
  ];
  const original = structuredClone(workers);
  const posts = buildWorkerReportPosts(workers);
  assert.deepEqual(
    posts.map((p) => p.task),
    ['newer', 'older'],
  );
  assert.equal(posts[0].readOnly, true);
  assert.equal(posts[0].body, '<b>literal text</b>');
  assert.equal(posts[0].source, workers[0].source);
  assert.equal(posts[0].decision, 'Do not merge');
  assert.deepEqual(filterWorkerReports(posts, ' EXTERNAL '), [posts[1]]);
  assert.deepEqual(filterWorkerReports(posts, '<b>'), [posts[0]]);
  assert.deepEqual(filterWorkerReports(posts, '[.*]'), []);
  assert.deepEqual(filterWorkerReports(posts, ''), posts);
  assert.throws(() => filterWorkerReports(posts, 'a'.repeat(201)), /INVALID_REPORT_QUERY/);
  assert.deepEqual(workers, original);
  const html = await readFile(new URL('index.html', dashboardRoot), 'utf8');
  assert.match(html, /id="worker-report-search"[^>]*maxlength="200"/);
  assert.match(html, /id="worker-reports"/);
  assert.doesNotMatch(html, /post-composer|publish-post/);
});

test('task views keep blocked tasks distinct and search text literal', async () => {
  const ui = await import('../docs/management/dashboard/app.js');
  const tasks = [
    { id: 'A', status: 'NOT_STARTED' },
    { id: 'B', status: 'PARTIAL' },
    { id: 'C', status: 'BLOCKED' },
    { id: 'D', status: 'VERIFIED_DONE' },
  ];
  assert.deepEqual(ui.groupTasks(tasks), {
    backlog: [tasks[0]],
    active: [tasks[1]],
    blocked: [tasks[2]],
    done: [tasks[3]],
  });
  assert.deepEqual(ui.filterTasks(tasks, 'active'), [tasks[0], tasks[1]]);
  assert.deepEqual(ui.filterTasks(tasks, 'blocked'), [tasks[2]]);
  assert.deepEqual(ui.filterTasks(tasks, 'done'), [tasks[3]]);
  assert.throws(() => ui.filterTasks(tasks, 'unknown'), /UNKNOWN_TASK_FILTER/);
  assert.equal(ui.matchesDashboardSearch(' BLOCKED ', ['blocked']), true);
  assert.equal(ui.matchesDashboardSearch('[.*]', ['anything']), false);
});

test('task detail copies arrays and failed refresh retains the last valid snapshot', async () => {
  const ui = await import('../docs/management/dashboard/app.js');
  const task = { id: 'A', dependsOn: ['B'], acceptance: ['check'], evidence: ['record'] };
  const detail = ui.buildTaskDetail(task);
  detail.dependsOn.push('C');
  detail.acceptance.length = 0;
  detail.evidence.length = 0;
  assert.deepEqual(task, { id: 'A', dependsOn: ['B'], acceptance: ['check'], evidence: ['record'] });
  const previous = { generatedAt: 'previous' };
  assert.equal(ui.selectSnapshotAfterLoad(previous, { state: 'error' }), previous);
  assert.equal(ui.selectSnapshotAfterLoad(null, { state: 'error' }), null);
  assert.deepEqual(ui.selectSnapshotAfterLoad(previous, { state: 'ready', data: { generatedAt: 'new' } }), {
    generatedAt: 'new',
  });
});

test('status labels reject inherited Object properties as unknown statuses', () => {
  for (const value of ['constructor', 'toString', '__proto__', 'hasOwnProperty', ['READY']])
    assert.throws(() => statusLabel(value), /UNKNOWN_STATUS/);
});

const snapshotFixture = JSON.parse(await readFile(new URL('data/dashboard.json', dashboardRoot), 'utf8'));
const invalidUiSnapshots = [
  [
    'array status',
    (s) => {
      s.project.status = ['READY'];
      return s;
    },
  ],
  ['null snapshot', () => null],
  ...['project', 'integration', 'security', 'tests', 'build', 'hackathon', 'network', 'host'].map((field) => [
    `invalid ${field} status`,
    (s) => {
      s[field].status = 'UNREGISTERED';
      return s;
    },
  ]),
  [
    'inherited status',
    (s) => {
      s.project.status = 'constructor';
      return s;
    },
  ],
  [
    'invalid manager status',
    (s) => {
      s.management.currentStatus.status = 'UNREGISTERED';
      return s;
    },
  ],
  ...['workers', 'tasks', 'knownIssues', 'blockers', 'links', 'sourceHealth', 'dashboardLog'].map((field) => [
    `missing ${field} array`,
    (s) => {
      s[field] = null;
      return s;
    },
  ]),
  [
    'extra worker',
    (s) => {
      s.workers.push({ ...s.workers[0] });
      return s;
    },
  ],
  [
    'reordered workers',
    (s) => {
      s.workers.reverse();
      return s;
    },
  ],
  [
    'invalid worker status',
    (s) => {
      s.workers[0].status = 'UNREGISTERED';
      return s;
    },
  ],
  [
    'invalid task status',
    (s) => {
      s.tasks = [{ status: 'UNREGISTERED' }];
      return s;
    },
  ],
  [
    'nonstring link path',
    (s) => {
      s.links = [{ status: 'READY', path: 1, label: 'fixture' }];
      return s;
    },
  ],
  [
    'nonstring link label',
    (s) => {
      s.links = [{ status: 'READY', path: 'docs/fixture.md', label: 1 }];
      return s;
    },
  ],
  [
    'invalid source status',
    (s) => {
      s.sourceHealth = [{ status: 'UNREGISTERED' }];
      return s;
    },
  ],
  [
    'invalid diagnostic level',
    (s) => {
      s.dashboardLog = [{ level: 'info', code: 'fixture', source: 'fixture' }];
      return s;
    },
  ],
  [
    'invalid diagnostic code',
    (s) => {
      s.dashboardLog = [{ level: 'error', code: 1, source: 'fixture' }];
      return s;
    },
  ],
  [
    'invalid diagnostic source',
    (s) => {
      s.dashboardLog = [{ level: 'warning', code: 'fixture', source: 1 }];
      return s;
    },
  ],
  [
    'null diagnostic',
    (s) => {
      s.dashboardLog = [null];
      return s;
    },
  ],
  [
    'invalid check status',
    (s) => {
      s.tests.items = [{ status: 'UNREGISTERED' }];
      return s;
    },
  ],
  [
    'invalid finding severity',
    (s) => {
      s.security.findings = [{ severity: 'UNREGISTERED' }];
      return s;
    },
  ],
];
for (const [label, change] of invalidUiSnapshots)
  test(`dashboard loading rejects ${label} without exposing source details`, async () => {
    const result = await loadDashboard(async () => ({
      ok: true,
      json: async () => change(structuredClone(snapshotFixture)),
    }));
    assert.deepEqual(result, {
      state: 'error',
      status: 'DATA_SOURCE_ERROR',
      message: '无法读取 Dashboard 数据。请运行本地生成命令后重试。',
    });
  });

test('dashboard loading preserves a valid snapshot, rejects unavailable transport and malformed JSON', async () => {
  const snapshot = structuredClone(snapshotFixture);
  const requests = [];
  const valid = await loadDashboard(async (...args) => {
    requests.push(args);
    return { ok: true, json: async () => snapshot };
  });
  assert.deepEqual(valid, { state: 'ready', data: snapshot });
  assert.deepEqual(requests, [['./data/dashboard.json', { credentials: 'same-origin', cache: 'no-store' }]]);
  for (const fetcher of [
    null,
    async () => null,
    async () => ({ ok: false }),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error('private fixture content');
      },
    }),
  ]) {
    const rejected = await loadDashboard(fetcher);
    assert.equal(rejected.status, 'DATA_SOURCE_ERROR');
    assert.doesNotMatch(JSON.stringify(rejected), /private fixture content/);
  }
});

test('UI link policy rejects credentials, queries, overlong and malformed paths', () => {
  const commit = 'a'.repeat(40);
  for (const input of [
    null,
    1,
    '',
    'x'.repeat(513),
    'http://user@127.0.0.1:4180/',
    'http://:pass@127.0.0.1:4180/',
    'http://127.0.0.1:4180/?q=1',
    'http://127.0.0.1:4180/#hash',
    'docs//file.md',
    'docs/a:b',
    'docs/<tag>',
    '#1invalid',
  ])
    assert.equal(safeLink(input, commit), null, String(input));
  assert.equal(safeLink('docs/file.md'), null);
});

test('worker projection and task detail retain safe missing-field fallbacks without mutating inputs', async () => {
  const ui = await import('../docs/management/dashboard/app.js');
  const workers = [
    { id: 'empty' },
    {
      id: 'fixture',
      label: 'Fixture',
      activities: [
        { timestamp: 'invalid' },
        { title: 'Explicit title', action: 'Explicit action', timestamp: 'also invalid' },
      ],
    },
  ];
  const posts = ui.buildWorkerReportPosts(workers);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, 'Worker 工作报告');
  assert.equal(posts[0].body, '未记录结果。');
  assert.equal(posts[1].title, 'Explicit title');
  assert.equal(posts[1].body, 'Explicit action');
  assert.throws(() => ui.filterWorkerReports(posts, null), /INVALID_REPORT_QUERY/);
  assert.deepEqual(ui.buildTaskDetail({ id: 'fixture' }), {
    id: 'fixture',
    dependsOn: [],
    acceptance: [],
    evidence: [],
  });
  assert.equal(ui.matchesDashboardSearch(null, [null]), true);
  assert.equal(ui.matchesDashboardSearch('missing', [null]), false);
});

test('dashboard loading rejects absent render-critical sections before reporting ready', async () => {
  const mutations = [
    (value) => delete value.management,
    (value) => (value.management = null),
    (value) => delete value.management.currentStatus,
    (value) => delete value.management.workQueue,
    (value) => delete value.management.changelog,
    (value) => delete value.git,
    (value) => delete value.decisions,
    (value) => delete value.decisions.items,
    (value) => (value.decisions.items = {}),
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(snapshotFixture);
    mutate(candidate);
    const result = await loadDashboard(async () => ({ ok: true, json: async () => candidate }));
    assert.equal(result.state, 'error');
    assert.equal(result.status, 'DATA_SOURCE_ERROR');
    assert.equal('data' in result, false);
  }
});

test('dashboard loading rejects malformed nested records consumed by renderers', async () => {
  const mutations = [
    (value) => (value.decisions.items = [null]),
    (value) => (value.decisions.items = [{ text: {} }]),
    (value) => (value.git.recentCommits = [null]),
    (value) => (value.git.recentCommits = [{}]),
    (value) => (value.git.commit = {}),
    (value) => (value.workers[0].activities = [null]),
    (value) => (value.workers[0].activities = {}),
    (value) => (value.hackathon.releaseGates = [null]),
    (value) => (value.hackathon.releaseGates = [{ status: 'open', checks: [null] }]),
    (value) => (value.host.links = [null]),
    (value) => (value.knownIssues = [null]),
    (value) => (value.blockers = [null]),
    (value) => (value.security.findings = [{ severity: 'low', component: {} }]),
    (value) => (value.tests.items = [{ status: 'PASS', commit: 123 }]),
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(snapshotFixture);
    mutate(candidate);
    const result = await loadDashboard(async () => ({ ok: true, json: async () => candidate }));
    assert.equal(result.state, 'error');
    assert.equal(result.status, 'DATA_SOURCE_ERROR');
    assert.equal('data' in result, false);
  }
});

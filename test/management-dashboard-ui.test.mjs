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
  assert.match(html, /QUANTPASS CONTROL CENTER/);
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
    project: { name: 'QuantPass', status: 'READY' },
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

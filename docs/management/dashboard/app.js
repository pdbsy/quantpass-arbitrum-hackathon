const STATUS_LABELS = Object.freeze({
  DONE: '完成',
  VERIFIED_DONE: '已验证完成',
  PARTIAL: '部分完成',
  IN_PROGRESS: '进行中',
  READY: '就绪',
  BLOCKED: '阻塞',
  NOT_STARTED: '未开始',
  NOT_AVAILABLE: '不可用',
  DATA_SOURCE_ERROR: '数据源错误',
  PASS: '通过',
  FAIL: '失败',
  NOT_RUN: '未运行',
  ONLINE: '在线',
  OFFLINE: '离线',
});

const ERROR_RESULT = Object.freeze({
  state: 'error',
  status: 'DATA_SOURCE_ERROR',
  message: '无法读取 Dashboard 数据。请运行本地生成命令后重试。',
});
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const browserDocument = globalThis.document;

export function statusLabel(status) {
  const label = STATUS_LABELS[status];
  if (!label) throw new Error(`UNKNOWN_STATUS: ${String(status)}`);
  return label;
}

export function severityClass(severity) {
  if (!SEVERITIES.has(severity)) throw new Error(`UNKNOWN_SEVERITY: ${String(severity)}`);
  return `severity-${severity}`;
}

export function safeLink(value, commit) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  if (/^#[A-Za-z][A-Za-z0-9-]*$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.origin === 'http://127.0.0.1:4180' && !url.username && !url.password && !url.search && !url.hash)
      return url.href;
    return null;
  } catch {
    // Repository paths are handled below.
  }
  if (
    value.startsWith('/') ||
    value.includes('..') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.includes(':') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  )
    return null;
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) return null;
  const encodedPath = value.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/pdbsy/quantpass-arbitrum-hackathon/blob/${commit}/${encodedPath}`;
}

export function buildEvidenceDetails(snapshot) {
  return {
    sources: snapshot.sourceHealth.filter((source) => source.status !== 'READY'),
    diagnostics: [...snapshot.dashboardLog],
  };
}

export function buildOverview(snapshot) {
  const total = snapshot.tasks.length;
  const done = snapshot.tasks.filter((task) => ['DONE', 'VERIFIED_DONE'].includes(task.status)).length;
  const blocked = snapshot.tasks.filter((task) => task.status === 'BLOCKED').length;
  return {
    project: snapshot.project,
    integration: snapshot.integration,
    tests: snapshot.tests,
    security: snapshot.security,
    build: snapshot.build,
    hackathon: snapshot.hackathon,
    taskCounts: { total, done, blocked, pending: total - done - blocked },
    sourceProblems: snapshot.sourceHealth.filter((source) => source.status !== 'READY').length,
  };
}

function validateSnapshotForUi(value) {
  if (!value || value.schemaVersion !== 1) throw new Error('INVALID_SNAPSHOT');
  for (const field of [
    'project',
    'integration',
    'security',
    'tests',
    'build',
    'hackathon',
    'network',
    'host',
  ])
    statusLabel(value[field]?.status);
  for (const item of Object.values(value.management ?? {})) statusLabel(item.status);
  for (const field of [
    'workers',
    'tasks',
    'knownIssues',
    'blockers',
    'links',
    'sourceHealth',
    'dashboardLog',
  ])
    if (!Array.isArray(value[field])) throw new Error('INVALID_SNAPSHOT');
  value.workers.forEach((item) => statusLabel(item.status));
  if (
    value.workers.length !== 2 ||
    value.workers[0]?.id !== 'worker-a' ||
    value.workers[1]?.id !== 'worker-b'
  )
    throw new Error('INVALID_SNAPSHOT');
  value.tasks.forEach((item) => statusLabel(item.status));
  value.links.forEach((item) => {
    statusLabel(item.status);
    if (typeof item.path !== 'string' || typeof item.label !== 'string') throw new Error('INVALID_SNAPSHOT');
  });
  value.sourceHealth.forEach((item) => statusLabel(item.status));
  value.dashboardLog.forEach((item) => {
    if (
      !['warning', 'error'].includes(item?.level) ||
      typeof item.code !== 'string' ||
      typeof item.source !== 'string'
    )
      throw new Error('INVALID_SNAPSHOT');
  });
  value.tests.items.forEach((item) => statusLabel(item.status));
  value.security.findings.forEach((item) => severityClass(item.severity));
  value.blockers.forEach((item) => {
    if (item.severity && SEVERITIES.has(item.severity)) severityClass(item.severity);
  });
  return value;
}

export async function loadDashboard(fetcher = globalThis.fetch) {
  try {
    if (typeof fetcher !== 'function') throw new Error('FETCH_UNAVAILABLE');
    const response = await fetcher('./data/dashboard.json', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response?.ok) throw new Error('FETCH_FAILED');
    return { state: 'ready', data: validateSnapshotForUi(await response.json()) };
  } catch {
    return { ...ERROR_RESULT };
  }
}

function element(tag, className, text) {
  const node = browserDocument.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function badge(status) {
  const node = element('span', `status status-${status.toLowerCase().replaceAll('_', '-')}`);
  node.textContent = `${statusLabel(status)} · ${status}`;
  return node;
}

function sourceNote(item) {
  return element('p', 'source-note', `来源：${item.source ?? 'NOT_AVAILABLE'}`);
}

function empty(container, message = '此来源当前没有可展示记录。') {
  container.append(element('p', 'empty-state', message));
}

function definitionList(entries) {
  const list = element('dl', 'definition-list');
  for (const [label, value] of entries) {
    list.append(element('dt', null, label), element('dd', null, value ?? 'NOT_AVAILABLE'));
  }
  return list;
}

function renderOverview(snapshot) {
  const overview = buildOverview(snapshot);
  browserDocument.querySelector('#project-title').textContent = snapshot.project.name;
  const container = browserDocument.querySelector('#overview');
  clear(container);
  const metrics = [
    ['项目', statusLabel(snapshot.project.status), snapshot.project.status],
    ['分支', snapshot.project.branch, snapshot.integration.status],
    ['提交', snapshot.git.commit?.slice(0, 12) ?? 'NOT_AVAILABLE', snapshot.git.status],
    ['最近更新', snapshot.generatedAt, 'READY'],
    ['当前阶段', snapshot.project.currentWave ?? 'NOT_AVAILABLE', snapshot.integration.status],
    ['集成状态', statusLabel(snapshot.integration.status), snapshot.integration.status],
    [
      '安全',
      `${snapshot.security.counts.critical} Critical · ${snapshot.security.counts.high} High`,
      snapshot.security.status,
    ],
    ['测试证据', statusLabel(snapshot.tests.status), snapshot.tests.status],
    ['发布门禁', snapshot.hackathon.gate?.name ?? 'NOT_AVAILABLE', snapshot.hackathon.status],
    [
      '任务进度',
      `${overview.taskCounts.done}/${overview.taskCounts.total} 完成 · ${overview.taskCounts.blocked} 阻塞`,
      overview.taskCounts.blocked ? 'BLOCKED' : snapshot.integration.status,
    ],
    ['来源异常', String(overview.sourceProblems), overview.sourceProblems ? 'BLOCKED' : 'READY'],
  ];
  for (const [label, value, status] of metrics) {
    const card = element('article', 'metric-card');
    card.append(element('p', 'metric-label', label), element('p', 'metric-value', value), badge(status));
    container.append(card);
  }
}

function panelBody(id) {
  const body = browserDocument.querySelector(`#${id} .panel-body`);
  clear(body);
  return body;
}

function renderTasks(snapshot) {
  const body = panelBody('task-board');
  const tableWrap = element('div', 'table-wrap');
  const table = element('table');
  const head = element('thead');
  const headerRow = element('tr');
  for (const label of ['任务', '负责人', '优先级 / 风险', '状态', '依赖 / 阻塞', '验收 / 证据', '更新'])
    headerRow.append(element('th', null, label));
  head.append(headerRow);
  const rows = element('tbody');
  for (const task of snapshot.tasks) {
    const row = element('tr');
    const identity = element('td');
    identity.append(element('strong', null, task.id), element('span', 'table-subtitle', task.title));
    const status = element('td');
    status.append(badge(task.status));
    const dependency = element('td');
    dependency.append(
      element('span', null, task.dependsOn?.length ? task.dependsOn.join(', ') : 'NONE'),
      element('span', 'table-subtitle', `阻塞：${task.blockedBy ?? 'NONE'}`),
    );
    const evidence = element('td');
    const detail = element('details');
    detail.append(
      element('summary', null, `${task.acceptance?.length ?? 0} 验收 · ${task.evidence?.length ?? 0} 证据`),
    );
    const detailList = element('ul', 'compact-list');
    for (const item of task.acceptance ?? []) detailList.append(element('li', null, `验收：${item}`));
    for (const item of task.evidence ?? []) detailList.append(element('li', null, `证据：${item}`));
    if (!detailList.childElementCount) detailList.append(element('li', null, 'NONE'));
    detail.append(detailList);
    evidence.append(detail);
    row.append(
      identity,
      element('td', null, task.owner),
      element('td', null, `${task.priority} / ${task.risk}`),
      status,
      dependency,
      evidence,
      element('td', null, task.lastUpdate),
    );
    rows.append(row);
  }
  table.append(head, rows);
  tableWrap.append(table);
  body.append(tableWrap, sourceNote(snapshot.project));
}

function renderSourcePanel(id, source, summary) {
  const body = panelBody(id);
  body.append(badge(source.status), element('p', 'panel-summary', summary), sourceNote(source));
}

function renderManager(snapshot) {
  const body = panelBody('manager-control');
  for (const [label, source] of [
    ['当前状态', snapshot.management.currentStatus],
    ['工作队列', snapshot.management.workQueue],
  ]) {
    const item = element('article', 'source-block');
    item.append(element('strong', null, label), badge(source.status));
    if (source.data?.text) item.append(element('pre', 'source-text', source.data.text));
    else item.append(element('p', 'empty-state', `${label}来源不可用。`));
    item.append(sourceNote(source));
    body.append(item);
  }
}

function renderDecisions(snapshot) {
  const body = panelBody('decision-log');
  body.append(badge(snapshot.decisions.status));
  if (!snapshot.decisions.items.length) empty(body, '决策来源不可用；没有推断用户批准状态。');
  for (const decision of snapshot.decisions.items) body.append(element('pre', 'source-text', decision.text));
  body.append(sourceNote(snapshot.decisions));
}

function renderWorker(id, worker) {
  const body = panelBody(id);
  body.append(badge(worker.status));
  if (worker.current)
    body.append(
      definitionList([
        ['当前任务', worker.current.currentTask],
        ['分支', worker.current.branch],
        ['最后提交', worker.current.lastKnownCommit],
        ['阻塞', worker.current.blocker],
        ['最后活动', worker.current.lastActivity],
      ]),
    );
  else empty(body, 'Worker 记录不可用，未推断其任务状态。');
  const activities = worker.activities?.slice(0, 5) ?? [];
  if (activities.length) {
    const list = element('ul', 'record-list activity-list');
    for (const activity of activities) {
      const item = element('li');
      item.append(
        element('strong', null, `${activity.timestamp} · ${activity.task ?? activity.title}`),
        definitionList([
          ['Action', activity.action],
          ['Result', activity.result],
          ['Files', activity.files],
          ['Tests', activity.tests],
          ['Issues', activity.issues],
          ['Unresolved', activity.unresolved],
          ['Decision', activity.decision],
          ['Commit', activity.commit],
        ]),
      );
      list.append(item);
    }
    body.append(list);
  }
  body.append(sourceNote(worker));
}

function renderFindings(snapshot) {
  const body = panelBody('security-findings');
  body.append(badge(snapshot.security.status));
  const list = element('ul', 'record-list');
  for (const finding of snapshot.security.findings) {
    const item = element('li');
    item.append(
      element('span', `severity ${severityClass(finding.severity)}`, finding.severity.toUpperCase()),
      element('strong', null, `${finding.id} · ${finding.title}`),
      element('span', 'muted', `${finding.status} · ${finding.owner}`),
    );
    const detail = element('details');
    detail.append(
      element('summary', null, '攻击路径与处置证据'),
      definitionList([
        ['Component', finding.component?.join(', ') || 'NOT_AVAILABLE'],
        ['Attack Path', finding.attackPath],
        ['Mitigation', finding.mitigation?.join(', ') || 'NOT_AVAILABLE'],
        ['Task', finding.task?.join(', ') || 'NOT_AVAILABLE'],
        ['Evidence', finding.evidence],
        ['Residual Risk', finding.residualRisk],
      ]),
    );
    item.append(detail);
    list.append(item);
  }
  body.append(list, sourceNote(snapshot.security));
}

function renderChecks(snapshot) {
  const body = panelBody('test-status');
  body.append(badge(snapshot.tests.status));
  if (snapshot.tests.reason) body.append(element('p', 'warning-copy', snapshot.tests.reason));
  const list = element('ul', 'check-grid');
  for (const check of snapshot.tests.items) {
    const item = element('li');
    item.append(element('code', null, check.id), badge(check.status));
    if (check.durationMs !== undefined) item.append(element('span', 'muted', `${check.durationMs} ms`));
    const facts = element('span', 'check-facts');
    facts.textContent = `运行：${check.finishedAt ?? 'NOT_RUN'} · 提交：${check.commit?.slice(0, 12) ?? 'NONE'} · 证据：${check.evidence ?? check.reason ?? 'NONE'}`;
    item.append(facts);
    list.append(item);
  }
  body.append(list, sourceNote(snapshot.tests));
}

function renderGit(snapshot) {
  const body = panelBody('git-history');
  body.append(
    badge(snapshot.git.status),
    definitionList([
      ['分支', snapshot.git.branch],
      ['快照提交', snapshot.git.commit?.slice(0, 12)],
      [
        '领先 / 落后',
        `${snapshot.git.aheadBehind?.ahead ?? '?'} / ${snapshot.git.aheadBehind?.behind ?? '?'}`,
      ],
      ['未提交路径', snapshot.git.dirtyFiles],
    ]),
    sourceNote(snapshot.git),
  );
  const history = element('ul', 'record-list');
  for (const commit of snapshot.git.recentCommits ?? []) {
    const item = element('li');
    item.append(
      element('code', null, commit.hash.slice(0, 10)),
      element('strong', null, commit.subject),
      element('span', 'muted', `${commit.author} · ${commit.authoredAt}`),
    );
    history.append(item);
  }
  if (history.childElementCount) body.append(history);
}

function releaseGateUiStatus(status) {
  if (status === 'passed') return 'DONE';
  if (status === 'blocked') return 'BLOCKED';
  if (status === 'open') return 'NOT_STARTED';
  return 'DATA_SOURCE_ERROR';
}

function renderReleaseGates(snapshot) {
  const body = panelBody('release-gates');
  const gates = snapshot.hackathon.releaseGates ?? [];
  if (!gates.length) return empty(body, '发布门禁来源不可用。');
  const list = element('ul', 'record-list');
  for (const gate of gates) {
    const item = element('li');
    const passed = (gate.checks ?? []).filter((check) => check.status === 'passed').length;
    item.append(
      element('strong', null, `${gate.id} · ${gate.name}`),
      badge(releaseGateUiStatus(gate.status)),
      element('span', 'muted', `${passed}/${gate.checks?.length ?? 0} 检查通过`),
    );
    list.append(item);
  }
  body.append(list, sourceNote(snapshot.hackathon));
}

function renderRecords(id, records, emptyMessage) {
  const body = panelBody(id);
  if (!records.length) {
    empty(body, emptyMessage);
    return;
  }
  const list = element('ul', 'record-list');
  for (const record of records) {
    const item = element('li');
    item.append(element('strong', null, `${record.id ?? '记录'} · ${record.title ?? record.source}`));
    if (record.severity && SEVERITIES.has(record.severity))
      item.append(element('span', `severity ${severityClass(record.severity)}`, record.severity));
    if (record.status && STATUS_LABELS[record.status]) item.append(badge(record.status));
    list.append(item);
  }
  body.append(list);
}

function appendLinks(body, links, emptyMessage, commit) {
  if (!links.length) return empty(body, emptyMessage);
  const list = element('ul', 'link-list');
  for (const link of links) {
    const href = link.status === 'READY' ? safeLink(link.path, commit) : null;
    const item = element('li');
    if (href) {
      const anchor = element('a', null, link.label);
      anchor.href = href;
      if (href.startsWith('https://')) anchor.rel = 'noreferrer noopener';
      item.append(anchor);
    } else item.append(element('span', null, link.label));
    item.append(element('span', 'muted', link.kind));
    list.append(item);
  }
  body.append(list);
}

function renderLinks(id, links, emptyMessage, commit) {
  appendLinks(panelBody(id), links, emptyMessage, commit);
}

function renderHost(snapshot) {
  const body = panelBody('ssh-host');
  body.append(badge(snapshot.host.status), element('p', 'panel-summary', snapshot.host.summary));
  if (snapshot.host.links?.length) {
    const list = element('ul', 'link-list');
    for (const link of snapshot.host.links) {
      const href = safeLink(link.path, snapshot.git.commit);
      const item = element('li');
      if (href) {
        const anchor = element('a', null, link.label);
        anchor.href = href;
        item.append(anchor);
      } else item.append(element('span', null, link.label));
      list.append(item);
    }
    body.append(list);
  }
  body.append(sourceNote(snapshot.host));
}

function renderRawEvidence(snapshot) {
  const body = panelBody('raw-evidence');
  const evidence = buildEvidenceDetails(snapshot);
  body.append(element('h3', null, '来源异常'));
  if (!evidence.sources.length) empty(body, '所有已配置来源均处于 READY。');
  else {
    const sources = element('ul', 'record-list');
    for (const source of evidence.sources) {
      const item = element('li');
      item.append(
        element('strong', null, source.source),
        badge(source.status),
        element('span', 'muted', `${source.error ?? 'NO_ERROR_CODE'} · ${source.observedAt}`),
      );
      sources.append(item);
    }
    body.append(sources);
  }

  body.append(element('h3', null, '生成诊断'));
  if (!evidence.diagnostics.length) empty(body, '生成器没有记录诊断。');
  else {
    const diagnostics = element('ul', 'record-list');
    for (const diagnostic of evidence.diagnostics) {
      const item = element('li');
      item.append(
        element('strong', null, diagnostic.code),
        element('span', 'muted', `${diagnostic.level} · ${diagnostic.source}`),
        element('span', null, diagnostic.detail ?? 'NO_DETAIL'),
      );
      diagnostics.append(item);
    }
    body.append(diagnostics);
  }

  body.append(element('h3', null, '可审阅记录'));
  appendLinks(body, snapshot.links, '尚无可安全链接的原始证据。', snapshot.git.commit);
}

function renderDashboard(snapshot) {
  renderOverview(snapshot);
  renderTasks(snapshot);
  renderManager(snapshot);
  renderWorker(
    'worker-a',
    snapshot.workers.find((worker) => worker.id === 'worker-a'),
  );
  renderWorker(
    'worker-b',
    snapshot.workers.find((worker) => worker.id === 'worker-b'),
  );
  renderDecisions(snapshot);
  renderFindings(snapshot);
  renderChecks(snapshot);
  renderGit(snapshot);
  renderSourcePanel('build-status', snapshot.build, snapshot.build.reason ?? '构建证据来自固定检查记录。');
  renderSourcePanel(
    'hackathon-compliance',
    snapshot.hackathon,
    snapshot.hackathon.gate?.name ?? '比赛提交门禁不可用。',
  );
  renderReleaseGates(snapshot);
  renderRecords('known-issues', snapshot.knownIssues, '未记录已知问题。');
  renderRecords('blockers', snapshot.blockers, '未记录阻塞项。');
  renderLinks(
    'architecture',
    snapshot.links.filter((link) => link.kind === 'architecture'),
    '架构文档来源不可用。',
    snapshot.git.commit,
  );
  renderLinks(
    'documentation',
    snapshot.links.filter((link) => ['project', 'security'].includes(link.kind)),
    '项目文档来源不可用。',
    snapshot.git.commit,
  );
  renderSourcePanel(
    'network-status',
    snapshot.network,
    `Chain ID：${snapshot.network.chainId ?? 'NOT_AVAILABLE'}；主网与真实资金保持关闭。`,
  );
  renderSourcePanel(
    'changelog',
    snapshot.management.changelog,
    snapshot.management.changelog.data?.text ?? '变更日志缺失时不从提交历史臆造。',
  );
  renderHost(snapshot);
  renderRawEvidence(snapshot);
}

function renderFatal(result) {
  browserDocument.querySelector('#data-state').textContent =
    `${statusLabel(result.status)} · ${result.message}`;
  browserDocument.querySelector('#data-state').classList.add('data-state-error');
}

async function boot() {
  const result = await loadDashboard();
  if (result.state === 'error') return renderFatal(result);
  renderDashboard(result.data);
  browserDocument.querySelector('#data-state').textContent = `快照：${result.data.generatedAt}`;
}

if (browserDocument) boot();

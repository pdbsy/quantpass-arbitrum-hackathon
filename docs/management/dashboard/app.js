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
let currentSnapshot = null;
let taskFilter = 'all';
let taskView = 'board';
let dashboardQuery = '';

export function statusLabel(status) {
  if (typeof status !== 'string' || !Object.hasOwn(STATUS_LABELS, status))
    throw new Error(`UNKNOWN_STATUS: ${String(status)}`);
  return STATUS_LABELS[status];
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

export function groupTasks(tasks) {
  return {
    backlog: tasks.filter((task) => ['NOT_STARTED', 'READY'].includes(task.status)),
    active: tasks.filter((task) => ['IN_PROGRESS', 'PARTIAL'].includes(task.status)),
    blocked: tasks.filter((task) => task.status === 'BLOCKED'),
    done: tasks.filter((task) => ['DONE', 'VERIFIED_DONE'].includes(task.status)),
  };
}

export function filterTasks(tasks, filter) {
  if (filter === 'all') return tasks;
  const grouped = groupTasks(tasks);
  if (filter === 'active') return [...grouped.backlog, ...grouped.active];
  if (filter === 'blocked') return grouped.blocked;
  if (filter === 'done') return grouped.done;
  throw new Error(`UNKNOWN_TASK_FILTER: ${String(filter)}`);
}

export function matchesDashboardSearch(query, values) {
  const needle = String(query ?? '')
    .trim()
    .slice(0, 100)
    .toLocaleLowerCase();
  if (!needle) return true;
  return values.some((value) =>
    String(value ?? '')
      .toLocaleLowerCase()
      .includes(needle),
  );
}

export function buildTaskDetail(task) {
  return {
    ...task,
    dependsOn: [...(task.dependsOn ?? [])],
    acceptance: [...(task.acceptance ?? [])],
    evidence: [...(task.evidence ?? [])],
  };
}

// Adapted from the uncommitted Dashboard report projection; never a write or identity authority.
export function buildWorkerReportPosts(workers) {
  return workers
    .flatMap((worker) =>
      (worker.activities ?? []).map((activity) => ({
        author: worker.label,
        workerId: worker.id,
        source: worker.source,
        readOnly: true,
        title: activity.title ?? activity.task ?? 'Worker 工作报告',
        body: activity.result ?? activity.action ?? '未记录结果。',
        createdAt: activity.timestamp,
        task: activity.task,
        action: activity.action,
        result: activity.result,
        files: activity.files,
        tests: activity.tests,
        issues: activity.issues,
        unresolved: activity.unresolved,
        decision: activity.decision,
        commit: activity.commit,
      })),
    )
    .sort((left, right) => (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0));
}

export function filterWorkerReports(posts, query) {
  if (typeof query !== 'string' || query.length > 200) throw new Error('INVALID_REPORT_QUERY');
  const keyword = query.trim().toLocaleLowerCase();
  return posts.filter(
    (post) =>
      !keyword ||
      [
        post.author,
        post.task,
        post.title,
        post.body,
        post.action,
        post.tests,
        post.issues,
        post.unresolved,
        post.decision,
        post.commit,
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(keyword),
  );
}

function renderWorkerReports(snapshot) {
  const body = panelBody('worker-reports');
  const reports = filterWorkerReports(
    buildWorkerReportPosts(snapshot.workers),
    browserDocument.querySelector('#worker-report-search').value,
  );
  if (!reports.length) empty(body, '没有匹配的已记录 Worker 活动。');
  for (const report of reports) {
    const card = element('article', 'source-block');
    card.append(
      element('h3', null, report.title),
      element('p', 'muted', `${report.author} · ${report.createdAt} · READ_ONLY`),
      definitionList([
        ['Result', report.body],
        ['Action', report.action],
        ['Tests', report.tests],
        ['Issues', report.issues],
        ['Unresolved', report.unresolved],
        ['Decision', report.decision],
        ['Files', report.files],
        ['Commit', report.commit],
      ]),
      sourceNote(report),
    );
    body.append(card);
  }
}

function requireUiRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SNAPSHOT');
}

function requireUiRecords(value, optional = false) {
  if (optional && value == null) return;
  if (!Array.isArray(value)) throw new Error('INVALID_SNAPSHOT');
  value.forEach(requireUiRecord);
}

function requireOptionalUiString(value) {
  if (value != null && typeof value !== 'string') throw new Error('INVALID_SNAPSHOT');
}

function requireOptionalUiStrings(value) {
  if (value != null && (!Array.isArray(value) || value.some((item) => typeof item !== 'string')))
    throw new Error('INVALID_SNAPSHOT');
}

function validateSnapshotForUi(value) {
  if (!value || value.schemaVersion !== 1) throw new Error('INVALID_SNAPSHOT');
  for (const field of [
    'project',
    'integration',
    'git',
    'decisions',
    'security',
    'tests',
    'build',
    'hackathon',
    'network',
    'host',
  ])
    statusLabel(value[field]?.status);
  if (!value.management || typeof value.management !== 'object' || Array.isArray(value.management))
    throw new Error('INVALID_SNAPSHOT');
  for (const field of ['currentStatus', 'workQueue', 'changelog'])
    statusLabel(value.management[field]?.status);
  for (const item of Object.values(value.management)) statusLabel(item.status);
  if (!Array.isArray(value.decisions.items)) throw new Error('INVALID_SNAPSHOT');
  for (const field of ['workers', 'tasks', 'blockers', 'links', 'sourceHealth', 'dashboardLog'])
    requireUiRecords(value[field]);
  if (!Array.isArray(value.knownIssues)) throw new Error('INVALID_SNAPSHOT');
  for (const issue of value.knownIssues) if (typeof issue !== 'string') requireUiRecord(issue);
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
  requireUiRecords(value.decisions.items);
  for (const decision of value.decisions.items) {
    if (typeof decision.text !== 'string') throw new Error('INVALID_SNAPSHOT');
  }
  requireOptionalUiString(value.git.commit);
  requireUiRecords(value.git.recentCommits, true);
  for (const commit of value.git.recentCommits ?? []) {
    if (typeof commit.hash !== 'string') throw new Error('INVALID_SNAPSHOT');
  }
  for (const worker of value.workers) requireUiRecords(worker.activities, true);
  for (const task of value.tasks)
    for (const field of ['dependsOn', 'acceptance', 'evidence']) requireOptionalUiStrings(task[field]);
  requireUiRecords(value.hackathon.releaseGates, true);
  for (const gate of value.hackathon.releaseGates ?? []) requireUiRecords(gate.checks, true);
  requireUiRecords(value.host.links, true);
  requireUiRecords(value.tests.items);
  for (const check of value.tests.items) requireOptionalUiString(check.commit);
  requireUiRecords(value.security.findings);
  for (const finding of value.security.findings)
    for (const field of ['component', 'mitigation', 'task']) requireOptionalUiStrings(finding[field]);
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

export function selectSnapshotAfterLoad(previousSnapshot, result) {
  return result?.state === 'ready' ? result.data : previousSnapshot;
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
  const groups = groupTasks(snapshot.tasks);
  browserDocument.querySelector('#project-title').textContent = snapshot.project.name;
  browserDocument.querySelector('#project-subtitle').textContent =
    `${snapshot.project.network} · ${snapshot.project.currentWave ?? '阶段不可用'}`;
  const projectStatus = browserDocument.querySelector('#project-status');
  projectStatus.className = `status status-${snapshot.integration.status.toLowerCase().replaceAll('_', '-')}`;
  projectStatus.textContent = `${statusLabel(snapshot.integration.status)} · ${snapshot.integration.status}`;

  const facts = browserDocument.querySelector('#project-facts');
  clear(facts);
  for (const [label, value] of [
    ['分支', snapshot.git.branch],
    ['提交', snapshot.git.commit?.slice(0, 10)],
    ['Chain ID', snapshot.project.chainId],
  ])
    facts.append(element('dt', null, label), element('dd', null, value ?? 'NOT_AVAILABLE'));

  const container = browserDocument.querySelector('#overview');
  clear(container);
  const metrics = [
    ['总任务', overview.taskCounts.total, 'neutral'],
    ['已完成', overview.taskCounts.done, 'done'],
    ['进行中', groups.active.length, 'active'],
    ['已阻塞', overview.taskCounts.blocked, overview.taskCounts.blocked ? 'blocked' : 'neutral'],
  ];
  for (const [label, value, tone] of metrics) {
    const item = element('article', `overview-stat overview-stat-${tone}`);
    item.append(element('strong', null, value), element('span', null, label));
    container.append(item);
  }

  const readySources = snapshot.sourceHealth.filter((source) => source.status === 'READY').length;
  const sourceRate = snapshot.sourceHealth.length
    ? Math.round((readySources / snapshot.sourceHealth.length) * 100)
    : 0;
  browserDocument.querySelector('#source-health-rate').textContent = `${sourceRate}%`;
  browserDocument.querySelector('#source-health-bar').style.width = `${sourceRate}%`;
  renderAttention(snapshot);
}

function attentionTaskButton(task) {
  const button = element('button', 'attention-row');
  button.type = 'button';
  const copy = element('span');
  copy.append(
    element('strong', null, `${task.id} · ${task.title}`),
    element('small', null, `${task.owner} · ${task.lastUpdate}`),
  );
  button.append(
    element('i', `task-dot task-dot-${task.status.toLowerCase()}`),
    copy,
    element('span', 'attention-arrow', '›'),
  );
  button.addEventListener('click', () => openTaskDetail(task));
  return button;
}

function renderAttention(snapshot) {
  const focus = browserDocument.querySelector('#focus-content');
  const focusTasks = snapshot.tasks
    .filter((task) => ['IN_PROGRESS', 'PARTIAL', 'READY', 'NOT_STARTED'].includes(task.status))
    .slice(0, 3);
  clear(focus);
  browserDocument.querySelector('#focus-count').textContent = `${focusTasks.length} 项`;
  if (!focusTasks.length) empty(focus, '当前没有待推进任务。');
  else focusTasks.forEach((task) => focus.append(attentionTaskButton(task)));

  const milestone = browserDocument.querySelector('#milestone-content');
  clear(milestone);
  const gate = (snapshot.hackathon.releaseGates ?? []).find((item) => item.status !== 'passed');
  if (!gate)
    empty(
      milestone,
      snapshot.hackathon.releaseGates?.length ? '全部发布门禁已通过。' : '发布门禁证据不可用。',
    );
  else {
    const passed = (gate.checks ?? []).filter((check) => check.status === 'passed').length;
    milestone.append(
      element('strong', 'milestone-title', `${gate.id} · ${gate.name}`),
      element('p', 'muted', `${passed}/${gate.checks?.length ?? 0} 项检查通过`),
    );
    const progress = element('div', 'mini-progress');
    const bar = element('span');
    bar.style.width = `${gate.checks?.length ? Math.round((passed / gate.checks.length) * 100) : 0}%`;
    progress.append(bar);
    milestone.append(progress);
  }

  const activity = browserDocument.querySelector('#activity-content');
  clear(activity);
  const events = (snapshot.tests.items ?? []).slice(0, 3);
  if (!events.length) empty(activity, '没有可展示的检查动态。');
  else
    for (const event of events) {
      const row = element('div', 'activity-row');
      row.append(
        element('i', `activity-dot activity-${event.status.toLowerCase()}`),
        element('span', null, event.id),
        element('small', null, statusLabel(event.status)),
      );
      activity.append(row);
    }
}

function panelBody(id) {
  const body = browserDocument.querySelector(`#${id} .panel-body`);
  clear(body);
  return body;
}

function renderTasks(snapshot) {
  const body = panelBody('task-board');
  const visibleTasks = filterTasks(snapshot.tasks, taskFilter).filter((task) =>
    matchesDashboardSearch(dashboardQuery, [
      task.id,
      task.title,
      task.owner,
      task.risk,
      taskRiskLabel(task.risk),
      task.status,
      statusLabel(task.status),
    ]),
  );
  const controls = element('div', 'task-toolbar');
  const filters = element('div', 'filter-tabs');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', '筛选任务');
  const filterOptions = [
    ['all', '全部'],
    ['active', '待推进'],
    ['blocked', '阻塞'],
    ['done', '已完成'],
  ];
  for (const [value, label] of filterOptions) {
    const button = element('button', value === taskFilter ? 'active' : null, label);
    button.type = 'button';
    button.dataset.filter = value;
    button.setAttribute('aria-pressed', String(value === taskFilter));
    button.addEventListener('click', () => {
      taskFilter = value;
      renderTasks(snapshot);
    });
    filters.append(button);
  }
  controls.append(
    filters,
    element('span', 'task-result-count', `${visibleTasks.length} / ${snapshot.tasks.length} 项任务`),
  );
  body.append(controls);

  if (taskView === 'list') renderTaskList(body, visibleTasks);
  else renderTaskBoard(body, visibleTasks);
  body.append(sourceNote(snapshot.project));
}

function taskRiskLabel(risk) {
  if (risk === 'critical') return '严重';
  if (risk === 'high') return '高风险';
  if (risk === 'medium') return '中风险';
  if (risk === 'low') return '低风险';
  return risk ?? '风险未标记';
}

function taskCard(task) {
  const button = element('button', `task-card task-card-${task.status.toLowerCase().replaceAll('_', '-')}`);
  button.type = 'button';
  button.setAttribute('aria-label', `查看任务 ${task.id}：${task.title}`);
  const heading = element('span', 'task-card-heading');
  heading.append(element('small', null, task.id), element('strong', null, task.title));
  const tags = element('span', 'task-card-tags');
  tags.append(
    element('span', 'task-tag task-tag-priority', task.priority),
    element('span', `task-tag task-tag-${task.risk}`, taskRiskLabel(task.risk)),
  );
  const footer = element('span', 'task-card-footer');
  footer.append(
    element('span', null, task.owner),
    element('span', null, task.dependsOn?.length ? `依赖 ${task.dependsOn.length}` : '无依赖'),
  );
  button.append(heading, tags, footer);
  button.addEventListener('click', () => openTaskDetail(task));
  return button;
}

function renderTaskBoard(body, tasks) {
  const board = element('div', 'kanban-board');
  const grouped = groupTasks(tasks);
  const columns = [
    ['backlog', '待办', '○'],
    ['active', '进行中', '◉'],
    ['blocked', '已阻塞', '!'],
    ['done', '已完成', '✓'],
  ];
  for (const [key, label, icon] of columns) {
    const column = element('section', `kanban-column kanban-${key}`);
    const heading = element('div', 'kanban-heading');
    heading.append(
      element('span', 'kanban-icon', icon),
      element('h3', null, label),
      element('span', 'kanban-count', grouped[key].length),
    );
    const cards = element('div', 'kanban-cards');
    if (!grouped[key].length) empty(cards, '此分组暂无任务。');
    else grouped[key].forEach((task) => cards.append(taskCard(task)));
    column.append(heading, cards);
    board.append(column);
  }
  body.append(board);
}

function renderTaskList(body, tasks) {
  const tableWrap = element('div', 'table-wrap');
  const table = element('table');
  const head = element('thead');
  const headerRow = element('tr');
  for (const label of ['任务', '负责人', '优先级 / 风险', '状态', '依赖 / 阻塞', '验收 / 证据', '更新'])
    headerRow.append(element('th', null, label));
  head.append(headerRow);
  const rows = element('tbody');
  for (const task of tasks) {
    const row = element('tr');
    const identity = element('td');
    const taskButton = element('button', 'table-task-button');
    taskButton.type = 'button';
    taskButton.append(element('strong', null, task.id), element('span', 'table-subtitle', task.title));
    taskButton.addEventListener('click', () => openTaskDetail(task));
    identity.append(taskButton);
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
  body.append(tableWrap);
}

function appendDetailList(container, heading, items, emptyMessage) {
  container.append(element('h3', null, heading));
  const list = element('ul', 'detail-list');
  if (!items.length) list.append(element('li', 'muted', emptyMessage));
  else items.forEach((item) => list.append(element('li', null, item)));
  container.append(list);
}

function openTaskDetail(task) {
  const detail = buildTaskDetail(task);
  const dialog = browserDocument.querySelector('#task-dialog');
  browserDocument.querySelector('#task-dialog-id').textContent = detail.id;
  browserDocument.querySelector('#task-dialog-title').textContent = detail.title;
  const body = browserDocument.querySelector('#task-dialog-body');
  clear(body);
  const statusRow = element('div', 'dialog-status-row');
  statusRow.append(
    badge(detail.status),
    element('span', `severity ${severityClass(detail.risk)}`, taskRiskLabel(detail.risk)),
  );
  body.append(
    statusRow,
    definitionList([
      ['负责人', detail.owner],
      ['优先级', detail.priority],
      ['依赖', detail.dependsOn.length ? detail.dependsOn.join(', ') : 'NONE'],
      ['阻塞原因', detail.blockedBy],
      ['最后更新', detail.lastUpdate],
      ['数据来源', detail.source],
    ]),
  );
  appendDetailList(body, '验收标准', detail.acceptance, '没有记录验收标准。');
  appendDetailList(body, '证据', detail.evidence, '没有记录证据。');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
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
  for (const entry of records) {
    const record = typeof entry === 'string' ? { title: entry } : entry;
    const item = element('li');
    item.append(element('strong', null, `${record.id ?? '记录'} · ${record.title ?? record.source}`));
    if (record.severity && SEVERITIES.has(record.severity))
      item.append(element('span', `severity ${severityClass(record.severity)}`, record.severity));
    if (typeof record.status === 'string' && Object.hasOwn(STATUS_LABELS, record.status))
      item.append(badge(record.status));
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
  renderWorkerReports(snapshot);
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

function syncTaskViewControls() {
  for (const button of browserDocument.querySelectorAll('#task-view-switch button')) {
    const active = button.dataset.view === taskView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function applyDashboardSearch(query) {
  dashboardQuery = String(query ?? '')
    .trim()
    .slice(0, 100);
  if (currentSnapshot) renderTasks(currentSnapshot);
  const panels = [...browserDocument.querySelectorAll('.panel')];
  let visible = 0;
  for (const panel of panels) {
    const title = panel.querySelector('h2')?.textContent;
    const taskValues =
      panel.id === 'task-board' && currentSnapshot
        ? currentSnapshot.tasks.flatMap((task) => [
            task.id,
            task.title,
            task.owner,
            task.risk,
            taskRiskLabel(task.risk),
            task.status,
            statusLabel(task.status),
          ])
        : [];
    const match = matchesDashboardSearch(query, [panel.id, title, panel.textContent, ...taskValues]);
    panel.hidden = !match;
    if (match) visible += 1;
    const nav = browserDocument.querySelector(`#sidebar-nav a[href="#${panel.id}"]`);
    if (nav) nav.hidden = !match;
  }
  for (const group of browserDocument.querySelectorAll('.dashboard-group')) {
    group.hidden = ![...group.querySelectorAll('.panel')].some((panel) => !panel.hidden);
  }
  const hasQuery = String(query ?? '').trim().length > 0;
  browserDocument.querySelector('#search-results').textContent = hasQuery
    ? `找到 ${visible} 个匹配面板`
    : `显示全部 ${panels.length} 个面板`;
  browserDocument.querySelector('#no-search-results').hidden = visible !== 0;
}

function closeMobileNavigation() {
  browserDocument.body.classList.remove('sidebar-open');
  const mobileMenu = browserDocument.querySelector('#mobile-menu');
  mobileMenu.setAttribute('aria-expanded', 'false');
  mobileMenu.setAttribute('aria-label', '打开导航');
  browserDocument.querySelector('#sidebar-backdrop').hidden = true;
}

function wireInteractions() {
  browserDocument.querySelector('#worker-report-search').addEventListener('input', () => {
    if (currentSnapshot) renderWorkerReports(currentSnapshot);
  });
  const search = browserDocument.querySelector('#dashboard-search');
  search.addEventListener('input', () => applyDashboardSearch(search.value));
  browserDocument.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      search.focus();
      search.select();
    } else if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(browserDocument.activeElement?.tagName)) {
      event.preventDefault();
      search.focus();
    } else if (event.key === 'Escape' && search.value) {
      search.value = '';
      applyDashboardSearch('');
    }
  });

  const sidebarToggle = browserDocument.querySelector('#sidebar-toggle');
  sidebarToggle.addEventListener('click', () => {
    const collapsed = browserDocument.body.classList.toggle('sidebar-collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    sidebarToggle.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
  });
  const mobileMenu = browserDocument.querySelector('#mobile-menu');
  mobileMenu.addEventListener('click', () => {
    const open = browserDocument.body.classList.toggle('sidebar-open');
    mobileMenu.setAttribute('aria-expanded', String(open));
    mobileMenu.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
    browserDocument.querySelector('#sidebar-backdrop').hidden = !open;
  });
  browserDocument.querySelector('#sidebar-backdrop').addEventListener('click', closeMobileNavigation);

  for (const anchor of browserDocument.querySelectorAll('#sidebar-nav a')) {
    anchor.addEventListener('click', () => {
      browserDocument.querySelectorAll('#sidebar-nav a').forEach((item) => item.classList.remove('active'));
      anchor.classList.add('active');
      closeMobileNavigation();
    });
  }

  for (const button of browserDocument.querySelectorAll('#task-view-switch button')) {
    button.addEventListener('click', () => {
      taskView = button.dataset.view;
      syncTaskViewControls();
      if (currentSnapshot) renderTasks(currentSnapshot);
    });
  }

  const dialog = browserDocument.querySelector('#task-dialog');
  browserDocument.querySelector('#close-task-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  browserDocument.querySelector('#dialog-evidence-link').addEventListener('click', () => {
    dialog.close();
    const evidence = browserDocument.querySelector('#raw-evidence');
    evidence.scrollIntoView({ behavior: 'smooth', block: 'start' });
    evidence.focus({ preventScroll: true });
  });

  browserDocument.querySelector('#refresh-dashboard').addEventListener('click', refreshDashboard);
}

function renderFatal(result) {
  browserDocument.querySelector('#data-state').textContent =
    `${statusLabel(result.status)} · ${result.message}`;
  browserDocument.querySelector('#data-state').classList.add('data-state-error');
}

async function refreshDashboard() {
  const refreshButton = browserDocument.querySelector('#refresh-dashboard');
  refreshButton.disabled = true;
  refreshButton.classList.add('is-loading');
  browserDocument.querySelector('#data-state').textContent = '正在刷新证据快照…';
  const previous = currentSnapshot;
  try {
    const result = await loadDashboard();
    const next = selectSnapshotAfterLoad(previous, result);
    if (result.state === 'error') {
      renderFatal(result);
    } else {
      renderDashboard(next);
      currentSnapshot = next;
      browserDocument.querySelector('#data-state').classList.remove('data-state-error');
      browserDocument.querySelector('#data-state').textContent = `快照：${next.generatedAt}`;
    }
    applyDashboardSearch(browserDocument.querySelector('#dashboard-search').value);
  } catch {
    currentSnapshot = previous;
    if (previous) {
      try {
        renderDashboard(previous);
        applyDashboardSearch(browserDocument.querySelector('#dashboard-search').value);
      } catch {
        // A damaged DOM may prevent restoration; the visible error remains and
        // the finally block keeps retry available after that external fault clears.
      }
    }
    renderFatal(ERROR_RESULT);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('is-loading');
  }
}

async function boot() {
  wireInteractions();
  syncTaskViewControls();
  await refreshDashboard();
}

if (browserDocument) boot();

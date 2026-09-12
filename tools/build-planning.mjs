import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'planning/roadmap.json');
const statusMeta = Object.freeze({
  done: { label: '已完成', order: 0 },
  in_progress: { label: '进行中', order: 1 },
  ready: { label: '就绪', order: 2 },
  review: { label: '评审中', order: 3 },
  blocked: { label: '阻塞', order: 4 },
  backlog: { label: '待排期', order: 5 },
});
const riskMeta = Object.freeze({
  critical: { label: 'Critical', order: 0 },
  high: { label: 'High', order: 1 },
  medium: { label: 'Medium', order: 2 },
  low: { label: 'Low', order: 3 },
});
const gateMeta = Object.freeze({
  passed: '已通过',
  open: '未通过',
  blocked: '阻塞',
});

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid planning data: ${message}`);
}

function requireString(value, field) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, `${field} must be a string`);
}

function requireStringArray(value, field, minimum = 1) {
  requireCondition(
    Array.isArray(value) && value.length >= minimum,
    `${field} must contain ${minimum}+ items`,
  );
  value.forEach((item, index) => requireString(item, `${field}[${index}]`));
}

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validatePlan(plan) {
  requireCondition(plan && typeof plan === 'object', 'root must be an object');
  requireCondition(plan.schemaVersion === 2, 'schemaVersion must be 2');
  requireCondition(isRealIsoDate(plan.updatedAt), 'updatedAt must be a real YYYY-MM-DD date');
  requireString(plan.project?.name, 'project.name');
  requireString(plan.project?.scope, 'project.scope');
  requireCondition(plan.project?.chainId === 46_630, 'project.chainId must be Robinhood testnet 46630');
  requireStringArray(plan.project?.hardBoundaries, 'project.hardBoundaries', 3);
  requireStringArray(plan.securityPrinciples, 'securityPrinciples', 5);
  requireStringArray(plan.definitionOfReady, 'definitionOfReady', 3);
  requireStringArray(plan.definitionOfDone, 'definitionOfDone', 5);

  requireCondition(Array.isArray(plan.phases) && plan.phases.length > 0, 'phases must not be empty');
  const phaseIds = new Set();
  for (const [index, phase] of plan.phases.entries()) {
    requireString(phase.id, `phases[${index}].id`);
    requireString(phase.name, `phases[${index}].name`);
    requireString(phase.goal, `phases[${index}].goal`);
    requireCondition(!phaseIds.has(phase.id), `duplicate phase ${phase.id}`);
    phaseIds.add(phase.id);
  }

  requireCondition(Array.isArray(plan.tasks) && plan.tasks.length > 0, 'tasks must not be empty');
  const tasks = new Map();
  for (const [index, task] of plan.tasks.entries()) {
    const field = `tasks[${index}]`;
    requireString(task.id, `${field}.id`);
    requireCondition(/^[A-Z][A-Z0-9]*-\d{3}$/.test(task.id), `${task.id} has an invalid ID`);
    requireCondition(!tasks.has(task.id), `duplicate task ${task.id}`);
    requireCondition(phaseIds.has(task.phase), `${task.id} references unknown phase ${task.phase}`);
    requireCondition(task.status in statusMeta, `${task.id} has unknown status ${task.status}`);
    requireCondition(/^P[0-2]$/.test(task.priority), `${task.id} has invalid priority`);
    requireCondition(task.risk in riskMeta, `${task.id} has unknown risk ${task.risk}`);
    requireCondition(['S', 'M', 'L'].includes(task.size), `${task.id} has invalid size`);
    requireString(task.title, `${field}.title`);
    requireString(task.summary, `${field}.summary`);
    requireString(task.rollback, `${field}.rollback`);
    requireCondition(isRealIsoDate(task.updatedAt), `${task.id} has invalid updatedAt`);
    requireStringArray(task.deliverables, `${task.id}.deliverables`, 2);
    requireStringArray(task.acceptance, `${task.id}.acceptance`, 3);
    requireCondition(Array.isArray(task.dependsOn), `${task.id}.dependsOn must be an array`);
    requireCondition(Array.isArray(task.evidence), `${task.id}.evidence must be an array`);
    if (task.status === 'done') requireStringArray(task.evidence, `${task.id}.evidence`, 1);
    if (task.status === 'blocked') requireString(task.blockedReason, `${task.id}.blockedReason`);
    tasks.set(task.id, task);
  }

  const active = plan.tasks.filter((task) => task.status === 'in_progress');
  requireCondition(active.length === 1, `exactly one task must be in_progress; found ${active.length}`);
  for (const task of plan.tasks) {
    const uniqueDependencies = new Set(task.dependsOn);
    requireCondition(uniqueDependencies.size === task.dependsOn.length, `${task.id} repeats a dependency`);
    for (const dependency of task.dependsOn) {
      requireCondition(tasks.has(dependency), `${task.id} references unknown dependency ${dependency}`);
      requireCondition(dependency !== task.id, `${task.id} depends on itself`);
    }
    if (['done', 'in_progress', 'ready', 'review'].includes(task.status)) {
      for (const dependency of task.dependsOn) {
        requireCondition(
          tasks.get(dependency).status === 'done',
          `${task.id} is ${task.status} but dependency ${dependency} is not done`,
        );
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    requireCondition(!visiting.has(id), `dependency cycle reaches ${id}`);
    visiting.add(id);
    for (const dependency of tasks.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);

  requireCondition(Array.isArray(plan.releaseGates) && plan.releaseGates.length >= 4, 'releaseGates missing');
  const gateIds = new Set();
  for (const gate of plan.releaseGates) {
    requireString(gate.id, 'gate.id');
    requireString(gate.name, `${gate.id}.name`);
    requireCondition(gate.status in gateMeta, `${gate.id} has invalid status`);
    requireCondition(!gateIds.has(gate.id), `duplicate gate ${gate.id}`);
    gateIds.add(gate.id);
    requireCondition(Array.isArray(gate.checks) && gate.checks.length > 0, `${gate.id} checks missing`);
    for (const check of gate.checks) {
      requireString(check.name, `${gate.id}.check.name`);
      requireCondition(check.status in gateMeta, `${gate.id} check has invalid status`);
      if (check.status === 'passed') requireString(check.evidence, `${gate.id} passed check evidence`);
    }
    const allPassed = gate.checks.every((check) => check.status === 'passed');
    requireCondition(
      allPassed ? gate.status === 'passed' : gate.status !== 'passed',
      `${gate.id} status does not match its checks`,
    );
  }
  return plan;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function taskSort(left, right) {
  return (
    statusMeta[left.status].order - statusMeta[right.status].order ||
    Number(left.priority.slice(1)) - Number(right.priority.slice(1)) ||
    riskMeta[left.risk].order - riskMeta[right.risk].order ||
    left.id.localeCompare(right.id)
  );
}

function stats(plan) {
  const byStatus = Object.fromEntries(Object.keys(statusMeta).map((status) => [status, 0]));
  for (const task of plan.tasks) byStatus[task.status]++;
  const unresolvedSevere = plan.tasks.filter(
    (task) => task.status !== 'done' && ['critical', 'high'].includes(task.risk),
  ).length;
  return { byStatus, unresolvedSevere, total: plan.tasks.length };
}

function renderList(items, prefix = '- ') {
  return items.map((item) => `${prefix}${item}`).join('\n');
}

export function renderTodo(plan) {
  const current = plan.tasks.find((task) => task.status === 'in_progress');
  const summary = stats(plan);
  const sections = plan.phases.map((phase) => {
    const tasks = plan.tasks.filter((task) => task.phase === phase.id).sort(taskSort);
    const body = tasks
      .map((task) => {
        const checked = task.status === 'done' ? 'x' : ' ';
        const dependencies = task.dependsOn.length
          ? task.dependsOn.map((id) => `\`${id}\``).join('、')
          : '无';
        const evidence = task.evidence.length
          ? task.evidence.map((item) => `\`${item}\``).join('、')
          : '待补';
        return [
          `- [${checked}] **${task.id} · ${task.title}** — ${statusMeta[task.status].label} / ${task.priority} / ${riskMeta[task.risk].label} / ${task.size}`,
          `  - 目标：${task.summary}`,
          `  - 依赖：${dependencies}`,
          `  - 交付：${task.deliverables.join('；')}`,
          '  - 验收：',
          ...task.acceptance.map((item) => `    - ${item}`),
          `  - 停用/回退：${task.rollback}`,
          `  - 证据：${evidence}`,
        ].join('\n');
      })
      .join('\n\n');
    return `## ${phase.id} · ${phase.name}\n\n> ${phase.goal}\n\n${body}`;
  });

  const gates = plan.releaseGates
    .map(
      (gate) =>
        `### ${gate.id} · ${gate.name} — ${gateMeta[gate.status]}\n\n${gate.checks
          .map(
            (check) =>
              `- [${check.status === 'passed' ? 'x' : ' '}] ${check.name}${check.evidence ? ` — \`${check.evidence}\`` : ''}`,
          )
          .join('\n')}`,
    )
    .join('\n\n');

  return `# AlphaForge 工程安全 TODO\n\n> 自动生成文件：唯一事实源为 \`planning/roadmap.json\`。请勿直接修改本文件。\n>\n> 范围：${plan.project.scope}\n\n## 当前状态\n\n- 唯一 WIP：**${current.id} · ${current.title}**\n- 总任务：${summary.total}\n- 已完成：${summary.byStatus.done}\n- 已就绪：${summary.byStatus.ready}\n- 未关闭 Critical/High：${summary.unresolvedSevere}\n- 计划版本：${plan.project.planVersion}（${plan.updatedAt}）\n\n## 强制安全边界\n\n${renderList(plan.project.hardBoundaries)}\n\n${sections.join('\n\n')}\n\n## 发布门禁\n\n${gates}\n\n## Definition of Ready\n\n${renderList(plan.definitionOfReady)}\n\n## Definition of Done\n\n${renderList(plan.definitionOfDone)}\n`;
}

export function renderMarkdownBoard(plan) {
  const current = plan.tasks.find((task) => task.status === 'in_progress');
  const summary = stats(plan);
  const phases = plan.phases
    .map((phase) => {
      const rows = plan.tasks
        .filter((task) => task.phase === phase.id)
        .sort(taskSort)
        .map(
          (task) =>
            `| ${task.id} | ${escapeTable(task.title)} | ${statusMeta[task.status].label} | ${task.priority} | ${riskMeta[task.risk].label} | ${task.dependsOn.join(', ') || '—'} |`,
        )
        .join('\n');
      return `## ${phase.id} · ${phase.name}\n\n${phase.goal}\n\n| ID | 任务 | 状态 | 优先级 | 风险 | 依赖 |\n| --- | --- | --- | --- | --- | --- |\n${rows}`;
    })
    .join('\n\n');
  const gates = plan.releaseGates
    .map(
      (gate) =>
        `| ${gate.id} | ${gate.name} | ${gateMeta[gate.status]} | ${gate.checks.filter((check) => check.status === 'passed').length}/${gate.checks.length} |`,
    )
    .join('\n');
  return `# AlphaForge 工程安全任务看板\n\n> 自动生成文件：唯一事实源为 \`planning/roadmap.json\`。HTML 版见 [task-board.html](task-board.html)。\n\n更新时间：${plan.updatedAt} · 计划版本：${plan.project.planVersion}\n\n- 当前任务：**${current.id} · ${current.title}**\n- 已完成：${summary.byStatus.done}/${summary.total}\n- 就绪：${summary.byStatus.ready}\n- 未关闭 Critical/High：${summary.unresolvedSevere}\n- 硬边界：${plan.project.scope}\n\n${phases}\n\n## 发布门禁\n\n| Gate | 名称 | 状态 | 已通过 |\n| --- | --- | --- | --- |\n${gates}\n\n## 统一完成定义\n\n${renderList(plan.definitionOfDone)}\n`;
}

function renderTags(task) {
  return `<div class="tags" aria-label="任务属性"><span class="tag priority">${task.priority}</span><span class="tag risk risk-${task.risk}">${riskMeta[task.risk].label}</span><span class="tag size">${task.size}</span></div>`;
}

function renderTaskCard(task) {
  const anchor = task.status === 'in_progress' ? ` id="task-${escapeHtml(task.id)}"` : '';
  const dependencyText = task.dependsOn.length
    ? task.dependsOn.map((id) => `<code>${escapeHtml(id)}</code>`).join(' ')
    : '<span>无</span>';
  const evidence = task.evidence.length
    ? `<ul>${task.evidence.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>`
    : '<p class="pending-evidence">待完成后补充可复现证据</p>';
  return `<article class="task-card status-${task.status} risk-border-${task.risk}"${anchor} data-task data-status="${task.status}" data-risk="${task.risk}" data-phase="${escapeHtml(task.phase)}">
  <div class="task-head"><div><span class="task-id">${escapeHtml(task.id)}</span><span class="status status-${task.status}">${statusMeta[task.status].label}</span></div>${renderTags(task)}</div>
  <h3>${escapeHtml(task.title)}</h3>
  <p class="task-summary">${escapeHtml(task.summary)}</p>
  <div class="dependency"><strong>依赖</strong>${dependencyText}</div>
  <details>
    <summary>查看交付、验收与停用策略</summary>
    <div class="task-detail">
      <h4>交付物</h4><ul>${task.deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <h4>验收标准</h4><ol>${task.acceptance.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>
      <h4>停用 / 回退</h4><p>${escapeHtml(task.rollback)}</p>
      <h4>证据</h4>${evidence}
      <p class="updated">最后更新 ${escapeHtml(task.updatedAt)}</p>
    </div>
  </details>
</article>`;
}

export function renderHtmlBoard(plan) {
  const current = plan.tasks.find((task) => task.status === 'in_progress');
  const summary = stats(plan);
  const phaseNavigation = plan.phases
    .map(
      (phase) =>
        `<a href="#phase-${escapeHtml(phase.id)}"><span>${escapeHtml(phase.id)}</span>${escapeHtml(phase.name)}</a>`,
    )
    .join('');
  const phaseOptions = plan.phases
    .map(
      (phase) =>
        `<option value="${escapeHtml(phase.id)}">${escapeHtml(phase.id)} · ${escapeHtml(phase.name)}</option>`,
    )
    .join('');
  const phases = plan.phases
    .map((phase) => {
      const tasks = plan.tasks.filter((task) => task.phase === phase.id).sort(taskSort);
      return `<section class="phase" id="phase-${escapeHtml(phase.id)}" data-phase-section>
  <div class="section-head"><div><span class="phase-id">${escapeHtml(phase.id)}</span><h2>${escapeHtml(phase.name)}</h2></div><p>${escapeHtml(phase.goal)}</p></div>
  <div class="task-grid">${tasks.map(renderTaskCard).join('')}</div>
</section>`;
    })
    .join('');
  const gates = plan.releaseGates
    .map((gate) => {
      const passed = gate.checks.filter((check) => check.status === 'passed').length;
      return `<article class="gate gate-${gate.status}"><div class="gate-head"><span>${escapeHtml(gate.id)}</span><div><h3>${escapeHtml(gate.name)}</h3><p>${passed}/${gate.checks.length} 项通过</p></div><strong>${gateMeta[gate.status]}</strong></div><ul>${gate.checks
        .map(
          (check) =>
            `<li class="check-${check.status}"><span aria-hidden="true">${check.status === 'passed' ? '✓' : '○'}</span><div>${escapeHtml(check.name)}${check.evidence ? `<code>${escapeHtml(check.evidence)}</code>` : ''}</div></li>`,
        )
        .join('')}</ul></article>`;
    })
    .join('');
  const digest = createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 12);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="description" content="AlphaForge Robinhood Chain Testnet 工程安全任务看板">
  <title>AlphaForge · 工程安全看板</title>
  <link rel="stylesheet" href="./task-board.css">
  <script src="./task-board.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">跳到主要内容</a>
  <div class="shell">
    <aside class="sidebar" aria-label="看板导航">
      <div class="brand"><span aria-hidden="true">AF</span><div>AlphaForge<small>工程安全看板</small></div></div>
      <nav>${phaseNavigation}<a href="#gates"><span>G</span>发布门禁</a><a href="#standards"><span>D</span>完成定义</a></nav>
      <div class="side-note"><strong>Robinhood Chain Testnet</strong><span>Chain ID 46630</span><span>仅测试网 · 主网硬关闭</span></div>
    </aside>
    <main id="main">
      <header class="topbar"><div><span class="crumb">AlphaForge / Security Engineering</span><span class="updated">计划 v${escapeHtml(plan.project.planVersion)} · ${escapeHtml(plan.updatedAt)}</span></div><a href="./TASK-BOARD.md">查看 Markdown 看板</a></header>
      <section class="hero" aria-labelledby="hero-title">
        <div><p class="eyebrow">ROBINHOOD CHAIN TESTNET · ENGINEERING PLAN</p><h1 id="hero-title">用证据推进，而不是用进度制造安全感。</h1><p>${escapeHtml(plan.project.scope)}</p></div>
        <div class="network-seal"><span>目标网络</span><strong>46630</strong><small>0xb626</small></div>
      </section>
      <section class="metrics" aria-label="计划统计">
        <article><span>全部任务</span><strong>${summary.total}</strong><small>六个工程阶段</small></article>
        <article><span>已完成基线</span><strong>${summary.byStatus.done}</strong><small>不等于生产认证</small></article>
        <article><span>当前 WIP</span><strong>${summary.byStatus.in_progress}</strong><small>强制单任务推进</small></article>
        <article class="danger"><span>未关闭高风险</span><strong>${summary.unresolvedSevere}</strong><small>Critical + High</small></article>
      </section>
      <section class="boundary" aria-labelledby="boundary-title"><div><span aria-hidden="true">!</span><h2 id="boundary-title">当前仍是安全隔离的本地原型</h2></div><p>测试网交易 adapter、合约、持久信任根与链上资产证明尚未完成。任何看板状态都不得解释为已获真实资金或主网批准。</p></section>
      <section class="focus" aria-labelledby="focus-title"><div><span>唯一进行中</span><code>${escapeHtml(current.id)}</code></div><div><h2 id="focus-title">${escapeHtml(current.title)}</h2><p>${escapeHtml(current.summary)}</p></div><a href="#task-${escapeHtml(current.id)}" data-focus-link>查看验收标准</a></section>
      <section class="controls" aria-label="看板筛选">
        <label><span>搜索</span><input id="task-search" type="search" placeholder="任务、ID、验收或依赖" autocomplete="off"></label>
        <label><span>阶段</span><select id="phase-filter"><option value="all">全部阶段</option>${phaseOptions}</select></label>
        <label><span>状态</span><select id="status-filter"><option value="all">全部状态</option>${Object.entries(
          statusMeta,
        )
          .map(([value, meta]) => `<option value="${value}">${meta.label}</option>`)
          .join('')}</select></label>
        <label><span>风险</span><select id="risk-filter"><option value="all">全部风险</option>${Object.entries(
          riskMeta,
        )
          .map(([value, meta]) => `<option value="${value}">${meta.label}</option>`)
          .join('')}</select></label>
        <button id="reset-filter" type="button">重置筛选</button>
        <p id="filter-status" role="status" aria-live="polite">显示 ${summary.total} 个任务</p>
      </section>
      <div id="task-board">${phases}</div>
      <section class="gates" id="gates" aria-labelledby="gates-title"><div class="section-title"><p>RELEASE CONTROL</p><h2 id="gates-title">发布门禁</h2><span>不得跳级</span></div><div class="gate-grid">${gates}</div></section>
      <section class="standards" id="standards" aria-labelledby="standards-title"><div class="section-title"><p>QUALITY BAR</p><h2 id="standards-title">工程统一标准</h2><span>Ready 与 Done 分离</span></div><div class="standard-grid"><article><h3>强制安全边界</h3><ul>${plan.project.hardBoundaries.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article><article><h3>Definition of Ready</h3><ol>${plan.definitionOfReady.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol></article><article><h3>Definition of Done</h3><ol>${plan.definitionOfDone.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol></article><article><h3>安全原则</h3><ul>${plan.securityPrinciples.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article></div></section>
      <footer><p>状态由 <code>planning/roadmap.json</code> 生成。TODO、Markdown 和 HTML 必须通过 CI 一致性校验。</p><p>Plan digest <code>${digest}</code> · 无远程脚本、无统计、无网络请求</p></footer>
    </main>
  </div>
</body>
</html>
`;
}

async function loadPlan() {
  return validatePlan(JSON.parse(await readFile(sourcePath, 'utf8')));
}

const outputs = [
  ['TODO.md', renderTodo],
  ['docs/TASK-BOARD.md', renderMarkdownBoard],
  ['docs/task-board.html', renderHtmlBoard],
];

export async function buildPlanning({ check = false } = {}) {
  const plan = await loadPlan();
  const mismatches = [];
  for (const [file, render] of outputs) {
    const path = resolve(root, file);
    const expected = render(plan);
    if (check) {
      let actual = '';
      try {
        actual = await readFile(path, 'utf8');
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
      }
      if (actual !== expected) mismatches.push(file);
    } else {
      await writeFile(path, expected, 'utf8');
    }
  }
  if (mismatches.length) {
    throw new Error(`Generated planning artifacts are stale: ${mismatches.join(', ')}`);
  }
  console.log(
    check
      ? `Planning artifacts verified: ${outputs.length} files match ${relative(root, sourcePath)}.`
      : `Planning artifacts generated: ${outputs.map(([file]) => file).join(', ')}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildPlanning({ check: process.argv.includes('--check') });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

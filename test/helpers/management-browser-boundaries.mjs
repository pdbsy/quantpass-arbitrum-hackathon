import assert from 'node:assert/strict';

// Fixture responses are intercepted only in this isolated test browser. No generated
// dashboard JSON or persisted PASS evidence is edited by this regression suite.
export async function verifyManagementBoundaries(page, origin) {
  const response = await page.request.get(`${origin}/data/dashboard.json`);
  assert.equal(response.status(), 200);
  const original = await response.json();
  const passed = [];
  let fixture;
  let unavailable = true;
  await page.route('**/data/dashboard.json', (route) =>
    unavailable
      ? route.fulfill({ status: 503, body: 'test fixture unavailable' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }),
  );
  async function refresh() {
    await page.locator('#refresh-dashboard').click();
    await page.waitForFunction(() => !globalThis.document.querySelector('#refresh-dashboard').disabled);
  }
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() =>
    globalThis.document.querySelector('#data-state').textContent.includes('数据源错误'),
  );
  assert.equal(await page.locator('.task-card').count(), 0);
  assert.equal(await page.locator('#refresh-dashboard').isEnabled(), true);
  await page.keyboard.press('Control+k');
  assert.equal(
    await page.locator('#dashboard-search').evaluate((node) => node === node.ownerDocument.activeElement),
    true,
  );
  await page.locator('#dashboard-search').fill('unavailable fixture');
  await page.locator('#dashboard-search').press('Escape');
  await page.locator('#worker-report-search').fill('fixture');
  await page.locator('[data-view="list"]').click();
  passed.push('Initial data failure remains visibly unavailable with working retry/search/view controls');

  fixture = structuredClone(original);
  fixture.project.name = 'TEST FIXTURE — AlphaForge unavailable sources';
  delete fixture.project.currentWave;
  fixture.tasks = [];
  fixture.workers = original.workers.map(({ id }) => ({ id, status: 'NOT_AVAILABLE' }));
  for (const field of ['knownIssues', 'blockers', 'links', 'sourceHealth', 'dashboardLog'])
    fixture[field] = [];
  fixture.security.findings = [];
  fixture.tests = { status: 'NOT_RUN', items: [] };
  fixture.git = { status: 'NOT_AVAILABLE' };
  fixture.decisions = { status: 'NOT_AVAILABLE', items: [] };
  fixture.hackathon = { status: 'NOT_AVAILABLE' };
  fixture.host = { status: 'NOT_AVAILABLE' };
  fixture.network = { status: 'NOT_AVAILABLE' };
  fixture.build = { status: 'NOT_RUN' };
  fixture.management = Object.fromEntries(
    ['currentStatus', 'workQueue', 'changelog'].map((key) => [key, { status: 'NOT_AVAILABLE' }]),
  );
  unavailable = false;
  await refresh();
  assert.match(await page.locator('#data-state').textContent(), /^快照：/);
  assert.match(await page.locator('#project-subtitle').textContent(), /阶段不可用/);
  assert.equal(await page.locator('#source-health-rate').textContent(), '0%');
  assert.match(await page.locator('#focus-content').textContent(), /没有待推进任务/);
  assert.match(await page.locator('#milestone-content').textContent(), /门禁证据不可用/);
  assert.match(await page.locator('#activity-content').textContent(), /没有可展示的检查动态/);
  assert.match(await page.locator('#worker-a').textContent(), /未推断其任务状态/);
  assert.match(await page.locator('#worker-b').textContent(), /未推断其任务状态/);
  assert.match(await page.locator('#decision-log').textContent(), /没有推断用户批准/);
  assert.match(await page.locator('#raw-evidence').textContent(), /没有记录诊断/);
  assert.match(await page.locator('#release-gates').textContent(), /来源不可用/);
  await page.locator('[data-view="board"]').click();
  assert.equal(await page.locator('#task-board .empty-state').count(), 4);
  passed.push(
    'Empty optional sources render explicit unavailable states without inventing task or approval records',
  );

  fixture.project.name = 'TEST FIXTURE — AlphaForge rendering boundaries';
  fixture.tasks = ['critical', 'high', 'medium', 'low'].map((risk, i) => ({
    id: `TEST-${i}`,
    title: `<b>Literal task ${i}</b>`,
    owner: 'fixture',
    status: ['READY', 'PARTIAL', 'BLOCKED', 'DONE'][i],
    priority: 'test-only',
    risk,
    lastUpdate: 'fixture',
  }));
  fixture.hackathon.releaseGates = [{ id: 'TEST-GATE', name: 'Fixture only', status: 'passed' }];
  fixture.host.links = [
    { path: '#raw-evidence', label: 'Safe fixture' },
    { path: 'javascript:alert(1)', label: 'Unsafe fixture' },
  ];
  fixture.links = [
    { status: 'READY', path: '#raw-evidence', label: 'Safe evidence', kind: 'architecture' },
    { status: 'READY', path: 'javascript:alert(1)', label: '<b>Unsafe literal</b>', kind: 'project' },
    { status: 'NOT_AVAILABLE', path: 'docs/missing.md', label: 'Unavailable fixture', kind: 'security' },
  ];
  fixture.blockers = [
    { id: 'ARRAY', title: 'Nonstring record status', status: ['READY'] },
    { source: 'test fixture', status: 'BLOCKED', severity: 'low' },
    { id: 'UNKNOWN', title: 'Unregistered record status', status: 'constructor', severity: 'unknown' },
  ];
  await refresh();
  assert.match(await page.locator('#milestone-content').textContent(), /全部发布门禁已通过/);
  assert.equal(await page.locator('#task-board b').count(), 0);
  assert.equal(await page.locator('#documentation a').count(), 0);
  assert.equal(await page.locator('#ssh-host a').count(), 1);
  assert.equal(await page.locator('#ssh-host a').getAttribute('href'), '#raw-evidence');
  assert.equal(await page.locator('#blockers .status').count(), 1);
  await page.locator('#focus-content .attention-row').first().click();
  assert.match(await page.locator('#task-dialog-body').textContent(), /没有记录验收标准/);
  assert.match(await page.locator('#task-dialog-body').textContent(), /没有记录证据/);
  await page.locator('#dialog-evidence-link').click();
  assert.equal(await page.locator('#task-dialog').evaluate((node) => node.open), false);
  assert.equal(
    await page.locator('#raw-evidence').evaluate((node) => node === node.ownerDocument.activeElement),
    true,
  );
  await page.locator('[data-view="list"]').click();
  await page.locator('[data-filter="done"]').click();
  assert.equal(await page.locator('#task-board tbody tr').count(), 1);
  await page.locator('.table-task-button').click();
  await page.locator('#task-dialog').dispatchEvent('click');
  assert.equal(await page.locator('#task-dialog').evaluate((node) => node.open), false);
  await page.locator('[data-filter="active"]').click();
  assert.equal(await page.locator('#task-board tbody tr').count(), 2);
  passed.push(
    'Literal text, link allowlist, task details, filters and absent evidence remain safe under fixture data',
  );

  fixture.hackathon.releaseGates = ['blocked', 'open', 'unknown'].map((status) => ({
    id: `TEST-${status}`,
    name: 'Fixture only',
    status,
  }));
  fixture.tests.items = [{ id: 'TEST-NOT-RUN', status: 'NOT_RUN' }];
  fixture.tests.reason = 'TEST FIXTURE — checks not executed';
  fixture.sourceHealth = [{ source: 'TEST FIXTURE', status: 'NOT_AVAILABLE', observedAt: 'fixture' }];
  fixture.dashboardLog = [{ code: 'TEST-FIXTURE', level: 'warning', source: 'test fixture' }];
  await refresh();
  assert.match(await page.locator('#release-gates').textContent(), /DATA_SOURCE_ERROR/);
  assert.match(await page.locator('#test-status').textContent(), /运行：NOT_RUN · 提交：NONE · 证据：NONE/);
  assert.match(await page.locator('#raw-evidence').textContent(), /NO_ERROR_CODE/);
  assert.match(await page.locator('#raw-evidence').textContent(), /NO_DETAIL/);
  passed.push('Unknown gate states and absent check metadata remain explicit errors or NOT_RUN');

  fixture.project.status = 'constructor';
  await refresh();
  assert.match(await page.locator('#data-state').textContent(), /数据源错误/);
  assert.match(await page.locator('#project-title').textContent(), /rendering boundaries/);
  passed.push('Inherited status names are rejected and cannot replace the previous snapshot');
  await page.unroute('**/data/dashboard.json');
  await page.reload();
  await page.waitForFunction(() =>
    globalThis.document.querySelector('#data-state').textContent.startsWith('快照：'),
  );
  assert.equal(await page.locator('#project-title').textContent(), original.project.name);
  return passed;
}

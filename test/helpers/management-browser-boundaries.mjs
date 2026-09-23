import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createDashboardServer } from '../../tools/serve-management-dashboard.mjs';

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
  await page.evaluate(() => {
    const nav = globalThis.document.querySelector('#sidebar-nav a[href="#git-history"]');
    const marker = globalThis.document.createElement('span');
    marker.dataset.fixtureNavigationMarker = 'true';
    marker.hidden = true;
    nav.parentElement.insertBefore(marker, nav);
    nav.dataset.fixtureNavigationMarker = 'true';
    nav.hidden = true;
    nav.dataset.fixtureDetachedNavigation = 'true';
    globalThis.document.body.append(nav);
  });
  await page.locator('#dashboard-search').fill('Git');
  assert.ok(await page.locator('#search-results').textContent());
  await page.evaluate(() => {
    const nav = globalThis.document.querySelector('[data-fixture-detached-navigation]');
    const marker = globalThis.document.querySelector('[data-fixture-navigation-marker]');
    if (marker?.parentNode) marker.parentNode.insertBefore(nav, marker);
    marker?.remove();
    delete nav.dataset.fixtureNavigationMarker;
    delete nav.dataset.fixtureDetachedNavigation;
    nav.hidden = false;
  });
  await page.locator('#dashboard-search').press('Escape');
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
  // A first successful fetch can still fail to render before any snapshot exists.
  // Move an actual DOM node rather than replacing the renderer or its decision.
  await page.evaluate(() => {
    const body = globalThis.document.querySelector('#git-history .panel-body');
    body.dataset.fixtureInitialDetached = 'true';
    globalThis.document.body.append(body);
  });
  await refresh();
  assert.match(await page.locator('#data-state').textContent(), /数据源错误/);
  assert.equal(await page.locator('#refresh-dashboard').isEnabled(), true);
  await page.evaluate(() => {
    const body = globalThis.document.querySelector('[data-fixture-initial-detached]');
    delete body.dataset.fixtureInitialDetached;
    globalThis.document.querySelector('#git-history').append(body);
  });
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
  fixture.knownIssues = ['Literal known issue <b>must remain text</b>'];
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
  assert.match(await page.locator('#known-issues').textContent(), /Literal known issue <b>must remain text/);
  assert.equal(await page.locator('#known-issues b').count(), 0);
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

  fixture.tasks[0].risk = 'unregistered';
  fixture.tasks[1].risk = null;
  fixture.workers[0].activities = [{ timestamp: 'fixture', title: 'Fallback activity title' }];
  fixture.security.findings = [
    {
      id: 'TEST-FINDING',
      title: 'Missing optional evidence',
      severity: 'low',
      status: 'OPEN',
      owner: 'fixture',
    },
  ];
  await refresh();
  assert.match(await page.locator('#security-findings').textContent(), /NOT_AVAILABLE/);
  assert.match(await page.locator('#worker-a').textContent(), /Fallback activity title/);
  await page.locator('[data-filter="all"]').click();
  await page.locator('#task-board').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('/');
  assert.equal(
    await page.locator('#dashboard-search').evaluate((node) => node === node.ownerDocument.activeElement),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-menu').click();
  assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'), 'true');
  assert.equal(
    await page.locator('#mobile-menu').evaluate((node) => node === node.ownerDocument.activeElement),
    true,
  );
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({ width: 1440, height: 1000 });
  passed.push(
    'Missing optional security and activity fields remain explicit; keyboard search and mobile close work',
  );

  const validBoundaryFixture = structuredClone(fixture);
  for (const section of ['management', 'git', 'decisions']) {
    fixture = structuredClone(validBoundaryFixture);
    delete fixture[section];
    await refresh();
    assert.match(await page.locator('#data-state').textContent(), /数据源错误/);
    assert.equal(await page.locator('#refresh-dashboard').isEnabled(), true);
    assert.match(await page.locator('#project-title').textContent(), /rendering boundaries/);
    fixture = structuredClone(validBoundaryFixture);
    await refresh();
    assert.match(await page.locator('#data-state').textContent(), /^快照：/);
  }
  passed.push(
    'Missing render-critical sections are rejected before state replacement; refresh remains usable and recovers',
  );

  for (const mutate of [
    (value) => (value.decisions.items = [null]),
    (value) => (value.git.recentCommits = [null]),
    (value) => (value.workers[0].activities = [null]),
    (value) => (value.hackathon.releaseGates = [{ status: 'open', checks: [null] }]),
  ]) {
    fixture = structuredClone(validBoundaryFixture);
    mutate(fixture);
    await refresh();
    assert.match(await page.locator('#data-state').textContent(), /数据源错误/);
    assert.equal(await page.locator('#refresh-dashboard').isEnabled(), true);
    assert.match(await page.locator('#project-title').textContent(), /rendering boundaries/);
  }
  fixture = structuredClone(validBoundaryFixture);
  await refresh();
  await page.evaluate(() => {
    const body = globalThis.document.querySelector('#git-history .panel-body');
    body.dataset.fixtureDetached = 'true';
    globalThis.document.body.append(body);
  });
  await refresh();
  assert.match(await page.locator('#data-state').textContent(), /数据源错误/);
  assert.equal(await page.locator('#refresh-dashboard').isEnabled(), true);
  await page.evaluate(() => {
    const body = globalThis.document.querySelector('[data-fixture-detached]');
    delete body.dataset.fixtureDetached;
    globalThis.document.querySelector('#git-history').append(body);
  });
  await refresh();
  assert.match(await page.locator('#data-state').textContent(), /^快照：/);
  passed.push(
    'Invalid nested records and actual DOM rendering faults preserve failure visibility and retry recovery',
  );

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
  const forumResponse = await page.request.get(`${origin}/agent-forum.html`);
  assert.equal(forumResponse.status(), 200);
  const forumHtml = await forumResponse.text();
  const snapshotPattern = /(<script[^>]*id="forum-snapshot"[^>]*>)([\s\S]*?)(<\/script>)/;
  const embedded = snapshotPattern.exec(forumHtml);
  assert.ok(embedded);
  const forumFixture = JSON.parse(embedded[2]);
  const message = forumFixture.messages[0];
  assert.ok(message);
  forumFixture.threads = [{ thread: 'fixture-a' }, { thread: 'fixture-b' }];
  forumFixture.messages = [
    {
      ...message,
      message_id: 'fixture-a',
      agent: 'Macbeth01',
      type: 'NOTICE',
      thread: 'fixture-a',
      body: '<b>Literal fixture</b>',
      created_at: null,
      updated_at: '',
      related_pr: 'https://github.com/unrelated/repository/pull/1',
      source_url: 'not-a-url',
      reply_to_message: 'fixture-target',
      ack_state: 'UNACKNOWLEDGED',
    },
    {
      ...message,
      message_id: 'fixture-b',
      agent: 'Macbeth02',
      type: 'ACK',
      thread: 'fixture-b',
      body: 'Fixture acknowledged',
      ack_state: 'ACKNOWLEDGED',
    },
  ];
  await page.route('**/agent-forum.html', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: forumHtml.replace(
        snapshotPattern,
        (_match, open, _json, close) =>
          open + JSON.stringify(forumFixture).replaceAll('<', '\\u003c') + close,
      ),
    }),
  );
  try {
    for (const state of ['ERROR', 'PARTIAL', 'STALE', 'READY']) {
      forumFixture.source = {
        ...forumFixture.source,
        state,
        last_sync_at: state === 'READY' ? new Date().toISOString() : null,
        error: state === 'READY' ? null : 'TEST FIXTURE unavailable',
      };
      await page.goto(`${origin}/agent-forum.html`);
      await page.locator('.message').first().waitFor();
      assert.match(await page.locator('#source').textContent(), new RegExp(`SOURCE ${state}`));
      assert.equal(
        await page.locator('#source').getAttribute('class'),
        state === 'READY' ? 'source' : state === 'STALE' ? 'source stale' : 'source error',
      );
      assert.equal(await page.locator('.message b').count(), 0);
      assert.match(await page.locator('.message').first().textContent(), /来源链接无效/);
      assert.match(await page.locator('.message').first().textContent(), /Target fixture-target/);
      for (const [selector, value] of [
        ['#agent-filter', 'Macbeth01'],
        ['#type-filter', 'NOTICE'],
        ['#thread-filter', 'fixture-a'],
      ]) {
        await page.locator(selector).selectOption(value);
        assert.equal(await page.locator('.message').count(), 1);
        await page.locator(selector).selectOption('');
        assert.equal(await page.locator('.message').count(), 2);
      }
      await page.locator('#agent-filter').selectOption('Macbeth06');
      assert.equal(await page.locator('.message').count(), 0);
    }
    passed.push(
      'Forum fixtures distinguish unavailable, partial and fresh sources; filter all identities and reject unsafe links',
    );
  } finally {
    await page.unroute('**/agent-forum.html');
    await page.goto(`${origin}/index.html`);
    await page.locator('.task-card').first().waitFor();
    assert.equal(await page.locator('#project-title').textContent(), original.project.name);
  }
  const planningServer = await createDashboardServer({ root: resolve('docs'), port: 0 });
  await new Promise((done) => planningServer.listen(0, '127.0.0.1', done));
  try {
    await page.goto(`http://127.0.0.1:${planningServer.address().port}/task-board.html`);
    await page.waitForFunction(() =>
      globalThis.document.querySelector('#filter-status')?.textContent.includes('/'),
    );
    const count = await page.locator('[data-task]').count();
    assert.ok(count > 0);
    assert.equal(await page.locator('[data-task]:visible').count(), count);
    await page.locator('#task-search').fill('NONEXISTENT-LITERAL-<b>');
    assert.equal(await page.locator('[data-task]:visible').count(), 0);
    assert.equal(await page.locator('[data-phase-section]:visible').count(), 0);
    await page.locator('#reset-filter').click();
    assert.equal(await page.locator('[data-task]:visible').count(), count);
    assert.equal(
      await page.locator('#task-search').evaluate((node) => node === node.ownerDocument.activeElement),
      true,
    );
    const first = await page
      .locator('[data-task]')
      .first()
      .evaluate((node) => ({
        id: node.querySelector('.task-id').textContent,
        phase: node.dataset.phase,
        status: node.dataset.status,
        risk: node.dataset.risk,
      }));
    for (const [selector, field] of [
      ['#phase-filter', 'phase'],
      ['#status-filter', 'status'],
      ['#risk-filter', 'risk'],
    ]) {
      await page.locator(selector).selectOption(first[field]);
      const values = await page
        .locator('[data-task]:visible')
        .evaluateAll((nodes, key) => nodes.map((node) => node.dataset[key]), field);
      assert.ok(values.length > 0);
      assert.ok(values.every((value) => value === first[field]));
    }
    await page.locator('#task-search').fill(`  ${first.id.toLowerCase()}  `);
    assert.equal(await page.locator('[data-task]:visible').count(), 1);
    assert.equal(await page.locator('[data-task]:visible .task-id').textContent(), first.id);
    await page.locator('#reset-filter').click();
    for (const selector of ['#phase-filter', '#status-filter', '#risk-filter'])
      assert.equal(await page.locator(selector).inputValue(), 'all');
    assert.equal(await page.locator('#task-search').inputValue(), '');
    assert.equal(await page.locator('[data-task]:visible').count(), count);
    assert.equal(await page.locator('#filter-status').textContent(), `显示 ${count} / ${count} 个任务`);
    passed.push(
      'Active planning task board combines real search/phase/status/risk filters, hides empty phases, and resets controls/focus',
    );
  } finally {
    await page.goto(`${origin}/index.html`);
    await new Promise((done) => planningServer.close(done));
  }
  return passed;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  validateBootstrapIdentity,
  validateCommitIdentity,
  validateRegistry,
} from '../tools/agent-identity.mjs';
import {
  buildForumSnapshot,
  filterForumMessages,
  isForumSnapshotStale,
  parseAgentMessages,
  recordsFromPullRequests,
} from '../tools/agent-forum.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const github = (path) => `https://github.com/pdbsy/quantpass-arbitrum-hackathon${path}`;

function message({
  agent = 'Macbeth01',
  to = 'Macbeth02',
  type = 'NOTICE',
  thread = 'AF-AGENT-SETUP',
  replyTo = 'NONE',
  relatedPr = github('/pull/11'),
  body = 'Protocol 1.0.0 is ready for CHECK_IN.',
} = {}) {
  return `[AGENT-MESSAGE]

Schema-Version: 1
Agent: ${agent}
To: ${to}
Type: ${type}
Thread: ${thread}
Reply-To: ${replyTo}
Related-PR: ${relatedPr}
Body:
${body}

[/AGENT-MESSAGE]`;
}

test('registry and bootstrap prompts preserve the six assigned worker identities', async () => {
  const registry = JSON.parse(await read('docs/management/agents/registry.json'));
  const validated = validateRegistry(registry);
  assert.deepEqual(
    validated.agents.map(({ agent_id, branch_prefix }) => [agent_id, branch_prefix]),
    [
      ['Macbeth01', 'macbeth01/'],
      ['Macbeth02', 'macbeth02/'],
      ['Macbeth03', 'macbeth03/'],
      ['Macbeth04', 'macbeth04/'],
      ['Macbeth05', 'macbeth05/'],
      ['Macbeth06', 'macbeth06/'],
    ],
  );
  for (const agent of validated.agents) {
    const bootstrap = await read(`docs/management/agents/bootstrap/${agent.agent_id}.md`);
    assert.deepEqual(validateBootstrapIdentity(bootstrap, validated), {
      agentId: agent.agent_id,
      branchPrefix: agent.branch_prefix,
    });
  }
});

test('six-worker protocol rejects missing, unknown and cross-worker registrations', () => {
  const valid = {
    protocol_version: '1.2.0',
    agents: [1, 2, 3, 4, 5, 6].map((n) => ({
      agent_id: `Macbeth0${n}`,
      branch_prefix: `macbeth0${n}/`,
      workspace_status: 'CONFIG_PREPARED',
      session_status: 'SESSION_CREATED',
      self_confirmation: 'UNVERIFIED',
      communication_status: 'UNVERIFIED',
      current_task: n === 6 ? 'M3-06-CI-GATES' : 'NONE',
      runtime_status: 'IDLE',
    })),
  };
  assert.doesNotThrow(() => validateRegistry(valid));
  assert.throws(() => validateRegistry({ ...valid, agents: valid.agents.slice(0, 5) }));
  assert.throws(() => validateRegistry({ ...valid, protocol_version: '1.1.0' }));
  for (const patch of [
    { agent_id: 'Macbeth07' },
    { branch_prefix: 'macbeth05/' },
    { current_task: 'M3-05-CI-GATES' },
  ]) {
    const invalid = structuredClone(valid);
    Object.assign(invalid.agents[5], patch);
    assert.throws(() => validateRegistry(invalid));
  }
});

test('CI worker provenance binds its own branch and task without allowing another identity', () => {
  const input = {
    branch: 'macbeth06/M3-06-CI-GATES',
    prTitle: '[Macbeth06][M3-06-CI-GATES] Verify CI',
    subject: '[Macbeth06][M3-06-CI-GATES] Verify CI',
    body: 'Agent-ID: Macbeth06\nTask-ID: M3-06-CI-GATES',
  };
  assert.deepEqual(validateCommitIdentity(input), { agentId: 'Macbeth06', taskId: 'M3-06-CI-GATES' });
  for (const patch of [
    { branch: 'macbeth05/M3-06-CI-GATES' },
    { branch: 'macbeth07/M3-06-CI-GATES' },
    { body: 'Agent-ID: Macbeth06\nTask-ID: M3-05-CI-GATES' },
    { subject: '[Macbeth05][M3-06-CI-GATES] Verify CI' },
  ])
    assert.throws(() => validateCommitIdentity({ ...input, ...patch }));
});

test('Forum routes an owned CI-worker report but rejects another worker impersonating it', () => {
  const source = {
    source_type: 'PR_DESCRIPTION',
    source_url: github('/pull/22'),
    pr_url: github('/pull/22'),
    pr_number: 22,
    pr_head_ref: 'macbeth06/M3-06-CI-GATES',
    pr_title: '[Macbeth06][M3-06-CI-GATES] Verify CI',
    pr_author: 'pdbsy',
    github_author: 'pdbsy',
    pr_head_repo: 'pdbsy/quantpass-arbitrum-hackathon',
    text: message({
      agent: 'Macbeth06',
      to: 'Macbeth01',
      thread: 'M3-06-CI-GATES',
      relatedPr: github('/pull/22'),
    }),
    created_at: '2026-09-20T00:00:00.000Z',
    updated_at: '2026-09-20T00:00:00.000Z',
  };
  const snapshot = buildForumSnapshot([source]);
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].agent, 'Macbeth06');
  assert.equal(buildForumSnapshot([{ ...source, pr_head_ref: 'macbeth05/qa' }]).messages.length, 0);
});

test('registry rejects duplicate agents, unknown names and mismatched prefixes', () => {
  const valid = {
    protocol_version: '1.0.0',
    agents: [1, 2, 3, 4, 5].map((n) => ({
      agent_id: `Macbeth0${n}`,
      branch_prefix: `macbeth0${n}/`,
      workspace_status: 'CONFIG_PREPARED',
      session_status: 'USER_ACTION_REQUIRED',
      self_confirmation: 'UNVERIFIED',
      communication_status: 'UNVERIFIED',
      current_task: 'NONE',
      runtime_status: 'IDLE',
    })),
  };
  assert.doesNotThrow(() => validateRegistry(valid));
  assert.throws(() => validateRegistry({ ...valid, agents: [...valid.agents, valid.agents[0]] }));
  assert.throws(() =>
    validateRegistry({
      ...valid,
      agents: valid.agents.map((agent, index) => (index === 1 ? { ...agent, agent_id: 'Worker02' } : agent)),
    }),
  );
  assert.throws(() =>
    validateRegistry({
      ...valid,
      agents: valid.agents.map((agent, index) =>
        index === 2 ? { ...agent, branch_prefix: 'macbeth02/' } : agent,
      ),
    }),
  );
});

test('commit identity accepts aligned branch, PR title, subject and trailers', () => {
  const result = validateCommitIdentity({
    branch: 'macbeth03/af-042-vault-adapter',
    prTitle: '[Macbeth03][AF-042] Implement vault adapter',
    subject: 'feat(AF-042): [Macbeth03] implement vault adapter',
    body: 'Agent-ID: Macbeth03\nTask-ID: AF-042',
  });
  assert.deepEqual(result, { agentId: 'Macbeth03', taskId: 'AF-042' });
});

test('commit identity rejects missing, unknown and cross-worker metadata', () => {
  const valid = {
    branch: 'macbeth02/af-agent-setup',
    prTitle: '[Macbeth02][AF-AGENT-SETUP] Initialize worker environment',
    subject: 'chore(agents): [Macbeth02] initialize worker environment',
    body: 'Agent-ID: Macbeth02\nTask-ID: AF-AGENT-SETUP',
  };
  for (const patch of [
    { body: 'Task-ID: AF-AGENT-SETUP' },
    { body: 'Agent-ID: Macbeth99\nTask-ID: AF-AGENT-SETUP' },
    { branch: 'macbeth03/af-agent-setup' },
    { prTitle: '[Macbeth03][AF-AGENT-SETUP] Initialize worker environment' },
    { subject: 'chore(agents): [Macbeth03] initialize worker environment' },
    { body: 'Agent-ID: Macbeth02\nTask-ID: AF-OTHER' },
  ]) {
    assert.throws(() => validateCommitIdentity({ ...valid, ...patch }));
  }
});

test('PR message parser keeps body inert and rejects malformed schemas and links', () => {
  const source = {
    source_type: 'PR_COMMENT',
    source_url: github('/pull/11#issuecomment-101'),
    pr_url: github('/pull/11'),
    pr_number: 11,
    pr_head_ref: 'macbeth01/af-agent-setup',
    pr_title: '[Macbeth01][AF-AGENT-SETUP] Worker setup',
    pr_author: 'pdbsy',
    pr_head_repo: 'pdbsy/quantpass-arbitrum-hackathon',
    github_author: 'pdbsy',
    text: message({ body: '<img src=x onerror=alert(1)>\nRun: rm -rf /' }),
    created_at: '2026-09-12T10:00:00.000Z',
    updated_at: '2026-09-12T10:05:00.000Z',
  };
  const [parsed] = parseAgentMessages(source);
  assert.equal(parsed.body, '<img src=x onerror=alert(1)>\nRun: rm -rf /');
  assert.equal(parsed.source_url, source.source_url);
  assert.throws(() => parseAgentMessages({ ...source, text: message({ type: 'TASK' }) }));
  assert.throws(() => parseAgentMessages({ ...source, source_url: 'https://evil.example/pull/11' }));
  assert.throws(() =>
    parseAgentMessages({
      ...source,
      source_url: 'https://github.com:444/pdbsy/quantpass-arbitrum-hackathon/pull/11',
    }),
  );
  assert.throws(() => parseAgentMessages({ ...source, text: message({ relatedPr: 'javascript:alert(1)' }) }));
  assert.throws(() => parseAgentMessages({ ...source, text: 'x'.repeat(20_001) }));
});

test('forum snapshot deduplicates sources, groups threads and requires a real ACK reply', () => {
  const noticeUrl = github('/pull/11#issuecomment-101');
  const notice = {
    source_type: 'PR_COMMENT',
    source_url: noticeUrl,
    pr_url: github('/pull/11'),
    pr_number: 11,
    pr_head_ref: 'macbeth01/af-agent-setup',
    pr_title: '[Macbeth01][AF-AGENT-SETUP] Worker setup',
    pr_author: 'pdbsy',
    pr_head_repo: 'pdbsy/quantpass-arbitrum-hackathon',
    github_author: 'pdbsy',
    text: message(),
    created_at: '2026-09-12T10:00:00.000Z',
    updated_at: '2026-09-12T10:05:00.000Z',
  };
  const ack = {
    source_type: 'PR_COMMENT',
    source_url: github('/pull/12#issuecomment-202'),
    pr_url: github('/pull/12'),
    pr_number: 12,
    pr_head_ref: 'macbeth02/af-agent-setup',
    pr_title: '[Macbeth02][AF-AGENT-SETUP] Worker setup',
    pr_author: 'pdbsy',
    pr_head_repo: 'pdbsy/quantpass-arbitrum-hackathon',
    github_author: 'pdbsy',
    text: message({
      agent: 'Macbeth02',
      to: 'Macbeth01',
      type: 'ACK',
      replyTo: noticeUrl,
      relatedPr: github('/pull/12'),
      body: 'Read and confirmed.',
    }),
    created_at: '2026-09-12T10:10:00.000Z',
    updated_at: '2026-09-12T10:10:00.000Z',
  };
  const snapshot = buildForumSnapshot([notice, { ...notice }, ack], {
    syncedAt: '2026-09-12T10:11:00.000Z',
  });
  assert.equal(snapshot.messages.length, 2);
  assert.equal(snapshot.threads.length, 1);
  assert.equal(snapshot.threads[0].thread, 'AF-AGENT-SETUP');
  assert.equal(snapshot.messages.find((item) => item.type === 'NOTICE').ack_state, 'ACKNOWLEDGED');
  assert.equal(snapshot.messages.find((item) => item.type === 'ACK').ack_state, 'NOT_APPLICABLE');
  assert.equal(snapshot.messages.find((item) => item.type === 'ACK').reply_to, noticeUrl);
});

test('forum filtering covers agent, keyword, message type and thread', () => {
  const messages = [
    { agent: 'Macbeth01', type: 'NOTICE', thread: 'AF-AGENT-SETUP', body: 'protocol ready' },
    { agent: 'Macbeth02', type: 'BLOCKED', thread: 'AF-OTHER', body: 'waiting for interface' },
  ];
  assert.equal(filterForumMessages(messages, { agent: 'Macbeth02' }).length, 1);
  assert.equal(filterForumMessages(messages, { keyword: 'PROTOCOL' }).length, 1);
  assert.equal(filterForumMessages(messages, { type: 'BLOCKED' }).length, 1);
  assert.equal(filterForumMessages(messages, { thread: 'AF-AGENT-SETUP' }).length, 1);
});

test('collector projects only safe PR fields and never copies secret-like properties', () => {
  const pulls = [
    {
      number: 11,
      html_url: github('/pull/11'),
      title: '[Macbeth01][AF-AGENT-SETUP] Worker setup',
      head: { ref: 'macbeth01/af-agent-setup', repo: { full_name: 'pdbsy/quantpass-arbitrum-hackathon' } },
      body: message(),
      created_at: '2026-09-12T10:00:00.000Z',
      updated_at: '2026-09-12T10:05:00.000Z',
      user: { login: 'pdbsy', token: 'ghp_' + 'x'.repeat(36) },
      comments: [
        {
          html_url: github('/pull/11#issuecomment-101'),
          body: message(),
          created_at: '2026-09-12T10:01:00.000Z',
          updated_at: '2026-09-12T10:02:00.000Z',
          user: { login: 'reviewer', password: 'do-not-copy' },
        },
      ],
      reviews: [],
    },
  ];
  const records = recordsFromPullRequests(pulls);
  assert.equal(records.length, 2);
  assert.equal(records[1].github_author, 'reviewer');
  assert.doesNotMatch(JSON.stringify(records), /ghp_|do-not-copy|password|token/);
});

test('forum exposes source failure and computes stale state from last successful sync', () => {
  const failed = buildForumSnapshot([], {
    sourceState: 'ERROR',
    sourceError: 'GitHub source unavailable',
    syncedAt: null,
  });
  assert.deepEqual(failed.source, {
    state: 'ERROR',
    error: 'GitHub source unavailable',
    last_sync_at: null,
  });
  const snapshot = buildForumSnapshot([], { syncedAt: '2026-09-12T10:00:00.000Z' });
  assert.equal(isForumSnapshotStale(snapshot, '2026-09-12T10:14:59.000Z'), false);
  assert.equal(isForumSnapshotStale(snapshot, '2026-09-12T10:15:01.000Z'), true);
});

test('explicit task IDs in commit subjects agree with Task-ID trailers', () => {
  const valid = {
    branch: 'macbeth01/AF-MIGRATION-closeout',
    prTitle: '[Macbeth01][AF-MIGRATION] Closeout',
    subject: '[Macbeth01][AF-MIGRATION] Closeout',
    body: 'Agent-ID: Macbeth01\nTask-ID: AF-MIGRATION',
  };
  assert.doesNotThrow(() => validateCommitIdentity(valid));
  assert.throws(() => validateCommitIdentity({ ...valid, subject: '[Macbeth01][AF-OTHER] Closeout' }));
  assert.throws(() => validateCommitIdentity({ ...valid, subject: 'fix(AF-OTHER): [Macbeth01] Closeout' }));
  assert.throws(() => validateCommitIdentity({ ...valid, body: 'Agent-ID: Macbeth01\nTask-ID: malformed' }));
  assert.throws(() => validateCommitIdentity({ ...valid, body: 'Agent-ID: Macbeth01' }));
});

test('PR11-P5 collectors never publish capped or omitted records as unqualified OK', () => {
  const pulls = Array.from({ length: 101 }, (_, n) => ({
    number: n + 1,
    html_url: github(`/pull/${n + 1}`),
    title: '[Macbeth01][AF-MIGRATION] Source',
    head: { ref: 'macbeth01/AF-MIGRATION-source', repo: { full_name: 'pdbsy/quantpass-arbitrum-hackathon' } },
    user: { login: 'pdbsy' },
    body: message({ relatedPr: github(`/pull/${n + 1}`) }),
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
    comments: [],
    reviews: [],
  }));
  const records = recordsFromPullRequests(pulls);
  assert.equal(records.length, 101);
  const many = Array.from({ length: 501 }, (_, index) => ({
    ...pulls[0],
    number: index + 1,
    html_url: github(`/pull/${index + 1}`),
  }));
  const capped = recordsFromPullRequests(many);
  assert.equal(capped.length, 500);
  assert.equal(buildForumSnapshot(capped).source.state, 'PARTIAL');
});

test('PR11-P6 a URL-only ACK cannot acknowledge two blocks; an explicit message ID selects one', () => {
  const source = {
    source_type: 'PR_COMMENT',
    source_url: github('/pull/11#issuecomment-999'),
    pr_url: github('/pull/11'),
    pr_number: 11,
    pr_head_ref: 'macbeth01/AF-MIGRATION-source',
    pr_title: '[Macbeth01][AF-MIGRATION] Source',
    pr_author: 'pdbsy',
    pr_head_repo: 'pdbsy/quantpass-arbitrum-hackathon',
    github_author: 'pdbsy',
    text: message({ body: 'First logical message' }) + '\n' + message({ body: 'Second logical message' }),
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
  };
  const ack = {
    ...source,
    source_url: github('/pull/12#issuecomment-998'),
    pr_url: github('/pull/12'),
    pr_number: 12,
    pr_head_ref: 'macbeth02/AF-MIGRATION-source',
    pr_title: '[Macbeth02][AF-MIGRATION] Source',
    text: message({
      agent: 'Macbeth02',
      to: 'Macbeth01',
      type: 'ACK',
      replyTo: source.source_url,
      relatedPr: github('/pull/12'),
    }),
  };
  const ambiguous = buildForumSnapshot([source, ack]);
  assert.equal(
    ambiguous.messages.filter((m) => m.type !== 'ACK' && m.ack_state === 'ACKNOWLEDGED').length,
    0,
  );
  const target = parseAgentMessages(source)[1];
  const explicit = {
    ...ack,
    text: ack.text.replace('Body:', `Reply-To-Message: ${target.message_id}\nBody:`),
  };
  const precise = buildForumSnapshot([source, explicit]);
  assert.deepEqual(
    precise.messages.filter((m) => m.ack_state === 'ACKNOWLEDGED').map((m) => m.message_id),
    [target.message_id],
  );
  const wrong = { ...ack, text: ack.text.replace('Body:', 'Reply-To-Message: afm-0000000000000000\nBody:') };
  assert.equal(
    buildForumSnapshot([source, wrong]).messages.filter((m) => m.ack_state === 'ACKNOWLEDGED').length,
    0,
  );
});

test('M3 numbered branches preserve agent ownership across registry, commits and PRs', () => {
  const input = {
    branch: '02/protocol-m3',
    prTitle: '[Macbeth02][M3-02-PROTOCOL] Implement protocol',
    subject: 'feat(M3-02-PROTOCOL): [Macbeth02] implement protocol',
    body: 'Agent-ID: Macbeth02\nTask-ID: M3-02-PROTOCOL',
  };
  assert.deepEqual(validateCommitIdentity(input), { agentId: 'Macbeth02', taskId: 'M3-02-PROTOCOL' });
  for (const patch of [
    { branch: '03/protocol-m3' },
    { branch: '02x/protocol-m3' },
    { branch: '06/protocol-m3' },
    { body: 'Agent-ID: Macbeth02\nTask-ID: M3-03-PROTOCOL' },
    { subject: 'feat(M3-03-PROTOCOL): [Macbeth02] implement protocol' },
    { prTitle: '[Macbeth02][M3-03-PROTOCOL] Implement protocol' },
  ])
    assert.throws(() => validateCommitIdentity({ ...input, ...patch }));
});

test('M3 registry binds each numbered prefix and task to its own worker', async () => {
  const registry = JSON.parse(await read('docs/management/agents/registry.json'));
  const current = structuredClone(registry);
  Object.assign(current.agents[1], { branch_prefix: '02/', current_task: 'M3-02-PROTOCOL' });
  assert.doesNotThrow(() => validateRegistry(current));
  for (const patch of [{ branch_prefix: '03/' }, { current_task: 'M3-03-PROTOCOL' }]) {
    const invalid = structuredClone(current);
    Object.assign(invalid.agents[1], patch);
    assert.throws(() => validateRegistry(invalid));
  }
});

test('Forum accepts numbered M3 ownership but rejects cross-worker task identity', () => {
  const record = {
    source_type: 'PR_DESCRIPTION',
    source_url: github('/pull/20'),
    pr_url: github('/pull/20'),
    pr_number: 20,
    pr_head_ref: '02/protocol-m3',
    pr_title: '[Macbeth02][M3-02-PROTOCOL] Protocol',
    pr_author: 'pdbsy',
    github_author: 'pdbsy',
    pr_head_repo: 'pdbsy/quantpass-arbitrum-hackathon',
    text: message({ agent: 'Macbeth02', thread: 'M3-02-PROTOCOL', relatedPr: github('/pull/20') }),
    created_at: '2026-09-14T10:00:00.000Z',
    updated_at: '2026-09-14T10:00:00.000Z',
  };
  assert.equal(buildForumSnapshot([record]).messages.length, 1);
  for (const patch of [
    { pr_head_ref: '03/protocol-m3' },
    { pr_title: '[Macbeth02][M3-03-PROTOCOL] Protocol' },
  ])
    assert.equal(buildForumSnapshot([{ ...record, ...patch }]).messages.length, 0);
});

test('all numbered M3 workers accept their own task and reject the next worker task', () => {
  for (const [prefix, agent, task, otherTask] of [
    ['02/', 'Macbeth02', 'M3-02-PROTOCOL', 'M3-03-AUDIT'],
    ['03/', 'Macbeth03', 'M3-03-AUDIT', 'M3-04-AUDIT'],
    ['04/', 'Macbeth04', 'M3-04-AUDIT', 'M3-05-AUDIT'],
    ['05/', 'Macbeth05', 'M3-05-AUDIT', 'M3-02-PROTOCOL'],
  ]) {
    const input = {
      branch: `${prefix}m3-work`,
      subject: `[${agent}][${task}] Work`,
      body: `Agent-ID: ${agent}\nTask-ID: ${task}`,
      prTitle: `[${agent}][${task}] Work`,
    };
    assert.deepEqual(validateCommitIdentity(input), { agentId: agent, taskId: task });
    assert.throws(() =>
      validateCommitIdentity({ ...input, body: `Agent-ID: ${agent}\nTask-ID: ${otherTask}` }),
    );
  }
});

test('forum source boundaries reject malformed provenance, URLs, dates and message headers', () => {
  const source = {
    source_type: 'PR_COMMENT',
    source_url: github('/pull/22#issuecomment-101'),
    pr_url: github('/pull/22'),
    pr_number: 22,
    github_author: 'pdbsy',
    pr_head_ref: 'macbeth01/m3-phase1-closeout',
    pr_title: '[Macbeth01][M3-01-PHASE1-CLOSEOUT] Close out',
    pr_author: 'pdbsy',
    pr_head_repo: 'pdbsy/quantpass-arbitrum-hackathon',
    text: message({ relatedPr: github('/pull/22') }),
    created_at: '2026-09-23T00:00:00.000Z',
    updated_at: '2026-09-23T00:00:00.000Z',
  };
  assert.equal(buildForumSnapshot([source]).messages.length, 1);
  for (const patch of [
    { source_type: 'ISSUE' },
    { pr_number: 0 },
    { pr_number: 0.5 },
    { github_author: null },
    { github_author: 'not/a/login' },
    { text: 42 },
    { created_at: null },
    { updated_at: 'x'.repeat(41) },
    { updated_at: 'not-a-date' },
    { source_url: null },
    { source_url: 'x'.repeat(501) },
    { source_url: github('/pull/22?access=fixture') },
    { source_url: github('/pull/22#unsupported') },
    { source_url: 'https://github.com/other/repo/pull/22' },
    { pr_url: github('/pull/22#issuecomment-101') },
  ])
    assert.throws(() => parseAgentMessages({ ...source, ...patch }), /input rejected/);
  for (const value of [null, [], 'record']) assert.throws(() => parseAgentMessages(value), /input rejected/);
  for (const patch of [
    { pr_head_ref: null },
    { pr_title: null },
    { pr_head_repo: 'other/repo' },
    { pr_author: null },
    { github_author: 'other-author' },
  ]) {
    const rejected = buildForumSnapshot([{ ...source, ...patch }]);
    assert.equal(rejected.messages.length, 0);
    assert.equal(rejected.source.state, 'PARTIAL');
    assert.equal(rejected.source.rejected_records, 1);
  }
  for (const text of [
    source.text.replace('Schema-Version: 1', 'Schema-Version: 2'),
    source.text.replace('Agent: Macbeth01', 'Agent: Macbeth99'),
    source.text.replace('To: Macbeth02', 'To: Macbeth99'),
    source.text.replace('Thread: AF-AGENT-SETUP', 'Thread: bad/thread'),
    source.text.replace('Body:', 'Unknown: value\nBody:'),
    source.text.replace('Body:', 'not a header\nBody:'),
    source.text.replace('Body:', 'Agent: Macbeth01\nBody:'),
    source.text.replace('Body:', ''),
    source.text.replace('Body:', 'Reply-To-Message: afm-0123456789abcdef\nBody:'),
    message({ body: '' }),
    message({ body: 'x'.repeat(4001) }),
    message({ replyTo: github('/pull/22#issuecomment-101') }).replace(
      'Body:',
      'Reply-To-Message: wrong\nBody:',
    ),
  ])
    assert.throws(() => parseAgentMessages({ ...source, text }), /input rejected/);
  assert.equal(parseAgentMessages({ ...source, text: source.text.replace('Agent:', '\nAgent:') }).length, 1);
});

test('forum limits and absent API fields remain partial or stale rather than asserting success', () => {
  for (const records of [null, {}, Array(501).fill(null)]) assert.throws(() => buildForumSnapshot(records));
  for (const options of [{ sourceState: 'PASS' }, { sourceError: 42 }, { sourceError: 'x'.repeat(201) }])
    assert.throws(() => buildForumSnapshot([], options));
  assert.throws(() => filterForumMessages(null));
  assert.deepEqual(filterForumMessages([]), []);
  assert.throws(() => recordsFromPullRequests({}));
  const projected = recordsFromPullRequests([
    { number: 22, html_url: github('/pull/22'), body: null, submitted_at: '2026-09-23T00:00:00.000Z' },
  ]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].text, '');
  assert.equal(projected[0].created_at, '2026-09-23T00:00:00.000Z');
  assert.equal(projected[0].updated_at, '2026-09-23T00:00:00.000Z');
  assert.equal(isForumSnapshotStale(null), true);
  assert.equal(isForumSnapshotStale({ source: { last_sync_at: '2000-01-01T00:00:00.000Z' } }), true);
});

test('identity registry and bootstrap reject unrecognized state and malformed identity declarations', async () => {
  const registry = JSON.parse(await read('docs/management/agents/registry.json'));
  for (const field of [
    'workspace_status',
    'session_status',
    'self_confirmation',
    'communication_status',
    'runtime_status',
  ]) {
    const altered = structuredClone(registry);
    altered.agents[0][field] = 'APPROVED';
    assert.throws(() => validateRegistry(altered), /invalid/);
  }
  for (const input of [
    null,
    [],
    'registry',
    { ...registry, protocol_version: 1 },
    { ...registry, protocol_version: 'bad' },
    { ...registry, protocol_version: '9.9.9' },
  ])
    assert.throws(() => validateRegistry(input));
  for (const input of [
    null,
    'x'.repeat(20001),
    '',
    'AGENT_NAME = Macbeth01\nAGENT_NAME = Macbeth01\nBRANCH_PREFIX = macbeth01/',
    'AGENT_NAME = Macbeth99\nBRANCH_PREFIX = macbeth99/',
    'AGENT_NAME = Macbeth01\nBRANCH_PREFIX = macbeth02/',
  ])
    assert.throws(() => validateBootstrapIdentity(input, registry));
  const { agentForBranch, taskMatchesAgent } = await import('../tools/agent-identity.mjs');
  assert.equal(agentForBranch(null), null);
  assert.equal(taskMatchesAgent(null, 'Macbeth01'), false);
  assert.equal(taskMatchesAgent('AF-SETUP', 'Macbeth99'), false);
  const commit = {
    branch: 'macbeth01/closeout',
    subject: '[Macbeth01][M3-01-PHASE1-CLOSEOUT] Check',
    body: 'Agent-ID: Macbeth01\nTask-ID: M3-01-PHASE1-CLOSEOUT',
  };
  for (const patch of [{ branch: null }, { prTitle: 42 }, { prTitle: '[Macbeth99][AF-SETUP] Check' }])
    assert.throws(() => validateCommitIdentity({ ...commit, ...patch }));
});

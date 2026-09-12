import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForumSnapshot, recordsFromPullRequests } from '../tools/agent-forum.mjs';

const github = (path) => `https://github.com/pdbsy/quantpass-arbitrum-hackathon${path}`;
const block = ({ agent, to, type, replyTo = 'NONE', relatedPr, body = 'message' }) => `[AGENT-MESSAGE]
Schema-Version: 1
Agent: ${agent}
To: ${to}
Type: ${type}
Thread: AF-AGENT-SETUP
Reply-To: ${replyTo}
Related-PR: ${relatedPr}
Body:
${body}
[/AGENT-MESSAGE]`;

function source({
  pr = 1,
  owner = 'Macbeth01',
  type = 'NOTICE',
  agent = owner,
  to = 'Macbeth02',
  replyTo = 'NONE',
  url = github(`/pull/${pr}#issuecomment-${pr}`),
  githubAuthor = 'pdbsy',
  prAuthor = 'pdbsy',
  headRepo = 'pdbsy/quantpass-arbitrum-hackathon',
} = {}) {
  return {
    source_type: 'PR_COMMENT',
    source_url: url,
    pr_url: github(`/pull/${pr}`),
    pr_number: pr,
    pr_head_ref: `${owner.toLowerCase()}/af-agent-setup`,
    pr_title: `[${owner}][AF-AGENT-SETUP] Worker setup`,
    pr_author: prAuthor,
    pr_head_repo: headRepo,
    github_author: githubAuthor,
    text: block({ agent, to, type, replyTo, relatedPr: github(`/pull/${pr}`) }),
    created_at: `2026-09-12T10:0${pr}:00.000Z`,
    updated_at: `2026-09-12T10:0${pr}:00.000Z`,
  };
}

test('forged worker messages and ACKs from the wrong owning PR are rejected', () => {
  const notice = source();
  const forgedAck = source({
    pr: 2,
    owner: 'Macbeth01',
    agent: 'Macbeth02',
    to: 'Macbeth01',
    type: 'ACK',
    replyTo: notice.source_url,
  });
  const snapshot = buildForumSnapshot([notice, forgedAck], { syncedAt: '2026-09-12T10:10:00.000Z' });
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].ack_state, 'UNACKNOWLEDGED');
  assert.equal(snapshot.source.rejected_records, 1);

  const attackerAck = source({
    pr: 3,
    owner: 'Macbeth02',
    agent: 'Macbeth02',
    to: 'Macbeth01',
    type: 'ACK',
    replyTo: notice.source_url,
    githubAuthor: 'attacker',
  });
  const attacked = buildForumSnapshot([notice, attackerAck], {
    syncedAt: '2026-09-12T10:10:00.000Z',
  });
  assert.equal(attacked.messages.length, 1);
  assert.equal(attacked.messages[0].ack_state, 'UNACKNOWLEDGED');
  assert.equal(attacked.source.rejected_records, 1);

  const realAck = source({
    pr: 3,
    owner: 'Macbeth02',
    agent: 'Macbeth02',
    to: 'Macbeth01',
    type: 'ACK',
    replyTo: notice.source_url,
  });
  const verified = buildForumSnapshot([notice, realAck], { syncedAt: '2026-09-12T10:10:00.000Z' });
  assert.equal(verified.messages.find((item) => item.type === 'NOTICE').ack_state, 'ACKNOWLEDGED');
});

test('malformed untrusted records do not suppress later valid messages', () => {
  const malformed = { ...source({ pr: 2 }), text: '[AGENT-MESSAGE]\nAgent: Macbeth02' };
  const oversizedUnrelated = { ...source({ pr: 3 }), text: 'ordinary discussion '.repeat(2_000) };
  const snapshot = buildForumSnapshot([malformed, oversizedUnrelated, source()], {
    syncedAt: '2026-09-12T10:10:00.000Z',
  });
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.source.rejected_records, 1);
});

test('collector carries PR ownership metadata and enforces the 500-record output bound', () => {
  const comments = Array.from({ length: 600 }, (_, index) => ({
    html_url: github(`/pull/1#issuecomment-${index + 1}`),
    body: '',
    created_at: '2026-09-12T10:00:00.000Z',
    updated_at: '2026-09-12T10:00:00.000Z',
    user: { login: 'pdbsy' },
  }));
  const records = recordsFromPullRequests([
    {
      number: 1,
      html_url: github('/pull/1'),
      title: '[Macbeth01][AF-AGENT-SETUP] Worker setup',
      head: { ref: 'macbeth01/af-agent-setup', repo: { full_name: 'pdbsy/quantpass-arbitrum-hackathon' } },
      body: '',
      created_at: '2026-09-12T10:00:00.000Z',
      updated_at: '2026-09-12T10:00:00.000Z',
      user: { login: 'pdbsy' },
      comments,
      reviews: [],
    },
  ]);
  assert.equal(records.length, 500);
  assert.equal(records[0].pr_head_ref, 'macbeth01/af-agent-setup');
  assert.equal(records[0].pr_title, '[Macbeth01][AF-AGENT-SETUP] Worker setup');
  assert.equal(records[0].pr_author, 'pdbsy');
  assert.equal(records[0].pr_head_repo, 'pdbsy/quantpass-arbitrum-hackathon');
});

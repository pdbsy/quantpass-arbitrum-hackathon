import { createHash } from 'node:crypto';
import { REGISTERED_AGENTS } from './agent-identity.mjs';

const AGENTS = new Set(REGISTERED_AGENTS);
const TYPES = new Set(['CHECK_IN', 'NOTICE', 'QUESTION', 'REPLY', 'ACK', 'BLOCKED', 'SUMMARY']);
const SOURCE_TYPES = new Set(['PR_DESCRIPTION', 'PR_COMMENT', 'PR_REVIEW']);
const HEADER_NAMES = new Set(['Schema-Version', 'Agent', 'To', 'Type', 'Thread', 'Reply-To', 'Related-PR']);
const MAX_SOURCE_LENGTH = 20_000;
const MAX_BODY_LENGTH = 4_000;
const MAX_RECORDS = 500;
const STALE_AFTER_MS = 15 * 60 * 1000;

function fail(message) {
  throw new Error(`Agent Forum input rejected: ${message}`);
}
function validDate(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) fail('invalid date');
  return value;
}
function githubUrl(value, { allowAnchor = true } = {}) {
  if (typeof value !== 'string' || value.length > 500) fail('invalid GitHub URL');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('invalid GitHub URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password)
    fail('GitHub URL must use the allowed origin');
  if (!/^\/pdbsy\/quantpass-arbitrum-hackathon\/pull\/\d+$/.test(url.pathname))
    fail('GitHub URL is outside the repository');
  if (url.search) fail('GitHub URL must not contain query parameters');
  if (!allowAnchor && url.hash) fail('related PR URL must not contain an anchor');
  if (url.hash && !/^#(?:issuecomment|pullrequestreview|discussion_r)-?\d+$/.test(url.hash))
    fail('GitHub URL has an unsupported anchor');
  return url.toString();
}
function sourceRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('source record must be an object');
  if (!SOURCE_TYPES.has(value.source_type)) fail('unsupported source type');
  if (!Number.isSafeInteger(value.pr_number) || value.pr_number <= 0) fail('invalid PR number');
  if (typeof value.github_author !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(value.github_author))
    fail('invalid GitHub author');
  if (typeof value.text !== 'string' || value.text.length > MAX_SOURCE_LENGTH)
    fail('source text is too large');
  return {
    source_type: value.source_type,
    source_url: githubUrl(value.source_url),
    pr_url: githubUrl(value.pr_url, { allowAnchor: false }),
    pr_number: value.pr_number,
    github_author: value.github_author,
    text: value.text.replaceAll('\r\n', '\n'),
    created_at: validDate(value.created_at),
    updated_at: validDate(value.updated_at),
  };
}
function owningAgent(value) {
  if (typeof value.pr_head_ref !== 'string' || typeof value.pr_title !== 'string')
    fail('PR ownership metadata is missing');
  const branch = value.pr_head_ref.match(/^(macbeth0[1-5])\//)?.[1];
  const title = value.pr_title.match(/^\[(Macbeth0[1-5])\]\[[A-Z0-9][A-Z0-9-]{1,79}\]\s+\S/)?.[1];
  if (!branch || !title) fail('PR does not have a registered worker identity');
  const branchAgent = `Macbeth${branch.slice(-2)}`;
  if (branchAgent !== title) fail('PR branch and title identities disagree');
  if (value.pr_head_repo !== 'pdbsy/quantpass-arbitrum-hackathon') fail('PR head repository is not trusted');
  if (typeof value.pr_author !== 'string' || value.github_author !== value.pr_author)
    fail('message author does not own the source PR');
  return branchAgent;
}
function parseBlock(block, source, blockIndex) {
  const lines = block.trim().replaceAll('\r\n', '\n').split('\n');
  const fields = new Map();
  let bodyIndex = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line === 'Body:') {
      bodyIndex = index;
      break;
    }
    const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!match || !HEADER_NAMES.has(match[1]) || fields.has(match[1])) fail('malformed or duplicate header');
    fields.set(match[1], match[2]);
  }
  if (bodyIndex < 0 || fields.size !== HEADER_NAMES.size) fail('message is missing required fields');
  const body = lines
    .slice(bodyIndex + 1)
    .join('\n')
    .trim();
  if (!body || body.length > MAX_BODY_LENGTH) fail('message body is empty or too large');
  if (fields.get('Schema-Version') !== '1') fail('unsupported schema version');
  const agent = fields.get('Agent');
  const to = fields.get('To');
  const type = fields.get('Type');
  const thread = fields.get('Thread');
  if (!AGENTS.has(agent)) fail('unknown agent');
  if (to !== 'ALL' && !AGENTS.has(to)) fail('unknown target agent');
  if (!TYPES.has(type)) fail('unsupported message type');
  if (!/^[A-Z0-9][A-Z0-9-]{1,79}$/.test(thread)) fail('invalid thread');
  const replyValue = fields.get('Reply-To');
  const replyTo = replyValue === 'NONE' ? null : githubUrl(replyValue);
  const relatedPr = githubUrl(fields.get('Related-PR'), { allowAnchor: false });
  return {
    message_id: `afm-${createHash('sha256').update(`${source.source_url}#${blockIndex}`).digest('hex').slice(0, 16)}`,
    schema_version: 1,
    agent,
    to,
    type,
    thread,
    reply_to: replyTo,
    related_pr: relatedPr,
    body,
    github_author: source.github_author,
    source_type: source.source_type,
    source_url: source.source_url,
    pr_number: source.pr_number,
    created_at: source.created_at,
    updated_at: source.updated_at,
    ack_state: 'UNACKNOWLEDGED',
  };
}

export function parseAgentMessages(value) {
  const source = sourceRecord(value);
  const matches = [...source.text.matchAll(/\[AGENT-MESSAGE\]([\s\S]*?)\[\/AGENT-MESSAGE\]/g)];
  if (!matches.length && source.text.includes('[AGENT-MESSAGE]')) fail('message block is not closed');
  return matches.map((match, index) => parseBlock(match[1], source, index));
}

function verifiedAgentMessages(record) {
  if (typeof record?.text === 'string' && !record.text.includes('[AGENT-MESSAGE]')) return [];
  const owner = owningAgent(record);
  const messages = parseAgentMessages(record);
  if (messages.some((message) => message.agent !== owner)) fail('message agent does not own the source PR');
  return messages;
}

export function buildForumSnapshot(
  records,
  { syncedAt = new Date().toISOString(), sourceState = 'OK', sourceError = null } = {},
) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) fail('record limit exceeded');
  if (!new Set(['OK', 'ERROR', 'NOT_SYNCED']).has(sourceState)) fail('invalid source state');
  if (sourceError !== null && (typeof sourceError !== 'string' || sourceError.length > 200))
    fail('invalid source error');
  const lastSyncAt = validDate(syncedAt, true);
  const byId = new Map();
  let rejectedRecords = 0;
  for (const record of records) {
    try {
      for (const message of verifiedAgentMessages(record)) {
        const existing = byId.get(message.message_id);
        if (!existing || Date.parse(message.updated_at) >= Date.parse(existing.updated_at))
          byId.set(message.message_id, message);
      }
    } catch {
      rejectedRecords++;
    }
  }
  const messages = [...byId.values()].sort(
    (left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at) ||
      left.message_id.localeCompare(right.message_id),
  );
  for (const item of messages) {
    if (item.type === 'ACK') {
      item.ack_state = 'NOT_APPLICABLE';
      continue;
    }
    const acknowledged = messages.some(
      (candidate) =>
        candidate.type === 'ACK' &&
        candidate.thread === item.thread &&
        candidate.reply_to === item.source_url &&
        candidate.to === item.agent &&
        (item.to === 'ALL' || candidate.agent === item.to),
    );
    item.ack_state = acknowledged ? 'ACKNOWLEDGED' : 'UNACKNOWLEDGED';
  }
  const threadMap = new Map();
  for (const item of messages) {
    const thread = threadMap.get(item.thread) || {
      thread: item.thread,
      message_count: 0,
      agents: new Set(),
      last_updated_at: item.updated_at,
    };
    thread.message_count++;
    thread.agents.add(item.agent);
    if (Date.parse(item.updated_at) > Date.parse(thread.last_updated_at))
      thread.last_updated_at = item.updated_at;
    threadMap.set(item.thread, thread);
  }
  const threads = [...threadMap.values()]
    .map((thread) => ({ ...thread, agents: [...thread.agents].sort() }))
    .sort((left, right) => Date.parse(right.last_updated_at) - Date.parse(left.last_updated_at));
  const source = { state: sourceState, error: sourceError, last_sync_at: lastSyncAt };
  if (rejectedRecords) source.rejected_records = rejectedRecords;
  return { schema_version: 1, source, messages, threads };
}

export function filterForumMessages(messages, filters = {}) {
  if (!Array.isArray(messages)) fail('messages must be an array');
  const keyword = typeof filters.keyword === 'string' ? filters.keyword.trim().toLocaleLowerCase() : '';
  return messages.filter(
    (item) =>
      (!filters.agent || item.agent === filters.agent) &&
      (!filters.type || item.type === filters.type) &&
      (!filters.thread || item.thread === filters.thread) &&
      (!keyword ||
        [item.agent, item.type, item.thread, item.body, item.github_author]
          .filter((value) => typeof value === 'string')
          .join(' ')
          .toLocaleLowerCase()
          .includes(keyword)),
  );
}

export function isForumSnapshotStale(snapshot, now = new Date().toISOString()) {
  const syncedAt = snapshot?.source?.last_sync_at;
  if (!syncedAt) return true;
  return Date.parse(now) - Date.parse(syncedAt) > STALE_AFTER_MS;
}
function projectedRecord(sourceType, pull, item) {
  return {
    source_type: sourceType,
    source_url: item.html_url,
    pr_url: pull.html_url,
    pr_number: pull.number,
    pr_head_ref: pull.head?.ref,
    pr_title: pull.title,
    pr_author: pull.user?.login,
    pr_head_repo: pull.head?.repo?.full_name,
    github_author: item.user?.login,
    text: typeof item.body === 'string' ? item.body : '',
    created_at: item.created_at ?? item.submitted_at,
    updated_at: item.updated_at ?? item.submitted_at,
  };
}
export function recordsFromPullRequests(pulls) {
  if (!Array.isArray(pulls)) fail('pull requests must be an array');
  const records = [];
  const append = (record) => {
    if (records.length < MAX_RECORDS) records.push(record);
  };
  for (const pull of pulls.slice(0, 100)) {
    append(projectedRecord('PR_DESCRIPTION', pull, pull));
    for (const comment of pull.comments || []) append(projectedRecord('PR_COMMENT', pull, comment));
    for (const review of pull.reviews || []) append(projectedRecord('PR_REVIEW', pull, review));
    if (records.length === MAX_RECORDS) break;
  }
  return records;
}
export const AGENT_MESSAGE_TYPES = Object.freeze([...TYPES]);

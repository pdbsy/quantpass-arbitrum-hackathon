const AGENTS = [1, 2, 3, 4, 5].map((number) => `Macbeth0${number}`);
const AGENT_SET = new Set(AGENTS);
const WORKSPACE_STATUSES = new Set(['NOT_STARTED', 'CONFIG_PREPARED', 'WORKSPACE_PREPARED', 'BLOCKED']);
const SESSION_STATUSES = new Set([
  'NOT_STARTED',
  'USER_ACTION_REQUIRED',
  'SESSION_CREATED',
  'SELF_CONFIRMED',
  'BLOCKED',
]);
const CONFIRMATION_STATUSES = new Set(['UNVERIFIED', 'VERIFIED']);
const COMMUNICATION_STATUSES = new Set(['UNVERIFIED', 'COMMUNICATION_VERIFIED', 'BLOCKED']);
const RUNTIME_STATUSES = new Set(['ACTIVE', 'READY', 'BLOCKED', 'IDLE']);
const TASK_PATTERN = /^AF-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function fail(message) {
  throw new Error(`Agent identity validation failed: ${message}`);
}
function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

export function validateRegistry(value) {
  assertPlainObject(value, 'registry');
  if (typeof value.protocol_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.protocol_version))
    fail('invalid protocol_version');
  if (!Array.isArray(value.agents) || value.agents.length !== AGENTS.length)
    fail('registry must contain exactly five agents');
  const seen = new Set();
  const agents = value.agents.map((agent, index) => {
    assertPlainObject(agent, `agents[${index}]`);
    if (agent.agent_id !== AGENTS[index] || !AGENT_SET.has(agent.agent_id))
      fail(`unexpected agent at index ${index}`);
    if (seen.has(agent.agent_id)) fail(`duplicate agent ${agent.agent_id}`);
    seen.add(agent.agent_id);
    if (agent.branch_prefix !== `${agent.agent_id.toLowerCase()}/`)
      fail(`${agent.agent_id} has an invalid branch prefix`);
    if (!WORKSPACE_STATUSES.has(agent.workspace_status))
      fail(`${agent.agent_id} has an invalid workspace status`);
    if (!SESSION_STATUSES.has(agent.session_status)) fail(`${agent.agent_id} has an invalid session status`);
    if (!CONFIRMATION_STATUSES.has(agent.self_confirmation))
      fail(`${agent.agent_id} has an invalid confirmation status`);
    if (!COMMUNICATION_STATUSES.has(agent.communication_status))
      fail(`${agent.agent_id} has an invalid communication status`);
    if (agent.current_task !== 'NONE' && !TASK_PATTERN.test(agent.current_task))
      fail(`${agent.agent_id} has an invalid current task`);
    if (!RUNTIME_STATUSES.has(agent.runtime_status)) fail(`${agent.agent_id} has an invalid runtime status`);
    return { ...agent };
  });
  return { ...value, agents };
}

export function validateBootstrapIdentity(text, registry) {
  if (typeof text !== 'string' || text.length > 20_000) fail('bootstrap must be bounded text');
  const agentMatches = [...text.matchAll(/^AGENT_NAME = (\S+)$/gm)];
  const prefixMatches = [...text.matchAll(/^BRANCH_PREFIX = (\S+)$/gm)];
  if (agentMatches.length !== 1 || prefixMatches.length !== 1)
    fail('bootstrap must declare one identity and prefix');
  const agentId = agentMatches[0][1];
  const branchPrefix = prefixMatches[0][1];
  const known = validateRegistry(registry).agents.find((agent) => agent.agent_id === agentId);
  if (!known || known.branch_prefix !== branchPrefix) fail('bootstrap identity does not match registry');
  return { agentId, branchPrefix };
}

function oneMatch(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) fail(`${label} must appear exactly once`);
  return matches[0][1];
}

export function validateCommitIdentity({ branch, prTitle = null, subject, body }) {
  for (const [label, value] of Object.entries({ branch, subject, body }))
    if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`);
  const branchPrefix = branch.match(/^(macbeth0[1-5])\//)?.[1];
  if (!branchPrefix) fail('branch must use a registered worker prefix');
  const branchAgent = `Macbeth${branchPrefix.slice(-2)}`;
  const subjectAgent = oneMatch(subject, /\[(Macbeth\d{2})\]/g, 'commit subject Agent-ID');
  const bodyAgent = oneMatch(body, /^Agent-ID:\s*(\S+)\s*$/gm, 'commit body Agent-ID');
  const bodyTask = oneMatch(body, /^Task-ID:\s*(\S+)\s*$/gm, 'commit body Task-ID');
  if (!AGENT_SET.has(subjectAgent) || !AGENT_SET.has(bodyAgent)) fail('commit contains an unknown agent');
  if (!TASK_PATTERN.test(bodyTask)) fail('commit contains an invalid task ID');
  if (subjectAgent !== branchAgent || bodyAgent !== branchAgent) fail('branch and commit agent do not match');
  if (prTitle !== null) {
    if (typeof prTitle !== 'string') fail('PR title must be text');
    const match = prTitle.match(/^\[(Macbeth\d{2})\]\[(AF-[A-Z0-9]+(?:-[A-Z0-9]+)*)\]\s+\S/);
    if (!match || !AGENT_SET.has(match[1])) fail('PR title does not use the required format');
    if (match[1] !== branchAgent || match[2] !== bodyTask)
      fail('PR, branch and commit metadata do not match');
  }
  return { agentId: branchAgent, taskId: bodyTask };
}

export const REGISTERED_AGENTS = Object.freeze([...AGENTS]);

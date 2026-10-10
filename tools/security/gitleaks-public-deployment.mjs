import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { getAddress, getCreateAddress } from 'ethers';
import { cleanEnvironment, root as repositoryRoot } from '../ci/context.mjs';
import { classifyGitleaks } from './results.mjs';

// This is a proof for fourteen occurrences in one already published immutable blob.
// No scanner detector, filename suffix, token field or general hexadecimal address is exempted.
export const PUBLIC_DEPLOYMENT_OCCURRENCE = Object.freeze({
  id: 'GITLEAKS-PUBLIC-DEPLOYMENT-001',
  rule: 'generic-api-key',
  file: 'docs/deployment-approved.json',
  blob: '217c52a7cf700097f1b836be6dc5db2b3ab54cdd',
  sha256: '58a937c220f17d9b614d9db2b2da9a0e445d9034b8850520d7b7d9da4838bce8',
  publishedCommit: '0b9452a4ae458f082819d46795604d4961b045ee',
  wallet: '0x86767116cd40bf6b4f8cf88e08d11e38b04364cf',
  validFrom: '2026-10-10T00:00:00Z',
  expiresAt: '2026-10-20T00:00:00Z',
});
const lines = Object.freeze([
  [555, 'TSLAStock'],
  [591, 'TSLAStock'],
  [616, 'usdc'],
  [652, 'usdc'],
  [692, 'AMZNStock'],
  [728, 'AMZNStock'],
  [753, 'usdc'],
  [789, 'usdc'],
  [1003, 'usdc'],
  [1039, 'usdc'],
  [1064, 'usdc'],
  [1100, 'usdc'],
  [1215, 'amznPass'],
  [1243, 'usdc'],
]);
const labels = Object.freeze([
  'usdc',
  'tslaPass',
  'amznPass',
  'poolFactory',
  'conversionReserve',
  'router',
  'tslaLaunch',
  'claim',
  'TSLAStock',
  'TSLAFeed',
  'TSLAStockReserve',
  'AMZNStock',
  'AMZNFeed',
  'AMZNStockReserve',
  'vaultFactory',
]);
const oid = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
// Git's canonical SHA-1 OID is a protocol identity. The independent public payload pin remains SHA-256.
// hash-object without -w only computes an identifier; it does not create repository objects.
const objectId = (type, data) => {
  if (!['blob', 'commit', 'tree'].includes(type) || !Buffer.isBuffer(data) || data.length > 2 * 1024 * 1024)
    fail();
  const output = execFileSync(
    'git',
    ['--no-replace-objects', 'hash-object', '-t', type, '--stdin', '--no-filters'],
    {
      cwd: repositoryRoot,
      env: {
        ...cleanEnvironment(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_GRAFT_FILE: '/dev/null',
        GIT_NO_LAZY_FETCH: '1',
      },
      input: data,
      timeout: 5000,
      maxBuffer: 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).toString('utf8');
  if (!/^[0-9a-f]{40}\n$/.test(output)) fail();
  return output.trim();
};
const fail = () => {
  throw new Error('PUBLIC_DEPLOYMENT_PROOF_REJECTED');
};
function treeEntry(data, name) {
  if (!Buffer.isBuffer(data) || data.length > 2 * 1024 * 1024) fail();
  let offset = 0,
    found = null;
  while (offset < data.length) {
    const nul = data.indexOf(0, offset);
    if (nul === -1 || nul + 21 > data.length) fail();
    const header = data.subarray(offset, nul).toString('utf8');
    const match = /^(40000|100644|100755|120000|160000) ([^/\0]+)$/.exec(header);
    if (!match) fail();
    if (match[2] === name) {
      if (found) fail();
      found = { mode: match[1], oid: data.subarray(nul + 1, nul + 21).toString('hex') };
    }
    offset = nul + 21;
  }
  return found;
}
function pathBinding(proof, commit) {
  if (
    !proof ||
    !oid(commit) ||
    !Buffer.isBuffer(proof.commit) ||
    proof.commit.length > 64 * 1024 ||
    objectId('commit', proof.commit) !== commit
  )
    fail();
  const treeLine = /^tree ([0-9a-f]{40})\n/.exec(proof.commit.toString('utf8'));
  if (!treeLine || !Buffer.isBuffer(proof.rootTree) || objectId('tree', proof.rootTree) !== treeLine[1])
    fail();
  const docs = treeEntry(proof.rootTree, 'docs');
  if (
    !docs ||
    docs.mode !== '40000' ||
    !Buffer.isBuffer(proof.docsTree) ||
    objectId('tree', proof.docsTree) !== docs.oid
  )
    fail();
  const target = treeEntry(proof.docsTree, 'deployment-approved.json');
  if (!target || target.mode !== '100644' || target.oid !== PUBLIC_DEPLOYMENT_OCCURRENCE.blob) fail();
}
function qualifyBlob(proof) {
  const blob = proof?.blob;
  if (
    !Buffer.isBuffer(blob) ||
    blob.length > 2 * 1024 * 1024 ||
    objectId('blob', blob) !== PUBLIC_DEPLOYMENT_OCCURRENCE.blob ||
    sha256(blob) !== PUBLIC_DEPLOYMENT_OCCURRENCE.sha256
  )
    fail();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(blob);
  const payload = JSON.parse(text);
  const plan = payload?.plan,
    inputs = plan?.inputs;
  if (
    payload.schemaVersion !== 1 ||
    payload.chainId !== 46630 ||
    plan.schemaVersion !== 2 ||
    plan.chainId !== 46630 ||
    inputs.chainId !== 46630 ||
    inputs.nonce !== 0 ||
    getAddress(payload.approvedWallet).toLowerCase() !== PUBLIC_DEPLOYMENT_OCCURRENCE.wallet ||
    getAddress(inputs.deployer).toLowerCase() !== PUBLIC_DEPLOYMENT_OCCURRENCE.wallet ||
    getAddress(inputs.administrator).toLowerCase() !== PUBLIC_DEPLOYMENT_OCCURRENCE.wallet
  )
    fail();
  const deployments = plan.actions.filter((action) => action.unsigned?.to === null);
  if (deployments.length !== labels.length) fail();
  const addresses = {};
  for (const [nonce, label] of labels.entries()) {
    const action = deployments[nonce];
    const calculated = getCreateAddress({ from: PUBLIC_DEPLOYMENT_OCCURRENCE.wallet, nonce });
    if (
      action.operation !== 'DEPLOY_' + label ||
      action.nonce !== nonce ||
      action.chainId !== 46630 ||
      getAddress(action.caller).toLowerCase() !== PUBLIC_DEPLOYMENT_OCCURRENCE.wallet ||
      getAddress(action.contractAddress) !== calculated ||
      getAddress(plan.addresses[label]) !== calculated
    )
      fail();
    addresses[label] = calculated;
  }
  const sourceLines = text.split('\n');
  const actualTokenLines = sourceLines.flatMap((line, index) =>
    /"token"\s*:/.test(line) ? [index + 1] : [],
  );
  if (JSON.stringify(actualTokenLines) !== JSON.stringify(lines.map(([line]) => line))) fail();
  for (const [line, label] of lines) {
    const match = /^ {10}"token": "(0x[0-9a-fA-F]{40})",?$/.exec(sourceLines[line - 1]);
    if (!match || getAddress(match[1]) !== addresses[label]) fail();
  }
  pathBinding(proof.published, PUBLIC_DEPLOYMENT_OCCURRENCE.publishedCommit);
}
function targetFile(scope, stagedRoot) {
  if (scope === 'history') return PUBLIC_DEPLOYMENT_OCCURRENCE.file;
  if (
    scope !== 'current' ||
    typeof stagedRoot !== 'string' ||
    !isAbsolute(stagedRoot) ||
    stagedRoot !== resolve(stagedRoot)
  )
    fail();
  return join(stagedRoot, PUBLIC_DEPLOYMENT_OCCURRENCE.file);
}
function candidate(row, scope, file) {
  return (
    row?.RuleID === PUBLIC_DEPLOYMENT_OCCURRENCE.rule &&
    row.File === file &&
    lines.some(([line]) => row.StartLine === line && row.EndLine === line) &&
    (scope === 'history' ? oid(row.Commit) : row.Commit === '' || row.Commit === undefined)
  );
}

/** Reads raw typed Git objects with replacements, grafts and lazy network fetching disabled. */
export function readGitleaksPublicDeploymentProof(cwd, scanValue, { scope, stagedRoot } = {}) {
  try {
    const file = targetFile(scope, stagedRoot);
    if (classifyGitleaks(scanValue).state !== 'FAIL') return null;
    const read = (...args) =>
      execFileSync('git', ['--no-replace-objects', ...args], {
        cwd,
        env: {
          ...cleanEnvironment(),
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_GRAFT_FILE: '/dev/null',
          GIT_NO_LAZY_FETCH: '1',
        },
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const readPath = (commit) => {
      if (!oid(commit)) fail();
      const bytes = read('cat-file', 'commit', commit);
      const root = /^tree ([0-9a-f]{40})\n/.exec(bytes.toString('utf8'));
      if (!root) fail();
      const rootTree = read('cat-file', 'tree', root[1]);
      const docs = treeEntry(rootTree, 'docs');
      if (!docs || docs.mode !== '40000') fail();
      const docsTree = read('cat-file', 'tree', docs.oid);
      const binding = { commit: bytes, rootTree, docsTree };
      pathBinding(binding, commit);
      return binding;
    };
    const proof = {
      blob: read('cat-file', 'blob', PUBLIC_DEPLOYMENT_OCCURRENCE.blob),
      published: readPath(PUBLIC_DEPLOYMENT_OCCURRENCE.publishedCommit),
      commits: {},
      stagedRoot: scope === 'current' ? stagedRoot : null,
      stagedBlob: null,
    };
    qualifyBlob(proof);
    if (scope === 'history') {
      for (const commit of new Set(
        scanValue.report.filter((row) => candidate(row, scope, file)).map((row) => row.Commit),
      ))
        proof.commits[commit] = readPath(commit);
    } else {
      if (
        realpathSync(stagedRoot) !== stagedRoot ||
        !lstatSync(file).isFile() ||
        lstatSync(file).size > 2 * 1024 * 1024 ||
        realpathSync(file) !== file
      )
        fail();
      proof.stagedBlob = readFileSync(file);
      if (!proof.stagedBlob.equals(proof.blob)) fail();
    }
    return proof;
  } catch {
    return null;
  }
}

/** Keeps every raw finding; only independently proven occurrences can be removed from the remaining scan. */
export function adjudicateGitleaksPublicDeployment(
  scanValue,
  proof,
  { scope, stagedRoot, observedAt = new Date() } = {},
) {
  const raw = classifyGitleaks(scanValue);
  const result = { raw, state: raw.state, dispositions: [], remainingScanValue: scanValue };
  if (raw.state !== 'FAIL') return result;
  let file;
  try {
    file = targetFile(scope, stagedRoot);
  } catch {
    return result;
  }
  const hasCandidate = scanValue.report.some((row) => candidate(row, scope, file));
  if (!hasCandidate) return result;
  const instant = observedAt instanceof Date ? observedAt.getTime() : NaN;
  try {
    if (
      !Number.isFinite(instant) ||
      instant < Date.parse(PUBLIC_DEPLOYMENT_OCCURRENCE.validFrom) ||
      instant >= Date.parse(PUBLIC_DEPLOYMENT_OCCURRENCE.expiresAt)
    )
      fail();
    qualifyBlob(proof);
    if (
      scope === 'current' &&
      (proof.stagedRoot !== stagedRoot ||
        !Buffer.isBuffer(proof.stagedBlob) ||
        !proof.stagedBlob.equals(proof.blob))
    )
      fail();
  } catch {
    return { ...result, reason: 'Exact public deployment proof missing, altered or expired' };
  }
  const groups = new Map();
  for (const row of scanValue.report) {
    if (row.File !== file) continue;
    const key = scope === 'history' ? row.Commit : '';
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  const accepted = new Set();
  const dispositions = [];
  for (const [commit, rows] of groups) {
    if (
      rows.length !== lines.length ||
      !rows.every((row) => candidate(row, scope, file)) ||
      new Set(rows.map((row) => row.StartLine)).size !== lines.length
    )
      continue;
    try {
      if (scope === 'history') pathBinding(proof.commits[commit], commit);
    } catch {
      continue;
    }
    rows.forEach((row) => accepted.add(row));
    dispositions.push({
      ...PUBLIC_DEPLOYMENT_OCCURRENCE,
      scope,
      commit: commit || null,
      file,
      lines: lines.map(([line]) => line),
      decision: 'PROVEN_PUBLIC_CREATE_ADDRESSES',
      proof: 'VERIFIED',
      derivation:
        'Approved EOA + exact deployment nonce 0..14; pinned immutable blob bytes and typed Git path binding',
    });
  }
  if (!accepted.size) return result;
  const remainingReport = scanValue.report.filter((row) => !accepted.has(row));
  const remainingScanValue = {
    ...scanValue,
    status: remainingReport.length ? 10 : 0,
    report: remainingReport,
  };
  return { raw, state: classifyGitleaks(remainingScanValue).state, dispositions, remainingScanValue };
}

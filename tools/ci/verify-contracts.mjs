import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { root, inspect, assertUnchanged, run, emit, main } from './context.mjs';

export function validateContractHost(host) {
  if (
    host.platform !== 'darwin' ||
    host.arch !== 'arm64' ||
    host.python !== '3.12.9' ||
    host.pythonArch !== 'arm64'
  )
    throw new Error('Contract CI requires Darwin arm64 and native CPython 3.12.9');
}
const maxSlitherBytes = 16 * 1024 * 1024;

function requireRegularReport(stat) {
  if (!stat.isFile() || stat.nlink !== 1n) throw new Error('Slither report must be a private regular file');
}

function requireReportParents(path) {
  let parent = dirname(resolve(path));
  for (;;) {
    try {
      if (realpathSync(parent) !== parent) throw new Error('Slither report parents must not be symlinks');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}

function preservePreviousReport(path) {
  requireReportParents(path);
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  requireRegularReport(stat);
  const backup = join(mkdtempSync(join(dirname(path), '.slither-previous-')), 'slither.json');
  renameSync(path, backup);
  requireRegularReport(lstatSync(backup, { bigint: true }));
  return true;
}

function readSlitherReport(path) {
  requireReportParents(path);
  const before = lstatSync(path, { bigint: true });
  requireRegularReport(before);
  if (before.size === 0n || before.size > BigInt(maxSlitherBytes))
    throw new Error('Slither report is empty or exceeds the bounded input limit');
  const file = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let bytes;
  try {
    const opened = fstatSync(file, { bigint: true });
    requireRegularReport(opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw new Error('Slither report changed while opening');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(file, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    const after = fstatSync(file, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    requireRegularReport(current);
    if (
      BigInt(length) !== before.size ||
      after.size !== before.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw new Error('Slither report changed while reading');
    bytes = buffer.subarray(0, length);
  } finally {
    closeSync(file);
  }
  const evidence = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ...evidence, state: 'BLOCKED', reason: 'Slither report is not valid UTF-8 JSON' };
  }
  const object = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
  if (
    !object(value) ||
    !Object.hasOwn(value, 'success') ||
    typeof value.success !== 'boolean' ||
    !Object.hasOwn(value, 'error') ||
    (value.error !== null && typeof value.error !== 'string') ||
    !Object.hasOwn(value, 'results') ||
    !object(value.results) ||
    (Object.hasOwn(value.results, 'detectors') && !Array.isArray(value.results.detectors))
  )
    return { ...evidence, state: 'BLOCKED', reason: 'Slither report has an invalid result shape' };
  // Slither 0.11.3 omits detectors when there are no findings.
  const findings = value.results.detectors?.length ?? 0;
  const state = value.success && value.error === null && findings === 0 ? 'PASS' : 'FAIL';
  return { ...evidence, state, success: value.success, findings, errorPresent: value.error !== null };
}

export function runContractStages(execute, slitherReportPath) {
  const stages = [
    ['bootstrap', 'python3.12', ['contracts/script/bootstrap.py']],
    ['compiler-probe', './.checks/af-chain01/toolchain/bin/solc', ['--version']],
    ['contracts-and-abi', '/bin/bash', ['contracts/script/check-phase1-contracts.sh']],
  ];
  const results = [];
  let previousReportPreserved = false;
  for (const [stage, file, args] of stages) {
    if (stage === 'contracts-and-abi' && slitherReportPath !== undefined) {
      try {
        previousReportPreserved = preservePreviousReport(slitherReportPath);
      } catch {
        return {
          state: 'BLOCKED',
          abi: 'NOT_RUN',
          stages: results,
          slither: { state: 'BLOCKED', reason: 'Unable to preserve the prior Slither report safely' },
        };
      }
    }
    const result = execute(file, args);
    const incomplete = Boolean(result.error || result.signal || !Number.isInteger(result.status));
    const state =
      incomplete || (result.status !== 0 && stage !== 'contracts-and-abi')
        ? 'BLOCKED'
        : result.status === 0
          ? 'PASS'
          : 'FAIL';
    results.push({ stage, state, exitCode: result.status, incomplete });
    if (state !== 'PASS') {
      const report = {
        state,
        abi: stage === 'contracts-and-abi' ? 'UNCONFIRMED' : 'NOT_RUN',
        stages: results,
      };
      if (slitherReportPath !== undefined)
        report.slither = {
          state: stage === 'contracts-and-abi' ? 'UNCONFIRMED' : 'NOT_RUN',
          previousReportPreserved,
        };
      return report;
    }
  }
  if (slitherReportPath !== undefined) {
    let slither;
    try {
      slither = readSlitherReport(slitherReportPath);
    } catch {
      slither = { state: 'BLOCKED', reason: 'A fresh readable bounded Slither report is required' };
    }
    return {
      state: slither.state,
      abi: 'PASS',
      stages: results,
      slither: { ...slither, previousReportPreserved },
    };
  }
  return { state: 'PASS', abi: 'PASS', stages: results };
}
await main(import.meta.url, () => {
  const before = inspect();
  assertUnchanged(before, before);
  const probe = run('python3.12', [
    '-c',
    'import platform,sys,json; print(json.dumps({"python":platform.python_version(),"pythonArch":platform.machine()}))',
  ]);
  if (probe.status !== 0 || probe.error || probe.signal)
    throw new Error('Native Python prerequisite unavailable');
  validateContractHost({ platform: process.platform, arch: process.arch, ...JSON.parse(probe.stdout) });
  const lockBytes = readFileSync(resolve(root, 'contracts/toolchain.lock.json'));
  const lock = JSON.parse(lockBytes);
  const report = runContractStages(
    (file, args) => {
      const result = run(file, args, { timeout: 20 * 60 * 1000 });
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      if (file.endsWith('/solc') && result.status === 0 && !result.stdout.includes(lock.solc.longVersion))
        return { status: 2, error: new Error('Compiler version mismatch') };
      return result;
    },
    resolve(root, '.checks/af-chain01/evidence/slither.json'),
  );
  assertUnchanged(before, inspect());
  emit({
    gate: 'contracts-m3-macos',
    ...before,
    contractLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
    python: JSON.parse(probe.stdout),
    ...report,
    boundary: 'local tests only; no deployment, RPC or wallet operation',
  });
});

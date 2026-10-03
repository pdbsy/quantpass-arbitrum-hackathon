import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sourceIdentity, summarizeTap, acceptanceState, fileRecords, digest } from './evidence.mjs';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write(
    'node tools/testing/alphaforge-release-mock/run.mjs [--expected-source=40hex] [--diagnostic] [--api-only]\nFull acceptance runs build, API, actual HTTP lifecycle and browser separately. API-only is NOT_RUN_BROWSER. Dirty diagnostic can never PASS. Pinned Playwright must already be installed and qualified.\n',
  );
} else {
  if (
    args.some(
      (a) => !['--diagnostic', '--api-only'].includes(a) && !/^--expected-source=[a-f0-9]{40}$/.test(a),
    )
  )
    throw new Error('RELEASE_MOCK_ARGUMENT');
  const root = resolve('.'),
    sourceC = sourceIdentity(root),
    expected = args.find((a) => a.startsWith('--expected-source='))?.slice(18);
  if (
    process.versions.node !== '24.21.0' ||
    sourceC.npm !== '11.19.1' ||
    !sourceC.fullHistory ||
    (expected && expected !== sourceC.head) ||
    (sourceC.dirty && !args.includes('--diagnostic'))
  )
    throw new Error('RELEASE_MOCK_SOURCE_ADMISSION');
  const evidenceRoot = join(root, '.checks/release-mock');
  mkdirSync(evidenceRoot, { recursive: true });
  const beforeSessions = new Set(readdirSync(evidenceRoot));
  const directory = mkdtempSync(join(evidenceRoot, 'acceptance-'));
  const save = (name, value) =>
    writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  save('source-C.json', sourceC);
  const phases = [];
  function run(name, command, arguments_, tap = false) {
    const result = spawnSync(command, arguments_, {
      cwd: root,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const output =
      (result.stdout ?? '') +
      (result.stderr ?? '') +
      (result.error ? '\n' + result.error.message + '\n' : '');
    const log = name + '.log';
    writeFileSync(join(directory, log), output, { flag: 'wx' });
    const totals = tap ? summarizeTap(output, result.status) : null;
    const phase = {
      name,
      command: [command, ...arguments_],
      exitCode: result.status,
      signal: result.signal,
      log,
      logSha256: digest(output),
      eligible: result.status === 0 && (!tap || totals.eligible),
      ...(totals ? { totals } : {}),
    };
    phases.push(phase);
    process.stdout.write(JSON.stringify({ phase: name, exitCode: phase.exitCode, totals }) + '\n');
  }
  const browserRun = !args.includes('--api-only');
  const apiFiles = [
    'test/release-mock-api.test.mjs',
    'test/release-mock-recovery.test.mjs',
    'test/release-mock-evidence.test.mjs',
  ];
  run('api-recovery', process.execPath, ['--test', '--test-reporter=tap', ...apiFiles], true);
  run(
    'http-process',
    process.execPath,
    ['--test', '--test-reporter=tap', 'test/release-mock-process.test.mjs'],
    true,
  );
  if (browserRun) {
    run('web-build', 'npm', ['run', 'build:web']);
    run(
      'browser',
      process.execPath,
      ['--test', '--test-reporter=tap', 'test/release-mock-browser.test.mjs'],
      true,
    );
  }
  const sourceAfter = sourceIdentity(root),
    sourceUnchanged = JSON.stringify(sourceAfter) === JSON.stringify(sourceC);
  const sessions = readdirSync(evidenceRoot)
    .filter((n) => !beforeSessions.has(n) && n.startsWith('session-'))
    .map((n) => ({ directory: n, files: fileRecords(join(evidenceRoot, n)) }));
  const manifestR = {
    schemaVersion: 1,
    mode: 'MOCK',
    observedAt: new Date().toISOString(),
    sourceC,
    sourceAfter,
    sourceUnchanged,
    phases,
    fixtureFiles: fileRecords(join(root, 'test/fixtures/release-mock')),
    browserDescriptorSha256: digest(readFileSync(join(root, 'planning/coverage-toolchain.lock.json'))),
    sessions,
    boundaries: {
      realSigner: false,
      broadcastTransport: false,
      realSharedD1: false,
      externalWalletChain: 'NOT_RUN',
      sustained24h: 'WAIVED_BY_USER',
    },
  };
  save('manifest-R.json', manifestR);
  const snapshotS = {
    schemaVersion: 1,
    state: acceptanceState({ sourceEligible: !sourceC.dirty, sourceUnchanged, browserRun, phases }),
    sourceCommit: sourceC.head,
    sourceTree: sourceC.tree,
    manifestSha256: digest(readFileSync(join(directory, 'manifest-R.json'))),
    overlappingHistoricalCountsAdded: false,
    countsRemainSeparate: true,
    boundaries: manifestR.boundaries,
  };
  save('snapshot-S.json', snapshotS);
  save('files.json', fileRecords(directory));
  process.stdout.write(JSON.stringify({ directory, ...snapshotS }, null, 2) + '\n');
  process.exitCode = snapshotS.state === 'PASS' ? 0 : 1;
}

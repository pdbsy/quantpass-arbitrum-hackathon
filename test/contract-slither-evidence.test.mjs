import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runContractStages } from '../tools/ci/verify-contracts.mjs';

const cleanReport = '{"success":true,"error":null,"results":{}}\n';

function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-slither-evidence-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'slither.json');
}

// Explicit stage-executor fault injection: these tests never invoke Slither or
// bootstrap. Real temporary JSON files exercise the gate's evidence boundary.
function stagesWriting(path, contents) {
  return (_file, args) => {
    if (args[0] === 'contracts/script/check-phase1-contracts.sh' && contents !== undefined)
      writeFileSync(path, contents);
    return { status: 0, signal: null };
  };
}

for (const [name, contents, state] of [
  ['missing report', undefined, 'BLOCKED'],
  ['invalid JSON', '{', 'BLOCKED'],
  ['null envelope', 'null', 'BLOCKED'],
  ['array envelope', '[]', 'BLOCKED'],
  ['missing success', '{"error":null,"results":{}}', 'BLOCKED'],
  ['nonboolean success', '{"success":"true","error":null,"results":{}}', 'BLOCKED'],
  ['missing error', '{"success":true,"results":{}}', 'BLOCKED'],
  ['invalid error type', '{"success":true,"error":false,"results":{}}', 'BLOCKED'],
  ['missing results', '{"success":true,"error":null}', 'BLOCKED'],
  ['null results', '{"success":true,"error":null,"results":null}', 'BLOCKED'],
  ['array results', '{"success":true,"error":null,"results":[]}', 'BLOCKED'],
  ['null detectors', '{"success":true,"error":null,"results":{"detectors":null}}', 'BLOCKED'],
  ['object detectors', '{"success":true,"error":null,"results":{"detectors":{}}}', 'BLOCKED'],
  ['analysis error', '{"success":false,"error":"analysis failed","results":{}}', 'FAIL'],
  ['false success without error text', '{"success":false,"error":null,"results":{}}', 'FAIL'],
  ['non-null error despite success', '{"success":true,"error":"failed","results":{}}', 'FAIL'],
  ['findings', '{"success":true,"error":null,"results":{"detectors":[{"check":"fixture"}]}}', 'FAIL'],
  ['empty output', '', 'BLOCKED'],
  ['invalid UTF-8', Buffer.from([0xff, 0x7b, 0x7d]), 'BLOCKED'],
]) {
  test(`contract gate rejects ${name} despite three successful stage exits`, (t) => {
    const path = fixture(t);
    const report = runContractStages(stagesWriting(path, contents), path);
    assert.equal(report.state, state);
    assert.equal(report.stages.length, 3);
    assert.ok(report.stages.every((stage) => stage.state === 'PASS' && stage.exitCode === 0));
  });
}

test('contract gate cannot reuse an existing clean report when this stage writes none', (t) => {
  const path = fixture(t);
  writeFileSync(path, cleanReport);
  const report = runContractStages(stagesWriting(path), path);
  assert.equal(report.state, 'BLOCKED');
  assert.equal(report.stages.length, 3);
  const backups = readdirSync(dirname(path)).filter((name) => name.startsWith('.slither-previous-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dirname(path), backups[0], 'slither.json'), 'utf8'), cleanReport);
});

for (const [name, contents] of [
  ['omitted detectors from Slither 0.11.3', cleanReport],
  ['explicit empty detectors', '{"success":true,"error":null,"results":{"detectors":[]}}\n'],
]) {
  test(`contract gate binds exact fresh bytes with ${name}`, (t) => {
    const path = fixture(t);
    const report = runContractStages(stagesWriting(path, contents), path);
    assert.equal(report.state, 'PASS');
    assert.equal(report.abi, 'PASS');
    assert.deepEqual(report.slither, {
      bytes: Buffer.byteLength(contents),
      sha256: createHash('sha256').update(contents).digest('hex'),
      state: 'PASS',
      success: true,
      findings: 0,
      errorPresent: false,
      previousReportPreserved: false,
    });
  });
}

test('contract gate preserves old report bytes and hashes only the newly produced report', (t) => {
  const path = fixture(t);
  const old = '{"success":false,"error":"old failure","results":{}}\n';
  writeFileSync(path, old);
  const report = runContractStages(stagesWriting(path, cleanReport), path);
  assert.equal(report.state, 'PASS');
  assert.equal(report.slither.previousReportPreserved, true);
  assert.equal(report.slither.sha256, createHash('sha256').update(cleanReport).digest('hex'));
  const backups = readdirSync(dirname(path)).filter((name) => name.startsWith('.slither-previous-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dirname(path), backups[0], 'slither.json'), 'utf8'), old);
  assert.equal(readFileSync(path, 'utf8'), cleanReport);
});

for (const failAt of [0, 1]) {
  test(`failure at stage ${failAt + 1} leaves the old report untouched`, (t) => {
    const path = fixture(t);
    writeFileSync(path, cleanReport);
    let calls = 0;
    const report = runContractStages(() => ({ status: calls++ === failAt ? 1 : 0 }), path);
    assert.equal(report.state, 'BLOCKED');
    assert.equal(report.slither.state, 'NOT_RUN');
    assert.equal(calls, failAt + 1);
    assert.deepEqual(readdirSync(dirname(path)), ['slither.json']);
    assert.equal(readFileSync(path, 'utf8'), cleanReport);
  });
}

for (const result of [{ status: 1 }, { status: null, signal: 'SIGTERM' }]) {
  test(`third-stage ${result.signal ?? 'failure'} cannot be repaired by a clean JSON`, (t) => {
    const path = fixture(t);
    const execute = stagesWriting(path, cleanReport);
    const report = runContractStages((file, args) => {
      const success = execute(file, args);
      return args[0] === 'contracts/script/check-phase1-contracts.sh' ? result : success;
    }, path);
    assert.equal(report.state, result.status === 1 ? 'FAIL' : 'BLOCKED');
    assert.equal(report.abi, 'UNCONFIRMED');
    assert.equal(report.slither.state, 'UNCONFIRMED');
    assert.equal(report.slither.sha256, undefined);
    assert.equal(readFileSync(path, 'utf8'), cleanReport);
    assert.equal(report.stages[2].exitCode, result.status);
  });
}

test('contract gate rejects an oversized newly produced report without reading it unbounded', (t) => {
  const path = fixture(t);
  const execute = stagesWriting(path, cleanReport);
  const report = runContractStages((file, args) => {
    const result = execute(file, args);
    if (args[0] === 'contracts/script/check-phase1-contracts.sh') truncateSync(path, 16 * 1024 * 1024 + 1);
    return result;
  }, path);
  assert.equal(report.state, 'BLOCKED');
  assert.equal(report.slither.sha256, undefined);
});

for (const kind of ['directory', 'hardlink', 'symlink', 'fifo']) {
  const posixOnly = kind === 'symlink' || kind === 'fifo';
  for (const when of ['before', 'after']) {
    test(
      `contract gate rejects a ${kind} report ${when} the third stage`,
      { skip: posixOnly && process.platform === 'win32' },
      (t) => {
        const path = fixture(t);
        const target = join(dirname(path), 'target.json');
        writeFileSync(target, cleanReport);
        const create = () => {
          if (kind === 'directory') mkdirSync(path);
          else if (kind === 'hardlink') linkSync(target, path);
          else if (kind === 'symlink') symlinkSync(target, path);
          else execFileSync('mkfifo', [path]);
        };
        if (when === 'before') create();
        let calls = 0;
        const report = runContractStages((_file, args) => {
          calls++;
          if (when === 'after' && args[0] === 'contracts/script/check-phase1-contracts.sh') create();
          return { status: 0 };
        }, path);
        assert.equal(report.state, 'BLOCKED');
        assert.equal(calls, when === 'before' ? 2 : 3);
        assert.equal(readFileSync(target, 'utf8'), cleanReport);
      },
    );
  }
}

test(
  'contract gate rejects a symlinked report parent before the third stage',
  { skip: process.platform === 'win32' },
  (t) => {
    const path = fixture(t);
    const target = join(dirname(path), 'outside');
    const link = join(dirname(path), 'linked');
    mkdirSync(target);
    symlinkSync(target, link, 'dir');
    let calls = 0;
    const report = runContractStages(() => ({ status: (calls++, 0) }), join(link, 'slither.json'));
    assert.equal(report.state, 'BLOCKED');
    assert.equal(calls, 2);
    assert.deepEqual(readdirSync(target), []);
  },
);

test(
  'contract gate does not execute the third stage if preserving the old report fails',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  (t) => {
    const path = fixture(t);
    writeFileSync(path, cleanReport);
    chmodSync(dirname(path), 0o500);
    let calls = 0;
    try {
      const report = runContractStages(() => ({ status: (calls++, 0) }), path);
      assert.equal(report.state, 'BLOCKED');
      assert.equal(calls, 2);
      assert.equal(readFileSync(path, 'utf8'), cleanReport);
    } finally {
      chmodSync(dirname(path), 0o700);
    }
  },
);

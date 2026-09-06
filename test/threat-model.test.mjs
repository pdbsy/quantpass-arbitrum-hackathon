import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateSecurityBoundary } from '../tools/check-governance-v2.mjs';
import {
  loadThreatArtifacts,
  renderThreatModel,
  validateThreatModel,
  validateThreatRoadmapAlignment,
} from '../tools/check-threat-model.mjs';

const [register, boundary, roadmap] = await Promise.all([
  readFile(new URL('../planning/risk-register.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../planning/security-boundary.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../planning/roadmap.json', import.meta.url), 'utf8').then(JSON.parse),
]);
validateSecurityBoundary(boundary);

test('threat model covers every asset, actor, entry point, boundary and required scenario class', async () => {
  assert.equal(validateThreatModel(register, boundary, roadmap), register);
  assert.equal(validateThreatRoadmapAlignment(register, roadmap), roadmap);
  const artifacts = await loadThreatArtifacts();
  assert.equal(artifacts.document, renderThreatModel(register));
  assert.equal(new Set(register.risks.map((risk) => risk.scenarioClass)).size, 12);
  assert.ok(register.risks.length >= 20);
});

test('every open Critical/High risk has an accountable owner, gate, tasks and verification', () => {
  for (const risk of register.risks.filter((item) => ['critical', 'high'].includes(item.severity))) {
    assert.match(risk.owner, /^[a-z][a-z-]+$/);
    assert.match(risk.targetGate, /^G[1-4]$/);
    assert.ok(risk.mitigationTasks.length > 0);
    assert.ok(risk.verification.length > 10);
    assert.ok(risk.residualRisk.length > 10);
  }
});

test('threat model rejects missing coverage and broken references', () => {
  const mutations = [
    [
      'missing class',
      (item) =>
        (item.requiredScenarioClasses = item.requiredScenarioClasses.filter(
          (value) => value !== 'reentrancy',
        )),
    ],
    ['unknown task', (item) => (item.risks[0].mitigationTasks = ['MISSING-001'])],
    ['unknown asset', (item) => (item.risks[0].assets = ['AST-99'])],
    ['unknown actor', (item) => (item.risks[0].actors = ['ACT-99'])],
    ['unknown boundary', (item) => (item.risks[0].boundaries = ['TB-99'])],
    ['unknown entry', (item) => (item.risks[0].entryPoints = ['EP-99'])],
    ['missing owner', (item) => (item.risks[0].owner = '')],
    ['missing verification', (item) => (item.risks[0].verification = '')],
    ['self mitigation', (item) => item.risks[0].mitigationTasks.push('THREAT-001')],
  ];
  for (const [name, mutate] of mutations) {
    const candidate = structuredClone(register);
    mutate(candidate);
    assert.throws(
      () => validateThreatModel(candidate, boundary, roadmap),
      /Invalid threat model/,
      `${name} must fail`,
    );
  }
});

test('Critical risk acceptance is forbidden and High acceptance cannot be self-approved', () => {
  const critical = structuredClone(register);
  critical.risks.find((risk) => risk.severity === 'critical').status = 'accepted';
  critical.risks.find((risk) => risk.severity === 'critical').acceptance = {
    approvedBy: 'release-owner',
    independentReviewer: 'security-reviewer',
    reason: 'not acceptable',
    compensatingControls: ['none'],
    expiresAt: '2026-09-07',
  };
  assert.throws(() => validateThreatModel(critical, boundary, roadmap), /Critical risk cannot be accepted/);

  const high = structuredClone(register);
  const risk = high.risks.find((item) => item.severity === 'high');
  risk.status = 'accepted';
  risk.acceptance = {
    approvedBy: risk.owner,
    independentReviewer: 'security-reviewer',
    reason: 'temporary testnet exception',
    compensatingControls: ['writes-disabled-by-default'],
    expiresAt: '2026-09-07',
  };
  assert.throws(() => validateThreatModel(high, boundary, roadmap), /owner cannot self-accept risk/);
});

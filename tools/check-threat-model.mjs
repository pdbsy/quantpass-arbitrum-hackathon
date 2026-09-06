import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSecurityBoundary } from './check-governance-v2.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const riskPath = resolve(root, 'planning/risk-register.json');
const boundaryPath = resolve(root, 'planning/security-boundary.json');
const roadmapPath = resolve(root, 'planning/roadmap.json');
const documentPath = resolve(root, 'docs/THREAT-MODEL.md');

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid threat model: ${message}`);
}

function requireString(value, field) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, `${field} must be a string`);
}

function requireStringArray(value, field, minimum = 1) {
  requireCondition(
    Array.isArray(value) && value.length >= minimum,
    `${field} must contain ${minimum}+ items`,
  );
  value.forEach((item, index) => requireString(item, `${field}[${index}]`));
  requireCondition(new Set(value).size === value.length, `${field} must not contain duplicates`);
}

function requireExactKeys(value, required, optional, field) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value), `${field} must be an object`);
  const keys = Object.keys(value);
  for (const key of required) requireCondition(keys.includes(key), `${field}.${key} is required`);
  requireCondition(
    keys.every((key) => required.includes(key) || optional.includes(key)),
    `${field} contains unknown keys`,
  );
}

function indexById(items, field, pattern) {
  requireCondition(Array.isArray(items) && items.length > 0, `${field} must not be empty`);
  const result = new Map();
  for (const [index, item] of items.entries()) {
    requireString(item.id, `${field}[${index}].id`);
    requireCondition(pattern.test(item.id), `${item.id} has an invalid ${field} ID`);
    requireCondition(!result.has(item.id), `duplicate ${field} ID ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function requireReferences(values, index, field) {
  requireStringArray(values, field);
  for (const value of values) requireCondition(index.has(value), `${field} references unknown ${value}`);
}

export function validateThreatModel(register, boundary, roadmap) {
  requireExactKeys(
    register,
    [
      'schemaVersion',
      'modelVersion',
      'updatedAt',
      'scope',
      'assumptions',
      'securityObjectives',
      'assets',
      'actors',
      'entryPoints',
      'requiredScenarioClasses',
      'risks',
      'riskAcceptancePolicy',
    ],
    [],
    'root',
  );
  requireCondition(register.schemaVersion === 1, 'schemaVersion must be 1');
  requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(register.updatedAt), 'updatedAt must be YYYY-MM-DD');
  requireCondition(/^\d+\.\d+$/.test(register.modelVersion), 'modelVersion must be major.minor');

  requireExactKeys(
    register.scope,
    ['system', 'chainId', 'environments', 'excluded', 'architectureDecision'],
    [],
    'scope',
  );
  requireCondition(register.scope.chainId === boundary.environment.chainId, 'scope Chain ID must match ADR');
  requireCondition(
    register.scope.architectureDecision === 'docs/adr/0001-testnet-mvp-scope-and-authority.md',
    'architecture decision path changed',
  );
  requireCondition(
    register.scope.environments.includes('robinhood-chain-testnet'),
    'testnet environment missing',
  );
  for (const exclusion of ['mainnet', 'real-value-assets', 'production-autonomous-trading']) {
    requireCondition(register.scope.excluded.includes(exclusion), `scope must exclude ${exclusion}`);
  }

  const assumptions = indexById(register.assumptions, 'assumptions', /^ASM-\d{2}$/);
  requireCondition(assumptions.size >= 5, 'at least five explicit assumptions are required');
  for (const item of assumptions.values()) {
    requireExactKeys(item, ['id', 'statement', 'failurePolicy'], [], item.id);
    requireString(item.statement, `${item.id}.statement`);
    requireString(item.failurePolicy, `${item.id}.failurePolicy`);
  }

  const objectives = indexById(register.securityObjectives, 'securityObjectives', /^OBJ-\d{2}$/);
  requireCondition(objectives.size >= 6, 'security objectives are incomplete');
  for (const item of objectives.values()) {
    requireExactKeys(item, ['id', 'name', 'statement'], [], item.id);
    requireString(item.name, `${item.id}.name`);
    requireString(item.statement, `${item.id}.statement`);
  }

  const assets = indexById(register.assets, 'assets', /^AST-\d{2}$/);
  requireCondition(assets.size >= 8, 'asset inventory is incomplete');
  for (const item of assets.values()) {
    requireExactKeys(item, ['id', 'name', 'objective', 'worstImpact'], [], item.id);
    requireString(item.name, `${item.id}.name`);
    requireCondition(objectives.has(item.objective), `${item.id} references unknown objective`);
    requireString(item.worstImpact, `${item.id}.worstImpact`);
  }

  const actors = indexById(register.actors, 'actors', /^ACT-\d{2}$/);
  requireCondition(actors.size >= 9, 'threat actor inventory is incomplete');
  for (const item of actors.values()) {
    requireExactKeys(item, ['id', 'name', 'capabilities', 'notTrustedFor'], [], item.id);
    requireString(item.name, `${item.id}.name`);
    requireStringArray(item.capabilities, `${item.id}.capabilities`);
    requireStringArray(item.notTrustedFor, `${item.id}.notTrustedFor`);
  }

  const boundaryIndex = new Map(boundary.trustBoundaries.map((item) => [item.id, item]));
  const entryPoints = indexById(register.entryPoints, 'entryPoints', /^EP-\d{2}$/);
  requireCondition(entryPoints.size >= 9, 'entry point inventory is incomplete');
  for (const item of entryPoints.values()) {
    requireExactKeys(item, ['id', 'name', 'boundary', 'inputs'], [], item.id);
    requireString(item.name, `${item.id}.name`);
    requireCondition(boundaryIndex.has(item.boundary), `${item.id} references unknown trust boundary`);
    requireStringArray(item.inputs, `${item.id}.inputs`);
  }

  const requiredClasses = [
    'authorization-bypass',
    'reentrancy',
    'replay',
    'malicious-token',
    'rpc-deception',
    'frontend-substitution',
    'key-compromise',
    'reorg-or-replacement',
    'supply-chain',
    'denial-of-exit',
    'accounting-corruption',
    'resource-exhaustion',
  ];
  requireStringArray(register.requiredScenarioClasses, 'requiredScenarioClasses', requiredClasses.length);
  for (const item of requiredClasses) {
    requireCondition(
      register.requiredScenarioClasses.includes(item),
      `required scenario class ${item} missing`,
    );
  }

  const tasks = new Map(roadmap.tasks.map((task) => [task.id, task]));
  const gates = new Map(roadmap.releaseGates.map((gate) => [gate.id, gate]));
  const risks = indexById(register.risks, 'risks', /^R-\d{3}$/);
  requireCondition(risks.size >= 20, 'at least 20 concrete abuse scenarios are required');
  const coveredClasses = new Set();
  const coveredAssets = new Set();
  const coveredActors = new Set();
  const coveredBoundaries = new Set();
  const coveredEntryPoints = new Set();
  for (const risk of risks.values()) {
    const requiredKeys = [
      'id',
      'title',
      'scenarioClass',
      'stride',
      'severity',
      'likelihood',
      'impact',
      'status',
      'owner',
      'targetGate',
      'assets',
      'actors',
      'boundaries',
      'entryPoints',
      'scenario',
      'mitigationTasks',
      'verification',
      'residualRisk',
    ];
    const optionalKeys =
      risk.status === 'mitigated'
        ? ['evidence', 'verifiedBy', 'verifiedAt']
        : risk.status === 'accepted'
          ? ['acceptance']
          : [];
    requireExactKeys(risk, requiredKeys, optionalKeys, risk.id);
    requireString(risk.title, `${risk.id}.title`);
    requireCondition(requiredClasses.includes(risk.scenarioClass), `${risk.id} has unknown scenario class`);
    coveredClasses.add(risk.scenarioClass);
    requireStringArray(risk.stride, `${risk.id}.stride`);
    requireCondition(
      risk.stride.every((value) => ['S', 'T', 'R', 'I', 'D', 'E'].includes(value)),
      `${risk.id} has invalid STRIDE code`,
    );
    requireCondition(
      ['critical', 'high', 'medium', 'low'].includes(risk.severity),
      `${risk.id} has invalid severity`,
    );
    requireCondition(
      ['likely', 'possible', 'unlikely'].includes(risk.likelihood),
      `${risk.id} has invalid likelihood`,
    );
    requireCondition(
      ['catastrophic', 'major', 'moderate', 'minor'].includes(risk.impact),
      `${risk.id} has invalid impact`,
    );
    requireCondition(
      ['open', 'mitigated', 'accepted'].includes(risk.status),
      `${risk.id} has invalid status`,
    );
    requireString(risk.owner, `${risk.id}.owner`);
    requireCondition(gates.has(risk.targetGate), `${risk.id} references unknown target gate`);
    requireReferences(risk.assets, assets, `${risk.id}.assets`);
    requireReferences(risk.actors, actors, `${risk.id}.actors`);
    requireReferences(risk.boundaries, boundaryIndex, `${risk.id}.boundaries`);
    requireReferences(risk.entryPoints, entryPoints, `${risk.id}.entryPoints`);
    risk.assets.forEach((id) => coveredAssets.add(id));
    risk.actors.forEach((id) => coveredActors.add(id));
    risk.boundaries.forEach((id) => coveredBoundaries.add(id));
    risk.entryPoints.forEach((id) => coveredEntryPoints.add(id));
    requireString(risk.scenario, `${risk.id}.scenario`);
    requireReferences(risk.mitigationTasks, tasks, `${risk.id}.mitigationTasks`);
    requireCondition(
      !risk.mitigationTasks.includes('THREAT-001'),
      `${risk.id} cannot self-mitigate via THREAT-001`,
    );
    requireString(risk.verification, `${risk.id}.verification`);
    requireString(risk.residualRisk, `${risk.id}.residualRisk`);
    if (risk.severity === 'critical') {
      requireCondition(risk.status !== 'accepted', `${risk.id} Critical risk cannot be accepted`);
    }
    if (risk.status === 'mitigated') {
      requireStringArray(risk.evidence, `${risk.id}.evidence`);
      requireString(risk.verifiedBy, `${risk.id}.verifiedBy`);
      requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(risk.verifiedAt), `${risk.id}.verifiedAt is invalid`);
    }
    if (risk.status === 'accepted') {
      requireCondition(risk.severity !== 'critical', `${risk.id} Critical risk cannot be accepted`);
      requireExactKeys(
        risk.acceptance,
        ['approvedBy', 'independentReviewer', 'reason', 'compensatingControls', 'expiresAt'],
        [],
        `${risk.id}.acceptance`,
      );
      requireString(risk.acceptance.approvedBy, `${risk.id}.acceptance.approvedBy`);
      requireString(risk.acceptance.independentReviewer, `${risk.id}.acceptance.independentReviewer`);
      requireCondition(risk.acceptance.approvedBy !== risk.owner, `${risk.id} owner cannot self-accept risk`);
      requireString(risk.acceptance.reason, `${risk.id}.acceptance.reason`);
      requireStringArray(risk.acceptance.compensatingControls, `${risk.id}.acceptance.compensatingControls`);
      requireCondition(
        /^\d{4}-\d{2}-\d{2}$/.test(risk.acceptance.expiresAt),
        `${risk.id}.acceptance.expiresAt is invalid`,
      );
    }
  }

  for (const item of requiredClasses) requireCondition(coveredClasses.has(item), `no risk covers ${item}`);
  for (const id of assets.keys()) requireCondition(coveredAssets.has(id), `asset ${id} has no risk scenario`);
  for (const id of actors.keys()) requireCondition(coveredActors.has(id), `actor ${id} has no risk scenario`);
  for (const id of boundaryIndex.keys())
    requireCondition(coveredBoundaries.has(id), `trust boundary ${id} has no risk scenario`);
  for (const id of entryPoints.keys())
    requireCondition(coveredEntryPoints.has(id), `entry point ${id} has no risk scenario`);

  requireStringArray(register.riskAcceptancePolicy, 'riskAcceptancePolicy', 5);
  const policyText = register.riskAcceptancePolicy.join(' ');
  requireCondition(
    policyText.includes('Critical') && policyText.includes('不得'),
    'policy must prohibit Critical acceptance',
  );
  requireCondition(policyText.includes('独立复核'), 'policy must require independent review');
  return register;
}

export function validateThreatRoadmapAlignment(register, roadmap) {
  const threat = roadmap.tasks.find((task) => task.id === 'THREAT-001');
  requireCondition(threat, 'roadmap must contain THREAT-001');
  if (threat.status === 'done') {
    for (const evidence of [
      'planning/risk-register.json',
      'docs/THREAT-MODEL.md',
      'docs/reviews/THREAT-001.md',
      'tools/check-threat-model.mjs',
      'test/threat-model.test.mjs',
    ]) {
      requireCondition(threat.evidence.includes(evidence), `THREAT-001 evidence missing ${evidence}`);
    }
  }
  const openSevere = register.risks.filter(
    (risk) => ['critical', 'high'].includes(risk.severity) && risk.status === 'open',
  );
  requireCondition(
    openSevere.length > 0,
    'prototype must not claim all severe risks are closed without evidence',
  );
  return roadmap;
}

function markdownList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function renderTable(headers, rows) {
  return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows
    .map((row) => `| ${row.map((value) => String(value).replaceAll('|', '\\|')).join(' | ')} |`)
    .join('\n')}`;
}

export function renderThreatModel(register) {
  const riskRows = register.risks.map((risk) => [
    `\`${risk.id}\``,
    risk.title,
    risk.severity === 'critical' ? 'Critical' : risk.severity === 'high' ? 'High' : risk.severity,
    risk.status,
    `\`${risk.owner}\``,
    `\`${risk.targetGate}\``,
    risk.mitigationTasks.map((id) => `\`${id}\``).join('<br>'),
  ]);
  const assets = renderTable(
    ['ID', '资产', '最坏影响'],
    register.assets.map((item) => [`\`${item.id}\``, item.name, item.worstImpact]),
  );
  const actors = renderTable(
    ['ID', '攻击者/故障主体', '能力', '不可信任事项'],
    register.actors.map((item) => [
      `\`${item.id}\``,
      item.name,
      item.capabilities.join('；'),
      item.notTrustedFor.join('；'),
    ]),
  );
  const entries = renderTable(
    ['ID', '入口', '信任边界', '输入'],
    register.entryPoints.map((item) => [
      `\`${item.id}\``,
      item.name,
      `\`${item.boundary}\``,
      item.inputs.map((value) => `\`${value}\``).join('<br>'),
    ]),
  );
  const details = register.risks
    .map(
      (risk) =>
        `### ${risk.id} · ${risk.title}\n\n- 分类：\`${risk.scenarioClass}\` · STRIDE ${risk.stride.join('/')} · ${risk.severity.toUpperCase()} · ${risk.status}\n- 负责人：\`${risk.owner}\`；截止门禁：\`${risk.targetGate}\`\n- 场景：${risk.scenario}\n- 缓解任务：${risk.mitigationTasks.map((id) => `\`${id}\``).join('、')}\n- 验证：${risk.verification}\n- 残余风险：${risk.residualRisk}`,
    )
    .join('\n\n');
  return `# QuantPass 威胁模型与风险登记\n\n> 自动生成文件：唯一事实源为 \`planning/risk-register.json\`。完成本模型不表示风险已修复。\n\n- 模型版本：${register.modelVersion}\n- 日期：${register.updatedAt}\n- 目标网络：Robinhood Chain Testnet · Chain ID \`${register.scope.chainId}\`\n- 风险数：${register.risks.length}\n- Open Critical：${register.risks.filter((risk) => risk.severity === 'critical' && risk.status === 'open').length}\n- Open High：${register.risks.filter((risk) => risk.severity === 'high' && risk.status === 'open').length}\n\n## 强制假设\n\n${register.assumptions.map((item) => `- **${item.id}** ${item.statement} 失败策略：${item.failurePolicy}`).join('\n')}\n\n## 安全目标\n\n${register.securityObjectives.map((item) => `- **${item.id} · ${item.name}**：${item.statement}`).join('\n')}\n\n## 资产\n\n${assets}\n\n## 攻击者与故障主体\n\n${actors}\n\n## 入口与信任边界\n\n${entries}\n\n## 风险总览\n\n${renderTable(['ID', '风险', '等级', '状态', '负责人', '截止', '缓解任务'], riskRows)}\n\n## 风险详情\n\n${details}\n\n## 风险接受规则\n\n${markdownList(register.riskAcceptancePolicy)}\n`;
}

export async function loadThreatArtifacts() {
  const [riskText, boundaryText, roadmapText, document] = await Promise.all([
    readFile(riskPath, 'utf8'),
    readFile(boundaryPath, 'utf8'),
    readFile(roadmapPath, 'utf8'),
    readFile(documentPath, 'utf8').catch(() => ''),
  ]);
  const boundary = validateSecurityBoundary(JSON.parse(boundaryText));
  const roadmap = JSON.parse(roadmapText);
  const register = validateThreatModel(JSON.parse(riskText), boundary, roadmap);
  validateThreatRoadmapAlignment(register, roadmap);
  requireCondition(document === renderThreatModel(register), 'generated threat model is stale');
  return { register, boundary, roadmap, document };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [riskText, boundaryText, roadmapText] = await Promise.all([
      readFile(riskPath, 'utf8'),
      readFile(boundaryPath, 'utf8'),
      readFile(roadmapPath, 'utf8'),
    ]);
    const boundary = validateSecurityBoundary(JSON.parse(boundaryText));
    const roadmap = JSON.parse(roadmapText);
    const register = validateThreatModel(JSON.parse(riskText), boundary, roadmap);
    validateThreatRoadmapAlignment(register, roadmap);
    if (process.argv.includes('--write')) {
      await writeFile(documentPath, renderThreatModel(register), 'utf8');
      console.log('Threat model generated.');
    } else {
      const document = await readFile(documentPath, 'utf8');
      requireCondition(document === renderThreatModel(register), 'generated threat model is stale');
      console.log(
        JSON.stringify({
          modelVersion: register.modelVersion,
          risks: register.risks.length,
          openCritical: register.risks.filter(
            (risk) => risk.severity === 'critical' && risk.status === 'open',
          ).length,
          openHigh: register.risks.filter((risk) => risk.severity === 'high' && risk.status === 'open')
            .length,
          coveredScenarioClasses: new Set(register.risks.map((risk) => risk.scenarioClass)).size,
        }),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Threat-model validation failed');
    process.exitCode = 1;
  }
}

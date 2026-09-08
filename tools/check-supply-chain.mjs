import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = resolve(root, 'planning/supply-chain-policy.json');
const packagePath = resolve(root, 'package.json');
const lockfilePath = resolve(root, 'package-lock.json');
const codeownersPath = resolve(root, '.github/CODEOWNERS');
const dependabotPath = resolve(root, '.github/dependabot.yml');
const workflowsPath = resolve(root, '.github/workflows');
const sbomPath = resolve(root, 'docs/security/npm-sbom.spdx.json');

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid supply-chain state: ${message}`);
}

function requireString(value, field) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, `${field} must be a string`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function validateSupplyChainPolicy(policy) {
  requireCondition(policy?.schemaVersion === 1, 'policy.schemaVersion must be 1');
  requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(policy.updatedAt), 'policy.updatedAt must be YYYY-MM-DD');
  requireCondition(
    policy.repository === 'pdbsy/quantpass-arbitrum-hackathon',
    'policy.repository must identify this public competition repository',
  );
  requireCondition(policy.defaultBranch === 'master', 'policy.defaultBranch must be master');
  requireCondition(
    policy.dependencyPolicy?.registryOrigin === 'https://registry.npmjs.org',
    'npm registry origin must be the canonical HTTPS registry',
  );
  requireCondition(
    policy.dependencyPolicy?.requiredIntegrityAlgorithm === 'sha512',
    'dependency integrity must require sha512',
  );
  const licenses = policy.dependencyPolicy?.allowedLicenses;
  requireCondition(Array.isArray(licenses) && licenses.length > 0, 'allowedLicenses must not be empty');
  requireCondition(new Set(licenses).size === licenses.length, 'allowedLicenses contains duplicates');
  for (const severity of ['critical', 'high', 'moderate', 'low']) {
    const days = policy.dependencyPolicy?.vulnerabilitySlaDays?.[severity];
    requireCondition(Number.isInteger(days) && days > 0, `${severity} SLA must be a positive integer`);
  }
  requireCondition(
    policy.actionPolicy?.requireFullCommitSha === true,
    'Actions must be pinned to full commit SHAs',
  );
  requireCondition(
    policy.actionPolicy?.forbidPullRequestTarget === true,
    'pull_request_target must be forbidden',
  );
  requireCondition(
    policy.actionPolicy?.repositoryShaPinningRequired === true,
    'repository-level SHA pinning must be required',
  );
  requireCondition(
    Array.isArray(policy.actionPolicy?.allowedOwners) &&
      policy.actionPolicy.allowedOwners.length > 0 &&
      new Set(policy.actionPolicy.allowedOwners).size === policy.actionPolicy.allowedOwners.length,
    'actionPolicy.allowedOwners must be a non-empty unique list',
  );
  requireCondition(
    Array.isArray(policy.actionPolicy?.allowedActions) &&
      policy.actionPolicy.allowedActions.length > 0 &&
      new Set(policy.actionPolicy.allowedActions).size === policy.actionPolicy.allowedActions.length,
    'actionPolicy.allowedActions must be a non-empty unique list',
  );
  requireCondition(
    policy.externalGovernanceGate?.required === true,
    'the external governance gate must remain mandatory',
  );
  requireCondition(
    ['blocked', 'verified'].includes(policy.externalGovernanceGate?.status),
    'external governance gate status must be blocked or verified',
  );
  if (policy.externalGovernanceGate.status === 'blocked') {
    requireString(policy.externalGovernanceGate.blockedReason, 'externalGovernanceGate.blockedReason');
    requireCondition(
      policy.externalGovernanceGate.evidence?.length === 0,
      'a blocked external gate cannot claim evidence',
    );
  } else {
    requireCondition(
      Array.isArray(policy.externalGovernanceGate.evidence) &&
        policy.externalGovernanceGate.evidence.length >= 2,
      'a verified external gate requires provider and enforcement evidence',
    );
  }
  requireCondition(policy.sbom?.format === 'SPDX-2.3', 'SBOM format must be SPDX-2.3');
  requireCondition(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(policy.sbom?.createdAt),
    'SBOM createdAt must be a stable UTC instant',
  );
  requireCondition(
    policy.sbom?.documentNamespaceBase === 'https://github.com/pdbsy/quantpass-arbitrum-hackathon/sbom',
    'SBOM namespace must belong to this repository',
  );
  return policy;
}

function packageNameFromPath(path) {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  requireCondition(index >= 0, `unexpected package-lock path ${path}`);
  return path.slice(index + marker.length);
}

function packageId(path, version) {
  const suffix = createHash('sha256').update(`${path}\0${version}`).digest('hex').slice(0, 20);
  return `SPDXRef-Package-${suffix}`;
}

function integrityChecksum(integrity, algorithm) {
  const prefix = `${algorithm}-`;
  requireCondition(integrity.startsWith(prefix), `integrity must use ${algorithm}`);
  const encoded = integrity.slice(prefix.length);
  const decoded = Buffer.from(encoded, 'base64');
  requireCondition(decoded.length === 64, `${algorithm} integrity must decode to 64 bytes`);
  requireCondition(decoded.toString('base64') === encoded, 'integrity must use canonical base64');
  return decoded.toString('hex').toUpperCase();
}

function exactRootVersions(rootPackage) {
  return Object.entries({
    ...(rootPackage.dependencies ?? {}),
    ...(rootPackage.devDependencies ?? {}),
    ...(rootPackage.optionalDependencies ?? {}),
  });
}

export function validatePackageLock(lockfile, packageJson, policy) {
  validateSupplyChainPolicy(policy);
  requireCondition(lockfile?.lockfileVersion === 3, 'package-lock.json must use lockfileVersion 3');
  requireCondition(lockfile.requires === true, 'package-lock.json must declare requires=true');
  requireCondition(lockfile.packages && typeof lockfile.packages === 'object', 'lockfile packages missing');
  const rootPackage = lockfile.packages[''];
  requireCondition(rootPackage?.name === packageJson.name, 'lockfile root name differs from package.json');
  requireCondition(
    rootPackage?.version === packageJson.version,
    'lockfile root version differs from package.json',
  );
  requireCondition(
    canonicalJson(rootPackage.dependencies ?? {}) === canonicalJson(packageJson.dependencies ?? {}),
    'runtime dependencies differ between package.json and lockfile',
  );
  requireCondition(
    canonicalJson(rootPackage.devDependencies ?? {}) === canonicalJson(packageJson.devDependencies ?? {}),
    'development dependencies differ between package.json and lockfile',
  );
  for (const [name, version] of exactRootVersions(rootPackage)) {
    requireCondition(
      /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version),
      `root dependency ${name} must use an exact semantic version`,
    );
  }

  const allowedLicenses = new Set(policy.dependencyPolicy.allowedLicenses);
  const registry = new URL(policy.dependencyPolicy.registryOrigin);
  const packages = [];
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '') continue;
    requireCondition(entry && typeof entry === 'object' && entry.link !== true, `${path} must not be a link`);
    requireString(entry.version, `${path}.version`);
    requireString(entry.resolved, `${path}.resolved`);
    const resolved = new URL(entry.resolved);
    requireCondition(
      resolved.protocol === 'https:' &&
        resolved.origin === registry.origin &&
        resolved.username === '' &&
        resolved.password === '' &&
        resolved.search === '' &&
        resolved.hash === '',
      `${path} must resolve from the approved HTTPS npm registry without credentials or query data`,
    );
    requireString(entry.integrity, `${path}.integrity`);
    integrityChecksum(entry.integrity, policy.dependencyPolicy.requiredIntegrityAlgorithm);
    requireCondition(allowedLicenses.has(entry.license), `${path} uses disallowed license ${entry.license}`);
    packages.push({ path, name: packageNameFromPath(path), entry });
  }
  requireCondition(packages.length > 0, 'lockfile must contain resolved packages');
  return packages.sort((left, right) => left.path.localeCompare(right.path));
}

function resolveLockedDependency(packagesByPath, sourcePath, dependency) {
  let cursor = sourcePath;
  while (true) {
    const candidate = cursor ? `${cursor}/node_modules/${dependency}` : `node_modules/${dependency}`;
    if (packagesByPath.has(candidate)) return candidate;
    if (cursor === '') return null;
    const separator = cursor.lastIndexOf('/node_modules/');
    cursor = separator < 0 ? '' : cursor.slice(0, separator);
  }
}

export function renderNpmSbom(lockfile, packageJson, policy) {
  const lockedPackages = validatePackageLock(lockfile, packageJson, policy);
  const packagesByPath = new Map(lockedPackages.map((item) => [item.path, item]));
  const lockDigest = createHash('sha256').update(canonicalJson({ lockfile, policy })).digest('hex');
  const rootId = 'SPDXRef-RootPackage';
  const packages = [
    {
      SPDXID: rootId,
      name: packageJson.name,
      versionInfo: packageJson.version,
      downloadLocation: `git+https://github.com/${policy.repository}.git`,
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
      primaryPackagePurpose: 'APPLICATION',
    },
    ...lockedPackages.map(({ path, name, entry }) => ({
      SPDXID: packageId(path, entry.version),
      name,
      versionInfo: entry.version,
      downloadLocation: entry.resolved,
      filesAnalyzed: false,
      checksums: [
        {
          algorithm: 'SHA512',
          checksumValue: integrityChecksum(
            entry.integrity,
            policy.dependencyPolicy.requiredIntegrityAlgorithm,
          ),
        },
      ],
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: entry.license,
      copyrightText: 'NOASSERTION',
      primaryPackagePurpose: 'LIBRARY',
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(entry.version)}`,
        },
      ],
    })),
  ];

  const relationships = [
    {
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: rootId,
    },
  ];
  const relationshipKeys = new Set();
  const sources = [
    { path: '', entry: lockfile.packages[''], id: rootId },
    ...lockedPackages.map(({ path, entry }) => ({ path, entry, id: packageId(path, entry.version) })),
  ];
  for (const source of sources) {
    const dependencies = new Set([
      ...Object.keys(source.entry.dependencies ?? {}),
      ...Object.keys(source.entry.optionalDependencies ?? {}),
    ]);
    if (source.path === '') {
      for (const dependency of Object.keys(source.entry.devDependencies ?? {})) dependencies.add(dependency);
    }
    for (const dependency of [...dependencies].sort()) {
      const targetPath = resolveLockedDependency(packagesByPath, source.path, dependency);
      requireCondition(targetPath, `${source.path || 'root'} dependency ${dependency} is unresolved`);
      const target = packagesByPath.get(targetPath);
      const relationship = {
        spdxElementId: source.id,
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: packageId(targetPath, target.entry.version),
      };
      const key = canonicalJson(relationship);
      if (!relationshipKeys.has(key)) {
        relationshipKeys.add(key);
        relationships.push(relationship);
      }
    }
  }

  return `${JSON.stringify(
    {
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      SPDXID: 'SPDXRef-DOCUMENT',
      name: `${packageJson.name}-${packageJson.version}-npm-lock`,
      documentNamespace: `${policy.sbom.documentNamespaceBase}/${lockDigest}`,
      creationInfo: {
        created: policy.sbom.createdAt,
        creators: ['Tool: quantpass-lockfile-sbom/1.0'],
      },
      packages,
      relationships,
    },
    null,
    2,
  )}\n`;
}

export function validateWorkflowText(path, text, policy) {
  requireCondition(!/^\s*pull_request_target\s*:/m.test(text), `${path} uses pull_request_target`);
  requireCondition(/^permissions:\s*$/m.test(text), `${path} must declare top-level permissions`);
  const usesLines = text.match(/^\s*-?\s*uses:\s*[^\n#]+/gm) ?? [];
  for (const line of usesLines) {
    const match = /uses:\s*['"]?([^@'"\s]+)@([0-9a-f]{40})['"]?\s*$/.exec(line);
    requireCondition(match, `${path} contains an unpinned or malformed Action reference: ${line.trim()}`);
    const [, action, commit] = match;
    requireCondition(/^[0-9a-f]{40}$/.test(commit), `${path} Action reference must use a full SHA`);
    const owner = action.split('/')[0];
    requireCondition(
      policy.actionPolicy.allowedOwners.includes(owner),
      `${path} uses unapproved Action owner ${owner}`,
    );
    requireCondition(
      policy.actionPolicy.allowedActions.includes(action),
      `${path} uses unapproved Action ${action}`,
    );
  }
  const declaredUses = (text.match(/\buses:/g) ?? []).length;
  requireCondition(declaredUses === usesLines.length, `${path} contains an unrecognized uses declaration`);
}

function validateDependabot(text, policy) {
  requireCondition(/^version:\s*2\s*$/m.test(text), 'dependabot.yml must use version 2');
  for (const ecosystem of ['npm', 'github-actions']) {
    requireCondition(
      new RegExp(`package-ecosystem:\\s*["']?${ecosystem}["']?`).test(text),
      `dependabot.yml must update ${ecosystem}`,
    );
  }
  requireCondition(
    new RegExp(`target-branch:\\s*["']?${policy.defaultBranch}["']?`).test(text),
    'dependabot.yml must target the default branch',
  );
  requireCondition(!/interval:\s*["']?daily["']?/m.test(text), 'Dependabot must not create daily churn');
}

function validateCodeowners(text) {
  requireCondition(/^\*\s+@pdbsy\s*$/m.test(text), 'CODEOWNERS must cover the complete repository');
  for (const path of ['/planning/', '/tools/', '/test/', '/.github/']) {
    requireCondition(
      new RegExp(`^${path.replaceAll('/', '\\/')}\\s+@pdbsy\\s*$`, 'm').test(text),
      `CODEOWNERS must explicitly cover ${path}`,
    );
  }
}

export async function checkSupplyChain(options = {}) {
  const [policyText, packageText, lockfileText, codeowners, dependabot, workflowNames] = await Promise.all([
    readFile(policyPath, 'utf8'),
    readFile(packagePath, 'utf8'),
    readFile(lockfilePath, 'utf8'),
    readFile(codeownersPath, 'utf8'),
    readFile(dependabotPath, 'utf8'),
    readdir(workflowsPath),
  ]);
  const policy = validateSupplyChainPolicy(JSON.parse(policyText));
  const packageJson = JSON.parse(packageText);
  const lockfile = JSON.parse(lockfileText);
  const expectedSbom = renderNpmSbom(lockfile, packageJson, policy);
  validateCodeowners(codeowners);
  validateDependabot(dependabot, policy);
  const workflows = workflowNames.filter((name) => /\.ya?ml$/.test(name)).sort();
  requireCondition(workflows.length >= 3, 'CI, CodeQL and dependency-review workflows are required');
  for (const name of workflows) {
    const text = await readFile(resolve(workflowsPath, name), 'utf8');
    validateWorkflowText(`.github/workflows/${name}`, text, policy);
  }
  if (options.write) {
    await mkdir(dirname(sbomPath), { recursive: true });
    await writeFile(sbomPath, expectedSbom, 'utf8');
  } else {
    const currentSbom = await readFile(sbomPath, 'utf8');
    requireCondition(currentSbom === expectedSbom, 'committed SPDX SBOM is stale; run npm run supply:build');
  }
  return { packages: Object.keys(lockfile.packages).length - 1, workflows: workflows.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkSupplyChain({ write: process.argv.includes('--write') });
    console.log(
      `Supply-chain baseline passed: ${result.packages} locked packages, ${result.workflows} pinned workflows, SPDX SBOM synchronized.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const version = /^[0-9][A-Za-z0-9.!+_-]*$/;
const canonicalPython = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');
export function parsePythonLock(text) {
  const packages = [];
  const names = new Set();
  for (const line of text.split(/\r?\n/).map((s) => s.trim())) {
    if (!line || line.startsWith('#')) continue;
    const match =
      /^([A-Za-z0-9][A-Za-z0-9_.-]*)==([0-9][A-Za-z0-9.!+_-]*) --hash=sha256:([a-f0-9]{64})$/.exec(line);
    if (!match) throw new Error('Python inventory requires exact hash-locked binary packages');
    const name = canonicalPython(match[1]);
    if (names.has(name)) throw new Error('Duplicate Python package pin');
    names.add(name);
    packages.push({ ecosystem: 'PyPI', name, version: match[2] });
  }
  if (!packages.length) throw new Error('Empty Python inventory');
  return packages;
}

const packageIdentity = (packageValue) => {
  if (packageValue.commit) return `GIT:${packageValue.name}:${packageValue.commit}`;
  return `${packageValue.ecosystem}:${packageValue.ecosystem === 'PyPI' ? packageValue.name : packageValue.name}:${packageValue.version}`;
};

function parseNpmGraph(lock, source) {
  if (
    !lock ||
    lock.lockfileVersion !== 3 ||
    !lock.packages ||
    typeof lock.packages !== 'object' ||
    Array.isArray(lock.packages) ||
    typeof source !== 'string' ||
    !source.length
  )
    throw new Error('Missing exact npm dependency graph');
  const packages = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue;
    const name = entry?.name ?? path.split('node_modules/').at(-1);
    if (
      !path.includes('node_modules/') ||
      !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name) ||
      !version.test(entry?.version ?? '') ||
      entry.link
    )
      throw new Error('Unresolved npm inventory entry');
    packages.push({ ecosystem: 'npm', name, version: entry.version });
  }
  if (!packages.length) throw new Error('Empty npm graph');
  return packages;
}

function validateBrowserPackage(browserPackage) {
  if (
    !browserPackage ||
    browserPackage.source !== 'planning/coverage-toolchain.lock.json#browser.package' ||
    browserPackage.name !== 'playwright-core' ||
    browserPackage.version !== '1.62.1' ||
    browserPackage.url !== 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.62.1.tgz' ||
    !/^[a-f0-9]{64}$/.test(browserPackage.sha256)
  )
    throw new Error('Unresolved exact browser package');
  if (
    browserPackage.bytes !== undefined &&
    (!Number.isInteger(browserPackage.bytes) || browserPackage.bytes <= 0)
  )
    throw new Error('Invalid browser package bytes');
  return { ecosystem: 'npm', name: browserPackage.name, version: browserPackage.version };
}

export function buildInventory({
  npmLock,
  pythonLocks,
  contractLock,
  extraNpmLocks = undefined,
  browserPackage = undefined,
  requireCoverage = false,
}) {
  if (
    npmLock.lockfileVersion !== 3 ||
    !npmLock.packages ||
    !Array.isArray(pythonLocks) ||
    !pythonLocks.length
  )
    throw new Error('Missing resolved dependency graphs');
  const packages = [];
  const deduplicated = new Map();
  const packageSources = new Map();
  const sourceCounts = {};
  const add = (packageValue, source) => {
    const key = packageIdentity(packageValue);
    if (!deduplicated.has(key)) deduplicated.set(key, packageValue);
    const sources = packageSources.get(key) ?? new Set();
    sources.add(source);
    packageSources.set(key, sources);
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  };
  let npmEntries = 0;
  for (const packageValue of parseNpmGraph(npmLock, 'package-lock.json')) {
    add(packageValue, 'package-lock.json');
    npmEntries++;
  }
  let extraNpmEntries = 0;
  if (extraNpmLocks !== undefined) {
    if (!Array.isArray(extraNpmLocks) || !extraNpmLocks.length)
      throw new Error('Missing exact coverage npm graph');
    const seenSources = new Set();
    for (const graph of extraNpmLocks) {
      if (!graph || seenSources.has(graph.source)) throw new Error('Duplicate coverage npm graph source');
      seenSources.add(graph.source);
      for (const packageValue of parseNpmGraph(graph.lock, graph.source)) {
        if (packageValue.name === 'playwright-core' && packageValue.version !== '1.62.1')
          throw new Error('Non-exact browser package in coverage graph');
        add(packageValue, graph.source);
        extraNpmEntries++;
      }
    }
  }
  if (requireCoverage && (extraNpmLocks === undefined || browserPackage === undefined))
    throw new Error('Missing coverage inventory inputs');
  let browserEntries = 0;
  if (browserPackage !== undefined) {
    add(validateBrowserPackage(browserPackage), browserPackage.source);
    browserEntries = 1;
  }
  if (!npmEntries) throw new Error('Empty npm graph');
  let pythonEntries = 0;
  for (const text of pythonLocks) {
    const graph = parsePythonLock(text);
    pythonEntries += graph.length;
    for (const packageValue of graph) add(packageValue, 'python-lock');
  }
  if (
    !version.test(contractLock.openzeppelin?.version ?? '') ||
    !version.test(contractLock.foundry?.version ?? '') ||
    !/^[a-f0-9]{40}$/.test(contractLock.foundry?.commit ?? '') ||
    !version.test(contractLock.solc?.version ?? '')
  )
    throw new Error('Incomplete custom contract toolchain inventory');
  add(
    { ecosystem: 'npm', name: '@openzeppelin/contracts', version: contractLock.openzeppelin.version },
    'contracts/toolchain.lock.json',
  );
  add(
    { ecosystem: 'npm', name: '@foundry-rs/forge-darwin-arm64', version: contractLock.foundry.version },
    'contracts/toolchain.lock.json',
  );
  add(
    { name: 'https://github.com/foundry-rs/foundry', commit: contractLock.foundry.commit },
    'contracts/toolchain.lock.json',
  );
  packages.push(...deduplicated.values());
  return {
    packages: packages.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')),
    npmEntries,
    extraNpmEntries,
    browserEntries,
    pythonEntries,
    sourceCounts,
    packageSources: Object.fromEntries(
      [...packageSources.entries()].map(([key, sources]) => [key, [...sources].sort()]),
    ),
    unmapped: [
      {
        name: 'solc',
        version: contractLock.solc.version,
        reason: 'Native compiler is not an npm/PyPI package',
      },
      {
        name: 'scanner Go binaries and embedded libraries',
        reason: 'Release integrity verified; transitive binary advisory coverage not asserted',
      },
      {
        name: 'GitHub Actions and Node/Python runtimes',
        reason: 'Separate fixed runtime/action qualification, outside this package inventory',
      },
    ],
  };
}

export function scannerTargets(paths) {
  if (
    paths.some(
      (p) => p.startsWith('/') || p.split('/').some((s) => ['..', '.'].includes(s)) || p.includes('\\'),
    )
  )
    throw new Error('Source path escaped checkout');
  const targets = paths
    .filter(
      (path) =>
        /\.(?:js|mjs|cjs|jsx|ts|tsx|py)$/.test(path) &&
        !path
          .split('/')
          .some((p) => ['test', 'tests', 'node_modules', '.checks', 'dist', 'build'].includes(p)),
    )
    .sort();
  if (!targets.length || targets.length > 5000 || new Set(targets).size !== targets.length)
    throw new Error('Invalid Semgrep source coverage');
  return targets;
}

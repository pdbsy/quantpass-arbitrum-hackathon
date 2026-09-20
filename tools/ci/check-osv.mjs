import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, inspect, assertUnchanged, run, emit, main } from './context.mjs';
import { installScanner } from '../security/bootstrap.mjs';
import { buildInventory } from '../security/inputs.mjs';
import { classifyOSV, decodeReport } from '../security/results.mjs';

await main(import.meta.url, async () => {
  const before = inspect();
  assertUnchanged(before, before);
  const files = [
    'package-lock.json',
    'contracts/toolchain.lock.json',
    'contracts/requirements-slither.lock',
    'tools/security/requirements-semgrep-darwin-arm64.lock',
    'tools/security/requirements-semgrep-linux-x64.lock',
    'planning/coverage-instrumentation.package-lock.json',
    'planning/coverage-toolchain.lock.json',
  ];
  const inputs = Object.fromEntries(files.map((file) => [file, readFileSync(join(root, file), 'utf8')]));
  const inventory = buildInventory({
    npmLock: JSON.parse(inputs[files[0]]),
    contractLock: JSON.parse(inputs[files[1]]),
    pythonLocks: files.slice(2, 5).map((f) => inputs[f]),
    extraNpmLocks: [{ source: files[5], lock: JSON.parse(inputs[files[5]]) }],
    browserPackage: {
      source: `${files[6]}#browser.package`,
      ...JSON.parse(inputs[files[6]]).browser.package,
    },
    requireCoverage: true,
  });
  const tool = await installScanner('osv');
  try {
    const manifest = join(tool.directory, 'osv-scanner.json'),
      config = join(tool.directory, 'osv-scanner.toml');
    writeFileSync(
      manifest,
      JSON.stringify({ results: [{ packages: inventory.packages.map((p) => ({ package: p })) }] }),
    );
    writeFileSync(config, '');
    const result = run(
      tool.binary,
      [
        'scan',
        'source',
        '--lockfile',
        `osv-scanner:${manifest}`,
        '--config',
        config,
        '--format',
        'json',
        '--all-packages',
        '--all-vulns',
        '--no-resolve',
      ],
      { cwd: tool.directory, env: tool.env, timeout: 300000 },
    );
    const report = classifyOSV({ ...result, report: decodeReport(result.stdout) }, inventory.packages);
    assertUnchanged(before, inspect());
    emit({
      gate: 'osv-scanner',
      ...before,
      ...report,
      version: tool.version,
      scannerLockSha256: tool.lockSha256,
      inputHashes: Object.fromEntries(
        files.map((f) => [f, createHash('sha256').update(inputs[f]).digest('hex')]),
      ),
      inventorySha256: createHash('sha256').update(JSON.stringify(inventory.packages)).digest('hex'),
      npmEntries: inventory.npmEntries,
      pythonEntries: inventory.pythonEntries,
      extraNpmEntries: inventory.extraNpmEntries,
      browserEntries: inventory.browserEntries,
      sourceCounts: inventory.sourceCounts,
      packageSources: inventory.packageSources,
      unmapped: inventory.unmapped,
      boundary:
        'All reported advisories block. Exact npm/PyPI and identified Git package inventory; known advisory coverage only, no independent audit or full native toolchain coverage.',
    });
  } finally {
    tool.cleanup();
  }
});

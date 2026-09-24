import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  browserDigest,
  browserHelperBootstrap,
  replayBrowserCoverage,
} from '../../tools/coverage/browser-evidence.mjs';
import { createBrowserCoverageLifecycle } from '../../tools/coverage/browser-lifecycle.mjs';
import { loadCoverageTools } from '../../tools/coverage/toolchain.mjs';

const driverPath = 'tools/verify-m3-browser.mjs';

// These are qualification artifacts, not observations supplied to reportCoverage.
// The real collector owns its own bootstrap and lifecycle; never wrap it twice.
export async function installCleanupCoverage(context, directory) {
  if (!process.env.AF_COVERAGE_PREPARED) return null;
  const root = resolve(process.env.AF_COVERAGE_ROOT);
  const prepared = resolve(process.env.AF_COVERAGE_PREPARED);
  const manifestBytes = await readFile(join(prepared, 'manifest.json'));
  const generatedBytes = await readFile(join(prepared, 'generated.json'));
  assert.equal(browserDigest(manifestBytes), process.env.AF_COVERAGE_MANIFEST_SHA);
  assert.equal(browserDigest(generatedBytes), process.env.AF_COVERAGE_GENERATED_SHA);
  const manifest = JSON.parse(manifestBytes);
  const generated = JSON.parse(generatedBytes);
  assert.ok(globalThis.__coverage__?.[driverPath], 'actual Node driver hook must be active');
  const tools = await loadCoverageTools(root, {
    instrumentationDirectory: process.env.AF_QUALIFIED_COVERAGE_TOOLS,
  });
  assert.equal(tools.descriptorSha256, manifest.toolDigest);
  const bootstrap = browserHelperBootstrap({
    root,
    manifest,
    generated,
    parser: tools.parser,
    paths: [driverPath],
  });
  await context.addInitScript({ content: bootstrap });
  const outputDirectory = join(directory, 'browser-qualification');
  await mkdir(outputDirectory, { recursive: true });
  const tracker = createBrowserCoverageLifecycle({
    manifest,
    outputDirectory,
    loaded: new Set([driverPath]),
    workflow: 'M3_CLEANUP_QUALIFICATION',
  });
  context.on('page', (page) => tracker.registerPage(page));
  return async () => {
    let collection;
    let failure;
    try {
      collection = await tracker.finish();
    } catch (error) {
      collection = error.browserCoverage;
      failure = error;
    }
    // Retain even failed lifecycle evidence before assertions. Replay verifies
    // raw hashes, exact source graphs, counts and each new-document interval.
    const receipt = {
      classification: 'QUALIFICATION_ONLY',
      formalCoverageContribution: false,
      prepared,
      candidateCommit: manifest.candidateCommit,
      candidateTree: manifest.candidateTree,
      manifestSha256: process.env.AF_COVERAGE_MANIFEST_SHA,
      generatedSha256: process.env.AF_COVERAGE_GENERATED_SHA,
      bootstrapSha256: browserDigest(bootstrap),
      sourcePath: driverPath,
      collection,
      ...(failure ? { error: { message: failure.message, stack: failure.stack } } : {}),
    };
    await writeFile(join(directory, 'browser-qualification.json'), JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
    });
    if (failure) throw failure;
    const replay = replayBrowserCoverage({ manifest, outputDirectory, index: collection.index });
    assert.equal(replay.observations.length, collection.observations.length);
    const live = new Map(collection.observations.map((row) => [row.id, row]));
    for (const row of replay.observations) {
      assert.deepEqual(row, live.get(row.id));
      assert.equal(row.complete, true, `cleanup qualification lost interval: ${row.reason}`);
    }
  };
}

export async function assertCleanupCallbackCoverage(directory) {
  if (!process.env.AF_COVERAGE_PREPARED) return;
  const receipt = JSON.parse(await readFile(join(directory, 'browser-qualification.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(receipt.prepared, 'manifest.json'), 'utf8'));
  const replay = replayBrowserCoverage({
    manifest,
    outputDirectory: join(directory, 'browser-qualification'),
    index: receipt.collection.index,
  });
  // Source locations of the four real cross-realm callbacks in this unchanged
  // driver. IDs come from its bound graph, never from a cov_* helper name.
  const callbacks = [476, 542, 544, 548].map((line) => {
    const matches = Object.entries(manifest.sources[driverPath].coverage.fnMap).filter(
      ([, fn]) => fn.decl.start.line === line,
    );
    assert.equal(matches.length, 1, `expected one driver callback at line ${line}`);
    return { line, id: matches[0][0] };
  });
  for (const { line, id } of callbacks) {
    assert.ok(
      replay.observations.some((row) => row.complete && row.sources[driverPath]?.coverage.f[id] > 0),
      `browser callback at line ${line} was not reached`,
    );
  }
}

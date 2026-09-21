import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyPrepared } from './prepare.mjs';
import { verifyNodeWorkflow } from './collect.mjs';
import { replayBrowserCoverage } from './browser-evidence.mjs';
import { mergeObserved } from './evidence.mjs';
import { replayBrowserChild } from './browser-child.mjs';

export function summarizeCoverage(coverage, library) {
  const map = library.createCoverageMap(coverage);
  const files = map
    .files()
    .sort()
    .map((path) => {
      const file = map.fileCoverageFor(path);
      const missingBranches = [];
      for (const [id, counts] of Object.entries(file.b))
        for (let index = 0; index < counts.length; index++)
          if (counts[index] === 0)
            missingBranches.push({
              id,
              index,
              type: file.branchMap[id].type,
              location: file.branchMap[id].locations[index],
            });
      return {
        path,
        summary: file.toSummary().toJSON(),
        uncoveredLines: file.getUncoveredLines(),
        missingBranches,
      };
    });
  return { summary: map.getCoverageSummary().toJSON(), files };
}
export async function reportCoverage(root, preparedDirectory, options) {
  const { manifest, preparation, tools } = await verifyPrepared(root, preparedDirectory, options);
  assert.ok(Array.isArray(options.workflows) && options.workflows.length > 0, 'required workflows absent');
  assert.equal(
    new Set(options.workflows.map((x) => x.id)).size,
    options.workflows.length,
    'duplicate workflow',
  );
  const observations = [];
  const workflows = [];
  for (const workflow of options.workflows) {
    const result = await verifyNodeWorkflow(workflow.directory, manifest, preparation.manifestSha256, {
      id: workflow.id,
      args: workflow.args,
    });
    observations.push(...result.observations);
    if (workflow.browser) {
      assert.ok(
        result.artifacts.some((record) => record.file === 'browser-receipt.json'),
        'browser receipt not bound to workflow',
      );
      const receipt = JSON.parse(readFileSync(resolve(workflow.directory, 'browser-receipt.json')));
      assert.equal(receipt.schemaVersion, 1);
      assert.equal(receipt.provider, 'LOCAL');
      const selector = workflow.args.indexOf('--workflow');
      const expectedWorkflow = selector < 0 ? 'm3' : workflow.args[selector + 1];
      assert.ok(['m3', 'legacy', 'management'].includes(expectedWorkflow));
      assert.equal(receipt.workflow, expectedWorkflow, 'browser workflow identity differs');
      assert.equal(receipt.candidateCommit, manifest.candidateCommit);
      assert.equal(receipt.candidateTree, manifest.candidateTree);
      assert.equal(receipt.manifestSha256, preparation.manifestSha256);
      if (result.state === 'PASS') assert.equal(receipt.state, 'PASS');
      if (receipt.workflow === 'legacy' || receipt.workflow === 'management') {
        assert.ok(receipt.nodeChild, 'browser child evidence absent');
        assert.equal(workflow.id, `${receipt.workflow}-browser`);
        const child = replayBrowserChild({
          directory: receipt.directory,
          receipt: receipt.nodeChild,
          manifest,
          manifestSha256: preparation.manifestSha256,
          workflow: receipt.workflow,
        });
        if (result.state === 'PASS') assert.equal(child.state, 'PASS');
        observations.push(...child.observations);
      }
      const browser = replayBrowserCoverage({
        manifest,
        outputDirectory: receipt.directory,
        index: receipt.index,
      });
      observations.push(...browser.observations);
    }
    workflows.push({ id: workflow.id, directory: workflow.directory, state: result.state });
  }
  const merged = mergeObserved(manifest, observations);
  const metrics = summarizeCoverage(merged.coverage, tools.coverage);
  const threshold = 90;
  const thresholdMet = ['lines', 'statements', 'functions', 'branches'].every(
    (k) => typeof metrics.summary[k].pct === 'number' && metrics.summary[k].pct >= threshold,
  );
  const report = {
    schemaVersion: 1,
    provider: 'LOCAL',
    independentAttestation: false,
    candidateCommit: manifest.candidateCommit,
    candidateTree: manifest.candidateTree,
    baseCommit: manifest.baseCommit,
    manifestSha256: preparation.manifestSha256,
    toolDigest: manifest.toolDigest,
    collection: 'VERIFIED_HIT_LOWER_BOUND',
    functionalState: workflows.every((x) => x.state === 'PASS') ? 'PASS' : 'FAIL',
    threshold,
    thresholdDimensions: ['lines', 'statements', 'functions', 'branches'],
    thresholdMet,
    methodAdmission: 'PENDING_INDEPENDENT_REVIEW',
    criticalSemanticAcceptance: 'NOT_EVALUATED',
    workflows,
    incomplete: merged.incomplete,
    observations: observations.map((x) => ({ id: x.id, complete: x.complete, workflow: x.workflow })),
    ...metrics,
  };
  const path = resolve(preparedDirectory, `report-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { path, report };
}

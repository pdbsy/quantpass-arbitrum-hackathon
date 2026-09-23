import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyPrepared } from '../../tools/coverage/prepare.mjs';
import { browserHelperBootstrap } from '../../tools/coverage/browser-evidence.mjs';

// Original browser drivers serialize their instrumented callbacks into a second
// realm. Reuse the qualified collector's exact helper declarations in that realm;
// do not strip instrumentation or fabricate/merge browser counter observations.
// These qualification journeys contribute only their normally observed Node hits.
export async function qualifiedBrowserBootstrap(root, paths) {
  const directory = process.env.AF_COVERAGE_PREPARED;
  if (!directory) return '';
  assert.equal(resolve(process.env.AF_COVERAGE_ROOT), resolve(root));
  assert.ok(process.env.AF_QUALIFIED_COVERAGE_TOOLS, 'Qualified instrumentation tools are required');
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json')));
  const verified = await verifyPrepared(root, directory, {
    sourceBase: manifest.baseCommit,
    instrumentationDirectory: process.env.AF_QUALIFIED_COVERAGE_TOOLS,
  });
  assert.equal(verified.preparation.manifestSha256, process.env.AF_COVERAGE_MANIFEST_SHA);
  assert.equal(verified.preparation.generatedSha256, process.env.AF_COVERAGE_GENERATED_SHA);
  return browserHelperBootstrap({
    root,
    manifest: verified.manifest,
    generated: verified.generated,
    parser: verified.tools.parser,
    paths,
  });
}

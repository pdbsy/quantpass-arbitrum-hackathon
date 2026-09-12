import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseProfileArgs, runChecks } from './management-dashboard/checks.mjs';
import { sanitizeLog } from './management-dashboard/redact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function main(args = process.argv.slice(2)) {
  const profile = parseProfileArgs(args);
  const report = await runChecks({ root, profile });
  const passed = report.checks.filter((check) => check.status === 'PASS').length;
  const failed = report.checks.filter((check) => check.status === 'FAIL').length;
  const notRun = report.checks.filter((check) => check.status === 'NOT_RUN').length;
  console.log(
    `Management checks complete: ${passed} PASS, ${failed} FAIL, ${notRun} NOT_RUN; commit ${report.commit.slice(0, 12)}`,
  );
  if (failed > 0) process.exitCode = 1;
  return report;
}

if (
  process.argv[1] &&
  relative(dirname(fileURLToPath(import.meta.url)), resolve(process.argv[1])) === 'run-management-checks.mjs'
)
  main().catch((error) => {
    console.error(
      `Management checks failed: ${sanitizeLog(error?.message ?? 'UNKNOWN_ERROR', { maxBytes: 512 })}`,
    );
    process.exitCode = 1;
  });

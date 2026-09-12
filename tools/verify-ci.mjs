import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectEnvironment, npmCli, ROOT } from './environment/observe.mjs';
import { validateReport } from './environment/report.mjs';
export function verify({
  inspect = () => inspectEnvironment({ mode: 'ci' }),
  run = () =>
    spawnSync(process.execPath, [npmCli(), 'run', 'check'], { cwd: ROOT, stdio: 'inherit', shell: false })
      .status,
  emit = (report) => {
    validateReport(report);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  },
} = {}) {
  const before = inspect();
  emit(before);
  if (before.exitCode !== 0) return before.exitCode;
  const result = run();
  const after = inspect();
  emit(after);
  if (!Number.isInteger(result) || result < 0) return 2;
  if (result !== 0) return result;
  if (after.exitCode !== 0) return after.exitCode;
  if (['head', 'tree', 'lockSha256'].some((key) => before[key] !== after[key])) return 1;
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Invalid arguments');
    process.exitCode = verify();
  } catch {
    process.stderr.write(
      'CI verification BLOCKED: prerequisite unavailable; no raw environment values disclosed.\n',
    );
    process.exitCode = 2;
  }
}

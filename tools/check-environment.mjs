import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, inspectEnvironment } from './environment/observe.mjs';
import { writeReport, validateReport } from './environment/report.mjs';
export function main(args = process.argv.slice(2)) {
  try {
    if (args.some((a) => !['--ci', '--write-report'].includes(a)) || new Set(args).size !== args.length)
      throw new Error('Invalid arguments');
    const report = inspectEnvironment({ mode: args.includes('--ci') ? 'ci' : 'dev' });
    validateReport(report);
    if (args.includes('--write-report')) writeReport(ROOT, report);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.exitCode;
  } catch (error) {
    process.stderr.write(
      'Environment check BLOCKED: inputs, prerequisites or report validation unavailable. No raw values disclosed.\n',
    );
    return error instanceof SyntaxError || error.message === 'Invalid environment inputs' ? 1 : 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { root, git, inspect, assertUnchanged, run, emit, main } from './context.mjs';
import { installScanner } from '../security/bootstrap.mjs';
import { scannerTargets } from '../security/inputs.mjs';
import { classifySemgrep, decodeReport } from '../security/results.mjs';
import { stageSources } from '../security/staging.mjs';

function scan(tool, config, cwd, paths) {
  const result = run(
    tool.binary,
    [
      'scan',
      '--config',
      config,
      '--json',
      '--metrics=off',
      '--disable-version-check',
      '--oss-only',
      '--strict',
      '--error',
      '--disable-nosem',
      '--no-git-ignore',
      '--no-rewrite-rule-ids',
      '--timeout=30',
      '--timeout-threshold=1',
      '--max-target-bytes=2097152',
      '--max-memory=2048',
      '--jobs=2',
      ...paths,
    ],
    { cwd, env: tool.env, timeout: 600000 },
  );
  return { ...result, report: decodeReport(result.stdout) };
}

export function verifyRuleFixtures(tool, config, fixtureText) {
  const fixtures = JSON.parse(fixtureText),
    rules = parse(readFileSync(config, 'utf8')).rules;
  const ids = rules.map((r) => r.id).sort();
  if (
    !fixtures.length ||
    new Set(ids).size !== ids.length ||
    JSON.stringify(fixtures.map((x) => x.id).sort()) !== JSON.stringify(ids)
  )
    throw new Error('Semgrep rule fixture coverage mismatch');
  const cwd = join(tool.directory, 'fixtures');
  mkdirSync(cwd);
  const paths = [];
  for (const [i, f] of fixtures.entries())
    for (const kind of ['bad', 'good']) {
      if (!['python', 'javascript'].includes(f.language) || typeof f[kind] !== 'string')
        throw new Error('Invalid Semgrep fixture');
      const path = `${kind}-${i}.${f.language === 'python' ? 'py' : 'js'}`;
      paths.push(path);
      writeFileSync(join(cwd, path), f[kind] + '\n');
    }
  const result = scan(tool, config, cwd, paths);
  const classification = classifySemgrep(result, paths, tool.version);
  if (classification.state !== 'FAIL')
    throw new Error('Semgrep engine did not detect rule canaries completely');
  for (const [i, f] of fixtures.entries()) {
    if (
      !classification.findings.some((x) => x.file.startsWith(`bad-${i}.`) && x.rule === f.id) ||
      classification.findings.some((x) => x.file.startsWith(`good-${i}.`))
    )
      throw new Error('Semgrep positive/negative rule regression');
  }
  return { rules: ids.length, fixtures: paths.length };
}

await main(import.meta.url, async () => {
  const before = inspect();
  assertUnchanged(before, before);
  const tool = await installScanner('semgrep');
  try {
    const config = join(root, 'tools/security/semgrep.yml'),
      fixtureText = readFileSync(join(root, 'tools/security/rule-fixtures.json'), 'utf8');
    const canaries = verifyRuleFixtures(tool, config, fixtureText);
    const paths = scannerTargets(git('ls-files', '-z').split('\0').filter(Boolean));
    const cwd = join(tool.directory, 'source');
    mkdirSync(cwd);
    const coverage = stageSources(root, cwd, paths);
    const report = classifySemgrep(scan(tool, config, cwd, paths), paths, tool.version);
    assertUnchanged(before, inspect());
    emit({
      gate: 'semgrep-ce',
      ...before,
      ...report,
      ...coverage,
      ...canaries,
      version: tool.version,
      buildId: tool.buildId,
      wheelSha256: tool.wheelSha256,
      scannerLockSha256: tool.lockSha256,
      rulesSha256: createHash('sha256').update(readFileSync(config)).digest('hex'),
      boundary:
        'Fixed local JS/TS/Python rules, including intraprocedural taint; no CodeQL-equivalent cross-function/file coverage. Tests/fixtures and HTML inline scripts excluded.',
    });
  } finally {
    tool.cleanup();
  }
});

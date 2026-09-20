import { readFileSync } from 'node:fs';
import { runLocal } from './runner.mjs';

// Explicit one-shot execution of an operator-reviewed local config. Never watch or publish.
try {
  if (process.argv.length !== 3) throw new Error('Expected one local config path');
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const result = await runLocal(config);
  console.log(JSON.stringify({ state: result.state, directory: result.directory }));
  process.exitCode = result.state === 'PASS' ? 0 : result.state === 'FAIL' ? 1 : 2;
} catch {
  console.error('Local CI BLOCKED: configuration or evidence unavailable');
  process.exitCode = 2;
}

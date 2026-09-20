import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const args = JSON.parse(process.env.AF_COVERAGE_COMMAND);
assert.ok(Array.isArray(args) && args.length > 0 && args.every((arg) => typeof arg === 'string'));
const result = spawnSync(process.execPath, args, { env: process.env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;

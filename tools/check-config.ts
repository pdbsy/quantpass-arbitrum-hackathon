import { readConfig } from '../packages/config/src/index.ts';

try {
  console.log(JSON.stringify(readConfig(process.env)));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid configuration');
  process.exitCode = 1;
}

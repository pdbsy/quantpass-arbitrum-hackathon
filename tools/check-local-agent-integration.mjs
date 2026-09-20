import { fileURLToPath } from 'node:url';
import { verifyLocalManagerIntegration } from './agent-integration-identity.mjs';

// No default refs, network calls, hosted identity or status publishing.
try {
  const args = process.argv.slice(2);
  if (args.length !== 6) throw new Error('Require --branch, --base and --head exactly once');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!['--branch', '--base', '--head'].includes(args[i]) || key in options || !args[i + 1])
      throw new Error('Invalid LOCAL arguments');
    options[key] = args[i + 1];
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  console.log(JSON.stringify(verifyLocalManagerIntegration(root, options)));
} catch (error) {
  console.error(`LOCAL integration BLOCKED: ${error.message}`);
  process.exitCode = 1;
}

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately bounded baseline; not a substitute for a full secret scanner or independent audit.
export function findSecretKinds(text) {
  const patterns = [
    ['private-key', new RegExp('-----BEGIN ' + '(?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----')],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
    ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
    ['aws-access-key', /\bAKIA[A-Z0-9]{16}\b/],
    [
      'literal-secret',
      /(?:api[_-]?key|private[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/i,
    ],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

export async function scanWorkspace(root) {
  const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const failures = [];
  for (const file of new Set(files)) {
    if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) {
      failures.push(`${file}: environment-file`);
      continue;
    }
    const bytes = await readFile(resolve(root, file));
    if (bytes.includes(0)) continue; // Binary secrets require dedicated scanners.
    for (const kind of findSecretKinds(bytes.toString('utf8'))) failures.push(`${file}: ${kind}`);
  }
  if (failures.length)
    throw new Error(`Potential secrets detected (values redacted):\n${failures.join('\n')}`);
  console.log(
    `Secret baseline passed: ${new Set(files).size} tracked/unignored files; ignored local .env and binary files are outside coverage.`,
  );
}

if (
  process.argv[1] &&
  relative(fileURLToPath(new URL('.', import.meta.url)), resolve(process.argv[1])) === 'check-secrets.mjs'
) {
  try {
    await scanWorkspace(fileURLToPath(new URL('../', import.meta.url)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
if (process.argv.length !== 2) throw new Error('OFFLINE_PREPARATION_USAGE');
const root = '.checks/container-inputs';
mkdirSync(root + '/npm', { recursive: true });
mkdirSync(root + '/native/wheels', { recursive: true });
const lock = JSON.parse(readFileSync('package-lock.json'));
const entries = Object.entries(lock.packages).filter(([p]) => p);
let next = 0;
const records = [];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < entries.length) {
      const [path, entry] = entries[next++];
      if (!entry.resolved.startsWith('https://registry.npmjs.org/')) throw new Error('OFFLINE_REGISTRY');
      const name = createHash('sha256').update(path).digest('hex') + '.tgz';
      const response = await fetch(entry.resolved);
      if (!response.ok) throw new Error('Artifact HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      const [alg, want] = entry.integrity.split('-');
      if (createHash(alg).update(bytes).digest('base64') !== want)
        throw new Error('Artifact integrity ' + path);
      writeFileSync(root + '/npm/' + name, bytes);
      records.push({ path, filename: name, resolved: entry.resolved, integrity: entry.integrity });
    }
  }),
);
writeFileSync(root + '/npm/manifest.json', JSON.stringify(records, null, 2) + '\n');
const image = JSON.parse(readFileSync('deploy/container/image.lock.json'));
async function primary(artifact, file) {
  const response = await fetch(artifact.url);
  if (!response.ok) throw new Error('PRIMARY_HTTP');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('PRIMARY_BYTES');
  if (artifact.integrity) {
    const [alg, want] = artifact.integrity.split('-');
    if (createHash(alg).update(bytes).digest('base64') !== want) throw new Error('PRIMARY_SRI');
  }
  writeFileSync(file, bytes);
}
await primary(image.npm, root + '/npm.tgz');

const native = JSON.parse(readFileSync('contracts/toolchain.lock.json'));
for (const artifact of [
  native.platforms['linux-x64'].foundry,
  native.platforms['linux-x64'].solc,
  native.openzeppelin,
])
  await primary(artifact, root + '/native/' + artifact.filename);
const wheels = JSON.parse(readFileSync('contracts/slither-linux-x64-wheels.json'));
for (const record of wheels) await primary(record, root + '/native/wheels/' + record.filename);
console.log(
  JSON.stringify({
    npmArchiveCount: records.length,
    nativeWheels: wheels.length,
    lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
  }),
);

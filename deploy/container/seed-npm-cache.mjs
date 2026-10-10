import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { npmCli } from '../../tools/environment/observe.mjs';
const require = createRequire(npmCli()),
  cacache = require('cacache');
const records = JSON.parse(readFileSync('/reviewed/npm/manifest.json')),
  lock = JSON.parse(readFileSync('package-lock.json'));
if (
  records.length !== Object.keys(lock.packages).length - 1 ||
  new Set(records.map((r) => r.path)).size !== records.length
)
  throw new Error('OFFLINE_GRAPH_INCOMPLETE');
for (const r of records) {
  const entry = lock.packages[r.path];
  if (
    !entry ||
    r.resolved !== entry.resolved ||
    r.integrity !== entry.integrity ||
    !/^\w{64}\.tgz$/.test(r.filename)
  )
    throw new Error('OFFLINE_GRAPH_IDENTITY');
  const bytes = readFileSync('/reviewed/npm/' + r.filename),
    [alg, want] = entry.integrity.split('-');
  if (createHash(alg).update(bytes).digest('base64') !== want) throw new Error('OFFLINE_GRAPH_BYTES');
  await cacache.put('/tmp/npm-cache/_cacache', 'reviewed:' + r.path, bytes, { integrity: r.integrity });
}

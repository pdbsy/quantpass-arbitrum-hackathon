import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function verifyInstallation(directory, expected) {
  const root = resolve(directory);
  assert.equal(realpathSync(root), root, 'tool root must not be redirected');
  assert.ok(lstatSync(root).isDirectory());
  assert.ok(expected && typeof expected === 'object' && !Array.isArray(expected));
  const actual = [];
  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      const target = resolve(path, name);
      const stat = lstatSync(target);
      if (stat.isDirectory()) visit(target);
      else actual.push(relative(root, target).split(sep).join('/'));
    }
  }
  visit(root);
  assert.deepEqual(actual.sort(), Object.keys(expected).sort(), 'tool file inventory mismatch');
  let files = 0;
  let symlinks = 0;
  for (const [path, record] of Object.entries(expected)) {
    assert.ok(
      path &&
        !path.includes('\\') &&
        !path.includes(':') &&
        path.split('/').every((part) => part && part !== '.' && part !== '..'),
    );
    const target = resolve(root, path);
    const stat = lstatSync(target);
    if (record.type === 'symlink') {
      assert.ok(stat.isSymbolicLink());
      assert.equal(readlinkSync(target), record.target);
      const resolved = realpathSync(target);
      assert.ok(resolved.startsWith(root + sep), 'tool symlink escapes locked graph');
      assert.equal(expected[relative(root, resolved).split(sep).join('/')]?.type, 'file');
      symlinks++;
    } else {
      assert.equal(record.type, 'file');
      assert.ok(stat.isFile() && !stat.isSymbolicLink());
      assert.equal(stat.size, record.bytes);
      assert.match(record.sha256, /^[a-f0-9]{64}$/);
      assert.equal(sha256(readFileSync(target)), record.sha256, 'installed tool bytes mismatch');
      files++;
    }
  }
  return { files, symlinks };
}

export function loadInstalledFileRecords(root, chunks) {
  assert.ok(Array.isArray(chunks) && chunks.length > 0 && chunks.length <= 16);
  const records = {};
  const seen = new Set();
  for (const chunk of chunks) {
    assert.ok(
      typeof chunk.path === 'string' &&
        !chunk.path.includes('\\') &&
        !chunk.path.includes(':') &&
        chunk.path.split('/').every((part) => part && part !== '.' && part !== '..'),
    );
    assert.ok(!seen.has(chunk.path), 'duplicate tool chunk');
    seen.add(chunk.path);
    const path = resolve(root, chunk.path);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    const bytes = readFileSync(path);
    assert.equal(sha256(bytes), chunk.sha256, 'tool chunk changed');
    const data = JSON.parse(bytes);
    assert.ok(data && typeof data === 'object' && !Array.isArray(data));
    assert.equal(Object.keys(data).length, chunk.records);
    for (const [name, record] of Object.entries(data)) {
      assert.ok(!Object.hasOwn(records, name), 'overlapping tool inventory');
      records[name] = record;
    }
  }
  return records;
}

export async function loadCoverageTools(root, { instrumentationDirectory, browserDirectory } = {}) {
  assert.equal(process.versions.node, '24.21.0', 'coverage runtime not qualified');
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const bytes = readFileSync(resolve(root, 'planning/coverage-toolchain.lock.json'));
  const descriptor = JSON.parse(bytes);
  assert.equal(descriptor.schemaVersion, 1);
  const lockBytes = readFileSync(resolve(root, descriptor.instrumentation.lockfile));
  assert.equal(sha256(lockBytes), descriptor.instrumentation.lockSha256);
  const directory = resolve(
    instrumentationDirectory || resolve(root, '.checks/coverage-tools/instrumentation/node_modules'),
  );
  verifyInstallation(
    directory,
    loadInstalledFileRecords(root, descriptor.instrumentation.installedFileChunks),
  );
  const require = createRequire(resolve(directory, '__qualified_entry__.cjs'));
  const modules = {
    instrument: require('istanbul-lib-instrument'),
    parser: require('@babel/parser'),
    coverage: require('istanbul-lib-coverage'),
  };
  assert.equal(require('istanbul-lib-instrument/package.json').version, descriptor.instrumenter.version);
  if (browserDirectory) {
    const browser = resolve(browserDirectory);
    verifyInstallation(browser, descriptor.browser.installedFiles);
    modules.chromium = (await import(pathToFileURL(resolve(browser, 'index.mjs')).href)).chromium;
  }
  return { ...modules, descriptor, descriptorSha256: sha256(bytes), instrumentationDirectory: directory };
}

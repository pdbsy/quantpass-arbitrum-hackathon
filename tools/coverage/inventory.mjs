import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from './toolchain.mjs';
export const prototypePath = 'apps/web/prototype/AlphaForge_v3_EN.html';

export function isTypeOnly(node) {
  if (
    ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSDeclareFunction', 'EmptyStatement'].includes(
      node.type,
    )
  )
    return true;
  if (node.type === 'ImportDeclaration')
    return (
      node.importKind === 'type' ||
      (node.specifiers.length > 0 && node.specifiers.every((item) => item.importKind === 'type'))
    );
  if (node.type === 'ExportNamedDeclaration')
    return (
      node.exportKind === 'type' ||
      (node.declaration
        ? isTypeOnly(node.declaration)
        : node.specifiers.length > 0 && node.specifiers.every((item) => item.exportKind === 'type'))
    );
  return node.type === 'ExportAllDeclaration' && node.exportKind === 'type';
}
export function readSourceSnapshot(root) {
  const git = (...args) =>
    execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
    });
  assert.equal(
    git('status', '--porcelain', '--untracked-files=normal'),
    '',
    'coverage requires a clean committed candidate',
  );
  const candidateCommit = git('rev-parse', 'HEAD').trim();
  const candidateTree = git('rev-parse', 'HEAD^{tree}').trim();
  const tracked = git('ls-tree', '-r', '-z', 'HEAD')
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const [header, path] = row.split('\t');
      const [mode, type, blob] = header.split(' ');
      assert.ok(path && !path.includes('\t'));
      return { path, mode, type, blob };
    });
  const sources = {};
  let prototype = null;
  for (const entry of tracked) {
    const { path } = entry;
    if (path.startsWith('test/')) continue;
    if (!/\.(?:js|mjs|cjs|ts|tsx|html|htm)$/.test(path)) continue;
    assert.equal(entry.type, 'blob');
    assert.ok(['100644', '100755'].includes(entry.mode), 'source symlink not admitted');
    const absolute = resolve(root, path);
    assert.ok(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink());
    const bytes = readFileSync(absolute);
    const text = bytes.toString('utf8');
    assert.deepEqual(Buffer.from(text), bytes, 'source must be valid UTF-8');
    assert.equal(text, git('cat-file', 'blob', entry.blob), 'working source differs from Git blob');
    if (/\.html?$/.test(path)) {
      const executable = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(
        (match) =>
          !/\bsrc\s*=/i.test(match[1]) &&
          !/\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(match[1]) &&
          match[2].trim(),
      );
      if (executable.length) {
        assert.equal(path, prototypePath, 'unregistered executable inline source');
        assert.equal(executable.length, 1, 'prototype script extraction is ambiguous');
        prototype = { path, sha256: sha256(bytes), blob: entry.blob, text };
      }
    } else sources[path] = { sha256: sha256(bytes), blob: entry.blob, text };
  }
  return {
    candidateCommit,
    candidateTree,
    trackedPaths: tracked.map((entry) => entry.path),
    sources,
    prototype,
  };
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from './toolchain.mjs';
import { analyzeHtmlSource } from '../html-source-ranges.mjs';
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
  assert.equal(git('rev-parse', '--is-shallow-repository').trim(), 'false', 'complete Git history required');
  assert.equal(
    git('for-each-ref', '--format=%(refname)', 'refs/replace/'),
    '',
    'replacement refs not admitted',
  );
  assert.ok(
    !git('ls-files', '-v', '-z')
      .split('\0')
      .some((row) => /^[a-zS] /.test(row)),
    'hidden index flag not admitted',
  );
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
      const executable = analyzeHtmlSource(text).scripts.filter(
        (script) => script.kind === 'inline' && script.text.trim(),
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

export async function instrumentSnapshot(root, snapshot, tools) {
  const { buildPrototypeMap } = await import('./prototype-map.mjs');
  const sources = {};
  const aliases = {};
  const classifications = {};
  const generated = {};
  const alias = 'docs/management/dashboard/agent-forum-app.js';
  const original = 'tools/agent-forum-app.js';
  if (Object.hasOwn(snapshot.sources, alias)) {
    assert.ok(Object.hasOwn(snapshot.sources, original));
    assert.equal(
      snapshot.sources[alias].sha256,
      snapshot.sources[original].sha256,
      'forum alias bytes differ',
    );
    const result = execFileSync(process.execPath, ['tools/build-agent-forum.mjs', '--check'], {
      cwd: root,
      timeout: 15000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const aliasProof = {
      generator: 'tools/build-agent-forum.mjs',
      generatorSha256: snapshot.sources['tools/build-agent-forum.mjs'].sha256,
      staleCheck: {
        command: ['node', 'tools/build-agent-forum.mjs', '--check'],
        exitCode: 0,
        outputSha256: sha256(result),
      },
    };
    aliases[alias] = {
      canonical: original,
      sha256: snapshot.sources[alias].sha256,
      blob: snapshot.sources[alias].blob,
      proof: aliasProof,
    };
  }
  for (const [path, entry] of Object.entries(snapshot.sources)) {
    if (Object.hasOwn(aliases, path)) {
      classifications[path] = { kind: 'GENERATED_ALIAS', canonical: original };
      continue;
    }
    const options = {
      esModules: true,
      produceSourceMap: true,
      parserPlugins: path.endsWith('.tsx')
        ? ['typescript', 'jsx']
        : path.endsWith('.ts')
          ? ['typescript']
          : [],
      coverageGlobalScope: 'globalThis',
      coverageGlobalScopeFunc: false,
    };
    const ast = tools.parser.parse(entry.text, { sourceType: 'module', plugins: options.parserPlugins });
    assert.ok(
      !ast.comments.some((comment) => /istanbul\s+ignore/.test(comment.value)),
      'coverage ignore directive not admitted',
    );
    const mapper = tools.instrument.createInstrumenter(options);
    const code = mapper.instrumentSync(entry.text, path);
    const zero = JSON.parse(JSON.stringify(mapper.lastFileCoverage()));
    const noExecutable = ast.program.body.every(isTypeOnly);
    const count =
      Object.keys(zero.s).length + Object.keys(zero.f).length + Object.values(zero.b).flat().length;
    if (noExecutable) assert.equal(count, 0);
    classifications[path] = {
      kind: noExecutable ? 'NO_EXECUTABLE_CODE' : count ? 'EXECUTABLE' : 'EXECUTABLE_ZERO_COUNTER_GRAPH',
    };
    const map = JSON.parse(JSON.stringify(mapper.lastSourceMap()));
    sources[path] = {
      sha256: entry.sha256,
      blob: entry.blob,
      coverage: zero,
      options,
      optionsSha256: sha256(JSON.stringify(options)),
      generatedSha256: sha256(code),
      sourceMapSha256: sha256(JSON.stringify(map)),
    };
    generated[path] = { code, map };
  }
  if (snapshot.prototype) {
    const entry = snapshot.prototype;
    const mapping = buildPrototypeMap(entry.text);
    const options = { esModules: false, coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false };
    const mapper = tools.instrument.createInstrumenter(options);
    const code = mapper.instrumentSync(mapping.generated, entry.path);
    const runtimeCoverage = JSON.parse(JSON.stringify(mapper.lastFileCoverage()));
    const canonicalCoverage = structuredClone(runtimeCoverage);
    function translate(value) {
      if (!value || typeof value !== 'object') return;
      if (Number.isInteger(value.line) && Number.isInteger(value.column)) {
        Object.assign(value, mapping.originalPosition(value));
        return;
      }
      for (const member of Object.values(value)) translate(member);
      if (value.loc?.start?.line && Object.hasOwn(value, 'line')) value.line = value.loc.start.line;
    }
    for (const key of ['statementMap', 'fnMap', 'branchMap']) translate(canonicalCoverage[key]);
    sources[entry.path] = {
      sha256: entry.sha256,
      blob: entry.blob,
      coverage: canonicalCoverage,
      runtimeCoverage,
      options,
      optionsSha256: sha256(JSON.stringify(options)),
      normalizedSha256: sha256(mapping.generated),
      generatedSha256: sha256(code),
      substitutions: mapping.insertions.length,
    };
    generated[entry.path] = { code };
    classifications[entry.path] = { kind: 'EXECUTABLE_INLINE_SCRIPT' };
  }
  const manifest = {
    schemaVersion: 1,
    provider: 'LOCAL',
    candidateCommit: snapshot.candidateCommit,
    candidateTree: snapshot.candidateTree,
    toolDigest: tools.descriptorSha256,
    trackedPaths: snapshot.trackedPaths,
    sources,
    aliases,
    classifications,
    semantics: tools.descriptor.semantics,
    collection: 'VERIFIED_HIT_LOWER_BOUND',
  };
  return { manifest, generated };
}

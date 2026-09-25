import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifiedPrototypeArtifacts } from './helpers/prototype-artifact.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

test('migration inventory accounts for source versions and validates imported artifact hashes', async () => {
  const inventory = await readJson('docs/migration/inventory.json');
  const manifest = await readJson('docs/migration/artifact-provenance.json');
  assert.equal(inventory.canonical_repository, 'pdbsy/quantpass-arbitrum-hackathon');
  assert.ok(inventory.records.length >= 369);
  const states = new Set(['ALREADY_PRESENT', 'MIGRATED', 'SUPERSEDED', 'USER_ACTION_REQUIRED']);
  for (const row of inventory.records) {
    assert.ok(states.has(row.status), row.id);
    assert.match(row.commit, /^[a-f0-9]{40}$/);
    assert.match(row.source_blob, /^[a-f0-9]{40}$/);
    assert.ok(row.reason, row.id);
    if (row.status !== 'USER_ACTION_REQUIRED')
      assert.ok((await lstat(resolve(root, row.target_location))).isFile(), row.target_location);
  }
  for (const artifact of manifest.artifacts) {
    const file = resolve(root, artifact.target_path);
    const rel = relative(root, file);
    assert.ok(rel !== '..' && !rel.startsWith(`..${sep}`), artifact.target_path);
    assert.ok((await lstat(file)).isFile(), artifact.target_path);
    assert.match(artifact.source_commit, /^[a-f0-9]{40}$/);
    assert.match(artifact.original_sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
      artifact.migrated_sha256,
      artifact.target_path,
    );
  }
  const prototype = await verifiedPrototypeArtifacts(root);
  const record = manifest.artifacts.find(
    (row) => row.target_path === 'apps/web/prototype/AlphaForge_v3_EN.html',
  );
  assert.equal(record.original_sha256, prototype.originalSha256);
  assert.equal(record.migrated_sha256, prototype.usdcSha256);
  assert.equal(record.subsequent_revisions.length, 6);
  const prior = record.subsequent_revisions[0];
  assert.equal(prior.commit, prototype.previousRepairCommit);
  assert.equal(prior.previous_sha256, prototype.originalSha256);
  assert.equal(prior.sha256, prototype.previousRepairedSha256);
  const revision = record.subsequent_revisions[1];
  assert.equal(revision.commit, prototype.repairCommit);
  assert.equal(revision.previous_sha256, prototype.previousRepairedSha256);
  assert.equal(revision.sha256, prototype.repairedSha256);
  const currency = record.subsequent_revisions[2];
  assert.equal(currency.commit, prototype.currencyCommit);
  assert.equal(currency.previous_sha256, prototype.repairedSha256);
  assert.equal(currency.sha256, prototype.currencySha256);
  const trade = record.subsequent_revisions[3];
  assert.equal(trade.commit, prototype.tradeCommit);
  assert.equal(trade.previous_sha256, prototype.currencySha256);
  assert.equal(trade.sha256, prototype.tradeSha256);
  const funding = record.subsequent_revisions[4];
  assert.equal(funding.commit, prototype.fundingCommit);
  assert.equal(funding.previous_sha256, prototype.tradeSha256);
  assert.equal(funding.sha256, prototype.fundingSha256);
  const usdc = record.subsequent_revisions[5];
  assert.equal(usdc.commit, prototype.usdcCommit);
  assert.equal(usdc.previous_sha256, prototype.fundingSha256);
  assert.equal(usdc.sha256, prototype.usdcSha256);
  assert.equal(prototype.currentSha256, prototype.usdcSha256);
});

test('generated Forum uses external assets under the existing dashboard CSP', async () => {
  const page = await readFile(resolve(root, 'docs/management/dashboard/agent-forum.html'), 'utf8');
  assert.match(page, /<script src="\.\/agent-forum-app\.js"><\/script>/);
  assert.match(page, /href="\.\/agent-forum\.css"/);
  assert.doesNotMatch(page, /unsafe-inline|<style>|<script>/);
});

test('all eleven uncommitted Dashboard sources have explicit final dispositions', async () => {
  const inventory = await readJson('docs/migration/inventory.json');
  const disposition = await readJson('docs/migration/dashboard-disposition.json');
  assert.equal(disposition.files.length, 11);
  assert.equal(disposition.status, 'RESOLVED');
  assert.equal(inventory.additional_discovery.uncommitted_dashboard.status, 'RESOLVED');
  const allowed = new Set(['ADAPT_AND_MIGRATE', 'SUPERSEDED', 'ARCHIVE_ONLY', 'REJECT_SECURITY']);
  for (const row of disposition.files) {
    assert.ok(allowed.has(row.classification), row.path);
    assert.equal(
      row.sha256,
      inventory.additional_discovery.uncommitted_dashboard.files.find((r) => r.path === row.path).sha256,
    );
    assert.ok(row.reason && row.action);
    for (const field of [
      'modifies_ui',
      'modifies_server_runtime',
      'introduces_write',
      'affects_forum',
      'overlaps_canonical',
      'changes_security_boundary',
    ])
      assert.equal(typeof row[field], 'boolean');
    assert.ok(!row.path.startsWith('/'));
  }
});

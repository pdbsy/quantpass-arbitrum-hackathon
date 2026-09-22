import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { validateM3DeploymentTemplate } from '../tools/check-m3-deployment-template.mjs';

const template = JSON.parse(
  await readFile(
    new URL('../contracts/deployment/m3-robinhood-testnet.template.json', import.meta.url),
    'utf8',
  ),
);

test('M3 deployment template is safe to prepare without claiming a deployment', () => {
  assert.equal(validateM3DeploymentTemplate(template), template);
});

test('M3 template rejects missing contract, constructor and Vault configuration shapes', () => {
  for (const value of [null, undefined]) {
    const contracts = { ...template, contracts: value };
    assert.throws(() => validateM3DeploymentTemplate(contracts), /complete ordered M3 deployment set/);
    const vaultConfig = { ...template, vaultConfig: value };
    assert.throws(() => validateM3DeploymentTemplate(vaultConfig), /vaultConfig fields/);
    for (const name of ['strategyPass', 'vault']) {
      const candidate = structuredClone(template);
      candidate.contracts[name].constructorInputs = value;
      assert.throws(() => validateM3DeploymentTemplate(candidate), /constructor shape/);
    }
  }
});

test('optional empty evidence never turns an offline template into deployment evidence', () => {
  for (const evidence of [null, undefined, {}]) {
    const candidate = { ...structuredClone(template), evidence };
    assert.equal(validateM3DeploymentTemplate(candidate), candidate);
    assert.equal(candidate.deploymentStatus, 'NOT_DEPLOYED');
    assert.equal(candidate.indexing.deploymentBlock, null);
    assert.equal(candidate.indexing.finalityStatus, 'UNKNOWN');
    for (const contract of Object.values(candidate.contracts)) assert.equal(contract.address, null);
  }
});

test('deployment checker CLI reports offline success and fixture validation failure without mutating the template', async () => {
  const script = resolve('tools/check-m3-deployment-template.mjs');
  const actualTemplate = resolve('contracts/deployment/m3-robinhood-testnet.template.json');
  const before = await readFile(actualTemplate);
  const success = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /8 contracts remain explicitly NOT_DEPLOYED/);
  await mkdir('.checks', { recursive: true });
  const directory = await mkdtemp(resolve('.checks/template-cli-'));
  const fixturePath = resolve(directory, 'invalid-template.json');
  await writeFile(fixturePath, JSON.stringify({ ...template, deploymentStatus: 'DEPLOYED' }));
  const preload = resolve(directory, 'fixture-read.cjs');
  // Route only this CLI's template read to an independent malformed JSON fixture;
  // validation and the CLI error handler execute from the unchanged tracked file.
  await writeFile(
    preload,
    `
    const fs = require('node:fs/promises');
    const { syncBuiltinESMExports } = require('node:module');
    const readFile = fs.readFile;
    fs.readFile = (path, ...args) => readFile(path === ${JSON.stringify(actualTemplate)} ? ${JSON.stringify(fixturePath)} : path, ...args);
    syncBuiltinESMExports();
  `,
  );
  const failure = spawnSync(process.execPath, ['--require', preload, script], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Invalid M3 deployment template: deploymentStatus must be NOT_DEPLOYED/);
  assert.equal(failure.stdout, '');
  assert.deepEqual(await readFile(actualTemplate), before);
});

test('M3 deployment template rejects premature deployment evidence', () => {
  const deployed = structuredClone(template);
  deployed.deploymentStatus = 'DEPLOYED';
  assert.throws(() => validateM3DeploymentTemplate(deployed), /must be NOT_DEPLOYED/);

  const addressed = structuredClone(template);
  addressed.contracts.vault.address = '0x0000000000000000000000000000000000000001';
  assert.throws(() => validateM3DeploymentTemplate(addressed), /vault.address must remain null/);

  const indexed = structuredClone(template);
  indexed.indexing.deploymentBlock = 1;
  assert.throws(() => validateM3DeploymentTemplate(indexed), /deploymentBlock must remain null/);
});

test('M3 deployment template rejects signing and network configuration', () => {
  for (const key of ['privateKey', 'mnemonic', 'rpcUrl', 'broadcast']) {
    const candidate = structuredClone(template);
    candidate[key] = key === 'broadcast' ? false : 'forbidden';
    assert.throws(
      () => validateM3DeploymentTemplate(candidate),
      /forbidden signing or network field/,
      `${key} must stay outside the offline template`,
    );
  }
});

test('M3 deployment preparation uses resolved owner rules without deployment or business signatures', () => {
  assert.equal(template.contracts.vault.interfaceStatus, 'IMPLEMENTED_LOCAL_ONLY');
  assert.equal(template.authorization, 'DIRECT_IMMUTABLE_OWNER');
  assert.equal(template.eip712, undefined);
  assert.equal(template.indexing.softReadyDepth, 3);
  assert.equal(template.indexing.reorgSearchLimit, 128);
  assert.equal(template.indexing.finalityStatus, 'UNKNOWN');
  assert.deepEqual(
    template.contracts.vault.constructorInputs.map(({ name, type }) => [name, type]),
    [
      ['owner_', 'address'],
      ['strategyCreator_', 'address'],
      ['strategyId_', 'bytes32'],
      ['strategyRef_', 'bytes32'],
      ['pass_', 'address'],
      ['afUsdc_', 'address'],
      ['afEth_', 'address'],
      ['afBtc_', 'address'],
    ],
  );
  assert.deepEqual(
    template.contracts.strategyPass.constructorInputs.map(({ name, type }) => [name, type]),
    [
      ['name_', 'string'],
      ['symbol_', 'string'],
      ['strategyId_', 'bytes32'],
      ['fixedSupply_', 'uint256'],
      ['recipient_', 'address'],
    ],
  );
});

test('M3 deployment preparation rejects incompatible constructor or authority changes', () => {
  const badType = structuredClone(template);
  badType.contracts.strategyPass.constructorInputs[0].type = 'bytes32';
  assert.throws(() => validateM3DeploymentTemplate(badType), /constructor shape/);
  const renamedOwner = structuredClone(template);
  renamedOwner.contracts.vault.constructorInputs[0].name = 'deployer_';
  assert.throws(() => validateM3DeploymentTemplate(renamedOwner), /constructor shape/);
  const signature = structuredClone(template);
  signature.eip712 = { vaultDomainName: 'AlphaForgeVault' };
  assert.throws(() => validateM3DeploymentTemplate(signature), /business signatures are excluded/);
  const signer = structuredClone(template);
  signer.vaultConfig.riskSigner = null;
  assert.throws(() => validateM3DeploymentTemplate(signer), /vaultConfig fields/);
  const finality = structuredClone(template);
  finality.indexing.finalityStatus = 'FINALIZED';
  assert.throws(() => validateM3DeploymentTemplate(finality), /finality must remain unknown/);
});

test('M3 deployment template rejects filled constructor and Vault configuration values', () => {
  const constructorValue = structuredClone(template);
  constructorValue.contracts.strategyPass.constructorInputs[0].value = 'AlphaForge Trend Pass';
  assert.throws(
    () => validateM3DeploymentTemplate(constructorValue),
    /constructor input values must remain null/,
  );

  const owner = structuredClone(template);
  owner.vaultConfig.owner = '0x0000000000000000000000000000000000000001';
  assert.throws(() => validateM3DeploymentTemplate(owner), /vaultConfig.owner must remain null/);
});

test('M3 deployment template rejects source and evidence claims before deployment', () => {
  const source = structuredClone(template);
  source.source.branch = 'macbeth02/M3-02-PROTOCOL';
  assert.throws(() => validateM3DeploymentTemplate(source), /source.branch must remain null/);

  const evidence = structuredClone(template);
  evidence.evidence.sourceRef = 'refs/heads/macbeth02/M3-02-PROTOCOL';
  assert.throws(() => validateM3DeploymentTemplate(evidence), /evidence.sourceRef must remain null/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { getCreateAddress, Wallet } from 'ethers';
import { prepareDeployment, type DeploymentInputs } from '../tools/launch-market/prepare.ts';

function inputs(): DeploymentInputs {
  return {
    chainId: 46630,
    deployer: Wallet.createRandom().address,
    nonce: 7,
    administrator: Wallet.createRandom().address,
    quoteSigner: Wallet.createRandom().address,
    claimSigner: Wallet.createRandom().address,
    tslaLpRecipient: Wallet.createRandom().address,
    amznLpRecipient: Wallet.createRandom().address,
    usdcSupplyRaw: '2000000000000',
    conversionUsdcRaw: '100000000000',
    conversionEthRaw: '50000000000000000000',
    stockReserveUsdcRaw: '100000000000',
    stockReserveUnitsRaw: '500000000000000000000000',
    ethPerTransactionRaw: '1000000000000000000',
    ethPerAccountDailyRaw: '5000000000000000000',
    ethGlobalDailyRaw: '20000000000000000000',
    ethMinimumReserveRaw: '1000000000000000000',
  };
}
test('unsigned deployment preparation preserves CREATE order, explicit LP ownership and separate funding', async () => {
  const config = inputs(),
    first = await prepareDeployment(config),
    repeat = await prepareDeployment(config);
  assert.deepEqual(first, repeat);
  const actions = first.actions as {
    operation: string;
    contractAddress: string;
    caller: string;
    unsigned: { to: string | null; data: string; value: string } | null;
  }[];
  const deployments = actions.filter((action) => action.operation.startsWith('DEPLOY_'));
  assert.ok(deployments.length > 10);
  for (const [index, action] of deployments.entries())
    assert.equal(
      action.contractAddress,
      getCreateAddress({ from: config.deployer, nonce: config.nonce + index }),
    );
  assert.ok(actions.slice(0, deployments.length).every((action) => action.operation.startsWith('DEPLOY_')));
  assert.equal(first.requiredInitialUsdcRaw, '900000000000');
  assert.equal(first.status, 'UNSIGNED_REQUIRES_USER_APPROVAL');
  assert.ok(
    actions
      .filter((action) => action.operation.endsWith(':fundUsdc'))
      .every((action) => action.caller === config.administrator),
  );
});
test('preparation rejects insufficient separate LP/claim/reserve funds and unsafe ETH limits', async () => {
  const config = inputs();
  await assert.rejects(
    prepareDeployment({ ...config, usdcSupplyRaw: '899999999999' }),
    /SEPARATE_FUNDING_REQUIRED/,
  );
  await assert.rejects(
    prepareDeployment({ ...config, conversionEthRaw: '1000000000000000000' }),
    /CONVERSION_READINESS_REQUIRED/,
  );
  await assert.rejects(
    prepareDeployment({ ...config, tslaLpRecipient: '0x0000000000000000000000000000000000000000' }),
    /EXPLICIT_IDENTITY_REQUIRED/,
  );
});

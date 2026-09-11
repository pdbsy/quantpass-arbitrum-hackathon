import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findOperationalMetadataKinds, scanPublicMetadata } from '../tools/check-public-metadata.mjs';

function initializeRepository(root) {
  execFileSync('git', ['init', '--quiet', '-b', 'master'], { cwd: root });
}

test('public metadata detector rejects a combinable workstation and SSH profile', () => {
  const privateAddress = ['192', '168', '44', '21'].join('.');
  const homePath = ['', 'Users', ['build', 'operator'].join('-'), 'project'].join('/');
  const fingerprint = `${'SHA' + '256'}:${'A'.repeat(43)}`;
  const accountValue = ['build', 'operator'].join('-');
  const sshListener = ['S', 'SH listener'].join('');
  const tcpPort = ['TCP', '22'].join('/');
  const keyInventory = ['authorized', 'keys'].join('_');
  const profile = [
    `Local account: ${accountValue}`,
    `Project path: ${homePath}`,
    `LAN address: ${privateAddress}`,
    `${sshListener}: ${tcpPort} reachable; ${keyInventory} contains one entry`,
    `Authorized client fingerprint: ${fingerprint}`,
  ].join('\n');

  assert.deepEqual(findOperationalMetadataKinds(profile), [
    'home-path',
    'host-identity',
    'private-network',
    'ssh-exposure',
    'ssh-fingerprint',
  ]);
});

test('public metadata detector recognizes common enabled SSH wording', () => {
  const privateAddress = ['192', '168', '77', '12'].join('.');
  const homePath = ['', 'Users', ['release', 'operator'].join('-'), 'workspace'].join('/');
  const accountValue = ['release', 'operator'].join('-');
  const remoteAccessLabel = ['Remote', 'Login'].join(' ');
  const remoteProtocol = ['S', 'SH'].join('');
  const clientKeyLabel = ['Authorized', 'key'].join(' ');
  const profile = [
    `User name: ${accountValue}`,
    `Workspace: ${homePath}`,
    `Private address: ${privateAddress}`,
    `${remoteAccessLabel}: On`,
    `${remoteProtocol} listens on port 22`,
    `${clientKeyLabel} count: 1`,
  ].join('\n');

  assert.deepEqual(findOperationalMetadataKinds(profile), [
    'home-path',
    'host-identity',
    'private-network',
    'ssh-exposure',
  ]);
});

test('public metadata detector recognizes quoted structured host-identity keys', () => {
  const account = ['build', 'operator'].join('-');
  const userNameKey = ['user', 'name'].join('');
  const hostNameKey = ['host', 'Name'].join('');
  const localAccountKey = ['local', 'account'].join(' ');
  const computerNameKey = ['computer', 'Name'].join('');
  const localAccountSnakeKey = ['local', 'account'].join('_');
  const deviceNameSnakeKey = ['device', 'name'].join('_');
  const hostKey = ['ho', 'st'].join('');
  const userKey = ['us', 'er'].join('');
  const nameKey = ['na', 'me'].join('');
  for (const record of [
    JSON.stringify({ [userNameKey]: account }),
    JSON.stringify({ [hostNameKey]: account }),
    `'${localAccountKey}': ${account}`,
    JSON.stringify({ [computerNameKey]: account }),
    `${localAccountSnakeKey}: ${account}`,
    `'${deviceNameSnakeKey}': '${account}'`,
    JSON.stringify({ [userNameKey]: [account] }, null, 2),
    JSON.stringify({ [hostKey]: { [nameKey]: account } }),
    JSON.stringify({ [hostKey]: { [nameKey]: account } }, null, 2),
    JSON.stringify({ [`${userKey}.${nameKey}`]: account }),
    JSON.stringify({ [`${hostKey}.${nameKey}`]: account }),
    JSON.stringify({ [userKey]: { [nameKey]: account } }),
    JSON.stringify({ [hostKey]: { metadata: { source: 'public' }, [nameKey]: account } }),
  ])
    assert.deepEqual(findOperationalMetadataKinds(record), ['host-identity']);

  const loopback = ['127', '0', '0', '1'].join('.');
  assert.deepEqual(findOperationalMetadataKinds(JSON.stringify({ [hostNameKey]: loopback })), []);
});

test('public metadata detector accepts only bounded quoted display-name identities', () => {
  const displayName = ['Build', 'MacBook', 'Pro'].join(' ');
  const computerNameKey = ['computer', 'Name'].join('');
  const escapedComputerNameKey = `computer\\u${'004e'}ame`;
  const hostKey = ['ho', 'st'].join('');
  const nameKey = ['na', 'me'].join('');
  const javascriptIdentifier = escapedComputerNameKey.replace('\\\\u', '\\u');

  assert.deepEqual(findOperationalMetadataKinds(JSON.stringify({ [computerNameKey]: displayName })), [
    'host-identity',
  ]);
  for (const source of [
    `const profile = { ${computerNameKey}: ${JSON.stringify(displayName)} };`,
    `profile[${JSON.stringify(computerNameKey)}] = ${JSON.stringify(displayName)};`,
    `const profile = { ${hostKey}: { ${nameKey}: ${JSON.stringify(displayName)} } };`,
    `profile.${computerNameKey} =\n  ${JSON.stringify(displayName)};`,
    `profile.${computerNameKey} = (${JSON.stringify(displayName)});`,
    `const profile = { [${JSON.stringify(computerNameKey)}]: ${JSON.stringify(displayName)} };`,
    `profile[\`${computerNameKey}\`] = ${JSON.stringify(displayName)};`,
    `profile.${javascriptIdentifier} = ${JSON.stringify(displayName)};`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), ['host-identity']);
  assert.deepEqual(
    findOperationalMetadataKinds(
      `${computerNameKey}: ${JSON.stringify(displayName)}`,
      'records/profile.yaml',
    ),
    ['host-identity'],
  );

  for (const placeholder of ['string', 'localhost', ['127', '0', '0', '1'].join('.')]) {
    assert.deepEqual(findOperationalMetadataKinds(JSON.stringify({ [computerNameKey]: placeholder })), []);
    assert.deepEqual(
      findOperationalMetadataKinds(
        `const profile = { ${computerNameKey}: ${JSON.stringify(placeholder)} };`,
        'src/profile.ts',
      ),
      [],
    );
  }
  for (const source of [
    `profile.${computerNameKey} = ${JSON.stringify(String.fromCharCode(10))};`,
    `const profile = { ${computerNameKey}: ${JSON.stringify(String.fromCharCode(9))} };`,
    `profile.${computerNameKey} = ${JSON.stringify('Build-')}\n  + suffix;`,
    `profile.${computerNameKey} = (${JSON.stringify('Build-')}) + suffix;`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), []);
  assert.deepEqual(
    findOperationalMetadataKinds(
      `${computerNameKey}: Use the configured display name`,
      'records/schema.yaml',
    ),
    [],
  );
});

test('public metadata detector rejects ambiguous duplicate JSON object keys', () => {
  const account = ['build', 'operator'].join('-');
  const userNameKey = ['user', 'name'].join('');
  const escapedUserNameKey = `\\u${'0075'}sername`;
  const sshPortKey = ['s', 'sh', 'Port'].join('');

  assert.deepEqual(
    findOperationalMetadataKinds(
      `{${JSON.stringify(userNameKey)}:${JSON.stringify(account)},${JSON.stringify(
        escapedUserNameKey,
      ).replace('\\\\u', '\\u')}:"string"}`,
    ),
    ['duplicate-json-key'],
  );
  assert.deepEqual(findOperationalMetadataKinds(`{"${sshPortKey}":22,"${sshPortKey}":0}`), [
    'ssh-exposure',
    'duplicate-json-key',
  ]);
  assert.deepEqual(findOperationalMetadataKinds('{"mode":"active","mode":"disabled"}'), [
    'duplicate-json-key',
  ]);
  assert.deepEqual(findOperationalMetadataKinds('{"first":{"mode":"a"},"second":{"mode":"b"}}'), []);
});

test('public metadata detector distinguishes code expressions from concrete identity literals', () => {
  const account = ['build', 'operator'].join('-');
  const userNameKey = ['user', 'name'].join('');
  const hostNameKey = ['host', 'Name'].join('');
  const deviceNameKey = ['device', 'Name'].join('');
  for (const source of [
    `interface Account { ${userNameKey}: string; }`,
    `const options = { ${hostNameKey}: parsed.${hostNameKey} };`,
    `schema.object({ ${deviceNameKey}: validator.string() });`,
    `const a = "start"; interface Account { ${userNameKey}: string }; const b = "end";`,
    `log("prefix"); const value = { ${hostNameKey}: parsed.${hostNameKey} }; log("suffix");`,
    `const value = { ${userNameKey}: '${['build', ''].join('-')}' + operator };`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/schema.ts'), []);
  for (const [source, file] of [
    [`${userNameKey}: str`, 'src/schema.py'],
    [`${userNameKey}: string`, 'src/schema.go'],
    [`${userNameKey}: String`, 'src/schema.rs'],
    [`String ${userNameKey} = input.${userNameKey}`, 'src/Schema.java'],
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, file), []);
  assert.deepEqual(
    findOperationalMetadataKinds(`const options = { ${hostNameKey}: '${account}' };`, 'src/config.ts'),
    ['host-identity'],
  );
  assert.deepEqual(
    findOperationalMetadataKinds(`const options = { ${hostNameKey}: \`${account}\` };`, 'src/config.ts'),
    ['host-identity'],
  );
  for (const source of [
    `const audit = "${userNameKey}: ${account}";`,
    `throw new Error("${['Computer', 'Name'].join(' ')}: ${account}");`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/audit.ts'), ['host-identity']);
  assert.deepEqual(findOperationalMetadataKinds(JSON.stringify({ [userNameKey]: [account] })), [
    'host-identity',
  ]);
  assert.deepEqual(findOperationalMetadataKinds(`API input:\n${userNameKey}: string`, 'docs/api.md'), []);
  const shellHostKey = ['HOST', 'NAME'].join('');
  const shellUserKey = ['USER', 'NAME'].join('_');
  const shellAccountKey = ['LOCAL', 'ACCOUNT'].join('_');
  for (const source of [
    `${shellHostKey}=${account}`,
    `${shellUserKey}=${account}`,
    `${shellAccountKey}=${account}`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'scripts/setup.sh'), ['host-identity']);
  assert.deepEqual(findOperationalMetadataKinds(`${hostNameKey} := "${account}"`, 'cmd/main.go'), [
    'host-identity',
  ]);
  assert.deepEqual(
    findOperationalMetadataKinds(
      `// user's field\nconst options = { ${hostNameKey}: parsed.${hostNameKey} };`,
      'src/config.ts',
    ),
    [],
  );
});

test('public metadata detector distinguishes static member writes from identity reads', () => {
  const account = ['build', 'operator'].join('-');
  const userNameKey = ['user', 'Name'].join('');
  const hostKey = ['ho', 'st'].join('');
  const nameKey = ['na', 'me'].join('');
  const escapedUserNameKey = `user\\u${'004e'}ame`;
  const escapedAccount = `build\\x${'2d'}operator`;
  const javascriptLiteral = (value, escape) => JSON.stringify(value).replace(`\\\\${escape}`, `\\${escape}`);

  for (const source of [
    `profile[${JSON.stringify(userNameKey)}] = ${JSON.stringify(account)};`,
    `profile.${hostKey}.${nameKey} = ${JSON.stringify(account)};`,
    `profile[${JSON.stringify(hostKey)}][${JSON.stringify(nameKey)}] = ${JSON.stringify(account)};`,
    `profile.${hostKey}\n  .${nameKey} = ${JSON.stringify(account)};`,
    `profile[${JSON.stringify(hostKey)}]\n  [${JSON.stringify(nameKey)}] = ${JSON.stringify(account)};`,
    `profile[${javascriptLiteral(escapedUserNameKey, 'u')}] = ${JSON.stringify(account)};`,
    `profile[${JSON.stringify(userNameKey)}] = ${javascriptLiteral(escapedAccount, 'x')};`,
    `profile!.${hostKey}.${nameKey} = ${JSON.stringify(account)};`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), ['host-identity']);

  for (const source of [
    `const value = profile[${JSON.stringify(userNameKey)}];`,
    `const value = profile.${hostKey}.${nameKey};`,
    `profile[${JSON.stringify(userNameKey)}] = parsed[${JSON.stringify(userNameKey)}];`,
    `profile.${hostKey}.${nameKey} = input.${hostKey}.${nameKey};`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), []);
});

test('public metadata detector resolves only bounded literal-only code concatenations', () => {
  const account = ['build', 'operator'].join('-');
  const hostNameKey = ['host', 'name'].join('');
  const hostKey = ['ho', 'st'].join('');
  const nameKey = ['na', 'me'].join('');
  const displayKey = ['display', 'name'].join('');
  const plus = [' ', '+', ' '].join('');
  const accountExpression = [JSON.stringify('build-'), JSON.stringify('operator')].join(plus);
  const computedHost = [JSON.stringify('ho'), JSON.stringify('st')].join(plus);
  const computedName = [JSON.stringify('na'), JSON.stringify('me')].join(plus);
  const computedHostName = [JSON.stringify(hostKey), JSON.stringify(nameKey)].join(plus);
  const computedUserName = [JSON.stringify('user'), JSON.stringify('name')].join(plus);
  const escapedNameLiteral = ['"', String.fromCharCode(92), `u${'006e'}ame`, '"'].join('');
  const computedEscapedUserName = [JSON.stringify('user'), escapedNameLiteral].join(plus);

  for (const source of [
    `const profile = { ${hostNameKey}: ${accountExpression} };`,
    `const profile = { ${hostKey}: { ${nameKey}: ${accountExpression} } };`,
    `const profile = { [${computedHostName}]: ${JSON.stringify(account)} };`,
    `profile.${hostKey}.${nameKey} = ${accountExpression};`,
    `profile[${computedUserName}] = ${accountExpression};`,
    `profile[${computedEscapedUserName}] = ${accountExpression};`,
    `const profile = { ${hostNameKey}: (${accountExpression}) };`,
    `const profile = { ${hostNameKey}: ${JSON.stringify('build-')} + (${JSON.stringify('operator')}) };`,
    `profile[${computedHost}][${computedName}] = (${accountExpression});`,
    `profile.${hostKey}[${computedName}] = ${accountExpression};`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), ['host-identity'], source);

  for (const source of [
    `const profile = { ${hostNameKey}: ${JSON.stringify('build-')} + suffix };`,
    `const profile = { [${JSON.stringify(hostKey)} + key]: ${JSON.stringify(account)} };`,
    `const profile = { [${JSON.stringify(displayKey)}]: ${accountExpression} };`,
    `profile[${computedUserName}] = ${JSON.stringify('build-')} + suffix;`,
    `const profile = { ${hostNameKey}: (${JSON.stringify('build-')} + suffix) };`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), [], source);

  const overBudgetKey = Array.from({ length: 9 }, (_, index) =>
    JSON.stringify(index === 0 ? 'user' : 'x'),
  ).join(' + ');
  assert.deepEqual(
    findOperationalMetadataKinds(
      `const profile = { [${overBudgetKey}]: ${JSON.stringify(account)} };`,
      'src/profile.ts',
    ),
    ['structured-record-budget'],
  );

  const overBudgetParentheses = `${'('.repeat(9)}${accountExpression}${')'.repeat(9)}`;
  assert.deepEqual(
    findOperationalMetadataKinds(
      `const profile = { ${hostNameKey}: ${overBudgetParentheses} };`,
      'src/profile.ts',
    ),
    ['structured-record-budget'],
  );
});

test('public metadata detector fails closed within bounded time for excessive static member chains', () => {
  const source = `profile${'.member'.repeat(2_000)} = "build-" + "operator";`;
  const startedAt = performance.now();

  const kinds = findOperationalMetadataKinds(source, 'src/profile.ts');
  const durationMs = performance.now() - startedAt;

  assert.deepEqual(kinds, ['structured-record-budget']);
  assert.ok(durationMs < 1_000, `static member-chain scan took ${durationMs.toFixed(1)}ms`);
});

test('public metadata detector preserves later identity findings after a bounded parse is exhausted', () => {
  const overBudgetExpression = `${'('.repeat(9)}"placeholder"${')'.repeat(9)}`;
  const account = ['build', 'operator'].join('-');
  const source = [
    `const username = ${overBudgetExpression};`,
    `profile.hostname = ${JSON.stringify(account)};`,
  ].join('\n');

  assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), [
    'host-identity',
    'structured-record-budget',
  ]);
});

test('public metadata detector inspects one bounded encoded structured layer', () => {
  const account = ['build', 'operator'].join('-');
  const userNameKey = ['user', 'name'].join('');
  const remoteLoginKey = ['remote', 'Login'].join('');
  const environmentKey = ['environ', 'ment'].join('');
  const nodeVersionKey = ['node', 'Version'].join('');
  const localScope = ['lo', 'cal'].join('');
  const hostVersion = ['24', '2', '0'].join('.');
  const hostRecord = JSON.stringify({ [userNameKey]: account });
  const sshRecord = JSON.stringify({ [remoteLoginKey]: true });
  const packageRecord = JSON.stringify({ [environmentKey]: localScope, [nodeVersionKey]: hostVersion });
  assert.deepEqual(findOperationalMetadataKinds(JSON.stringify(hostRecord)), ['host-identity']);
  assert.deepEqual(findOperationalMetadataKinds(`payload=${JSON.stringify(hostRecord)}`), ['host-identity']);
  assert.deepEqual(findOperationalMetadataKinds(JSON.stringify(sshRecord)), ['ssh-exposure']);
  assert.deepEqual(findOperationalMetadataKinds(JSON.stringify(packageRecord)), ['host-package-version']);
});

test('public metadata detector iteratively inspects bounded JSON string wrappers', () => {
  const account = ['build', 'operator'].join('-');
  const userNameKey = ['user', 'name'].join('');
  const hostRecord = JSON.stringify({ [userNameKey]: account });
  let encoded = hostRecord;
  for (let depth = 0; depth < 8; depth++) {
    encoded = JSON.stringify(encoded);
    assert.deepEqual(findOperationalMetadataKinds(encoded), ['host-identity'], `depth ${depth + 1}`);
  }

  encoded = JSON.stringify(encoded);
  assert.ok(findOperationalMetadataKinds(encoded).includes('structured-record-budget'));

  encoded = hostRecord;
  for (let depth = 0; depth < 8; depth++) {
    encoded = JSON.stringify(encoded);
    assert.deepEqual(
      findOperationalMetadataKinds(`payload=${encoded}`, 'records/output.txt'),
      ['host-identity'],
      `embedded depth ${depth + 1}`,
    );
  }
  encoded = JSON.stringify(encoded);
  assert.ok(
    findOperationalMetadataKinds(`payload=${encoded}`, 'records/output.txt').includes(
      'structured-record-budget',
    ),
  );

  assert.deepEqual(
    findOperationalMetadataKinds(
      JSON.stringify({ payload: JSON.stringify(hostRecord) }),
      'records/output.json',
    ),
    ['host-identity'],
  );
});

test('public metadata detector fails closed on oversized helpers and broad structured arrays', () => {
  assert.deepEqual(findOperationalMetadataKinds('x'.repeat(2 * 1024 * 1024 + 1)), [
    'structured-record-budget',
  ]);
  assert.deepEqual(findOperationalMetadataKinds(JSON.stringify(Array(10_001).fill(0))), [
    'structured-record-budget',
  ]);
});

test('public metadata detector recognizes structured SSH exposure and case-insensitive fingerprints', () => {
  const remoteLoginKey = ['remote', 'Login'].join('');
  const sshEnabledKey = [['s', 'sh'].join(''), 'enabled'].join('_');
  const sshPortKey = ['s', 'sh', 'Port'].join('');
  const daemon = ['s', 'shd'].join('');
  const fingerprint = `${['s', 'ha', '256'].join('')}:${'C'.repeat(43)}`;
  for (const record of [
    JSON.stringify({ [remoteLoginKey]: true }),
    `${sshEnabledKey}: true`,
    JSON.stringify({ [sshPortKey]: 22 }),
    `${daemon} enabled and listening on port 22`,
    JSON.stringify({ [['s', 'sh'].join('')]: { enabled: true, port: 22 } }),
    JSON.stringify({ [['s', 'sh'].join('')]: { enabled: true, port: 22 } }, null, 2),
  ])
    assert.deepEqual(findOperationalMetadataKinds(record), ['ssh-exposure'], record);
  assert.deepEqual(findOperationalMetadataKinds(fingerprint), ['ssh-fingerprint']);
});

test('public metadata detector recognizes structured access inventories and endpoint reachability', () => {
  const sshKey = ['s', 'sh'].join('');
  const authorizedKeysKey = ['authorized', 'Keys'].join('');
  const authorizedKeyCountKey = ['authorized', 'Key', 'Count'].join('');
  const listenerAddressKey = ['listen', 'Address'].join('');
  const listenerAliasKey = [['s', 'sh'].join(''), 'listener', 'address'].join('_');
  const listeningKey = ['listen', 'ing'].join('');
  const bindKey = ['b', 'ind'].join('');
  const privateListener = ['0', '0', '0', '0', '22'].join('.').replace(/\.22$/, ':22');
  const ipv6Listener = `[${Array(3).fill('').join(':')}]:22`;
  const ipv6Any = Array(3).fill('').join(':');
  const ipv6Loopback = `${ipv6Any}1`;
  const ipv6LinkLocal = ['fe80', '', '1'].join(':');
  for (const record of [
    JSON.stringify({ [authorizedKeysKey]: 1 }),
    JSON.stringify({ [authorizedKeyCountKey]: 1 }),
    JSON.stringify({ [sshKey]: { [authorizedKeysKey]: ['present'] } }),
    JSON.stringify({ [sshKey]: { [listenerAddressKey]: privateListener } }),
    `${listenerAliasKey}: ${privateListener}`,
    JSON.stringify({ [sshKey]: { [bindKey]: '0.0.0.0', port: 22 } }),
    JSON.stringify({ [sshKey]: { [listeningKey]: true } }),
    JSON.stringify({ [sshKey]: { policy: { source: 'public' }, enabled: true } }),
    JSON.stringify({ [sshKey]: { policy: { source: 'public' }, port: 2222 } }),
    JSON.stringify({ [sshKey]: { [listenerAddressKey]: ipv6Listener } }),
    JSON.stringify({ [sshKey]: { [listenerAddressKey]: ipv6Any } }),
    JSON.stringify({ [sshKey]: { [listenerAddressKey]: ipv6Loopback } }),
    JSON.stringify({ [sshKey]: { [listenerAddressKey]: ipv6LinkLocal } }),
    `${listenerAliasKey}: ${ipv6Any}`,
    JSON.stringify({ [[sshKey, 'Port'].join('')]: 2222 }),
    JSON.stringify({ [[sshKey, 'Status'].join('')]: 'enabled' }),
    JSON.stringify({ [['remote', 'Login', 'Status'].join('')]: 'enabled' }),
  ])
    assert.deepEqual(findOperationalMetadataKinds(record), ['ssh-exposure'], record);
});

test('public metadata detector applies one semantic validator to textual listener endpoints', () => {
  const sshKey = ['s', 'sh'].join('');
  const listenerKey = [['s', 'sh'].join(''), 'Listener', 'Address'].join('');
  const nestedListenerKey = ['listener', 'Address'].join('');
  const bindKey = ['b', 'ind'].join('');
  const zone = ['e', 'n', '0'].join('');
  const validEndpoint = `[${['fe80', '', '1'].join(':')}%${zone}]:22`;
  const invalidEndpoints = [
    `[${':'.repeat(4)}]:22`,
    `[${Array(3).fill('').join(':')}]:0`,
    `${['999', '999', '999', '999'].join('.')}:22`,
    `${['127', '0', '0', '1'].join('.')}%eth0`,
    `[${['127', '0', '0', '1'].join('.')}%eth0]:22`,
    `${['fe80', '', '1'].join(':')}%en%30`,
    String.fromCharCode(10),
  ];

  assert.deepEqual(
    findOperationalMetadataKinds(
      `const ${listenerKey} = ${JSON.stringify(validEndpoint)};`,
      'src/profile.ts',
    ),
    ['ssh-exposure'],
  );
  for (const source of [
    `profile.${sshKey}.${nestedListenerKey} = ${JSON.stringify(validEndpoint)};`,
    `profile[${JSON.stringify(sshKey)}][${JSON.stringify(bindKey)}] = ${JSON.stringify('0.0.0.0:22')};`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), ['ssh-exposure']);
  for (const endpoint of invalidEndpoints) {
    assert.deepEqual(
      findOperationalMetadataKinds(`const ${listenerKey} = ${JSON.stringify(endpoint)};`, 'src/profile.ts'),
      [],
    );
    assert.deepEqual(
      findOperationalMetadataKinds(
        `profile.${sshKey}.${nestedListenerKey} = ${JSON.stringify(endpoint)};`,
        'src/profile.ts',
      ),
      [],
    );
    assert.deepEqual(
      findOperationalMetadataKinds(`${listenerKey}: ${JSON.stringify(endpoint)}`, 'records/profile.yaml'),
      [],
    );
  }
});

test('public metadata detector applies one semantic validator to configured SSH ports', () => {
  const sshKey = ['s', 'sh'].join('');
  const sshPortKey = [sshKey, 'Port'].join('');
  const portKey = ['po', 'rt'].join('');
  for (const source of [
    `const ${sshPortKey} = 22;`,
    `const profile = { ${sshKey}: { ${portKey}: 2222 } };`,
    `profile.${sshKey}.${portKey} = 2222;`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(source, 'src/profile.ts'), ['ssh-exposure']);

  for (const invalidPort of [0, 65_536, 99_999]) {
    for (const [source, file] of [
      [`const ${sshPortKey} = ${invalidPort};`, 'src/profile.ts'],
      [`const profile = { ${sshKey}: { ${portKey}: ${invalidPort} } };`, 'src/profile.ts'],
      [`profile.${sshKey}.${portKey} = ${invalidPort};`, 'src/profile.ts'],
      [`${sshPortKey}: ${invalidPort}`, 'records/profile.yaml'],
    ])
      assert.deepEqual(findOperationalMetadataKinds(source, file), [], source);
  }
});

test('public metadata detector recognizes nested YAML identity and access records', () => {
  const account = ['build', 'operator'].join('-');
  const hostKey = ['ho', 'st'].join('');
  const nameKey = ['na', 'me'].join('');
  const sshKey = ['s', 'sh'].join('');
  const enabledKey = ['ena', 'bled'].join('');
  const portKey = ['po', 'rt'].join('');
  const listenerKey = ['listen', 'Address'].join('');
  const enabledValue = ['tr', 'ue'].join('');
  const portValue = ['2', '2'].join('');
  const ipv6Any = Array(3).fill('').join(':');

  for (const record of [
    `${hostKey}:\n  ${nameKey}: ${account}`,
    `'${hostKey}':\n  '${nameKey}': '${account}'`,
    `${hostKey}:\n  - ${nameKey}: ${account}`,
    `${hostKey}: &${['ma', 'chine'].join('')}\n  ${nameKey}: ${account}`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(record, 'records/profile.yaml'), ['host-identity']);

  for (const record of [
    `${sshKey}:\n  ${enabledKey}: ${enabledValue}`,
    `${sshKey}:\n  ${portKey}: ${portValue}`,
    `${sshKey}:\n  ${listenerKey}: ${ipv6Any}`,
    `${sshKey}:\n  - ${enabledKey}: ${enabledValue}`,
    `${sshKey}: &${['rem', 'ote'].join('')}\n  ${enabledKey}: ${enabledValue}`,
    `${sshKey}: !!${['m', 'ap'].join('')}\n  ${enabledKey}: ${enabledValue}`,
    `${['def', 'aults'].join('')}: &${['rem', 'ote'].join('')}\n  ${enabledKey}: ${enabledValue}\n${sshKey}:\n  <<: *${['rem', 'ote'].join('')}`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(record, 'records/profile.yaml'), ['ssh-exposure']);

  for (const record of [
    `${sshKey}: [{ ${enabledKey}: true }]`,
    `${sshKey}:\n  ${['con', 'fig'].join('')}: [{ ${portKey}: 22 }]`,
    `${hostKey}: [{ ${nameKey}: ${account} }]`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(record, 'records/profile.yaml'), [
      'structured-record-budget',
    ]);

  assert.deepEqual(
    findOperationalMetadataKinds(
      `${hostKey}:\n  ${nameKey}: string\n${sshKey}:\n  ${enabledKey}: false\n  ${portKey}: 0`,
      'records/schema.yaml',
    ),
    [],
  );
  for (const record of [
    `- ${sshKey}:\n    ${enabledKey}: false\n  ${['fea', 'ture'].join('')}:\n    ${enabledKey}: true`,
    `- ${hostKey}:\n    ${nameKey}: string\n  ${['ser', 'vice'].join('')}:\n    ${nameKey}: public-api`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(record, 'records/schema.yaml'), [], record);
});

test('public metadata detector fails closed on sensitive YAML scalar ambiguity and decodes quoted keys', () => {
  const account = ['build', 'operator'].join('-');
  const userNameKey = ['user', 'name'].join('');
  const sshPortKey = ['s', 'sh', 'Port'].join('');
  const escapedUserNameKey = `user\\u${'006e'}ame`;

  assert.deepEqual(
    findOperationalMetadataKinds(`"${escapedUserNameKey}": ${account}`, 'records/profile.yaml'),
    ['host-identity'],
  );
  assert.deepEqual(findOperationalMetadataKinds(`'user''name': ${account}`, 'records/profile.yaml'), [
    'host-identity',
  ]);

  for (const record of [
    `${userNameKey}: |\n  ${account}`,
    `${userNameKey}: >-\n  ${account}`,
    `${userNameKey}: *account`,
    `${userNameKey}: &account ${account}`,
    `${userNameKey}: !!str ${account}`,
    `${sshPortKey}: *port`,
    `defaults: &account ${account}\n${userNameKey}: [*account]`,
    `${userNameKey}: !<tag:yaml.org,2002:str> ${account}`,
    `${userNameKey}: *account/name`,
  ])
    assert.deepEqual(
      findOperationalMetadataKinds(record, 'records/profile.yaml'),
      ['structured-record-budget'],
      record,
    );
});

test('public metadata detector recognizes raw access keys and legacy fingerprints', () => {
  const keyType = [['s', 'sh'].join(''), 'ed25519'].join('-');
  const rawKey = `${keyType} ${'A'.repeat(68)} public-comment`;
  const fingerprint = `${['M', 'D', '5'].join('')}:${Array.from({ length: 16 }, () => 'ab').join(':')}`;
  const tcpPort = ['TCP', '22'].join('/');
  const reachable = ['reach', 'able'].join('');
  assert.deepEqual(findOperationalMetadataKinds(rawKey), ['ssh-public-key']);
  assert.deepEqual(findOperationalMetadataKinds(fingerprint), ['ssh-fingerprint']);
  assert.deepEqual(
    findOperationalMetadataKinds(
      JSON.stringify({ notes: [`User name: ${['release', 'operator'].join('-')}`] }),
    ),
    ['host-identity'],
  );
  assert.deepEqual(
    findOperationalMetadataKinds(
      JSON.stringify([`${['S', 'SH listener'].join('')}: ${tcpPort} ${reachable}`]),
    ),
    ['ssh-exposure'],
  );
});

test('public metadata detector recognizes the fixed OpenSSH certificate key algorithms', () => {
  const protocol = ['s', 'sh'].join('');
  const domain = ['open', 'ssh.com'].join('');
  const certificateAlgorithm = (base) => `${[base, 'cert', 'v01'].join('-')}@${domain}`;
  const algorithms = [
    certificateAlgorithm([protocol, 'rsa'].join('-')),
    certificateAlgorithm([protocol, 'dss'].join('-')),
    ...['256', '384', '521'].map((size) => certificateAlgorithm(['ecdsa', 'sha2', `nistp${size}`].join('-'))),
    certificateAlgorithm([protocol, 'ed25519'].join('-')),
    certificateAlgorithm(['sk', protocol, 'ed25519'].join('-')),
    certificateAlgorithm(['sk', 'ecdsa', 'sha2', 'nistp256'].join('-')),
  ];
  for (const algorithm of algorithms)
    assert.deepEqual(findOperationalMetadataKinds(`${algorithm} ${'A'.repeat(68)} comment`), [
      'ssh-public-key',
    ]);

  const unsupported = certificateAlgorithm([protocol, 'future'].join('-'));
  assert.deepEqual(findOperationalMetadataKinds(`${unsupported} ${'A'.repeat(68)} comment`), []);
  for (const prefixed of [
    ['foo', algorithms[0]].join('-'),
    ['not', algorithms[2]].join('-'),
    `x${algorithms.at(-2)}`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(`${prefixed} ${'A'.repeat(68)} comment`), []);
});

test('public metadata detector keeps unrelated and disabled structured records separate', () => {
  const hostKey = ['ho', 'st'].join('');
  const typeKey = ['ty', 'pe'].join('');
  const serviceKey = ['ser', 'vice'].join('');
  const nameKey = ['na', 'me'].join('');
  const sshKey = ['s', 'sh'].join('');
  const enabledKey = ['ena', 'bled'].join('');
  const serverKey = ['ser', 'ver'].join('');
  const portKey = ['po', 'rt'].join('');
  const featureKey = ['fea', 'ture'].join('');
  const listenerKey = [sshKey, 'Listener', 'Address'].join('');
  for (const record of [
    JSON.stringify({
      [hostKey]: { [typeKey]: 'proxy' },
      [serviceKey]: { [nameKey]: 'public-api' },
    }),
    JSON.stringify({ [sshKey]: { [enabledKey]: false }, [serverKey]: { [portKey]: 22 } }),
    JSON.stringify({ [sshKey]: { [enabledKey]: false }, [featureKey]: { [enabledKey]: true } }),
    JSON.stringify({ [listenerKey]: null }),
    JSON.stringify({ [listenerKey]: 'disabled' }),
    JSON.stringify({ [['authorized', 'Keys'].join('')]: null }),
    JSON.stringify({ [['authorized', 'Keys'].join('')]: false }),
    JSON.stringify({ [['authorized', 'Key', 'Count'].join('')]: 0 }),
    JSON.stringify({ [['authorized', 'Keys'].join('')]: [] }),
  ])
    assert.deepEqual(findOperationalMetadataKinds(record), [], record);
});

test('public metadata detector rejects an exact package version tied to a local host', () => {
  const hostVersion = ['24', '2', '0'].join('.');
  const packageManagerVersion = ['11', '3', '0'].join('.');

  for (const profile of [
    `Node installed on this Mac is ${hostVersion}`,
    `Local Node ${hostVersion} and npm ${packageManagerVersion} are below the required versions`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(profile), ['host-package-version']);
});

test('public metadata detector recognizes structured local-host package versions', () => {
  const hostVersion = ['24', '2', '0'].join('.');
  const packageManagerVersion = ['11', '3', '0'].join('.');
  const environmentKey = ['environ', 'ment'].join('');
  const scopeKey = ['sco', 'pe'].join('');
  const localHost = ['local', 'host'].join(' ');
  const localScope = ['lo', 'cal'].join('');
  const thisMachineScope = ['this', 'machine'].join(' ');
  const nodeVersionKey = ['node', 'Version'].join('');
  const localNodeVersionKey = ['local', 'node', 'version'].join('_');
  const thisHostNpmVersionKey = ['this', 'Host', 'Npm', 'Version'].join('');
  for (const record of [
    JSON.stringify({ [environmentKey]: localHost, [nodeVersionKey]: hostVersion }),
    JSON.stringify({ [environmentKey]: localHost, [nodeVersionKey]: hostVersion }, null, 2),
    JSON.stringify({ [environmentKey]: localScope, [nodeVersionKey]: hostVersion }, null, 2),
    JSON.stringify({ [scopeKey]: thisMachineScope, [nodeVersionKey]: hostVersion }, null, 2),
    `${environmentKey}: ${localHost}\n${['node', 'version'].join('_')}: ${hostVersion}`,
    `${localNodeVersionKey}: ${hostVersion}`,
    `${thisHostNpmVersionKey}: ${packageManagerVersion}`,
  ])
    assert.deepEqual(findOperationalMetadataKinds(record), ['host-package-version']);

  assert.deepEqual(
    findOperationalMetadataKinds(`${['this', 'machine'].join('_')}\n${nodeVersionKey}: ${hostVersion}`),
    [],
  );
});

test('public metadata detector permits a minimized non-identifying disposition', () => {
  assert.deepEqual(
    findOperationalMetadataKinds(
      'The experimental remote-access workstream was cancelled. No endpoint, account, key, or host profile is published.',
    ),
    [],
  );
  const localDevelopment = ['local', 'development'].join(' ');
  const hostVersion = ['20', '11', '1'].join('.');
  assert.deepEqual(
    findOperationalMetadataKinds(`For ${localDevelopment}, Node version ${hostVersion} is required.`),
    [],
  );
});

test('workspace scan fails closed without echoing operational values', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await mkdir(join(root, 'docs'), { recursive: true });
  const privateAddress = ['10', '44', '2', '7'].join('.');
  const homePath = ['', 'Users', 'operator', 'workspace'].join('/');
  const remoteAccess = [['Remote', 'Login'].join(' '), ['TCP', '22'].join('/'), 'enabled'].join(' and ');
  const accountRecord = `Username: ${['oper', 'ator'].join('')}`;
  await writeFile(
    join(root, 'docs/host.md'),
    `${accountRecord}\nPath: ${homePath}\nLAN: ${privateAddress}\n${remoteAccess}\n`,
  );
  execFileSync('git', ['add', 'docs/host.md'], { cwd: root });

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      assert.match(error.message, /docs\/host\.md/);
      assert.doesNotMatch(error.message, new RegExp(`${privateAddress}|${homePath}`));
      return true;
    },
  );
});

test('workspace scan rejects a host profile split across related public records', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-metadata-split-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await mkdir(join(root, 'docs/management/host'), { recursive: true });
  const privateAddress = ['172', '20', '4', '9'].join('.');
  const homePath = ['', 'Users', 'release-operator', 'workspace'].join('/');
  const accountValue = ['release', 'operator'].join('-');
  const remoteAccess = [
    ['Remote', 'Login'].join(' '),
    ['TCP', '22'].join('/'),
    ['authorized', 'keys'].join('_'),
  ].join(' enabled; ');
  await Promise.all([
    writeFile(join(root, 'docs/management/host/account.md'), `Local account: ${accountValue}\n${homePath}\n`),
    writeFile(join(root, 'docs/management/host/network.md'), `LAN: ${privateAddress}\n`),
    writeFile(join(root, 'docs/management/host/access.md'), `${remoteAccess} contains one entry\n`),
  ]);
  execFileSync('git', ['add', 'docs/management/host'], { cwd: root });

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      assert.match(error.message, /account\.md/);
      assert.match(error.message, /network\.md/);
      assert.match(error.message, /access\.md/);
      assert.doesNotMatch(error.message, new RegExp(`${privateAddress}|${homePath}|release-operator`));
      return true;
    },
  );
});

test('workspace scan rejects workstation and remote-access profiles at their minimal combinations', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-profile-combinations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await Promise.all([
    mkdir(join(root, 'docs/workstation'), { recursive: true }),
    mkdir(join(root, 'records/remote'), { recursive: true }),
  ]);
  const workstationAddress = ['172', '21', '5', '7'].join('.');
  const remoteAddress = ['10', '45', '3', '8'].join('.');
  const homePath = ['', 'Users', 'build-operator', 'workspace'].join('/');
  const accountValue = ['build', 'operator'].join('-');
  const remoteListener = `${['S', 'SH listener'].join('')}: ${['TCP', '22'].join('/')} reachable`;
  await Promise.all([
    writeFile(
      join(root, 'docs/workstation/profile.md'),
      `Local account: ${accountValue}\nPath: ${homePath}\nLAN: ${workstationAddress}\n`,
    ),
    writeFile(
      join(root, 'records/remote/profile.md'),
      `Private address: ${remoteAddress}\n${remoteListener}\n`,
    ),
  ]);
  execFileSync('git', ['add', 'docs', 'records'], { cwd: root });

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      assert.match(error.message, /docs\/workstation\/profile\.md/);
      assert.match(error.message, /records\/remote\/profile\.md/);
      assert.doesNotMatch(error.message, new RegExp(`${workstationAddress}|${remoteAddress}|${homePath}`));
      return true;
    },
  );
});

test('workspace scan rejects a standalone exact host-package version without echoing it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-host-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await mkdir(join(root, 'docs'), { recursive: true });
  const hostVersion = ['24', '2', '0'].join('.');
  await writeFile(join(root, 'docs/host.md'), `Node installed on this Mac is ${hostVersion}\n`);
  execFileSync('git', ['add', 'docs/host.md'], { cwd: root });

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      assert.match(error.message, /docs\/host\.md: host-package-version/);
      assert.doesNotMatch(error.message, new RegExp(hostVersion.replaceAll('.', '\\.')));
      return true;
    },
  );
});

test('workspace scan fails closed for NUL bytes in every repository file extension', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-nul-text-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await Promise.all([
    mkdir(join(root, 'docs'), { recursive: true }),
    mkdir(join(root, 'src'), { recursive: true }),
  ]);
  const hostVersion = ['24', '2', '0'].join('.');
  const nulPayload = Buffer.from(`public preface\0Node installed on this Mac is ${hostVersion}\n`);
  await Promise.all([
    writeFile(join(root, 'docs/host.md'), nulPayload),
    writeFile(join(root, 'src/host.js'), nulPayload),
  ]);
  execFileSync('git', ['add', 'docs/host.md', 'src/host.js'], { cwd: root });

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      assert.match(error.message, /docs\/host\.md: file-contains-nul/);
      assert.match(error.message, /src\/host\.js: file-contains-nul/);
      assert.doesNotMatch(error.message, new RegExp(hostVersion.replaceAll('.', '\\.')));
      return true;
    },
  );
});

test('workspace scan fails closed when the bounded total text budget is exceeded', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-total-budget-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await mkdir(join(root, 'records'), { recursive: true });
  const payload = 'x'.repeat(1024 * 1024);
  await Promise.all(
    Array.from({ length: 9 }, (_, index) =>
      writeFile(join(root, 'records', `bounded-${index}.txt`), payload),
    ),
  );

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      assert.match(error.message, /total-text-budget-exceeded/);
      assert.doesNotMatch(error.message, /x{128}/);
      return true;
    },
  );
});

test('workspace scan rejects every standalone prohibited operational metadata kind', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-metadata-standalone-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await Promise.all([
    mkdir(join(root, 'accounts'), { recursive: true }),
    mkdir(join(root, 'network'), { recursive: true }),
    mkdir(join(root, 'keys'), { recursive: true }),
    mkdir(join(root, 'access'), { recursive: true }),
  ]);
  const account = ['release', 'operator'].join('-');
  const privateAddress = ['10', '45', '3', '8'].join('.');
  const fingerprint = `${'SHA' + '256'}:${'B'.repeat(43)}`;
  const listener = `${['S', 'SH listener'].join('')}: ${['TCP', '22'].join('/')} reachable`;
  await Promise.all([
    writeFile(join(root, 'accounts', 'identity.md'), `Local account: ${account}\n`),
    writeFile(join(root, 'network', 'address.md'), `Private address: ${privateAddress}\n`),
    writeFile(join(root, 'keys', 'fingerprint.md'), `Authorized client fingerprint: ${fingerprint}\n`),
    writeFile(join(root, 'access', 'listener.md'), `${listener}\n`),
  ]);
  execFileSync('git', ['add', 'accounts', 'network', 'keys', 'access'], { cwd: root });

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      for (const path of [
        'accounts/identity.md',
        'network/address.md',
        'keys/fingerprint.md',
        'access/listener.md',
      ])
        assert.match(error.message, new RegExp(path.replace('/', '\\/')));
      assert.doesNotMatch(error.message, new RegExp(`${account}|${privateAddress}|${fingerprint}`));
      return true;
    },
  );
});

test('workspace scan rejects standalone host identity in JSON and quoted YAML records', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-metadata-structured-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await mkdir(join(root, 'records'), { recursive: true });
  const account = ['release', 'operator'].join('-');
  const userNameKey = ['user', 'name'].join('');
  const localAccountKey = ['local', 'account'].join(' ');
  await Promise.all([
    writeFile(join(root, 'records', 'identity.json'), JSON.stringify({ [userNameKey]: account })),
    writeFile(join(root, 'records', 'identity.yaml'), `'${localAccountKey}': ${account}\n`),
  ]);
  execFileSync('git', ['add', 'records/identity.json', 'records/identity.yaml'], { cwd: root });

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      assert.match(error.message, /records\/identity\.json: host-identity/);
      assert.match(error.message, /records\/identity\.yaml: host-identity/);
      assert.doesNotMatch(error.message, new RegExp(account));
      return true;
    },
  );
});

test('workspace scan rejects a tracked dangling symlink without exposing its target', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-public-metadata-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initializeRepository(root);
  await mkdir(join(root, 'docs'), { recursive: true });
  const target = ['', 'Users', 'private-operator', 'missing-audit.md'].join('/');
  await symlink(target, join(root, 'docs', 'audit-link'));
  execFileSync('git', ['add', 'docs/audit-link'], { cwd: root });

  await assert.rejects(
    () => scanPublicMetadata(root),
    (error) => {
      assert.match(error.message, /docs\/audit-link: symbolic-link-not-allowed/);
      assert.doesNotMatch(error.message, new RegExp(target.replaceAll('/', '\\/')));
      return true;
    },
  );
});

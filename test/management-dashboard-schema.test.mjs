import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  CHECK_STATUSES,
  TASK_STATUSES,
  validateCheckReport,
  validateDashboardSnapshot,
} from '../tools/management-dashboard/schema.mjs';
import { redactValue, sanitizeLog } from '../tools/management-dashboard/redact.mjs';

const observedAt = '2026-09-08T22:19:53.000Z';
const source = 'planning/roadmap.json';

function section(status = 'READY') {
  return { status, source, observedAt };
}

function validSnapshot() {
  return {
    schemaVersion: 1,
    generatedAt: observedAt,
    generatorVersion: '1.0.0',
    generated: {
      doNotEdit: true,
      command: 'npm run management:build',
      source: 'tools/build-management-dashboard.mjs',
    },
    project: { ...section(), name: 'QuantPass', branch: 'macbeth/dashboard' },
    integration: section('BLOCKED'),
    workers: [
      { id: 'worker-a', ...section('NOT_AVAILABLE') },
      { id: 'worker-b', ...section('READY') },
    ],
    tasks: [{ id: 'SUPPLY-001', title: 'Supply chain', ...section('IN_PROGRESS') }],
    decisions: { ...section('NOT_AVAILABLE'), items: [] },
    management: {
      currentStatus: { ...section(), data: { text: 'Current status' } },
      workQueue: { ...section(), data: { text: 'Work queue' } },
      changelog: { ...section(), data: { text: 'Changelog' } },
    },
    security: {
      ...section('BLOCKED'),
      counts: { critical: 15, high: 7, medium: 0, low: 0 },
      findings: [
        {
          id: 'R-001',
          title: 'Trust root replacement',
          severity: 'critical',
          status: 'open',
          owner: 'security-architecture',
          component: ['TB-09'],
          attackPath: 'Untrusted configuration replaces the trust root.',
          mitigation: ['TRUST-001'],
          task: ['TRUST-001'],
          evidence: 'Negative configuration tests',
          residualRisk: 'Compromised release pipeline',
        },
      ],
    },
    tests: {
      ...section('NOT_RUN'),
      items: [{ id: 'lint', status: 'NOT_RUN', source: '.checks/management/latest.json', observedAt }],
    },
    git: section(),
    build: section('NOT_RUN'),
    hackathon: section('PARTIAL'),
    network: section('BLOCKED'),
    host: {
      ...section('NOT_AVAILABLE'),
      summary: 'Host evidence is unavailable.',
      links: [],
    },
    knownIssues: [],
    blockers: [],
    links: [],
    sourceHealth: [],
    dashboardLog: [],
  };
}

test('dashboard schema accepts a complete snapshot and closed status vocabulary', () => {
  const snapshot = validSnapshot();
  assert.equal(validateDashboardSnapshot(snapshot), snapshot);
  assert.deepEqual(TASK_STATUSES, [
    'DONE',
    'VERIFIED_DONE',
    'PARTIAL',
    'IN_PROGRESS',
    'READY',
    'BLOCKED',
    'NOT_STARTED',
    'NOT_AVAILABLE',
    'DATA_SOURCE_ERROR',
  ]);
  assert.deepEqual(CHECK_STATUSES, [
    'PASS',
    'FAIL',
    'NOT_RUN',
    'BLOCKED',
    'NOT_AVAILABLE',
    'DATA_SOURCE_ERROR',
  ]);
});

test('dashboard schema rejects unknown states and impossible timestamps', () => {
  const unknown = validSnapshot();
  unknown.tasks[0].status = 'ALL_GREEN';
  assert.throws(() => validateDashboardSnapshot(unknown), /unknown task status/i);

  const impossible = validSnapshot();
  impossible.generatedAt = '2026-99-99T25:99:99Z';
  assert.throws(() => validateDashboardSnapshot(impossible), /generatedAt.*ISO/i);

  const normalizedByRuntime = validSnapshot();
  normalizedByRuntime.generatedAt = '2026-02-30T12:00:00.000Z';
  assert.throws(() => validateDashboardSnapshot(normalizedByRuntime), /generatedAt.*ISO/i);
});

test('dashboard schema requires the two fixed Worker identities exactly once', () => {
  const missing = validSnapshot();
  missing.workers = missing.workers.filter((worker) => worker.id !== 'worker-a');
  assert.throws(() => validateDashboardSnapshot(missing), /workers.*worker-a.*worker-b/i);

  const duplicate = validSnapshot();
  duplicate.workers[1].id = 'worker-a';
  assert.throws(() => validateDashboardSnapshot(duplicate), /workers.*worker-a.*worker-b/i);
});

test('dashboard schema requires every management source consumed by the UI', () => {
  const missingManagement = validSnapshot();
  delete missingManagement.management;
  assert.throws(() => validateDashboardSnapshot(missingManagement), /management.*object/i);

  const missingWorkQueue = validSnapshot();
  delete missingWorkQueue.management.workQueue;
  assert.throws(() => validateDashboardSnapshot(missingWorkQueue), /management\.workQueue.*object/i);

  const malformedCurrentStatus = validSnapshot();
  malformedCurrentStatus.management.currentStatus.status = 'ALL_GREEN';
  assert.throws(
    () => validateDashboardSnapshot(malformedCurrentStatus),
    /management\.currentStatus.*unknown task status/i,
  );
});

test('dashboard schema requires the host section and an iterable host link list', () => {
  const missingHost = validSnapshot();
  delete missingHost.host;
  assert.throws(() => validateDashboardSnapshot(missingHost), /host.*object/i);

  const malformedLinks = validSnapshot();
  malformedLinks.host.links = 'docs/management/host/HOST-SETUP.md';
  assert.throws(() => validateDashboardSnapshot(malformedLinks), /host\.links.*array/i);

  const malformedLink = validSnapshot();
  malformedLink.host.links = [null];
  assert.throws(() => validateDashboardSnapshot(malformedLink), /host\.links\[0\].*object/i);
});

test('dashboard schema rejects an unknown security finding severity', () => {
  const snapshot = validSnapshot();
  snapshot.security.findings[0].severity = 'urgent';
  assert.throws(() => validateDashboardSnapshot(snapshot), /security\.findings\[0\]\.severity.*unknown/i);
});

test('dashboard schema rejects malformed source, link, and diagnostic records consumed by the UI', () => {
  const sourceRecord = validSnapshot();
  sourceRecord.sourceHealth = [{ status: 'ALL_GREEN', source, observedAt }];
  assert.throws(() => validateDashboardSnapshot(sourceRecord), /sourceHealth.*unknown task status/i);

  const linkRecord = validSnapshot();
  linkRecord.links = [
    { status: 'READY', source, observedAt, path: '../outside', label: 'outside', kind: 'project' },
  ];
  assert.throws(() => validateDashboardSnapshot(linkRecord), /links.*path/i);

  const diagnostic = validSnapshot();
  diagnostic.dashboardLog = [{ level: 'verbose', code: 'TEST', source }];
  assert.throws(() => validateDashboardSnapshot(diagnostic), /dashboardLog.*level/i);
});

test('dashboard schema rejects a passing check without commit-bound evidence', () => {
  const snapshot = validSnapshot();
  snapshot.tests.items[0] = {
    id: 'lint',
    status: 'PASS',
    source: '.checks/management/latest.json',
    observedAt,
  };
  assert.throws(() => validateDashboardSnapshot(snapshot), /PASS.*commit.*evidence/i);
});

test('check report requires terminal records and matching completed state', () => {
  const report = {
    schemaVersion: 1,
    complete: true,
    branch: 'macbeth/dashboard',
    commit: '1111111111111111111111111111111111111111',
    tree: '2222222222222222222222222222222222222222',
    startedAt: observedAt,
    finishedAt: observedAt,
    checks: [
      {
        id: 'lint',
        status: 'PASS',
        startedAt: observedAt,
        finishedAt: observedAt,
        durationMs: 8,
        exitCode: 0,
        evidence: '.checks/management/run/lint.log',
      },
    ],
  };
  assert.equal(validateCheckReport(report), report);

  const incomplete = structuredClone(report);
  incomplete.complete = false;
  assert.throws(() => validateCheckReport(incomplete), /complete.*true/i);

  const falsePass = structuredClone(report);
  falsePass.checks[0].exitCode = 1;
  assert.throws(() => validateCheckReport(falsePass), /PASS.*exitCode.*0/i);

  const missingTree = structuredClone(report);
  delete missingTree.tree;
  assert.throws(() => validateCheckReport(missingTree), /tree.*40 lowercase hex/i);

  const missingBranch = structuredClone(report);
  delete missingBranch.branch;
  assert.throws(() => validateCheckReport(missingBranch), /branch.*non-empty string/i);
});

test('redaction removes secret fields, token shapes, PEM bodies, and URL credentials', () => {
  const simulatedGithubToken = `${'gh' + 'p_'}ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`;
  const simulatedPrivateKey = `${'-----BEGIN ' + 'PRIVATE KEY-----'}\nabc123\n${'-----END ' + 'PRIVATE KEY-----'}`;
  const simulatedBearer = ['dashboard', 'bearer', 'credential', '0123456789'].join('-');
  const simulatedBasic = Buffer.from('dashboard-user:dashboard-password').toString('base64');
  const simulatedClientSecret = ['oauth', 'client', 'secret', '0123456789'].join('-');
  const simulatedRefreshToken = ['oauth', 'refresh', 'token', '0123456789'].join('-');
  const simulatedIdToken = ['oauth', 'id', 'token', '0123456789'].join('-');
  const simulatedJsonBearer = ['json', 'bearer', 'credential', '0123456789'].join('-');
  const simulatedJsonAccessToken = ['json', 'access', 'token', '0123456789'].join('-');
  const simulatedBareBearer = ['bare', 'bearer', 'credential', '0123456789'].join('-');
  const simulatedQuotedBearer = ['quoted', 'bearer', 'credential', '0123456789'].join('-');
  const simulatedAuthorizationCode = ['oauth', 'authorization', 'code', '0123456789'].join('-');
  const simulatedOauthToken = ['oauth1', 'token', '0123456789'].join('-');
  const simulatedOauthSignature = ['oauth1', 'signature', '0123456789'].join('-');
  const simulatedCodeVerifier = ['pkce', 'verifier', '0123456789'].join('-');
  const simulatedDeviceCode = ['device', 'code', '0123456789'].join('-');
  const simulatedClientAssertion = ['client', 'assertion', '0123456789'].join('-');
  const input = {
    authorization: 'Bearer example-sensitive-value',
    nested: {
      password: 'not-for-output',
      message: `token ${simulatedGithubToken} leaked`,
      pem: simulatedPrivateKey,
      rpc: 'https://user:pass@example.test/rpc?api_key=secret-value&chain=46630',
      prose: `request failed with Authorization: Bearer ${simulatedBearer}`,
      schemeLog: `proxy replied authorization = Basic ${simulatedBasic}`,
      oauthCallbackUrl: `https://auth.example.test/callback?client_secret=${simulatedClientSecret}&refresh_token=${simulatedRefreshToken}&id_token=${simulatedIdToken}&chain=46630`,
      serializedOauthPayload: `{"Authorization":"Bearer ${simulatedJsonBearer}","access_token":"${simulatedJsonAccessToken}"}`,
      bareBearer: `upstream returned Bearer ${simulatedBareBearer}`,
      quotedBearer: `Authorization: Bearer "${simulatedQuotedBearer}"`,
      oauthCallback: `https://auth.example.test/callback?code=${simulatedAuthorizationCode}&oauth_token=${simulatedOauthToken}&oauth_signature=${simulatedOauthSignature}&code_verifier=${simulatedCodeVerifier}&device_code=${simulatedDeviceCode}&client_assertion=${simulatedClientAssertion}&state=public-state`,
    },
  };
  const output = redactValue(input);
  const serialized = JSON.stringify(output);

  assert.equal(output.authorization, '[REDACTED]');
  assert.equal(output.nested.password, '[REDACTED]');
  assert.doesNotMatch(
    serialized,
    new RegExp(
      [
        'example-sensitive-value',
        'not-for-output',
        'ghp_',
        'abc123',
        'user:pass',
        'secret-value',
        simulatedBearer,
        simulatedBasic,
        simulatedClientSecret,
        simulatedRefreshToken,
        simulatedIdToken,
        simulatedJsonBearer,
        simulatedJsonAccessToken,
        simulatedBareBearer,
        simulatedQuotedBearer,
        simulatedAuthorizationCode,
        simulatedOauthToken,
        simulatedOauthSignature,
        simulatedCodeVerifier,
        simulatedDeviceCode,
        simulatedClientAssertion,
      ].join('|'),
    ),
  );
  assert.match(output.nested.rpc, /api_key=%5BREDACTED%5D/);
  assert.match(output.nested.rpc, /chain=46630/);
  assert.match(output.nested.prose, /Authorization:\s*\[REDACTED\]/);
  assert.match(output.nested.schemeLog, /authorization\s*=\s*\[REDACTED\]/);
  assert.match(output.nested.oauthCallbackUrl, /client_secret=%5BREDACTED%5D/);
  assert.match(output.nested.oauthCallbackUrl, /refresh_token=%5BREDACTED%5D/);
  assert.match(output.nested.oauthCallbackUrl, /id_token=%5BREDACTED%5D/);
  assert.match(output.nested.oauthCallbackUrl, /chain=46630/);
  assert.match(output.nested.serializedOauthPayload, /"Authorization":"\[REDACTED\]"/);
  assert.match(output.nested.serializedOauthPayload, /"access_token":"\[REDACTED\]"/);
  assert.match(output.nested.bareBearer, /Bearer \[REDACTED\]/);
  assert.match(output.nested.quotedBearer, /\[REDACTED\]/);
  for (const key of [
    'code',
    'oauth_token',
    'oauth_signature',
    'code_verifier',
    'device_code',
    'client_assertion',
  ])
    assert.match(output.nested.oauthCallback, new RegExp(`${key}=%5BREDACTED%5D`));
  assert.match(output.nested.oauthCallback, /state=public-state/);

  for (const protocol of ['x', 'postgres', 'ftp', 'wss']) {
    const urlPassword = `${protocol}-url-password-0123456789`;
    const sanitizedUrl = sanitizeLog(
      `${protocol}://service-user:${urlPassword}@service.example.test/resource?mode=readonly`,
    );
    assert.doesNotMatch(sanitizedUrl, new RegExp(`service-user|${urlPassword}`));
    assert.match(sanitizedUrl, new RegExp(`^${protocol}://service\\.example\\.test/resource`));
    assert.match(sanitizedUrl, /mode=readonly/);
  }
  for (const networkPath of [
    `//service-user:${simulatedClientSecret}@service.example.test/resource`,
    `URL=//service-user:${simulatedClientSecret}@service.example.test/resource`,
  ]) {
    const candidate = sanitizeLog(networkPath);
    assert.doesNotMatch(candidate, new RegExp(`service-user|${simulatedClientSecret}`));
    assert.match(candidate, /\/\/service\.example\.test\/resource/);
  }
  assert.equal(sanitizeLog('C:/public/path'), 'C:/public/path');

  const urlAliasCredential = ['url', 'alias', 'credential', '0123456789'].join('-');
  for (const url of [
    `https://service.example.test/callback?authHeader=${urlAliasCredential}&author=public-author`,
    `https://service.example.test/callback?api.key=${urlAliasCredential}&author=public-author`,
    `https://service.example.test/callback?auth%48eader=${urlAliasCredential}&author=public-author`,
    `https://service.example.test/#access_token=${urlAliasCredential}&state=public-state`,
    `custom://callback#auth=${urlAliasCredential}&state=public-state`,
    `https://service.example.test/#authorization_code=${urlAliasCredential}&state=public-state`,
  ]) {
    const candidate = sanitizeLog(url);
    assert.doesNotMatch(candidate, new RegExp(urlAliasCredential));
    assert.match(candidate, /%5BREDACTED%5D/);
  }
  assert.match(
    sanitizeLog('https://service.example.test/callback?author=public-author'),
    /author=public-author/,
  );
  for (const malformedUrl of [
    `https://service-user:${urlAliasCredential}@[invalid`,
    `https://[invalid/?auth=${urlAliasCredential}`,
    'https://[invalid/public',
  ])
    assert.equal(sanitizeLog(malformedUrl), '[REDACTED MALFORMED URL]');
  for (const target of [
    `?auth=${urlAliasCredential}`,
    `path?authz=${urlAliasCredential}`,
    `segment/authHeader=${urlAliasCredential}`,
  ])
    assert.doesNotMatch(sanitizeLog(target), new RegExp(urlAliasCredential));

  const excessUrlCredential = ['excess', 'url', 'credential', '0123456789'].join('-');
  const manyUrls = Array.from({ length: 1030 }, (_, index) =>
    index < 1024
      ? `x://service.example.test/${index}?state=public`
      : `x://service-user:${excessUrlCredential}@service.example.test/${index}`,
  ).join(' ');
  const boundedUrls = sanitizeLog(manyUrls, { maxBytes: 200_000 });
  assert.doesNotMatch(boundedUrls, new RegExp(excessUrlCredential));
  assert.match(boundedUrls, /\[REDACTED EXCESS URLS\]/);
  assert.doesNotMatch(boundedUrls, /QUANTPASS_URL/);
  const urlKeyCredential = ['url', 'key', 'credential', '0123456789'].join('-');
  for (const url of [
    `https://service.example.test/?access_token_${urlKeyCredential}=public`,
    `https://service.example.test/#auth_${urlKeyCredential}=public`,
    `https://service.example.test/?oauth=${urlAliasCredential}`,
    `https://service.example.test/#bearer=${urlAliasCredential}`,
  ]) {
    const candidate = sanitizeLog(url);
    assert.doesNotMatch(candidate, new RegExp(`${urlKeyCredential}|${urlAliasCredential}`));
    assert.match(candidate, /%5BREDACTED/);
  }

  const logBearer = sanitizeLog(`Bearer ${simulatedBareBearer}`);
  assert.doesNotMatch(logBearer, new RegExp(simulatedBareBearer));
  assert.match(logBearer, /Bearer \[REDACTED\]/);

  for (const scheme of ['Basic', 'Bearer', 'Digest', 'DPoP', 'Negotiate', 'OAuth', 'Token']) {
    const standaloneCredential = `${scheme.toLowerCase()}-standalone-credential-0123456789`;
    const redactedScheme = sanitizeLog(`upstream replied ${scheme} ${standaloneCredential}`);
    assert.doesNotMatch(redactedScheme, new RegExp(standaloneCredential));
    assert.match(redactedScheme, new RegExp(`${scheme} \\[REDACTED\\]`, 'i'));
  }

  const digestParts = ['username', 'realm', 'nonce', 'response'].map(
    (key) => `${key}=${key}-credential-0123456789`,
  );
  const oauthParts = ['oauth_consumer_key', 'oauth_token', 'oauth_signature'].map(
    (key) => `${key}=${key}-credential-0123456789`,
  );
  for (const authorizationLine of [
    `Authorization: Digest ${digestParts.join(', ')}`,
    `proxy error OAuth ${oauthParts.join(', ')}`,
  ]) {
    const redactedAuthorizationLine = sanitizeLog(authorizationLine);
    for (const part of [...digestParts, ...oauthParts])
      assert.doesNotMatch(redactedAuthorizationLine, new RegExp(part));
    assert.match(redactedAuthorizationLine, /\[REDACTED\]/);
  }

  const unknownSchemeCredential = ['unknown', 'scheme', 'credential', '0123456789'].join('-');
  for (const authorizationLine of [
    `status=public, authHeader=Custom public ${unknownSchemeCredential}`,
    `Authorization: Custom public ${unknownSchemeCredential}`,
    `authentication=custom public ${unknownSchemeCredential}`,
    `authz: MAC key=public proof=${unknownSchemeCredential}`,
  ]) {
    const candidate = sanitizeLog(authorizationLine);
    assert.doesNotMatch(candidate, new RegExp(unknownSchemeCredential));
    assert.match(candidate, /\[REDACTED\]/);
  }
  for (const foldedAuthorization of [
    `Authorization: Bearer prefix\r\n\t${unknownSchemeCredential}`,
    `authHeader: Custom prefix\n ${unknownSchemeCredential}`,
    `authHeader: Custom prefix\r ${unknownSchemeCredential}`,
    `https://service.example.test/?auth=prefix\n ${unknownSchemeCredential}`,
  ]) {
    const candidate = sanitizeLog(foldedAuthorization);
    assert.doesNotMatch(candidate, new RegExp(unknownSchemeCredential));
    assert.doesNotMatch(candidate, /\r?\n[ \t]/);
  }

  const credentialBearingAssignmentKey = ['authHeader', unknownSchemeCredential].join('-');
  const redactedAssignmentKey = sanitizeLog(`${credentialBearingAssignmentKey}=public`);
  assert.doesNotMatch(redactedAssignmentKey, new RegExp(unknownSchemeCredential));
  assert.match(redactedAssignmentKey, /\[REDACTED KEY\].*\[REDACTED\]/);

  for (const commandLine of [
    `command --token=${unknownSchemeCredential}`,
    `command --api-key=${unknownSchemeCredential}`,
    `command --auth=${unknownSchemeCredential}`,
    `command --api-key ${unknownSchemeCredential}`,
    `command --auth Custom public ${unknownSchemeCredential}`,
    `command --authHeader Custom public ${unknownSchemeCredential}`,
    `command --jwt ${unknownSchemeCredential}`,
    `$env:TOKEN=${unknownSchemeCredential}`,
    `config::apiKey=${unknownSchemeCredential}`,
    `#access_token=${unknownSchemeCredential}`,
    `fragment=#auth=${unknownSchemeCredential}`,
  ]) {
    const candidate = sanitizeLog(commandLine);
    assert.doesNotMatch(candidate, new RegExp(unknownSchemeCredential));
    assert.match(candidate, /\[REDACTED\]/);
  }

  const safeDigestEvidence = sanitizeLog('digest=sha256:public status=FAIL errorCode=PUBLIC_ERROR');
  assert.equal(safeDigestEvidence, 'digest=sha256:public status=FAIL errorCode=PUBLIC_ERROR');
  assert.deepEqual(redactValue({ digest: 'sha256:public', status: 'FAIL' }), {
    digest: 'sha256:public',
    status: 'FAIL',
  });
  assert.equal(
    sanitizeLog('digest=0123456789abcdef status=FAIL errorCode=PUBLIC_ERROR'),
    'digest=0123456789abcdef status=FAIL errorCode=PUBLIC_ERROR',
  );
  assert.deepEqual(redactValue({ digest: '0123456789abcdef', status: 'FAIL' }), {
    digest: '0123456789abcdef',
    status: 'FAIL',
  });
  assert.deepEqual(redactValue({ oauth: { enabled: true, provider: 'github' }, status: 'FAIL' }), {
    oauth: { enabled: true, provider: 'github' },
    status: 'FAIL',
  });
  assert.deepEqual(redactValue({ clientOAuth: { enabled: true, provider: 'github' }, status: 'FAIL' }), {
    clientOAuth: { enabled: true, provider: 'github' },
    status: 'FAIL',
  });
  assert.equal(sanitizeLog('oauth=enabled status=FAIL'), 'oauth=enabled status=FAIL');
  assert.equal(sanitizeLog('clientOAuth=enabled status=FAIL'), 'clientOAuth=enabled status=FAIL');
  for (const unsafeSafePrefix of [
    `oauth=enabled ${unknownSchemeCredential}`,
    `bearer=public ${unknownSchemeCredential}`,
    `jwt=required ${unknownSchemeCredential}`,
    `digest=sha256:public ${unknownSchemeCredential}`,
  ])
    assert.doesNotMatch(sanitizeLog(unsafeSafePrefix), new RegExp(unknownSchemeCredential));
  for (const safeAuthenticationMetadata of [
    'authenticationStatus=FAILED status=FAIL errorCode=PUBLIC_ERROR',
    'authorizationStatus=FAILED status=FAIL',
    'authResult=DENIED status=FAIL',
    'authMethod=oauth status=FAIL',
    'authEnabled=false status=FAIL',
  ])
    assert.equal(sanitizeLog(safeAuthenticationMetadata), safeAuthenticationMetadata);
  assert.deepEqual(redactValue({ authenticationStatus: 'FAILED', authMethod: 'oauth', authEnabled: false }), {
    authenticationStatus: 'FAILED',
    authMethod: 'oauth',
    authEnabled: false,
  });
  for (const safeSecurityMetadata of [
    'tokenizer=public status=FAIL',
    'secretary=public status=FAIL',
    'signatureAlgorithm=sha256 status=FAIL',
    'passwordPolicy=required status=FAIL',
    'credentialStatus=VALID status=FAIL',
    'cookieEnabled=false status=FAIL',
    'privateKeyRequired=false status=FAIL',
  ])
    assert.equal(sanitizeLog(safeSecurityMetadata), safeSecurityMetadata);
  const hashRouteCredential = ['hash', 'route', 'credential', '0123456789'].join('-');
  const hashRoute = sanitizeLog(
    `https://service.example.test/#route/auth=${hashRouteCredential}?state=public`,
  );
  assert.doesNotMatch(hashRoute, new RegExp(hashRouteCredential));
  assert.match(hashRoute, /\[REDACTED/);
  const safeNestedUrl = sanitizeLog(
    'https://outer.example.test/?next=http%3A%2F%2Finner.example.test\n SAFE=FAIL',
  );
  assert.match(safeNestedUrl, /inner\.example\.test/);
  assert.match(safeNestedUrl, /\n SAFE=FAIL$/);

  for (const delimiter of [',', ';', '),', '|']) {
    const adjacentUrlCredential = ['adjacent', 'url', 'credential', '0123456789'].join('-');
    const closing = delimiter.startsWith(')') ? ')' : '';
    const separator = delimiter.endsWith(',') ? ',' : delimiter;
    const prefix = closing ? '(https://service.example.test/path)' : 'https://service.example.test/path';
    const candidate = sanitizeLog(`${prefix}${separator}authHeader=${adjacentUrlCredential}`);
    assert.doesNotMatch(candidate, new RegExp(adjacentUrlCredential));
    assert.match(candidate, /\[REDACTED\]/);
  }
  for (const embeddedUrlAssignment of [
    `https://service.example.test/path/authHeader=${unknownSchemeCredential}`,
    `https://service.example.test/?mode=public;auth=${unknownSchemeCredential}`,
  ]) {
    const candidate = sanitizeLog(embeddedUrlAssignment);
    assert.doesNotMatch(candidate, new RegExp(unknownSchemeCredential));
    assert.match(candidate, /(?:\[REDACTED|%5BREDACTED)/i);
  }

  const containerCredential = ['container', 'credential', '0123456789'].join('-');
  for (const serializedContainer of [
    JSON.stringify({ Authorization: [`Bearer ${containerCredential}`] }),
    JSON.stringify({ headers: { Authorization: { scheme: 'Bearer', value: containerCredential } } }),
    `upstream response: ${JSON.stringify({ Authorization: [`Bearer ${containerCredential}`] })} (502)`,
  ]) {
    const redactedContainer = sanitizeLog(serializedContainer);
    assert.doesNotMatch(redactedContainer, new RegExp(containerCredential));
    assert.match(redactedContainer, /\[REDACTED\]/);
  }

  const genericAuthorizationCode = ['callback', 'code', '0123456789'].join('-');
  for (const candidate of [
    sanitizeLog(`code=${genericAuthorizationCode}`),
    sanitizeLog(JSON.stringify({ code: genericAuthorizationCode })),
    JSON.stringify(redactValue({ code: genericAuthorizationCode })),
  ]) {
    assert.doesNotMatch(candidate, new RegExp(genericAuthorizationCode));
    assert.match(candidate, /\[REDACTED\]/);
  }

  const adversarialCredential = ['late', 'json', 'credential', '0123456789'].join('-');
  for (const malformedPrefix of ['{'.repeat(32), '['.repeat(32)]) {
    const candidate = sanitizeLog(
      `${malformedPrefix}${JSON.stringify({ Authorization: { scheme: 'OAuth', value: adversarialCredential } })}`,
    );
    assert.doesNotMatch(candidate, new RegExp(adversarialCredential));
    assert.match(candidate, /\[REDACTED/);
  }

  const malformedContainerCredential = ['malformed', 'container', 'credential', '0123456789'].join('-');
  for (const input of [
    `auth={scheme:Custom,value:${malformedContainerCredential}}`,
    `authorization={scheme:OAuth,value:${malformedContainerCredential}}`,
    `auth=[public,${malformedContainerCredential}]`,
    `auth={scheme:Custom,value:${malformedContainerCredential}`,
    `auth={note:'}',value:${malformedContainerCredential}}`,
    `auth={pattern:/}/,value:${malformedContainerCredential}}`,
    `auth={comment:/* } */x,value:${malformedContainerCredential}}`,
    `auth={\nvalue:${malformedContainerCredential}`,
    `auth=[\n${malformedContainerCredential}`,
  ]) {
    const candidate = sanitizeLog(input);
    assert.doesNotMatch(candidate, new RegExp(malformedContainerCredential));
    assert.match(candidate, /\[REDACTED\]/);
  }

  const escapedCredential = ['escaped', 'oauth', 'credential', '0123456789'].join('-');
  const encodedPayload = JSON.stringify({ access_token: escapedCredential });
  let multiplyEncodedPayload = encodedPayload;
  for (let depth = 0; depth < 6; depth++) multiplyEncodedPayload = JSON.stringify(multiplyEncodedPayload);
  for (const candidate of [
    sanitizeLog(`payload=${JSON.stringify(encodedPayload)}`),
    sanitizeLog(JSON.stringify(encodedPayload)),
    sanitizeLog(encodedPayload.replaceAll('"', '\\"')),
    sanitizeLog(
      JSON.stringify({ Authorization: { scheme: 'OAuth', value: escapedCredential } }).replaceAll('"', '\\"'),
    ),
    sanitizeLog(multiplyEncodedPayload),
  ]) {
    assert.doesNotMatch(candidate, new RegExp(escapedCredential));
    assert.match(candidate, /\[REDACTED/);
  }

  const oversizedCredential = ['oversized', 'oauth', 'credential', '0123456789'].join('-');
  const oversized = JSON.stringify({
    Authorization: {
      scheme: 'OAuth',
      value: oversizedCredential,
      padding: 'x'.repeat(262_200),
    },
  });
  for (const candidate of [
    sanitizeLog(oversized, { maxBytes: 400_000 }),
    JSON.stringify(redactValue({ message: oversized }, { maxStringLength: 300_000 })),
  ]) {
    assert.doesNotMatch(candidate, new RegExp(oversizedCredential));
    assert.match(candidate, /\[REDACTED/);
  }

  const cookieSession = ['cookie', 'session', 'credential', '0123456789'].join('-');
  const cookieCsrf = ['cookie', 'csrf', 'credential', '0123456789'].join('-');
  for (const header of [
    `Cookie: theme=dark; session=${cookieSession}; csrf=${cookieCsrf}`,
    `Set-Cookie: theme=dark; session=${cookieSession}; csrf=${cookieCsrf}; HttpOnly`,
    `Cookie=theme=dark; session=${cookieSession}; csrf=${cookieCsrf}`,
    `Set-Cookie=theme=dark; session=${cookieSession}; csrf=${cookieCsrf}; HttpOnly`,
    `Cookie: theme=dark;\r\n session=${cookieSession}; csrf=${cookieCsrf}`,
  ]) {
    const candidate = sanitizeLog(header);
    assert.doesNotMatch(candidate, new RegExp(`${cookieSession}|${cookieCsrf}`));
    assert.match(candidate, /^(?:Set-)?Cookie:\s*\[REDACTED\]$/i);
  }

  const propertyNameCredential = ['property', 'name', 'credential', '0123456789'].join('-');
  for (const credentialBearingKey of [
    `Authorization: Bearer ${propertyNameCredential}`,
    `access_token_${propertyNameCredential}`,
  ])
    for (const candidate of [
      JSON.stringify(redactValue({ [credentialBearingKey]: 'public-value' })),
      sanitizeLog(JSON.stringify({ [credentialBearingKey]: 'public-value' })),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(propertyNameCredential));
      assert.match(candidate, /\[REDACTED/);
    }
  for (const key of [
    'ACCESSTOKEN',
    'accesstoken',
    'CLIENTSECRET',
    'clientsecret',
    'REFRESHTOKEN',
    'PRIVATEKEY',
    'CODEVERIFIER',
    'DEVICECODE',
    'SIGNINGKEY',
    'ENCRYPTIONKEY',
    'RECOVERYCODE',
  ]) {
    const candidate = sanitizeLog(`${key}=${propertyNameCredential}`);
    assert.doesNotMatch(candidate, new RegExp(propertyNameCredential));
    assert.match(candidate, /\[REDACTED/);
  }

  const aliasCredential = ['sensitive', 'alias', 'credential', '0123456789'].join('-');
  const aliasInput = { auth: aliasCredential, apiKey: aliasCredential };
  for (const candidate of [
    JSON.stringify(redactValue(aliasInput)),
    sanitizeLog(JSON.stringify(aliasInput)),
  ]) {
    assert.doesNotMatch(candidate, new RegExp(aliasCredential));
    assert.match(candidate, /\[REDACTED\]/);
  }

  const diagnosticAliases = redactValue({
    auth: 'DATA_SOURCE_ERROR',
    apiKey: 'BROKEN_INTERNAL_LINK',
    code: 'STALE_CHECK_EVIDENCE',
  });
  assert.equal(diagnosticAliases.auth, '[REDACTED]');
  assert.equal(diagnosticAliases.apiKey, '[REDACTED]');
  assert.equal(diagnosticAliases.code, 'STALE_CHECK_EVIDENCE');
  for (const safeDiagnosticCode of [
    'BROKEN_INTERNAL_LINK',
    'DATA_SOURCE_ERROR',
    'OPTIONAL_SOURCE_NOT_AVAILABLE',
    'STALE_CHECK_EVIDENCE',
  ]) {
    assert.equal(
      JSON.parse(sanitizeLog(JSON.stringify({ code: safeDiagnosticCode }))).code,
      safeDiagnosticCode,
    );
    assert.match(
      sanitizeLog(`event=${JSON.stringify({ code: safeDiagnosticCode })}`),
      new RegExp(safeDiagnosticCode),
    );
  }
  const diagnosticTailCredential = ['diagnostic', 'tail', 'credential', '0123456789'].join('-');
  assert.doesNotMatch(
    sanitizeLog(`code=STALE_CHECK_EVIDENCE ${diagnosticTailCredential}`),
    new RegExp(diagnosticTailCredential),
  );
  assert.equal(sanitizeLog('code=STALE_CHECK_EVIDENCE status=FAIL'), 'code=STALE_CHECK_EVIDENCE status=FAIL');

  const authorizationCode = ['authorization', 'code', 'credential', '0123456789'].join('-');
  const codeAliasInput = Object.fromEntries(
    [' code ', 'code[]', 'code.value', '"code"'].map((key) => [key, authorizationCode]),
  );
  for (const candidate of [
    JSON.stringify(redactValue(codeAliasInput)),
    sanitizeLog(JSON.stringify(codeAliasInput)),
  ]) {
    assert.doesNotMatch(candidate, new RegExp(authorizationCode));
    assert.match(candidate, /\[REDACTED/);
  }
  const nonCredentialCodes = redactValue({ errorCode: 'PUBLIC_ERROR', statusCode: 503 });
  assert.equal(nonCredentialCodes.errorCode, 'PUBLIC_ERROR');
  assert.equal(nonCredentialCodes.statusCode, 503);

  const structuredAliasCredential = ['structured', 'header', 'credential', '0123456789'].join('-');
  const structuredAliasKeys = [
    'X-API-Key',
    'authHeader',
    'authentication',
    'AUTHHEADER',
    'XAUTHHEADER',
    'authn',
    'authz',
    'authenticationHeader',
    'authorizationHeader',
    'requestAuthHeader',
    'httpAuth',
    'basicAuth',
    'authConfig',
    'AUTHCONFIG',
    'proxyAuthorization',
    'oauth',
    'clientOAuth',
    'providerOAuth',
    'client_oauth',
    'provider-oauth',
    'client.oauth',
    'x_oauth',
    'bearer',
    'dpop',
    'jwt',
    'digest',
    'negotiate',
    'basic',
    'api.key',
    'x.api.key',
    'private.key',
    'code.verifier',
    'device.code',
  ];
  const structuredAliasInput = Object.fromEntries(
    structuredAliasKeys.map((key) => [key, structuredAliasCredential]),
  );
  structuredAliasInput.author = 'public-author-name';
  for (const candidate of [
    JSON.stringify(redactValue(structuredAliasInput)),
    sanitizeLog(JSON.stringify(structuredAliasInput)),
  ]) {
    assert.doesNotMatch(candidate, new RegExp(structuredAliasCredential));
    assert.match(candidate, /\[REDACTED\]/);
    assert.match(candidate, /public-author-name/);
  }
  for (const key of structuredAliasKeys)
    for (const candidate of [
      sanitizeLog(`${key}=${structuredAliasCredential}`),
      sanitizeLog(`${key}: '${structuredAliasCredential}'`),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(structuredAliasCredential));
      assert.match(candidate, /\[REDACTED\]/);
    }
  const structuredPairCredential = ['structured', 'pair', 'credential', '0123456789'].join('-');
  for (const value of [
    [['X-API-Key', structuredPairCredential]],
    [['Authorization', `Custom ${structuredPairCredential}`]],
    [['Cookie', `session=${structuredPairCredential}`]],
    { name: 'X-API-Key', value: structuredPairCredential },
    { key: 'authHeader', value: structuredPairCredential },
    { header: 'Cookie', value: `session=${structuredPairCredential}` },
    { headers: [['X-API-Key', structuredPairCredential]] },
  ])
    for (const candidate of [JSON.stringify(redactValue(value)), sanitizeLog(JSON.stringify(value))]) {
      assert.doesNotMatch(candidate, new RegExp(structuredPairCredential));
      assert.match(candidate, /\[REDACTED\]/);
    }
  assert.deepEqual(redactValue({ name: 'author', value: 'public-author' }), {
    name: 'author',
    value: 'public-author',
  });
  assert.equal(sanitizeLog('author=public-author-name'), 'author=public-author-name');
  const additionalAliasCredential = ['additional', 'alias', 'credential', '0123456789'].join('-');
  for (const key of ['signingKey', 'encryptionKey', 'passphrase', 'recoveryCode', 'otp'])
    for (const candidate of [
      sanitizeLog(`${key}=${additionalAliasCredential}`),
      JSON.stringify(redactValue({ [key]: additionalAliasCredential })),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(additionalAliasCredential));
      assert.match(candidate, /\[REDACTED\]/);
    }
  for (const key of [
    'API Key',
    'Private Key',
    'Signing Key',
    'Encryption Key',
    'Code Verifier',
    'Seed Phrase',
    'Auth Header',
  ]) {
    const candidate = sanitizeLog(`${key}: ${additionalAliasCredential}`);
    assert.doesNotMatch(candidate, new RegExp(additionalAliasCredential));
    assert.match(candidate, /\[REDACTED\]/);
  }
  for (const key of [
    'credentials',
    'apiCredentials',
    'secrets',
    'passwords',
    'tokens',
    'signatures',
    'cookies',
    'privateKeys',
    'apiKeys',
    'recoveryCodes',
    'mnemonics',
    'passphrases',
  ])
    for (const candidate of [
      sanitizeLog(`${key}=${additionalAliasCredential}`),
      JSON.stringify(redactValue({ [key]: additionalAliasCredential })),
      sanitizeLog(JSON.stringify({ [key]: additionalAliasCredential })),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(additionalAliasCredential));
      assert.match(candidate, /\[REDACTED/);
    }

  const mixedEscapedCredential = ['mixed', 'escaped', 'credential', '0123456789'].join('-');
  for (let escapingDepth = 2; escapingDepth <= 8; escapingDepth++) {
    const slashes = '\\'.repeat(escapingDepth);
    const candidate = sanitizeLog(
      `payload={${slashes}"auth${slashes}":${slashes}"${mixedEscapedCredential}${slashes}"}`,
    );
    assert.doesNotMatch(candidate, new RegExp(mixedEscapedCredential));
    assert.match(candidate, /\[REDACTED/);
  }

  const encodedUrlCredential = ['encoded', 'url', 'credential', '0123456789'].join('-');
  for (const encodedUrl of [
    `https://service.example.test/?api%252Dkey=${encodedUrlCredential}`,
    `https://service.example.test/?private%255Fkey=${encodedUrlCredential}`,
    `https://service.example.test/?code%255Fverifier=${encodedUrlCredential}`,
    `https://service.example.test/?device%255Fcode=${encodedUrlCredential}`,
    `https://service.example.test/?next=https%253A%252F%252Fu%253A${encodedUrlCredential}%2540inner.example.test%252F`,
    `https://service.example.test/%2561uthHeader%253D${encodedUrlCredential}`,
    `https://service.example.test/#api%252Dkey=${encodedUrlCredential}`,
  ]) {
    const candidate = sanitizeLog(encodedUrl);
    assert.doesNotMatch(candidate, new RegExp(encodedUrlCredential));
    assert.doesNotMatch(candidate, /QUANTPASS_URL/);
  }
  for (const suffixLength of [120, 260, 4096]) {
    const longKeyCredential = ['long', 'key', suffixLength, 'credential'].join('-');
    const longKey = `authHeader${'x'.repeat(suffixLength)}`;
    for (const candidate of [
      sanitizeLog(`${longKey}=${longKeyCredential}`),
      sanitizeLog(`"${longKey}":"${longKeyCredential}"`),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(longKeyCredential));
      assert.match(candidate, /\[REDACTED\]/);
    }
  }
});

test('redaction only exempts type-valid scalar security metadata', () => {
  const credential = ['metadata', 'container', 'credential', '0123456789'].join('-');
  const unsafe = {
    authenticationStatus: { value: credential },
    apiKeyStatus: { detail: credential },
    clientSecretEnabled: [credential],
    passwordPolicy: { note: credential },
    tokenCount: { value: credential },
  };

  for (const candidate of [JSON.stringify(redactValue(unsafe)), sanitizeLog(JSON.stringify(unsafe))]) {
    assert.doesNotMatch(candidate, new RegExp(credential));
    assert.match(candidate, /\[REDACTED\]/);
  }

  const safe = {
    authenticationStatus: 'FAILED',
    apiKeyStatus: 'VALID',
    cookieEnabled: false,
    passwordPolicy: 'required',
    privateKeyRequired: false,
    signatureAlgorithm: 'sha256',
    tokenCount: 2,
  };
  assert.deepEqual(redactValue(safe), safe);
  assert.deepEqual(JSON.parse(sanitizeLog(JSON.stringify(safe))), safe);
  assert.equal(sanitizeLog('tokenCount="2" status=FAIL'), 'tokenCount="2" status=FAIL');

  const keyCanary = ['metadata', 'key', 'canary', '0123456789'].join('-');
  for (const key of [
    `credential-${keyCanary}-status`,
    `password-${keyCanary}-status`,
    `password-${'x'.repeat(257)}-${keyCanary}-status`,
  ]) {
    const input = { [key]: 'VALID' };
    for (const candidate of [
      sanitizeLog(`${key}=VALID`),
      JSON.stringify(redactValue(input)),
      sanitizeLog(JSON.stringify(input)),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(keyCanary));
      assert.match(candidate, /\[REDACTED/);
    }
  }
});

test('standalone authorization schemes redact challenges without erasing safe prose', () => {
  const credential = ['standalone', 'challenge', 'credential', '0123456789'].join('-');
  for (const challenge of [
    `Bearer ${credential}`,
    `Bearer token ${credential}`,
    `upstream replied Basic ${credential}`,
    `proxy challenge Digest realm=public, nonce=${credential}`,
    `upstream replied OAuth oauth_token=${credential}`,
    `OAuth provider status ${credential}`,
  ]) {
    const candidate = sanitizeLog(challenge);
    assert.doesNotMatch(candidate, new RegExp(credential));
    assert.match(candidate, /\[REDACTED\]/);
  }

  for (const prose of [
    'Basic authentication remains disabled.',
    'Bearer authentication failures are reported.',
    'Digest algorithm selection is public.',
    'DPoP support is optional.',
    'Negotiate failures are reported.',
    'OAuth provider status is public.',
    'Token validation failed.',
    'Use basic validation for input',
    'Compute digest after build',
    'OAuth support is disabled',
    'Token budget is limited',
    'Bearer market conditions',
  ])
    assert.equal(sanitizeLog(prose), prose);
  for (const proseWithCredential of [
    `Use basic validation for input ${credential}`,
    `Compute digest after build ${credential}`,
    `OAuth support is disabled ${credential}`,
    `Token budget is limited ${credential}`,
    `Bearer market conditions ${credential}`,
  ])
    assert.doesNotMatch(sanitizeLog(proseWithCredential), new RegExp(credential));
});

test('redaction covers every sensitive value in flat alternating structured pairs', () => {
  const firstCredential = ['first', 'structured', 'credential', '0123456789'].join('-');
  const secondCredential = ['second', 'structured', 'credential', '0123456789'].join('-');
  const thirdCredential = ['third', 'structured', 'credential', '0123456789'].join('-');
  const pairs = [
    'Accept',
    'application/json',
    'X-API-Key',
    firstCredential,
    'Authorization2',
    `Custom ${secondCredential}`,
    'Cookie',
    `session=${thirdCredential}`,
  ];

  for (const candidate of [JSON.stringify(redactValue(pairs)), sanitizeLog(JSON.stringify(pairs))]) {
    assert.doesNotMatch(
      candidate,
      new RegExp([firstCredential, secondCredential, thirdCredential].join('|')),
    );
    assert.match(candidate, /application\/json/);
    assert.equal(candidate.match(/\[REDACTED\]/g)?.length, 3);
  }

  const projectLists = [
    ['SECRET-001', 'KEY-001', 'WEBSEC-001', 'OBS-001'],
    [
      '覆盖授权绕过、重入、重放、恶意 token、RPC 欺骗、前端替换和密钥泄露',
      '每个 Critical/High 风险有负责人、缓解任务和截止门禁',
      '威胁模型与实际数据流、ABI 和角色一致',
    ],
    [
      'Persistent service installation, LAN exposure, authentication, API endpoints, proxying, and remote hosting are intentionally outside scope.',
      'Browser visual QA remains deferred while the no-screen instruction is active.',
    ],
  ];
  for (const list of projectLists) {
    assert.deepEqual(redactValue(list), list);
    assert.deepEqual(JSON.parse(sanitizeLog(JSON.stringify(list))), list);
  }
});

test('redaction recognizes bounded static bracket-notation assignments', () => {
  const credential = ['bracket', 'assignment', 'credential', '0123456789'].join('-');
  for (const assignment of [
    `settings['password']='${credential}'`,
    `settings [ "clientSecret" ] = "${credential}"`,
    `config['headers'] [ 'Authorization' ] = 'Custom ${credential}'`,
    `registry [ 'safe' ][ 'apiKey' ] = '${credential}'`,
    `config [\n 'nested'\n] [\n "password"\n] =\n"${credential}"`,
  ]) {
    const candidate = sanitizeLog(assignment);
    assert.doesNotMatch(candidate, new RegExp(credential));
    assert.match(candidate, /\[REDACTED\]/);
  }
  assert.equal(sanitizeLog("settings['author']='public-author'"), "settings['author']='public-author'");
});

test('redaction categorizes raw OpenSSH public and certificate keys', () => {
  const publicAlgorithms = [
    'ssh-ed25519',
    'sk-ssh-ed25519@openssh.com',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'sk-ecdsa-sha2-nistp256@openssh.com',
    'ssh-rsa',
  ];
  const certificateAlgorithms = [
    'ssh-ed25519-cert-v01@openssh.com',
    'sk-ssh-ed25519-cert-v01@openssh.com',
    'ecdsa-sha2-nistp256-cert-v01@openssh.com',
    'ecdsa-sha2-nistp384-cert-v01@openssh.com',
    'ecdsa-sha2-nistp521-cert-v01@openssh.com',
    'sk-ecdsa-sha2-nistp256-cert-v01@openssh.com',
    'ssh-rsa-cert-v01@openssh.com',
  ];
  const publicBlob = 'A'.repeat(68);
  const certificateBlob = 'B'.repeat(96);
  const comment = ['build', 'operator', 'workstation'].join('-');
  for (const rawKey of [
    ...publicAlgorithms.map((algorithm) => `${algorithm} ${publicBlob} ${comment}`),
    ...certificateAlgorithms.map((algorithm) => `${algorithm} ${certificateBlob} ${comment}`),
  ]) {
    for (const candidate of [
      sanitizeLog(`observed key: ${rawKey}`),
      JSON.stringify(redactValue({ message: rawKey })),
      sanitizeLog(JSON.stringify({ message: rawKey })),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(`${publicBlob}|${certificateBlob}|${comment}`));
      assert.match(candidate, /\[REDACTED SSH PUBLIC KEY\]/);
    }
  }
  for (const documentation of [...publicAlgorithms, ...certificateAlgorithms].map(
    (algorithm) => `${algorithm} is supported.`,
  ))
    assert.equal(sanitizeLog(documentation), documentation);
  const unsupportedAlgorithmExample = `not-ssh-ed25519 ${publicBlob} placeholder`;
  assert.equal(sanitizeLog(unsupportedAlgorithmExample), unsupportedAlgorithmExample);
});

test('redaction categorizes legacy DSA OpenSSH public and certificate keys', () => {
  const publicBlob = 'C'.repeat(68);
  const certificateBlob = 'D'.repeat(96);
  const comment = ['legacy', 'build', 'operator'].join('-');

  for (const rawKey of [
    `ssh-dss ${publicBlob} ${comment}`,
    `ssh-dss-cert-v01@openssh.com ${certificateBlob} ${comment}`,
  ]) {
    for (const candidate of [
      sanitizeLog(`observed key: ${rawKey}`),
      JSON.stringify(redactValue({ message: rawKey })),
      sanitizeLog(JSON.stringify({ message: rawKey })),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(`${publicBlob}|${certificateBlob}|${comment}`));
      assert.match(candidate, /\[REDACTED SSH PUBLIC KEY\]/);
    }
  }
  for (const documentation of ['ssh-dss is supported.', 'ssh-dss-cert-v01@openssh.com is supported.'])
    assert.equal(sanitizeLog(documentation), documentation);
  const prefixedAlgorithm = `not-ssh-dss ${publicBlob} placeholder`;
  assert.equal(sanitizeLog(prefixedAlgorithm), prefixedAlgorithm);
});

test('redaction removes private JWK members while preserving ordinary short property names', () => {
  const input = {
    ordinary: {
      k: 'public-k-value',
      d: 'public-d-value',
    },
    unrecognized: {
      kty: 'custom',
      k: 'custom-public-k-value',
      d: 'custom-public-d-value',
    },
    nested: {
      jwks: [
        {
          kty: 'oct',
          k: 'oct-private-canary',
          kid: 'oct-public-id',
        },
        {
          kty: 'RSA',
          n: 'rsa-public-modulus',
          e: 'AQAB',
          d: 'rsa-private-d-canary',
          p: 'rsa-private-p-canary',
          q: 'rsa-private-q-canary',
          dp: 'rsa-private-dp-canary',
          dq: 'rsa-private-dq-canary',
          qi: 'rsa-private-qi-canary',
          oth: [{ r: 'rsa-private-other-prime-canary' }],
        },
        {
          kty: 'EC',
          crv: 'P-256',
          x: 'ec-public-x',
          y: 'ec-public-y',
          d: 'ec-private-d-canary',
        },
        {
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'okp-public-x',
          d: 'okp-private-d-canary',
        },
      ],
    },
  };

  for (const output of [redactValue(input), JSON.parse(sanitizeLog(JSON.stringify(input)))]) {
    assert.deepEqual(output.ordinary, input.ordinary);
    assert.deepEqual(output.unrecognized, input.unrecognized);
    assert.equal(output.nested.jwks[0].k, '[REDACTED]');
    assert.equal(output.nested.jwks[0].kid, 'oct-public-id');
    assert.equal(output.nested.jwks[1].n, 'rsa-public-modulus');
    assert.equal(output.nested.jwks[1].e, 'AQAB');
    for (const key of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'])
      assert.equal(output.nested.jwks[1][key], '[REDACTED]');
    assert.equal(output.nested.jwks[2].x, 'ec-public-x');
    assert.equal(output.nested.jwks[2].y, 'ec-public-y');
    assert.equal(output.nested.jwks[2].d, '[REDACTED]');
    assert.equal(output.nested.jwks[3].x, 'okp-public-x');
    assert.equal(output.nested.jwks[3].d, '[REDACTED]');

    const serialized = JSON.stringify(output);
    assert.doesNotMatch(serialized, /private-(?:d|p|q|dp|dq|qi|other-prime)-canary/);
    assert.doesNotMatch(serialized, /oct-private-canary/);
  }

  const wideOctJwk = { k: 'wide-oct-private-canary' };
  for (let index = 0; index < 1000; index++) wideOctJwk[`public${index}`] = index;
  wideOctJwk.kty = 'oct';
  const boundedOutput = JSON.parse(sanitizeLog(JSON.stringify(wideOctJwk)));
  assert.equal(boundedOutput.k, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(boundedOutput), /wide-oct-private-canary/);

  const fragmentOutput = sanitizeLog(
    `check failed: ${JSON.stringify({ kty: 'oct', k: 'fragment-oct-private-canary' })} status=FAIL`,
  );
  assert.doesNotMatch(fragmentOutput, /fragment-oct-private-canary/);
  assert.match(fragmentOutput, /\[REDACTED\]/);
});

test('redaction fails closed for complete and truncated private-key PEM blocks', () => {
  const bodyCanary = ['pem', 'body', 'canary', '0123456789'].join('-');
  for (const label of [
    'PRIVATE KEY',
    'RSA PRIVATE KEY',
    'EC PRIVATE KEY',
    'OPENSSH PRIVATE KEY',
    'ENCRYPTED PRIVATE KEY',
    'DSA PRIVATE KEY',
    'ED25519 PRIVATE KEY',
  ]) {
    const begin = `-----BEGIN ${label}-----`;
    const end = `-----END ${label}-----`;
    for (const candidate of [
      sanitizeLog(`${begin}\n${bodyCanary}\n${end}\npublic suffix`),
      sanitizeLog(`${begin}\n${bodyCanary}`),
    ]) {
      assert.doesNotMatch(candidate, new RegExp(bodyCanary));
      assert.match(candidate, /\[REDACTED PRIVATE KEY\]/);
    }
    assert.match(sanitizeLog(`${begin}\n${bodyCanary}\n${end}\npublic suffix`), /public suffix$/);
  }
  const certificate = '-----BEGIN CERTIFICATE-----\npublic-body\n-----END CERTIFICATE-----';
  assert.equal(sanitizeLog(certificate), certificate);
});

test('redaction bounds home paths, depth, array length, cycles, and log bytes', () => {
  const simulatedHomePath = ['', 'Users', 'operator', 'project'].join('/');
  const circular = { path: simulatedHomePath, items: Array.from({ length: 105 }, (_, index) => index) };
  circular.self = circular;
  circular.deep = { a: { b: { c: 'hidden-by-depth-limit' } } };

  const output = redactValue(circular, { maxDepth: 2, maxArrayLength: 3, maxStringLength: 32 });
  assert.equal(output.path, '<HOME>/project');
  assert.deepEqual(output.items, [0, 1, 2, '[TRUNCATED 102 ITEMS]']);
  assert.equal(output.self, '[UNAVAILABLE]');
  assert.equal(output.deep.a.b, '[MAX_DEPTH]');

  const log = sanitizeLog(`prefix ${'x'.repeat(200)} password=abcdefghijklmnopqrstuvwxyz0123456789`, {
    maxBytes: 64,
  });
  assert.ok(Buffer.byteLength(log, 'utf8') <= 64);
  assert.doesNotMatch(log, /abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.match(log, /TRUNCATED/);

  let propertyReads = 0;
  const wideObject = {};
  for (let index = 0; index < 10; index++)
    Object.defineProperty(wideObject, `field${index}`, {
      enumerable: true,
      get() {
        propertyReads++;
        return index;
      },
    });
  const boundedObject = redactValue(wideObject, { maxObjectEntries: 3 });
  assert.deepEqual(boundedObject, {
    field0: 0,
    field1: 1,
    field2: 2,
    '[TRUNCATED PROPERTIES]': '[TRUNCATED]',
  });
  assert.equal(propertyReads, 3);

  const serializedWideObject = Object.fromEntries(
    Array.from({ length: 1005 }, (_, index) => [`field${index}`, index]),
  );
  const boundedSerializedObject = JSON.parse(sanitizeLog(JSON.stringify(serializedWideObject)));
  assert.equal(Object.keys(boundedSerializedObject).length, 1001);
  assert.equal(boundedSerializedObject['[TRUNCATED PROPERTIES]'], '[TRUNCATED]');
});

test('redaction scans maximum-sized scalar candidates within a linear time budget', () => {
  const repeated = 'segment.'.repeat(32_768);
  const repeatedSafeAssignments = ['tokenCount=2 ', 'digest=sha256:public '].map((unit) =>
    unit.repeat(Math.floor(262_144 / unit.length)),
  );
  for (const input of [
    repeated,
    `${repeated.slice(0, -1)}=`,
    `${repeated.slice(0, -1)}:`,
    ...repeatedSafeAssignments,
  ]) {
    const startedAt = performance.now();
    const output = sanitizeLog(input, { maxBytes: 300_000 });
    const durationMs = performance.now() - startedAt;
    assert.ok(durationMs < 1500, `bounded scalar scan took ${durationMs.toFixed(1)}ms`);
    assert.ok(output.length > 0);
  }
});

test('redaction truncates multibyte logs linearly at a valid UTF-8 boundary', () => {
  const input = '😀'.repeat(16_384);
  const startedAt = performance.now();
  const output = sanitizeLog(input, { maxBytes: 32_767 });
  const durationMs = performance.now() - startedAt;
  assert.ok(durationMs < 150, `multibyte truncation took ${durationMs.toFixed(1)}ms`);
  assert.ok(Buffer.byteLength(output, 'utf8') <= 32_767);
  assert.doesNotMatch(output, /�/);
  assert.match(output, /\[TRUNCATED\]$/);
});

test('redaction preserves repeated safe aliases while still terminating real cycles', () => {
  const shared = { path: 'docs/security/report.md', status: 'READY' };
  const redacted = redactValue({ primary: shared, repeated: shared });
  assert.deepEqual(redacted.primary, shared);
  assert.deepEqual(redacted.repeated, shared);
});

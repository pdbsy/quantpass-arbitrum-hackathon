import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const maximumGitOutputBytes = 4 * 1024 * 1024;
const maximumTextBytes = 2 * 1024 * 1024;
const maximumTotalTextBytes = 8 * 1024 * 1024;
const maximumFiles = 10_000;
const maximumStructuredDepth = 32;
const maximumStructuredProperties = 10_000;
const maximumEncodedStringLayers = 8;
const maximumDecodedTextBytes = maximumTextBytes * (maximumEncodedStringLayers + 1);
const maximumEmbeddedJsonStringScans = 10_000;
const maximumStaticConcatenationParts = 8;
const maximumStaticParenthesisDepth = 8;
const maximumStaticConcatenationScans = 10_000;
const maximumStaticMemberSegments = 128;
const keyWordSeparatorPattern = '[ \\t_-]*';
const boundedCodeWhitespacePattern = '[ \\t\\r\\n]{0,64}';
const structuredAssignmentPattern = `["']?[ \\t]*(?::=|\\||:|=(?!=))[ \\t]*["']?`;
const hostIdentityLabelPattern = [
  `computer${keyWordSeparatorPattern}name`,
  `device${keyWordSeparatorPattern}name`,
  `host${keyWordSeparatorPattern}name`,
  'localhostname',
  `local${keyWordSeparatorPattern}account`,
  `user${keyWordSeparatorPattern}name`,
].join('|');
const hostIdentityAssignmentPrefix = `["']?\\b(?:${hostIdentityLabelPattern})\\b["']?[ \\t]*(?::=|\\||:|=(?!=))[ \\t]*`;
const identityPlaceholderPattern =
  '(?:127\\.0\\.0\\.1|localhost|string|str|number|boolean|unknown|any|null|undefined)';
const hostIdentityValuePattern = `(?!${identityPlaceholderPattern}\\b)[A-Za-z0-9][A-Za-z0-9._@-]{0,127}`;
const quotedHostIdentityValuePattern = `(?!${identityPlaceholderPattern}(?=["'\\x60]))[A-Za-z0-9](?:[A-Za-z0-9._@-]|[ \\t](?=[A-Za-z0-9])){0,127}`;
const boundedUnquotedHostIdentityValuePattern = `${hostIdentityValuePattern}(?=[ \\t]*(?:$|[\\r\\n,;}\\]#]))`;
const recordHostIdentityPattern = new RegExp(
  `${hostIdentityAssignmentPrefix}(?:["']${quotedHostIdentityValuePattern}["']|${boundedUnquotedHostIdentityValuePattern}|\\[\\s*(?:["']${quotedHostIdentityValuePattern}["']|${boundedUnquotedHostIdentityValuePattern}))`,
  'i',
);
const codeStringQuotePattern = `["'\\x60]`;
const codeHostIdentityPattern = new RegExp(
  `${hostIdentityAssignmentPrefix}(?:${codeStringQuotePattern}${quotedHostIdentityValuePattern}${codeStringQuotePattern}(?!${boundedCodeWhitespacePattern}\\+)|\\[\\s*${codeStringQuotePattern}${quotedHostIdentityValuePattern}${codeStringQuotePattern}(?!${boundedCodeWhitespacePattern}\\+))`,
  'i',
);
const nestedHostIdentityPattern = new RegExp(
  `["']?\\b(?:host|device|computer)\\b["']?[ \\t]*(?:\\||:|=(?!=))[ \\t]*\\{[^}]{0,256}?["']?\\bname\\b["']?[ \\t]*(?:\\||:|=(?!=))[ \\t]*(?:["']${quotedHostIdentityValuePattern}["']|${boundedUnquotedHostIdentityValuePattern})`,
  'i',
);
const nestedCodeHostIdentityPattern = new RegExp(
  `["']?\\b(?:host|device|computer)\\b["']?[ \\t]*(?:\\||:|=(?!=))[ \\t]*\\{[^}]{0,256}?["']?\\bname\\b["']?[ \\t]*(?:\\||:|=(?!=))[ \\t]*${codeStringQuotePattern}${quotedHostIdentityValuePattern}${codeStringQuotePattern}(?!${boundedCodeWhitespacePattern}\\+)`,
  'i',
);
const staticStringContentPattern =
  '(?:\\\\(?:u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|[^\\r\\n])|[A-Za-z0-9_$ .@-]){1,256}';
const staticEndpointContentPattern =
  '(?:\\\\(?:u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|[^\\r\\n])|[A-Za-z0-9._:%\\[\\]-]){1,256}';
const staticIdentifierPattern =
  '(?:[A-Za-z_$]|\\\\u[0-9A-Fa-f]{4})(?:(?:[A-Za-z0-9_$]|\\\\u[0-9A-Fa-f]{4})){0,127}';
const codeMemberLiteralAssignmentPattern = new RegExp(
  `(?:^|[^A-Za-z0-9_$])(${staticIdentifierPattern}[ \\t]*!?(?:(?:${boundedCodeWhitespacePattern}(?:\\?\\.)?[ \\t]*\\[[ \\t]*["'\\x60]${staticStringContentPattern}["'\\x60][ \\t]*\\])|(?:${boundedCodeWhitespacePattern}!?[ \\t]*(?:\\?\\.|\\.)[ \\t]*${staticIdentifierPattern}))+)[ \\t]*=(?!=)${boundedCodeWhitespacePattern}(?:(["'\\x60])(${staticStringContentPattern})\\2|\\(${boundedCodeWhitespacePattern}(["'\\x60])(${staticStringContentPattern})\\4${boundedCodeWhitespacePattern}\\))(?!${boundedCodeWhitespacePattern}\\+)`,
  'gim',
);
const codeSshMemberListenerAssignmentPattern = new RegExp(
  `(?:^|[^A-Za-z0-9_$])(${staticIdentifierPattern}[ \\t]*!?(?:(?:${boundedCodeWhitespacePattern}(?:\\?\\.)?[ \\t]*\\[[ \\t]*["'\\x60]${staticStringContentPattern}["'\\x60][ \\t]*\\])|(?:${boundedCodeWhitespacePattern}!?[ \\t]*(?:\\?\\.|\\.)[ \\t]*${staticIdentifierPattern}))+)[ \\t]*=(?!=)${boundedCodeWhitespacePattern}(?:\\(${boundedCodeWhitespacePattern})?(["'\\x60])(${staticEndpointContentPattern})\\2(?:${boundedCodeWhitespacePattern}\\))?`,
  'gim',
);
const codeSshMemberPortAssignmentPattern = new RegExp(
  `(?:^|[^A-Za-z0-9_$])(${staticIdentifierPattern}[ \\t]*!?(?:(?:${boundedCodeWhitespacePattern}(?:\\?\\.)?[ \\t]*\\[[ \\t]*["'\\x60]${staticStringContentPattern}["'\\x60][ \\t]*\\])|(?:${boundedCodeWhitespacePattern}!?[ \\t]*(?:\\?\\.|\\.)[ \\t]*${staticIdentifierPattern}))+)[ \\t]*=(?!=)${boundedCodeWhitespacePattern}(?:["'\\x60](\\d{1,6})["'\\x60]|(\\d{1,6}))`,
  'gim',
);
const codeQuotedIdentityAssignmentPattern = new RegExp(
  `["']?\\b(?:${hostIdentityLabelPattern})\\b["']?${boundedCodeWhitespacePattern}(?::|=(?!=))${boundedCodeWhitespacePattern}(?:(["'\\x60])(${staticStringContentPattern})\\1|\\(${boundedCodeWhitespacePattern}(["'\\x60])(${staticStringContentPattern})\\3${boundedCodeWhitespacePattern}\\))(?!${boundedCodeWhitespacePattern}\\+)`,
  'gim',
);
const codeComputedIdentityPropertyPattern = new RegExp(
  `\\[${boundedCodeWhitespacePattern}["'\\x60](${staticStringContentPattern})["'\\x60]${boundedCodeWhitespacePattern}\\]${boundedCodeWhitespacePattern}:${boundedCodeWhitespacePattern}(?:(["'\\x60])(${staticStringContentPattern})\\2|\\(${boundedCodeWhitespacePattern}(["'\\x60])(${staticStringContentPattern})\\4${boundedCodeWhitespacePattern}\\))(?!${boundedCodeWhitespacePattern}\\+)`,
  'gim',
);
const packageNamePattern =
  '(?:node(?:[._-]?js)?|npm|pnpm|yarn|python3?|pip3?|ruby|bundler|go|rustc|cargo|solc|forge|foundry|anvil|hardhat|docker|git)';
const hostScopePattern = `(?:local|this${keyWordSeparatorPattern}(?:mac|host|machine|workstation|computer)|the${keyWordSeparatorPattern}local${keyWordSeparatorPattern}(?:mac|host|machine|workstation|computer))`;
const explicitHostScopePattern = `(?:(?:this|local)${keyWordSeparatorPattern}(?:mac|host|machine|workstation|computer)|the${keyWordSeparatorPattern}local${keyWordSeparatorPattern}(?:mac|host|machine|workstation|computer))`;
const versionValuePattern = 'v?\\d+\\.\\d+(?:\\.\\d+){0,2}';
const structuredHostPackagePattern = `["']?\\b${hostScopePattern}${keyWordSeparatorPattern}${packageNamePattern}${keyWordSeparatorPattern}version\\b${structuredAssignmentPattern}${versionValuePattern}\\b`;
const structuredEnvironmentPattern = `["']?\\b(?:environment|scope|context|target)\\b${structuredAssignmentPattern}${hostScopePattern}\\b`;
const structuredPackageVersionPattern = `["']?\\b${packageNamePattern}${keyWordSeparatorPattern}version\\b${structuredAssignmentPattern}${versionValuePattern}\\b`;
const proseHostPackagePattern = `(?:\\b${hostScopePattern}${keyWordSeparatorPattern}${packageNamePattern}\\b[^\\r\\n]{0,80}\\b${versionValuePattern}\\b|\\b${packageNamePattern}\\b(?=[^\\r\\n]{0,160}\\b(?:installed|running|available|detected|version)\\b)(?=[^\\r\\n]{0,160}\\b${explicitHostScopePattern}\\b)[^\\r\\n]{0,160}\\b${versionValuePattern}\\b|\\b${explicitHostScopePattern}\\b(?=[^\\r\\n]{0,160}\\b${packageNamePattern}\\b)[^\\r\\n]{0,160}\\b${versionValuePattern}\\b)`;
const structuredHostPackageRegex = new RegExp(structuredHostPackagePattern, 'i');
const structuredEnvironmentRegex = new RegExp(structuredEnvironmentPattern, 'i');
const structuredPackageVersionRegex = new RegExp(structuredPackageVersionPattern, 'i');
const proseHostPackageRegex = new RegExp(proseHostPackagePattern, 'i');
const structuredAuthorizedKeyInventoryPattern = `(?:["']?\\bauthorized${keyWordSeparatorPattern}keys?${keyWordSeparatorPattern}(?:count|entries)?\\b["']?${structuredAssignmentPattern}(?!null\\b)(?:\\d+|true|yes|present|\\[[\\s\\S]{0,256}?\\]|["'][^"'\\r\\n]{1,256}["']))`;
const listenerAssignmentValuePattern =
  '(?:"([^"\\r\\n]{1,256})"|\'([^\'\\r\\n]{1,256})\'|\\x60([^\\x60\\r\\n]{1,256})\\x60|([^\\s,;}]{1,256}))';
const directSshListenerAssignmentPattern = new RegExp(
  `["']?\\bssh(?:d)?${keyWordSeparatorPattern}(?:bind|(?:listen|listener)${keyWordSeparatorPattern}address)\\b["']?[ \\t]*(?::=|:|=(?!=))[ \\t]*${listenerAssignmentValuePattern}`,
  'gi',
);
const nestedSshListenerAssignmentPattern = new RegExp(
  `["']?\\bssh(?:d)?\\b["']?[ \\t]*(?:\\||:|=(?!=))[ \\t]*\\{[^}]{0,512}?["']?\\b(?:bind|(?:listen|listener)${keyWordSeparatorPattern}address)\\b["']?[ \\t]*(?::=|:|=(?!=))[ \\t]*${listenerAssignmentValuePattern}`,
  'gi',
);
const portAssignmentValuePattern = '(?:"(\\d{1,6})"|\'(\\d{1,6})\'|\\x60(\\d{1,6})\\x60|(\\d{1,6}))';
const directSshPortAssignmentPattern = new RegExp(
  `["']?\\bssh(?:d)?${keyWordSeparatorPattern}port\\b["']?[ \\t]*(?::=|:|=(?!=))[ \\t]*${portAssignmentValuePattern}`,
  'gi',
);
const nestedSshPortAssignmentPattern = new RegExp(
  `["']?\\bssh(?:d)?\\b["']?[ \\t]*(?:\\||:|=(?!=))[ \\t]*\\{[^}]{0,512}?["']?\\bport\\b["']?[ \\t]*(?::=|:|=(?!=))[ \\t]*${portAssignmentValuePattern}`,
  'gi',
);
const sshExposurePattern = new RegExp(
  [
    `["']?\\bremote${keyWordSeparatorPattern}login\\b${structuredAssignmentPattern}(?:active|enabled|on|true|yes|1)\\b`,
    `["']?\\bssh(?:d)?${keyWordSeparatorPattern}(?:enabled|active)\\b${structuredAssignmentPattern}(?:active|enabled|on|true|yes|1)\\b`,
    `["']?\\bssh(?:d)?${keyWordSeparatorPattern}status\\b${structuredAssignmentPattern}(?:active|enabled|on|true|yes|1)\\b`,
    `["']?\\bremote${keyWordSeparatorPattern}login${keyWordSeparatorPattern}status\\b${structuredAssignmentPattern}(?:active|enabled|on|true|yes|1)\\b`,
    `["']?\\bssh(?:d)?${keyWordSeparatorPattern}listening\\b["']?${structuredAssignmentPattern}(?:active|enabled|on|true|yes|1)\\b`,
    structuredAuthorizedKeyInventoryPattern,
    `["']?\\bssh(?:d)?\\b["']?[ \\t]*(?:\\||:|=(?!=))[ \\t]*\\{[^}]{0,512}?(?:["']?enabled["']?${structuredAssignmentPattern}(?:active|enabled|on|true|yes|1)\\b|${structuredAuthorizedKeyInventoryPattern}|["']?listening["']?${structuredAssignmentPattern}(?:active|enabled|on|true|yes|1)\\b)`,
    `\\bremote${keyWordSeparatorPattern}login\\b[^\\r\\n]{0,80}\\b(?:active|enabled|on)\\b`,
    `\\bsshd?\\b[^\\r\\n]{0,80}\\b(?:listen(?:er|ing|s)?|port\\s*22|tcp\\/?22)\\b`,
    `\\bauthorized${keyWordSeparatorPattern}keys?\\b[^\\r\\n]{0,80}\\b(?:contains?|count|entries?|present)\\b`,
    `\\btcp\\/?22\\b[^\\r\\n]{0,80}\\b(?:active|enabled|listen(?:er|ing|s)?|reachable)\\b`,
  ].join('|'),
  'i',
);

function codeStringContainsHostIdentity(value) {
  let quote = null;
  let escaped = false;
  let literal = '';
  for (const character of value) {
    if (quote === null) {
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        literal = '';
      }
      continue;
    }
    if (escaped) {
      literal += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if ((character === '\n' || character === '\r') && quote !== '`') {
      quote = null;
      literal = '';
      continue;
    }
    if (character === quote) {
      if (recordHostIdentityPattern.test(literal) || nestedHostIdentityPattern.test(literal)) return true;
      quote = null;
      literal = '';
      continue;
    }
    literal += character;
  }
  return (
    quote === '`' && (recordHostIdentityPattern.test(literal) || nestedHostIdentityPattern.test(literal))
  );
}

const sshFingerprintPattern = new RegExp(
  `(?:\\bSHA256:[A-Za-z0-9+/]{32,}={0,2}(?=$|[\\s,;}"'])|\\bMD5:(?:[a-f0-9]{2}:){15}[a-f0-9]{2}(?=$|[\\s,;}"']))`,
  'i',
);
const sshPublicKeyAlgorithmPattern = [
  'ecdsa-sha2-nistp(?:256|384|521)',
  'sk-ecdsa-sha2-nistp256@openssh\\.com',
  'sk-ssh-ed25519@openssh\\.com',
  'ssh-(?:dss|ed25519|rsa)',
  'ecdsa-sha2-nistp(?:256|384|521)-cert-v01@openssh\\.com',
  'sk-ecdsa-sha2-nistp256-cert-v01@openssh\\.com',
  'sk-ssh-ed25519-cert-v01@openssh\\.com',
  'ssh-(?:dss|ed25519|rsa)-cert-v01@openssh\\.com',
].join('|');
const sshPublicKeyPattern = new RegExp(
  `(?:^|\\s)(?:${sshPublicKeyAlgorithmPattern})\\s+[A-Za-z0-9+/]{32,}={0,3}(?=$|\\s)`,
  'i',
);
const hostIdentityKeys = new Set([
  'computername',
  'devicename',
  'hostname',
  'localaccount',
  'localhostname',
  'username',
]);
const hostIdentityContainers = new Set(['computer', 'device', 'host', 'user']);
const sshToken = ['s', 'sh'].join('');
const sshDaemonToken = [sshToken, 'd'].join('');
const sshContextKeys = new Set([sshToken, sshDaemonToken]);
const directSshStatusKeys = new Set([
  ['remote', 'login'].join(''),
  ['remote', 'login', 'status'].join(''),
  [sshToken, 'active'].join(''),
  [sshToken, 'enabled'].join(''),
  [sshToken, 'listening'].join(''),
  [sshToken, 'status'].join(''),
  [sshDaemonToken, 'active'].join(''),
  [sshDaemonToken, 'enabled'].join(''),
  [sshDaemonToken, 'listening'].join(''),
  [sshDaemonToken, 'status'].join(''),
]);
const directSshPortKeys = new Set([[sshToken, 'port'].join(''), [sshDaemonToken, 'port'].join('')]);
const directSshEndpointKeys = new Set(
  [sshToken, sshDaemonToken].flatMap((prefix) =>
    ['bind', 'listenaddress', 'listeneraddress'].map((suffix) => [prefix, suffix].join('')),
  ),
);
const nestedSshStatusKeys = new Set(['active', 'enabled', 'listening', 'status']);
const nestedSshEndpointKeys = new Set(['bind', 'listenaddress', 'listeneraddress']);
const authorizedKeyInventoryKeys = new Set(
  ['key', 'keys', 'keycount', 'keyscount', 'keyentries', 'keysentries'].map((suffix) =>
    ['authorized', suffix].join(''),
  ),
);

function normalizedKey(key) {
  return String(key)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function decodeStaticStringContent(value) {
  const escapedControls = new Map([
    ['0', '\0'],
    ['b', '\b'],
    ['f', '\f'],
    ['n', '\n'],
    ['r', '\r'],
    ['t', '\t'],
    ['v', '\v'],
  ]);
  return value
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hexadecimal) =>
      String.fromCodePoint(Number.parseInt(hexadecimal, 16)),
    )
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hexadecimal) =>
      String.fromCodePoint(Number.parseInt(hexadecimal, 16)),
    )
    .replace(/\\([0bfnrtv])/g, (_, escape) => escapedControls.get(escape))
    .replace(/\\(.)/g, '$1');
}

function skipBoundedCodeWhitespace(value, start) {
  let cursor = start;
  while (cursor < value.length && /[ \t\r\n]/.test(value[cursor])) cursor++;
  return { cursor, budgetExceeded: cursor - start > 64 };
}

function parseStaticStringLiteral(value, start, state) {
  const quote = value[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let cursor = start + 1;
  let raw = '';
  while (cursor < value.length) {
    const character = value[cursor];
    if (character === '\r' || character === '\n') return null;
    if (character === quote) {
      state.parts++;
      if (state.parts > maximumStaticConcatenationParts) return { budgetExceeded: true };
      const decoded = decodeStaticStringContent(raw);
      state.characters += decoded.length;
      if (state.characters > 256) return { budgetExceeded: true };
      return { budgetExceeded: false, end: cursor + 1, parts: 1, value: decoded };
    }
    if (character === '\\') {
      if (cursor + 1 >= value.length || /[\r\n]/.test(value[cursor + 1])) return null;
      if (value[cursor + 1] === 'u') {
        const escape = value.slice(cursor, cursor + 6);
        if (!/^\\u[0-9A-Fa-f]{4}$/.test(escape)) return null;
        raw += escape;
        cursor += 6;
        continue;
      }
      if (value[cursor + 1] === 'x') {
        const escape = value.slice(cursor, cursor + 4);
        if (!/^\\x[0-9A-Fa-f]{2}$/.test(escape)) return null;
        raw += escape;
        cursor += 4;
        continue;
      }
      raw += value.slice(cursor, cursor + 2);
      cursor += 2;
      continue;
    }
    if (!/[A-Za-z0-9_$ .@-]/.test(character)) return null;
    raw += character;
    cursor++;
    if (raw.length > 256) return { budgetExceeded: true };
  }
  return null;
}

function parseStaticConcatenationPrimary(value, start, state, depth) {
  const leading = skipBoundedCodeWhitespace(value, start);
  if (leading.budgetExceeded) return { budgetExceeded: true };
  const cursor = leading.cursor;
  if (value[cursor] !== '(') return parseStaticStringLiteral(value, cursor, state);
  if (depth >= maximumStaticParenthesisDepth) return { budgetExceeded: true };
  const expression = parseStaticConcatenationExpression(value, cursor + 1, state, depth + 1);
  if (!expression || expression.budgetExceeded) return expression;
  const trailing = skipBoundedCodeWhitespace(value, expression.end);
  if (trailing.budgetExceeded) return { budgetExceeded: true };
  if (value[trailing.cursor] !== ')') return null;
  return { ...expression, end: trailing.cursor + 1 };
}

function parseStaticConcatenationExpression(value, start, state, depth) {
  let expression = parseStaticConcatenationPrimary(value, start, state, depth);
  if (!expression || expression.budgetExceeded) return expression;
  while (true) {
    const trailing = skipBoundedCodeWhitespace(value, expression.end);
    if (trailing.budgetExceeded) return { budgetExceeded: true };
    if (value[trailing.cursor] !== '+') return { ...expression, end: trailing.cursor };
    const next = parseStaticConcatenationPrimary(value, trailing.cursor + 1, state, depth);
    if (!next || next.budgetExceeded) return next;
    expression = {
      budgetExceeded: false,
      end: next.end,
      parts: expression.parts + next.parts,
      value: `${expression.value}${next.value}`,
    };
  }
}

function parseStaticStringConcatenation(value, start) {
  return parseStaticConcatenationExpression(value, start, { characters: 0, parts: 0 }, 0);
}

const codeStaticIdentityValueStartPattern = new RegExp(
  `${hostIdentityAssignmentPrefix}(?=["'\\x60(])`,
  'gim',
);
const codeStaticNestedIdentityValueStartPattern = new RegExp(
  `["']?\\b(?:host|device|computer|user)\\b["']?[ \\t]*(?:\\||:|=(?!=))[ \\t]*\\{[^{}]{0,512}?["']?\\bname\\b["']?${boundedCodeWhitespacePattern}(?::|=(?!=))${boundedCodeWhitespacePattern}(?=["'\\x60(])`,
  'gim',
);
const codeComputedStaticKeyStartPattern = /\[[ \t\r\n]{0,64}(?=["'`])/g;
const codeStaticMemberChainStartPattern = new RegExp(
  `(?:^|[^A-Za-z0-9_$])(${staticIdentifierPattern})(?=[ \\t\\r\\n]{0,64}!?[ \\t\\r\\n]{0,64}(?:\\.|\\?\\.|\\[))`,
  'gm',
);
const staticIdentifierAtPattern = new RegExp(staticIdentifierPattern, 'y');

function parseStaticIdentifierAt(value, start) {
  staticIdentifierAtPattern.lastIndex = start;
  const match = staticIdentifierAtPattern.exec(value);
  if (!match) return null;
  return {
    end: staticIdentifierAtPattern.lastIndex,
    value: normalizedKey(decodeStaticStringContent(match[0])),
  };
}

function skipStaticNonNullAssertion(value, start) {
  const whitespace = skipBoundedCodeWhitespace(value, start);
  if (whitespace.budgetExceeded || value[whitespace.cursor] !== '!') return whitespace;
  return skipBoundedCodeWhitespace(value, whitespace.cursor + 1);
}

function parseStaticMemberAssignment(value, start) {
  const root = parseStaticIdentifierAt(value, start);
  if (!root) return null;
  const keys = [root.value];
  let cursor = root.end;
  let members = 0;

  while (true) {
    const assertion = skipStaticNonNullAssertion(value, cursor);
    if (assertion.budgetExceeded) return { budgetExceeded: true };
    cursor = assertion.cursor;

    let optional = false;
    if (value.startsWith('?.', cursor)) {
      optional = true;
      cursor += 2;
      const whitespace = skipBoundedCodeWhitespace(value, cursor);
      if (whitespace.budgetExceeded) return { budgetExceeded: true };
      cursor = whitespace.cursor;
    }

    if (value[cursor] === '.' && !optional) {
      cursor++;
      const whitespace = skipBoundedCodeWhitespace(value, cursor);
      if (whitespace.budgetExceeded) return { budgetExceeded: true };
      const member = parseStaticIdentifierAt(value, whitespace.cursor);
      if (!member) return null;
      members++;
      if (members > maximumStaticMemberSegments) return { budgetExceeded: true };
      keys.push(member.value);
      cursor = member.end;
      continue;
    }

    if (value[cursor] === '[') {
      const keyExpression = parseStaticStringConcatenation(value, cursor + 1);
      if (!keyExpression || keyExpression.budgetExceeded) return keyExpression;
      const trailing = skipBoundedCodeWhitespace(value, keyExpression.end);
      if (trailing.budgetExceeded) return { budgetExceeded: true };
      if (value[trailing.cursor] !== ']') return null;
      members++;
      if (members > maximumStaticMemberSegments) return { budgetExceeded: true };
      keys.push(normalizedKey(keyExpression.value));
      cursor = trailing.cursor + 1;
      continue;
    }

    if (optional) {
      const member = parseStaticIdentifierAt(value, cursor);
      if (!member) return null;
      members++;
      if (members > maximumStaticMemberSegments) return { budgetExceeded: true };
      keys.push(member.value);
      cursor = member.end;
      continue;
    }
    break;
  }

  if (members === 0) return null;
  const assignment = skipStaticNonNullAssertion(value, cursor);
  if (assignment.budgetExceeded) return { budgetExceeded: true };
  cursor = assignment.cursor;
  if (value[cursor] !== '=' || value[cursor + 1] === '=' || value[cursor + 1] === '>') return null;
  const expression = parseStaticStringConcatenation(value, cursor + 1);
  if (!expression || expression.budgetExceeded) return expression;
  return { budgetExceeded: false, expression, keys };
}

function analyzeStaticCodeIdentityConcatenations(value) {
  let scans = 0;
  let detected = false;
  let budgetExceeded = false;
  codeStaticIdentityValueStartPattern.lastIndex = 0;
  for (const match of value.matchAll(codeStaticIdentityValueStartPattern)) {
    scans++;
    if (scans > maximumStaticConcatenationScans) return { detected, budgetExceeded: true };
    const expression = parseStaticStringConcatenation(value, match.index + match[0].length);
    if (expression?.budgetExceeded) budgetExceeded = true;
    else if (expression && containsQuotedConcreteIdentity(expression.value)) detected = true;
  }

  codeStaticNestedIdentityValueStartPattern.lastIndex = 0;
  for (const match of value.matchAll(codeStaticNestedIdentityValueStartPattern)) {
    scans++;
    if (scans > maximumStaticConcatenationScans) return { detected, budgetExceeded: true };
    const expression = parseStaticStringConcatenation(value, match.index + match[0].length);
    if (expression?.budgetExceeded) budgetExceeded = true;
    else if (expression && containsQuotedConcreteIdentity(expression.value)) detected = true;
  }

  codeComputedStaticKeyStartPattern.lastIndex = 0;
  for (const match of value.matchAll(codeComputedStaticKeyStartPattern)) {
    scans++;
    if (scans > maximumStaticConcatenationScans) return { detected, budgetExceeded: true };
    const keyExpression = parseStaticStringConcatenation(value, match.index + match[0].length);
    if (keyExpression?.budgetExceeded) {
      budgetExceeded = true;
      continue;
    }
    if (!keyExpression) continue;
    const keyTrailing = skipBoundedCodeWhitespace(value, keyExpression.end);
    if (keyTrailing.budgetExceeded) {
      budgetExceeded = true;
      continue;
    }
    if (value[keyTrailing.cursor] !== ']') continue;
    const separatorLeading = skipBoundedCodeWhitespace(value, keyTrailing.cursor + 1);
    if (separatorLeading.budgetExceeded) {
      budgetExceeded = true;
      continue;
    }
    const separator = value[separatorLeading.cursor];
    if (separator !== ':' && (separator !== '=' || value[separatorLeading.cursor + 1] === '=')) continue;
    const valueExpression = parseStaticStringConcatenation(value, separatorLeading.cursor + 1);
    if (valueExpression?.budgetExceeded) {
      budgetExceeded = true;
      continue;
    }
    if (
      valueExpression &&
      hostIdentityKeys.has(normalizedKey(keyExpression.value)) &&
      containsQuotedConcreteIdentity(valueExpression.value)
    )
      detected = true;
  }

  codeStaticMemberChainStartPattern.lastIndex = 0;
  for (const match of value.matchAll(codeStaticMemberChainStartPattern)) {
    scans++;
    if (scans > maximumStaticConcatenationScans) return { detected, budgetExceeded: true };
    const start = match.index + match[0].length - match[1].length;
    const assignment = parseStaticMemberAssignment(value, start);
    if (assignment?.budgetExceeded) {
      return { detected, budgetExceeded: true };
    }
    if (!assignment) continue;
    const last = assignment.keys.at(-1);
    const identityProperty =
      hostIdentityKeys.has(last) ||
      (last === 'name' && hostIdentityContainers.has(assignment.keys.at(-2) ?? ''));
    if (identityProperty && containsQuotedConcreteIdentity(assignment.expression.value)) detected = true;
  }
  return { detected, budgetExceeded };
}

function staticMemberKeys(value) {
  const keys = [];
  const segmentPattern = new RegExp(
    `(?:^|\\?\\.|\\.)[ \\t]*(${staticIdentifierPattern})|\\[[ \\t]*["'\\x60](${staticStringContentPattern})["'\\x60][ \\t]*\\]`,
    'g',
  );
  for (const segment of value.matchAll(segmentPattern))
    keys.push(normalizedKey(decodeStaticStringContent(segment[1] ?? segment[2])));
  return keys;
}

function codeMemberContainsHostIdentity(value) {
  codeMemberLiteralAssignmentPattern.lastIndex = 0;
  for (const match of value.matchAll(codeMemberLiteralAssignmentPattern)) {
    const segments = staticMemberKeys(match[1]);
    const last = segments.at(-1);
    const nestedIdentity = last === 'name' && hostIdentityContainers.has(segments.at(-2) ?? '');
    if (
      (hostIdentityKeys.has(last) || nestedIdentity) &&
      containsQuotedConcreteIdentity(decodeStaticStringContent(match[3] ?? match[5]))
    )
      return true;
  }
  return false;
}

function codeContainsQuotedHostIdentity(value) {
  codeQuotedIdentityAssignmentPattern.lastIndex = 0;
  for (const match of value.matchAll(codeQuotedIdentityAssignmentPattern))
    if (containsQuotedConcreteIdentity(decodeStaticStringContent(match[2] ?? match[4]))) return true;

  codeComputedIdentityPropertyPattern.lastIndex = 0;
  for (const match of value.matchAll(codeComputedIdentityPropertyPattern)) {
    const key = normalizedKey(decodeStaticStringContent(match[1]));
    if (
      hostIdentityKeys.has(key) &&
      containsQuotedConcreteIdentity(decodeStaticStringContent(match[3] ?? match[5]))
    )
      return true;
  }
  return false;
}

function containsConcreteIdentity(value) {
  if (Array.isArray(value)) return value.some((item) => containsConcreteIdentity(item));
  if (typeof value !== 'string') return false;
  const normalized = value.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
  return /^(?!127\.0\.0\.1$|localhost$|string$|str$|number$|boolean$|unknown$|any$|null$|undefined$)[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/i.test(
    normalized,
  );
}

function containsQuotedConcreteIdentity(value) {
  if (Array.isArray(value)) return value.some((item) => containsQuotedConcreteIdentity(item));
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) return false;
  if (new RegExp(`^${identityPlaceholderPattern}$`, 'i').test(normalized)) return false;
  return /^[A-Za-z0-9](?:[A-Za-z0-9._@-]|[ \t](?=[A-Za-z0-9])){0,127}$/.test(normalized);
}

function isEnabledValue(value) {
  return value === true || value === 1 || /^(?:active|enabled|on|true|yes|1)$/i.test(String(value));
}

function isSshPort(value) {
  const port = typeof value === 'number' ? value : /^\d{1,5}$/.test(String(value)) ? Number(value) : 0;
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function isIpAddress(value) {
  if (!value.includes('%')) return isIP(value) !== 0;
  const zone = /^([^%]+)%([A-Za-z0-9_.-]{1,64})$/.exec(value);
  return Boolean(zone && isIP(zone[1]) === 6);
}

function isListenerEndpoint(value) {
  if (typeof value !== 'string') return false;
  const endpoint = value.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
  if (
    /^(?:any|boolean|disabled|false|none|null|number|off|string|str|unknown|undefined|not[-_ ]?configured)$/i.test(
      endpoint,
    )
  )
    return false;
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(endpoint);
  if (bracketed) return isIpAddress(bracketed[1]) && (!bracketed[2] || isSshPort(bracketed[2]));
  if (isIpAddress(endpoint)) return true;
  const hostAndPort = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})(?::(\d{1,5}))?$/.exec(endpoint);
  if (!hostAndPort || (hostAndPort[2] && !isSshPort(hostAndPort[2]))) return false;
  if (/^[\d.]+$/.test(hostAndPort[1]) && isIP(hostAndPort[1]) !== 4) return false;
  return true;
}

function containsSemanticSshListener(value) {
  for (const pattern of [directSshListenerAssignmentPattern, nestedSshListenerAssignmentPattern]) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const endpoint = decodeStaticStringContent(match.slice(1).find((item) => item !== undefined));
      if (isListenerEndpoint(endpoint)) return true;
    }
  }
  codeSshMemberListenerAssignmentPattern.lastIndex = 0;
  for (const match of value.matchAll(codeSshMemberListenerAssignmentPattern)) {
    const keys = staticMemberKeys(match[1]);
    const last = keys.at(-1);
    const endpointProperty =
      directSshEndpointKeys.has(last) ||
      (sshContextKeys.has(keys.at(-2) ?? '') && nestedSshEndpointKeys.has(last));
    if (endpointProperty && isListenerEndpoint(decodeStaticStringContent(match[3]))) return true;
  }
  return false;
}

function containsSemanticSshPort(value) {
  for (const pattern of [directSshPortAssignmentPattern, nestedSshPortAssignmentPattern]) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const port = match.slice(1).find((item) => item !== undefined);
      if (isSshPort(port)) return true;
    }
  }
  codeSshMemberPortAssignmentPattern.lastIndex = 0;
  for (const match of value.matchAll(codeSshMemberPortAssignmentPattern)) {
    const keys = staticMemberKeys(match[1]);
    const last = keys.at(-1);
    const portProperty =
      directSshPortKeys.has(last) || (sshContextKeys.has(keys.at(-2) ?? '') && last === 'port');
    if (portProperty && isSshPort(match[2] ?? match[3])) return true;
  }
  return false;
}

function hasAuthorizedKeyInventory(key, value) {
  if (!authorizedKeyInventoryKeys.has(key)) return false;
  if (value === null || value === false || value === 0 || value === '0' || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

function isSshExposureProperty(key, value, sshContext) {
  return (
    (directSshStatusKeys.has(key) && isEnabledValue(value)) ||
    (directSshPortKeys.has(key) && isSshPort(value)) ||
    (directSshEndpointKeys.has(key) && isListenerEndpoint(value)) ||
    (sshContext && nestedSshStatusKeys.has(key) && isEnabledValue(value)) ||
    (sshContext && key === 'port' && isSshPort(value)) ||
    (sshContext && nestedSshEndpointKeys.has(key) && isListenerEndpoint(value)) ||
    hasAuthorizedKeyInventory(key, value)
  );
}

function inspectJsonObjectKeys(text) {
  const stack = [];
  let properties = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      let escaped = false;
      for (index++; index < text.length; index++) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (text[index] === '\\') {
          escaped = true;
          continue;
        }
        if (text[index] === '"') break;
      }
      const context = stack.at(-1);
      if (!context || context.type !== 'object' || !context.expectingKey) continue;
      let cursor = index + 1;
      while (/\s/.test(text[cursor] ?? '')) cursor++;
      if (text[cursor] !== ':') continue;
      properties++;
      if (properties > maximumStructuredProperties) return { duplicate: false, budgetExceeded: true };
      const key = JSON.parse(text.slice(start, index + 1));
      if (context.keys.has(key)) return { duplicate: true, budgetExceeded: false };
      context.keys.add(key);
      context.expectingKey = false;
      continue;
    }
    if (character === '{' || character === '[') {
      if (stack.length > maximumStructuredDepth) return { duplicate: false, budgetExceeded: true };
      stack.push(
        character === '{' ? { type: 'object', keys: new Set(), expectingKey: true } : { type: 'array' },
      );
      continue;
    }
    if (character === '}' || character === ']') {
      stack.pop();
      continue;
    }
    if (character === ',') {
      const context = stack.at(-1);
      if (context?.type === 'object') context.expectingKey = true;
    }
  }
  return { duplicate: false, budgetExceeded: false };
}

function analyzeStructuredRecord(text) {
  const normalizedText = text.trim();
  let root;
  try {
    root = JSON.parse(normalizedText);
  } catch {
    return { parsed: false, kinds: [] };
  }
  const found = new Set();
  const keyInspection = inspectJsonObjectKeys(normalizedText);
  if (keyInspection.duplicate) found.add('duplicate-json-key');
  if (keyInspection.budgetExceeded) found.add('structured-record-budget');
  if (!root || typeof root !== 'object') return { parsed: true, kinds: [...found] };
  const stack = [{ value: root, depth: 0, hostIdentityContext: false, sshContext: false }];
  let properties = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.depth > maximumStructuredDepth) {
      found.add('structured-record-budget');
      continue;
    }
    if (typeof current.value === 'string') {
      if (recordHostIdentityPattern.test(current.value)) found.add('host-identity');
      if (sshExposurePattern.test(current.value)) found.add('ssh-exposure');
      if (sshFingerprintPattern.test(current.value)) found.add('ssh-fingerprint');
      if (sshPublicKeyPattern.test(current.value)) found.add('ssh-public-key');
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) {
      properties += current.value.length;
      if (properties > maximumStructuredProperties) {
        found.add('structured-record-budget');
        stack.length = 0;
        break;
      }
      for (const item of current.value) stack.push({ ...current, value: item, depth: current.depth + 1 });
      continue;
    }
    for (const [rawKey, item] of Object.entries(current.value)) {
      properties++;
      if (properties > maximumStructuredProperties) {
        found.add('structured-record-budget');
        stack.length = 0;
        break;
      }
      const key = normalizedKey(rawKey);
      if (
        (hostIdentityKeys.has(key) || (current.hostIdentityContext && key === 'name')) &&
        containsQuotedConcreteIdentity(item)
      )
        found.add('host-identity');

      if (isSshExposureProperty(key, item, current.sshContext)) found.add('ssh-exposure');

      if (typeof item === 'string') {
        if (recordHostIdentityPattern.test(item)) found.add('host-identity');
        if (sshExposurePattern.test(item)) found.add('ssh-exposure');
        if (sshFingerprintPattern.test(item)) found.add('ssh-fingerprint');
        if (sshPublicKeyPattern.test(item)) found.add('ssh-public-key');
      }
      if (item && typeof item === 'object') {
        stack.push({
          value: item,
          depth: current.depth + 1,
          hostIdentityContext: current.hostIdentityContext || hostIdentityContainers.has(key),
          sshContext: current.sshContext || sshContextKeys.has(key),
        });
      }
    }
  }
  return { parsed: true, kinds: [...found] };
}

function stripRecordComment(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote === '"') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : (quote ?? character);
      continue;
    }
    if (character === '#' && quote === null && (index === 0 || /\s/.test(value[index - 1])))
      return value.slice(0, index).trimEnd();
  }
  return value;
}

function parseRecordScalar(rawValue) {
  const value = stripRecordComment(rawValue).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (/^(?:true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^(?:null|~)$/i.test(value)) return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === '[]') return [];
  return value;
}

function parseIndentedAssignment(body) {
  const assignment =
    /^(?:"((?:\\[^\r\n]|[^"\\\r\n]){1,512})"|'((?:(?:'')|[A-Za-z0-9_. -]){1,128})'|([A-Za-z][A-Za-z0-9_. -]{0,127}))[ \t]*(?::=|:|=(?!=))[ \t]*(.*)$/.exec(
      body,
    );
  if (!assignment) return null;
  let key = assignment[1] ?? assignment[2] ?? assignment[3];
  if (assignment[1] !== undefined) {
    try {
      key = JSON.parse(`"${assignment[1]}"`);
    } catch {
      return { budgetExceeded: true };
    }
  }
  if (assignment[2] !== undefined) key = assignment[2].replace(/''/g, "'");
  if (typeof key !== 'string' || key.length === 0 || key.length > 128) return { budgetExceeded: true };
  return { budgetExceeded: false, key: normalizedKey(key), rawValue: assignment[4] };
}

function isSensitiveYamlLeaf(key, hostIdentityContext, sshContext) {
  const identityLeaf = hostIdentityKeys.has(key) || (hostIdentityContext && key === 'name');
  const sshLeaf =
    directSshStatusKeys.has(key) ||
    directSshPortKeys.has(key) ||
    directSshEndpointKeys.has(key) ||
    authorizedKeyInventoryKeys.has(key) ||
    (sshContext && (nestedSshStatusKeys.has(key) || key === 'port' || nestedSshEndpointKeys.has(key)));
  return identityLeaf || sshLeaf;
}

function isAmbiguousYamlScalar(rawValue) {
  return (
    /^[|>]/.test(rawValue) ||
    /^[*&!]/.test(rawValue) ||
    /^\[(?!\s*\]$)/.test(rawValue) ||
    /^\{/.test(rawValue)
  );
}

function isAsciiAlphaNumeric(character) {
  const code = character?.charCodeAt(0) ?? -1;
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isYamlAnnotationCharacter(character, marker) {
  if (isAsciiAlphaNumeric(character) || character === '_' || character === '.' || character === '-')
    return true;
  return marker === '!' && (character === '!' || character === '/' || character === ':');
}

function isYamlContainerAnnotation(rawValue) {
  let cursor = 0;
  let annotations = 0;
  while (cursor < rawValue.length) {
    const marker = rawValue[cursor];
    if (marker !== '&' && marker !== '!') return false;
    cursor++;
    const valueStart = cursor;
    while (cursor < rawValue.length && isYamlAnnotationCharacter(rawValue[cursor], marker)) cursor++;
    if (cursor === valueStart) return false;
    annotations++;
    while (rawValue[cursor] === ' ' || rawValue[cursor] === '\t') cursor++;
  }
  return annotations > 0;
}

function analyzeIndentedRecord(text) {
  const found = new Set();
  if (text.length > maximumTextBytes) return ['structured-record-budget'];
  const lines = text.split(/\r?\n/);
  if (lines.length > maximumStructuredProperties) return ['structured-record-budget'];
  const contexts = [];
  let properties = 0;
  for (const line of lines) {
    const indentation = /^[ \t]*/.exec(line)[0];
    let body = line.slice(indentation.length);
    if (!body || body.startsWith('#')) continue;
    if (indentation.includes('\t') || indentation.length > 256) {
      if (/^["']?[A-Za-z]/.test(body)) found.add('structured-record-budget');
      continue;
    }
    const sequenceItem = /^-[ \t]+/.exec(body);
    if (sequenceItem) body = body.slice(sequenceItem[0].length);
    const structuralIndent = indentation.length + (sequenceItem?.[0].length ?? 0);
    while (contexts.length > 0 && contexts.at(-1).indent >= structuralIndent) contexts.pop();
    const parent = contexts.at(-1);
    const merge =
      /^(?:["']<<["']|<<)[ \t]*:[ \t]*(?:\*[A-Za-z0-9_.-]+|\[[^\]\r\n]{1,256}\])[ \t]*(?:#.*)?$/.exec(body);
    if (merge) {
      if (parent?.hostIdentityContext) found.add('host-identity');
      if (parent?.sshContext) found.add('ssh-exposure');
      continue;
    }
    const assignment = parseIndentedAssignment(body);
    if (!assignment) continue;
    if (assignment.budgetExceeded) {
      found.add('structured-record-budget');
      continue;
    }
    properties++;
    if (properties > maximumStructuredProperties) {
      found.add('structured-record-budget');
      break;
    }
    const key = assignment.key;
    const rawValue = stripRecordComment(assignment.rawValue).trim();
    const hostIdentityContext = parent?.hostIdentityContext ?? false;
    const sshContext = parent?.sshContext ?? false;
    if (isSensitiveYamlLeaf(key, hostIdentityContext, sshContext) && isAmbiguousYamlScalar(rawValue)) {
      found.add('structured-record-budget');
      continue;
    }
    const sensitiveFlowSequence =
      rawValue !== '[]' &&
      rawValue.startsWith('[') &&
      (hostIdentityContext || sshContext || hostIdentityContainers.has(key) || sshContextKeys.has(key));
    if (sensitiveFlowSequence) {
      found.add('structured-record-budget');
      continue;
    }
    const containerAnnotation = rawValue === '' || isYamlContainerAnnotation(rawValue);
    if (containerAnnotation) {
      if (contexts.length >= maximumStructuredDepth) {
        found.add('structured-record-budget');
        continue;
      }
      contexts.push({
        indent: structuralIndent,
        hostIdentityContext: hostIdentityContext || hostIdentityContainers.has(key),
        sshContext: sshContext || sshContextKeys.has(key),
      });
      continue;
    }
    if (/^\*[A-Za-z0-9_.-]+$/.test(rawValue)) {
      if (hostIdentityContainers.has(key)) found.add('host-identity');
      if (sshContextKeys.has(key)) found.add('ssh-exposure');
      continue;
    }
    const value = parseRecordScalar(rawValue);
    const quotedValue =
      rawValue.length >= 2 && (rawValue[0] === '"' || rawValue[0] === "'") && rawValue.at(-1) === rawValue[0];
    if (
      (hostIdentityKeys.has(key) || (hostIdentityContext && key === 'name')) &&
      (quotedValue ? containsQuotedConcreteIdentity(value) : containsConcreteIdentity(value))
    )
      found.add('host-identity');
    if (isSshExposureProperty(key, value, sshContext)) found.add('ssh-exposure');
  }
  return [...found];
}

const detectors = Object.freeze([
  ['home-path', /\/(?:Users|home)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?=\/|\s|`|$)/],
  ['host-identity', recordHostIdentityPattern],
  [
    'private-network',
    /\b(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})\b/,
  ],
  ['ssh-exposure', sshExposurePattern],
  ['ssh-fingerprint', sshFingerprintPattern],
  ['ssh-public-key', sshPublicKeyPattern],
]);

function contained(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function decodeJsonStringToken(value, start) {
  if (value[start] !== '"') return null;
  let escaped = false;
  for (let cursor = start + 1; cursor < value.length; cursor++) {
    const character = value[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '\r' || character === '\n') return { end: cursor + 1, decoded: null };
    if (character !== '"') continue;
    const end = cursor + 1;
    try {
      const decoded = JSON.parse(value.slice(start, end));
      return { end, decoded: typeof decoded === 'string' ? decoded : null };
    } catch {
      return { end, decoded: null };
    }
  }
  return { end: value.length, decoded: null };
}

function looksLikeStructuredEncoding(value) {
  try {
    const decoded = JSON.parse(value.trim());
    return typeof decoded === 'string' || Boolean(decoded && typeof decoded === 'object');
  } catch {
    return false;
  }
}

function boundedTextVariants(value) {
  const variants = [];
  const queue = [{ depth: 0, value }];
  const seen = new Set([value]);
  let decodedBytes = Buffer.byteLength(value, 'utf8');
  let scans = 0;
  let budgetExceeded = false;

  const enqueue = (candidate, depth) => {
    if (candidate === '' || seen.has(candidate)) return;
    const bytes = Buffer.byteLength(candidate, 'utf8');
    if (bytes > maximumTextBytes || decodedBytes + bytes > maximumDecodedTextBytes) {
      budgetExceeded = true;
      return;
    }
    seen.add(candidate);
    decodedBytes += bytes;
    queue.push({ depth, value: candidate });
  };

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const current = queue[queueIndex];
    variants.push(current.value);
    const firstNonWhitespace = current.value.search(/\S/);
    const lastNonWhitespace = current.value.search(/\s*$/);
    let decodedTokenFound = false;

    for (let cursor = 0; cursor < current.value.length; cursor++) {
      if (current.value[cursor] !== '"') continue;
      scans++;
      if (scans > maximumEmbeddedJsonStringScans) {
        budgetExceeded = true;
        break;
      }
      const token = decodeJsonStringToken(current.value, cursor);
      if (!token) continue;
      if (token.decoded !== null && token.decoded !== current.value) {
        decodedTokenFound = true;
        const wholeValue = cursor === firstNonWhitespace && token.end === lastNonWhitespace;
        if (current.depth >= maximumEncodedStringLayers) {
          if (wholeValue || looksLikeStructuredEncoding(token.decoded)) budgetExceeded = true;
        } else {
          enqueue(token.decoded, current.depth + 1);
        }
      }
      cursor = Math.max(cursor, token.end - 1);
    }

    if (!decodedTokenFound && current.value.includes('\\"')) {
      const unescaped = current.value.replace(/\\"/g, '"');
      if (current.depth >= maximumEncodedStringLayers) {
        if (unescaped !== current.value && looksLikeStructuredEncoding(unescaped)) budgetExceeded = true;
      } else {
        enqueue(unescaped, current.depth + 1);
      }
    }
  }
  return { budgetExceeded, variants };
}

export function findOperationalMetadataKinds(text, file = '') {
  const value = String(text);
  file = String(file);
  if (Buffer.byteLength(value, 'utf8') > maximumTextBytes) return ['structured-record-budget'];
  const codeSource =
    /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|swift|rb|php|cs|c|cc|cpp|h|hpp|sh|bash|zsh)$/i.test(file);
  const shellSource = /\.(?:sh|bash|zsh)$/i.test(file);
  const normalized = boundedTextVariants(value);
  const found = new Set();
  if (normalized.budgetExceeded) found.add('structured-record-budget');
  for (const variant of normalized.variants) {
    const concatenations = codeSource ? analyzeStaticCodeIdentityConcatenations(variant) : null;
    if (concatenations?.detected) found.add('host-identity');
    if (concatenations?.budgetExceeded) {
      found.add('structured-record-budget');
      continue;
    }
    const structured = analyzeStructuredRecord(variant);
    for (const kind of structured.kinds) found.add(kind);
    if (!structured.parsed && !codeSource) for (const kind of analyzeIndentedRecord(variant)) found.add(kind);
    if (containsSemanticSshListener(variant)) found.add('ssh-exposure');
    if (containsSemanticSshPort(variant)) found.add('ssh-exposure');
    for (const [kind, defaultPattern] of detectors) {
      if (structured.parsed && (kind === 'host-identity' || kind === 'ssh-exposure')) continue;
      const detected =
        kind === 'host-identity' && codeSource
          ? (shellSource && recordHostIdentityPattern.test(variant)) ||
            codeHostIdentityPattern.test(variant) ||
            nestedCodeHostIdentityPattern.test(variant) ||
            codeMemberContainsHostIdentity(variant) ||
            codeContainsQuotedHostIdentity(variant) ||
            codeStringContainsHostIdentity(variant)
          : defaultPattern.test(variant);
      if (detected) found.add(kind);
    }
    if (!structured.parsed && !codeSource && nestedHostIdentityPattern.test(variant))
      found.add('host-identity');
    if (
      structuredHostPackageRegex.test(variant) ||
      proseHostPackageRegex.test(variant) ||
      (structuredEnvironmentRegex.test(variant) && structuredPackageVersionRegex.test(variant))
    )
      found.add('host-package-version');
  }
  return [
    'home-path',
    'host-identity',
    'private-network',
    'ssh-exposure',
    'ssh-fingerprint',
    'ssh-public-key',
    'host-package-version',
    'duplicate-json-key',
    'structured-record-budget',
  ].filter((kind) => found.has(kind));
}

function isCombinableProfile(kinds) {
  const present = new Set(kinds);
  const workstationProfile = ['home-path', 'host-identity', 'private-network'].every((kind) =>
    present.has(kind),
  );
  const remoteAccessProfile = ['private-network', 'ssh-exposure'].every((kind) => present.has(kind));
  return workstationProfile || remoteAccessProfile;
}

function relatedRecordGroup(file) {
  if (!/\.(?:json|md|txt|ya?ml)$/i.test(file)) return null;
  if (file.startsWith('docs/management/')) return 'docs/management';
  return dirname(file);
}

function repositoryFiles(root) {
  const env = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    PATH: process.env.PATH,
  };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  const output = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    env,
    maxBuffer: maximumGitOutputBytes,
    shell: false,
    timeout: 10_000,
    windowsHide: true,
  });
  const files = [...new Set(output.split('\0').filter(Boolean))];
  if (files.length > maximumFiles) throw new Error('Public metadata scan exceeded file limit');
  return files;
}

export function sameFileIdentity(first, second) {
  return (
    typeof first.dev === 'bigint' &&
    typeof first.ino === 'bigint' &&
    first.dev >= 0n &&
    first.ino > 0n &&
    first.dev === second.dev &&
    first.ino === second.ino
  );
}

export async function scanPublicMetadata(root) {
  // Windows has no O_NOFOLLOW. Reject links and verify a stable file identity
  // against the original path and opened handle before reading any bytes.
  const noFollow = Number.isInteger(constants.O_NOFOLLOW)
    ? constants.O_NOFOLLOW
    : process.platform === 'win32'
      ? 0
      : null;
  if (noFollow === null) throw new Error('Public metadata scan requires supported file identity protection');
  const realRoot = await realpath(root);
  const failures = [];
  const relatedRecords = new Map();
  let scanned = 0;
  let totalTextBytes = 0;
  for (const file of repositoryFiles(realRoot)) {
    const candidate = resolve(realRoot, file);
    if (!contained(realRoot, candidate)) {
      failures.push(`${file}: path-outside-repository`);
      continue;
    }
    let pathMetadata;
    try {
      pathMetadata = await lstat(candidate, { bigint: true });
    } catch {
      failures.push(`${file}: unreadable-path`);
      continue;
    }
    if (pathMetadata.isSymbolicLink()) {
      failures.push(`${file}: symbolic-link-not-allowed`);
      continue;
    }
    let resolved;
    try {
      resolved = await realpath(candidate);
    } catch {
      failures.push(`${file}: unreadable-path`);
      continue;
    }
    if (!contained(realRoot, resolved) || resolved !== candidate) {
      failures.push(`${file}: path-outside-repository`);
      continue;
    }
    let handle;
    try {
      handle = await open(candidate, constants.O_RDONLY | noFollow);
    } catch {
      failures.push(`${file}: unreadable-path`);
      continue;
    }
    try {
      const metadata = await handle.stat({ bigint: true });
      const openedPathMetadata = await lstat(candidate, { bigint: true });
      const openedResolved = await realpath(candidate);
      if (
        openedPathMetadata.isSymbolicLink() ||
        !sameFileIdentity(pathMetadata, metadata) ||
        !sameFileIdentity(metadata, openedPathMetadata) ||
        openedResolved !== candidate ||
        !contained(realRoot, openedResolved)
      ) {
        failures.push(`${file}: path-changed-during-scan`);
        continue;
      }
      if (!metadata.isFile()) continue;
      if (metadata.size > BigInt(maximumTextBytes)) {
        failures.push(`${file}: text-file-too-large`);
        continue;
      }
      const expectedSize = Number(metadata.size);
      if (totalTextBytes + expectedSize > maximumTotalTextBytes) {
        failures.push(`${file}: total-text-budget-exceeded`);
        break;
      }
      const buffer = Buffer.alloc(expectedSize + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const finalMetadata = await handle.stat({ bigint: true });
      const finalPathMetadata = await lstat(candidate, { bigint: true });
      const finalResolved = await realpath(candidate);
      if (
        offset !== expectedSize ||
        finalMetadata.dev !== metadata.dev ||
        finalMetadata.ino !== metadata.ino ||
        finalMetadata.size !== metadata.size ||
        finalMetadata.mtimeNs !== metadata.mtimeNs ||
        finalMetadata.ctimeNs !== metadata.ctimeNs ||
        finalPathMetadata.isSymbolicLink() ||
        finalPathMetadata.dev !== metadata.dev ||
        finalPathMetadata.ino !== metadata.ino ||
        finalResolved !== candidate ||
        !contained(realRoot, finalResolved)
      ) {
        failures.push(`${file}: file-changed-during-scan`);
        continue;
      }
      totalTextBytes += offset;
      const bytes = buffer.subarray(0, offset);
      scanned++;
      if (bytes.includes(0)) {
        failures.push(`${file}: file-contains-nul`);
        continue;
      }
      const kinds = findOperationalMetadataKinds(bytes.toString('utf8'), file);
      if (kinds.length > 0) failures.push(`${file}: ${kinds.join(',')}`);
      if (kinds.length > 0) {
        const group = relatedRecordGroup(file);
        if (group) relatedRecords.set(group, [...(relatedRecords.get(group) ?? []), { file, kinds }]);
      }
    } catch {
      failures.push(`${file}: unreadable-path`);
      continue;
    } finally {
      await handle.close().catch(() => {});
    }
  }
  for (const records of relatedRecords.values()) {
    const combinedKinds = [...new Set(records.flatMap((record) => record.kinds))];
    if (!isCombinableProfile(combinedKinds)) continue;
    for (const record of records) failures.push(`${record.file}: ${record.kinds.join(',')}`);
  }
  const uniqueFailures = [...new Set(failures)];
  if (uniqueFailures.length > 0)
    throw new Error(`Public operational metadata detected (values withheld):\n${uniqueFailures.join('\n')}`);
  console.log(
    `Public metadata baseline passed: ${scanned} bounded repository files; no prohibited operational profile.`,
  );
}

if (
  process.argv[1] &&
  relative(fileURLToPath(new URL('.', import.meta.url)), resolve(process.argv[1])) ===
    'check-public-metadata.mjs'
) {
  try {
    await scanPublicMetadata(fileURLToPath(new URL('../', import.meta.url)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { randomUUID } from 'node:crypto';

const exactSensitiveKeyPattern = /^(?:api[_-]?key|auth|code)$/i;
const credentialSchemeKeyPattern = /^(?:basic|bearer|digest|dpop|jwt|negotiate|[a-z0-9_.-]*oauth|token)$/i;
const diagnosticCodeKeyPattern = /^code$/i;
const privateKeyPattern =
  /-----BEGIN ((?:[A-Z0-9][A-Z0-9 -]{0,62} )?PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g;
const githubTokenPattern = /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g;
const cloudTokenPattern = /\bAKIA[A-Z0-9]{16}\b/g;
const authorizationSchemePattern =
  /\b(authorization\s*[:=]\s*)(?:basic|bearer|digest|dpop|negotiate|oauth|token)\s+[^\r\n]+/gi;
const standaloneAuthorizationSchemePattern =
  /\b(basic|bearer|digest|dpop|negotiate|oauth|token)\s+[^\r\n]+/gi;
const authorizationChallengeAssignmentPattern =
  /(?:^|[,\s])(?:algorithm|cnonce|credential|nc|nonce|oauth_[a-z0-9_]{1,64}|opaque|proof|qop|realm|response|token|uri|username)\s*=/i;
const authorizationOpaqueTokenPattern = /([-A-Za-z0-9._~+/=]{12,262144})/g;
const authorizationMetadataKeyPattern =
  /^(?:auth|authentication|authorization)(?:method|provider|scheme|type)$/i;
const cookieHeaderPattern = /\b((?:set-)?cookie)\s*[:=]\s*[^\r\n]*(?:(?:\r\n|\r|\n)[ \t]+[^\r\n]*)*/gi;
const sshPublicKeyLinePattern =
  /(?<![A-Za-z0-9@._-])(?:ssh-(?:dss|ed25519|rsa)|sk-(?:ecdsa-sha2-nistp256|ssh-ed25519)@openssh\.com|ecdsa-sha2-nistp(?:256|384|521)|(?:ssh-(?:dss|ed25519|rsa)|sk-(?:ecdsa-sha2-nistp256|ssh-ed25519)|ecdsa-sha2-nistp(?:256|384|521))-cert-v01@openssh\.com)\s+[A-Za-z0-9+/]{32,262144}={0,3}(?=$|[ \t\r\n])[^\r\n]*/gi;
const foldedRedactionContinuationPattern = /(\[REDACTED\])(?:(?:\r\n|\r|\n)[ \t]+[^\r\n]*)+/g;
const escapedAuthorizationContainerPattern =
  /\\?"authorization\\?"\s*[:=]\s*(?:\{[^\r\n]{0,4096}?\}|\[[^\r\n]{0,4096}?\])/gi;
const homePathPattern = /\/(?:Users|home)\/[^/\s]+/g;
const safeSensitiveObjectKeyPattern =
  /^(?:access[_-]?token|api[_-]?key|auth|auth[_-]?header|authorization|authorization[_-]?code|client[_-]?assertion|client[_-]?secret|code|code[_-]?verifier|cookie|credential|device[_-]?code|encryption[_-]?key|id[_-]?token|mnemonic|oauth[_-]?signature|oauth[_-]?token(?:[_-]?secret)?|otp|passphrase|password|private[_-]?key|recovery[_-]?code|refresh[_-]?token|secret|secrets|seed(?:phrase)?|set[_-]?cookie|signature|signatures|signing[_-]?key|token)$/i;
const maximumEmbeddedJsonCharacters = 262_144;
const maximumEncodedJsonDepth = 8;
const maximumUrlsPerString = 1024;
const maximumNestedUrlsPerComponent = 32;
const maximumNestedUrlDepth = 4;
const maximumPercentDecodeDepth = 8;
const safeDiagnosticCodes = new Set([
  'BROKEN_INTERNAL_LINK',
  'DATA_SOURCE_ERROR',
  'OPTIONAL_SOURCE_NOT_AVAILABLE',
  'STALE_CHECK_EVIDENCE',
]);
const sensitiveTokenPairs = new Set([
  'access:token',
  'api:credential',
  'api:key',
  'authorization:code',
  'client:assertion',
  'client:secret',
  'code:verifier',
  'device:code',
  'encryption:key',
  'id:token',
  'oauth:signature',
  'oauth:token',
  'private:key',
  'refresh:token',
  'recovery:code',
  'seed:phrase',
  'secret:key',
  'signing:key',
]);
const compactSensitiveKeys = new Set(
  [...sensitiveTokenPairs].flatMap((pair) => {
    const [prefix, suffix] = pair.split(':');
    return [`${prefix}${suffix}`, `${prefix}${suffix}s`];
  }),
);
const exactSensitiveTokens = new Set([
  'auth',
  'authentication',
  'authorization',
  'authn',
  'authz',
  'cookie',
  'credential',
  'mnemonic',
  'otp',
  'passcode',
  'passphrase',
  'password',
  'secret',
  'seed',
  'signature',
  'token',
]);
const safeSecurityMetadataSuffixes = new Set([
  'active',
  'algorithm',
  'count',
  'enabled',
  'entries',
  'method',
  'mode',
  'policy',
  'present',
  'provider',
  'required',
  'result',
  'scheme',
  'status',
  'type',
]);
const safeSecurityMetadataPrefixes = new Set([
  'access:token',
  'api:key',
  'auth',
  'authentication',
  'authorization',
  'authn',
  'authz',
  'basic',
  'bearer',
  'client:assertion',
  'client:oauth',
  'client:secret',
  'code',
  'code:verifier',
  'cookie',
  'credential',
  'device:code',
  'digest',
  'dpop',
  'encryption:key',
  'id:token',
  'jwt',
  'mnemonic',
  'negotiate',
  'oauth',
  'oauth:signature',
  'oauth:token',
  'otp',
  'passcode',
  'passphrase',
  'password',
  'private:key',
  'provider:oauth',
  'recovery:code',
  'refresh:token',
  'secret',
  'seed',
  'seed:phrase',
  'signature',
  'signing:key',
  'token',
]);
const privateJwkMemberKeysByType = new Map([
  ['oct', new Set(['k'])],
  ['RSA', new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'])],
  ['EC', new Set(['d'])],
  ['OKP', new Set(['d'])],
]);
const noPrivateJwkMemberKeys = new Set();
const scalarAssignmentPrefixPattern =
  /(^|[^A-Za-z0-9_.[\]-])(?:([A-Za-z][A-Za-z0-9_.[\]-]{0,262142})|(["'])([^"'\\\r\n]{1,262143})\3|\\?"([^"\\\r\n]{1,262143})\\?")\s*([=:])[ \t]*/i;
const multiwordAssignmentPattern =
  /(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_.[\]-]{0,63}(?:[ \t]+[A-Za-z][A-Za-z0-9_.[\]-]{0,63}){1,3})[ \t]*([=:])[ \t]*/i;
const cliFlagPattern =
  /(^|[ \t])--([A-Za-z][A-Za-z0-9_.-]{0,262142})([ \t]+)("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s]+)/gi;
const cliEqualsFlagPattern =
  /(^|[ \t])--([A-Za-z][A-Za-z0-9_.-]{0,262142})(=)[ \t]*("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s]+)/gi;
const urlPattern = /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>]+/gi;
const networkPathCredentialPattern = /(^|[\s=(,;])(\/\/[^\s"'<>/:]+:[^\s"'<>/@]+@[^\s"'<>]+)/gi;

function sanitizeUrl(raw, depth = 0) {
  if (depth > maximumNestedUrlDepth) return { value: '[REDACTED NESTED URL]', redacted: true };
  try {
    const networkPath = raw.startsWith('//');
    const parsed = networkPath ? new URL(raw, 'https://relative.invalid') : new URL(raw);
    let redacted = parsed.username.length > 0 || parsed.password.length > 0;
    parsed.username = '';
    parsed.password = '';
    const path = sanitizeUrlComponent(parsed.pathname, depth, true);
    if (path.redacted) {
      parsed.pathname = path.value;
      redacted = true;
    }
    const query = redactUrlParameters(parsed.searchParams, depth);
    if (query.redacted) parsed.search = query.parameters.toString();
    redacted ||= query.redacted;
    if (parsed.hash.length > 1) {
      const fragment = parsed.hash.slice(1);
      const queryStart = fragment.indexOf('?');
      let prefix = '';
      let prefixRedacted = false;
      if (queryStart !== -1) {
        const sanitizedPrefix = sanitizeUrlComponent(fragment.slice(0, queryStart), depth);
        prefix = `${sanitizedPrefix.value}?`;
        prefixRedacted = sanitizedPrefix.redacted;
        redacted ||= prefixRedacted;
      }
      const parameters = new URLSearchParams(queryStart === -1 ? fragment : fragment.slice(queryStart + 1));
      const sanitized = redactUrlParameters(parameters, depth);
      if (prefixRedacted || sanitized.redacted) parsed.hash = `${prefix}${sanitized.parameters.toString()}`;
      redacted ||= sanitized.redacted;
    }
    const value = parsed.toString();
    return { value: networkPath ? value.replace(/^https:/, '') : value, redacted };
  } catch {
    return { value: '[REDACTED MALFORMED URL]', redacted: true };
  }
}

function decodePercentLayers(value) {
  let decoded = value;
  for (let depth = 0; depth < maximumPercentDecodeDepth; depth++) {
    if (!/%[0-9a-f]{2}/i.test(decoded)) return { value: decoded, complete: true };
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return { value: decoded, complete: true };
      decoded = next;
    } catch {
      return { value: '', complete: false };
    }
  }
  return { value: decoded, complete: !/%[0-9a-f]{2}/i.test(decoded) };
}

function sanitizeUrlComponent(value, depth) {
  const decoded = decodePercentLayers(value);
  if (!decoded.complete) return { value: '[REDACTED ENCODED COMPONENT]', redacted: true };
  const sanitized = scrubNonUrlSecrets(decoded.value, {
    sanitizeNestedUrls: true,
    urlDepth: depth + 1,
  });
  return sanitized.redacted ? sanitized : { value, redacted: false };
}

function redactUrlParameters(parameters, depth) {
  const output = new URLSearchParams();
  let redacted = false;
  let index = 0;
  for (const [key, value] of parameters) {
    const decodedKey = decodePercentLayers(key);
    const decodedValue = decodePercentLayers(value);
    if (
      !decodedKey.complete ||
      !decodedValue.complete ||
      isSecretField(decodedKey.value, decodedValue.value) ||
      isCredentialSchemeValue(decodedKey.value, decodedValue.value)
    ) {
      const outputKey = safeSensitiveObjectKeyPattern.test(decodedKey.value)
        ? decodedKey.value
        : `[REDACTED KEY ${index + 1}]`;
      output.append(outputKey, '[REDACTED]');
      redacted = true;
    } else {
      const sanitized = sanitizeUrlComponent(value, depth);
      output.append(key, sanitized.value);
      redacted ||= sanitized.redacted;
    }
    index++;
  }
  return { parameters: output, redacted };
}

function protectSanitizedUrls(value) {
  const entries = [];
  const markerPrefix = `\0QUANTPASS_URL_${randomUUID()}_`;
  function protect(match) {
    if (entries.length >= maximumUrlsPerString) return '[REDACTED EXCESS URLS]';
    const sanitized = sanitizeUrl(match);
    const marker = `${markerPrefix}${sanitized.redacted ? 'R' : 'S'}${entries.length}\0`;
    entries.push(sanitized.value);
    return marker;
  }
  const protectedValue = value
    .replace(urlPattern, (match) => protect(match))
    .replace(
      networkPathCredentialPattern,
      (_match, prefix, networkPath) => `${prefix}${protect(networkPath)}`,
    );
  const markerPattern = new RegExp(`${markerPrefix}[RS](\\d+)\0`, 'g');
  const foldedRedactedMarkerPattern = new RegExp(
    `(${markerPrefix}R\\d+\0)(?:(?:\\r\\n|\\r|\\n)[ \\t]+[^\\r\\n]*)+`,
    'g',
  );
  return {
    protectedValue,
    removeFoldedContinuations(output) {
      return output.replace(foldedRedactedMarkerPattern, '$1');
    },
    restore(output) {
      return output.replace(markerPattern, (_marker, index) => entries[Number(index)] ?? '[REDACTED URL]');
    },
  };
}

function isSecretKey(key) {
  if (key.length > 256) return true;
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const canonicalTokens = tokens.map((token) =>
    /^(?:cookies|credentials|keys|mnemonics|otps|passcodes|passphrases|passwords|secrets|seeds|signatures|tokens)$/.test(
      token,
    )
      ? token.slice(0, -1)
      : token,
  );
  return (
    exactSensitiveKeyPattern.test(key) ||
    compactSensitiveKeys.has(key.replace(/[^A-Za-z0-9]/g, '').toLowerCase()) ||
    isCanonicalCodeKey(key) ||
    hasAuthenticationSemantics(key) ||
    canonicalTokens.some(
      (token, index) =>
        index + 1 < canonicalTokens.length &&
        sensitiveTokenPairs.has(`${token}:${canonicalTokens[index + 1]}`),
    ) ||
    canonicalTokens.some((token) => exactSensitiveTokens.has(token))
  );
}

function isSafeSecurityMetadataKey(key) {
  if (key.length > 256) return false;
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length < 2 || !safeSecurityMetadataSuffixes.has(tokens.at(-1))) return false;
  return safeSecurityMetadataPrefixes.has(tokens.slice(0, -1).join(':'));
}

function isSafeSecurityMetadataValue(key, value) {
  if (!isSafeSecurityMetadataKey(key)) return false;
  const suffix = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .at(-1);
  if (value === null) return true;
  const normalized = typeof value === 'string' ? value.trim().replace(/^(["'])([\s\S]*)\1$/, '$2') : null;
  if (['active', 'enabled', 'present', 'required'].includes(suffix)) {
    if (typeof value === 'boolean' || value === 0 || value === 1) return true;
    if (normalized === null) return false;
    return /^(?:disabled|enabled|false|no|none|off|on|optional|required|true|yes)$/i.test(normalized);
  }
  if (['count', 'entries'].includes(suffix)) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999;
    return normalized !== null && /^\d{1,9}$/.test(normalized);
  }
  if (normalized === null) return false;
  if (suffix === 'algorithm')
    return /^(?:blake2b|ed25519|keccak256|md5|rsa|sha(?:1|224|256|384|512)?)$/i.test(normalized);
  if (['method', 'mode', 'provider', 'scheme', 'type'].includes(suffix))
    return /^(?:basic|bearer|custom|digest|disabled|dpop|github|google|internal|jwt|negotiate|none|oauth|public|token)$/i.test(
      normalized,
    );
  if (suffix === 'policy')
    return /^(?:disabled|enabled|none|optional|public|required|strict)$/i.test(normalized);
  if (['result', 'status'].includes(suffix))
    return /^(?:blocked|denied|disabled|enabled|error|fail|failed|invalid|not_run|ok|pass|passed|ready|skip|skipped|success|unknown|valid)$/i.test(
      normalized,
    );
  return false;
}

function isSecretField(key, value) {
  return isSecretKey(key) && !isSafeSecurityMetadataValue(key, value);
}

function isCredentialSchemeValue(key, value) {
  if (!credentialSchemeKeyPattern.test(key) || typeof value !== 'string') return false;
  const normalized = value.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
  if (normalized.length === 0) return false;
  if (/^(?:disabled|enabled|false|none|off|on|optional|public|required|true)$/i.test(normalized))
    return false;
  if (
    /^digest$/i.test(key) &&
    /^(?:(?:blake2b|keccak256|md5|sha(?:1|224|256|384|512)?):[A-Za-z0-9._-]{1,256}|[a-f0-9]{8,128})$/i.test(
      normalized,
    )
  )
    return false;
  return true;
}

function isAsciiLetter(character) {
  const code = character?.charCodeAt(0) ?? -1;
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(character) {
  const code = character?.charCodeAt(0) ?? -1;
  return code >= 48 && code <= 57;
}

function skipHorizontalWhitespace(value, start) {
  let cursor = start;
  while (value[cursor] === ' ' || value[cursor] === '\t') cursor++;
  return cursor;
}

function isStructuredAssignmentNameCharacter(character) {
  return (
    isAsciiLetter(character) ||
    isAsciiDigit(character) ||
    character === '_' ||
    character === '.' ||
    character === '[' ||
    character === ']' ||
    character === '-'
  );
}

function isStructuredCliNameCharacter(character) {
  return (
    isAsciiLetter(character) ||
    isAsciiDigit(character) ||
    character === '_' ||
    character === '.' ||
    character === '-'
  );
}

function isWhitespace(character) {
  return character !== undefined && /\s/u.test(character);
}

function isLineTerminator(character) {
  // Structured log tails reject every ECMAScript line terminator, including the two not split above.
  return character === '\r' || character === '\n' || character === '\u2028' || character === '\u2029';
}

function scanStructuredValue(value, start) {
  const quote = value[start];
  if (quote !== '"' && quote !== "'") {
    let cursor = start;
    while (cursor < value.length && !isWhitespace(value[cursor])) cursor++;
    return cursor === start ? -1 : cursor;
  }

  let cursor = start + 1;
  while (cursor < value.length) {
    const character = value[cursor];
    if (character === quote) return cursor + 1;
    if (isLineTerminator(character)) return -1;
    if (character === '\\') {
      if (cursor + 1 >= value.length || isLineTerminator(value[cursor + 1])) return -1;
      cursor += 2;
      continue;
    }
    cursor++;
  }
  return -1;
}

function authorizationMetadataKeyBefore(source, offset) {
  let cursor = offset;
  while (cursor > 0 && (source[cursor - 1] === ' ' || source[cursor - 1] === '\t')) cursor--;
  if (cursor === 0 || (source[cursor - 1] !== '=' && source[cursor - 1] !== ':')) return null;
  cursor--;
  while (cursor > 0 && (source[cursor - 1] === ' ' || source[cursor - 1] === '\t')) cursor--;

  const keyEnd = cursor;
  while (cursor > 0 && isAsciiLetter(source[cursor - 1])) cursor--;
  if (cursor === keyEnd || (cursor > 0 && /[A-Za-z0-9_]/.test(source[cursor - 1]))) return null;
  const key = source.slice(cursor, keyEnd);
  return authorizationMetadataKeyPattern.test(key) ? key : null;
}

function scanStructuredAssignmentTail(value, start = 0, verifiedStarts = null) {
  let cursor = start;
  if (verifiedStarts) verifiedStarts.add(start);
  while (cursor < value.length) {
    const whitespaceStart = cursor;
    cursor = skipHorizontalWhitespace(value, cursor);
    if (cursor === value.length) return true;
    if (cursor === whitespaceStart || !isAsciiLetter(value[cursor])) return false;

    const nameStart = cursor++;
    while (cursor < value.length && isStructuredAssignmentNameCharacter(value[cursor])) cursor++;
    if (cursor - nameStart > 256) return false;
    cursor = skipHorizontalWhitespace(value, cursor);
    if (value[cursor] !== '=' && value[cursor] !== ':') return false;
    cursor = skipHorizontalWhitespace(value, cursor + 1);

    const valueEnd = scanStructuredValue(value, cursor);
    if (valueEnd < 0) return false;
    if (verifiedStarts) verifiedStarts.add(valueEnd);
    cursor = valueEnd;
  }
  return true;
}

function isStructuredAssignmentTail(value) {
  return scanStructuredAssignmentTail(value);
}

function collectStructuredAssignmentTailStarts(value, start) {
  const verifiedStarts = new Set();
  return scanStructuredAssignmentTail(value, start, verifiedStarts) ? verifiedStarts : null;
}

function isStructuredCliTail(value) {
  let cursor = 0;
  while (cursor < value.length) {
    const whitespaceStart = cursor;
    cursor = skipHorizontalWhitespace(value, cursor);
    if (cursor === value.length) return true;
    if (cursor === whitespaceStart || !value.startsWith('--', cursor)) return false;
    cursor += 2;
    if (!isAsciiLetter(value[cursor])) return false;

    const nameStart = cursor++;
    while (cursor < value.length && isStructuredCliNameCharacter(value[cursor])) cursor++;
    if (cursor - nameStart > 256) return false;
    if (value[cursor] === '=') {
      const valueStart = ++cursor;
      while (cursor < value.length && !isWhitespace(value[cursor])) cursor++;
      if (cursor === valueStart) return false;
      continue;
    }

    const valueWhitespaceStart = cursor;
    cursor = skipHorizontalWhitespace(value, cursor);
    if (cursor === valueWhitespaceStart) return false;
    const valueEnd = scanStructuredValue(value, cursor);
    if (valueEnd < 0) return false;
    cursor = valueEnd;
  }
  return true;
}

function hasAuthenticationSemantics(key) {
  const compact = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  if (compact.endsWith('oauth')) return false;
  return (
    compact === 'auth' ||
    compact.endsWith('auth') ||
    compact.endsWith('authn') ||
    compact.endsWith('authz') ||
    compact.includes('authentication') ||
    compact.includes('authorization') ||
    compact.includes('authheader') ||
    compact.includes('authconfig')
  );
}

function isCanonicalCodeKey(key) {
  let normalized = key.trim();
  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  )
    normalized = normalized.slice(1, -1).trim();
  return /^code(?:\[\]|\.value)?$/i.test(normalized);
}

function sanitizeObjectKey(key, index, decodeDepth = 0) {
  const sanitized = sanitizeString(key, decodeDepth);
  if (
    sanitized !== key ||
    (isSecretKey(key) && !isSafeSecurityMetadataKey(key) && !safeSensitiveObjectKeyPattern.test(key))
  )
    return `[REDACTED KEY ${index + 1}]`;
  return key;
}

function isSensitiveStructuredLabel(label, value) {
  if (typeof label !== 'string') return false;
  const candidate = label.trim();
  if (
    candidate !== label ||
    candidate.length === 0 ||
    candidate.length > 256 ||
    /^[A-Za-z][A-Za-z0-9]*[-_]\d+$/.test(candidate) ||
    !/^[A-Za-z][A-Za-z0-9_. -]*$/.test(candidate) ||
    candidate.split(/[ \t]+/).length > 3
  )
    return false;
  if (diagnosticCodeKeyPattern.test(label) && safeDiagnosticCodes.has(value)) return false;
  return isSecretField(label, value) || isCredentialSchemeValue(label, value);
}

function boundedEnumerableEntries(value, maximum) {
  const entries = [];
  let truncated = false;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (entries.length >= maximum) {
      truncated = true;
      break;
    }
    entries.push([key, value[key]]);
  }
  return { entries, truncated };
}

function descriptorSecretValueKeys(entries, truncated = false) {
  const labels = entries.filter(([key]) => /^(?:header|key|name)$/i.test(key)).map(([, item]) => item);
  const secretValueKeys = new Set();
  for (const [key, item] of entries) {
    if (!/^(?:content|value)$/i.test(key)) continue;
    if (truncated || labels.some((label) => isSensitiveStructuredLabel(label, item)))
      secretValueKeys.add(key);
  }
  return secretValueKeys;
}

function privateJwkMemberKeys(value, entries) {
  let kty = entries.find(([key, item]) => key === 'kty' && typeof item === 'string')?.[1];
  if (kty === undefined) {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'kty');
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') kty = descriptor.value;
  }
  return privateJwkMemberKeysByType.get(kty) ?? noPrivateJwkMemberKeys;
}

function structuredPairSecretValueIndexes(value, maximum) {
  const indexes = new Set();
  const end = Math.min(value.length, maximum);
  for (let index = 0; index + 1 < end; index += 2)
    if (isSensitiveStructuredLabel(value[index], value[index + 1])) indexes.add(index + 1);
  return indexes;
}

function redactSecretContainers(value) {
  const containerAssignmentPattern =
    /(?:(?<![A-Za-z0-9_.[\]-])([A-Za-z][A-Za-z0-9_.[\]-]{0,262142})|(["'])([^"'\\\r\n]{1,262143})\2)\s*([=:])\s*([[{])/gi;
  let match;
  while ((match = containerAssignmentPattern.exec(value)) !== null) {
    const key = match[1] ?? match[3];
    if (!isSecretKey(key)) continue;
    return `${value.slice(0, match.index)}${match[0].slice(0, -1)}[REDACTED]`;
  }
  return value;
}

function redactStaticBracketAssignments(value) {
  const bracketAssignmentPattern = /\[\s*(["'])([^"'\\\r\n]{1,256})\1\s*\]\s*(=(?!=))\s*/gi;
  let match;
  while ((match = bracketAssignmentPattern.exec(value)) !== null) {
    const key = match[2];
    const valueStart = match.index + match[0].length;
    const scalarValue = value
      .slice(valueStart)
      .match(/^(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;}]+)/)?.[0];
    const scalarTail = value.slice(valueStart + (scalarValue?.length ?? 0));
    const schemeCredential =
      credentialSchemeKeyPattern.test(key) &&
      (isCredentialSchemeValue(key, scalarValue) || !isStructuredAssignmentTail(scalarTail));
    const metadataCredential =
      isSecretKey(key) &&
      (!isSafeSecurityMetadataValue(key, scalarValue) || !isStructuredAssignmentTail(scalarTail));
    if (!metadataCredential && !schemeCredential) continue;
    const outputKey = safeSensitiveObjectKeyPattern.test(key) ? key : '[REDACTED KEY]';
    return `${value.slice(0, match.index)}${match[0].replace(key, outputKey)}[REDACTED]`;
  }
  return value;
}

function containsAuthorizationCredential(payload) {
  if (authorizationChallengeAssignmentPattern.test(payload)) return true;
  authorizationOpaqueTokenPattern.lastIndex = 0;
  let match;
  while ((match = authorizationOpaqueTokenPattern.exec(payload)) !== null) {
    const token = match[1];
    if (token.length >= 24 || (token.length >= 12 && /\d/.test(token) && /[-._~+/=]/.test(token)))
      return true;
  }
  return false;
}

function redactStandaloneAuthorizationSchemes(value) {
  return value.replace(standaloneAuthorizationSchemePattern, (match, scheme, offset, source) => {
    const metadataKey = authorizationMetadataKeyBefore(source, offset);
    if (
      metadataKey &&
      isSafeSecurityMetadataValue(metadataKey, scheme) &&
      isStructuredAssignmentTail(match.slice(scheme.length))
    )
      return match;
    if (!containsAuthorizationCredential(match.slice(scheme.length))) return match;
    return `${scheme} [REDACTED]`;
  });
}

function redactScalarAssignments(value) {
  return value
    .split(/(\r\n|\r|\n)/)
    .map((line, index) => {
      if (index % 2 === 1) return line;
      let confirmedStructuredCliTail = false;
      const hasStructuredCliTail = (tail) => {
        if (confirmedStructuredCliTail) return true;
        confirmedStructuredCliTail = isStructuredCliTail(tail);
        return confirmedStructuredCliTail;
      };
      cliEqualsFlagPattern.lastIndex = 0;
      let cliEqualsMatch;
      while ((cliEqualsMatch = cliEqualsFlagPattern.exec(line)) !== null) {
        const [, prefix, key, separator, argumentValue] = cliEqualsMatch;
        const cliTail = line.slice(cliEqualsMatch.index + cliEqualsMatch[0].length);
        const schemeCredential =
          credentialSchemeKeyPattern.test(key) &&
          (isCredentialSchemeValue(key, argumentValue) || !hasStructuredCliTail(cliTail));
        const safeMetadataTail =
          isSafeSecurityMetadataValue(key, argumentValue) && hasStructuredCliTail(cliTail);
        if ((!isSecretKey(key) || safeMetadataTail) && !schemeCredential) continue;
        const outputKey = safeSensitiveObjectKeyPattern.test(key) ? key : '[REDACTED KEY]';
        return `${line.slice(0, cliEqualsMatch.index)}${prefix}--${outputKey}${separator}[REDACTED]`;
      }
      // The whitespace-form matcher restarts at the beginning of the line, so it cannot share
      // a suffix proof established by the equals-form matcher at a later offset.
      confirmedStructuredCliTail = false;
      cliFlagPattern.lastIndex = 0;
      let cliMatch;
      while ((cliMatch = cliFlagPattern.exec(line)) !== null) {
        const [, prefix, key, spacing, argumentValue] = cliMatch;
        const cliTail = line.slice(cliMatch.index + cliMatch[0].length);
        const schemeCredential =
          credentialSchemeKeyPattern.test(key) &&
          (isCredentialSchemeValue(key, argumentValue) || !hasStructuredCliTail(cliTail));
        const safeMetadataTail =
          isSafeSecurityMetadataValue(key, argumentValue) && hasStructuredCliTail(cliTail);
        if ((!isSecretKey(key) || safeMetadataTail) && !schemeCredential) continue;
        const outputKey = safeSensitiveObjectKeyPattern.test(key) ? key : '[REDACTED KEY]';
        return `${line.slice(0, cliMatch.index)}${prefix}--${outputKey}${spacing}[REDACTED]`;
      }
      let multiwordCursor = 0;
      while (multiwordCursor < line.length) {
        const match = multiwordAssignmentPattern.exec(line.slice(multiwordCursor));
        if (!match) break;
        const key = match[2];
        if (isSecretKey(key)) {
          const words = [...key.matchAll(/\S+/g)];
          const recognizedSuffix = words.some((word) =>
            safeSensitiveObjectKeyPattern.test(key.slice(word.index).replace(/[ \t]+/g, '_')),
          );
          const outputKey = recognizedSuffix ? key : '[REDACTED KEY]';
          return `${line.slice(0, multiwordCursor + match.index)}${match[1]}${outputKey}${match[3]} [REDACTED]`;
        }
        multiwordCursor += match.index + match[0].length;
      }
      let cursor = 0;
      const verifiedStructuredAssignmentTailStarts = new Set();
      const hasStructuredAssignmentTailAt = (start) => {
        if (verifiedStructuredAssignmentTailStarts.has(start)) return true;
        const verifiedStarts = collectStructuredAssignmentTailStarts(line, start);
        if (!verifiedStarts) return false;
        for (const verifiedStart of verifiedStarts) verifiedStructuredAssignmentTailStarts.add(verifiedStart);
        return true;
      };
      while (cursor < line.length) {
        const match = scalarAssignmentPrefixPattern.exec(line.slice(cursor));
        if (!match) break;
        const key = match[2] ?? match[4] ?? match[5];
        const valueStart = cursor + match.index + match[0].length;
        const diagnosticValue = line
          .slice(valueStart)
          .match(/^(["']?)([A-Z][A-Z0-9_]{0,63})\1(?=$|[\s,;\]}])/);
        if (
          diagnosticCodeKeyPattern.test(key) &&
          diagnosticValue &&
          safeDiagnosticCodes.has(diagnosticValue[2]) &&
          (hasStructuredAssignmentTailAt(valueStart + diagnosticValue[0].length) ||
            /^[}\]]+[ \t]*$/.test(line.slice(valueStart + diagnosticValue[0].length)))
        ) {
          cursor = valueStart + diagnosticValue[0].length;
          continue;
        }
        const scalarValue = line
          .slice(valueStart)
          .match(/^(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;}]+)/)?.[0];
        const scalarEnd = valueStart + (scalarValue?.length ?? 0);
        const schemeCredential =
          credentialSchemeKeyPattern.test(key) &&
          (isCredentialSchemeValue(key, scalarValue) || !hasStructuredAssignmentTailAt(scalarEnd));
        const metadataCredential =
          isSecretKey(key) &&
          (!isSafeSecurityMetadataValue(key, scalarValue) || !hasStructuredAssignmentTailAt(scalarEnd));
        if (metadataCredential || schemeCredential) {
          const prefix = match[1] ?? '';
          const outputKey = safeSensitiveObjectKeyPattern.test(key) ? key : '[REDACTED KEY]';
          return `${line.slice(0, cursor + match.index)}${prefix}${outputKey}${match[6]} [REDACTED]`;
        }
        cursor += match.index + match[0].length;
      }
      return line;
    })
    .join('');
}

function scrubNonUrlSecrets(value, options = {}) {
  let output = value
    .replace(privateKeyPattern, '[REDACTED PRIVATE KEY]')
    .replace(sshPublicKeyLinePattern, '[REDACTED SSH PUBLIC KEY]')
    .replace(githubTokenPattern, '[REDACTED TOKEN]')
    .replace(cloudTokenPattern, '[REDACTED TOKEN]')
    .replace(cookieHeaderPattern, '$1: [REDACTED]');
  let redacted = output !== value;
  if (options.sanitizeNestedUrls) {
    let nestedUrls = 0;
    output = output.replace(urlPattern, (match) => {
      if (nestedUrls >= maximumNestedUrlsPerComponent) {
        redacted = true;
        return '[REDACTED EXCESS URLS]';
      }
      nestedUrls++;
      const sanitized = sanitizeUrl(match, options.urlDepth);
      if (!sanitized.redacted) return match;
      redacted = true;
      return sanitized.value;
    });
  }
  output = redactStaticBracketAssignments(redactSecretContainers(output))
    .replace(escapedAuthorizationContainerPattern, '"authorization":"[REDACTED]"')
    .replace(authorizationSchemePattern, '$1[REDACTED]');
  const scrubbed = redactStandaloneAuthorizationSchemes(output);
  redacted ||= scrubbed !== output;
  output = redactScalarAssignments(scrubbed)
    .replace(foldedRedactionContinuationPattern, '$1')
    .replace(homePathPattern, '<HOME>');
  redacted ||= output !== scrubbed;
  return { value: output, redacted };
}

function redactNonUrlSecrets(value, options = {}) {
  return scrubNonUrlSecrets(value, options).value;
}

function sanitizePlainString(value) {
  const urls = protectSanitizedUrls(value);
  let output = redactNonUrlSecrets(urls.protectedValue);
  output = urls.removeFoldedContinuations(output);
  return urls
    .restore(output)
    .replace(foldedRedactionContinuationPattern, '$1')
    .replace(homePathPattern, '<HOME>');
}

function sanitizeEmbeddedJson(current, depth = 0, decodeDepth = 0) {
  if (depth > 16) return '[MAX_DEPTH]';
  if (typeof current === 'string') return sanitizeString(current, decodeDepth);
  if (current === null || typeof current === 'number' || typeof current === 'boolean') return current;
  if (Array.isArray(current)) {
    const sensitivePairValues = structuredPairSecretValueIndexes(current, 1000);
    const output = current
      .slice(0, 1000)
      .map((item, index) =>
        sensitivePairValues.has(index) ? '[REDACTED]' : sanitizeEmbeddedJson(item, depth + 1, decodeDepth),
      );
    if (current.length > 1000) output.push(`[TRUNCATED ${current.length - 1000} ITEMS]`);
    return output;
  }
  if (!current || typeof current !== 'object') return '[UNAVAILABLE]';
  const { entries, truncated } = boundedEnumerableEntries(current, 1000);
  const descriptorSecrets = descriptorSecretValueKeys(entries, truncated);
  const privateJwkMembers = privateJwkMemberKeys(current, entries);
  const outputEntries = entries.map(([key, item], index) => [
    sanitizeObjectKey(key, index, decodeDepth),
    diagnosticCodeKeyPattern.test(key) && safeDiagnosticCodes.has(item)
      ? item
      : privateJwkMembers.has(key) ||
          descriptorSecrets.has(key) ||
          isSecretField(key, item) ||
          isCredentialSchemeValue(key, item)
        ? '[REDACTED]'
        : sanitizeEmbeddedJson(item, depth + 1, decodeDepth),
  ]);
  if (truncated) outputEntries.push(['[TRUNCATED PROPERTIES]', '[TRUNCATED]']);
  return Object.fromEntries(outputEntries);
}

function jsonContainerEnd(value, start) {
  const stack = [value[start]];
  let stringQuote = null;
  let escaped = false;
  for (let index = start + 1; index < value.length; index++) {
    const character = value[index];
    if (stringQuote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === stringQuote) stringQuote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      stringQuote = character;
      continue;
    }
    if (character === '{' || character === '[') {
      if (stack.length >= 64) return -1;
      stack.push(character);
      continue;
    }
    if (character !== '}' && character !== ']') continue;
    const opener = stack.pop();
    if ((opener === '{' && character !== '}') || (opener === '[' && character !== ']')) return -1;
    if (stack.length === 0) return index;
  }
  return -1;
}

function sanitizeJsonFragments(value, decodeDepth) {
  let output = '';
  let cursor = 0;
  let attempts = 0;
  while (cursor < value.length) {
    const objectStart = value.indexOf('{', cursor);
    const arrayStart = value.indexOf('[', cursor);
    const start =
      objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
    if (start === -1) break;
    if (attempts >= 32) {
      output += value.slice(cursor, start);
      return `${output}[REDACTED UNPARSED JSON]`;
    }
    attempts++;
    const end = jsonContainerEnd(value, start);
    if (end === -1) {
      output += value.slice(cursor, start + 1);
      cursor = start + 1;
      continue;
    }
    const candidate = value.slice(start, end + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        output += value.slice(cursor, start);
        output += JSON.stringify(sanitizeEmbeddedJson(parsed, 0, decodeDepth + 1));
        cursor = end + 1;
        continue;
      }
    } catch {
      // The bounded container is not JSON; continue looking for a later container.
    }
    output += value.slice(cursor, start + 1);
    cursor = start + 1;
  }
  return `${output}${value.slice(cursor)}`;
}

function sanitizeString(value, decodeDepth = 0) {
  if (value.length > maximumEmbeddedJsonCharacters) return '[REDACTED OVERSIZED STRING]';
  try {
    const decoded = JSON.parse(value.trim());
    if (decoded && typeof decoded === 'object')
      return JSON.stringify(sanitizeEmbeddedJson(decoded, 0, decodeDepth + 1));
    if (typeof decoded === 'string') {
      if (decodeDepth >= maximumEncodedJsonDepth) return JSON.stringify('[REDACTED NESTED STRING]');
      return JSON.stringify(sanitizeString(decoded, decodeDepth + 1));
    }
  } catch {
    // Mixed prose and malformed containers continue through bounded fragment handling.
  }
  const fragmentInput = /[{[]/.test(value) && /\\+"/.test(value) ? value.replace(/\\+(?=")/g, '') : value;
  const jsonSanitized =
    fragmentInput.length <= maximumEmbeddedJsonCharacters
      ? sanitizeJsonFragments(fragmentInput, decodeDepth)
      : fragmentInput;
  return sanitizePlainString(jsonSanitized);
}

function truncateCharacters(value, maximum) {
  if (value.length <= maximum) return value;
  const marker = '[TRUNCATED]';
  if (maximum <= marker.length) return marker.slice(0, maximum);
  return `${value.slice(0, maximum - marker.length)}${marker}`;
}

function truncateBytes(value, maximum) {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maximum) return value;
  const marker = '[TRUNCATED]';
  if (maximum <= marker.length) return marker.slice(0, Math.max(0, maximum));
  let prefixEnd = maximum - marker.length;
  while (prefixEnd > 0 && (encoded[prefixEnd] & 0xc0) === 0x80) prefixEnd--;
  return `${encoded.subarray(0, prefixEnd).toString('utf8')}${marker}`;
}

export function redactValue(value, options = {}) {
  const maxDepth = options.maxDepth ?? 8;
  const maxArrayLength = options.maxArrayLength ?? 100;
  const maxObjectEntries = options.maxObjectEntries ?? 1000;
  const maxStringLength = options.maxStringLength ?? 4096;
  const seen = new WeakSet();

  function visit(current, depth) {
    if (depth > maxDepth) return '[MAX_DEPTH]';
    if (typeof current === 'string') return truncateCharacters(sanitizeString(current), maxStringLength);
    if (current === null || typeof current === 'number' || typeof current === 'boolean') return current;
    if (typeof current !== 'object') return '[UNAVAILABLE]';
    if (seen.has(current)) return '[UNAVAILABLE]';
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        const sensitivePairValues = structuredPairSecretValueIndexes(current, maxArrayLength);
        const output = current
          .slice(0, maxArrayLength)
          .map((item, index) => (sensitivePairValues.has(index) ? '[REDACTED]' : visit(item, depth + 1)));
        if (current.length > maxArrayLength)
          output.push(`[TRUNCATED ${current.length - maxArrayLength} ITEMS]`);
        return output;
      }
      const { entries, truncated } = boundedEnumerableEntries(current, maxObjectEntries);
      const descriptorSecrets = descriptorSecretValueKeys(entries, truncated);
      const privateJwkMembers = privateJwkMemberKeys(current, entries);
      const outputEntries = entries.map(([key, item], index) => [
        sanitizeObjectKey(key, index),
        diagnosticCodeKeyPattern.test(key) && safeDiagnosticCodes.has(item)
          ? item
          : privateJwkMembers.has(key) ||
              descriptorSecrets.has(key) ||
              isSecretField(key, item) ||
              isCredentialSchemeValue(key, item)
            ? '[REDACTED]'
            : visit(item, depth + 1),
      ]);
      if (truncated) outputEntries.push(['[TRUNCATED PROPERTIES]', '[TRUNCATED]']);
      return Object.fromEntries(outputEntries);
    } finally {
      seen.delete(current);
    }
  }

  return visit(value, 0);
}

export function sanitizeLog(text, options = {}) {
  const maxBytes = options.maxBytes ?? 65_536;
  return truncateBytes(sanitizeString(String(text)), maxBytes);
}

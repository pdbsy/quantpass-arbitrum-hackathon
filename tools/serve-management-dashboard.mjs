import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const loopbackHost = '127.0.0.1';
const defaultPort = 4181;
const maximumAssetBytes = 5 * 1024 * 1024;
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/management/dashboard');
const mimeTypes = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
});
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function contained(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', contentSecurityPolicy);
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function errorResponse(response, status, body, extraHeaders = {}) {
  securityHeaders(response);
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

export function resolveDashboardRequestPath(rawUrl) {
  requireCondition(typeof rawUrl === 'string' && rawUrl.startsWith('/') && !rawUrl.startsWith('//'), 'DENY');
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new Error('DENY');
  }
  requireCondition(!decoded.includes('\0') && !decoded.includes('\\'), 'DENY');
  const segments = decoded.split('/').filter(Boolean);
  requireCondition(
    segments.every((segment) => segment !== '..' && !segment.startsWith('.')),
    'DENY',
  );
  return segments.length === 0 ? 'index.html' : segments.join('/');
}

async function serve(request, response, root) {
  const expectedHost = `${loopbackHost}:${request.socket.localPort}`;
  if (request.headers.host !== expectedHost) {
    errorResponse(response, 421, 'Misdirected Request\n');
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    errorResponse(response, 405, 'Method Not Allowed\n', { Allow: 'GET, HEAD' });
    return;
  }

  let relativePath;
  try {
    relativePath = resolveDashboardRequestPath(request.url);
  } catch {
    errorResponse(response, 404, 'Not Found\n');
    return;
  }
  const extension = extname(relativePath);
  const contentType = mimeTypes[extension];
  if (!contentType) {
    errorResponse(response, 404, 'Not Found\n');
    return;
  }

  try {
    const candidate = resolve(root, relativePath);
    requireCondition(contained(root, candidate), 'DENY');
    const resolved = await realpath(candidate);
    requireCondition(contained(root, resolved), 'DENY');
    const metadata = await stat(resolved);
    requireCondition(metadata.isFile() && metadata.size <= maximumAssetBytes, 'DENY');
    const body = request.method === 'HEAD' ? null : await readFile(resolved);
    securityHeaders(response);
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': metadata.size,
    });
    response.end(body);
  } catch {
    errorResponse(response, 404, 'Not Found\n');
  }
}

export async function createDashboardServer(options = {}) {
  const host = options.host ?? loopbackHost;
  const port = options.port ?? defaultPort;
  requireCondition(host === loopbackHost, 'LOOPBACK_HOST_REQUIRED');
  requireCondition(Number.isInteger(port) && port >= 0 && port <= 65_535, 'INVALID_PORT');
  const root = await realpath(options.root ?? defaultRoot);
  const metadata = await stat(root);
  requireCondition(metadata.isDirectory(), 'DASHBOARD_ROOT_REQUIRED');
  const server = createServer((request, response) => {
    serve(request, response, root).catch(() => {
      if (response.headersSent) response.destroy();
      else errorResponse(response, 500, 'Internal Server Error\n');
    });
  });
  server.dashboardHost = host;
  server.dashboardPort = port;
  return server;
}

export async function main(args = process.argv.slice(2)) {
  requireCondition(args.length === 0, `Unknown argument: ${args[0]}`);
  const server = await createDashboardServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(server.dashboardPort, server.dashboardHost, resolveListen);
  });
  console.log(`AlphaForge Control Center: http://${server.dashboardHost}:${server.dashboardPort}`);
  return server;
}

if (
  process.argv[1] &&
  relative(dirname(fileURLToPath(import.meta.url)), resolve(process.argv[1])) ===
    'serve-management-dashboard.mjs'
)
  main().catch((error) => {
    console.error(`Management dashboard server failed: ${error?.message ?? 'UNKNOWN_ERROR'}`);
    process.exitCode = 1;
  });

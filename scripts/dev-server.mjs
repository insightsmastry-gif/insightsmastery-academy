#!/usr/bin/env node
/**
 * InsightsMastery Academy — local static server.
 *
 * The site uses ES modules and `fetch('content/manifest.json')`, both of which
 * browsers refuse over `file://`. This serves the repo root over HTTP so local
 * previews behave exactly like GitHub Pages.
 *
 * Node 18+, ESM, zero dependencies.
 *
 *   node scripts/dev-server.mjs              http://localhost:4173
 *   node scripts/dev-server.mjs --port 8080
 *   PORT=8080 node scripts/dev-server.mjs
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 4173;

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}));

function resolvePort() {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--port');
  const raw = (flag !== -1 && args[flag + 1])
    || args.find((arg) => arg.startsWith('--port='))?.split('=')[1]
    || process.env.PORT;
  const port = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

function contentType(filePath) {
  return MIME.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

/** Map a request path to a file inside ROOT, or null if it escapes the root. */
function safeResolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const resolved = path.resolve(ROOT, `.${path.posix.normalize(decoded)}`);
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

async function resolveTarget(requestPath) {
  const resolved = safeResolve(requestPath);
  if (!resolved) return null;
  try {
    const stats = await stat(resolved);
    if (!stats.isDirectory()) return resolved;
    const index = path.join(resolved, 'index.html');
    await stat(index);
    return index;
  } catch {
    return null;
  }
}

async function notFound(response, requestPath) {
  const page = path.join(ROOT, '404.html');
  try {
    const body = await readFile(page);
    response.writeHead(404, { 'Content-Type': MIME.get('.html'), 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': MIME.get('.txt'), 'Cache-Control': 'no-store' });
    response.end(`404 Not Found: ${requestPath}\n`);
  }
  return 404;
}

const server = createServer(async (request, response) => {
  const requestPath = (request.url ?? '/').split('?')[0].split('#')[0];
  let status = 200;

  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      status = 405;
      response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      response.end();
    } else {
      const target = await resolveTarget(requestPath);
      if (!target) {
        status = await notFound(response, requestPath);
      } else {
        const body = await readFile(target);
        response.writeHead(200, {
          'Content-Type': contentType(target),
          'Content-Length': body.byteLength,
          'Cache-Control': 'no-store',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      }
    }
  } catch (error) {
    status = 500;
    response.writeHead(500, { 'Content-Type': MIME.get('.txt'), 'Cache-Control': 'no-store' });
    response.end(`500 ${error instanceof Error ? error.message : 'Server error'}\n`);
  }

  console.log(`${new Date().toISOString().slice(11, 19)}  ${status}  ${request.method} ${requestPath}`);
});

const port = resolvePort();
server.listen(port, () => {
  console.log(`InsightsMastery Academy — serving ${ROOT}`);
  console.log(`  http://localhost:${port}/   (Ctrl+C to stop)`);
});

server.on('error', (error) => {
  const hint = error.code === 'EADDRINUSE'
    ? ` — port ${port} is busy, try: node scripts/dev-server.mjs --port ${port + 1}`
    : '';
  console.error(`dev-server: ${error.message}${hint}`);
  process.exitCode = 1;
});

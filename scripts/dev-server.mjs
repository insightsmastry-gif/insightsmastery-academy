#!/usr/bin/env node
/**
 * InsightsMastery Academy — local preview of the built site.
 *
 * Serves `_site/` under the same base path as production (the path of
 * `site.url` in content.config.json — `/` on the custom domain), so
 * relative links, absolute 404 URLs and the CSP behave exactly as in production.
 * With `--watch`, any change to the sources re-runs `scripts/build.mjs`.
 *
 *   node scripts/dev-server.mjs                   http://localhost:4173/
 *   node scripts/dev-server.mjs --watch
 *   node scripts/dev-server.mjs --port 8080       (or PORT=8080)
 */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '_site');
const DEFAULT_PORT = 4173;
const IGNORED = /^(?:_site|\.site-staging-\d+|node_modules|\.git)(?:[\\/]|$)/;

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}));

const args = process.argv.slice(2);

function resolvePort() {
  const flag = args.indexOf('--port');
  const raw = (flag !== -1 && args[flag + 1])
    || args.find((arg) => arg.startsWith('--port='))?.split('=')[1]
    || process.env.PORT;
  const port = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

const config = JSON.parse(await readFile(path.join(ROOT, 'content.config.json'), 'utf8'));
const BASE_PATH = new URL(config.site.url).pathname; // "/" on notes.insightsmastery.in

/** Map a request path inside the base path to a file inside _site, or null. */
async function resolveTarget(sitePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(sitePath);
  } catch {
    return null;
  }
  const resolved = path.resolve(SITE, `.${path.posix.normalize(`/${decoded}`)}`);
  if (resolved !== SITE && !resolved.startsWith(SITE + path.sep)) return null;
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

function send(response, status, body, type, method) {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(method === 'HEAD' ? undefined : body);
}

const server = createServer(async (request, response) => {
  const requestPath = (request.url ?? '/').split('?')[0].split('#')[0];
  let status = 200;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      status = 405;
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
    } else if (!requestPath.startsWith(BASE_PATH)) {
      status = 302;
      response.writeHead(302, { Location: BASE_PATH });
      response.end();
    } else {
      const target = await resolveTarget(requestPath.slice(BASE_PATH.length));
      if (target) {
        send(response, 200, await readFile(target), MIME.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream', request.method);
      } else {
        status = 404;
        const page = await readFile(path.join(SITE, '404.html')).catch(() => `404 Not Found: ${requestPath}\n`);
        send(response, 404, page, MIME.get('.html'), request.method);
      }
    }
  } catch (error) {
    status = 500;
    send(response, 500, `500 ${error instanceof Error ? error.message : 'Server error'}\n`, MIME.get('.txt'), request.method);
  }
  console.log(`${new Date().toISOString().slice(11, 19)}  ${status}  ${request.method} ${requestPath}`);
});

function startWatcher() {
  let timer;
  let running = false;
  let queued = false;
  const rebuild = () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--quiet'], { stdio: 'inherit' });
    child.on('exit', (code) => {
      console.log(code === 0 ? '  rebuilt _site/' : `  build failed (exit ${code})`);
      running = false;
      if (queued) {
        queued = false;
        rebuild();
      }
    });
  };
  watch(ROOT, { recursive: true }, (_, file) => {
    if (!file || IGNORED.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  });
  console.log('  watching sources — edits rebuild _site/ automatically');
}

const port = resolvePort();
server.listen(port, () => {
  console.log(`InsightsMastery Academy — serving ${SITE}`);
  console.log(`  http://localhost:${port}${BASE_PATH}   (Ctrl+C to stop)`);
  if (args.includes('--watch')) startWatcher();
});

server.on('error', (error) => {
  const hint = error.code === 'EADDRINUSE'
    ? ` — port ${port} is busy, try: node scripts/dev-server.mjs --port ${port + 1}`
    : '';
  console.error(`dev-server: ${error.message}${hint}`);
  process.exitCode = 1;
});

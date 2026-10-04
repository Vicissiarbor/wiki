#!/usr/bin/env node
/**
 * Development-only static file server.
 *
 * The published site needs no server at all (GitHub Pages serves the files), but
 * ES modules cannot be loaded from file:// URLs, so a local preview needs
 * something like this. It has no API, no writes and no dependencies; it is not
 * part of what gets deployed.
 *
 * Usage: node tools/serve.js [--port 8080] [--root web]
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * @param {string[]} argv
 * @returns {{port: number, root: string}}
 */
function parseArgs(argv) {
  let port = 8080;
  let root = 'web';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--port') {
      port = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else if (argv[index] === '--root') {
      root = argv[index + 1] ?? root;
      index += 1;
    } else if (argv[index] === '--help' || argv[index] === '-h') {
      process.stdout.write('用法: node tools/serve.js [--port 8080] [--root web]\n');
      process.exit(0);
    }
  }
  return { port: Number.isInteger(port) ? port : 8080, root: path.resolve(root) };
}

const { port, root } = parseArgs(process.argv.slice(2));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const decoded = decodeURIComponent(url.pathname);
  const target = path.resolve(root, decoded.replace(/^\/+/, ''));
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('非法的请求路径');
    return;
  }
  let file = target;
  try {
    const stats = await fs.stat(file);
    if (stats.isDirectory()) {
      file = path.join(file, 'index.html');
    }
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    const fallback = path.join(root, '404.html');
    try {
      const body = await fs.readFile(fallback);
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
    }
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`本地预览: http://127.0.0.1:${port}/  (root=${root})\n`);
});

#!/usr/bin/env node
/**
 * SearchLADR backend for a self-hosted box (the aliyun server in 需求.md).
 *
 * What it does
 *   - serves the same static site as GitHub Pages (so one URL does both), and
 *   - exposes a small REST API so the page can add / edit / delete entries,
 *   - stores everything in one JSON file that is git-committed on every write,
 *     which keeps the self-hosted copy and the GitHub Pages copy in sync.
 *
 * Zero dependencies: `node server/index.js` is the whole deployment.
 *
 * Usage: node server/index.js --help
 */

import http from 'node:http';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createApiHandler, handleApiError } from './lib/api.js';
import { createAuthGate } from './lib/auth.js';
import { USAGE, parseConfig, startupNotes, writesEnabled } from './lib/config.js';
import { HttpError, applyCors, createLogger, log, sendText } from './lib/http.js';
import { createStaticHandler } from './lib/static.js';
import { EntryStore } from './lib/store.js';

/**
 * Build the HTTP server without starting it (used by tests).
 *
 * @param {import('./lib/config.js').ServerConfig} config
 * @param {{logLevel?: string}} [options]
 * @returns {{server: http.Server, store: EntryStore, start: (port?: number, host?: string) => Promise<{port: number, host: string}>}}
 */
export function createServer(config, options = {}) {
  const logger = createLogger(options.logLevel ?? config.logLevel);
  const store = new EntryStore({
    file: config.dataFile,
    git: config.git,
    log: (level, message, fields) => logger[/** @type {any} */ (level)](message, fields),
  });
  const auth = createAuthGate({ token: config.token });
  const api = createApiHandler({
    store,
    auth,
    writesEnabled: writesEnabled(config),
    bodyLimit: config.bodyLimit,
    log: (level, message, fields) => logger[/** @type {any} */ (level)](message, fields),
  });
  const staticHandler =
    config.staticRoot === ''
      ? null
      : createStaticHandler({
          root: config.staticRoot,
          log: (level, message, fields) => logger[/** @type {any} */ (level)](message, fields),
        });

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    res.on('finish', () => {
      logger.debug('请求完成', {
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });

    try {
      if (applyCors(req, res, config.corsOrigins)) {
        return;
      }
      if (await api(req, res, url)) {
        return;
      }
      if (staticHandler && (await staticHandler(req, res, url))) {
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, `没有这个接口：${req.method} ${url.pathname}`, {
          code: 'not-found',
        });
      }
      sendText(res, 404, '没有这个资源。若未启用静态托管，请用 --static-root 指定前端目录。');
    } catch (error) {
      handleApiError(res, error, (level, message, fields) =>
        logger[/** @type {any} */ (level)](message, fields),
      );
    }
  });

  server.on('clientError', (error, socket) => {
    logger.warn('客户端连接错误', { error: error.message });
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return {
    server,
    store,
    start(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolve({
            port: typeof address === 'object' && address ? address.port : port,
            host,
          });
        });
      });
    },
  };
}

/**
 * @param {http.Server} server
 * @param {string[]} signals
 * @returns {void}
 */
function installShutdown(server, signals = ['SIGINT', 'SIGTERM']) {
  let closing = false;
  for (const signal of signals) {
    process.on(signal, () => {
      if (closing) {
        return;
      }
      closing = true;
      log('info', `收到 ${signal}，正在关闭…`);
      server.close(() => process.exit(0));
      // Do not wait forever for keep-alive connections.
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}

async function main() {
  const { config, help, version, errors } = parseConfig(process.argv.slice(2));
  if (help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (version) {
    process.stdout.write('searchladr-server 1.0.0\n');
    return 0;
  }
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`参数错误：${error}\n`);
    }
    process.stderr.write(`\n${USAGE}`);
    return 2;
  }

  const { server, store, start } = createServer(config);
  try {
    await store.ensureFile();
  } catch (error) {
    process.stderr.write(`无法访问数据文件 ${config.dataFile}：${/** @type {Error} */ (error).message}\n`);
    return 1;
  }

  const { port, host } = await start();
  const displayHost = host === '0.0.0.0' || host === '::' ? '<本机IP>' : host;
  log('info', '词条服务已启动', {
    url: `http://${displayHost}:${port}/`,
    api: `http://${displayHost}:${port}/api/entries`,
    data: config.dataFile,
    writable: writesEnabled(config),
  });
  for (const note of startupNotes(config)) {
    log('info', note);
  }
  installShutdown(server);
  return 0;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main()
    .then((code) => {
      if (code !== 0) {
        process.exit(code);
      }
    })
    .catch((error) => {
      process.stderr.write(`启动失败：${error?.stack ?? error}\n`);
      process.exit(1);
    });
}
/**
 * Server configuration: command line flags, environment variables, defaults.
 *
 * Environment variables (useful for systemd) are:
 *   LADR_PORT, LADR_HOST, LADR_DATA, LADR_TOKEN, LADR_STATIC_ROOT,
 *   LADR_CORS_ORIGINS, LADR_GIT_COMMIT, LADR_GIT_PUSH, LADR_LOG_LEVEL
 */

import path from 'node:path';

/** @typedef {object} ServerConfig
 * @property {string} host
 * @property {number} port
 * @property {string} dataFile Absolute path of the entries JSON file.
 * @property {string} token Bearer token required for writes ('' disables writes).
 * @property {string} staticRoot Absolute path served at '/', or '' to disable.
 * @property {string[]} corsOrigins Allowed origins for CORS ('*' allows any).
 * @property {boolean} readOnly Force read-only mode even when a token is set.
 * @property {number} bodyLimit Maximum request body size in bytes.
 * @property {{enabled: boolean, push: boolean, cwd: string, prefix: string}} git
 * @property {'debug'|'info'|'warn'|'error'} logLevel
 */

/** Flags that take a value. */
const VALUE_FLAGS = new Set([
  'port',
  'host',
  'data',
  'token',
  'static-root',
  'cors-origin',
  'body-limit',
  'log-level',
  'git-prefix',
]);

/** Flags that are switches. */
const BOOLEAN_FLAGS = new Set([
  'read-only',
  'no-static',
  'git-commit',
  'git-push',
  'help',
  'version',
]);

export const USAGE = `SearchLADR 词条后端

用法: node server/index.js [选项]

选项:
  --port <n>            监听端口（默认 8787，或环境变量 LADR_PORT）
  --host <addr>         监听地址（默认 0.0.0.0）
  --data <file>         词条 JSON 文件（默认 web/data/entries.json）
  --token <secret>      写操作所需的令牌；不设置则接口为只读
  --static-root <dir>   同时托管的前端目录（默认 web；--no-static 关闭）
  --cors-origin <o>     允许跨域的来源，可重复；默认 *（只读数据本身是公开的）
  --read-only           强制只读（忽略 --token 的写权限）
  --git-commit          每次写入后在本仓库提交一次
  --git-push            提交后执行 git push（需要配置好部署密钥）
  --body-limit <bytes>  请求体上限（默认 2097152）
  --log-level <level>   debug | info | warn | error
  -h, --help            显示本帮助

为什么默认端口不是 80/443：未备案的境内服务器通常无法解析 80/443 上的域名，
用高端口（如 8787/8443）即可直接以 IP + 端口访问。详见 docs/deployment.md。
`;

/**
 * @param {string[]} argv Arguments without the node/script prefix.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{config: ServerConfig, help: boolean, version: boolean, errors: string[]}}
 */
export function parseConfig(argv, env = process.env) {
  /** @type {Record<string, any>} */
  const flags = {};
  const errors = [];
  /** @type {string[]} */
  const corsOrigins = [];

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('-')) {
      errors.push(`无法识别的参数：${raw}`);
      continue;
    }
    const name = raw.replace(/^--?/, '');
    const [key, inlineValue] = name.split('=');
    if (!VALUE_FLAGS.has(key) && !BOOLEAN_FLAGS.has(key)) {
      errors.push(`未知选项：${raw}`);
      continue;
    }
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }
    let value = inlineValue;
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined) {
      errors.push(`选项 --${key} 缺少参数`);
      continue;
    }
    if (key === 'cors-origin') {
      corsOrigins.push(value);
    } else {
      flags[key] = value;
    }
  }

  /**
   * @param {string} flag
   * @param {string} envName
   * @returns {string|undefined}
   */
  const pick = (flag, envName) => flags[flag] ?? env[envName];

  const port = Number.parseInt(String(pick('port', 'LADR_PORT') ?? '8787'), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('端口必须是 1-65535 之间的整数');
  }
  const bodyLimit = Number.parseInt(String(pick('body-limit', 'LADR_BODY_LIMIT') ?? '2097152'), 10);
  if (!Number.isInteger(bodyLimit) || bodyLimit < 1024) {
    errors.push('--body-limit 至少为 1024 字节');
  }

  const envOrigins = String(env.LADR_CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  /** @type {ServerConfig} */
  const config = {
    host: String(pick('host', 'LADR_HOST') ?? '0.0.0.0'),
    port,
    dataFile: path.resolve(String(pick('data', 'LADR_DATA') ?? 'web/data/entries.json')),
    token: String(pick('token', 'LADR_TOKEN') ?? '').trim(),
    staticRoot: flags['no-static']
      ? ''
      : path.resolve(String(pick('static-root', 'LADR_STATIC_ROOT') ?? 'web')),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : envOrigins.length > 0 ? envOrigins : ['*'],
    readOnly: flags['read-only'] === true,
    bodyLimit,
    git: {
      enabled: flags['git-commit'] === true || env.LADR_GIT_COMMIT === '1',
      push: flags['git-push'] === true || env.LADR_GIT_PUSH === '1',
      cwd: path.dirname(path.resolve(String(pick('data', 'LADR_DATA') ?? 'web/data/entries.json'))),
      prefix: String(pick('git-prefix', 'LADR_GIT_PREFIX') ?? 'content(entries)'),
    },
    logLevel: /** @type {any} */ (
      flags['log-level'] ?? env.LADR_LOG_LEVEL ?? 'info'
    ),
  };

  return {
    config,
    help: flags.help === true,
    version: flags.version === true,
    errors,
  };
}

/**
 * @param {ServerConfig} config
 * @returns {boolean} True when writes are available.
 */
export function writesEnabled(config) {
  return !config.readOnly && config.token !== '';
}

/**
 * @param {ServerConfig} config
 * @returns {string[]} Operator guidance printed at startup.
 */
export function startupNotes(config) {
  /** @type {string[]} */
  const notes = [];
  if (!writesEnabled(config)) {
    notes.push(
      config.readOnly
        ? '只读模式（--read-only）：接口不会接受任何写入。'
        : '未设置 --token：接口为只读。要允许网页修改词条，请设置 LADR_TOKEN。',
    );
  }
  if (config.staticRoot === '') {
    notes.push('已关闭静态托管（--no-static）：请自行用 Nginx 等托管前端。');
  }
  if (config.corsOrigins.includes('*')) {
    notes.push('CORS 允许任意来源（默认）。如需收紧，请用 --cors-origin 指定站点地址。');
  }
  return notes;
}
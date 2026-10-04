/**
 * Runtime configuration.
 *
 * Precedence (lowest to highest):
 *   1. DEFAULT_CONFIG below
 *   2. window.__LADR_CONFIG__      (advanced: inject from the host page)
 *   3. web/config.json             (the file you edit when deploying)
 *   4. localStorage overrides      (the in-app 设置 dialog, per device)
 *
 * Tokens never belong in config.json: the file is published with the site. The
 * settings dialog keeps them in localStorage on each device instead.
 */

/** Cache/version key for stored settings. */
export const SETTINGS_KEY = 'settings.v1';

/** @typedef {'json' | 'rest' | 'github' | 'local'} SourceKind */

/**
 * @typedef {object} AppConfig
 * @property {number} version
 * @property {{title: string, subtitle: string}} site
 * @property {{url: string, cacheBust: boolean}} data
 * @property {SourceKind} source
 * @property {boolean} allowLocalEditing Local-only editing (no server needed).
 * @property {{mode: string, budgetMs: number, maxResults: number, pageSize: number}} search
 * @property {{baseUrl: string, token: string, timeoutMs: number}} rest
 * @property {{owner: string, repo: string, branch: string, path: string, token: string}} github
 */

/** @type {AppConfig} */
export const DEFAULT_CONFIG = {
  version: 1,
  site: {
    title: '概念词条库',
    subtitle: '输入概念名称，或按首字母浏览',
  },
  data: {
    url: './data/entries.json',
    cacheBust: false,
  },
  source: 'json',
  allowLocalEditing: true,
  search: {
    mode: 'contains',
    budgetMs: 400,
    maxResults: 1000,
    pageSize: 200,
  },
  rest: {
    baseUrl: '',
    token: '',
    timeoutMs: 10_000,
  },
  github: {
    owner: '',
    repo: '',
    branch: 'main',
    path: 'web/data/entries.json',
    token: '',
  },
};

/**
 * @param {unknown} value
 * @returns {boolean} True for a plain object (not null, not an array).
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep merge: objects merge recursively, everything else replaces the base value.
 *
 * @template T
 * @param {T} base
 * @param {unknown} patch
 * @returns {T}
 */
export function mergeConfig(base, patch) {
  if (!isPlainObject(patch)) {
    return base;
  }
  /** @type {Record<string, unknown>} */
  const result = { .../** @type {Record<string, unknown>} */ (base) };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (value === undefined) {
      continue;
    }
    result[key] = isPlainObject(current) && isPlainObject(value) ? mergeConfig(current, value) : value;
  }
  return /** @type {T} */ (result);
}

/**
 * Coerce a merged config into a valid one (unknown source kinds fall back).
 *
 * @param {unknown} raw
 * @returns {AppConfig}
 */
export function normalizeConfig(raw) {
  const config = mergeConfig(structuredClone(DEFAULT_CONFIG), raw);
  const kinds = ['json', 'rest', 'github', 'local'];
  if (!kinds.includes(config.source)) {
    config.source = 'json';
  }
  config.data.url = String(config.data.url ?? '').trim() || DEFAULT_CONFIG.data.url;
  config.rest.baseUrl = String(config.rest.baseUrl ?? '').trim().replace(/\/+$/, '');
  config.github.path = String(config.github.path ?? '').trim() || DEFAULT_CONFIG.github.path;
  config.github.branch = String(config.github.branch ?? '').trim() || 'main';
  config.search.budgetMs = Number(config.search.budgetMs) || DEFAULT_CONFIG.search.budgetMs;
  config.search.maxResults = Number(config.search.maxResults) || DEFAULT_CONFIG.search.maxResults;
  config.search.pageSize = Number(config.search.pageSize) || DEFAULT_CONFIG.search.pageSize;
  return config;
}

/**
 * Read per-device overrides written by the settings dialog.
 *
 * @param {{get: (key: string, fallback: any) => any}} storage
 * @returns {object} A (possibly empty) partial config.
 */
export function readOverrides(storage) {
  const stored = storage.get(SETTINGS_KEY, null);
  return isPlainObject(stored) ? stored : {};
}

/**
 * Persist per-device overrides.
 *
 * @param {{get: Function, set: Function}} storage
 * @param {object} overrides Partial config.
 * @returns {object} The merged overrides after saving.
 */
export function writeOverrides(storage, overrides) {
  const merged = mergeConfig(readOverrides(storage), overrides);
  storage.set(SETTINGS_KEY, merged);
  return merged;
}

/**
 * @param {string} url
 * @returns {string} `url` with a cache-busting query parameter.
 */
function withCacheBuster(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

/**
 * Load the effective configuration.
 *
 * `config.json` is optional: when it is missing (for example on a fresh fork)
 * the defaults are used and a warning is reported so the UI can hint at it.
 *
 * @param {{storage: {get: Function, set: Function}, fetchImpl?: typeof fetch,
 *   configUrl?: string, now?: () => number}} options
 * @returns {Promise<{config: AppConfig, warnings: string[], loadedFromConfigFile: boolean}>}
 */
export async function loadConfig(options) {
  const { storage } = options;
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const configUrl = options.configUrl ?? './config.json';
  const warnings = [];
  let config = normalizeConfig(globalThis.__LADR_CONFIG__ ?? {});
  let loadedFromConfigFile = false;

  if (fetchImpl) {
    try {
      const response = await fetchImpl(withCacheBuster(configUrl), { cache: 'no-store' });
      if (response.ok) {
        const raw = await response.json();
        config = normalizeConfig(mergeConfig(config, raw));
        loadedFromConfigFile = true;
      } else if (response.status !== 404) {
        warnings.push(`config.json 读取失败（HTTP ${response.status}），已使用内置默认配置。`);
      }
    } catch {
      warnings.push('未能读取 config.json，已使用内置默认配置。');
    }
  }

  const overrides = readOverrides(storage);
  config = normalizeConfig(mergeConfig(config, overrides));
  if (config.rest.token !== '' || config.github.token !== '') {
    warnings.push(
      '检测到配置文件中包含访问令牌：该文件会被公开部署，请改用页面右上角的“设置”对话框按设备保存令牌。',
    );
  }
  return { config, warnings, loadedFromConfigFile };
}
/**
 * Configuration of the site itself (not of the data).
 *
 * Precedence: DEFAULT_CONFIG < window.__LADR_CONFIG__ < ./config.json
 *
 * Every path here must stay relative: the site is published from a project
 * subdirectory (`https://user.github.io/<repo>/`) and may be served from any
 * other subpath later, so nothing may assume it lives at the server root.
 */

/**
 * @typedef {object} AppConfig
 * @property {{title: string, tagline: string, updatedLabel: string}} site
 * @property {{url: string, timeoutMs: number}} data
 * @property {{budgetMs: number, maxResults: number}} search
 */

/** @type {AppConfig} */
export const DEFAULT_CONFIG = {
  site: {
    title: '概念词条库',
    tagline: '输入名称查询，或直接翻阅下面的索引。',
    updatedLabel: '更新于',
  },
  data: {
    url: './data/entries.json',
    timeoutMs: 15_000,
  },
  search: {
    budgetMs: 400,
    maxResults: 1000,
  },
};

/**
 * @param {unknown} value
 * @returns {boolean} True for a plain object.
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep merge: objects merge, everything else replaces.
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
    if (value === undefined) {
      continue;
    }
    const existing = result[key];
    result[key] = isPlainObject(existing) && isPlainObject(value) ? mergeConfig(existing, value) : value;
  }
  return /** @type {T} */ (result);
}

/**
 * Coerce a merged config into a usable one.
 *
 * @param {unknown} raw
 * @returns {AppConfig}
 */
export function normalizeConfig(raw) {
  const config = mergeConfig(structuredClone(DEFAULT_CONFIG), raw);
  config.site.title = String(config.site.title ?? '').trim() || DEFAULT_CONFIG.site.title;
  config.site.tagline = String(config.site.tagline ?? '').trim();
  config.site.updatedLabel =
    String(config.site.updatedLabel ?? '').trim() || DEFAULT_CONFIG.site.updatedLabel;
  config.data.url = String(config.data.url ?? '').trim() || DEFAULT_CONFIG.data.url;
  config.data.timeoutMs = Number(config.data.timeoutMs) || DEFAULT_CONFIG.data.timeoutMs;
  config.search.budgetMs = Number(config.search.budgetMs) || DEFAULT_CONFIG.search.budgetMs;
  config.search.maxResults = Number(config.search.maxResults) || DEFAULT_CONFIG.search.maxResults;
  return config;
}

/**
 * @param {string} value
 * @returns {boolean} True when the path is relative (no leading slash, no scheme).
 */
export function isRelativePath(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return true;
  }
  if (text.startsWith('/') || text.startsWith('//')) {
    return false;
  }
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text);
}

/**
 * Load `./config.json` (optional) and merge it over the built-in defaults.
 *
 * @param {{fetchImpl?: typeof fetch, configUrl?: string}} [options]
 * @returns {Promise<{config: AppConfig, warnings: string[]}>}
 */
export async function loadConfig(options = {}) {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const configUrl = options.configUrl ?? './config.json';
  const warnings = [];
  let config = normalizeConfig(globalThis.__LADR_CONFIG__ ?? {});

  if (fetchImpl) {
    try {
      const response = await fetchImpl(configUrl, { cache: 'no-cache' });
      if (response.ok) {
        config = normalizeConfig(mergeConfig(config, await response.json()));
      } else if (response.status !== 404) {
        warnings.push(`config.json 读取失败（HTTP ${response.status}），使用内置默认配置。`);
      }
    } catch {
      warnings.push('未能读取 config.json，使用内置默认配置。');
    }
  }

  if (!isRelativePath(config.data.url)) {
    warnings.push(
      `config.json 里的 data.url 不是相对路径（${config.data.url}）：本站约定只用相对路径，已忽略。`,
    );
    config.data.url = DEFAULT_CONFIG.data.url;
  }
  return { config, warnings };
}
/**
 * Configuration of the site itself (not of the data).
 *
 * Precedence: DEFAULT_CONFIG < window.__LADR_CONFIG__ < ./config.json
 *
 * Every path here must stay relative: the site is published from a project
 * subdirectory (`https://user.github.io/<repo>/`) and may be served from any
 * other subpath later, so nothing may assume it lives at the server root.
 */

import { DEFAULT_LOCALE, normalizeLocale } from './core/locale.js';

/**
 * Site text may be written once (`"title": "Glossary"`) or per language
 * (`"title": { "en": "Glossary", "zh": "词条库" }`); `localizedText()` resolves it.
 *
 * @typedef {string | Record<string, string>} LocalizedString
 * @typedef {object} AppConfig
 * @property {{title: LocalizedString, tagline: LocalizedString,
 *   updatedLabel: LocalizedString, defaultLocale: string}} site
 * @property {{url: string, timeoutMs: number}} data
 * @property {{budgetMs: number, maxResults: number}} search
 */

/** @type {AppConfig} */
export const DEFAULT_CONFIG = {
  site: {
    defaultLocale: DEFAULT_LOCALE,
    title: { en: 'Concept Glossary', zh: '概念词条库' },
    tagline: {
      en: 'Type a name to look it up, or browse the index below.',
      zh: '输入名称查询，或直接翻阅下面的索引。',
    },
    updatedLabel: { en: 'Updated', zh: '更新于' },
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
  config.site.defaultLocale = normalizeLocale(config.site.defaultLocale);
  if (config.site.title === '' || config.site.title === null) {
    config.site.title = DEFAULT_CONFIG.site.title;
  }
  if (config.site.updatedLabel === '' || config.site.updatedLabel === null) {
    config.site.updatedLabel = DEFAULT_CONFIG.site.updatedLabel;
  }
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
 * Warnings come back as keys plus parameters, not as sentences: the interface
 * language is only known *after* the config is read, so the app translates them.
 *
 * @param {{fetchImpl?: typeof fetch, configUrl?: string}} [options]
 * @returns {Promise<{config: AppConfig,
 *   warnings: Array<{key: string, params?: Record<string, unknown>}>}>}
 */
export async function loadConfig(options = {}) {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const configUrl = options.configUrl ?? './config.json';
  /** @type {Array<{key: string, params?: Record<string, unknown>}>} */
  const warnings = [];
  let config = normalizeConfig(globalThis.__LADR_CONFIG__ ?? {});

  if (fetchImpl) {
    try {
      const response = await fetchImpl(configUrl, { cache: 'no-cache' });
      if (response.ok) {
        config = normalizeConfig(mergeConfig(config, await response.json()));
      } else if (response.status !== 404) {
        warnings.push({ key: 'config.unreadable', params: { status: response.status } });
      }
    } catch {
      warnings.push({ key: 'config.missing' });
    }
  }

  if (!isRelativePath(config.data.url)) {
    warnings.push({ key: 'config.notRelative', params: { url: config.data.url } });
    config.data.url = DEFAULT_CONFIG.data.url;
  }
  return { config, warnings };
}
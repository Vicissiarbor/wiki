/**
 * Which language an entry is shown in, and how a missing translation falls back.
 *
 * The rule from the requirements: **English is never missing**, Chinese is
 * optional. So the base fields of an entry are English, and the Chinese
 * translation lives in sibling `…Zh` fields:
 *
 *     { "name": "Complex Number", "nameZh": "复数", "content": "…", "contentZh": "…" }
 *
 * Localization is **per field**: an entry that has a Chinese body but keeps the
 * English name shows exactly that (see docs/data-format.md). Nothing here
 * touches the DOM — the module is pure, so the browser and the tests both use it.
 */

/** Supported locales, in menu order. */
export const LOCALES = Object.freeze(['en', 'zh']);

/** Used when nothing else is configured. */
export const DEFAULT_LOCALE = 'en';

/** Names shown in the language switch (each in its own language). */
export const LOCALE_LABELS = Object.freeze({ en: 'English', zh: '中文' });

/**
 * Optional Chinese counterparts of the entry fields, and the field each one
 * overrides when the Chinese locale is active.
 */
export const LOCALIZED_FIELDS = Object.freeze({
  nameZh: 'name',
  aliasesZh: 'aliases',
  initialZh: 'initial',
  tagsZh: 'tags',
  summaryZh: 'summary',
  contentZh: 'content',
});

/**
 * @param {unknown} value
 * @returns {boolean} True when `value` is a supported locale code.
 */
export function isLocale(value) {
  return typeof value === 'string' && LOCALES.includes(value);
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string} A supported locale code.
 */
export function normalizeLocale(value, fallback = DEFAULT_LOCALE) {
  if (isLocale(value)) {
    return /** @type {string} */ (value);
  }
  return isLocale(fallback) ? fallback : DEFAULT_LOCALE;
}

/**
 * @param {string} locale
 * @returns {string} The BCP-47 tag for `<html lang>` and collation.
 */
export function localeTag(locale) {
  return normalizeLocale(locale) === 'zh' ? 'zh-Hans-CN' : 'en';
}

/**
 * Resolve a configuration value that may be written per locale:
 * `"Glossary"` (same in every language) or `{ "en": "Glossary", "zh": "词条库" }`.
 *
 * @param {unknown} value
 * @param {string} locale
 * @param {string} [fallbackText] Used when the value is missing entirely.
 * @returns {string}
 */
export function localizedText(value, locale, fallbackText = '') {
  const target = normalizeLocale(locale);
  if (value === null || value === undefined) {
    return fallbackText;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const map = /** @type {Record<string, unknown>} */ (value);
    for (const candidate of [target, DEFAULT_LOCALE, ...LOCALES]) {
      const text = map[candidate];
      if (typeof text === 'string' && text !== '') {
        return text;
      }
    }
  }
  return fallbackText;
}

/**
 * @param {unknown} value
 * @param {string} locale
 * @returns {string[]} The list to display: the Chinese one when it exists,
 *   otherwise the English one.
 */
function localizedList(value, locale) {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => String(item));
}

/**
 * Pick the display version of an entry.
 *
 * Returns a plain object (not a frozen entry) with every display field resolved:
 * one language only, never a mix of both.
 *
 * @param {import('./entry.js').Entry} entry
 * @param {string} locale
 * @returns {object} The display entry.
 */
export function localizeEntry(entry, locale) {
  const target = normalizeLocale(locale);
  const chinese = target === 'zh';
  /** @type {Record<string, any>} */
  const source = entry;

  /**
   * @param {string} field
   * @param {any} [whenMissing]
   * @returns {any}
   */
  const pick = (field, whenMissing) => {
    const base = source[field];
    if (!chinese) {
      return base === undefined ? whenMissing : base;
    }
    const overlay = source[`${field}Zh`];
    const hasOverlay = Array.isArray(overlay) ? overlay.length > 0 : Boolean(overlay);
    if (hasOverlay) {
      return overlay;
    }
    return base === undefined ? whenMissing : base;
  };

  const name = pick('name', '');

  return {
    id: source.id,
    name,
    aliases: localizedList(pick('aliases', []), target),
    initial: pick('initial', ''),
    tags: localizedList(pick('tags', []), target),
    summary: pick('summary', ''),
    content: pick('content', ''),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

/**
 * @param {import('./entry.js').Entry[]} entries
 * @param {string} locale
 * @returns {object[]}
 */
export function localizeEntries(entries, locale) {
  return entries.map((entry) => localizeEntry(entry, locale));
}
/**
 * Entry model: normalization, validation and creation of glossary entries.
 *
 * An entry is the unit the user searches for: a concept name plus its article.
 * This module is pure (no DOM, no network) and is shared by the frontend and
 * the Node backend so that both enforce exactly the same rules.
 */

import { ValidationError } from './errors.js';

/** Field limits. They exist to keep the JSON bundle small and the UI predictable. */
export const LIMITS = Object.freeze({
  ID: 128,
  NAME: 200,
  ALIAS: 200,
  ALIASES: 50,
  TAG: 64,
  TAGS: 50,
  SUMMARY: 500,
  CONTENT: 200_000,
});

/** Stable ids are used in shareable URLs (`#/entry/<id>`), so keep them URL-safe. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

/** Optional per-entry override for the "sort by initial" grouping. */
export const INITIAL_PATTERN = /^[A-Z#]$/;

/**
 * Timestamps may be written to the day (`2026-10-04`) or as full ISO-8601.
 * Hand-maintained entries only need day precision, so both are accepted and the
 * day-only form is shown exactly as written.
 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A full timestamp: `2026-10-04T11:28`, `2026-10-04T11:28:00Z`, `+08:00` offsets,
 * and (for convenience while writing) a space instead of `T`.
 */
export const DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * @param {unknown} value
 * @returns {boolean} True for '' (the fields are optional), a day-precision
 *   date, or a full ISO-8601 timestamp. Deliberately stricter than
 *   `Date.parse`, which happily accepts things like `2026/10/04`.
 */
export function isValidTimestamp(value) {
  const text = cleanText(value);
  if (text === '') {
    return true;
  }
  if (DATE_PATTERN.test(text)) {
    return !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
  }
  if (!DATETIME_PATTERN.test(text)) {
    return false;
  }
  return !Number.isNaN(Date.parse(text.replace(' ', 'T')));
}

/**
 * Keys of a stored entry, in the order used when serializing.
 *
 * English is the base language (never missing) and each optional Chinese field
 * sits right next to the field it translates — see core/locale.js.
 */
export const ENTRY_KEYS = Object.freeze([
  'id',
  'name',
  'nameZh',
  'aliases',
  'aliasesZh',
  'initial',
  'initialZh',
  'tags',
  'tagsZh',
  'summary',
  'summaryZh',
  'content',
  'contentZh',
  'createdAt',
  'updatedAt',
]);

/**
 * @typedef {object} Entry
 * @property {string} id Stable, URL-safe identifier.
 * @property {string} name Concept name, unique across the collection.
 * @property {string[]} aliases Alternative names that also match in search.
 * @property {string} initial Optional A-Z (or '#') override for grouping.
 * @property {string[]} tags Free-form labels.
 * @property {string} summary One-line description shown in the result list.
 * @property {string} content Article body (a Markdown subset, see markdown.js).
 * @property {string} createdAt ISO-8601 timestamp.
 * @property {string} updatedAt ISO-8601 timestamp.
 */

/**
 * Collapse whitespace, normalize width and strip control characters.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function cleanText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

/**
 * @param {unknown} value
 * @returns {string} Trimmed single-line text with collapsed inner whitespace.
 */
export function cleanLine(value) {
  return cleanText(value).replace(/\s+/g, ' ');
}

/**
 * @param {unknown} value
 * @returns {string[]} Deduplicated, trimmed string list (empty entries dropped).
 */
function cleanStringList(value) {
  const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const text = cleanLine(item);
    if (text === '') {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
  }
  return result;
}

/**
 * Turn arbitrary input into a well-formed entry without judging its content.
 *
 * Unknown keys are dropped and known keys are coerced, so a hand-edited JSON
 * bundle can never inject surprises into the UI. Structural problems (missing
 * name, wrong types) still throw.
 *
 * @param {unknown} raw
 * @returns {Entry}
 * @throws {ValidationError} When the value cannot be read as an entry at all.
 */
export function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('词条必须是一个 JSON 对象。');
  }
  const source = /** @type {Record<string, unknown>} */ (raw);

  const name = cleanLine(source.name);
  if (name === '') {
    throw new ValidationError('词条缺少 name 字段。', [{ field: 'name', message: '不能为空' }]);
  }

  const initial = cleanLine(source.initial).toUpperCase();
  if (initial !== '' && !INITIAL_PATTERN.test(initial)) {
    throw new ValidationError(`词条 “${name}” 的 initial 必须是 A-Z 或 #。`, [
      { field: 'initial', message: `非法值 “${initial}”` },
    ]);
  }

  const id = cleanLine(source.id);

  const initialZh = cleanLine(source.initialZh).toUpperCase();
  if (initialZh !== '' && !INITIAL_PATTERN.test(initialZh)) {
    throw new ValidationError(`词条 “${name}” 的 initialZh 必须是 A-Z 或 #。`, [
      { field: 'initialZh', message: `非法值 “${initialZh}”` },
    ]);
  }

  return {
    id,
    name,
    nameZh: cleanLine(source.nameZh),
    aliases: cleanStringList(source.aliases),
    aliasesZh: cleanStringList(source.aliasesZh),
    initial,
    initialZh,
    tags: cleanStringList(source.tags),
    tagsZh: cleanStringList(source.tagsZh),
    summary: cleanLine(source.summary),
    summaryZh: cleanLine(source.summaryZh),
    content: cleanText(source.content),
    contentZh: cleanText(source.contentZh),
    createdAt: typeof source.createdAt === 'string' ? cleanText(source.createdAt) : '',
    updatedAt: typeof source.updatedAt === 'string' ? cleanText(source.updatedAt) : '',
  };
}

/**
 * @param {unknown} value
 * @returns {string} `value` when it is a valid ISO-8601 date, otherwise ''.
 */
function cleanTimestamp(value) {
  const text = cleanText(value);
  if (text === '') {
    return '';
  }
  if (DATE_PATTERN.test(text)) {
    return isValidTimestamp(text) ? text : '';
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString();
}

/**
 * Validate a normalized entry against the field limits and its siblings.
 *
 * @param {unknown} raw A value accepted by {@link normalizeEntry}.
 * @param {{siblings?: Entry[], previousName?: string}} [context]
 *   `siblings` are the other entries of the collection (used for uniqueness).
 * @returns {{entry: Entry, issues: Array<{field: string, code?: string, message: string}>}}
 *   The normalized entry plus every problem found; an empty issue list means valid.
 */
export function inspectEntry(raw, context = {}) {
  const issues = [];
  let entry;
  try {
    entry = normalizeEntry(raw);
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        entry: null,
        issues: error.issues.length > 0 ? error.issues : [{ field: 'name', message: error.message }],
      };
    }
    throw error;
  }

  if (entry.id === '') {
    issues.push({ field: 'id', code: 'missing', message: '缺少 id（保存时会自动生成）。' });
  } else if (entry.id.length > LIMITS.ID || !ID_PATTERN.test(entry.id)) {
    issues.push({
      field: 'id',
      code: 'format',
      message: 'id 只能包含字母、数字、点、下划线、波浪线和连字符，且需以字母或数字开头。',
    });
  }

  if (entry.name.length > LIMITS.NAME) {
    issues.push({ field: 'name', code: 'too-long', message: `名称不能超过 ${LIMITS.NAME} 个字符。` });
  }
  if (entry.nameZh.length > LIMITS.NAME) {
    issues.push({ field: 'nameZh', code: 'too-long', message: `中文名不能超过 ${LIMITS.NAME} 个字符。` });
  }
  if (entry.summaryZh.length > LIMITS.SUMMARY) {
    issues.push({
      field: 'summaryZh',
      code: 'too-long',
      message: `中文简介不能超过 ${LIMITS.SUMMARY} 个字符。`,
    });
  }
  if (entry.contentZh.length > LIMITS.CONTENT) {
    issues.push({
      field: 'contentZh',
      code: 'too-long',
      message: `中文正文不能超过 ${LIMITS.CONTENT} 个字符。`,
    });
  }
  if (entry.aliasesZh.length > LIMITS.ALIASES) {
    issues.push({ field: 'aliasesZh', code: 'too-many', message: `中文别名最多 ${LIMITS.ALIASES} 个。` });
  }
  if (entry.tagsZh.length > LIMITS.TAGS) {
    issues.push({ field: 'tagsZh', code: 'too-many', message: `中文标签最多 ${LIMITS.TAGS} 个。` });
  }
  for (const alias of entry.aliasesZh) {
    if (alias.length > LIMITS.ALIAS) {
      issues.push({
        field: 'aliasesZh',
        code: 'too-long',
        message: `中文别名 “${alias.slice(0, 20)}…” 超过 ${LIMITS.ALIAS} 个字符。`,
      });
      break;
    }
  }
  for (const tag of entry.tagsZh) {
    if (tag.length > LIMITS.TAG) {
      issues.push({
        field: 'tagsZh',
        code: 'too-long',
        message: `中文标签 “${tag}” 超过 ${LIMITS.TAG} 个字符。`,
      });
      break;
    }
  }
  if (entry.summary.length > LIMITS.SUMMARY) {
    issues.push({
      field: 'summary',
      code: 'too-long',
      message: `简介不能超过 ${LIMITS.SUMMARY} 个字符。`,
    });
  }
  if (entry.content.length > LIMITS.CONTENT) {
    issues.push({
      field: 'content',
      code: 'too-long',
      message: `正文不能超过 ${LIMITS.CONTENT} 个字符。`,
    });
  }
  if (entry.aliases.length > LIMITS.ALIASES) {
    issues.push({ field: 'aliases', code: 'too-many', message: `别名最多 ${LIMITS.ALIASES} 个。` });
  }
  for (const alias of entry.aliases) {
    if (alias.length > LIMITS.ALIAS) {
      issues.push({
        field: 'aliases',
        code: 'too-long',
        message: `别名 “${alias.slice(0, 20)}…” 超过 ${LIMITS.ALIAS} 个字符。`,
      });
      break;
    }
  }
  if (entry.tags.length > LIMITS.TAGS) {
    issues.push({ field: 'tags', code: 'too-many', message: `标签最多 ${LIMITS.TAGS} 个。` });
  }
  for (const field of ['createdAt', 'updatedAt']) {
    if (!isValidTimestamp(entry[field])) {
      issues.push({
        field,
        code: 'format',
        message: `${field} 需要写成 YYYY-MM-DD（精确到日）或完整 ISO-8601 时间。`,
      });
    }
  }
  for (const tag of entry.tags) {
    if (tag.length > LIMITS.TAG) {
      issues.push({
        field: 'tags',
        code: 'too-long',
        message: `标签 “${tag}” 超过 ${LIMITS.TAG} 个字符。`,
      });
      break;
    }
  }

  const siblings = context.siblings ?? [];
  const ownName = entry.name.toLowerCase();
  const ownAliases = new Set(entry.aliases.map((alias) => alias.toLowerCase()));
  for (const sibling of siblings) {
    if (entry.id !== '' && sibling.id === entry.id) {
      issues.push({ field: 'id', code: 'duplicate', message: `id “${entry.id}” 已被占用。` });
    }
    const siblingName = sibling.name.toLowerCase();
    if (siblingName === ownName) {
      issues.push({ field: 'name', code: 'duplicate', message: `名称 “${entry.name}” 已存在。` });
    } else if (ownAliases.has(siblingName)) {
      issues.push({
        field: 'aliases',
        code: 'shadowed',
        message: `别名 “${sibling.name}” 与已有词条名称重复。`,
      });
    }
  }

  if (context.previousName !== undefined && context.previousName !== entry.name) {
    const previous = context.previousName.toLowerCase();
    for (const sibling of siblings) {
      if (sibling.name.toLowerCase() === previous) {
        issues.push({
          field: 'name',
          code: 'duplicate',
          message: `改名后与已有词条 “${sibling.name}” 冲突。`,
        });
      }
    }
  }

  return { entry, issues };
}

/**
 * Throw when an entry is invalid. Used by the API layer on the write path.
 *
 * @param {unknown} raw
 * @param {{siblings?: Entry[], previousName?: string}} [context]
 * @returns {Entry}
 * @throws {ValidationError}
 */
export function assertValidEntry(raw, context = {}) {
  const { entry, issues } = inspectEntry(raw, context);
  if (entry === null || issues.length > 0) {
    throw new ValidationError('词条数据不合法。', issues);
  }
  return entry;
}

/**
 * Deterministic FNV-1a hash in base36; used to build ids for names that contain
 * no ASCII word characters (for example purely Chinese names).
 *
 * @param {string} value
 * @returns {string}
 */
export function shortHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Build a URL-safe, stable id from a name.
 *
 * ASCII names become a slug (`Graph Theory` -> `graph-theory`); names without
 * usable characters fall back to `term-<hash>`, which is deterministic so the
 * same name always yields the same URL.
 *
 * @param {string} name
 * @param {{taken?: Iterable<string>}} [options] Existing ids to avoid colliding with.
 * @returns {string}
 */
export function buildEntryId(name, options = {}) {
  const taken = new Set(options.taken ?? []);
  const ascii = cleanLine(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.ID - 5);
  let candidate = ascii === '' ? `term-${shortHash(name)}` : ascii;
  if (!ID_PATTERN.test(candidate)) {
    candidate = `term-${shortHash(candidate)}`;
  }
  if (!taken.has(candidate)) {
    return candidate;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const suffixed = `${candidate}-${suffix}`;
    if (!taken.has(suffixed)) {
      return suffixed;
    }
  }
  return `term-${shortHash(`${name}:${taken.size}`)}`;
}

/**
 * @param {Date} [now]
 * @returns {string} ISO-8601 timestamp.
 */
export function timestamp(now = new Date()) {
  return now.toISOString();
}

/**
 * Create a valid entry from user input, filling id and timestamps.
 *
 * @param {Partial<Entry> & {name: string}} input
 * @param {{taken?: Iterable<string>, now?: Date}} [options]
 * @returns {Entry}
 * @throws {ValidationError}
 */
export function createEntry(input, options = {}) {
  const now = timestamp(options.now);
  const normalized = normalizeEntry({
    ...input,
    id: cleanLine(input.id) || buildEntryId(String(input.name ?? ''), { taken: options.taken }),
  });
  const entry = {
    ...normalized,
    createdAt: cleanTimestamp(input.createdAt) || now,
    updatedAt: cleanTimestamp(input.updatedAt) || now,
  };
  return assertValidEntry(entry, { siblings: [] });
}

/**
 * Produce the next version of an existing entry.
 *
 * @param {Entry} existing
 * @param {Partial<Entry>} patch
 * @param {{now?: Date}} [options]
 * @returns {Entry}
 * @throws {ValidationError}
 */
export function applyEntryPatch(existing, patch, options = {}) {
  const merged = normalizeEntry({ ...existing, ...patch, id: existing.id });
  const entry = {
    ...merged,
    createdAt: existing.createdAt || timestamp(options.now),
    // An explicit `updatedAt` is kept as written (day precision stays day
    // precision); otherwise the edit is stamped with the current time.
    updatedAt: cleanTimestamp(patch.updatedAt) || timestamp(options.now),
  };
  return assertValidEntry(entry, { siblings: [] });
}

/**
 * Query parsing and matching.
 *
 * Three modes are supported (see docs/search-syntax.md):
 *
 *   contains  default; case- and width-insensitive substring match
 *   exact     整条名称/别名完全相等，可用 `=` 前缀或界面切换进入
 *   regex     正则表达式，可用 `/pattern/flags` 写法指定
 *
 * A query may also carry a field scope (`tag:数学`, `content:/定理/`).
 * The parser never throws: problems come back as `error`, which keeps the
 * search box responsive while the user is still typing.
 */

import { createTranslator } from './i18n.js';
import { createNameCollator } from './sort.js';

/** Default translator: English, matching the site's default locale. */
const defaultTranslate = createTranslator('en');

/** @typedef {'contains' | 'exact' | 'regex'} SearchMode */

/** @enum {SearchMode} */
export const SearchMode = Object.freeze({
  CONTAINS: /** @type {SearchMode} */ ('contains'),
  EXACT: /** @type {SearchMode} */ ('exact'),
  REGEX: /** @type {SearchMode} */ ('regex'),
});

/** Fields a query can be scoped to. `text` means "every field". */
export const SEARCH_FIELDS = Object.freeze(['name', 'aliases', 'tags', 'summary', 'content']);

/** Accepted scope spellings: `tag:` and `tags:` both work. */
export const FIELD_SCOPES = Object.freeze({
  name: 'name',
  alias: 'aliases',
  aliases: 'aliases',
  tag: 'tags',
  tags: 'tags',
  summary: 'summary',
  description: 'summary',
  content: 'content',
  body: 'content',
  text: 'text',
  all: 'text',
});

/** Fields whose content is searched by default in regex mode (content is opt-in). */
export const DEFAULT_REGEX_FIELDS = Object.freeze(['name', 'aliases', 'tags', 'summary']);

/** Guards against pathological queries and runaway backtracking. */
export const MAX_QUERY_LENGTH = 200;

/** Wall-clock budget for one search; exceeding it returns partial results. */
export const DEFAULT_BUDGET_MS = 400;

/** Hard cap on returned results, so the DOM never gets thousands of nodes. */
export const MAX_RESULTS = 1000;

/** Longest subject handed to a user-supplied regex (bounds backtracking cost). */
export const MAX_REGEX_SUBJECT_LENGTH = 4096;

/** Regex literals: `/pattern/` plus optional flags. */
const REGEX_LITERAL = /^\/(.+)\/([a-z]*)$/s;

/** Field scope prefix: an ASCII word followed by a colon. */
const SCOPE_PREFIX = /^([A-Za-z]+):\s*/;

/**
 * @typedef {object} ParsedQuery
 * @property {string} raw Query exactly as typed.
 * @property {string} term Text to match (scope and mode markers stripped).
 * @property {SearchMode} mode Effective mode.
 * @property {string} scope `'text'`, a field name, or '' when unscoped.
 * @property {RegExp|null} regex Compiled expression in regex mode.
 * @property {boolean} isEmpty True when there is nothing to search for.
 * @property {string} error Non-empty when the query cannot be run.
 */

/**
 * Case- and width-insensitive normalization used by contains/exact matching.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeForMatch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Patterns that are very likely to backtrack catastrophically.
 *
 * A JavaScript regex cannot be interrupted while it runs, so no time budget can
 * save the tab once `(a+)+b` meets a long run of "a": the whole page locks up.
 * These heuristics reject the classic shapes up front (nested quantifiers,
 * quantified alternations, stacked wildcards) and ask the user to rewrite the
 * expression. See docs/search-syntax.md for safe rewrites.
 */
const RISKY_REGEX_PATTERNS = Object.freeze([
  { pattern: /\((?:[^()\\]|\\.)*[*+][^()\\]*(?:[*+?]|\{\d)/, reason: 'search.reason.nested' },
  { pattern: /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*(?:[*+]|\{\d)/, reason: 'search.reason.alternation' },
  { pattern: /(?:\.\*|\.\+)[^)]*(?:\.\*|\.\+)/, reason: 'search.reason.wildcards' },
  { pattern: /\((?:[^()\\]|\\.)*[*+](?:[^()\\]|\\.)*\)\s*(?:[*+]|\{\d)/, reason: 'search.reason.nested' },
]);

/**
 * @param {string} source Regex source as typed by the user.
 * @param {(key: string) => string} [t] Translator for the reason text.
 * @returns {{risky: boolean, reason: string}}
 */
export function assessRegexRisk(source, t = defaultTranslate) {
  for (const { pattern, reason } of RISKY_REGEX_PATTERNS) {
    if (pattern.test(source)) {
      return { risky: true, reason: t(reason) };
    }
  }
  return { risky: false, reason: '' };
}

/**
 * @param {string} source
 * @param {string} flags
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 * @returns {{regex: RegExp|null, error: string}}
 */
function compileRegex(source, flags, t) {
  const finalFlags = flags === '' ? 'i' : flags;
  if (/[gy]/.test(finalFlags)) {
    // Stateful flags would make repeated .test() calls lie; matching adds them when needed.
    return { regex: null, error: t('search.error.regexFlags') };
  }
  const risk = assessRegexRisk(source, t);
  if (risk.risky) {
    return { regex: null, error: t('search.error.regexRisky', { reason: risk.reason }) };
  }
  try {
    return { regex: new RegExp(source, finalFlags), error: '' };
  } catch (error) {
    // Engines already prefix this; keep the detail and avoid saying it twice.
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/^Invalid regular expression:\s*/i, '')
      .trim();
    return { regex: null, error: t('search.error.regexInvalid', { message }) };
  }
}

/**
 * Parse a raw query string.
 *
 * @param {string} raw
 * @param {{mode?: SearchMode, t?: (key: string, params?: Record<string, unknown>) => string}} [options]
 *   `mode` is the mode chosen in the UI (syntax markers still win); `t` is the
 *   translator used for error messages, defaulting to English.
 * @returns {ParsedQuery}
 */
export function parseQuery(raw, options = {}) {
  const t = options.t ?? defaultTranslate;
  const text = String(raw ?? '').normalize('NFC').trim();
  /** @type {ParsedQuery} */
  const parsed = {
    raw: text,
    term: '',
    mode: options.mode ?? SearchMode.CONTAINS,
    scope: '',
    regex: null,
    isEmpty: true,
    error: '',
  };
  if (text === '') {
    return parsed;
  }
  if (text.length > MAX_QUERY_LENGTH) {
    parsed.term = text.slice(0, MAX_QUERY_LENGTH);
    parsed.isEmpty = false;
    parsed.error = t('search.error.tooLong', { max: MAX_QUERY_LENGTH });
    return parsed;
  }

  let rest = text;
  const scopeMatch = SCOPE_PREFIX.exec(rest);
  if (scopeMatch) {
    const scope = FIELD_SCOPES[scopeMatch[1].toLowerCase()];
    if (scope) {
      parsed.scope = scope;
      rest = rest.slice(scopeMatch[0].length).trim();
      if (rest === '') {
        parsed.isEmpty = false;
        parsed.error = t('search.error.scopeEmpty', { scope: scopeMatch[1] });
        return parsed;
      }
    }
  }

  const literal = REGEX_LITERAL.exec(rest);
  if (literal && literal[1] !== '') {
    // `/pattern/flags` always means regex, whatever the selector says.
    const { regex, error } = compileRegex(literal[1], literal[2] ?? '', t);
    parsed.mode = SearchMode.REGEX;
    parsed.term = literal[1];
    parsed.regex = regex;
    parsed.isEmpty = false;
    parsed.error = error;
    return parsed;
  }

  if (rest.startsWith('=')) {
    parsed.mode = SearchMode.EXACT;
    rest = rest.slice(1).trim();
  }

  if (parsed.mode === SearchMode.EXACT) {
    parsed.term = rest.replace(/^"(.*)"$/s, '$1').trim();
  } else {
    parsed.term = rest;
  }
  parsed.isEmpty = parsed.term === '';

  if (parsed.mode === SearchMode.REGEX) {
    const { regex, error } = compileRegex(parsed.term, '', t);
    parsed.regex = regex;
    parsed.error = error;
  }
  return parsed;
}

/**
 * Relevance weights per field and match kind. Tuned so that an exact name hit
 * always beats a body-text hit.
 */
const WEIGHTS = Object.freeze({
  name: { exact: 1000, prefix: 800, contains: 600, regex: 900 },
  aliases: { exact: 700, prefix: 520, contains: 420, regex: 620 },
  tags: { exact: 320, prefix: 300, contains: 220, regex: 300 },
  summary: { exact: 200, prefix: 180, contains: 140, regex: 160 },
  content: { exact: 120, prefix: 110, contains: 90, regex: 100 },
});

/**
 * @param {ParsedQuery} parsed
 * @returns {string[]} Fields to inspect, in priority order.
 */
export function fieldsForQuery(parsed) {
  if (parsed.isEmpty) {
    // Nothing is matched in browse mode; the list is ordered by name.
    return ['name'];
  }
  if (parsed.scope === 'text') {
    return [...SEARCH_FIELDS];
  }
  if (parsed.scope !== '') {
    return [parsed.scope];
  }
  if (parsed.mode === SearchMode.REGEX) {
    return [...DEFAULT_REGEX_FIELDS];
  }
  return [...SEARCH_FIELDS];
}

/**
 * @param {{name: string, aliases?: string[], tags?: string[], summary?: string, content?: string}} entry
 * @param {string} field
 * @returns {string[]} Values stored in `field` (aliases/tags may hold several).
 */
function valuesOf(entry, field) {
  /**
   * Search always covers **both languages**, whatever the interface language is:
   * looking up “复数” must find the entry whose displayed name is “Complex
   * Number”. Chinese lives in the `…Zh` sibling fields (see core/locale.js).
   *
   * @param {string} base
   * @param {string} overlay
   * @returns {string[]}
   */
  const both = (base, overlay) => [base, overlay].filter((value) => typeof value === 'string' && value !== '');
  const bothLists = (base, overlay) => [
    ...(Array.isArray(base) ? base : []),
    ...(Array.isArray(overlay) ? overlay : []),
  ];

  switch (field) {
    case 'name':
      return both(String(entry.name ?? ''), String(entry.nameZh ?? ''));
    case 'aliases':
      return bothLists(entry.aliases, entry.aliasesZh);
    case 'tags':
      return bothLists(entry.tags, entry.tagsZh);
    case 'summary':
      return both(String(entry.summary ?? ''), String(entry.summaryZh ?? ''));
    case 'content':
      return both(String(entry.content ?? ''), String(entry.contentZh ?? ''));
    default:
      return [];
  }
}

/**
 * Score one entry against a parsed query.
 *
 * @param {object} entry
 * @param {ParsedQuery} parsed
 * @returns {{score: number, fields: string[], kind: string}|null} `null` when no match.
 */
export function matchEntry(entry, parsed) {
  if (parsed.isEmpty || parsed.error !== '') {
    return null;
  }
  const term = parsed.mode === SearchMode.REGEX ? parsed.term : normalizeForMatch(parsed.term);
  if (term === '') {
    return null;
  }
  let best = null;
  for (const field of fieldsForQuery(parsed)) {
    const values = valuesOf(entry, field);
    for (const value of values) {
      if (value === '') {
        continue;
      }
      let kind = '';
      if (parsed.mode === SearchMode.REGEX) {
        // The subject is truncated so a single value cannot dominate the budget.
        const subject =
          value.length > MAX_REGEX_SUBJECT_LENGTH ? value.slice(0, MAX_REGEX_SUBJECT_LENGTH) : value;
        kind = parsed.regex && safeTest(parsed.regex, subject) ? 'regex' : '';
      } else {
        const haystack = normalizeForMatch(value);
        if (parsed.mode === SearchMode.EXACT) {
          kind = haystack === term ? 'exact' : '';
        } else if (haystack === term) {
          kind = 'exact';
        } else if (haystack.startsWith(term)) {
          kind = 'prefix';
        } else if (haystack.includes(term)) {
          kind = 'contains';
        }
      }
      if (kind === '') {
        continue;
      }
      const score = WEIGHTS[field][kind] ?? 0;
      if (best === null || score > best.score) {
        best = { score, fields: [field], kind };
      } else if (score === best.score && !best.fields.includes(field)) {
        best.fields.push(field);
      }
      if (field === 'name' && kind === 'exact') {
        return best; // Nothing can outrank an exact name match.
      }
    }
  }
  return best;
}

/**
 * `RegExp.prototype.test` on a regex without stateful flags; wrapped so a
 * pathological pattern cannot take the whole page down silently.
 *
 * @param {RegExp} regex
 * @param {string} value
 * @returns {boolean}
 */
function safeTest(regex, value) {
  try {
    return regex.test(value);
  } catch {
    return false;
  }
}

/**
 * @returns {() => number} Monotonic clock in milliseconds.
 */
function clock() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return () => performance.now();
  }
  return () => Date.now();
}

const now = clock();

/**
 * @typedef {object} SearchOutcome
 * @property {ParsedQuery} parsed
 * @property {Array<{entry: object, score: number, fields: string[], kind: string}>} results
 * @property {string} error
 * @property {boolean} truncated True when the time budget or result cap cut the scan short.
 * @property {number} elapsedMs
 * @property {number} scanned
 */

/**
 * Search a list of entries.
 *
 * @param {object[]} entries
 * @param {string} rawQuery
 * @param {{mode?: SearchMode, budgetMs?: number, maxResults?: number,
 *   compare?: (a: string, b: string) => number, collator?: {compare: (a: string, b: string) => number},
 *   t?: (key: string, params?: Record<string, unknown>) => string}} [options]
 * @returns {SearchOutcome}
 */
export function searchEntries(entries, rawQuery, options = {}) {
  const started = now();
  const parsed = parseQuery(rawQuery, { mode: options.mode, t: options.t });
  /** @type {SearchOutcome} */
  const outcome = {
    parsed,
    results: [],
    error: parsed.error,
    truncated: false,
    elapsedMs: 0,
    scanned: 0,
  };
  if (parsed.error !== '') {
    outcome.elapsedMs = now() - started;
    return outcome;
  }

  const collator = options.collator ?? (options.compare ? { compare: options.compare } : createNameCollator());
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxResults = options.maxResults ?? MAX_RESULTS;

  if (parsed.isEmpty) {
    // Empty query = browse mode: rank by name so the list matches the A-Z index.
    outcome.results = entries
      .map((entry) => ({ entry, score: 0, fields: [], kind: 'all' }))
      .sort((a, b) => compareForBrowse(a.entry, b.entry, collator))
      .slice(0, maxResults);
    outcome.truncated = outcome.results.length < entries.length;
    outcome.scanned = entries.length;
    outcome.elapsedMs = now() - started;
    return outcome;
  }

  for (const entry of entries) {
    outcome.scanned += 1;
    const match = matchEntry(entry, parsed);
    if (match) {
      outcome.results.push({ entry, ...match });
    }
    if ((outcome.scanned & 0xf) === 0 && now() - started > budgetMs) {
      outcome.truncated = true;
      outcome.error = (options.t ?? defaultTranslate)('search.error.budget', { ms: budgetMs });
      break;
    }
  }

  outcome.results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return compareForBrowse(a.entry, b.entry, collator);
  });
  if (outcome.results.length > maxResults) {
    outcome.results.length = maxResults;
    outcome.truncated = true;
  }
  outcome.elapsedMs = now() - started;
  return outcome;
}

/**
 * Tie-break comparator: shorter names first (closer to the query), then the
 * same ordering the A-Z list uses.
 *
 * @param {{name: string, id: string}} a
 * @param {{name: string, id: string}} b
 * @param {{compare: (a: string, b: string) => number}} collator
 * @returns {number}
 */
function compareForBrowse(a, b, collator) {
  const byLength = a.name.length - b.name.length;
  if (byLength !== 0) {
    return byLength;
  }
  const byName = collator.compare(a.name, b.name);
  if (byName !== 0) {
    return byName;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Locate the matched regions of a value, for highlighting in the list.
 *
 * @param {string} value
 * @param {ParsedQuery} parsed
 * @param {{limit?: number}} [options]
 * @returns {Array<{start: number, end: number}>} Sorted, non-overlapping ranges.
 */
export function findMatches(value, parsed, options = {}) {
  const text = String(value ?? '');
  const limit = options.limit ?? 32;
  /** @type {Array<{start: number, end: number}>} */
  const ranges = [];
  if (text === '' || parsed.isEmpty || parsed.error !== '' || parsed.term === '') {
    return ranges;
  }

  if (parsed.mode === SearchMode.REGEX && parsed.regex) {
    const subject =
      text.length > MAX_REGEX_SUBJECT_LENGTH ? text.slice(0, MAX_REGEX_SUBJECT_LENGTH) : text;
    let global;
    try {
      global = new RegExp(parsed.regex.source, `${parsed.regex.flags.replace(/[gy]/g, '')}g`);
    } catch {
      return ranges;
    }
    for (const match of subject.matchAll(global)) {
      if (match[0] === '') {
        continue;
      }
      ranges.push({ start: match.index, end: match.index + match[0].length });
      if (ranges.length >= limit) {
        break;
      }
    }
    return ranges;
  }

  const needle = parsed.term.normalize('NFKC');
  const haystack = text.normalize('NFKC');
  if (needle === '' || haystack.length !== text.length) {
    // Normalization changed the length (rare); fall back to a plain scan.
    const plain = text.toLowerCase();
    const lower = needle.toLowerCase();
    let index = plain.indexOf(lower);
    while (index !== -1 && ranges.length < limit) {
      ranges.push({ start: index, end: index + lower.length });
      index = plain.indexOf(lower, index + lower.length);
    }
    return ranges;
  }
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let index = lowerHaystack.indexOf(lowerNeedle);
  while (index !== -1 && ranges.length < limit) {
    ranges.push({ start: index, end: index + lowerNeedle.length });
    index = lowerHaystack.indexOf(lowerNeedle, index + lowerNeedle.length);
  }
  return ranges;
}

/**
 * Human readable description of a query, shown under the search box.
 *
 * @param {ParsedQuery} parsed
 * @returns {string}
 */
export function describeQuery(parsed, t = defaultTranslate) {
  if (parsed.error !== '') {
    return parsed.error;
  }
  if (parsed.isEmpty) {
    return t('hint.browse');
  }
  const mode =
    parsed.mode === SearchMode.EXACT
      ? t('hint.exact')
      : parsed.mode === SearchMode.REGEX
        ? t('hint.regex')
        : t('hint.contains');
  const scope =
    parsed.scope === '' || parsed.scope === 'text'
      ? t('hint.fields.all')
      : t(`hint.fields.${parsed.scope}`);
  return `${mode} · ${scope}`;
}

/**
 * Split a list of values into matched/unmatched runs for rendering highlights.
 *
 * @param {string} value
 * @param {Array<{start: number, end: number}>} ranges
 * @returns {Array<{text: string, match: boolean}>}
 */
export function splitByMatches(value, ranges) {
  const text = String(value ?? '');
  /** @type {Array<{text: string, match: boolean}>} */
  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({ text: text.slice(cursor, range.start), match: false });
    }
    parts.push({ text: text.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }
  return parts;
}

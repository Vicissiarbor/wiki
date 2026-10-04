/**
 * The entry collection: an immutable snapshot of the glossary plus the
 * document format used by every data source.
 *
 * Document format (web/data/entries.json, the REST API and the GitHub source all
 * use it, see docs/data-format.md):
 *
 *     {
 *       "version": 1,
 *       "updatedAt": "2025-01-01T00:00:00.000Z",
 *       "entries": [ { "id": "...", "name": "...", ... } ]
 *     }
 */

import { ValidationError } from './errors.js';
import { ENTRY_KEYS, normalizeEntry } from './entry.js';

/** Current schema version of the bundle. */
export const DOCUMENT_VERSION = 1;

/**
 * Read a bundle into entries, tolerating individual broken entries.
 *
 * A single hand-edited mistake should not blank the whole site, so by default
 * invalid entries are reported through `issues` and skipped. Pass
 * `{strict: true}` for the write path, where a broken entry must fail the save.
 *
 * @param {unknown} raw Parsed JSON: a bundle object or a bare entry array.
 * @param {{strict?: boolean, source?: string}} [options]
 * @returns {{entries: import('./entry.js').Entry[], version: number, updatedAt: string,
 *   issues: Array<{index: number, name?: string, message: string}>}}
 * @throws {ValidationError} When `strict` is set and any entry is invalid.
 */
export function readEntriesDocument(raw, options = {}) {
  const strict = options.strict === true;
  const source = options.source ?? 'entries.json';
  const issues = [];

  let list;
  let version = DOCUMENT_VERSION;
  let updatedAt = '';
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw !== null && typeof raw === 'object') {
    const bundle = /** @type {Record<string, unknown>} */ (raw);
    list = bundle.entries;
    if (typeof bundle.version === 'number' && Number.isFinite(bundle.version)) {
      version = bundle.version;
    }
    if (typeof bundle.updatedAt === 'string') {
      updatedAt = bundle.updatedAt;
    }
    if (!Array.isArray(list)) {
      throw new ValidationError(`${source} 缺少 entries 数组。`);
    }
  } else {
    throw new ValidationError(`${source} 不是一个合法的 JSON 对象。`);
  }

  /** @type {import('./entry.js').Entry[]} */
  const entries = [];
  const seenIds = new Set();
  for (const [index, item] of list.entries()) {
    let entry;
    try {
      entry = normalizeEntry(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (strict) {
        throw error instanceof ValidationError
          ? error
          : new ValidationError(`${source} 第 ${index + 1} 条词条无法解析：${message}`);
      }
      issues.push({ index, message });
      continue;
    }
    if (entry.id === '') {
      const message = `第 ${index + 1} 条词条 “${entry.name}” 缺少 id，已跳过。`;
      if (strict) {
        throw new ValidationError(message, [{ field: 'id', message: '不能为空' }]);
      }
      issues.push({ index, name: entry.name, message });
      continue;
    }
    if (seenIds.has(entry.id)) {
      const message = `第 ${index + 1} 条词条 id “${entry.id}” 重复，已跳过。`;
      if (strict) {
        throw new ValidationError(message, [{ field: 'id', message: '重复' }]);
      }
      issues.push({ index, name: entry.name, message });
      continue;
    }
    seenIds.add(entry.id);
    entries.push(entry);
  }

  return { entries, version, updatedAt, issues };
}

/**
 * An immutable snapshot of the glossary.
 *
 * Every mutation returns a new collection, which keeps the UI free of
 * "who changed what" bugs and makes the optimistic-update flow in
 * data/repository.js easy to reason about.
 */
export class EntryCollection {
  /**
   * @param {import('./entry.js').Entry[]} entries Already normalized entries.
   * @param {{version?: number, updatedAt?: string}} [meta]
   */
  constructor(entries = [], meta = {}) {
    /** @type {import('./entry.js').Entry[]} */
    this._entries = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
    /** @type {Map<string, import('./entry.js').Entry>} */
    this._byId = new Map(this._entries.map((entry) => [entry.id, entry]));
    /** @type {Map<string, import('./entry.js').Entry>} */
    this._byName = new Map(this._entries.map((entry) => [entry.name.toLowerCase(), entry]));
    this.version = meta.version ?? DOCUMENT_VERSION;
    this.updatedAt = meta.updatedAt ?? '';
  }

  /**
   * @param {import('./entry.js').Entry[]} entries
   * @param {{version?: number, updatedAt?: string}} [meta]
   * @returns {EntryCollection}
   */
  static fromEntries(entries, meta = {}) {
    return new EntryCollection(entries, meta);
  }

  /**
   * @param {unknown} raw A bundle object or a bare entry array.
   * @param {{strict?: boolean, source?: string}} [options]
   * @returns {{collection: EntryCollection, issues: Array<{index: number, message: string}>}}
   */
  static fromDocument(raw, options = {}) {
    const { entries, version, updatedAt, issues } = readEntriesDocument(raw, options);
    return { collection: new EntryCollection(entries, { version, updatedAt }), issues };
  }

  /** @returns {readonly import('./entry.js').Entry[]} */
  get entries() {
    return this._entries;
  }

  /** @returns {number} */
  get size() {
    return this._entries.length;
  }

  /** @returns {boolean} */
  get isEmpty() {
    return this._entries.length === 0;
  }

  /**
   * @param {string} id
   * @returns {import('./entry.js').Entry|null}
   */
  byId(id) {
    return this._byId.get(String(id ?? '')) ?? null;
  }

  /**
   * Case-insensitive name lookup (also considers aliases).
   *
   * @param {string} name
   * @returns {import('./entry.js').Entry|null}
   */
  byName(name) {
    const key = String(name ?? '').trim().toLowerCase();
    if (key === '') {
      return null;
    }
    const direct = this._byName.get(key);
    if (direct) {
      return direct;
    }
    for (const entry of this._entries) {
      if (entry.aliases.some((alias) => alias.toLowerCase() === key)) {
        return entry;
      }
    }
    return null;
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._byId.has(id);
  }

  /**
   * Insert or replace an entry.
   *
   * @param {unknown} raw
   * @returns {EntryCollection} A new collection.
   * @throws {ValidationError} When the entry is malformed or duplicates another one.
   */
  withEntry(raw) {
    const entry = normalizeEntry(raw);
    if (entry.id === '') {
      throw new ValidationError('词条缺少 id。', [{ field: 'id', message: '不能为空' }]);
    }
    const existing = this._byId.get(entry.id);
    const siblings = this._entries.filter((item) => item.id !== entry.id);
    if (!existing) {
      const clash = this._byName.get(entry.name.toLowerCase());
      if (clash) {
        throw new ValidationError('词条名称重复。', [
          { field: 'name', message: `已存在词条 “${clash.name}”。` },
        ]);
      }
    }
    const frozen = Object.freeze({ ...entry });
    const next = existing
      ? this._entries.map((item) => (item.id === entry.id ? frozen : item))
      : [...this._entries, frozen];
    // Re-validate against the resulting set so alias/name collisions surface.
    if (entry.name.toLowerCase() !== (existing?.name ?? '').toLowerCase()) {
      for (const sibling of siblings) {
        if (sibling.name.toLowerCase() === entry.name.toLowerCase()) {
          throw new ValidationError('词条名称重复。', [
            { field: 'name', message: `已存在词条 “${sibling.name}”。` },
          ]);
        }
      }
    }
    return new EntryCollection(next, { version: this.version, updatedAt: this.updatedAt });
  }

  /**
   * @param {string} id
   * @returns {EntryCollection} A new collection without `id` (no-op when absent).
   */
  withoutEntry(id) {
    if (!this._byId.has(id)) {
      return this;
    }
    return new EntryCollection(
      this._entries.filter((entry) => entry.id !== id),
      { version: this.version, updatedAt: this.updatedAt },
    );
  }

  /**
   * @returns {string[]} Every id in the collection.
   */
  ids() {
    return this._entries.map((entry) => entry.id);
  }

  /**
   * @param {{updatedAt?: string}} [meta]
   * @returns {{version: number, updatedAt: string, entries: import('./entry.js').Entry[]}}
   *   A plain object with keys in a stable order, ready to be serialized.
   */
  toDocument(meta = {}) {
    return {
      version: this.version,
      updatedAt: meta.updatedAt ?? this.updatedAt ?? new Date().toISOString(),
      entries: this._entries.map((entry) => {
        /** @type {Record<string, unknown>} */
        const ordered = {};
        for (const key of ENTRY_KEYS) {
          const value = /** @type {Record<string, unknown>} */ (entry)[key];
          if (value === '' || value === undefined) {
            continue;
          }
          if (Array.isArray(value) && value.length === 0) {
            continue;
          }
          ordered[key] = value;
        }
        return ordered;
      }),
    };
  }
}
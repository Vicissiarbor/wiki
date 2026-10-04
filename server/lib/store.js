/**
 * File-backed entry store.
 *
 * Design notes
 *   - The JSON file on disk is the single source of truth; nothing is cached in
 *     memory, so a `git pull` or a manual edit is picked up immediately.
 *   - Writes are atomic (temp file + rename) and serialized by an internal
 *     queue, so two devices saving at the same time cannot interleave.
 *   - A content hash doubles as the revision sent in ETag/If-Match, which lets
 *     the UI detect a conflicting edit instead of overwriting it.
 *   - Validation reuses the same core modules as the browser, so the API and
 *     the page can never disagree about what a valid entry is.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { EntryCollection, readEntriesDocument } from '../../web/js/core/collection.js';
import { assertValidEntry, normalizeEntry, timestamp } from '../../web/js/core/entry.js';
import { ConflictError, ValidationError } from '../../web/js/core/errors.js';
import { revisionOf } from '../../web/js/data/source.js';
import { commitFile } from './git.js';

/**
 * @typedef {object} StoreOptions
 * @property {string} file Absolute path of the entries JSON file.
 * @property {{enabled: boolean, push?: boolean, cwd?: string, prefix?: string}} [git]
 * @property {(level: string, message: string, fields?: Record<string, unknown>) => void} [log]
 */

/**
 * What a mutator returns: the next collection (when something changed), the
 * value handed back to the caller, and an optional commit message.
 *
 * @template T
 * @typedef {{collection?: EntryCollection, value: T, message?: string}} MutationOutcome
 */

export class EntryStore {
  /**
   * @param {StoreOptions} options
   */
  constructor(options) {
    this.file = options.file;
    this.git = options.git ?? { enabled: false };
    this.log = options.log ?? (() => {});
    /** Serializes read-modify-write cycles. */
    this.queue = Promise.resolve();
  }

  /**
   * Ensure the data file exists, creating an empty bundle when missing.
   *
   * @returns {Promise<void>}
   */
  async ensureFile() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      await fs.access(this.file);
    } catch {
      const empty = { version: 1, updatedAt: timestamp(), entries: [] };
      await fs.writeFile(this.file, `${JSON.stringify(empty, null, 2)}\n`, 'utf8');
      this.log('info', '已创建空词条文件', { file: this.file });
    }
  }

  /**
   * @returns {Promise<string>} Raw file content.
   */
  async readText() {
    return fs.readFile(this.file, 'utf8');
  }

  /**
   * @returns {Promise<{collection: EntryCollection, revision: string, issues: Array<{index: number, message: string}>}>}
   * @throws {ValidationError} When the file itself is malformed.
   */
  async read() {
    const text = await this.readText();
    /** @type {unknown} */
    let document;
    try {
      document = JSON.parse(text);
    } catch (error) {
      throw new ValidationError(`${this.file} 不是合法 JSON：${/** @type {Error} */ (error).message}`);
    }
    const { collection, issues } = EntryCollection.fromDocument(document, { source: this.file });
    return { collection, revision: revisionOf(document), issues };
  }

  /**
   * The API representation of the current state.
   *
   * @returns {Promise<{version: number, updatedAt: string, revision: string, entries: import('../../web/js/core/entry.js').Entry[]}>}
   */
  async snapshot() {
    const { collection, revision } = await this.read();
    return { ...collection.toDocument(), revision };
  }

  /**
   * Serialize a mutation: read, apply, write, (optionally) commit.
   *
   * @template T
   * @param {(context: {collection: EntryCollection, revision: string}) => Promise<MutationOutcome<T>> | MutationOutcome<T>} mutator
   * @param {{ifMatch?: string, message?: string}} [options]
   * @returns {Promise<T>}
   */
  mutate(mutator, options = {}) {
    const task = async () => {
      const { collection, revision } = await this.read();
      if (options.ifMatch && options.ifMatch !== '' && options.ifMatch !== revision) {
        throw new ConflictError('数据已被其他设备修改，请刷新后重试。', {
          expected: options.ifMatch,
          actual: revision,
        });
      }
      const outcome = await mutator({ collection, revision });
      if (outcome && outcome.collection) {
        await this.write(outcome.collection, outcome.message ?? options.message);
      }
      return outcome.value;
    };
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Atomically replace the data file and, when enabled, commit the change.
   *
   * @param {EntryCollection} collection
   * @param {string} [message]
   * @returns {Promise<string>} The new revision.
   */
  async write(collection, message) {
    const document = collection.toDocument({ updatedAt: timestamp() });
    const text = `${JSON.stringify(document, null, 2)}\n`;
    const temporary = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(temporary, text, 'utf8');
    try {
      const existing = await fs.readFile(this.file, 'utf8').catch(() => '');
      if (existing !== '') {
        await fs.writeFile(`${this.file}.bak`, existing, 'utf8').catch(() => {});
      }
      await fs.rename(temporary, this.file);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    if (this.git.enabled) {
      const result = await commitFile({
        cwd: this.git.cwd ?? path.dirname(this.file),
        file: path.relative(this.git.cwd ?? path.dirname(this.file), this.file) || this.file,
        message: message ?? `${this.git.prefix ?? 'content(entries)'}: update entries`,
        push: this.git.push === true,
      });
      this.log(result.committed ? 'info' : 'warn', 'git 提交结果', { detail: result.detail });
    }
    return revisionOf(document);
  }

  // ------------------------------------------------------------- operations --

  /**
   * @param {unknown} raw
   * @param {{ifMatch?: string}} [options]
   * @returns {Promise<object>} The new snapshot plus the created entry.
   */
  async createEntry(raw, options = {}) {
    const prefix = this.git.prefix ?? 'content(entries)';
    const created = await this.mutate(
      ({ collection }) => {
        const candidate = normalizeEntry(raw);
        const entry = assertValidEntry(
          {
            ...candidate,
            createdAt: candidate.createdAt || timestamp(),
            updatedAt: timestamp(),
          },
          { siblings: collection.entries },
        );
        const next = collection.withEntry(entry);
        return {
          collection: next,
          value: next.byId(entry.id),
          message: `${prefix}: add "${entry.name}"`,
        };
      },
      { ifMatch: options.ifMatch },
    );
    return { ...(await this.snapshot()), created };
  }

  /**
   * @param {string} id
   * @param {unknown} raw
   * @param {{ifMatch?: string}} [options]
   * @returns {Promise<object>} The new snapshot plus the updated entry (null when absent).
   */
  async updateEntry(id, raw, options = {}) {
    const prefix = this.git.prefix ?? 'content(entries)';
    const updated = await this.mutate(
      ({ collection }) => {
        const existing = collection.byId(id);
        if (!existing) {
          return { value: null };
        }
        const entry = assertValidEntry(
          { ...normalizeEntry(raw), id: existing.id, createdAt: existing.createdAt },
          { siblings: collection.entries.filter((item) => item.id !== id) },
        );
        const next = collection.withEntry({ ...entry, updatedAt: timestamp() });
        return {
          collection: next,
          value: next.byId(id),
          message: `${prefix}: update "${entry.name}"`,
        };
      },
      { ifMatch: options.ifMatch },
    );
    return { ...(await this.snapshot()), updated };
  }

  /**
   * @param {string} id
   * @param {{ifMatch?: string}} [options]
   * @returns {Promise<object>} The new snapshot plus the removed entry (null when absent).
   */
  async deleteEntry(id, options = {}) {
    const prefix = this.git.prefix ?? 'content(entries)';
    const removed = await this.mutate(
      ({ collection }) => {
        const existing = collection.byId(id);
        if (!existing) {
          return { value: null };
        }
        return {
          collection: collection.withoutEntry(id),
          value: { id, name: existing.name },
          message: `${prefix}: remove "${existing.name}"`,
        };
      },
      { ifMatch: options.ifMatch },
    );
    return { ...(await this.snapshot()), removed };
  }

  /**
   * Replace the whole document (bulk import / restore).
   *
   * @param {unknown} raw
   * @param {{ifMatch?: string}} [options]
   * @returns {Promise<object>} The new snapshot.
   */
  async replaceDocument(raw, options = {}) {
    const prefix = this.git.prefix ?? 'content(entries)';
    await this.mutate(
      () => {
        const { entries, version } = readEntriesDocument(raw, { strict: true, source: '导入数据' });
        const collection = new EntryCollection(entries, { version });
        return {
          collection,
          value: entries.length,
          message: `${prefix}: import ${entries.length} entries`,
        };
      },
      { ifMatch: options.ifMatch },
    );
    return this.snapshot();
  }

  /**
   * Health information for /api/health.
   *
   * @returns {Promise<{entries: number, revision: string, updatedAt: string, issues: number}>}
   */
  async stats() {
    const { collection, revision, issues } = await this.read();
    return {
      entries: collection.size,
      revision,
      updatedAt: collection.updatedAt,
      issues: issues.length,
    };
  }
}
/**
 * The contract every data source implements, plus small shared helpers.
 *
 * A source is the *only* thing in the app that knows where entries live:
 * a JSON file next to the page, a self-hosted REST API, the GitHub Contents
 * API, or this browser's localStorage. The UI and the repository layer never
 * branch on the kind of source they are talking to.
 *
 * @typedef {import('../core/entry.js').Entry} Entry
 * @typedef {import('../core/collection.js').EntryCollection} EntryCollection
 *
 * @typedef {object} SourceSnapshot
 * @property {EntryCollection} collection Entries plus document metadata.
 * @property {string} revision Opaque version token; sent back with writes.
 * @property {string} fetchedAt ISO timestamp of the read.
 * @property {Array<{index: number, message: string}>} issues Entries skipped while parsing.
 * @property {string} origin Human readable origin of the data (URL or 'localStorage').
 *
 * @typedef {object} DataSource
 * @property {string} id 'json' | 'rest' | 'github' | 'local'
 * @property {string} label Name shown in the UI.
 * @property {boolean} writable Whether create/update/delete are available.
 * @property {string} description One line shown in the settings dialog.
 * @property {(options?: {refresh?: boolean}) => Promise<SourceSnapshot>} load
 * @property {(entry: Entry) => Promise<SourceSnapshot>} createEntry
 * @property {(entry: Entry) => Promise<SourceSnapshot>} updateEntry
 * @property {(id: string) => Promise<SourceSnapshot>} deleteEntry
 * @property {() => void} [dispose]
 */

import { EntryCollection } from '../core/collection.js';
import { DataSourceError } from '../core/errors.js';
import { shortHash } from '../core/entry.js';

/**
 * @param {EntryCollection} collection
 * @param {{revision?: string, fetchedAt?: string, issues?: Array<{index: number, message: string}>, origin?: string}} [meta]
 * @returns {SourceSnapshot}
 */
export function createSnapshot(collection, meta = {}) {
  return {
    collection,
    revision: meta.revision ?? '',
    fetchedAt: meta.fetchedAt ?? new Date().toISOString(),
    issues: meta.issues ?? [],
    origin: meta.origin ?? '',
  };
}

/**
 * Build a snapshot from a parsed JSON bundle.
 *
 * @param {unknown} raw
 * @param {{revision?: string, origin?: string, source?: string, fetchedAt?: string}} [meta]
 * @returns {SourceSnapshot}
 */
export function snapshotFromDocument(raw, meta = {}) {
  const { collection, issues } = EntryCollection.fromDocument(raw, { source: meta.source });
  return createSnapshot(collection, {
    revision: meta.revision ?? revisionOf(raw),
    origin: meta.origin,
    issues,
    fetchedAt: meta.fetchedAt,
  });
}

/**
 * Content hash used as the revision of file-based sources.
 *
 * @param {unknown} document
 * @returns {string}
 */
export function revisionOf(document) {
  return `c${shortHash(JSON.stringify(document ?? null))}`;
}

/**
 * Throw a consistent error when a write is attempted on a read-only source.
 *
 * @param {DataSource} source
 * @returns {void}
 * @throws {DataSourceError}
 */
export function assertWritable(source) {
  if (!source.writable) {
    throw new DataSourceError(
      `数据源“${source.label}”是只读的，无法保存修改。请在设置中切换到可写数据源（本地编辑 / 自建后端 / GitHub）。`,
      { kind: 'read-only' },
    );
  }
}

/**
 * Shape of the JSON body used by the REST API and honoured by every source.
 *
 * @param {EntryCollection} collection
 * @param {{updatedAt?: string, revision?: string}} [meta]
 * @returns {{version: number, updatedAt: string, revision?: string, entries: Entry[]}}
 */
export function documentOf(collection, meta = {}) {
  const document = collection.toDocument({ updatedAt: meta.updatedAt });
  return meta.revision === undefined ? document : { ...document, revision: meta.revision };
}
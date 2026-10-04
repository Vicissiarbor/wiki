/**
 * Writable source backed by the GitHub Contents API.
 *
 * This is the "no server at all" editing path: with a fine-grained personal
 * access token (contents: write on this one repository) the page can commit
 * straight to the repository, so every device sees the change after the Pages
 * build finishes. It needs no aliyun box and no CORS configuration.
 *
 * Trade-offs, documented in docs/editing.md:
 *   - the file must stay below ~1 MB (the API inlines content as base64);
 *   - each save is a commit, so the repository history is the audit log;
 *   - a token lives in this browser's localStorage and can be revoked in GitHub.
 */

import { DataSourceError } from '../core/errors.js';
import { requestJson } from './http.js';
import { assertWritable, snapshotFromDocument } from './source.js';

const API_VERSION = '2022-11-28';

/**
 * @param {string} text
 * @returns {string} Base64 (UTF-8 aware) for the Contents API.
 */
export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof btoa === 'function') {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

/**
 * @param {string} base64
 * @returns {string} Decoded UTF-8 text.
 */
export function decodeBase64(base64) {
  const cleaned = String(base64).replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(cleaned, 'base64').toString('utf8');
}

/**
 * @param {{owner: string, repo: string, branch?: string, path: string, token?: string,
 *   apiBase?: string, fetchImpl?: typeof fetch, timeoutMs?: number, commitPrefix?: string}} options
 * @returns {import('./source.js').DataSource}
 */
export function createGithubSource(options) {
  const owner = String(options.owner ?? '').trim();
  const repo = String(options.repo ?? '').trim();
  const branch = String(options.branch ?? 'main').trim() || 'main';
  const path = String(options.path ?? '').trim().replace(/^\/+/, '');
  const token = String(options.token ?? '').trim();
  const apiBase = String(options.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 20_000;
  const commitPrefix = options.commitPrefix ?? 'content(entries)';
  const configured = owner !== '' && repo !== '' && path !== '';
  const fileUrl = `${apiBase}/repos/${owner}/${repo}/contents/${path}`;

  /**
   * @param {{method?: string, body?: unknown, url?: string}} [request]
   * @returns {Promise<unknown>}
   */
  const call = (request = {}) =>
    requestJson(request.url ?? fileUrl, {
      method: request.method ?? 'GET',
      body: request.body,
      timeoutMs,
      fetchImpl: options.fetchImpl,
      headers: {
        ...(token === '' ? {} : { Authorization: `Bearer ${token}` }),
        'X-GitHub-Api-Version': API_VERSION,
      },
    });

  /**
   * @param {unknown} payload
   * @param {boolean} withContent
   * @returns {{sha: string, document: unknown}}
   */
  const readFile = (payload, withContent) => {
    const file = /** @type {any} */ (payload);
    const sha = typeof file?.sha === 'string' ? file.sha : '';
    if (!withContent) {
      return { sha, document: null };
    }
    if (typeof file?.content !== 'string' || file.content === '') {
      throw new DataSourceError(
        `GitHub 未返回 ${path} 的内容（文件可能超过 1 MB）。请改用自建后端或本地编辑模式。`,
        { kind: 'format' },
      );
    }
    const text = decodeBase64(file.content);
    try {
      return { sha, document: JSON.parse(text) };
    } catch (error) {
      throw new DataSourceError(`${path} 不是合法 JSON：${/** @type {Error} */ (error).message}`, {
        kind: 'format',
      });
    }
  };

  /** @type {import('./source.js').DataSource} */
  const source = {
    id: 'github',
    label: 'GitHub 仓库（可写）',
    description: configured
      ? `直接向 ${owner}/${repo}@${branch} 的 ${path} 提交修改，推送到 Pages 后所有设备可见。`
      : '尚未配置 owner / repo / path。',
    writable: configured && token !== '',

    async load(loadOptions = {}) {
      const query = `?ref=${encodeURIComponent(branch)}${loadOptions.refresh ? `&t=${Date.now()}` : ''}`;
      const payload = await call({ url: `${fileUrl}${query}` });
      const { sha, document } = readFile(payload, true);
      return snapshotFromDocument(document, { origin: `${owner}/${repo}:${path}`, revision: sha });
    },

    /**
     * @param {import('../core/entry.js').Entry} entry
     * @param {{revision?: string, collection?: import('../core/collection.js').EntryCollection}} context
     * @returns {Promise<import('./source.js').SourceSnapshot>}
     */
    async createEntry(entry, context) {
      return writeDocument(source, `${commitPrefix}: add "${entry.name}"`, entry, 'add', context);
    },

    /**
     * @param {import('../core/entry.js').Entry} entry
     * @param {{revision?: string, collection?: import('../core/collection.js').EntryCollection, action?: string}} context
     * @returns {Promise<import('./source.js').SourceSnapshot>}
     */
    async updateEntry(entry, context) {
      return writeDocument(source, `${commitPrefix}: update "${entry.name}"`, entry, 'update', context);
    },

    /**
     * @param {string} id
     * @param {{revision?: string, collection?: import('../core/collection.js').EntryCollection}} context
     * @returns {Promise<import('./source.js').SourceSnapshot>}
     */
    async deleteEntry(id, context) {
      const entry = context?.collection?.byId(id) ?? null;
      const name = entry?.name ?? id;
      return writeDocument(source, `${commitPrefix}: remove "${name}"`, { id }, 'remove', context);
    },
  };

  /**
   * Apply one mutation to the remote document and commit it.
   *
   * @param {import('./source.js').DataSource} _source
   * @param {string} message Commit message.
   * @param {import('../core/entry.js').Entry | {id: string}} payload The new entry, or the id to drop.
   * @param {'add'|'update'|'remove'} action
   * @param {{revision?: string, collection?: import('../core/collection.js').EntryCollection}} context
   * @returns {Promise<import('./source.js').SourceSnapshot>}
   */
  async function writeDocument(_source, message, payload, action, context) {
    assertWritable(source);
    const collection = context?.collection;
    if (!collection) {
      throw new DataSourceError('缺少当前词条集合，无法写回 GitHub。', { kind: 'internal' });
    }
    let next = collection;
    if (action === 'remove') {
      next = collection.withoutEntry(/** @type {{id: string}} */ (payload).id);
    } else {
      next = collection.withEntry(payload);
    }
    const document = next.toDocument({ updatedAt: new Date().toISOString() });
    const body = {
      message,
      content: encodeBase64(`${JSON.stringify(document, null, 2)}\n`),
      branch,
      ...(context?.revision ? { sha: context.revision } : {}),
    };
    const response = await call({ method: 'PUT', body });
    const sha = /** @type {any} */ (response)?.content?.sha ?? '';
    return snapshotFromDocument(document, {
      origin: `${owner}/${repo}:${path}`,
      revision: sha,
    });
  }

  return source;
}
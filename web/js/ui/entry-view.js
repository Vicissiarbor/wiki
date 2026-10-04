/**
 * A single entry page.
 *
 * Shows the name, aliases, tags, the rendered body and a little navigation so
 * the reader can walk the dictionary from one term to the next.
 */

import { renderMarkdown } from '../core/markdown.js';
import { findMatches } from '../core/search.js';
import { el, fragment, highlight } from './dom.js';

/**
 * @param {string} value ISO timestamp.
 * @returns {string} A short, readable date.
 */
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (/** @type {number} */ number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param {object} collection Entry collection, used to resolve [[wiki links]].
 * @returns {(name: string) => (string|null)}
 */
export function termLinkResolver(collection) {
  return (name) => {
    const target = collection.byName(name);
    return target ? `#/e/${encodeURIComponent(target.id)}` : null;
  };
}

/**
 * @param {object} model
 * @param {import('../core/entry.js').Entry} model.entry
 * @param {object} model.collection
 * @param {import('../core/search.js').ParsedQuery} model.parsed
 * @param {import('../core/entry.js').Entry|null} [model.previous]
 * @param {import('../core/entry.js').Entry|null} [model.next]
 * @param {string} [model.updatedLabel]
 * @returns {DocumentFragment}
 */
export function renderEntry(model) {
  const { entry, collection } = model;
  const updatedLabel = model.updatedLabel ?? '更新于';
  const ranges = findMatches(entry.name, model.parsed, { limit: 8 });

  /** @type {Array<Node|null>} */
  const body = [];

  body.push(
    el('nav.crumbs', {}, [
      el('a', { href: '#/', text: '← 索引' }),
      entry.updatedAt
        ? el('span.updated', { text: ` ${updatedLabel} ${formatDate(entry.updatedAt)}` })
        : null,
    ]),
  );

  body.push(el('h1.entry-title', {}, [highlight(entry.name, ranges)]));

  if (entry.aliases.length > 0) {
    body.push(
      el('p.meta-line', {}, [
        el('span.meta-label', { text: '别名：' }),
        ...entry.aliases.flatMap((alias, index) => [
          index > 0 ? '、' : null,
          el('a', { href: `#/?q=${encodeURIComponent(alias)}`, text: alias }),
        ]),
      ]),
    );
  }

  if (entry.tags.length > 0) {
    body.push(
      el('p.meta-line', {}, [
        el('span.meta-label', { text: '标签：' }),
        ...entry.tags.flatMap((tag, index) => [
          index > 0 ? '、' : null,
          el('a', { href: `#/?q=${encodeURIComponent(`tag:${tag}`)}`, text: tag }),
        ]),
      ]),
    );
  }

  if (entry.summary) {
    body.push(el('p.summary', { text: entry.summary }));
  }

  const content = renderMarkdown(entry.content, { resolveTermLink: termLinkResolver(collection) });
  if (content !== '') {
    body.push(el('div.prose', { html: content }));
  } else {
    body.push(el('p.empty__hint', { text: '这个词条还没有正文。' }));
  }

  const neighbours = /** @type {Array<Node|null>} */ ([]);
  if (model.previous) {
    neighbours.push(
      el('a', {
        href: `#/e/${encodeURIComponent(model.previous.id)}`,
        text: `← ${model.previous.name}`,
        title: model.previous.name,
      }),
    );
  }
  if (model.next) {
    neighbours.push(
      el('a.next', {
        href: `#/e/${encodeURIComponent(model.next.id)}`,
        text: `${model.next.name} →`,
        title: model.next.name,
      }),
    );
  }
  if (neighbours.length > 0) {
    body.push(el('nav.pager', {}, neighbours));
  }

  body.push(el('p.meta-line.meta-line--id', { text: `id: ${entry.id}` }));

  return /** @type {DocumentFragment} */ (fragment(body));
}

/**
 * The page shown when a shared link points at an entry that no longer exists.
 *
 * @param {string} entryId
 * @returns {DocumentFragment}
 */
export function renderMissingEntry(entryId) {
  return /** @type {DocumentFragment} */ (
    fragment([
      el('nav.crumbs', {}, [el('a', { href: '#/', text: '← 索引' })]),
      el('h1.entry-title', { text: '没有这个词条' }),
      el('p', { text: `地址里的 id “${entryId}” 在当前数据里找不到。可能是词条被重命名或删除了。` }),
      el('p.empty__hint', { text: '可以在索引页用搜索框按名称查找。' }),
    ])
  );
}
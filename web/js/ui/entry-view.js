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
 * @param {string} value A `YYYY-MM-DD` date or a full ISO-8601 timestamp.
 * @returns {string} The date part, shown exactly as written when it is already
 *   day-precision (parsing it through `Date` would shift it across time zones).
 */
function formatDate(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
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
 * @param {(key: string, params?: Record<string, unknown>) => string} [model.t]
 * @returns {DocumentFragment}
 */
export function renderEntry(model) {
  const { entry, collection } = model;
  const t = model.t ?? ((/** @type {string} */ key) => key);
  const updatedLabel = model.updatedLabel ?? t('footer.updated');
  const ranges = findMatches(entry.name, model.parsed, { limit: 8 });

  /** @type {Array<Node|null>} */
  const body = [];

  body.push(
    el('nav.crumbs', {}, [
      el('a', { href: '#/', text: t('entry.index') }),
      entry.updatedAt
        ? el('span.updated', {
            text: ` ${t('footer.updated', { label: updatedLabel, date: formatDate(entry.updatedAt) })}`,
          })
        : null,
    ]),
  );

  body.push(el('h1.entry-title', {}, [highlight(entry.name, ranges)]));

  // The name in the other language: the entry itself is bilingual, so show it.
  if (entry.alternateName) {
    body.push(
      el('p.entry-alt', {
        text: entry.alternateName,
        lang: /[\u4e00-\u9fff]/.test(entry.alternateName) ? 'zh-CN' : 'en',
      }),
    );
  }

  if (entry.aliases.length > 0) {
    body.push(
      el('p.meta-line', {}, [
        el('span.meta-label', { text: t('entry.aliasesLabel') }),
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
        el('span.meta-label', { text: t('entry.tagsLabel') }),
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
    body.push(el('p.empty__hint', { text: t('entry.noContent') }));
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

  body.push(el('p.meta-line.meta-line--id', { text: t('entry.id', { id: entry.id }) }));

  return /** @type {DocumentFragment} */ (fragment(body));
}

/**
 * The page shown when a shared link points at an entry that no longer exists.
 *
 * @param {string} entryId
 * @param {(key: string, params?: Record<string, unknown>) => string} [t]
 * @returns {DocumentFragment}
 */
export function renderMissingEntry(entryId, t = (/** @type {string} */ key) => key) {
  return /** @type {DocumentFragment} */ (
    fragment([
      el('nav.crumbs', {}, [el('a', { href: '#/', text: t('entry.index') })]),
      el('h1.entry-title', { text: t('entry.missingTitle') }),
      el('p', { text: t('entry.missingBody', { id: entryId }) }),
      el('p.empty__hint', { text: t('entry.missingHint') }),
    ])
  );
}
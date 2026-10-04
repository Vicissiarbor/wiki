/**
 * The index page: letter headings and one link per entry.
 *
 * Rendered as a plain list on purpose — the whole point of this site is a
 * dictionary-like index you can read and click, not a dashboard.
 */

import { el, fragment, highlight } from './dom.js';
import { findMatches } from '../core/search.js';

/**
 * @typedef {object} IndexModel
 * @property {Array<{letter: string, entries: Array<object>}>} groups
 * @property {import('../core/search.js').ParsedQuery} parsed
 * @property {number} total Total entries in the collection.
 * @property {number} matched Entries matched by the current query.
 * @property {number} rendered Entries actually put on the page.
 * @property {boolean} truncated True when a cap cut the list short.
 * @property {string} emptyTitle Message shown when there is nothing to list.
 * @property {string} emptyHint Second line of that message.
 */

/**
 * @param {IndexModel} model
 * @returns {DocumentFragment}
 */
export function renderIndex(model) {
  const searching = !model.parsed.isEmpty;

  /** @type {Array<Node|string|null>} */
  const nodes = [];

  if (model.matched > 0) {
    nodes.push(
      el('p.count', {
        text: searching
          ? `命中 ${model.matched} 条${model.rendered < model.matched ? `，显示前 ${model.rendered} 条` : ''}`
          : `共 ${model.total} 条`,
      }),
    );
  }

  for (const group of model.groups) {
    if (group.letter !== '') {
      nodes.push(el('h2.letter', { text: group.letter }));
    }
    nodes.push(
      el(
        'ul.terms',
        {},
        group.entries.map((entry) => {
          const ranges = searching ? findMatches(entry.name, model.parsed, { limit: 8 }) : [];
          return el('li', {}, [
            el('a.term', {
              href: `#/e/${encodeURIComponent(entry.id)}`,
              title: [entry.summary, entry.aliases.length > 0 ? `别名：${entry.aliases.join('、')}` : '']
                .filter(Boolean)
                .join(' · '),
              dataset: { id: entry.id },
            }, [highlight(entry.name, ranges)]),
          ]);
        }),
      ),
    );
  }

  if (model.matched === 0) {
    nodes.push(
      el('div.empty', {}, [
        el('p.empty__title', { text: model.emptyTitle }),
        el('p.empty__hint', { text: model.emptyHint }),
      ]),
    );
  }

  if (model.truncated) {
    nodes.push(
      el('p.truncated', {
        text: '结果过多，只显示了一部分。请把查询写得更具体一些（例如加上字段前缀 tag:）。',
      }),
    );
  }

  return /** @type {DocumentFragment} */ (fragment(nodes));
}
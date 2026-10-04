/**
 * The entry list: either the A-Z grouped index (no query) or ranked search
 * results. Rendering is data-driven: `update()` receives pre-computed rows.
 */

import { findMatches } from '../core/search.js';
import { el, fragment, highlight, qsa } from './dom.js';

/**
 * @typedef {object} ListRow
 * @property {'letter'|'entry'} type
 * @property {string} [letter]
 * @property {import('../core/entry.js').Entry} [entry]
 * @property {number} [score]
 * @property {string[]} [fields]
 */

/**
 * @param {{onSelect: (id: string) => void, onLoadMore: () => void}} handlers
 * @returns {{element: HTMLElement, update: (view: object) => void}}
 */
export function createEntryList(handlers) {
  const list = el('ul.entries', { role: 'listbox', 'aria-label': '词条列表', tabindex: '-1' });
  const empty = el('div.entries-empty', { hidden: true });
  const more = el('div.entries-more', { hidden: true });
  const element = el('div.entries-host', {}, [list, empty, more]);

  list.addEventListener('keydown', (/** @type {KeyboardEvent} */ event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const buttons = qsa('.entry-item__button', list);
    const index = buttons.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (index === -1) {
      return;
    }
    event.preventDefault();
    let next = index;
    if (event.key === 'ArrowDown') {
      next = Math.min(index + 1, buttons.length - 1);
    } else if (event.key === 'ArrowUp') {
      next = Math.max(index - 1, 0);
    } else if (event.key === 'Home') {
      next = 0;
    } else {
      next = buttons.length - 1;
    }
    buttons[next]?.focus();
  });

  /**
   * @param {import('../core/entry.js').Entry} entry
   * @param {{score?: number, fields?: string[]}} match
   * @param {import('../core/search.js').ParsedQuery} parsed
   * @param {boolean} active
   * @returns {HTMLElement}
   */
  const renderItem = (entry, match, parsed, active) => {
    const nameRanges = findMatches(entry.name, parsed, { limit: 8 });
    const aliasNode =
      entry.aliases.length > 0
        ? el('span.entry-item__aliases', { text: `别名：${entry.aliases.join('、')}` })
        : null;
    const summaryText = entry.summary.length > 120 ? `${entry.summary.slice(0, 120)}…` : entry.summary;
    const summaryNode = summaryText === '' ? null : el('span.entry-item__summary', { text: summaryText });
    const tagNode =
      entry.tags.length > 0
        ? el(
            'span.entry-item__tags',
            {},
            entry.tags.slice(0, 4).map((tag) => el('span.chip.chip--tiny', { text: tag })),
          )
        : null;
    const matchedInBody =
      match.fields && match.fields.some((field) => field === 'content' || field === 'summary');

    return el(
      'li.entry-item',
      {
        role: 'option',
        'aria-selected': String(active),
        class: active ? 'is-active' : '',
        dataset: { id: entry.id },
      },
      [
        el(
          'button.entry-item__button',
          {
            type: 'button',
            dataset: { id: entry.id },
            on: { click: () => handlers.onSelect(entry.id) },
          },
          [
            el('span.entry-item__head', {}, [
              el('span.entry-item__name', {}, [highlight(entry.name, nameRanges)]),
              matchedInBody ? el('span.entry-item__badge', { text: '正文命中' }) : null,
            ]),
            aliasNode,
            summaryNode,
            tagNode,
          ],
        ),
      ],
    );
  };

  /**
   * @param {object} view
   * @param {ListRow[]} view.rows
   * @param {import('../core/search.js').ParsedQuery} view.parsed
   * @param {string} view.activeId
   * @param {number} view.limit
   * @param {number} view.totalEntries
   * @param {boolean} view.showLoadMore
   * @param {string} view.emptyMessage
   */
  const update = (view) => {
    const nodes = [];
    let rendered = 0;
    for (const row of view.rows) {
      if (row.type === 'letter') {
        nodes.push(
          el('li.entries__letter', { dataset: { letter: row.letter } }, [
            el('span.entries__letter-text', { text: row.letter }),
          ]),
        );
        continue;
      }
      if (rendered >= view.limit) {
        break;
      }
      rendered += 1;
      nodes.push(
        renderItem(
          row.entry,
          { score: row.score, fields: row.fields },
          view.parsed,
          row.entry.id === view.activeId,
        ),
      );
    }

    list.replaceChildren(fragment(nodes));

    const isEmpty = view.rows.every((row) => row.type !== 'entry');
    empty.hidden = !isEmpty;
    if (isEmpty) {
      empty.replaceChildren(
        fragment([
          el('p.entries-empty__title', { text: view.emptyMessage }),
          el('p.entries-empty__hint', {
            text:
              view.totalEntries === 0
                ? '还没有任何词条。点击工具栏的“新增词条”开始，或检查数据源设置。'
                : '可以试试“包含”模式，或用 /正则/ 精确控制匹配。',
          }),
        ]),
      );
    }

    more.hidden = !view.showLoadMore;
    if (view.showLoadMore) {
      more.replaceChildren(
        fragment([
          el('button.button.button--ghost', {
            type: 'button',
            text: `显示更多（已显示 ${rendered} / ${view.rows.filter((row) => row.type === 'entry').length}）`,
            on: { click: () => handlers.onLoadMore() },
          }),
        ]),
      );
    }
  };

  return { element, update };
}
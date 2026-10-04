/**
 * The entry detail pane: the article itself plus its metadata and actions.
 */

import { renderMarkdown } from '../core/markdown.js';
import { findMatches } from '../core/search.js';
import { el, highlight, fragment } from './dom.js';

/**
 * @param {{onEdit: (entry: object) => void, onDelete: (entry: object) => void,
 *   onCopyLink: (entry: object) => void, onTagClick: (tag: string) => void,
 *   onNavigate: (id: string) => void}} handlers
 * @returns {{element: HTMLElement, update: (view: object) => void}}
 */
export function createEntryDetail(handlers) {
  const element = el('section.detail', { 'aria-label': '词条内容' });

  /**
   * @param {object} view
   * @param {import('../core/entry.js').Entry|null} view.entry
   * @param {import('../core/collection.js').EntryCollection} view.collection
   * @param {import('../core/search.js').ParsedQuery} view.parsed
   * @param {boolean} view.writable
   * @param {number} view.totalEntries
   */
  const update = (view) => {
    const { entry } = view;
    if (!entry) {
      element.replaceChildren(
        fragment([
          el('div.detail__placeholder', {}, [
            el('h2.detail__placeholder-title', { text: '选择一个词条' }),
            el('p', {
              text: `共 ${view.totalEntries} 条词条。在上方搜索框输入名称，或使用左侧首字母索引浏览。`,
            }),
            el('ul.detail__tips', {}, [
              el('li', { text: '包含匹配：直接输入文字，例如 “熵”。' }),
              el('li', { text: '精确匹配：在输入前加 = ，例如 “=熵”。' }),
              el('li', { text: '正则匹配：用 /…/ 包裹，例如 “/^熵|热力学/”。' }),
              el('li', { text: '限定字段：tag:数学、content:/定理/ 。' }),
            ]),
          ]),
        ]),
      );
      return;
    }

    const nameRanges = findMatches(entry.name, view.parsed, { limit: 8 });
    const meta = [
      entry.updatedAt ? `更新于 ${formatDate(entry.updatedAt)}` : null,
      entry.createdAt && entry.createdAt !== entry.updatedAt
        ? `创建于 ${formatDate(entry.createdAt)}`
        : null,
      `id: ${entry.id}`,
    ].filter(Boolean);

    const content = renderMarkdown(entry.content, {
      resolveTermLink: termLinkResolver(view.collection),
    });

    const header = el('header.detail__header', {}, [
      el('h1.detail__title', {}, [highlight(entry.name, nameRanges)]),
      entry.aliases.length > 0
        ? el('p.detail__aliases', {}, [
            el('span.detail__label', { text: '别名' }),
            ...entry.aliases.flatMap((alias, index) => [
              index > 0 ? el('span.detail__separator', { text: '、' }) : null,
              el('button.link-button', {
                type: 'button',
                text: alias,
                on: { click: () => handlers.onTagClick(alias) },
              }),
            ]),
          ])
        : null,
      entry.tags.length > 0
        ? el(
            'p.detail__tags',
            {},
            entry.tags.map((tag) =>
              el('button.chip', {
                type: 'button',
                text: tag,
                title: `筛选标签：${tag}`,
                on: { click: () => handlers.onTagClick(`tag:${tag}`) },
              }),
            ),
          )
        : null,
      el('div.detail__actions', {}, [
        view.writable
          ? el('button.button.primary', {
              type: 'button',
              text: '编辑',
              on: { click: () => handlers.onEdit(entry) },
            })
          : null,
        view.writable
          ? el('button.button.danger', {
              type: 'button',
              text: '删除',
              on: { click: () => handlers.onDelete(entry) },
            })
          : null,
        el('button.button', {
          type: 'button',
          text: '复制链接',
          title: '复制可直接分享的地址',
          on: { click: () => handlers.onCopyLink(entry) },
        }),
      ]),
    ]);

    const body =
      content !== ''
        ? el('div.detail__content', { html: content })
        : el('div.detail__content', {}, [
            el('p.detail__empty', {
              text: entry.summary !== '' ? entry.summary : '该词条还没有正文，点击“编辑”补充内容。',
            }),
          ]);

    element.replaceChildren(
      fragment([
        header,
        body,
        el('footer.detail__meta', {}, [
          ...meta.map((text) => el('span.detail__meta-item', { text: String(text) })),
          view.parsed.term !== ''
            ? el('button.link-button.detail__search-link', {
                type: 'button',
                text: '用该名称继续搜索',
                on: { click: () => handlers.onTagClick(`=${entry.name}`) },
              })
            : null,
        ]),
      ]),
    );
  };

  return { element, update };
}

/**
 * @param {string} value ISO-8601 timestamp.
 * @returns {string} Local, human readable date.
 */
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  try {
    return date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * A wiki-link helper exposed for tests: how Markdown `[[X]]` resolves.
 *
 * @param {import('../core/collection.js').EntryCollection} collection
 * @returns {(name: string) => (string|null)}
 */
export function termLinkResolver(collection) {
  return (name) => {
    const target = collection.byName(name);
    return target ? `#/?e=${encodeURIComponent(target.id)}` : null;
  };
}
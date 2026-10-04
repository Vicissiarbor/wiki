/**
 * The A-Z index bar: jump to (or filter by) the first letter of an entry name.
 */

import { INITIALS, LETTERS, OTHER_INITIAL, initialOfEntry } from '../core/initials.js';
import { el, fragment } from './dom.js';

/**
 * @param {Array<{name: string, id: string, initial?: string}>} entries
 * @returns {{counts: Map<string, number>}}
 */
export function countByInitial(entries) {
  /** @type {Map<string, number>} */
  const counts = new Map(INITIALS.map((letter) => [letter, 0]));
  for (const entry of entries) {
    const letter = initialOfEntry(entry);
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return { counts };
}

/**
 * @param {{onSelect: (letter: string) => void}} handlers
 * @returns {{element: HTMLElement, update: (entries: Array<object>, activeLetter: string) => void}}
 */
export function createInitialsNav(handlers) {
  const buttons = new Map();
  /** @type {HTMLElement[]} */
  const nodes = [];

  const allButton = el('button.initials__letter.initials__letter--all', {
    type: 'button',
    text: '全部',
    title: '显示全部词条',
    on: { click: () => handlers.onSelect('') },
  });
  nodes.push(allButton);
  buttons.set('', allButton);

  for (const letter of INITIALS) {
    const button = el('button.initials__letter', {
      type: 'button',
      text: letter,
      dataset: { letter },
      title: `以 ${letter} 开头的词条`,
      on: { click: () => handlers.onSelect(letter) },
    });
    nodes.push(button);
    buttons.set(letter, button);
  }

  const element = el('nav.initials', { 'aria-label': '按首字母筛选' }, [
    el('div.initials__letters', {}, fragment(nodes)),
  ]);

  /**
   * @param {Array<object>} entries
   * @param {string} activeLetter
   */
  const update = (entries, activeLetter) => {
    const { counts } = countByInitial(entries);
    const hasOther = (counts.get(OTHER_INITIAL) ?? 0) > 0;
    for (const [letter, button] of buttons) {
      if (letter === '') {
        button.classList.toggle('is-active', activeLetter === '');
        button.disabled = entries.length === 0;
        button.title = `显示全部词条（${entries.length}）`;
        continue;
      }
      const count = counts.get(letter) ?? 0;
      button.disabled = count === 0;
      button.classList.toggle('is-active', activeLetter === letter);
      button.setAttribute('aria-pressed', String(activeLetter === letter));
      button.title = `${letter} 开头：${count} 条`;
      if (letter === OTHER_INITIAL) {
        button.hidden = !hasOther;
      }
    }
    // Keep the bar honest about which letters exist even when empty buckets hide.
    element.dataset.letters = LETTERS.filter((letter) => (counts.get(letter) ?? 0) > 0).join('');
  };

  return { element, update };
}
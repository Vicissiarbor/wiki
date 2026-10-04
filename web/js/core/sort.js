/**
 * Ordering of entries: by initial bucket, then by name using the platform
 * collator (pinyin order for Chinese), then by id for a stable total order.
 */

import { initialOfEntry, initialRank } from './initials.js';

/**
 * Build a name collator. Chinese locales sort by pinyin; `numeric` keeps
 * "第2章" before "第10章".
 *
 * @param {string[]} [locales]
 * @returns {{compare: (a: string, b: string) => number}}
 */
export function createNameCollator(locales = ['zh-Hans-CN', 'zh', 'en']) {
  if (typeof Intl !== 'undefined' && typeof Intl.Collator === 'function') {
    try {
      return new Intl.Collator(locales, { numeric: true, sensitivity: 'variant' });
    } catch {
      /* fall through to the default locale */
    }
    try {
      return new Intl.Collator(undefined, { numeric: true });
    } catch {
      /* fall through to the code-point comparator */
    }
  }
  return {
    compare(a, b) {
      if (a === b) {
        return 0;
      }
      return a < b ? -1 : 1;
    },
  };
}

const defaultCollator = createNameCollator();

/**
 * @param {{name: string, id: string, initial?: string}} a
 * @param {{name: string, id: string, initial?: string}} b
 * @param {{compare: (a: string, b: string) => number}} [collator]
 * @returns {number}
 */
export function compareEntries(a, b, collator = defaultCollator) {
  const rankA = initialRank(initialOfEntry(a));
  const rankB = initialRank(initialOfEntry(b));
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  const byName = collator.compare(a.name, b.name);
  if (byName !== 0) {
    return byName;
  }
  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

/**
 * @template {{name: string, id: string, initial?: string}} T
 * @param {T[]} entries
 * @param {{compare?: (a: string, b: string) => number}} [options]
 * @returns {T[]} A new, sorted array (the input is left untouched).
 */
export function sortEntries(entries, options = {}) {
  const collator = options.compare
    ? { compare: options.compare }
    : createNameCollator();
  return [...entries].sort((a, b) => compareEntries(a, b, collator));
}

/**
 * Group entries into the A-Z (+ "#") index used by the home page.
 *
 * Empty buckets are omitted, so the navigation bar only offers letters that
 * actually have entries.
 *
 * @template {{name: string, id: string, initial?: string}} T
 * @param {T[]} entries
 * @param {{compare?: (a: string, b: string) => number}} [options]
 * @returns {Array<{letter: string, entries: T[]}>}
 */
export function groupEntriesByInitial(entries, options = {}) {
  const sorted = sortEntries(entries, options);
  /** @type {Array<{letter: string, entries: T[]}>} */
  const groups = [];
  for (const entry of sorted) {
    const letter = initialOfEntry(entry);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) {
      last.entries.push(entry);
    } else {
      groups.push({ letter, entries: [entry] });
    }
  }
  return groups;
}
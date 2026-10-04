/**
 * Initial-letter grouping: the "按首字母排序" index of the entry list.
 *
 * Latin names use their first letter, Chinese names use the first letter of
 * their pinyin reading (table generated from pypinyin, see tools/), digits and
 * anything else fall into the "#" bucket.
 */

import { INITIAL_PATTERN, cleanLine } from './entry.js';
import { pinyinInitialOfCodePoint } from './pinyin-table.js';

/** A-Z in display order. */
export const LETTERS = Object.freeze('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));

/** Bucket for names that start with a digit, punctuation or an unknown script. */
export const OTHER_INITIAL = '#';

/** Letters plus the catch-all bucket, in display order. */
export const INITIALS = Object.freeze([...LETTERS, OTHER_INITIAL]);

/** Characters that may wrap a name without changing its initial: 《存在与时间》 -> C. */
const SKIPPABLE = /[\s\p{P}\p{S}]/u;

/**
 * @param {string} name
 * @returns {string} The first code point that can carry an initial, or ''.
 */
function firstMeaningfulCodePoint(name) {
  // NFKC folds full-width Latin ("Ｇraph") onto ASCII before the scan.
  for (const character of cleanLine(name).normalize('NFKC')) {
    if (SKIPPABLE.test(character)) {
      continue;
    }
    return character;
  }
  return '';
}

/**
 * @param {string} character
 * @returns {string} The letter without diacritics ('É' -> 'E'), or ''.
 */
function stripDiacritics(character) {
  const decomposed = character.normalize('NFD');
  const base = decomposed.codePointAt(0) ?? 0;
  const letter = String.fromCodePoint(base);
  return /^[A-Za-z]$/.test(letter) ? letter.toUpperCase() : '';
}

/**
 * Derive the grouping initial from a name.
 *
 * @param {string} name
 * @returns {string} One of {@link INITIALS}.
 */
export function initialOfName(name) {
  const character = firstMeaningfulCodePoint(name);
  if (character === '') {
    return OTHER_INITIAL;
  }
  if (/^[0-9]$/.test(character)) {
    return OTHER_INITIAL;
  }
  const latin = stripDiacritics(character);
  if (latin !== '') {
    return latin;
  }
  const pinyin = pinyinInitialOfCodePoint(character.codePointAt(0) ?? 0);
  return pinyin === '' ? OTHER_INITIAL : pinyin;
}

/**
 * Derive the grouping initial of an entry, honouring an explicit override.
 *
 * @param {{name?: string, initial?: string}} entry
 * @returns {string} One of {@link INITIALS}.
 */
export function initialOfEntry(entry) {
  const override = cleanLine(entry?.initial ?? '').toUpperCase();
  if (override !== '' && INITIAL_PATTERN.test(override)) {
    return override;
  }
  return initialOfName(String(entry?.name ?? ''));
}

/**
 * @param {string} letter
 * @returns {boolean} True when `letter` is a valid bucket.
 */
export function isInitial(letter) {
  return INITIALS.includes(letter);
}

/**
 * @param {string} letter
 * @returns {number} Position of the bucket in display order ('#' sorts last).
 */
export function initialRank(letter) {
  const index = INITIALS.indexOf(letter);
  return index === -1 ? INITIALS.length : index;
}
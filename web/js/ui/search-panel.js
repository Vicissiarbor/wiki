/**
 * The search box: input, mode selector, clear button and the hint line that
 * explains how the current query is interpreted.
 */

import { SearchMode, MAX_QUERY_LENGTH } from '../core/search.js';
import { el, setHidden } from './dom.js';

/** @type {Array<{value: import('../core/search.js').SearchMode, label: string, title: string}>} */
const MODES = [
  { value: SearchMode.CONTAINS, label: '包含', title: '默认：名称、别名、标签、简介、正文中包含该文字' },
  { value: SearchMode.EXACT, label: '精确', title: '名称或别名与输入完全一致（等价于 =输入）' },
  { value: SearchMode.REGEX, label: '正则', title: '按正则表达式匹配（等价于 /表达式/ 写法）' },
];

/**
 * @param {{onInput: (value: string) => void, onModeChange: (mode: import('../core/search.js').SearchMode) => void,
 *   onSubmit?: () => void}} handlers
 * @returns {{element: HTMLElement, input: HTMLInputElement, setValue: (value: string) => void,
 *   setMode: (mode: import('../core/search.js').SearchMode) => void,
 *   setHint: (text: string, tone?: string) => void, focus: () => void}}
 */
export function createSearchPanel(handlers) {
  const input = /** @type {HTMLInputElement} */ (
    el('input.search__input', {
      id: 'search-input',
      type: 'search',
      name: 'q',
      placeholder: '输入概念名称…（=精确 / /正则/ / tag:标签）',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      maxlength: String(MAX_QUERY_LENGTH + 40),
      'aria-describedby': 'search-hint',
      on: {
        input: () => {
          clearButton.hidden = input.value === '';
          handlers.onInput(input.value);
        },
        keydown: (/** @type {KeyboardEvent} */ event) => {
          if (event.key === 'Escape' && input.value !== '') {
            event.stopPropagation();
            api.setValue('');
            handlers.onInput('');
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            handlers.onSubmit?.();
          }
        },
      },
    })
  );

  const clearButton = el('button.search__clear', {
    type: 'button',
    text: '×',
    hidden: true,
    'aria-label': '清空搜索',
    title: '清空 (Esc)',
    on: {
      click: () => {
        api.setValue('');
        handlers.onInput('');
        input.focus();
      },
    },
  });

  const modeSelect = /** @type {HTMLSelectElement} */ (
    el(
      'select.search__mode',
      {
        'aria-label': '匹配方式',
        on: { change: () => handlers.onModeChange(/** @type {any} */ (modeSelect.value)) },
      },
      MODES.map((mode) => el('option', { value: mode.value, title: mode.title, text: mode.label })),
    )
  );

  const hint = el('p.search__hint', { id: 'search-hint', 'aria-live': 'polite' });

  const form = el(
    'form.search',
    {
      role: 'search',
      on: {
        submit: (/** @type {Event} */ event) => {
          event.preventDefault();
          handlers.onSubmit?.();
        },
      },
    },
    [
      el('div.search__field', {}, [
        el('span.search__icon', { 'aria-hidden': 'true', text: '🔍' }),
        input,
        clearButton,
        modeSelect,
      ]),
      hint,
    ],
  );

  const api = {
    element: form,
    input,
    setValue(value) {
      input.value = value;
      clearButton.hidden = value === '';
    },
    setMode(mode) {
      modeSelect.value = mode;
    },
    /**
     * @param {string} text
     * @param {'info'|'error'|'warning'} [tone]
     */
    setHint(text, tone = 'info') {
      hint.textContent = text;
      hint.className = `search__hint search__hint--${tone}`;
    },
    focus() {
      input.focus();
      input.select();
    },
  };

  setHidden(hint, false);
  return api;
}
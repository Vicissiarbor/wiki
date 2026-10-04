/**
 * The search box: one input, one button, one hint line.
 *
 * Matching mode is chosen by syntax inside the query (see docs/search-syntax.md):
 *   `=名称`  精确匹配
 *   `/正则/` 正则匹配
 *   其它     包含匹配（默认，同时搜索正文）
 * There is deliberately no dropdown: a dictionary needs a box, not a control panel.
 */

import { MAX_QUERY_LENGTH } from '../core/search.js';
import { el } from './dom.js';

/**
 * @param {{onInput: (value: string) => void, onSubmit: () => void, onClear: () => void}} handlers
 * @returns {{element: HTMLElement, input: HTMLInputElement, setValue: (value: string) => void,
 *   setHint: (text: string, tone?: string) => void, focus: () => void}}
 */
export function createSearchBox(handlers) {
  const input = /** @type {HTMLInputElement} */ (
    el('input#q.search__input', {
      type: 'search',
      name: 'q',
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
            handlers.onClear();
          }
        },
      },
    })
  );

  const clearButton = el('button.search__clear', {
    type: 'button',
    text: '清空',
    hidden: true,
    on: {
      click: () => {
        api.setValue('');
        handlers.onClear();
        input.focus();
      },
    },
  });

  const hint = el('p.search__hint', { id: 'search-hint', 'aria-live': 'polite' });

  const form = el(
    'form.search',
    {
      role: 'search',
      on: {
        submit: (/** @type {Event} */ event) => {
          event.preventDefault();
          handlers.onSubmit();
        },
      },
    },
    [
      el('label.search__label', { for: 'q', text: '查询' }),
      input,
      el('button.search__submit', { type: 'submit', text: '查找' }),
      clearButton,
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
    /**
     * @param {string} text
     * @param {'info'|'warning'} [tone]
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

  return api;
}
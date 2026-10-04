/**
 * One line of feedback under the search box: loading, counts, warnings, errors.
 * Replaces the toast/modal machinery of the previous design — a dictionary does
 * not need pop-ups.
 */

import { el } from './dom.js';

/**
 * @returns {{element: HTMLElement, update: (model: {message: string, tone?: string}) => void,
 *   clear: () => void}}
 */
export function createStatus() {
  const element = el('p.status', { role: 'status', 'aria-live': 'polite', hidden: true });

  return {
    element,
    /**
     * @param {{message: string, tone?: 'info'|'warning'|'error'}} model
     */
    update(model) {
      element.textContent = model.message;
      element.hidden = model.message === '';
      element.className = `status status--${model.tone ?? 'info'}`;
    },
    clear() {
      element.textContent = '';
      element.hidden = true;
    },
  };
}
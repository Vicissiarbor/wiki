/**
 * A small modal dialog used by the entry editor, the settings panel and the
 * confirm prompt.
 *
 * A custom implementation instead of <dialog> so that behaviour (focus trap,
 * Escape, backdrop click) is identical in every browser and testable in jsdom.
 */

import { append, clear, el, qs } from './dom.js';

/** Currently open modal (only one at a time keeps focus handling simple). */
/** @type {ReturnType<typeof createModal>|null} */
let current = null;

/**
 * @param {{title: string, description?: string, size?: 'md'|'lg', onClose?: () => void,
 *   labelledBy?: string}} options
 * @returns {{
 *   element: HTMLElement,
 *   body: HTMLElement,
 *   footer: HTMLElement,
 *   setTitle: (title: string) => void,
 *   setStatus: (text: string, tone?: string) => void,
 *   open: () => void,
 *   close: () => void,
 *   isOpen: () => boolean,
 * }}
 */
export function createModal(options) {
  /** @type {HTMLElement|null} */
  let previouslyFocused = null;

  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  const title = el('h2.modal__title', { id: titleId, text: options.title });
  const description = options.description
    ? el('p.modal__description', { text: options.description })
    : null;
  const status = el('p.modal__status', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const body = el('div.modal__body');
  const footer = el('div.modal__footer');

  const closeButton = el('button.modal__close', {
    type: 'button',
    'aria-label': '关闭',
    title: '关闭 (Esc)',
    text: '×',
    on: { click: () => api.close() },
  });

  const panel = el(
    `div.modal.modal--${options.size ?? 'md'}`,
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1',
    },
    [
      el('header.modal__header', {}, [el('div', {}, [title, description]), closeButton]),
      status,
      body,
      footer,
    ],
  );

  const overlay = el('div.overlay', {}, [panel]);

  const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      api.close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = /** @type {HTMLElement[]} */ ([
      ...panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ]).filter((node) => node.offsetParent !== null || node === panel);
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = /** @type {HTMLElement} */ (document.activeElement);
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) {
      api.close();
    }
  });
  overlay.addEventListener('keydown', /** @type {EventListener} */ (onKeyDown));

  const api = {
    element: overlay,
    body,
    footer,
    setTitle(next) {
      title.textContent = next;
    },
    /**
     * @param {string} text
     * @param {'info'|'error'|'success'} [tone]
     */
    setStatus(text, tone = 'info') {
      status.textContent = text;
      status.hidden = text === '';
      status.className = `modal__status modal__status--${tone}`;
    },
    open() {
      if (current && current !== api) {
        current.close();
      }
      current = api;
      previouslyFocused = /** @type {HTMLElement|null} */ (document.activeElement);
      document.body.appendChild(overlay);
      document.body.classList.add('has-modal');
      const firstField = qs(
        'input:not([type=hidden]), textarea, select, button.primary',
        panel,
      );
      (firstField ?? panel).focus();
    },
    close() {
      if (current === api) {
        current = null;
      }
      overlay.remove();
      document.body.classList.remove('has-modal');
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
      options.onClose?.();
    },
    isOpen() {
      return overlay.isConnected;
    },
  };

  /** Replace the body content. */
  api.setBody = (children) => {
    clear(body);
    append(body, children);
  };

  return api;
}

/**
 * Ask for confirmation with a modal instead of window.confirm.
 *
 * @param {{title: string, message: string, confirmLabel?: string, danger?: boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = createModal({
      title: options.title,
      size: 'md',
      onClose: () => {
        if (!answered) {
          answered = true;
          resolve(false);
        }
      },
    });
    append(modal.body, [el('p', { text: options.message })]);
    append(modal.footer, [
      el('button.button', {
        type: 'button',
        text: '取消',
        on: {
          click: () => {
            answered = true;
            modal.close();
            resolve(false);
          },
        },
      }),
      el(`button.button.${options.danger ? 'danger' : 'primary'}`, {
        type: 'button',
        text: options.confirmLabel ?? '确定',
        on: {
          click: () => {
            answered = true;
            modal.close();
            resolve(true);
          },
        },
      }),
    ]);
    modal.open();
  });
}
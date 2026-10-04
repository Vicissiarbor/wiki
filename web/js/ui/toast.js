/**
 * Transient status messages (saved, copied, failed...).
 */

import { el, qs } from './dom.js';

/** @type {HTMLElement|null} */
let host = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let timer = null;

/**
 * @returns {HTMLElement} The toast container, created on first use.
 */
function container() {
  if (host !== null && (!host.isConnected || host.ownerDocument !== document)) {
    host = null; // The document was replaced (tests) or the node was removed.
  }
  if (host === null) {
    host = qs('#toasts') ?? el('div#toasts.toasts', { role: 'status', 'aria-live': 'polite' });
    if (!host.isConnected) {
      document.body.appendChild(host);
    }
  }
  return host;
}

/**
 * Show a message.
 *
 * @param {string} message
 * @param {{tone?: 'info'|'success'|'error'|'warning', durationMs?: number}} [options]
 * @returns {void}
 */
export function toast(message, options = {}) {
  const tone = options.tone ?? 'info';
  const node = el(`div.toast.toast--${tone}`, { text: message });
  const root = container();
  root.appendChild(node);
  if (timer !== null) {
    clearTimeout(timer);
  }
  const duration = options.durationMs ?? (tone === 'error' ? 6500 : 3200);
  timer = setTimeout(() => {
    node.classList.add('toast--leaving');
    setTimeout(() => node.remove(), 200);
  }, duration);
}

/**
 * @param {string} message
 * @returns {void}
 */
export function toastError(message) {
  toast(message, { tone: 'error' });
}

/**
 * @param {string} message
 * @returns {void}
 */
export function toastSuccess(message) {
  toast(message, { tone: 'success' });
}

/**
 * Copy text to the clipboard, with a fallback for non-secure contexts.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const textarea = /** @type {HTMLTextAreaElement} */ (
      el('textarea', { style: { position: 'fixed', opacity: '0' } })
    );
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
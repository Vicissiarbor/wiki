/**
 * Small timing helpers (DOM-free, unit tested).
 */

/**
 * Trailing-edge debounce with an optional maximum wait, so a long typing burst
 * still refreshes the list once in a while.
 *
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} waitMs
 * @param {{maxWaitMs?: number}} [options]
 * @returns {F & {cancel: () => void, flush: () => void, pending: () => boolean}}
 */
export function debounce(fn, waitMs, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  let firstCallAt = 0;
  /** @type {any[]} */
  let lastArgs = [];

  const invoke = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    firstCallAt = 0;
    const args = lastArgs;
    lastArgs = [];
    fn(...args);
  };

  const debounced = /** @type {any} */ (
    (...args) => {
      lastArgs = args;
      const nowMs = Date.now();
      if (firstCallAt === 0) {
        firstCallAt = nowMs;
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
      const elapsed = nowMs - firstCallAt;
      if (maxWaitMs > 0 && elapsed >= maxWaitMs) {
        invoke();
        return;
      }
      const delay = maxWaitMs > 0 ? Math.min(waitMs, maxWaitMs - elapsed) : waitMs;
      timer = setTimeout(invoke, delay);
    }
  );

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    firstCallAt = 0;
    lastArgs = [];
  };
  debounced.flush = () => {
    if (timer !== null || lastArgs.length > 0) {
      invoke();
    }
  };
  debounced.pending = () => timer !== null;

  return debounced;
}

/**
 * @param {number} ms
 * @returns {Promise<void>} Resolves after `ms` milliseconds.
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
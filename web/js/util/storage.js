/**
 * Namespaced JSON storage on top of localStorage.
 *
 * Every access is guarded: private browsing modes, disabled storage and full
 * quotas all degrade to an in-memory map instead of breaking the page.
 */

/**
 * @returns {Storage|null} localStorage when it is actually usable.
 */
function detectBackend() {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const probe = '__ladr_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {string} [namespace] Prefix for every key (keeps the site's data apart).
 * @param {{backend?: Storage|null, memoryOnly?: boolean}} [options]
 * @returns {{
 *   available: boolean,
 *   get: <T>(key: string, fallback: T) => T,
 *   set: (key: string, value: unknown) => boolean,
 *   remove: (key: string) => void,
 *   clear: () => void,
 *   keys: () => string[],
 * }}
 */
export function createStorage(namespace = 'ladr', options = {}) {
  const backend = options.memoryOnly ? null : options.backend ?? detectBackend();
  /** @type {Map<string, string>} */
  const memory = new Map();
  const prefix = `${namespace}.`;

  /**
   * @param {string} key
   * @returns {string|null} The stored raw value, from memory first (a failed
   *   backend write falls back to the in-memory map).
   */
  const readRaw = (key) => {
    const fromMemory = memory.get(key);
    if (fromMemory !== undefined) {
      return fromMemory;
    }
    if (backend === null) {
      return null;
    }
    try {
      return backend.getItem(key);
    } catch {
      return null;
    }
  };

  return {
    available: backend !== null,
    get(key, fallback) {
      const raw = readRaw(prefix + key);
      if (raw === null) {
        return fallback;
      }
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      if (backend === null) {
        memory.set(prefix + key, raw);
        return true;
      }
      try {
        backend.setItem(prefix + key, raw);
        return true;
      } catch {
        memory.set(prefix + key, raw);
        return false;
      }
    },
    remove(key) {
      memory.delete(prefix + key);
      if (backend !== null) {
        try {
          backend.removeItem(prefix + key);
        } catch {
          /* ignore */
        }
      }
    },
    clear() {
      memory.clear();
      if (backend === null) {
        return;
      }
      try {
        for (const key of Object.keys(backend)) {
          if (key.startsWith(prefix)) {
            backend.removeItem(key);
          }
        }
      } catch {
        /* ignore */
      }
    },
    keys() {
      if (backend === null) {
        return [...memory.keys()].filter((key) => key.startsWith(prefix));
      }
      try {
        return Object.keys(backend).filter((key) => key.startsWith(prefix));
      } catch {
        return [];
      }
    },
  };
}
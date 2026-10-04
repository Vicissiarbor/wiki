/**
 * KaTeX wiring.
 *
 * `core/markdown.js` only *marks* formulas (`<span class="math" data-tex="…">`
 * with the TeX also rendered as plain text). This module is the only place that
 * knows about KaTeX:
 *
 *   - assets are vendored under `./assets/katex/` and loaded **lazily**, so the
 *     index page never pays for them;
 *   - the paths are relative, so the site works from any sub-path;
 *   - if KaTeX cannot be loaded (offline, blocked, old browser), the raw TeX
 *     stays on screen instead of an empty hole.
 */

/** Where the vendored KaTeX files live, relative to the page. */
export const KATEX_BASE = './assets/katex/';

/** How long to wait for the script before giving up on rendering. */
export const KATEX_TIMEOUT_MS = 10_000;

/** @type {Promise<object|null>|null} */
let pending = null;

/**
 * @returns {object|null} The KaTeX API when it is already available.
 */
export function currentKatex() {
  const global = /** @type {any} */ (globalThis);
  const candidate = global.katex;
  if (candidate && typeof candidate.render === 'function') {
    return candidate;
  }
  if (candidate && typeof candidate.default?.render === 'function') {
    // Some KaTeX builds wrap the API in a `default` export.
    return candidate.default;
  }
  return null;
}

/**
 * Inject one asset tag, resolving when it has loaded.
 *
 * @param {'script'|'link'} tagName
 * @param {Record<string, string>} attributes
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function injectAsset(tagName, attributes, timeoutMs) {
  return new Promise((resolve) => {
    const existing = document.querySelector(`${tagName}[data-ladr-katex]`);
    if (existing && existing.dataset.loaded === 'true') {
      resolve(true);
      return;
    }
    const element = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    element.setAttribute('data-ladr-katex', '');
    const done = (/** @type {boolean} */ ok) => {
      element.dataset.loaded = ok ? 'true' : 'false';
      resolve(ok);
    };
    element.addEventListener('load', () => done(true));
    element.addEventListener('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
    document.head.appendChild(element);
  });
}

/**
 * Load KaTeX once per page.
 *
 * @param {{timeoutMs?: number, load?: () => Promise<object|null>}} [options]
 * @returns {Promise<object|null>} The KaTeX API, or null when unavailable.
 */
export function loadKatex(options = {}) {
  if (typeof options.load === 'function') {
    return options.load();
  }
  const available = currentKatex();
  if (available) {
    return Promise.resolve(available);
  }
  if (pending) {
    return pending;
  }
  const timeoutMs = options.timeoutMs ?? KATEX_TIMEOUT_MS;
  pending = (async () => {
    const css = await injectAsset(
      'link',
      { rel: 'stylesheet', href: `${KATEX_BASE}katex.min.css` },
      timeoutMs,
    );
    const js = await injectAsset('script', { src: `${KATEX_BASE}katex.min.js` }, timeoutMs);
    if (!js) {
      return null;
    }
    return currentKatex();
  })().then((api) => {
    if (!api) {
      pending = null; // Allow a later retry (for example after going online).
    }
    return api;
  });
  return pending;
}

/**
 * @typedef {object} MathRenderResult
 * @property {number} found Formulas found in the subtree.
 * @property {number} rendered Formulas successfully rendered.
 * @property {boolean} unavailable True when KaTeX could not be loaded.
 */

/**
 * Render every formula inside `root`.
 *
 * @param {ParentNode} root
 * @param {{timeoutMs?: number, load?: () => Promise<object|null>}} [options]
 * @returns {Promise<MathRenderResult>}
 */
export async function renderMath(root, options = {}) {
  const nodes = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-tex]')]);
  if (nodes.length === 0) {
    return { found: 0, rendered: 0, unavailable: false };
  }

  /** @type {object|null} */
  let katex = null;
  try {
    katex = await loadKatex(options);
  } catch (error) {
    console.warn('[SearchLADR] KaTeX 加载失败，保留公式原文', error);
  }
  if (!katex) {
    return { found: nodes.length, rendered: 0, unavailable: true };
  }

  let rendered = 0;
  for (const node of nodes) {
    const tex = node.dataset.tex ?? node.textContent ?? '';
    const displayMode = node.dataset.display === 'display';
    try {
      katex.render(tex, node, {
        displayMode,
        throwOnError: false, // Render bad TeX in red instead of breaking the page.
        strict: 'ignore', // Entries are notes, not LaTeX papers.
        trust: false, // No \href / \htmlClass, i.e. no HTML injection surface.
        errorColor: '#9b2018',
        output: 'htmlAndMathml', // Keeps screen readers and copy-paste working.
      });
      node.classList.add('is-rendered');
      rendered += 1;
    } catch (error) {
      console.warn(`[SearchLADR] 公式渲染失败：${tex}`, error);
    }
  }
  return { found: nodes.length, rendered, unavailable: false };
}
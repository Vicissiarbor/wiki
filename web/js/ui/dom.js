/**
 * Minimal DOM helpers.
 *
 * Deliberately tiny: `el()` builds elements from data (no template strings in
 * application code, so no accidental HTML injection), plus a few utilities for
 * clearing and highlighting.
 */

/**
 * @param {string} tag Tag name, optionally with a class shorthand ("div.card").
 * @param {object} [props] Attributes, plus the special keys below.
 * @param {Array<Node|string|null|undefined|false>} [children]
 * @returns {HTMLElement}
 *
 * Special keys:
 *   class / className  -> class attribute
 *   text               -> textContent (always safe)
 *   html               -> innerHTML (only used with renderMarkdown output)
 *   dataset            -> data-* attributes
 *   on                 -> { eventName: handler }
 *   style              -> { property: value }
 */
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = String(tag).split('.');
  const node = document.createElement(name || 'div');
  if (classes.length > 0) {
    node.className = classes.join(' ');
  }

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    switch (key) {
      case 'class':
      case 'className':
        node.className = [node.className, value].filter(Boolean).join(' ');
        break;
      case 'text':
        node.textContent = String(value);
        break;
      case 'html':
        node.innerHTML = String(value);
        break;
      case 'dataset':
        for (const [dataKey, dataValue] of Object.entries(value)) {
          if (dataValue !== undefined && dataValue !== null && dataValue !== false) {
            node.dataset[dataKey] = String(dataValue);
          }
        }
        break;
      case 'style':
        Object.assign(node.style, value);
        break;
      case 'on':
        for (const [eventName, handler] of Object.entries(value)) {
          node.addEventListener(eventName, /** @type {EventListener} */ (handler));
        }
        break;
      default:
        node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

/**
 * @param {Node} parent
 * @param {Array<Node|string|null|undefined|false>} children
 * @returns {Node} `parent`
 */
export function append(parent, children) {
  const list = Array.isArray(children) ? children.flat(4) : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === '') {
      continue;
    }
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return parent;
}

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement|null}
 */
export function qs(selector, root = document) {
  return /** @type {HTMLElement|null} */ (root.querySelector(selector));
}

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export function qsa(selector, root = document) {
  return /** @type {HTMLElement[]} */ ([...root.querySelectorAll(selector)]);
}

/**
 * @param {Node} node
 * @returns {void} Removes every child.
 */
export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/**
 * @param {Array<Node|string|null|undefined|false>} children
 * @returns {DocumentFragment}
 */
export function fragment(children) {
  return /** @type {DocumentFragment} */ (append(document.createDocumentFragment(), children));
}

/**
 * Wrap the matched regions of `value` in <mark> elements.
 *
 * @param {string} value
 * @param {Array<{start: number, end: number}>} ranges
 * @returns {DocumentFragment}
 */
export function highlight(value, ranges) {
  const text = String(value ?? '');
  if (!ranges || ranges.length === 0) {
    return fragment([text]);
  }
  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    parts.push(el('mark', { text: text.slice(range.start, range.end) }));
    cursor = range.end;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return fragment(parts);
}

/**
 * Add or remove a class.
 *
 * @param {HTMLElement|null} node
 * @param {string} className
 * @param {boolean} enabled
 * @returns {void}
 */
export function toggleClass(node, className, enabled) {
  if (!node) {
    return;
  }
  node.classList.toggle(className, enabled);
}

/**
 * @param {HTMLElement|null} node
 * @param {boolean} hidden
 * @returns {void}
 */
export function setHidden(node, hidden) {
  if (!node) {
    return;
  }
  node.hidden = hidden;
}

/**
 * Escape text for use inside an attribute selector or id.
 *
 * @param {string} value
 * @returns {string}
 */
export function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}
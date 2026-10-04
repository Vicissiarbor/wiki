/**
 * Minimal DOM helpers.
 *
 * Deliberately tiny: `el()` builds elements from data (no template strings in
 * application code, so no accidental HTML injection), plus a few utilities for
 * clearing and highlighting.
 */

/**
 * @param {string} tag Tag name, optionally with an id and classes ("input#q.search__input").
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
  const [nameAndId, ...classes] = String(tag).split('.');
  const hash = nameAndId.indexOf('#');
  const name = hash === -1 ? nameAndId : nameAndId.slice(0, hash);
  const id = hash === -1 ? '' : nameAndId.slice(hash + 1);
  const node = document.createElement(name || 'div');
  if (id !== '') {
    node.id = id;
  }
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
 * @param {Node|string|null|undefined|false|Array<Node|string|null|undefined|false>} children
 * @returns {Node} `parent`
 */
function append(parent, children) {
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


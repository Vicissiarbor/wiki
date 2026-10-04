/**
 * A tiny, dependency-free Markdown subset renderer.
 *
 * Why not a library: the whole site must stay "传统三件套" (HTML + CSS + JS with
 * no build step and no CDN), so the renderer is part of this repository. It is
 * deliberately small and safe by construction:
 *
 *   - the source is HTML-escaped first, so raw HTML in an entry can never execute;
 *   - every generated fragment is inserted through an opaque placeholder, so
 *     link URLs cannot be mangled by the emphasis rules;
 *   - link targets are restricted to http/https/mailto and relative paths.
 *
 * Supported: headings, paragraphs (single newline = line break), fenced code,
 * blockquotes, ordered/unordered lists with nesting, pipe tables (GitHub
 * style), horizontal rules, `code`, **bold**, *italic*, ~~strikethrough~~,
 * [links](url), ![images](url), bare URLs and [[wiki links]] to other entries.
 *
 * Not supported (by design): raw HTML, footnotes, reference links.
 */

/** HTML entities for the five characters that matter in an HTML context. */
const HTML_ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/**
 * @param {unknown} value
 * @returns {string} `value` with HTML metacharacters escaped.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/** URL schemes that are safe to put into href/src. */
const SAFE_SCHEMES = Object.freeze(['http:', 'https:', 'mailto:']);

/**
 * @param {string} url
 * @returns {boolean} True when the URL may be linked/embedded.
 */
export function isSafeUrl(url) {
  const text = String(url ?? '').trim();
  if (text === '') {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u001F\u007F\s]/g, '');
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!scheme) {
    return true; // relative path, fragment or query
  }
  return SAFE_SCHEMES.includes(`${scheme[1].toLowerCase()}:`);
}

/** A placeholder token that survives HTML escaping and inline formatting. */
const TOKEN_OPEN = '\u0000';
const TOKEN_PATTERN = /\u0000(\d+)\u0000/g;

/**
 * @param {Array<string>} fragments
 * @param {string} html
 * @returns {string} A placeholder referring to `html`.
 */
function push(fragments, html) {
  fragments.push(html);
  return `${TOKEN_OPEN}${fragments.length - 1}${TOKEN_OPEN}`;
}

/**
 * @param {string} text
 * @param {Array<string>} fragments
 * @returns {string} `text` with every placeholder replaced by its HTML.
 */
function restore(text, fragments) {
  return text.replace(TOKEN_PATTERN, (match, index) => fragments[Number(index)] ?? match);
}

/**
 * Render the inline part of a line (or paragraph).
 *
 * @param {string} text Raw Markdown text.
 * @param {{resolveTermLink?: (name: string) => (string|null)}} [options]
 * @returns {string} HTML.
 */
export function renderInline(text, options = {}) {
  const fragments = [];
  const source = String(text ?? '').replace(/\r\n?/g, '\n');

  // 1. Code spans first: their content must never be formatted or linked.
  let work = source.replace(/(`+)([^`]+?)\1/g, (match, _ticks, code) =>
    push(fragments, `<code>${escapeHtml(code.trim())}</code>`),
  );

  // 2. Everything else is escaped before any pattern is applied.
  work = escapeHtml(work);

  // 3. Wiki links become placeholders so `[x](y)` handling cannot touch them.
  work = work.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (match, target, label) => {
    const name = target.trim();
    const text = (label ?? target).trim();
    const href = options.resolveTermLink ? options.resolveTermLink(name) : null;
    if (href) {
      return push(fragments, `<a class="term-link" href="${href}">${text}</a>`);
    }
    return push(fragments, `<span class="term-link term-link--missing">${text}</span>`);
  });

  // 4. Images, then links.
  work = work.replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (match, alt, url) => {
    if (!isSafeUrl(url)) {
      return push(fragments, escapeHtml(match));
    }
    return push(fragments, `<img src="${url}" alt="${alt}" loading="lazy">`);
  });
  work = work.replace(/\[([^\]\n]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (match, label, url) => {
    if (!isSafeUrl(url)) {
      return push(fragments, escapeHtml(match));
    }
    const external = /^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return push(fragments, `<a href="${url}"${external}>${label || url}</a>`);
  });

  // 5. Bare URLs (only when not already inside a generated anchor).
  work = work.replace(/(^|[\s(（[【])(https?:\/\/[^\s<>()（）]+)/g, (match, prefix, url) =>
    `${prefix}${push(fragments, `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)}`,
  );

  // 6. Emphasis. Fragments are placeholders now, so URLs cannot be rewritten.
  work = work
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, '<em>$1</em>')
    .replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');

  // 7. Soft line breaks inside a paragraph are intentional in glossary notes.
  work = work.replace(/\n/g, '<br>\n');

  return restore(work, fragments);
}

const FENCE = /^\s*(```+|~~~+)\s*([^\s`]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_DELIMITER = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;

/** Same rule as TABLE_DELIMITER, applied line by line when flattening text. */
const TABLE_DELIMITER_GLOBAL = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm;

/**
 * @param {string[]} lines
 * @param {number} index
 * @returns {boolean} True when `lines[index]` starts a pipe table.
 */
function isTableStart(lines, index) {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (header === undefined || delimiter === undefined) {
    return false;
  }
  return header.includes('|') && TABLE_DELIMITER.test(delimiter) && delimiter.includes('-');
}

/**
 * @param {string} line
 * @returns {string[]} Cells of a pipe table row.
 */
function splitTableRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) {
    text = text.slice(1);
  }
  if (text.endsWith('|')) {
    text = text.slice(0, -1);
  }
  return text.split('|').map((cell) => cell.trim());
}

/**
 * Render a GitHub-style pipe table.
 *
 * @param {string[]} lines
 * @param {number} start
 * @param {Record<string, unknown>} options
 * @returns {{html: string, next: number}}
 */
function renderTable(lines, start, options) {
  const header = splitTableRow(lines[start]);
  const alignments = splitTableRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) {
      return 'center';
    }
    return right ? 'right' : left ? 'left' : '';
  });
  let index = start + 2;
  /** @type {string[][]} */
  const rows = [];
  while (index < lines.length && lines[index].trim() !== '' && lines[index].includes('|')) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  /**
   * @param {string} tag
   * @param {string} cell
   * @param {number} column
   * @returns {string}
   */
  const cellHtml = (tag, cell, column) => {
    const align = alignments[column];
    const attribute = align === '' ? '' : ` class="align-${align}"`;
    return `<${tag}${attribute}>${renderInline(cell, options)}</${tag}>`;
  };

  const head = header.map((cell, column) => cellHtml('th', cell, column)).join('');
  const body = rows
    .map((row) => {
      const cells = row.map((cell, column) => cellHtml('td', cell, column)).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('\n');

  return {
    html: `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`,
    next: index,
  };
}

/**
 * @param {string} line
 * @returns {boolean} True when `line` starts a non-paragraph block.
 */
function startsBlock(line) {
  return (
    line.trim() === '' ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line)
  );
}

/**
 * @param {string[]} lines
 * @param {Record<string, unknown>} options
 * @param {boolean} tight When true, top-level paragraphs are not wrapped in <p>.
 * @returns {string} HTML for the given lines.
 */
function renderBlocks(lines, options, tight = false) {
  const out = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const language = fence[2];
      const body = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${marker}`).test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence (or end of input)
      const className = language ? ` class="language-${escapeHtml(language)}"` : '';
      out.push(`<pre><code${className}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6); // entry title owns <h1>
      out.push(`<h${level}>${renderInline(heading[2], options)}</h${level}>`);
      index += 1;
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index]);
        if (!match) {
          break;
        }
        body.push(match[1]);
        index += 1;
      }
      out.push(`<blockquote>${renderBlocks(body, options)}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = renderTable(lines, index, options);
      out.push(table.html);
      index = table.next;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { html, next } = renderList(lines, index, options);
      out.push(html);
      index = next;
      continue;
    }

    const paragraph = [];
    const paragraphStart = index;
    while (index < lines.length && !startsBlock(lines[index])) {
      if (index > paragraphStart && isTableStart(lines, index)) {
        break;
      }
      paragraph.push(lines[index]);
      index += 1;
    }
    const html = renderInline(paragraph.join('\n'), options);
    out.push(tight ? html : `<p>${html}</p>`);
  }

  return out.join('\n');
}

/**
 * Render one list, including nested sub-lists.
 *
 * @param {string[]} lines
 * @param {number} start Index of the first item marker.
 * @param {Record<string, unknown>} options
 * @returns {{html: string, next: number}}
 */
function renderList(lines, start, options) {
  const first = LIST_ITEM.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  /** @type {string[][]} */
  const items = [];
  let index = start;

  while (index < lines.length) {
    const marker = LIST_ITEM.exec(lines[index]);
    if (!marker || marker[1].length !== baseIndent || /^\d/.test(marker[2]) !== ordered) {
      break;
    }
    /** @type {string[]} */
    const content = [marker[3]];
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        let lookahead = index;
        while (lookahead < lines.length && lines[lookahead].trim() === '') {
          lookahead += 1;
        }
        if (lookahead >= lines.length) {
          index = lookahead;
          break;
        }
        const nextItem = LIST_ITEM.exec(lines[lookahead]);
        if (nextItem && nextItem[1].length === baseIndent && /^\d/.test(nextItem[2]) === ordered) {
          index = lookahead;
          break; // same-level item after a blank line: still one list
        }
        if (lines[lookahead].search(/\S/) > baseIndent) {
          content.push('');
          index = lookahead;
          continue;
        }
        index = lookahead;
        break;
      }
      const nextItem = LIST_ITEM.exec(line);
      if (nextItem && nextItem[1].length <= baseIndent) {
        break;
      }
      const indent = line.search(/\S/);
      if (indent <= baseIndent) {
        break;
      }
      content.push(line.slice(Math.min(indent, baseIndent + 2)));
      index += 1;
    }

    items.push(content);
  }

  const tag = ordered ? 'ol' : 'ul';
  const body = items.map((content) => `<li>${renderListItem(content, options)}</li>`).join('\n');
  return { html: `<${tag}>\n${body}\n</${tag}>`, next: index };
}

/**
 * @param {string[]} content Lines of a single list item.
 * @param {Record<string, unknown>} options
 * @returns {string} HTML.
 */
function renderListItem(content, options) {
  const lines = [...content];
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    return '';
  }
  if (lines.length === 1) {
    return renderInline(lines[0], options);
  }
  const hasBlock = lines.slice(1).some((line) => line.trim() !== '' && startsBlock(line));
  if (!hasBlock) {
    return renderInline(lines.join('\n'), options);
  }
  return renderBlocks(lines, options, true);
}

/**
 * Render Markdown text to HTML.
 *
 * @param {unknown} source
 * @param {{resolveTermLink?: (name: string) => (string|null)}} [options]
 *   `resolveTermLink` turns `[[Name]]` into a link to that entry; return `null`
 *   when the term does not exist, and the link renders as plain highlighted text.
 * @returns {string} HTML safe to assign to `innerHTML`.
 */
export function renderMarkdown(source, options = {}) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  if (text.trim() === '') {
    return '';
  }
  return renderBlocks(text.split('\n'), options);
}

/**
 * @param {unknown} source
 * @returns {string} A short plain-text preview (Markdown syntax removed).
 */
export function toPlainText(source) {
  return String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label ?? target)
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(TABLE_DELIMITER_GLOBAL, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
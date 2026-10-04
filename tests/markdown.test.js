import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  escapeHtml,
  isSafeUrl,
  renderInline,
  renderMarkdown,
  toPlainText,
} from '../web/js/core/markdown.js';

describe('escapeHtml / isSafeUrl', () => {
  it('escapes the five HTML metacharacters', () => {
    assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });

  it('allows only safe URL schemes', () => {
    for (const url of ['https://example.com', 'http://example.com', 'mailto:a@b.c', '/x', './x', '#a', 'page.html']) {
      assert.equal(isSafeUrl(url), true, url);
    }
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      assert.equal(isSafeUrl(url), false, url);
    }
    assert.equal(isSafeUrl('java\nscript:alert(1)'), false);
  });
});

describe('renderMarkdown - safety', () => {
  it('never emits raw HTML from the source', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    assert.ok(!html.includes('<script'));
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&lt;img src=x'));
  });

  it('refuses javascript: links and images', () => {
    const html = renderMarkdown('[click](javascript:alert(1)) ![x](javascript:alert(1))');
    assert.ok(!html.includes('<a href="javascript'));
    assert.ok(!html.includes('<img'));
  });

  it('keeps emphasis inside a link URL from breaking the markup', () => {
    const html = renderMarkdown('[a](https://example.com/a_b_c) and *em*');
    assert.ok(html.includes('href="https://example.com/a_b_c"'));
    assert.ok(html.includes('<em>em</em>'));
  });
});

describe('renderMarkdown - blocks', () => {
  it('renders headings shifted below the entry title', () => {
    assert.equal(renderMarkdown('# 一'), '<h2>一</h2>');
    assert.equal(renderMarkdown('### 三'), '<h4>三</h4>');
    assert.equal(renderMarkdown('###### 六'), '<h6>六</h6>');
  });

  it('renders paragraphs and line breaks', () => {
    assert.equal(renderMarkdown('a\nb'), '<p>a<br>\nb</p>');
    assert.equal(renderMarkdown('a\n\nb'), '<p>a</p>\n<p>b</p>');
  });

  it('renders unordered and ordered lists, including nesting', () => {
    const html = renderMarkdown('- a\n- b\n  - b1\n  - b2\n\n1. one\n2. two');
    assert.match(html, /<ul>\n<li>a<\/li>\n<li>b\s*<ul>\n<li>b1<\/li>/);
    assert.match(html, /<ol>\n<li>one<\/li>\n<li>two<\/li>\n<\/ol>/);
  });

  it('keeps a loose list as one list', () => {
    const html = renderMarkdown('- a\n\n- b');
    assert.equal((html.match(/<ul>/g) ?? []).length, 1);
    assert.equal((html.match(/<li>/g) ?? []).length, 2);
  });

  it('renders fenced code without formatting its content', () => {
    const html = renderMarkdown('```js\nconst a = *b* <c>;\n```');
    assert.equal(html, '<pre><code class="language-js">const a = *b* &lt;c&gt;;</code></pre>');
  });

  it('renders blockquotes, rules and tables', () => {
    assert.equal(renderMarkdown('> quote'), '<blockquote><p>quote</p></blockquote>');
    assert.equal(renderMarkdown('---'), '<hr>');
    const table = renderMarkdown('| a | b |\n| --- | ---: |\n| 1 | 2 |');
    assert.match(table, /<th>a<\/th><th class="align-right">b<\/th>/);
    assert.match(table, /<td>1<\/td><td class="align-right">2<\/td>/);
  });

  it('returns an empty string for empty input', () => {
    assert.equal(renderMarkdown('   '), '');
    assert.equal(renderMarkdown(null), '');
  });
});

describe('renderMarkdown - inline', () => {
  it('renders code, bold, italic and strikethrough', () => {
    const html = renderInline('`x` **b** *i* ~~s~~');
    assert.equal(html, '<code>x</code> <strong>b</strong> <em>i</em> <del>s</del>');
  });

  it('does not format inside code spans', () => {
    assert.equal(renderInline('`**not bold**`'), '<code>**not bold**</code>');
  });

  it('renders links, external targets and bare URLs', () => {
    const html = renderInline('[文档](https://example.com) 与 https://example.org/x');
    assert.ok(html.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer">文档</a>'));
    assert.ok(html.includes('>https://example.org/x</a>'));
  });

  it('resolves wiki links against the collection', () => {
    const resolved = renderInline('见 [[熵]] 与 [[焓|enthalpy]]', {
      resolveTermLink: (name) => (name === '熵' ? '#/?e=entropy' : null),
    });
    assert.ok(resolved.includes('<a class="term-link" href="#/?e=entropy">熵</a>'));
    assert.ok(resolved.includes('<span class="term-link term-link--missing">enthalpy</span>'));
  });

  it('treats wiki links without a resolver as missing terms', () => {
    assert.equal(renderInline('[[熵]]'), '<span class="term-link term-link--missing">熵</span>');
  });

  it('escapes but keeps unmatched syntax intact', () => {
    assert.equal(renderInline('a * b'), 'a * b');
    assert.equal(renderInline('2 < 3'), '2 &lt; 3');
  });
});

describe('renderMarkdown - math', () => {
  it('marks inline math and keeps the TeX in data-tex', () => {
    const html = renderInline('an order pair $(a, b)$, where $a,b \\in R$');
    assert.equal((html.match(/class="math math--inline"/g) ?? []).length, 2);
    assert.ok(html.includes('data-tex="(a, b)"'));
    assert.ok(html.includes('data-tex="a,b \\in R"'));
    assert.ok(html.includes('data-display="inline"'));
  });

  it('marks display math, including multi-line $$…$$', () => {
    const html = renderMarkdown('$$\nH(X) = -\\sum_i p_i \\log p_i\n$$');
    assert.equal((html.match(/class="math math--display"/g) ?? []).length, 1);
    assert.ok(html.includes('data-display="display"'));
    assert.ok(html.includes('-\\sum_i p_i'));
  });

  it('accepts the LaTeX bracket delimiters too', () => {
    const inline = renderInline('\\(x^2\\)');
    assert.ok(inline.includes('data-tex="x^2"'));
    const display = renderInline('\\[E = mc^2\\]');
    assert.ok(display.includes('data-display="display"'));
    assert.ok(display.includes('data-tex="E = mc^2"'));
  });

  it('never treats a code span as math', () => {
    const html = renderInline('写作 `$x$` 表示公式');
    assert.equal(html, '写作 <code>$x$</code> 表示公式');
  });

  it('leaves currency alone', () => {
    assert.equal(renderInline('价格 $5 和 $6 之间'), '价格 $5 和 $6 之间');
    assert.equal(renderInline('$ x$ 与 $y $'), '$ x$ 与 $y $');
  });

  it('keeps TeX operators out of the emphasis rules', () => {
    const html = renderInline('$a_i * b_j$ 与 **粗体**');
    assert.ok(html.includes('data-tex="a_i * b_j"'));
    assert.ok(!html.includes('<em>'));
    assert.ok(html.includes('<strong>粗体</strong>'));
  });

  it('escapes the TeX so it can never become markup', () => {
    const html = renderInline('$<img src=x onerror=1>$');
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('data-tex="&lt;img src=x onerror=1&gt;"'));
    assert.equal(renderInline('$"quoted"$').includes('data-tex="&quot;quoted&quot;"'), true);
  });

  it('respects an escaped dollar sign', () => {
    assert.equal(renderInline('\\$100 与 \\$200'), '\\$100 与 \\$200');
  });

  it('keeps a formula readable without KaTeX', () => {
    // The TeX is also the visible text until ui/math.js renders it.
    const html = renderInline('$a + bi$');
    assert.ok(html.includes('data-tex="a + bi"'));
    assert.ok(html.endsWith('>a + bi</span>'), html);
  });

  it('does not turn an unclosed dollar into a formula', () => {
    assert.equal(renderInline('$unclosed'), '$unclosed');
    assert.equal(renderInline('50$'), '50$');
  });
});

describe('toPlainText', () => {
  it('flattens markdown for previews', () => {
    const text = toPlainText('# 标题\n\n- **粗体** `代码`\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
    assert.ok(!text.includes('#'));
    assert.ok(!text.includes('|'));
    assert.ok(text.includes('粗体'));
    assert.ok(text.includes('代码'));
  });
});
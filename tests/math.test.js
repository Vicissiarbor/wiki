/**
 * Unit tests for the KaTeX wiring: loading is lazy, relative, and degrades to
 * the raw TeX when the library cannot be fetched.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

const REPO_ROOT = new URL('../', import.meta.url);

/** @type {JSDOM} */
let dom;
/** @type {typeof import('../web/js/ui/math.js')} */
let math;

before(async () => {
  dom = new JSDOM('<div id="host"><p>plain</p></div>', { url: 'https://example.test/ladr/' });
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement']) {
    Object.defineProperty(globalThis, name, {
      value: dom.window[name],
      configurable: true,
      writable: true,
    });
  }
  math = await import('../web/js/ui/math.js');
});

after(() => {
  delete /** @type {any} */ (globalThis).katex;
});

beforeEach(() => {
  delete /** @type {any} */ (globalThis).katex;
  dom.window.document.querySelector('#host').innerHTML =
    '<p><span class="math math--inline" data-tex="a + bi" data-display="inline">a + bi</span></p>' +
    '<span class="math math--display" data-tex="H = U + pV" data-display="display">H = U + pV</span>';
});

/**
 * @param {string} text
 * @returns {void}
 */
function setHost(text) {
  dom.window.document.querySelector('#host').innerHTML = text;
}

/** @returns {HTMLElement} */
function host() {
  return /** @type {HTMLElement} */ (dom.window.document.querySelector('#host'));
}

/** A KaTeX double that records its calls. */
function fakeKatex() {
  /** @type {Array<{tex: string, displayMode: boolean, options: object}>} */
  const calls = [];
  return {
    calls,
    api: {
      version: '0.17.0-test',
      /**
       * @param {string} tex
       * @param {HTMLElement} node
       * @param {any} options
       */
      render(tex, node, options) {
        calls.push({ tex, displayMode: Boolean(options.displayMode), options });
        node.textContent = `[rendered ${tex}]`;
      },
    },
  };
}

describe('currentKatex', () => {
  it('is null when nothing has been loaded', () => {
    assert.equal(math.currentKatex(), null);
  });

  it('finds the API on globalThis', () => {
    const { api } = fakeKatex();
    /** @type {any} */ (globalThis).katex = api;
    assert.equal(math.currentKatex(), api);
  });

  it('unwraps a `default` export', () => {
    const { api } = fakeKatex();
    /** @type {any} */ (globalThis).katex = { default: api };
    assert.equal(math.currentKatex(), api);
  });

  it('ignores an unrelated global', () => {
    /** @type {any} */ (globalThis).katex = { nothing: true };
    assert.equal(math.currentKatex(), null);
  });
});

describe('loadKatex', () => {
  it('prefers an injected loader', async () => {
    const { api } = fakeKatex();
    const loaded = await math.loadKatex({ load: async () => api });
    assert.equal(loaded, api);
  });

  it('returns the already-present API without touching the DOM', async () => {
    const { api } = fakeKatex();
    /** @type {any} */ (globalThis).katex = api;
    const before = dom.window.document.querySelectorAll('[data-ladr-katex]').length;
    assert.equal(await math.loadKatex(), api);
    assert.equal(dom.window.document.querySelectorAll('[data-ladr-katex]').length, before);
  });

  it('uses relative asset paths when it has to inject them', async () => {
    assert.equal(math.KATEX_BASE.startsWith('./'), true);
    const source = await fs.readFile(new URL('web/js/ui/math.js', REPO_ROOT), 'utf8');
    assert.ok(!/['"]\/assets/.test(source), 'math.js must not use root-absolute paths');
    assert.ok(!/https?:\/\//.test(source), 'math.js must not reference a CDN');
  });
});

describe('renderMath', () => {
  it('does nothing when the page has no formula', async () => {
    setHost('<p>plain text</p>');
    const { api, calls } = fakeKatex();
    const result = await math.renderMath(host(), { load: async () => api });
    assert.deepEqual(result, { found: 0, rendered: 0, unavailable: false });
    assert.equal(calls.length, 0);
  });

  it('renders inline and display formulas with the right flags', async () => {
    const { api, calls } = fakeKatex();
    const result = await math.renderMath(host(), { load: async () => api });

    assert.deepEqual(result, { found: 2, rendered: 2, unavailable: false });
    assert.deepEqual(
      calls.map((call) => [call.tex, call.displayMode]),
      [
        ['a + bi', false],
        ['H = U + pV', true],
      ],
    );
    // Safe defaults: no trust, no throwing on bad TeX.
    assert.equal(calls[0].options.trust, false);
    assert.equal(calls[0].options.throwOnError, false);
    const nodes = host().querySelectorAll('[data-tex]');
    assert.equal(nodes[0].textContent, '[rendered a + bi]');
    assert.equal(nodes[0].classList.contains('is-rendered'), true);
    assert.equal(nodes[1].classList.contains('is-rendered'), true);
  });

  it('keeps the raw TeX when KaTeX cannot be loaded', async () => {
    const result = await math.renderMath(host(), { load: async () => null });
    assert.deepEqual(result, { found: 2, rendered: 0, unavailable: true });
    assert.equal(host().textContent.includes('a + bi'), true);
    assert.equal(host().querySelector('[data-tex]').classList.contains('is-rendered'), false);
  });

  it('survives a loader that rejects', async () => {
    const result = await math.renderMath(host(), {
      load: async () => {
        throw new Error('offline');
      },
    });
    assert.equal(result.unavailable, true);
    assert.equal(host().textContent.includes('H = U + pV'), true);
  });

  it('keeps going when one formula is rejected by KaTeX', async () => {
    setHost(
      '<span data-tex="bad" data-display="inline">bad</span>' +
        '<span data-tex="good" data-display="inline">good</span>',
    );
    /** @type {string[]} */
    const seen = [];
    const api = {
      render(/** @type {string} */ tex, /** @type {HTMLElement} */ node) {
        seen.push(tex);
        if (tex === 'bad') {
          throw new Error('ParseError');
        }
        node.textContent = 'ok';
      },
    };
    const result = await math.renderMath(host(), { load: async () => api });
    assert.deepEqual(seen, ['bad', 'good']);
    assert.deepEqual(result, { found: 2, rendered: 1, unavailable: false });
    assert.equal(host().querySelectorAll('[data-tex]')[0].textContent, 'bad');
    assert.equal(host().querySelectorAll('[data-tex]')[1].textContent, 'ok');
  });
});
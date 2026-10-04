import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConflictError, DataSourceError } from '../web/js/core/errors.js';
import { isMixedContent, originOf, requestJson } from '../web/js/data/http.js';
import { createFetchStub, failingFetch } from './helpers/index.js';

/**
 * Pretend the page itself is served over HTTPS (as GitHub Pages does), so the
 * mixed-content guard can be exercised outside a browser.
 *
 * @param {'https:'|'http:'} protocol
 * @returns {() => void} Restores the previous global.
 */
function withPageProtocol(protocol) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    value: { protocol, href: `${protocol}//example.test/` },
    configurable: true,
    writable: true,
  });
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, 'location', previous);
    } else {
      delete globalThis.location;
    }
  };
}

describe('isMixedContent', () => {
  it('detects an HTTP request from an HTTPS page', () => {
    assert.equal(isMixedContent('http://1.2.3.4:8787/api/entries', 'https:'), true);
    assert.equal(isMixedContent('https://data.example.com/api/entries', 'https:'), false);
    assert.equal(isMixedContent('http://1.2.3.4:8787/api/entries', 'http:'), false);
  });

  it('defaults to the protocol of the current page', () => {
    const restore = withPageProtocol('https:');
    try {
      assert.equal(isMixedContent('http://example.test/api'), true);
      assert.equal(isMixedContent('https://example.test/api'), false);
    } finally {
      restore();
    }
  });

  it('derives the origin of an absolute URL', () => {
    assert.equal(originOf('http://host:8787/api/entries'), 'http://host:8787');
    assert.equal(originOf('not a url'), '');
  });
});

describe('requestJson', () => {
  it('sends JSON and parses the response', async () => {
    const { fetch, calls } = createFetchStub({ 'http://host/api': { body: { ok: true } } });
    const payload = await requestJson('http://host/api', {
      method: 'POST',
      body: { entry: { name: 'x' } },
      headers: { Authorization: 'Bearer t' },
      fetchImpl: fetch,
    });
    assert.deepEqual(payload, { ok: true });
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers.authorization, 'Bearer t');
    assert.deepEqual(calls[0].body, { entry: { name: 'x' } });
  });

  it('refuses an HTTP URL from an HTTPS page before trying', async () => {
    const { fetch, calls } = createFetchStub({ '*': { body: {} } });
    const restore = withPageProtocol('https:');
    try {
      await assert.rejects(
        () => requestJson('http://1.2.3.4:8787/api', { fetchImpl: fetch }),
        (error) => {
          assert.ok(error instanceof DataSourceError);
          assert.equal(error.kind, 'mixed-content');
          assert.match(error.message, /混合内容/);
          return true;
        },
      );
    } finally {
      restore();
    }
    assert.equal(calls.length, 0);
  });

  it('maps 409 onto ConflictError with the revisions', async () => {
    const { fetch } = createFetchStub({
      '*': { status: 409, body: { message: '冲突', expected: 'a', actual: 'b' } },
    });
    await assert.rejects(
      () => requestJson('https://host/api', { fetchImpl: fetch }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.equal(error.expected, 'a');
        assert.equal(error.actual, 'b');
        return true;
      },
    );
  });

  it('reports authentication failures with a hint', async () => {
    const { fetch } = createFetchStub({ '*': { status: 401, body: { message: '令牌无效' } } });
    await assert.rejects(
      () => requestJson('https://host/api', { fetchImpl: fetch }),
      (error) => {
        assert.equal(error.kind, 'auth');
        assert.equal(error.status, 401);
        assert.match(error.message, /401/);
        return true;
      },
    );
  });

  it('explains network failures (CORS, offline)', async () => {
    await assert.rejects(
      () => requestJson('https://host/api', { fetchImpl: failingFetch(new TypeError('Failed to fetch')) }),
      (error) => {
        assert.equal(error.kind, 'network');
        assert.match(error.message, /CORS/);
        return true;
      },
    );
  });

  it('reports timeouts', async () => {
    const aborting = /** @type {typeof fetch} */ (async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    await assert.rejects(
      () => requestJson('https://host/api', { fetchImpl: aborting, timeoutMs: 5 }),
      (error) => {
        assert.equal(error.kind, 'timeout');
        return true;
      },
    );
  });

  it('rejects a non-JSON body on a 200 response', async () => {
    const broken = /** @type {typeof fetch} */ (async () =>
      /** @type {Response} */ ({ ok: true, status: 200, text: async () => '<html>' }));
    await assert.rejects(
      () => requestJson('https://host/api', { fetchImpl: broken }),
      (error) => {
        assert.equal(error.kind, 'format');
        return true;
      },
    );
  });

  it('handles an empty 204 body', async () => {
    const empty = /** @type {typeof fetch} */ (async () =>
      /** @type {Response} */ ({ ok: true, status: 204, text: async () => '' }));
    assert.equal(await requestJson('https://host/api', { fetchImpl: empty, method: 'DELETE' }), null);
  });
});
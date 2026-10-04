import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createServer } from '../server/index.js';
import { parseConfig } from '../server/lib/config.js';
import { makeTempDir, removeTempDir } from './helpers/index.js';

/**
 * End-to-end test of the backend over real HTTP: no mocks, the same code path a
 * phone or another device would hit.
 */
describe('server API', () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let dataFile;
  /** @type {string} */
  let baseUrl;
  /** @type {import('node:http').Server} */
  let server;
  const token = 'test-token';

  before(async () => {
    dir = await makeTempDir('api');
    dataFile = path.join(dir, 'entries.json');
    await fs.writeFile(
      dataFile,
      JSON.stringify({
        version: 1,
        updatedAt: '2025-01-01T00:00:00.000Z',
        entries: [{ id: 'alpha', name: 'Alpha' }],
      }),
    );

    const { config } = parseConfig(
      [
        '--port',
        '0',
        '--host',
        '127.0.0.1',
        '--data',
        dataFile,
        '--token',
        token,
        '--static-root',
        path.join(process.cwd(), 'web'),
        '--log-level',
        'error',
      ],
      {},
    );
    const created = createServer(config, { logLevel: 'error' });
    server = created.server;
    const address = await created.start(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await removeTempDir(dir);
  });

  /**
   * @param {string} pathname
   * @param {{method?: string, body?: unknown, token?: string|null, headers?: Record<string, string>}} [options]
   * @returns {Promise<{status: number, body: any, headers: Headers}>}
   */
  async function call(pathname, options = {}) {
    const authToken = options.token === undefined ? token : options.token;
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(authToken === null ? {} : { Authorization: `Bearer ${authToken}` }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text === '' ? null : JSON.parse(text),
      headers: response.headers,
    };
  }

  it('reports health', async () => {
    const { status, body } = await call('/api/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.entries, 1);
    assert.equal(body.writable, true);
    assert.ok(body.revision);
  });

  it('serves the bundle with a revision and ETag', async () => {
    const { status, body, headers } = await call('/api/entries');
    assert.equal(status, 200);
    assert.equal(body.entries.length, 1);
    assert.equal(headers.get('etag'), `"${body.revision}"`);
  });

  it('refuses writes without a token', async () => {
    const { status, body } = await call('/api/entries', {
      method: 'POST',
      body: { entry: { name: 'Beta' } },
      token: null,
    });
    assert.equal(status, 401);
    assert.equal(body.code, 'unauthorized');
  });

  it('refuses writes with a wrong token', async () => {
    const { status } = await call('/api/entries', {
      method: 'POST',
      body: { entry: { name: 'Beta' } },
      token: 'wrong',
    });
    assert.equal(status, 401);
  });

  it('creates an entry with a token', async () => {
    const { status, body } = await call('/api/entries', {
      method: 'POST',
      body: { entry: { id: 'beta', name: 'Beta', tags: ['x'] } },
    });
    assert.equal(status, 201);
    assert.equal(body.created.name, 'Beta');
    assert.equal(body.entries.length, 2);
  });

  it('validates the payload', async () => {
    const { status, body } = await call('/api/entries', {
      method: 'POST',
      body: { entry: { name: '' } },
    });
    assert.equal(status, 422);
    assert.equal(body.code, 'invalid-entry');
    assert.ok(Array.isArray(body.issues));
  });

  it('rejects malformed JSON and empty bodies', async () => {
    const raw = await fetch(`${baseUrl}/api/entries`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{oops',
    });
    assert.equal(raw.status, 400);
    assert.equal((await raw.json()).code, 'invalid-json');
  });

  it('updates an entry', async () => {
    const { status, body } = await call('/api/entries/beta', {
      method: 'PUT',
      body: { entry: { name: 'Beta 2' } },
    });
    assert.equal(status, 200);
    assert.equal(body.updated.name, 'Beta 2');
  });

  it('404s for an unknown id', async () => {
    const { status } = await call('/api/entries/missing', {
      method: 'PUT',
      body: { entry: { name: 'X' } },
    });
    assert.equal(status, 404);
    const deleted = await call('/api/entries/missing', { method: 'DELETE' });
    assert.equal(deleted.status, 404);
  });

  it('detects conflicting revisions', async () => {
    const stale = (await call('/api/entries')).body.revision;
    await call('/api/entries', { method: 'POST', body: { entry: { id: 'gamma', name: 'Gamma' } } });
    const { status, body } = await call('/api/entries/delta', {
      method: 'PUT',
      body: { entry: { name: 'Delta' } },
      headers: { 'If-Match': stale },
    });
    assert.equal(status, 409);
    assert.equal(body.code, 'conflict');
    assert.equal(body.expected, stale);
  });

  it('accepts a matching revision', async () => {
    const revision = (await call('/api/entries')).body.revision;
    const { status } = await call('/api/entries', {
      method: 'POST',
      body: { entry: { id: 'epsilon', name: 'Epsilon' } },
      headers: { 'If-Match': revision },
    });
    assert.equal(status, 201);
  });

  it('deletes an entry', async () => {
    const before = (await call('/api/entries')).body.entries.length;
    const { status, body } = await call('/api/entries/epsilon', { method: 'DELETE' });
    assert.equal(status, 200);
    assert.equal(body.entries.length, before - 1);
  });

  it('supports a bulk import', async () => {
    const { status, body } = await call('/api/entries/import', {
      method: 'POST',
      body: { entries: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] },
    });
    assert.equal(status, 200);
    assert.equal(body.entries.length, 2);
  });

  it('serves the static site from the same origin', async () => {
    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /请输入概念名称|概念词条库/);

    const css = await fetch(`${baseUrl}/assets/css/main.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const missing = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(missing.status, 404);
  });

  it('re-validates static files with ETag/304', async () => {
    const first = await fetch(`${baseUrl}/index.html`);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const second = await fetch(`${baseUrl}/index.html`, { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
  });

  it('refuses path traversal', async () => {
    const response = await fetch(`${baseUrl}/../../etc/passwd`);
    assert.ok([400, 404].includes(response.status));
  });

  it('answers CORS preflight', async () => {
    const response = await fetch(`${baseUrl}/api/entries`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://user.github.io', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://user.github.io');
    assert.match(response.headers.get('access-control-allow-headers'), /If-Match/);
  });

  it('404s unknown API routes with JSON', async () => {
    const { status, body } = await call('/api/nope');
    assert.equal(status, 404);
    assert.equal(body.code, 'not-found');
  });
});

describe('server read-only mode', () => {
  /** @type {string} */
  let dir;
  /** @type {import('node:http').Server} */
  let server;
  /** @type {string} */
  let baseUrl;

  before(async () => {
    dir = await makeTempDir('api-ro');
    const dataFile = path.join(dir, 'entries.json');
    const { config } = parseConfig(
      ['--data', dataFile, '--no-static', '--log-level', 'error', '--host', '127.0.0.1'],
      {},
    );
    const created = createServer(config, { logLevel: 'error' });
    server = created.server;
    await created.store.ensureFile();
    const address = await created.start(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await removeTempDir(dir);
  });

  it('reports writable=false and rejects writes', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal((await health.json()).writable, false);
    const post = await fetch(`${baseUrl}/api/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: { name: 'X' } }),
    });
    assert.equal(post.status, 403);
    assert.equal((await post.json()).code, 'read-only');
  });

  it('explains that static hosting is disabled', async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /静态托管/);
  });
});
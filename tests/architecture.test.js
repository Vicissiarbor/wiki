/**
 * Architecture guards.
 *
 * Three rules this project actually depends on:
 *   1. the shared core stays free of DOM and Node APIs (so it is testable and
 *      could be reused anywhere);
 *   2. every reference is relative — the site is published from a project
 *      subdirectory and must survive being moved;
 *   3. the site is read-only: no write requests, no tokens, nothing to abuse.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_DIRS = ['web/js/core', 'web/js/data'];
const SITE_JS_DIRS = ['web/js'];

/** Browser/DOM globals the shared core must not touch directly. */
const FORBIDDEN = [
  { pattern: /\bdocument\s*\./, label: 'document' },
  { pattern: /\bwindow\s*\./, label: 'window' },
  { pattern: /\blocalStorage\b/, label: 'localStorage' },
  { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
  { pattern: /\bindexedDB\b/, label: 'indexedDB' },
  { pattern: /\balert\s*\(/, label: 'alert' },
  { pattern: /\bconfirm\s*\(/, label: 'confirm' },
  { pattern: /\.innerHTML\s*=/, label: 'innerHTML assignment' },
  { pattern: /\bnode:fs\b|\brequire\s*\(/, label: 'Node API' },
];

/**
 * Blank out string literals and comments so the scan only looks at real code
 * (a doc comment may legitimately mention `localStorage`).
 *
 * @param {string} source
 * @returns {string}
 */
function stripLiteralsAndComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/(\s)\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``');
}

/**
 * @param {string} dir Repository-relative directory.
 * @returns {Promise<string[]>} Absolute paths of every .js file below it.
 */
async function listModules(dir) {
  const absolute = path.join(REPO_ROOT, dir);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listModules(path.relative(REPO_ROOT, full))));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {string[]} dirs
 * @returns {Promise<Array<{file: string, source: string, code: string}>>}
 */
async function readModules(dirs) {
  const files = (await Promise.all(dirs.map(listModules))).flat();
  const modules = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    modules.push({ file: path.relative(REPO_ROOT, file), source, code: stripLiteralsAndComments(source) });
  }
  return modules;
}

describe('shared core purity', () => {
  it('keeps DOM and Node APIs out of web/js/core and web/js/data', async () => {
    const modules = await readModules(SHARED_DIRS);
    assert.ok(modules.length >= 8, `expected to scan the shared modules, saw ${modules.length}`);

    const violations = [];
    for (const { file, code } of modules) {
      for (const { pattern, label } of FORBIDDEN) {
        code.split('\n').forEach((line, index) => {
          if (pattern.test(line)) {
            violations.push(`${file}:${index + 1} uses ${label}`);
          }
        });
      }
    }
    assert.deepEqual(violations, []);
  });

  it('lets the shared core import only the shared core', async () => {
    const modules = await readModules(SHARED_DIRS);
    const violations = [];
    for (const { file, source } of modules) {
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) {
          violations.push(`${file} imports ${specifier}`);
        } else if (/\/ui\/|\/util\//.test(specifier)) {
          violations.push(`${file} imports ${specifier}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it('keeps the browser-only helpers out of the shared core', async () => {
    const names = (await listModules('web/js/util')).map((file) => path.basename(file));
    assert.deepEqual(names.sort(), ['storage.js']);
  });
});

describe('portability: relative paths only', () => {
  it('uses relative import specifiers everywhere in the site', async () => {
    const modules = await readModules(SITE_JS_DIRS);
    const violations = [];
    for (const { file, source } of modules) {
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        if (!match[1].startsWith('.')) {
          violations.push(`${file} imports ${match[1]}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it('references assets in the HTML relatively', async () => {
    const pages = ['web/index.html', 'web/404.html'];
    const violations = [];
    for (const page of pages) {
      const html = await fs.readFile(path.join(REPO_ROOT, page), 'utf8');
      for (const [, attribute, value] of html.matchAll(/\b(src|href)="([^"]+)"/g)) {
        if (value.startsWith('#') || value.startsWith('./') || value.startsWith('../')) {
          continue;
        }
        violations.push(`${page} ${attribute}="${value}"`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it('never fetches an absolute URL', async () => {
    const modules = await readModules(['web/js']);
    const violations = [];
    for (const { file, source } of modules) {
      for (const match of source.matchAll(/\bfetch(?:Impl)?\s*\(\s*(['"`])([^'"`]*)\1/g)) {
        violations.push(`${file} fetches ${match[2]}`);
      }
      if (/\bnew\s+URL\s*\(\s*['"`]http/.test(source)) {
        violations.push(`${file} builds an absolute URL`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it('keeps the configured data path relative', async () => {
    const config = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'web/config.json'), 'utf8'));
    assert.equal(config.data.url.startsWith('./'), true, config.data.url);
  });
});

describe('read-only site', () => {
  it('has no server-side code left', async () => {
    const entries = await fs.readdir(REPO_ROOT);
    assert.ok(!entries.includes('server'), 'the self-hosted backend must be gone');
  });

  it('never issues a write request or carries a token', async () => {
    const modules = await readModules(['web/js']);
    const violations = [];
    for (const { file, code } of modules) {
      if (/method\s*:\s*['"]?(POST|PUT|PATCH|DELETE)/i.test(code)) {
        violations.push(`${file} sends a write method`);
      }
      if (/\bAuthorization\b/.test(code) || /Bearer\s/.test(code)) {
        violations.push(`${file} mentions authentication`);
      }
      if (/\bXMLHttpRequest\b/.test(code)) {
        violations.push(`${file} uses XMLHttpRequest`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it('never writes to storage outside the cache helper', async () => {
    const modules = await readModules(['web/js']);
    const writers = modules
      .filter(({ code }) => /\.setItem\s*\(/.test(code))
      .map(({ file }) => file);
    assert.deepEqual(writers, ['web/js/util/storage.js']);
  });
});
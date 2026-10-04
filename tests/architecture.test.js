/**
 * Architecture guard: the shared core must stay free of DOM and Node APIs.
 *
 * The same modules are imported by the browser, by the Node backend
 * (server/lib/store.js) and by this test suite, which only works while they
 * remain pure. This test fails the moment someone reaches for `document`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_DIRS = ['web/js/core', 'web/js/data'];

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
 * @param {string} file
 * @returns {Promise<string>} File content.
 */
async function read(file) {
  return fs.readFile(file, 'utf8');
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>} Absolute paths of every .js file.
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
 * Blank out string literals and comments so the scan only looks at real code
 * (a doc comment may legitimately mention `localStorage`).
 *
 * @param {string} source
 * @returns {string}
 */
function stripLiteralsAndComments(source) {
  return (
    source
      // Comments first: they may contain quotes and backticks.
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
      .replace(/(\s)\/\/[^\n]*/g, '$1 ')
      // Then string literals, so their content is not mistaken for code.
      .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
      .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
      .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
  );
}

describe('shared core purity', () => {
  it('has no DOM or Node dependencies in web/js/core and web/js/data', async () => {
    const files = (await Promise.all(SHARED_DIRS.map(listModules))).flat();
    assert.ok(files.length >= 12, `expected to scan the shared modules, saw ${files.length}`);

    const violations = [];
    for (const file of files) {
      const source = stripLiteralsAndComments(await read(file));
      const lines = source.split('\n');
      for (const { pattern, label } of FORBIDDEN) {
        lines.forEach((line, index) => {
          if (pattern.test(line)) {
            violations.push(`${path.relative(REPO_ROOT, file)}:${index + 1} uses ${label}`);
          }
        });
      }
    }
    assert.deepEqual(violations, []);
  });

  it('only imports from the shared core (no ui/ or server/ dependency)', async () => {
    const files = (await Promise.all(SHARED_DIRS.map(listModules))).flat();
    const violations = [];
    for (const file of files) {
      const source = await read(file);
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports ${specifier}`);
        } else if (/\/ui\/|\/server\/|\/util\//.test(specifier)) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports ${specifier}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it('keeps the browser-only helpers out of the shared core', async () => {
    const utilFiles = await listModules('web/js/util');
    const names = utilFiles.map((file) => path.basename(file));
    assert.deepEqual(names.sort(), ['storage.js', 'timing.js']);
  });

  it('is actually reused by the backend', async () => {
    const store = await read(path.join(REPO_ROOT, 'server/lib/store.js'));
    assert.match(store, /from '\.\.\/\.\.\/web\/js\/core\/entry\.js'/);
    assert.match(store, /from '\.\.\/\.\.\/web\/js\/data\/source\.js'/);
  });
});
/**
 * Optional git integration: every write becomes one commit.
 *
 * That is what makes the self-hosted backend and the GitHub Pages site share
 * one history: the server edits web/data/entries.json, commits it, and (with
 * --git-push and a deploy key) the Pages site picks the change up.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Run a git command inside `cwd`.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
async function git(cwd, args) {
  try {
    const { stdout, stderr } = await run('git', ['-C', cwd, ...args], {
      timeout: 30_000,
      windowsHide: true,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const failure = /** @type {any} */ (error);
    return {
      ok: false,
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? failure.message ?? ''),
    };
  }
}

/**
 * Stage one file, commit it and optionally push.
 *
 * Failures are reported, never thrown: a git problem must not turn a saved
 * entry into an error for the user.
 *
 * @param {{cwd: string, file: string, message: string, push?: boolean}} options
 * @returns {Promise<{committed: boolean, pushed: boolean, detail: string}>}
 */
export async function commitFile(options) {
  const add = await git(options.cwd, ['add', '--', options.file]);
  if (!add.ok) {
    return { committed: false, pushed: false, detail: `git add 失败：${add.stderr.trim()}` };
  }
  const status = await git(options.cwd, ['status', '--porcelain', '--', options.file]);
  if (status.ok && status.stdout.trim() === '') {
    return { committed: false, pushed: false, detail: '文件没有变化，无需提交' };
  }
  const commit = await git(options.cwd, ['commit', '-m', options.message, '--', options.file]);
  if (!commit.ok) {
    return { committed: false, pushed: false, detail: `git commit 失败：${commit.stderr.trim()}` };
  }
  if (options.push !== true) {
    return { committed: true, pushed: false, detail: commit.stdout.trim().split('\n')[0] ?? '' };
  }
  const push = await git(options.cwd, ['push']);
  return {
    committed: true,
    pushed: push.ok,
    detail: push.ok ? '已推送到远端' : `git push 失败：${push.stderr.trim()}`,
  };
}

/**
 * @param {string} cwd
 * @returns {Promise<boolean>} True when `cwd` is inside a git work tree.
 */
export async function isGitRepository(cwd) {
  const result = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout.trim() === 'true';
}
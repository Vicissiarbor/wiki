/**
 * Error types shared by the browser frontend and the Node backend.
 *
 * The module is intentionally free of DOM and Node APIs so that both sides can
 * import it (see README.md, 目录结构).
 */

/**
 * A data problem that the user can act on: a malformed entry, a duplicate name,
 * a conflicting edit. Anything else is a bug and stays a plain Error.
 */
export class ValidationError extends Error {
  /**
   * @param {string} message Human readable summary.
   * @param {Array<{field?: string, code?: string, message: string}>} [issues] Per-field details.
   */
  constructor(message, issues = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }

  /** @returns {string} Single-line description including the first few issues. */
  describe() {
    if (this.issues.length === 0) {
      return this.message;
    }
    const details = this.issues
      .slice(0, 3)
      .map((issue) => (issue.field ? `${issue.field}: ${issue.message}` : issue.message))
      .join('; ');
    const rest = this.issues.length > 3 ? ` (+${this.issues.length - 3} more)` : '';
    return `${this.message} — ${details}${rest}`;
  }
}

/**
 * Raised when the remote store rejects a write because the client worked from a
 * stale snapshot. The caller reloads and lets the user redo the edit.
 */
export class ConflictError extends Error {
  /**
   * @param {string} message Human readable summary.
   * @param {{expected?: string, actual?: string}} [revisions] Revisions involved in the conflict.
   */
  constructor(message, revisions = {}) {
    super(message);
    this.name = 'ConflictError';
    this.expected = revisions.expected;
    this.actual = revisions.actual;
  }
}

/**
 * Raised when a data source cannot be reached or answers with a failing status.
 */
export class DataSourceError extends Error {
  /**
   * @param {string} message Human readable summary.
   * @param {{status?: number, url?: string, cause?: unknown, kind?: string}} [details] Diagnostics.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'DataSourceError';
    this.status = details.status;
    this.url = details.url;
    this.kind = details.kind ?? 'unknown';
    if (details.cause !== undefined) {
      this.cause = details.cause;
    }
  }
}

/**
 * @param {unknown} error
 * @returns {string} A message safe to display in the UI.
 */
export function describeError(error) {
  if (error instanceof ValidationError) {
    return error.describe();
  }
  if (error instanceof Error && typeof error.message === 'string' && error.message !== '') {
    return error.message;
  }
  return String(error);
}
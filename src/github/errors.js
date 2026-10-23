import { formatLocal as formatLocalTime } from '../core/time-zone.js';
// Errors the GitHub client raises on its own (A-4). Tools turn these into plain-language results (Batch B); none of
// them ever carries a token, a request body or any credential.

export class GithubClientError extends Error {
  /**
   * @param {'outside_scope'|'no_credentials'|'rate_limited'} code
   * @param {string} message plain words, safe to show to a person
   * @param {object} [details] machine-readable extras (for example `reset_at`, `reset_display`)
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GithubClientError';
    this.code = code;
    this.details = details;
  }
}

/** Kept under its old name so every caller keeps working: shows the time in the current person's zone (UTC when none chosen). */
export const formatLocal = formatLocalTime;
export const formatDenver = formatLocalTime;

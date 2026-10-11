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

const DENVER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
});

/** "Oct 10, 2026, 7:45 PM" in America/Denver, with the zone's current abbreviation (MST or MDT). */
export function formatDenver(date) {
  const d = date instanceof Date ? date : new Date(date);
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', timeZoneName: 'short' })
    .formatToParts(d).find((part) => part.type === 'timeZoneName')?.value || 'MT';
  return `${DENVER.format(d)} ${zone}`;
}

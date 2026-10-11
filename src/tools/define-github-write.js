// GitHub's flavour of the write layer (B-1): the request key, the plain handling of the client's own errors, and the
// rule that a write is attempted only through `githubFor` (the pinned, spaced, rate-aware client).
import { defineWrite } from '../core/write.js';
import { requestKey } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';
import { explainGithubError } from './errors.js';

export { explainGithubError };

/** GitHub answered "no" (a 4xx other than a timeout): the change definitely was not made. Transport errors and 5xx are uncertain. */
export function classifyGithubError(error) {
  if (error instanceof GithubClientError) return 'rejected'; // raised before any request was sent
  const status = error?.status;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'uncertain';
}

/** @param {Parameters<typeof defineWrite>[0]} spec same as `defineWrite`; the request key, error handling default to GitHub's. */
export function defineGithubWrite(spec) {
  return defineWrite({
    classifyError: classifyGithubError,
    explain: explainGithubError,
    requestKey: (ctx, args) => requestKey(ctx, spec.name, args),
    ...spec
  });
}

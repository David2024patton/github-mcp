// Shared helpers for read tools that call GitHub (D-1): one plain error path and a bounded retry for GitHub's "202, still computing".
import { githubFor } from '../github/client.js';
import { explainGithubError } from './errors.js';

const ownerOf = (args, ctx) => String(args.owner ?? ctx.connection.default_account);

/** The Octokit for the named (or default) account, with a failure turned into the plain sentence a caller can read. */
export async function readerFor(args, ctx) {
  try { return { owner: ownerOf(args, ctx), octokit: await githubFor(ctx, { owner: ownerOf(args, ctx) }) }; } catch (error) { throw new TypeError(explainGithubError(error)); }
}

/** Runs a GitHub read; any failure becomes a TypeError holding the plain explanation (the dispatcher shows TypeErrors as they are). */
export async function plain(run) {
  try { return await run(); } catch (error) { if (error instanceof TypeError) throw error; throw new TypeError(explainGithubError(error)); }
}

/**
 * GitHub answers 202 with an empty body while it computes statistics. Ask again (at most `tries` times, `waitMs` apart, inside the
 * overall budget) and return `{ computing: true }` when it is still not ready.
 */
export async function requestStats(octokit, route, params, { tries = 3, waitMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    const response = await octokit.request(route, params);
    if (response.status !== 202) return { computing: false, data: response.data };
    if (attempt < tries) await sleep(waitMs * attempt);
  }
  return { computing: true, data: null };
}

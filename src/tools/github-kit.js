// Small helpers the area tools (Batch D onward) share: the client for one account, "missing is not an error" reads, the standard
// owner/repo arguments and the plain refusal for a thing that cannot be done. Nothing here builds a URL: GitHub is reached only
// through `githubFor` with route strings.
import { githubFor } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';

export const OWNER = { type: 'string', maxLength: 39, description: 'Account (default: the connection\'s default account)' };
export const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$', description: 'Repository name' };
export const REPO_ARGS = { owner: OWNER, repo: REPO };
export const REF = { type: 'string', minLength: 1, maxLength: 255, description: 'Branch, tag or commit SHA' };

/** The account a call acts as: the argument, else the connection's default. */
export const ownerOf = (args, ctx) => args.owner ?? ctx.connection.default_account;

/** The client for the account named in the arguments. `cred` is I (installation, default) or U (the owner's sign-in). */
export const clientFor = (ctx, args, cred = 'I') => githubFor(ctx, { owner: ownerOf(args, ctx), cred });

/** One request; returns GitHub's body. */
export async function call(ctx, args, route, params, cred = 'I') {
  const octokit = await clientFor(ctx, args, cred);
  return (await octokit.request(route, params)).data;
}

/** Same, but a 404 answers `null` (the thing does not exist) instead of failing. Anything else still fails. */
export async function callOrNull(ctx, args, route, params, cred = 'I') {
  try { return await call(ctx, args, route, params, cred); } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

/** A refusal GitHub did not make but this server did, in plain words (counts as "definitely not done"). */
export const refuse = (message, details = {}) => new GithubClientError('refused', message, details);

export const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

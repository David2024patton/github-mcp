// GitHub flavour of the write contract (B-1): the same `defineWrite`, with GitHub's request key and a ready `ctx.github()`.
// The hooks receive `ctx.github({ owner, scope })`, an Octokit for the account that is not shared between requests (A9).
import { defineWrite } from '../core/write.js';
import { githubFor, requestKey } from '../github/client.js';

/**
 * Same spec as `defineWrite`. `cred` defaults to the App installation token ('I'). The returned handler takes the shared
 * server context `{ connection, db, credentials, fetch?, now?, guards? }`.
 */
export function defineGithubWrite(spec) {
  const cred = spec.cred ?? 'I';
  const { tool, handler } = defineWrite({ ...spec, cred, requestKey });
  return {
    tool,
    handler: (args, ctx) => handler(args, {
      ...ctx,
      requestKey: ctx.requestKey ?? requestKey,
      github: (options = {}) => githubFor(ctx, { owner: options.owner ?? args?.owner, cred, ...options })
    })
  };
}

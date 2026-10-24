// ENT-1: who may act on which GitHub Enterprise. Enterprise tools use the person's master token (credential M, the
// person's own login, not an App installation) and only for enterprises the person administers. Nothing is sent to
// GitHub for an enterprise that is not in that list. The master token is refused for read-only connections and passes by
// `credentialFor`, so this module never has to check that again.
import { githubFor, graphql } from './client.js';
import { refusal } from '../tools/github-write.js';
import { scopeCovered } from './personal-cred.js';

export const ENTERPRISE_SLUG = { type: 'string', minLength: 1, maxLength: 60, pattern: '^[a-z0-9][a-z0-9-]{0,59}$', description: 'Enterprise slug (from github_enterprise_list)' };
const NEED_MASTER = 'Add your master token with enterprise permissions (My connection → Add or replace master token → include enterprise permissions). Enterprise tools use only that token.';

const ADMIN_QUERY = 'query { viewer { enterprises(first: 20, membershipType: ADMIN) { nodes { slug name } } } }';

/** The client for enterprise calls: always the master token. The connected account only names the write slot. */
export async function enterpriseClient(ctx) {
  const status = typeof ctx.credentials?.masterStatus === 'function' ? await ctx.credentials.masterStatus().catch(() => null) : null;
  if (status?.enrolled !== true) throw refusal(NEED_MASTER);
  return githubFor(ctx, { owner: ctx.connection.default_account, cred: 'M' });
}

/** [{ slug, name }] for the enterprises the signed-in person administers. */
export async function adminEnterprises(ctx) {
  const gh = await enterpriseClient(ctx);
  const data = await graphql(gh, ADMIN_QUERY);
  return (data?.viewer?.enterprises?.nodes ?? []).filter((n) => n?.slug).map((n) => ({ slug: n.slug, name: n.name ?? n.slug }));
}

/** Refuses unless `slug` is an enterprise the person administers; returns the client built with the master token. */
export async function requireEnterprise(ctx, slug, { scope = 'read:enterprise' } = {}) {
  const gh = await enterpriseClient(ctx);
  const status = await ctx.credentials.masterStatus().catch(() => null);
  if (!scopeCovered(status?.scopes ?? [], scope))
    throw refusal(`Your master token does not have the "${scope}" permission. ${NEED_MASTER}`);
  const mine = (await graphql(gh, ADMIN_QUERY))?.viewer?.enterprises?.nodes ?? [];
  if (!mine.some((n) => n?.slug === slug))
    throw refusal(`"${slug}" is not an enterprise you administer. Ask for github_enterprise_list to see yours.`);
  return gh;
}

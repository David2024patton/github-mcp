// Secret changes (G-3 part 2). A secret's value never passes through a tool: no argument takes one and no result returns one.
// `github_secret_set` either records a request for Chris to type the value on the private setup page (the default; a link is
// returned), or has the server make a random value, seal it with the place's public key and send it. Listing is in variables.js.
import { randomBytes } from 'node:crypto';
import { defineGithubWrite } from './define-github-write.js';
import { OUTSIDE_PROJECT } from './protect-guard.js';
import { missing, octo, refusal } from './github-write.js';
import { place, secretCred, targetOf } from './variables.js';
import { productionReason } from './production-guard.js';
import { publicOrigin } from '../core/http.js';
import { SECRET_KINDS, generateSecretValue, putSecret, secretRoutes } from '../github/secret-seal.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, description: 'Leave out for an organization-level secret' };
const ENVIRONMENT = { type: 'string', minLength: 1, maxLength: 100, description: 'With repo: an environment\'s own secrets (Actions only)' };
const LEVEL = { type: 'string', enum: ['user'], description: 'user = your own personal Codespaces secrets (kind codespaces; leave out repo)' };
const KIND = { type: 'string', enum: SECRET_KINDS, description: 'Default actions' };
const NAME = { type: 'string', minLength: 1, maxLength: 100, pattern: '^(?![Gg][Ii][Tt][Hh][Uu][Bb]_)[A-Za-z_][A-Za-z0-9_]*$', description: 'Letters, digits and underscores; GitHub refuses names starting with GITHUB_' };
const PENDING_MINUTES = 30;

function scopeOf(args, ctx) {
  const pl = place(args, ctx);
  if (/^github_/i.test(args.name)) throw new TypeError('GitHub does not allow secret names that start with GITHUB_.');
  const scope = { kind: args.kind ?? 'actions', level: pl.level, owner: pl.owner, ...(pl.repo ? { repo: pl.repo } : {}), ...(pl.environment ? { environment: pl.environment } : {}), name: args.name };
  secretRoutes(scope); // refuses a kind with no environment level
  return { pl, scope };
}
const where = ({ pl, scope }) => `${scope.kind} secret in ${pl.label}`;
// The client for a secret's place. A personal Codespaces secret needs the master token; without it say so plainly.
const clientFor = async (ctx, scope) => {
  const cred = await secretCred(ctx, scope.kind);
  if (scope.level === 'user' && cred !== 'M') throw refusal(NEEDS_MASTER, 403);
  return octo(ctx, scope.owner, cred);
};
const NEEDS_MASTER = 'Your personal Codespaces secrets need your master token with the codespace permission; add it on the My connection page.';
// Preview reads must not throw (a failed read is treated as production), so a missing master token is reported as a plain flag.
const needsMaster = async (ctx, scope) => scope.level === 'user' && (await secretCred(ctx, scope.kind)) !== 'M';
const getMeta = (ctx, scope) => missing(async () => {
  const routes = secretRoutes(scope);
  const data = (await (await clientFor(ctx, scope)).request(`GET ${routes.one}`, { ...routes.params, secret_name: scope.name })).data;
  return { name: data.name, updated_at: data.updated_at, ...(data.visibility ? { visibility: data.visibility } : {}) };
});
const setupUrl = (ctx) => { try { return `${publicOrigin(ctx.env)}/api/github/setup`; } catch { return '/api/github/setup'; } };

const secretSet = defineGithubWrite({
  name: 'github_secret_set', area: 'secret', audience: ['B', 'O'],
  description: 'Create or replace a secret. You never send the value: Chris types it on his setup page (link returned), or the server generates one.',
  properties: { owner: OWNER, repo: REPO, environment: ENVIRONMENT, level: LEVEL, kind: KIND, name: NAME,
    valueFrom: { type: 'string', enum: ['setup-page', 'generate'], description: 'setup-page (default): Chris types the value. generate: a random value nobody sees, for secrets only GitHub Actions needs' },
    bytes: { type: 'integer', minimum: 16, maximum: 64, description: 'With generate: size of the random value (default 32)' },
    visibility: { type: 'string', enum: ['all', 'private', 'selected'], description: 'Organization secrets only (default private)' },
    selectedRepositoryIds: { type: 'array', maxItems: 100, items: { type: 'integer', minimum: 1 }, description: 'With visibility selected' }, ...OUTSIDE_PROJECT },
  required: ['name'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => targetOf(place(args, ctx)),
  read: async (args, ctx) => { const { scope } = scopeOf(args, ctx); return (await needsMaster(ctx, scope)) ? { current: null, needsMaster: true } : { current: await getMeta(ctx, scope) }; },
  classify: ({ ctx, target }) => productionReason(ctx, target).then((production) => ({ production })),
  summarize: ({ args, ctx, before }) => {
    if (before.needsMaster) return NEEDS_MASTER;
    const s = scopeOf(args, ctx);
    return `${before.current ? 'Replace' : 'Create'} ${where(s)} ${args.name}${args.valueFrom === 'generate' ? ' with a random value only GitHub will hold' : ' — you will type the value on the private setup page'}`;
  },
  apply: async ({ args, ctx, before }) => {
    const { pl, scope } = scopeOf(args, ctx);
    if (before.needsMaster) throw refusal(NEEDS_MASTER, 403);
    if ((args.visibility || args.selectedRepositoryIds) && pl.level !== 'org') throw refusal('Visibility only applies to organization secrets.');
    if (args.visibility === 'selected' && !args.selectedRepositoryIds?.length) throw refusal('Visibility "selected" needs selectedRepositoryIds.');
    const options = { visibility: args.visibility, selectedRepositoryIds: args.selectedRepositoryIds };
    if (args.valueFrom === 'generate') {
      await putSecret(await clientFor(ctx, scope), scope, generateSecretValue(args.bytes), options);
      return { mode: 'generate' };
    }
    const id = randomBytes(32).toString('base64url');
    await ctx.db.createSecretRequest({ id, account: pl.owner, scope: { ...scope, ...(pl.level === 'org' ? options : {}) }, connection: ctx.connection.client_id, ttlSeconds: PENDING_MINUTES * 60 });
    return { mode: 'setup-page', id };
  },
  readAfter: async ({ args, ctx, response }) => (response.mode === 'generate'
    ? { mode: 'generate', meta: await getMeta(ctx, scopeOf(args, ctx).scope) }
    : { mode: 'setup-page', pending: (await ctx.db.getSecretRequest(response.id)) !== null }),
  verify: ({ before, after }) => (after.mode === 'generate' ? !!after.meta && (!before.current || after.meta.updated_at !== before.current.updated_at) : after.pending),
  present: ({ ctx, after, response }) => (after.mode === 'generate'
    ? { secret: 'created with a random value; nobody, including Claude, can read it', updated_at: after.meta?.updated_at }
    : { next_step: `Open ${setupUrl(ctx)}?secret=${response.id} and type the value with your passphrase within ${PENDING_MINUTES} minutes. Claude never sees it.`, expires_in_minutes: PENDING_MINUTES })
});

const secretDelete = defineGithubWrite({
  name: 'github_secret_delete', area: 'secret', audience: ['B', 'O'],
  description: 'Delete a secret. Its value cannot be put back (GitHub never shows it), so this cannot be undone.',
  properties: { owner: OWNER, repo: REPO, environment: ENVIRONMENT, level: LEVEL, kind: KIND, name: NAME, ...OUTSIDE_PROJECT }, required: ['name'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => targetOf(place(args, ctx)),
  read: async (args, ctx) => { const { scope } = scopeOf(args, ctx); return (await needsMaster(ctx, scope)) ? { current: null, needsMaster: true } : { current: await getMeta(ctx, scope) }; },
  classify: ({ ctx, target }) => productionReason(ctx, target).then((production) => ({ production })),
  summarize: ({ args, ctx, before }) => (before.needsMaster ? NEEDS_MASTER : before.current ? `Delete ${where(scopeOf(args, ctx))} ${args.name}. The value cannot be recovered` : `There is no ${where(scopeOf(args, ctx))} called ${args.name}`),
  apply: async ({ args, ctx, before }) => {
    if (before.needsMaster) throw refusal(NEEDS_MASTER, 403);
    if (!before.current) throw refusal(`There is no secret ${args.name}.`, 404);
    const { scope } = scopeOf(args, ctx);
    const routes = secretRoutes(scope);
    return (await clientFor(ctx, scope)).request(`DELETE ${routes.one}`, { ...routes.params, secret_name: scope.name });
  },
  readAfter: async ({ args, ctx }) => ((await getMeta(ctx, scopeOf(args, ctx).scope)) === null ? 'gone' : 'still there'),
  verify: ({ after }) => after === 'gone',
  present: ({ args }) => ({ deleted: args.name })
});

const reposOf = async (octokit, scope) => {
  const routes = secretRoutes(scope);
  const data = (await octokit.request(`GET ${routes.repositories}`, { ...routes.params, secret_name: scope.name, per_page: 100 })).data;
  return (data.repositories ?? []).map((r) => ({ id: r.id, name: r.full_name }));
};

const secretSetRepoAccess = defineGithubWrite({
  name: 'github_secret_set_repo_access', area: 'secret', audience: ['O'],
  description: 'Choose which repositories may use an organization secret or (level user) a personal Codespaces secret already limited to selected repositories.',
  properties: { owner: OWNER, level: LEVEL, kind: KIND, name: NAME, repositoryIds: { type: 'array', maxItems: 100, items: { type: 'integer', minimum: 1 }, description: 'The full list; repositories not listed lose access' }, ...OUTSIDE_PROJECT },
  required: ['name', 'repositoryIds'],
  declarations: { production: 'always', accessWidening: true, confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => targetOf(place({ owner: args.owner, level: args.level, kind: args.kind }, ctx)),
  read: async (args, ctx) => {
    const { scope } = scopeOf({ ...args, owner: args.owner }, ctx);
    const meta = await getMeta(ctx, scope);
    return { meta, repos: meta?.visibility === 'selected' ? await reposOf(await clientFor(ctx, scope), scope) : [] };
  },
  classify: ({ args, before }) => {
    const have = new Set(before.repos.map((r) => r.id));
    const added = args.repositoryIds.filter((id) => !have.has(id));
    return { production: 'it changes which repositories can use an organization secret', ...(added.length ? { accessWidening: `${added.length} more repositor${added.length === 1 ? 'y' : 'ies'} could read this secret's value in their workflows` } : {}) };
  },
  summarize: ({ args, before }) => (!before.meta ? `There is no organization secret ${args.name}`
    : before.meta.visibility !== 'selected' ? `${args.name} is available to "${before.meta.visibility}" repositories, not a chosen list, so its list cannot be set`
    : `Set the repositories that can use ${args.name} to ${args.repositoryIds.length} (now ${before.repos.length})`),
  apply: async ({ args, ctx, before }) => {
    if (!before.meta) throw refusal(`There is no organization secret ${args.name}.`, 404);
    if (before.meta.visibility !== 'selected') throw refusal(`${args.name} is not limited to selected repositories; set its visibility to selected first.`);
    const { scope } = scopeOf({ ...args, owner: args.owner }, ctx);
    const routes = secretRoutes(scope);
    return (await clientFor(ctx, scope)).request(`PUT ${routes.repositories}`, { ...routes.params, secret_name: scope.name, selected_repository_ids: args.repositoryIds });
  },
  readAfter: async ({ args, ctx }) => { const { scope } = scopeOf({ ...args, owner: args.owner }, ctx); return (await reposOf(await clientFor(ctx, scope), scope)).map((r) => r.id).sort((a, b) => a - b); },
  verify: ({ args, after }) => JSON.stringify(after) === JSON.stringify([...new Set(args.repositoryIds)].sort((a, b) => a - b)),
  inverse: ({ args, before }) => (before.meta ? { tool: 'github_secret_set_repo_access', args: { ...(args.owner ? { owner: args.owner } : {}), ...(args.kind ? { kind: args.kind } : {}), name: args.name, repositoryIds: before.repos.map((r) => r.id) } } : null),
  present: ({ after }) => ({ repository_ids: after })
});

const writes = [secretSet, secretDelete, secretSetRepoAccess];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));

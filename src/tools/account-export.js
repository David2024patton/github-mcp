// GOD-4 C: export your OWN GitHub account's data (repositories, issues, pull requests...) as an archive, using the master token
// when added (else the App user sign-in). The archive holds private data: the link tool only returns GitHub's short-lived
// download address and never fetches or relays the archive. Repositories are never locked.
import { defineGithubWrite } from './define-github-write.js';
import { defineRead } from './define-read.js';
import { missing, octo, refusal } from './github-write.js';
import { plain } from './github-read.js';
import { personalCred } from '../github/personal-cred.js';

const ID = { type: 'integer', minimum: 1 };
const REPO_NAME = { type: 'string', minLength: 1, maxLength: 140, pattern: '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$' };
const STARTED = ['pending', 'exporting', 'exported'];
const userTarget = (ctx) => ({ owner: ctx.connection.default_account, scope: 'org', kind: 'account-export' });
const client = async (ctx) => octo(ctx, ctx.connection.default_account, await personalCred(ctx, 'repo'));
const view = (m) => ({ id: m.id, state: m.state, lock_repositories: !!m.lock_repositories, repositories: (m.repositories ?? []).map((r) => r.full_name ?? r.name).slice(0, 100), created_at: m.created_at, updated_at: m.updated_at });
const getOne = (ctx, id) => missing(async () => view((await (await client(ctx)).request('GET /user/migrations/{migration_id}', { migration_id: id })).data));

const exportStart = defineGithubWrite({
  name: 'github_account_export_start', area: 'account', audience: ['B', 'O'],
  description: 'Start exporting your own account\'s repositories to a downloadable archive (private data!). Repositories are never locked.',
  properties: { repositories: { type: 'array', items: REPO_NAME, minItems: 1, maxItems: 100, description: 'Repositories to include, as owner/name (a bare name means one of yours)' },
    excludeAttachments: { type: 'boolean' }, excludeReleases: { type: 'boolean' }, excludeMetadata: { type: 'boolean' }, excludeGitData: { type: 'boolean' } },
  required: ['repositories'],
  declarations: { production: 'always', confirm: 'always', cred: 'U', profiles: ['full'] },
  target: (args, ctx) => userTarget(ctx),
  read: async (args, ctx) => ({ running: ((await (await client(ctx)).request('GET /user/migrations', { per_page: 30 })).data ?? []).filter((m) => ['pending', 'exporting'].includes(m.state)).map((m) => m.id) }),
  classify: () => ({}),
  summarize: ({ args, before }) => (before.running.length ? `An account export is already running (${before.running.join(', ')}); a new one will not be started`
    : `Export ${args.repositories.length} of your repositories to a downloadable archive. Repositories stay writable. The archive holds private code and data.`),
  apply: async ({ args, ctx, before }) => {
    if (before.running.length) throw refusal('An export is already running; wait for it to finish.');
    const gh = await client(ctx);
    const login = (await gh.request('GET /user')).data?.login;
    if (!login) throw refusal('Your account name could not be read; nothing was sent.');
    const repositories = args.repositories.map((r) => (r.includes('/') ? r : `${login}/${r}`));
    return gh.request('POST /user/migrations', { repositories, lock_repositories: false,
      ...(args.excludeAttachments !== undefined ? { exclude_attachments: args.excludeAttachments } : {}), ...(args.excludeReleases !== undefined ? { exclude_releases: args.excludeReleases } : {}),
      ...(args.excludeMetadata !== undefined ? { exclude_metadata: args.excludeMetadata } : {}), ...(args.excludeGitData !== undefined ? { exclude_git_data: args.excludeGitData } : {}) });
  },
  readAfter: async ({ ctx, response }) => getOne(ctx, response.data.id),
  verify: ({ after }) => !!after && STARTED.includes(after.state),
  inverse: () => null,
  present: ({ after }) => ({ export: after, next: 'Check github_account_export_status; when exported, github_account_export_link gives a private download address.' })
});

const exportStatus = defineRead({
  name: 'github_account_export_status', area: 'account', audience: ['B', 'O'],
  description: 'Your account exports: state of one (pending, exporting, exported, failed), or the recent list when no id is given.',
  properties: { migrationId: ID }, required: [],
  handler: (args, ctx) => plain(async () => {
    const gh = await client(ctx);
    if (args.migrationId === undefined) return { exports: ((await gh.request('GET /user/migrations', { per_page: 30 })).data ?? []).map(view) };
    return view((await gh.request('GET /user/migrations/{migration_id}', { migration_id: args.migrationId })).data);
  })
});

const exportLink = defineRead({
  name: 'github_account_export_link', area: 'account', audience: ['B', 'O'],
  description: 'The short-lived private download address of a finished account export. The archive is NOT downloaded here.',
  properties: { migrationId: ID }, required: ['migrationId'],
  guidance: 'The address gives access to private data: show it only to the account owner, never post it anywhere.',
  handler: (args, ctx) => plain(async () => {
    const gh = await client(ctx);
    const m = (await gh.request('GET /user/migrations/{migration_id}', { migration_id: args.migrationId })).data;
    if (m.state !== 'exported') return { ...view(m), link: null, note: `The export is "${m.state}", not ready yet.` };
    const response = await gh.request('GET /user/migrations/{migration_id}/archive', { migration_id: args.migrationId, request: { redirect: 'manual' } });
    const url = response.headers?.location;
    if (!url) throw new TypeError('GitHub did not return a download address for that export.');
    return { id: m.id, state: m.state, sensitive: true, link: url, note: 'Private, short-lived address to your account data. This server did not download the archive.' };
  })
});

const exportDelete = defineGithubWrite({
  name: 'github_account_export_delete', area: 'account', audience: ['B', 'O'],
  description: 'Delete a finished account export archive from GitHub (the export record stays). Cannot be undone.',
  properties: { migrationId: ID }, required: ['migrationId'],
  declarations: { production: 'always', confirm: 'always', cred: 'U', profiles: ['full'] },
  target: (args, ctx) => userTarget(ctx),
  read: async (args, ctx) => ({ current: await getOne(ctx, args.migrationId), available: await archiveThere(ctx, args.migrationId) }),
  classify: () => ({}),
  summarize: ({ args, before }) => (!before.current ? `There is no export ${args.migrationId}` : !before.available ? `The archive of export ${args.migrationId} is already gone` : `Delete the archive of export ${args.migrationId}. It cannot be recreated; you would start a new export.`),
  apply: async ({ args, ctx, before }) => {
    if (!before.current) throw refusal(`There is no export ${args.migrationId}.`, 404);
    if (!before.available) throw refusal('The archive is already gone; nothing to delete.');
    return (await client(ctx)).request('DELETE /user/migrations/{migration_id}/archive', { migration_id: args.migrationId });
  },
  readAfter: async ({ args, ctx }) => ({ available: await archiveThere(ctx, args.migrationId) }),
  verify: ({ after }) => after.available === false,
  inverse: () => null,
  present: ({ args }) => ({ deleted_archive_of: args.migrationId })
});

// The archive exists when asking for it answers a redirect; 404/410 means gone.
async function archiveThere(ctx, id) {
  try {
    const r = await (await client(ctx)).request('GET /user/migrations/{migration_id}/archive', { migration_id: id, request: { redirect: 'manual' } });
    return !!r.headers?.location;
  } catch (e) {
    if (e?.status === 404 || e?.status === 410) return false;
    throw e;
  }
}

const reads = [exportStatus, exportLink];
const writes = [exportStart, exportDelete];
export const tools = [...reads, ...writes].map((d) => d.tool);
export const handlers = Object.fromEntries([...reads, ...writes].map((d) => [d.tool.name, d.handler]));

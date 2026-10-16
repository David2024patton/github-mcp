// Y-9a: organization administration long tail — security managers, hosted-compute network configurations, organization migrations.
// All are organization-level, so each is production-class and needs a confirmation. `github_credential_report_leak` is NOT built: that
// endpoint receives the secret itself, and no secret passes through a tool (docs/DECISIONS.md 2026-10-16).
import { defineGithubWrite } from './define-github-write.js';
import { defineRead } from './define-read.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { plain, readerFor } from './github-read.js';
import { accessChange } from './people-guard.js';

const OWNER = { type: 'string', maxLength: 39, description: 'Organization (default: the connection\'s default account)' };
const SLUG = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' };
const orgTarget = (kind) => (args, ctx) => ({ owner: ownerOf(args, ctx), scope: 'org', kind });
const NO_PLAN = 'This organization\'s plan does not include hosted compute network configurations (not_available_on_plan). They need GitHub Enterprise Cloud.';
const onPlan = async (run) => { try { return await run(); } catch (error) { if (error?.status === 403 || error?.status === 404) throw Object.assign(new Error(NO_PLAN), { status: 422 }); throw error; } };

// ---- security managers ----
const managers = (gh, owner) => gh.request('GET /orgs/{org}/security-managers', { org: owner }).then((r) => r.data.map((t) => t.slug));

const securityManager = defineGithubWrite({
  name: 'github_org_security_manager_set', area: 'org', audience: ['O'],
  description: 'Give a team the organization security manager role, or take it away. The role reads and manages security alerts everywhere.',
  properties: { owner: OWNER, teamSlug: SLUG, enabled: { type: 'boolean', description: 'true to add the role, false to remove it' } }, required: ['teamSlug', 'enabled'],
  declarations: { production: 'always', confirm: 'always', accessWidening: true, profiles: ['full'] },
  target: orgTarget('org-security-manager'),
  read: async (args, ctx, t) => ({ managers: await managers(await octo(ctx, t.owner), t.owner) }),
  classify: ({ args, target: t, before }) => (before.managers.includes(args.teamSlug) === args.enabled || !args.enabled ? {}
    : accessChange({ who: `team ${args.teamSlug}`, access: 'security manager', where: t.owner, before: 'none' })),
  summarize: ({ args, target: t, before }) => {
    const has = before.managers.includes(args.teamSlug);
    if (has === args.enabled) return `Team ${args.teamSlug} ${has ? 'already has' : 'does not have'} the security manager role in ${t.owner}; nothing to do`;
    return args.enabled ? `Give team ${args.teamSlug} the security manager role in ${t.owner} (it can read and manage security alerts on every repository)` : `Remove the security manager role from team ${args.teamSlug} in ${t.owner}`;
  },
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.managers.includes(args.teamSlug) === args.enabled) throw refusal(`Nothing to do: the role is already ${args.enabled ? 'set' : 'absent'}.`);
    const gh = await octo(ctx, t.owner);
    return gh.request(args.enabled ? 'PUT /orgs/{org}/security-managers/teams/{team_slug}' : 'DELETE /orgs/{org}/security-managers/teams/{team_slug}', { org: t.owner, team_slug: args.teamSlug });
  },
  readAfter: async ({ ctx, target: t }) => ({ managers: await managers(await octo(ctx, t.owner), t.owner) }),
  verify: ({ args, after }) => after.managers.includes(args.teamSlug) === args.enabled,
  inverse: ({ args, target: t }) => ({ tool: 'github_org_security_manager_set', args: { owner: t.owner, teamSlug: args.teamSlug, enabled: !args.enabled } }),
  present: ({ args, after }) => ({ team: args.teamSlug, security_manager: args.enabled, managers: after.managers })
});

// ---- hosted compute network configurations ----
const shapeConfig = (c) => ({ id: c.id, name: c.name, compute_service: c.compute_service, network_settings_ids: c.network_settings_ids ?? [], failover_enabled: !!c.failover_network_enabled, failover_network_settings_ids: c.failover_network_settings_ids ?? [], created_on: c.created_on ?? null });
const listConfigs = (gh, org) => onPlan(async () => (await gh.request('GET /orgs/{org}/settings/network-configurations', { org })).data.network_configurations.map(shapeConfig));

const networkList = defineRead({
  name: 'github_org_network_config_list', area: 'org', audience: ['O', 'Op'],
  description: 'List an organization\'s hosted-compute network configurations (Enterprise Cloud only).',
  properties: { owner: OWNER }, required: [],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const items = await listConfigs(octokit, owner);
    return { count: items.length, items };
  })
});

const networkSave = defineGithubWrite({
  name: 'github_org_network_config_save', area: 'org', audience: ['O'],
  description: 'Create or edit a hosted-compute network configuration (Enterprise Cloud only; the network settings ids come from Azure).',
  properties: { owner: OWNER, configurationId: { type: 'string', maxLength: 64, description: 'Leave out to create a new configuration' }, name: { type: 'string', minLength: 1, maxLength: 100 },
    computeService: { type: 'string', enum: ['none', 'actions'] }, networkSettingsIds: { type: 'array', items: { type: 'string', maxLength: 128 }, minItems: 1, maxItems: 1 },
    failoverNetworkSettingsIds: { type: 'array', items: { type: 'string', maxLength: 128 }, maxItems: 1 }, failoverNetworkEnabled: { type: 'boolean' } }, required: [],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: orgTarget('org-network-config'),
  read: async (args, ctx, t) => ({ items: await listConfigs(await octo(ctx, t.owner), t.owner) }),
  classify: () => ({}),
  summarize: ({ args, target: t, before }) => {
    const existing = args.configurationId ? before.items.find((c) => c.id === args.configurationId) : null;
    if (args.configurationId && !existing) return `Network configuration ${args.configurationId} was not found in ${t.owner}; nothing will be changed`;
    return existing ? `Edit network configuration "${existing.name}" of ${t.owner}` : `Create network configuration "${args.name}" in ${t.owner}`;
  },
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    const body = { ...(args.name ? { name: args.name } : {}), ...(args.computeService ? { compute_service: args.computeService } : {}), ...(args.networkSettingsIds ? { network_settings_ids: args.networkSettingsIds } : {}),
      ...(args.failoverNetworkSettingsIds ? { failover_network_settings_ids: args.failoverNetworkSettingsIds } : {}), ...(args.failoverNetworkEnabled !== undefined ? { failover_network_enabled: args.failoverNetworkEnabled } : {}) };
    if (args.configurationId) {
      if (!before.items.find((c) => c.id === args.configurationId)) throw refusal('That network configuration was not found.', 404);
      if (!Object.keys(body).length) throw refusal('Nothing to change: give at least one field.');
      return onPlan(() => gh.request('PATCH /orgs/{org}/settings/network-configurations/{network_configuration_id}', { org: t.owner, network_configuration_id: args.configurationId, ...body }));
    }
    if (!args.name || !args.networkSettingsIds) throw refusal('To create one, give a name and the network settings id.');
    return onPlan(() => gh.request('POST /orgs/{org}/settings/network-configurations', { org: t.owner, ...body }));
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    const id = args.configurationId ?? response?.data?.id;
    return (await listConfigs(await octo(ctx, t.owner), t.owner)).find((c) => c.id === id) ?? null;
  },
  verify: ({ args, after }) => !!after && (!args.name || after.name === args.name) && (!args.computeService || after.compute_service === args.computeService)
    && (args.failoverNetworkEnabled === undefined || after.failover_enabled === args.failoverNetworkEnabled),
  inverse: () => null,
  present: ({ after }) => ({ configuration: after })
});

// ---- organization migrations (export) ----
const STARTED = ['pending', 'exporting', 'exported'];
const migrationView = (m) => ({ id: m.id, state: m.state, lock_repositories: !!m.lock_repositories, repositories: (m.repositories ?? []).map((r) => r.full_name ?? r.name).slice(0, 100), created_at: m.created_at, updated_at: m.updated_at });

const migrationStart = defineGithubWrite({
  name: 'github_org_migration_start', area: 'org', audience: ['O'],
  description: 'Start exporting organization repositories to an archive (private data!). Locking repositories makes them read-only; it is off unless you ask.',
  properties: { owner: OWNER, repositories: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, minItems: 1, maxItems: 100 }, lockRepositories: { type: 'boolean', description: 'Make the repositories read-only during export (default false)' },
    excludeAttachments: { type: 'boolean' }, excludeReleases: { type: 'boolean' }, excludeMetadata: { type: 'boolean' }, excludeGitData: { type: 'boolean' }, orgMetadataOnly: { type: 'boolean' } }, required: ['repositories'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: orgTarget('org-migration'),
  read: async (args, ctx, t) => ({ running: (await (await octo(ctx, t.owner)).request('GET /orgs/{org}/migrations', { org: t.owner })).data.filter((m) => ['pending', 'exporting'].includes(m.state)).map((m) => m.id) }),
  classify: () => ({}),
  summarize: ({ args, target: t, before }) => (before.running.length ? `A migration is already running in ${t.owner} (${before.running.join(', ')}); a new one will not be started`
    : `Export ${args.repositories.length} repositories of ${t.owner} to a downloadable archive${args.lockRepositories ? ' and LOCK them read-only until you unlock them' : ' (repositories stay writable)'}. The archive holds private code and data.`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.running.length) throw refusal('A migration is already running; wait for it to finish.');
    return (await octo(ctx, t.owner)).request('POST /orgs/{org}/migrations', { org: t.owner, repositories: args.repositories, lock_repositories: args.lockRepositories === true,
      ...(args.excludeAttachments !== undefined ? { exclude_attachments: args.excludeAttachments } : {}), ...(args.excludeReleases !== undefined ? { exclude_releases: args.excludeReleases } : {}),
      ...(args.excludeMetadata !== undefined ? { exclude_metadata: args.excludeMetadata } : {}), ...(args.excludeGitData !== undefined ? { exclude_git_data: args.excludeGitData } : {}),
      ...(args.orgMetadataOnly !== undefined ? { org_metadata_only: args.orgMetadataOnly } : {}) });
  },
  readAfter: async ({ ctx, target: t, response }) => missing(async () => migrationView((await (await octo(ctx, t.owner)).request('GET /orgs/{org}/migrations/{migration_id}', { org: t.owner, migration_id: response.data.id })).data)),
  verify: ({ after }) => !!after && STARTED.includes(after.state),
  inverse: () => null,
  present: ({ after }) => ({ migration: after, next: 'Check github_org_migration_status. Download the archive in the browser (Settings → Migrations); this server does not fetch it.' })
});

const migrationStatus = defineRead({
  name: 'github_org_migration_status', area: 'org', audience: ['O', 'Op'],
  description: 'State of an organization migration (pending, exporting, exported, failed) and where to download the finished archive.',
  properties: { owner: OWNER, migrationId: { type: 'integer', minimum: 1 } }, required: ['migrationId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const m = (await octokit.request('GET /orgs/{org}/migrations/{migration_id}', { org: owner, migration_id: args.migrationId })).data;
    return { ...migrationView(m), ...(m.state === 'exported' ? { archive: `Ready. Download it in the browser: https://github.com/organizations/${owner}/settings/migrations (the archive holds private data, so this server does not fetch or relay it).` } : {}) };
  })
});

export const tools = [securityManager.tool, networkList.tool, networkSave.tool, migrationStart.tool, migrationStatus.tool];
export const handlers = { [securityManager.tool.name]: securityManager.handler, [networkList.tool.name]: networkList.handler, [networkSave.tool.name]: networkSave.handler,
  [migrationStart.tool.name]: migrationStart.handler, [migrationStatus.tool.name]: migrationStatus.handler };

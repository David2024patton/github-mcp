// Y-7c: organization code-security configurations (a named bundle of security settings that can be attached to many
// repositories). Paid private security changes remain executable for users who have GitHub provider permission and
// authorize unknown future metered charges; they are never made free by guessing a price.
// Every production policy change still requires protected-resource checks and confirmation.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, refusal, ownerOf } from './github-write.js';
import { LOGIN, REPO_NAME } from './public-read.js';

const ORG = { ...LOGIN, description: 'Connected organization (default account)' };
const ID = { type: 'integer', minimum: 1 };
const THREE = { type: 'string', enum: ['enabled', 'disabled', 'not_set'] };
const SETTING_KEYS = ['code_security', 'dependency_graph', 'dependency_graph_autosubmit_action', 'dependabot_alerts', 'dependabot_security_updates', 'dependabot_delegated_alert_dismissal',
  'code_scanning_default_setup', 'code_scanning_delegated_alert_dismissal', 'secret_protection', 'secret_scanning', 'secret_scanning_push_protection', 'secret_scanning_delegated_bypass',
  'secret_scanning_validity_checks', 'secret_scanning_non_provider_patterns', 'secret_scanning_generic_secrets', 'secret_scanning_delegated_alert_dismissal', 'secret_scanning_extended_metadata',
  'private_vulnerability_reporting'];
// Settings that cost money on private repositories.
const PAID = new Set(['code_security', 'secret_protection', 'secret_scanning', 'secret_scanning_push_protection', 'secret_scanning_validity_checks', 'secret_scanning_non_provider_patterns',
  'secret_scanning_generic_secrets', 'secret_scanning_extended_metadata', 'secret_scanning_delegated_bypass', 'secret_scanning_delegated_alert_dismissal', 'code_scanning_default_setup', 'code_scanning_delegated_alert_dismissal']);
const settingProps = Object.fromEntries(SETTING_KEYS.map((k) => [k, THREE]));
const SETTINGS = {
  type: 'object', additionalProperties: false, minProperties: 1, maxProperties: 30,
  properties: { ...settingProps, advanced_security: { type: 'string', enum: ['enabled', 'disabled', 'code_security', 'secret_protection'] }, enforcement: { type: 'string', enum: ['enforced', 'unenforced'] },
    code_scanning_default_setup_options: { type: 'object', additionalProperties: false, properties: { runner_type: { type: 'string', enum: ['standard', 'labeled', 'not_set'] }, runner_label: { type: 'string', maxLength: 100 } } },
    code_scanning_options: { type: 'object', additionalProperties: false, properties: { allow_advanced: { type: 'boolean' } } } }
};
const orgTarget = (args, ctx) => ({ owner: ownerOf({ owner: args.org }, ctx), scope: 'org' });
const decl = (extra = {}) => ({ production: 'always', confirm: 'always', cred: 'I', profiles: ['full'], ...extra });
const BASE = '/orgs/{org}/code-security/configurations';
const ONE = `${BASE}/{configuration_id}`;

/** True when this configuration (or this change to one) switches on something that costs money on private repositories. */
export const turnsOnPaid = (settings) => !!settings && (
  [...PAID].some((k) => settings[k] === 'enabled') || ['enabled', 'code_security', 'secret_protection'].includes(settings.advanced_security));
export const shapeConfig = (c) => (c ? {
  id: c.id, name: String(c.name ?? '').slice(0, 100), description: typeof c.description === 'string' ? c.description.slice(0, 200) : null, enforcement: c.enforcement ?? null,
  paid: turnsOnPaid(c), settings: Object.fromEntries([...SETTING_KEYS, 'advanced_security'].filter((k) => c[k] !== undefined).map((k) => [k, c[k]]))
} : null);
const getConfig = (ctx, t, id) => missing(async () => (await (await octo(ctx, t.owner)).request(`GET ${ONE}`, { org: t.owner, configuration_id: id })).data);
const listConfigs = async (ctx, t) => (await (await octo(ctx, t.owner)).request(`GET ${BASE}`, { org: t.owner, per_page: 100 })).data ?? [];
const attachedRepos = async (ctx, t, id) => {
  // The pinned GitHub endpoint allows per_page but not page: never invent a
  // page parameter. If the response fills the page, completeness cannot be
  // established; refuse any financially sensitive write rather than omit a
  // hidden private repository.
  const rows = (await (await octo(ctx, t.owner)).request(`GET ${ONE}/repositories`,
    { org: t.owner, configuration_id: id, per_page: 100 })).data;
  if (!Array.isArray(rows) || rows.length >= 100)
    throw refusal('The complete attached repository inventory cannot be verified (100+ records or unreadable response).');
  return rows.map((r) => ({ id: r.repository?.id, name: r.repository?.name,
    private: r.repository?.private === true || ['private', 'internal'].includes(r.repository?.visibility),
    status: r.status }));
};

// ---- create / edit -------------------------------------------------------------------------------------------------------
const save = defineGithubWrite({
  name: 'github_security_config_save', area: 'security', audience: ['O'],
  description: 'Create or edit an organization code-security configuration; privately attached paid settings carry explicit future-cost warnings.',
  properties: { org: ORG, configurationId: ID, name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 500 }, settings: SETTINGS },
  required: [], declarations: decl({ production: 'when-target', accessWidening: false, spend: true }), target: orgTarget,
  read: async (args, ctx, t) => {
    if (!args.configurationId) {
      if (!args.name || !args.description) throw refusal('A new configuration needs name and description.');
      return { current: null, attached: [], clash: (await listConfigs(ctx, t)).find((c) => String(c.name).toLowerCase() === args.name.toLowerCase()) ?? null };
    }
    if (args.name === undefined && args.description === undefined && !args.settings) throw refusal('Give at least one field to change.');
    const current = await getConfig(ctx, t, args.configurationId);
    return { current: shapeConfig(current), attached: current ? await attachedRepos(ctx, t, args.configurationId) : [], clash: null };
  },
  price: ({ args, before }) => before?.attached?.some((r) => r.private) &&
    turnsOnPaid(args.settings) ? null : 0,
  classify: ({ before }) => (before?.attached?.length ? { production: `this configuration is attached to ${before.attached.length} repositor${before.attached.length === 1 ? 'y' : 'ies'}; changes apply to them at once` } : {}),
  summarize: ({ args, target: t, before }) => (before.current
    ? `Edit code-security configuration "${before.current.name}" of ${t.owner}: ${Object.keys(args.settings ?? {}).join(', ') || 'name/description'}${before.attached.length ? ` (attached to ${before.attached.length} repositories - applies immediately)` : ''}`
    : `Create code-security configuration "${args.name}" in ${t.owner}${turnsOnPaid(args.settings) ? ' with PAID features (attaching to private repositories can incur uncapped future charges)' : ''}`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    const body = { ...(args.name !== undefined ? { name: args.name } : {}), ...(args.description !== undefined ? { description: args.description } : {}), ...(args.settings ?? {}) };
    if (args.configurationId) {
      if (!before.current) throw refusal('That configuration was not found; nothing was changed.', 404);
      return gh.request(`PATCH ${ONE}`, { org: t.owner, configuration_id: args.configurationId, ...body });
    }
    if (before.clash) throw refusal(`A configuration named "${args.name}" already exists (id ${before.clash.id}); nothing was created.`);
    return gh.request(`POST ${BASE}`, { org: t.owner, ...body });
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    const id = args.configurationId ?? response?.data?.id;
    return { config: id ? shapeConfig(await getConfig(ctx, t, id)) : null };
  },
  verify: ({ args, after }) => !!after.config && (args.name === undefined || after.config.name === args.name)
    && Object.entries(args.settings ?? {}).filter(([k, v]) => typeof v === 'string' && k !== 'enforcement').every(([k, v]) => after.config.settings[k] === v),
  inverse: ({ args, before, target: t }) => (before.current && args.configurationId
    ? { tool: 'github_security_config_save', args: { org: t.owner, configurationId: args.configurationId, ...(args.name !== undefined ? { name: before.current.name } : {}),
      ...(args.settings ? { settings: Object.fromEntries(Object.keys(args.settings).filter((k) => before.current.settings[k] !== undefined && typeof before.current.settings[k] === 'string').map((k) => [k, before.current.settings[k]])) } : {}) } }
    : null),
  present: ({ after }) => ({ configuration: after.config })
});

// ---- attach ------------------------------------------------------------------------------------------------------------------
const resolveRepos = async (ctx, t, names) => {
  const gh = await octo(ctx, t.owner);
  const out = [];
  for (const name of names) {
    const r = await missing(async () => (await gh.request('GET /repos/{owner}/{repo}', { owner: t.owner, repo: name })).data);
    if (!r) throw refusal(`Repository "${name}" was not found in ${t.owner}.`);
    out.push({ id: r.id, name: r.name, private: r.private === true || r.visibility === 'private' || r.visibility === 'internal' });
  }
  return out;
};
const attach = defineGithubWrite({
  name: 'github_security_config_attach', area: 'security', audience: ['O'],
  description: 'Attach code-security configurations to any authorized repository scope, warning of unknown future private security charges.',
  properties: { org: ORG, configurationId: ID, scope: { type: 'string', enum: ['all', 'all_without_configurations', 'public', 'private_or_internal', 'selected'] },
    repositories: { type: 'array', minItems: 1, maxItems: 50, items: REPO_NAME, uniqueItems: true, description: 'scope selected only: repository names' } },
  required: ['configurationId', 'scope'], declarations: decl({ accessWidening: false, spend: true }),
  target: (args, ctx) => {
    if (args.scope === 'selected' && !args.repositories?.length) throw new TypeError('scope selected needs repositories.');
    if (args.scope !== 'selected' && args.repositories) throw new TypeError('repositories only applies to scope selected.');
    return orgTarget(args, ctx);
  },
  read: async (args, ctx, t) => ({
    current: shapeConfig(await getConfig(ctx, t, args.configurationId)),
    chosen: args.scope === 'selected' ? await resolveRepos(ctx, t, args.repositories) : [],
    attached: await attachedRepos(ctx, t, args.configurationId)
  }),
  price: ({ args, before }) => before?.current?.paid &&
    (args.scope === 'all' || args.scope === 'all_without_configurations' ||
      args.scope === 'private_or_internal' ||
      (args.scope === 'selected' && before.chosen.some((r) => r.private))) ? null : 0,
  classify: ({ args }) => ({ production: `applies security settings to ${args.scope === 'selected' ? 'the named repositories' : `${args.scope.replace(/_/g, ' ')} repositories`} of the organization` }),
  summarize: ({ args, target: t, before }) => (before.current
    ? `Attach configuration "${before.current.name}" to ${args.scope === 'selected' ? args.repositories.join(', ') : `${args.scope.replace(/_/g, ' ')} repositories`} of ${t.owner}${before.current.paid ? ' (PAID settings: private targets can create unbounded future active-committer charges)' : ''}; GitHub applies it in the background`
    : `Configuration ${args.configurationId} was not found`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.current) throw refusal('That configuration was not found; nothing was attached.', 404);
    if (args.scope === 'selected' && before.chosen.every((r) => before.attached.some((a) => a.id === r.id))) throw refusal('Those repositories already have this configuration; nothing to do.');
    return (await octo(ctx, t.owner)).request(`POST ${ONE}/attach`, { org: t.owner, configuration_id: args.configurationId, scope: args.scope, ...(args.scope === 'selected' ? { selected_repository_ids: before.chosen.map((r) => r.id) } : {}) });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ attached: await attachedRepos(ctx, t, args.configurationId) }),
  verify: ({ args, before, after }) => (args.scope === 'selected' ? before.chosen.every((r) => after.attached.some((a) => a.id === r.id)) : after.attached.length > 0),
  inverse: ({ args, before, target: t }) => (args.scope === 'selected' ? { tool: 'github_security_config_detach', args: { org: t.owner, repositories: before.chosen.map((r) => r.name) } } : null),
  present: ({ args, after }) => ({ configurationId: args.configurationId, scope: args.scope, attachedNow: after.attached.length, note: 'GitHub attaches in the background; statuses can read "attaching" for a while.' })
});

// ---- default for new repositories ----------------------------------------------------------------------------------------------
const defaults = defineGithubWrite({
  name: 'github_security_config_default', area: 'security', audience: ['O'],
  description: 'Choose which new repositories get a code-security configuration by default (all, public, private and internal, or none).',
  properties: { org: ORG, configurationId: ID, newRepos: { type: 'string', enum: ['all', 'none', 'private_and_internal', 'public'] } }, required: ['configurationId', 'newRepos'],
  declarations: decl({ spend: true }), target: orgTarget,
  read: async (args, ctx, t) => {
    const list = (await (await octo(ctx, t.owner)).request(`GET ${BASE}/defaults`, { org: t.owner })).data ?? [];
    return { current: shapeConfig(await getConfig(ctx, t, args.configurationId)), today: list.find((d) => d.configuration?.id === args.configurationId)?.default_for_new_repos ?? 'none' };
  },
  price: ({ args, before }) => before?.current?.paid &&
    ['all', 'private_and_internal'].includes(args.newRepos) ? null : 0,
  classify: () => ({ production: 'changes the security settings every NEW repository starts with' }),
  summarize: ({ args, before }) => (before.current ? `Make "${before.current.name}" the default for ${args.newRepos} new repositories (today: ${before.today})` : `Configuration ${args.configurationId} was not found`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.current) throw refusal('That configuration was not found; nothing was changed.', 404);
    if (before.today === args.newRepos) throw refusal(`It is already the default for ${args.newRepos} new repositories; nothing to do.`);
    return (await octo(ctx, t.owner)).request(`PUT ${ONE}/defaults`, { org: t.owner, configuration_id: args.configurationId, default_for_new_repos: args.newRepos });
  },
  readAfter: async ({ args, ctx, target: t }) => {
    const list = (await (await octo(ctx, t.owner)).request(`GET ${BASE}/defaults`, { org: t.owner })).data ?? [];
    return { today: list.find((d) => d.configuration?.id === args.configurationId)?.default_for_new_repos ?? 'none' };
  },
  verify: ({ args, after }) => after.today === args.newRepos,
  inverse: ({ args, before, target: t }) => ({ tool: 'github_security_config_default', args: { org: t.owner, configurationId: args.configurationId, newRepos: before.today } }),
  present: ({ args, after }) => ({ configurationId: args.configurationId, defaultForNewRepos: after.today })
});

// ---- detach ----------------------------------------------------------------------------------------------------------------------
const repoConfig = (ctx, t, name) => missing(async () => (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/code-security-configuration', { owner: t.owner, repo: name })).data);
const detach = defineGithubWrite({
  name: 'github_security_config_detach', area: 'security', audience: ['O'],
  description: 'Detach whatever code-security configuration the named repositories use. Their current settings stay as they are.',
  properties: { org: ORG, repositories: { type: 'array', minItems: 1, maxItems: 50, items: REPO_NAME, uniqueItems: true } }, required: ['repositories'],
  declarations: decl(), target: orgTarget,
  read: async (args, ctx, t) => {
    const chosen = await resolveRepos(ctx, t, args.repositories);
    const withConfig = [];
    for (const r of chosen) { const c = await repoConfig(ctx, t, r.name); if (c?.configuration) withConfig.push({ ...r, configId: c.configuration.id, configName: String(c.configuration.name ?? '').slice(0, 100) }); }
    return { chosen, withConfig };
  },
  classify: () => ({ production: 'stops the organization from managing those repositories\' security settings' }),
  summarize: ({ args, target: t, before }) => `Detach the code-security configuration from ${before.withConfig.length} of ${args.repositories.length} named repositories of ${t.owner} (${before.withConfig.map((r) => `${r.name}: "${r.configName}"`).join(', ') || 'none have one'}); settings already applied stay`,
  apply: async ({ ctx, target: t, before }) => {
    if (!before.withConfig.length) throw refusal('None of those repositories has a configuration attached; nothing to do.');
    return (await octo(ctx, t.owner)).request(`DELETE ${BASE}/detach`, { org: t.owner, selected_repository_ids: before.withConfig.map((r) => r.id) });
  },
  readAfter: async ({ ctx, target: t, before }) => {
    const left = [];
    for (const r of before.withConfig) { const c = await repoConfig(ctx, t, r.name); if (c?.configuration) left.push(r.name); }
    return { left };
  },
  verify: ({ after }) => after.left.length === 0,
  inverse: () => null,
  present: ({ before }) => ({ detached: before.withConfig.map((r) => r.name) })
});

// ---- delete --------------------------------------------------------------------------------------------------------------------------
const remove = defineGithubWrite({
  name: 'github_security_config_delete', area: 'security', audience: ['O'],
  description: 'Delete an organization code-security configuration (name typed). Repositories using it are detached. No undo.',
  properties: { org: ORG, configurationId: ID, name: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['configurationId', 'name'],
  declarations: decl(), target: orgTarget,
  read: async (args, ctx, t) => {
    const current = shapeConfig(await getConfig(ctx, t, args.configurationId));
    if (current && current.name !== args.name) throw refusal('name must be exactly the configuration\'s current name.');
    return { current, attached: current ? await attachedRepos(ctx, t, args.configurationId).catch(() => []) : [] };
  },
  classify: ({ before }) => ({ production: `deleting configuration "${before?.current?.name ?? ''}" cannot be undone` }),
  summarize: ({ args, before }) => (before.current ? `DELETE code-security configuration "${before.current.name}" (attached to ${before.attached.length} repositories, which are detached; no undo)` : `Configuration ${args.configurationId} no longer exists`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.current) throw refusal('The configuration no longer exists; nothing was deleted.', 404);
    return (await octo(ctx, t.owner)).request(`DELETE ${ONE}`, { org: t.owner, configuration_id: args.configurationId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ config: await getConfig(ctx, t, args.configurationId) }),
  verify: ({ after }) => after.config === null,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted: args.configurationId, name: before.current?.name ?? null, restorable: false })
});

const writes = [save, attach, defaults, detach, remove];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));

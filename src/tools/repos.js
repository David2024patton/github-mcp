// Repositories (D-1): reading them, creating them, and changing their settings. Every tool says what it will do before it does it.
// Settings are split by risk (BATCH-D D5): description, topics and feature switches are small; merge options change how code ships
// (production); visibility, default branch, rename, archive, transfer and delete are each their own production tool.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { summarize } from './summaries.js';
import { productionReason } from './production-guard.js';
import { becomesPublic, accessChange } from './people-guard.js';
import { OWNER, REPO, REPO_ARGS, PAGING, ownerOf, clientFor, call, callOrNull, refuse, sameName, pause } from './github-kit.js';

const slugOf = (args, ctx) => `${ownerOf(args, ctx)}/${args.repo}`;
const repoParams = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo });
const GET_REPO = 'GET /repos/{owner}/{repo}';
const readRepo = (args, ctx) => callOrNull(ctx, args, GET_REPO, repoParams(args, ctx));
const isOrg = async (ctx, owner) => (await ctx.db.getAccount(owner))?.account_type === 'Organization';
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const missing = (args, ctx) => refuse(`${slugOf(args, ctx)} does not exist (or this connection cannot see it).`);
const need = (before, args, ctx) => { if (!before) throw missing(args, ctx); return before; };
const cleanBody = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---------------------------------------------------------------- reads

const ORG_TYPES = ['all', 'public', 'private', 'forks', 'sources', 'member'];
const USER_TYPES = ['all', 'owner', 'member'];

const list = defineRead({
  name: 'github_repo_list', audience: ['B', 'Op'], summaryType: 'repository',
  description: 'Repositories of an organization or user account: filter by type, sort, include archived. One page at a time.',
  properties: {
    owner: OWNER, type: { type: 'string', enum: ORG_TYPES, description: 'all (default), public, private, forks, sources, member (a user account supports all, owner, member)' },
    sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'] }, direction: { type: 'string', enum: ['asc', 'desc'] },
    includeArchived: { type: 'boolean', description: 'Archived repositories are left out unless true' }, ...PAGING
  },
  handler: async (args, ctx) => {
    const owner = ownerOf(args, ctx);
    const org = await isOrg(ctx, owner);
    if (!org && args.type && !USER_TYPES.includes(args.type)) throw new TypeError(`${owner} is a user account; type can be ${USER_TYPES.join(', ')}.`);
    const shared = cleanBody({ type: args.type, sort: args.sort, direction: args.direction, per_page: args.perPage ?? 30, page: args.page });
    const data = org ? await call(ctx, args, 'GET /orgs/{org}/repos', { org: owner, ...shared }) : await call(ctx, args, 'GET /users/{username}/repos', { username: owner, ...shared });
    return args.includeArchived === true ? data : data.filter((r) => !r.archived);
  }
});

const get = defineRead({
  name: 'github_repo_get', audience: ['B', 'O', 'Op'],
  description: 'One repository: visibility, default branch, merge settings, security features and a summary of the rules protecting its default branch.',
  properties: REPO_ARGS, required: ['repo'],
  handler: async (args, ctx) => {
    const repo = need(await readRepo(args, ctx), args, ctx);
    let protection = { checked: false, note: 'The rules could not be read.' };
    try {
      const rules = await call(ctx, args, 'GET /repos/{owner}/{repo}/rules/branches/{branch}', { ...repoParams(args, ctx), branch: repo.default_branch });
      protection = { checked: true, branch: repo.default_branch, rules: rules.length, kinds: [...new Set(rules.map((r) => r.type))] };
    } catch { /* leave the note: a failed read is never reported as "no protection" */ }
    return {
      ...summarize('repository', repo), topics: repo.topics ?? [], homepage: repo.homepage ?? null, template: repo.is_template === true, size_kb: repo.size,
      merge_options: { squash: repo.allow_squash_merge, merge_commit: repo.allow_merge_commit, rebase: repo.allow_rebase_merge, auto_merge: repo.allow_auto_merge, delete_branch_on_merge: repo.delete_branch_on_merge },
      features: { issues: repo.has_issues, wiki: repo.has_wiki, projects: repo.has_projects, discussions: repo.has_discussions },
      security: repo.security_and_analysis ?? 'not shown to this credential', protection,
      ...(repo.parent ? { forked_from: repo.parent.full_name } : {})
    };
  }
});

const find = defineRead({
  name: 'github_repo_find', audience: ['Op'], summaryType: 'repository',
  description: 'Find repositories by words in the name, topic or description, across your connected accounts.',
  properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, accounts: { type: 'array', items: { type: 'string', maxLength: 39 }, maxItems: 10, description: 'Default: every account of this connection' }, perPage: PAGING.perPage },
  required: ['query'],
  handler: async (args, ctx) => {
    const accounts = args.accounts?.length ? args.accounts : ctx.connection.accounts;
    for (const a of accounts) if (!ctx.connection.accounts.some((c) => sameName(c, a))) throw new TypeError(`"${a}" is not one of the GitHub accounts this connection may use (${ctx.connection.accounts.join(', ')}).`);
    const found = [];
    for (const account of accounts) {
      const data = await call(ctx, { owner: account }, 'GET /search/repositories', { q: `${args.query} user:${account}`, sort: 'updated', order: 'desc', per_page: args.perPage ?? 20 });
      found.push(...data.items);
    }
    return found;
  }
});

/** A statistics endpoint answers 202 while GitHub computes. Asks at most three times, with short waits, then says so. */
async function statsOrComputing(ctx, args, route, params) {
  const octokit = await clientFor(ctx, args);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await octokit.request(route, params);
    if (res.status !== 202) return res.data;
    if (attempt < 2) await pause(ctx, 1500 * (attempt + 1));
  }
  return null;
}

const insights = defineRead({
  name: 'github_repo_get_insights', audience: ['Op'],
  description: 'Languages, top contributors, community profile and recent commit activity in one summary.',
  properties: REPO_ARGS, required: ['repo'],
  handler: async (args, ctx) => {
    const p = repoParams(args, ctx);
    const [languages, contributors, community] = await Promise.all([
      call(ctx, args, 'GET /repos/{owner}/{repo}/languages', p),
      call(ctx, args, 'GET /repos/{owner}/{repo}/contributors', { ...p, per_page: 10 }),
      call(ctx, args, 'GET /repos/{owner}/{repo}/community/profile', p)
    ]);
    const bytes = Object.values(languages).reduce((a, b) => a + b, 0);
    const weeks = await statsOrComputing(ctx, args, 'GET /repos/{owner}/{repo}/stats/commit_activity', p);
    const recent = Array.isArray(weeks) ? weeks.slice(-12) : null;
    return {
      repository: slugOf(args, ctx),
      languages: Object.fromEntries(Object.entries(languages).map(([k, v]) => [k, `${((v / bytes) * 100).toFixed(1)}%`])),
      top_contributors: (Array.isArray(contributors) ? contributors : []).map((c) => ({ login: c.login, commits: c.contributions })),
      community: { health_percentage: community.health_percentage ?? null, has: Object.entries(community.files ?? {}).filter(([, v]) => v).map(([k]) => k) },
      commit_activity: recent ? { last_12_weeks: recent.reduce((a, w) => a + w.total, 0), busiest_week_commits: Math.max(0, ...recent.map((w) => w.total)) } : 'GitHub is still computing; try again in a minute.'
    };
  }
});

const traffic = defineRead({
  name: 'github_repo_get_traffic', audience: ['Op', 'O'],
  description: 'Views, clones, top referrers and top paths for the last 14 days (needs push access).',
  properties: REPO_ARGS, required: ['repo'],
  handler: async (args, ctx) => {
    const p = repoParams(args, ctx);
    const parts = { views: 'views', clones: 'clones', referrers: 'popular/referrers', paths: 'popular/paths' };
    const routes = { views: 'GET /repos/{owner}/{repo}/traffic/views', clones: 'GET /repos/{owner}/{repo}/traffic/clones',
      referrers: 'GET /repos/{owner}/{repo}/traffic/popular/referrers', paths: 'GET /repos/{owner}/{repo}/traffic/popular/paths' };
    const out = { repository: slugOf(args, ctx), window: 'last 14 days' };
    const results = await Promise.allSettled(Object.keys(parts).map((k) => call(ctx, args, routes[k], p)));
    Object.keys(parts).forEach((k, i) => {
      const r = results[i];
      if (r.status === 'rejected') { out[k] = { unavailable: r.reason?.status === 403 ? 'GitHub only shows traffic to people with push access.' : 'GitHub did not return this part.' }; return; }
      out[k] = ['views', 'clones'].includes(k) ? { total: r.value.count, unique: r.value.uniques } : r.value.slice(0, 10);
    });
    return out;
  }
});

const activity = defineRead({
  name: 'github_repo_list_activity', audience: ['Op', 'O'],
  description: 'Pushes, force pushes, branch creations and deletions, merges: who did it and when.',
  properties: {
    ...REPO_ARGS, ref: { type: 'string', maxLength: 255, description: 'For example refs/heads/main' }, actor: { type: 'string', maxLength: 39 },
    timePeriod: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
    activityType: { type: 'string', enum: ['push', 'force_push', 'branch_creation', 'branch_deletion', 'pr_merge', 'merge_queue_merge'] }, perPage: PAGING.perPage
  },
  required: ['repo'],
  handler: async (args, ctx) => {
    const data = await call(ctx, args, 'GET /repos/{owner}/{repo}/activity', cleanBody({ ...repoParams(args, ctx), ref: args.ref, actor: args.actor, time_period: args.timePeriod, activity_type: args.activityType, per_page: args.perPage ?? 30 }));
    return data.map((a) => ({ type: a.activity_type, ref: a.ref, who: a.actor?.login, at: a.timestamp, before: a.before, after: a.after }));
  }
});

const getProperties = defineRead({
  name: 'github_repo_get_custom_properties', audience: ['O'],
  description: 'The custom property values set on a repository.', properties: REPO_ARGS, required: ['repo'],
  handler: async (args, ctx) => {
    const data = await call(ctx, args, 'GET /repos/{owner}/{repo}/properties/values', repoParams(args, ctx));
    return { repository: slugOf(args, ctx), properties: Object.fromEntries(data.map((p) => [p.property_name, p.value])) };
  }
});

// ---------------------------------------------------------------- creating

const VISIBILITY = { type: 'string', enum: ['private', 'public', 'internal'], description: 'Default private. public lets anyone read the code and its history; internal is for enterprise accounts' };
const describeNew = (visibility) => (visibility === 'public' ? 'a PUBLIC repository (anyone can read the code and its history)' : `a ${visibility} repository`);
const publicReason = (visibility, slug) => (visibility === 'public' ? becomesPublic({ what: `The new repository ${slug}` }) : {});
const exists = async (ctx, args, owner, repo) => callOrNull(ctx, args, GET_REPO, { owner, repo });
const matches = (after, owner, repo) => after && sameName(after.full_name, `${owner}/${repo}`);

const create = defineGithubWrite({
  name: 'github_repo_create', area: 'repo', audience: ['B'],
  description: 'Create a repository in an organization or user account. Private unless you say public (public asks you to confirm).',
  properties: {
    owner: OWNER, repo: { ...REPO, description: 'Name of the new repository' }, description: { type: 'string', maxLength: 350 }, visibility: VISIBILITY,
    autoInit: { type: 'boolean', description: 'Start with a README so the repository has a first commit' },
    gitignoreTemplate: { type: 'string', maxLength: 60 }, licenseTemplate: { type: 'string', maxLength: 60 }, isTemplate: { type: 'boolean' }
  },
  required: ['repo'],
  declarations: { production: 'never', accessWidening: true },
  target,
  read: (args, ctx) => exists(ctx, args, ownerOf(args, ctx), args.repo),
  classify: ({ args, ctx }) => publicReason(args.visibility, slugOf(args, ctx)),
  summarize: ({ args, ctx, before }) => (before ? `${slugOf(args, ctx)} already exists, so nothing can be created` : `Create ${describeNew(args.visibility ?? 'private')} ${slugOf(args, ctx)}`),
  apply: async ({ args, ctx, before }) => {
    if (before) throw refuse(`${slugOf(args, ctx)} already exists.`);
    const owner = ownerOf(args, ctx);
    const visibility = args.visibility ?? 'private';
    const body = cleanBody({ name: args.repo, description: args.description, private: visibility !== 'public', auto_init: args.autoInit, gitignore_template: args.gitignoreTemplate,
      license_template: args.licenseTemplate, is_template: args.isTemplate });
    const octokit = await clientFor(ctx, args);
    if (await isOrg(ctx, owner)) return octokit.request('POST /orgs/{org}/repos', { org: owner, ...body, ...(visibility === 'internal' ? { visibility: 'internal' } : {}) });
    if (visibility === 'internal') throw refuse('Internal repositories exist only in enterprise organizations.');
    return octokit.request('POST /user/repos', body);
  },
  readAfter: ({ args, ctx }) => exists(ctx, args, ownerOf(args, ctx), args.repo),
  verify: ({ args, ctx, after }) => matches(after, ownerOf(args, ctx), args.repo) && after.private === ((args.visibility ?? 'private') !== 'public'),
  present: ({ after }) => ({ repository: after.full_name, visibility: after.visibility, url: after.html_url, default_branch: after.default_branch })
});

const createFromTemplate = defineGithubWrite({
  name: 'github_repo_create_from_template', area: 'repo', audience: ['B'],
  description: 'Create a repository from a template repository. Private unless you say public (public asks you to confirm).',
  properties: {
    owner: { ...OWNER, description: 'Account that will own the new repository' }, repo: { ...REPO, description: 'Name of the new repository' },
    templateOwner: { type: 'string', maxLength: 39 }, templateRepo: REPO, description: { type: 'string', maxLength: 350 }, visibility: { type: 'string', enum: ['private', 'public'] },
    includeAllBranches: { type: 'boolean' }
  },
  required: ['repo', 'templateOwner', 'templateRepo'],
  declarations: { production: 'never', accessWidening: true },
  target,
  read: async (args, ctx) => ({ existing: await exists(ctx, args, ownerOf(args, ctx), args.repo), template: await callOrNull(ctx, args, GET_REPO, { owner: args.templateOwner, repo: args.templateRepo }) }),
  classify: ({ args, ctx }) => publicReason(args.visibility, slugOf(args, ctx)),
  summarize: ({ args, ctx, before }) => {
    if (before.existing) return `${slugOf(args, ctx)} already exists, so nothing can be created`;
    if (!before.template?.is_template) return `${args.templateOwner}/${args.templateRepo} is not a template repository`;
    return `Create ${describeNew(args.visibility ?? 'private')} ${slugOf(args, ctx)} from the template ${args.templateOwner}/${args.templateRepo}`;
  },
  apply: async ({ args, ctx, before }) => {
    if (before.existing) throw refuse(`${slugOf(args, ctx)} already exists.`);
    if (!before.template?.is_template) throw refuse(`${args.templateOwner}/${args.templateRepo} is not a template repository.`);
    return (await clientFor(ctx, args)).request('POST /repos/{template_owner}/{template_repo}/generate', cleanBody({
      template_owner: args.templateOwner, template_repo: args.templateRepo, owner: ownerOf(args, ctx), name: args.repo, description: args.description,
      include_all_branches: args.includeAllBranches, private: (args.visibility ?? 'private') !== 'public' }));
  },
  readAfter: ({ args, ctx }) => exists(ctx, args, ownerOf(args, ctx), args.repo),
  verify: ({ args, ctx, after }) => matches(after, ownerOf(args, ctx), args.repo),
  present: ({ after }) => ({ repository: after.full_name, visibility: after.visibility, url: after.html_url })
});

// ---------------------------------------------------------------- settings

const SWITCHES = ['has_issues', 'has_wiki', 'has_projects', 'has_discussions'];
const MERGE_OPTIONS = ['allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge', 'allow_auto_merge', 'allow_update_branch', 'delete_branch_on_merge'];
const bool = (description) => ({ type: 'boolean', description });
const SETTING_KEYS = ['description', 'homepage', 'topics', ...SWITCHES, ...MERGE_OPTIONS];
const changedKeys = (args) => SETTING_KEYS.filter((k) => args[k] !== undefined);
const sameTopics = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const settingsMatch = (args, after) => changedKeys(args).every((k) => (k === 'topics' ? sameTopics(args.topics, after.topics) : (after[k] ?? '') === args[k] || (args[k] === '' && !after[k])));

const updateSettings = defineGithubWrite({
  name: 'github_repo_update_settings', area: 'repo', audience: ['B', 'O'],
  description: 'Change a repository\'s description, homepage, topics, feature switches or merge options. Merge options change how code ships (production).',
  properties: {
    ...REPO_ARGS, description: { type: 'string', maxLength: 350 }, homepage: { type: 'string', maxLength: 255 },
    topics: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,49}$' }, maxItems: 20, description: 'Replaces all topics' },
    has_issues: bool('Issues tab'), has_wiki: bool('Wiki'), has_projects: bool('Projects'), has_discussions: bool('Discussions'),
    allow_squash_merge: bool('Allow squash merging'), allow_merge_commit: bool('Allow merge commits'), allow_rebase_merge: bool('Allow rebase merging'),
    allow_auto_merge: bool('Allow auto-merge'), allow_update_branch: bool('Offer to update a pull request branch'), delete_branch_on_merge: bool('Delete head branches after merge')
  },
  required: ['repo'],
  declarations: { production: 'when-target', profiles: ['full'] },
  target: (args, ctx) => {
    if (!changedKeys(args).length) throw new TypeError(`Say what to change: ${SETTING_KEYS.join(', ')}.`);
    return target(args, ctx);
  },
  read: readRepo,
  classify: async ({ args, ctx }) => (changedKeys(args).some((k) => MERGE_OPTIONS.includes(k))
    ? { production: await productionReason(ctx, { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo', kind: 'repo-settings' }) } : {}),
  summarize: ({ args, ctx, before }) => (before
    ? `Change ${slugOf(args, ctx)}: ${changedKeys(args).map((k) => `${k} from ${JSON.stringify(k === 'topics' ? before.topics : before[k] ?? null)} to ${JSON.stringify(args[k])}`).join('; ')}`
    : `${slugOf(args, ctx)} does not exist`),
  apply: async ({ args, ctx, before }) => {
    need(before, args, ctx);
    const octokit = await clientFor(ctx, args);
    const fields = cleanBody(Object.fromEntries(changedKeys(args).filter((k) => k !== 'topics').map((k) => [k, args[k]])));
    let response;
    if (Object.keys(fields).length) response = await octokit.request('PATCH /repos/{owner}/{repo}', { ...repoParams(args, ctx), ...fields });
    if (args.topics) response = await octokit.request('PUT /repos/{owner}/{repo}/topics', { ...repoParams(args, ctx), names: args.topics });
    return response;
  },
  readAfter: ({ args, ctx }) => readRepo(args, ctx),
  verify: ({ args, after }) => !!after && settingsMatch(args, after),
  inverse: ({ args, ctx, before }) => ({ tool: 'github_repo_update_settings', args: { owner: ownerOf(args, ctx), repo: args.repo, ...Object.fromEntries(changedKeys(args).map((k) => [k, k === 'topics' ? (before.topics ?? []) : (before[k] ?? (typeof args[k] === 'string' ? '' : false))])) } }),
  present: ({ after }) => ({ description: after.description, homepage: after.homepage, topics: after.topics, merge_options: { squash: after.allow_squash_merge, merge_commit: after.allow_merge_commit, rebase: after.allow_rebase_merge, auto_merge: after.allow_auto_merge, delete_branch_on_merge: after.delete_branch_on_merge } })
});

/** One production tool that changes exactly one repository field. */
function singleField({ name, description, properties, required, field, value, current, label, confirmAccess, classify, inverseArgs, extraVerify, repoAfter = (a) => a.repo }) {
  return defineGithubWrite({
    name, area: 'repo', audience: ['O'], description, properties: { ...REPO_ARGS, ...properties }, required: ['repo', ...required],
    declarations: { production: 'always', confirm: 'always', accessWidening: !!confirmAccess, profiles: ['full'] },
    target, read: readRepo, classify: classify ?? (() => ({})),
    summarize: ({ args, ctx, before }) => (before ? label({ args, ctx, before }) : `${slugOf(args, ctx)} does not exist`),
    apply: async ({ args, ctx, before }) => (need(before, args, ctx), (await clientFor(ctx, args)).request('PATCH /repos/{owner}/{repo}', { ...repoParams(args, ctx), [field]: value(args) })),
    readAfter: (input) => callOrNull(input.ctx, input.args, GET_REPO, { owner: ownerOf(input.args, input.ctx), repo: repoAfter(input.args, input.ctx) }),
    verify: ({ args, after, before }) => !!after && (extraVerify ? extraVerify({ args, after, before }) : after[current] === value(args)),
    inverse: inverseArgs,
    present: ({ after }) => ({ repository: after.full_name, [current]: after[current] })
  });
}

const setVisibility = singleField({
  name: 'github_repo_set_visibility', field: 'visibility', current: 'visibility', value: (a) => a.visibility, confirmAccess: true,
  description: 'Make a repository private, public or internal. Public lets anyone read the code and its history, including old commits.',
  properties: { visibility: { type: 'string', enum: ['private', 'public', 'internal'] } }, required: ['visibility'],
  classify: ({ args, ctx, before }) => (args.visibility === 'public' && before?.visibility !== 'public' ? becomesPublic({ what: `${slugOf(args, ctx)} and its whole history` }) : {}),
  label: ({ args, ctx, before }) => (args.visibility === 'public'
    ? `Make ${slugOf(args, ctx)} PUBLIC (today ${before.visibility}): anyone can read the code and its history, including old commits`
    : `Make ${slugOf(args, ctx)} ${args.visibility} (today ${before.visibility})`),
  inverseArgs: ({ args, ctx, before }) => ({ tool: 'github_repo_set_visibility', args: { owner: ownerOf(args, ctx), repo: args.repo, visibility: before.visibility } })
});

const setDefaultBranch = singleField({
  name: 'github_repo_set_default_branch', field: 'default_branch', current: 'default_branch', value: (a) => a.branch,
  description: 'Change the default branch of a repository. The branch must already exist.',
  properties: { branch: { type: 'string', minLength: 1, maxLength: 255 } }, required: ['branch'],
  label: ({ args, ctx, before }) => `Change the default branch of ${slugOf(args, ctx)} from "${before.default_branch}" to "${args.branch}". New pull requests and clones will use it`,
  inverseArgs: ({ args, ctx, before }) => ({ tool: 'github_repo_set_default_branch', args: { owner: ownerOf(args, ctx), repo: args.repo, branch: before.default_branch } })
});

const rename = singleField({
  name: 'github_repo_rename', field: 'name', current: 'name', value: (a) => a.name, repoAfter: (a) => a.name,
  description: 'Rename a repository. GitHub keeps a redirect from the old name, but links in scripts and settings may still need updating.',
  properties: { name: { ...REPO, description: 'The new name' } }, required: ['name'],
  label: ({ args, ctx }) => `Rename ${slugOf(args, ctx)} to ${ownerOf(args, ctx)}/${args.name}`,
  inverseArgs: ({ args, ctx }) => ({ tool: 'github_repo_rename', args: { owner: ownerOf(args, ctx), repo: args.name, name: args.repo } })
});

const setArchived = singleField({
  name: 'github_repo_set_archived', field: 'archived', current: 'archived', value: (a) => a.archived,
  description: 'Archive a repository (read-only for everyone) or unarchive it.',
  properties: { archived: { type: 'boolean' } }, required: ['archived'],
  label: ({ args, ctx, before }) => (args.archived ? `Archive ${slugOf(args, ctx)}: it becomes read-only (today ${before.archived ? 'already archived' : 'active'})` : `Unarchive ${slugOf(args, ctx)} (today ${before.archived ? 'archived' : 'already active'})`),
  inverseArgs: ({ args, ctx, before }) => ({ tool: 'github_repo_set_archived', args: { owner: ownerOf(args, ctx), repo: args.repo, archived: !!before.archived } })
});

const transfer = defineGithubWrite({
  name: 'github_repo_transfer', area: 'repo', audience: ['O'],
  description: 'Transfer a repository to another owner. The new owner may have to accept; this cannot be undone from here.',
  properties: { ...REPO_ARGS, newOwner: { type: 'string', maxLength: 39 }, newName: { ...REPO, description: 'Optional new name' } },
  required: ['repo', 'newOwner'],
  declarations: { production: 'always', confirm: 'always', accessWidening: true, cred: 'U', profiles: ['full'] },
  target, read: readRepo,
  classify: ({ args, ctx }) => accessChange({ who: args.newOwner, access: 'ownership', where: slugOf(args, ctx) }),
  summarize: ({ args, ctx, before }) => (before ? `Transfer ${slugOf(args, ctx)} to ${args.newOwner}${args.newName ? ` as ${args.newName}` : ''}. ${args.newOwner} becomes the owner and may have to accept first` : `${slugOf(args, ctx)} does not exist`),
  apply: async ({ args, ctx, before }) => (need(before, args, ctx), (await clientFor(ctx, args, 'U')).request('POST /repos/{owner}/{repo}/transfer', cleanBody({ ...repoParams(args, ctx), new_owner: args.newOwner, new_name: args.newName }))),
  readAfter: async ({ args, ctx }) => ({ moved: await callOrNull(ctx, args, GET_REPO, { owner: args.newOwner, repo: args.newName ?? args.repo }) }),
  verify: ({ response }) => response?.status === 202,
  present: ({ args, after }) => ({ requested: `${args.newOwner}/${args.newName ?? args.repo}`, status: after.moved ? 'already at the new owner' : 'GitHub accepted the request; the new owner may have to accept it' })
});

const del = defineGithubWrite({
  name: 'github_repo_delete', area: 'repo', audience: ['O'],
  description: 'Delete a repository and everything in it. This server cannot undo it. Type the repository name in confirmName.',
  properties: { ...REPO_ARGS, confirmName: { type: 'string', maxLength: 100, description: 'The repository name again, to show you mean it' } },
  required: ['repo', 'confirmName'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => {
    if (args.confirmName !== args.repo) throw new TypeError('confirmName must be exactly the repository name.');
    return target(args, ctx);
  },
  read: readRepo, classify: () => ({}),
  summarize: ({ args, ctx, before }) => (before ? `DELETE ${slugOf(args, ctx)} permanently (${before.visibility}, ${before.forks_count} forks, last push ${before.pushed_at}). This server cannot restore it` : `${slugOf(args, ctx)} does not exist`),
  apply: async ({ args, ctx, before }) => (need(before, args, ctx), (await clientFor(ctx, args)).request('DELETE /repos/{owner}/{repo}', repoParams(args, ctx))),
  readAfter: ({ args, ctx }) => readRepo(args, ctx), verify: ({ after }) => after === null,
  present: ({ args, ctx }) => ({ deleted: slugOf(args, ctx) })
});

// ---------------------------------------------------------------- forks, properties, stars

const fork = defineGithubWrite({
  name: 'github_repo_fork', area: 'repo', audience: ['B'],
  description: 'Fork a repository into your account or an organization. Uses your own sign-in.',
  properties: { owner: { ...OWNER, description: 'Owner of the repository to fork' }, repo: REPO, organization: { type: 'string', maxLength: 39, description: 'Fork into this organization (default: your account)' }, name: REPO, defaultBranchOnly: { type: 'boolean' } },
  required: ['owner', 'repo'],
  declarations: { production: 'never', cred: 'U' },
  target: (args, ctx) => ({ owner: args.organization ?? ctx.connection.default_account, repo: args.name ?? args.repo, scope: 'repo' }),
  read: (args, ctx) => callOrNull(ctx, { owner: args.organization ?? ctx.connection.default_account }, GET_REPO, { owner: args.organization ?? ctx.connection.default_account, repo: args.name ?? args.repo }),
  classify: () => ({}),
  summarize: ({ args, before }) => (before ? `${before.full_name} already exists, so nothing is forked` : `Fork ${args.owner}/${args.repo}${args.organization ? ` into ${args.organization}` : ' into your account'}${args.name ? ` as ${args.name}` : ''}`),
  apply: async ({ args, ctx, before }) => {
    if (before) throw refuse(`${before.full_name} already exists.`);
    return (await clientFor(ctx, { owner: args.organization }, 'U')).request('POST /repos/{owner}/{repo}/forks', cleanBody({ owner: args.owner, repo: args.repo, organization: args.organization, name: args.name, default_branch_only: args.defaultBranchOnly }));
  },
  readAfter: async ({ response }) => response?.data ?? null,
  verify: ({ after }) => !!after?.fork,
  present: ({ after }) => ({ fork: after.full_name, note: 'GitHub finishes copying in the background; the files may take a moment to appear.' })
});

const syncFork = defineGithubWrite({
  name: 'github_repo_sync_fork', area: 'repo', audience: ['B'],
  description: 'Bring a fork\'s branch up to date with its upstream repository.',
  properties: { ...REPO_ARGS, branch: { type: 'string', minLength: 1, maxLength: 255, description: 'Default: the fork\'s default branch' } },
  required: ['repo'],
  declarations: { production: 'when-target' },
  target, read: readRepo,
  classify: async ({ args, ctx, before }) => ({ production: await productionReason(ctx, { owner: ownerOf(args, ctx), repo: args.repo, ref: args.branch ?? before?.default_branch, scope: 'repo' }) }),
  summarize: ({ args, ctx, before }) => (before ? `Bring ${before.fork ? `${slugOf(args, ctx)} (a fork of ${before.parent?.full_name})` : `${slugOf(args, ctx)}`} branch "${args.branch ?? before.default_branch}" up to date with its upstream` : `${slugOf(args, ctx)} does not exist`),
  apply: async ({ args, ctx, before }) => {
    if (!need(before, args, ctx).fork) throw refuse(`${slugOf(args, ctx)} is not a fork.`);
    return (await clientFor(ctx, args)).request('POST /repos/{owner}/{repo}/merge-upstream', { ...repoParams(args, ctx), branch: args.branch ?? before.default_branch });
  },
  readAfter: async ({ response }) => response?.data ?? null,
  verify: ({ after }) => typeof after?.merge_type === 'string',
  present: ({ after }) => ({ result: after.merge_type, message: after.message })
});

const propertyMap = async (args, ctx) => Object.fromEntries((await call(ctx, args, 'GET /repos/{owner}/{repo}/properties/values', repoParams(args, ctx))).map((p) => [p.property_name, p.value]));
/** The values to set, as GitHub wants them: `{ property_name, value }`, with null removing a property. */
function propertyChanges(args) {
  const set = (args.set ?? []).map((p) => {
    if ((p.value === undefined) === (p.values === undefined)) throw new TypeError(`Give either value (text) or values (a list) for "${p.name}".`);
    return { property_name: p.name, value: p.values ?? p.value };
  });
  const remove = (args.remove ?? []).map((name) => ({ property_name: name, value: null }));
  if (!set.length && !remove.length) throw new TypeError('Say what to set or remove.');
  return [...set, ...remove];
}

const setProperties = defineGithubWrite({
  name: 'github_repo_set_custom_properties', area: 'repo', audience: ['O'],
  description: 'Set or remove custom property values on a repository.',
  properties: {
    ...REPO_ARGS,
    set: { type: 'array', maxItems: 30, items: { type: 'object', properties: { name: { type: 'string', maxLength: 100 }, value: { type: 'string', maxLength: 500 }, values: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } } }, required: ['name'], additionalProperties: false } },
    remove: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 100 }, description: 'Property names to clear' }
  },
  required: ['repo'],
  declarations: { production: 'never', profiles: ['full'] },
  target: (args, ctx) => (propertyChanges(args), target(args, ctx)),
  read: propertyMap,
  classify: () => ({}),
  summarize: ({ args, ctx, before }) => `Change custom properties on ${slugOf(args, ctx)}: ${propertyChanges(args).map((c) => `${c.property_name} from ${JSON.stringify(before[c.property_name] ?? null)} to ${JSON.stringify(c.value)}`).join('; ')}`,
  apply: async ({ args, ctx }) => (await clientFor(ctx, args)).request('PATCH /repos/{owner}/{repo}/properties/values', { ...repoParams(args, ctx), properties: propertyChanges(args) }),
  readAfter: ({ args, ctx }) => propertyMap(args, ctx),
  verify: ({ args, after }) => propertyChanges(args).every((c) => JSON.stringify(after[c.property_name] ?? null) === JSON.stringify(c.value)),
  inverse: ({ args, ctx, before }) => {
    const back = propertyChanges(args).map((c) => ({ name: c.property_name, was: before[c.property_name] ?? null }));
    const set = back.filter((b) => b.was !== null).map((b) => (Array.isArray(b.was) ? { name: b.name, values: b.was } : { name: b.name, value: String(b.was) }));
    const remove = back.filter((b) => b.was === null).map((b) => b.name);
    return { tool: 'github_repo_set_custom_properties', args: { owner: ownerOf(args, ctx), repo: args.repo, ...(set.length ? { set } : {}), ...(remove.length ? { remove } : {}) } };
  }
});

const star = defineGithubWrite({
  name: 'github_repo_star', area: 'repo', audience: ['Op'],
  description: 'Star or unstar a repository as you (uses your own sign-in).',
  properties: { owner: { ...OWNER, description: 'Owner of the repository' }, repo: REPO, starred: { type: 'boolean', description: 'true to star, false to unstar' } },
  required: ['owner', 'repo', 'starred'],
  declarations: { production: 'never', cred: 'U' },
  target: (args, ctx) => ({ owner: ctx.connection.default_account, scope: 'user' }),
  read: async (args, ctx) => {
    try { await call(ctx, { owner: undefined }, 'GET /user/starred/{owner}/{repo}', { owner: args.owner, repo: args.repo }, 'U'); return true; } catch (error) { if (error?.status === 404) return false; throw error; }
  },
  classify: () => ({}),
  summarize: ({ args, before }) => `${args.starred ? 'Star' : 'Unstar'} ${args.owner}/${args.repo} (today ${before ? 'starred' : 'not starred'})`,
  apply: async ({ args, ctx }) => (await clientFor(ctx, {}, 'U')).request(args.starred ? 'PUT /user/starred/{owner}/{repo}' : 'DELETE /user/starred/{owner}/{repo}', { owner: args.owner, repo: args.repo }),
  readAfter: async ({ args, ctx }) => { try { await call(ctx, {}, 'GET /user/starred/{owner}/{repo}', { owner: args.owner, repo: args.repo }, 'U'); return true; } catch (error) { if (error?.status === 404) return false; throw error; } },
  verify: ({ args, after }) => after === args.starred,
  inverse: ({ args }) => ({ tool: 'github_repo_star', args: { owner: args.owner, repo: args.repo, starred: !args.starred } })
});

const writes = [create, createFromTemplate, updateSettings, setVisibility, setDefaultBranch, rename, setArchived, transfer, del, fork, syncFork, setProperties, star];
const reads = [list, get, find, insights, traffic, activity, getProperties];

export const tools = [...reads, ...writes].map((d) => d.tool);
export const handlers = Object.fromEntries([...reads, ...writes].map((d) => [d.tool.name, d.handler]));

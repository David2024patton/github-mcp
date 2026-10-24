// GOD-4 B: your own Copilot Spaces (list, read, create/edit, delete, collaborators, resources) on the master token.
// `{username}` is always the person the master token belongs to; no argument can name another account.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain } from './github-read.js';
import { missing, refusal } from './github-write.js';
import { accessChange, becomesPublic } from './people-guard.js';
import { hasMaster, masterClient, masterReader, needMasterText, userTarget } from './master-only.js';

// GitHub's description: reading the list/resources needs read:user, a single Space needs repo, collaborators/deletes/resource writes need user.
// Every tool that reads a Space first (all but the list) therefore needs both `user` and `repo`.
const SCOPE = ['user', 'repo'];
const LIST_SCOPE = 'read:user';
const NUM = { type: 'integer', minimum: 1 };
const RID = { type: 'integer', minimum: 1 };
const ACTOR = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9_./-]*$', description: 'User login, or team slug' };
const ROLE = { type: 'string', enum: ['reader', 'writer', 'admin'] };
const METADATA = { type: 'object', additionalProperties: false, minProperties: 1,
  properties: { repository_id: { type: 'integer', minimum: 1 }, file_path: { type: 'string', maxLength: 500 }, text: { type: 'string', maxLength: 20000 }, name: { type: 'string', maxLength: 200 }, number: { type: 'integer', minimum: 1 } } };
const RESOURCE_TYPES = ['repository', 'github_file', 'free_text', 'github_issue', 'github_pull_request'];
const BASE = '/users/{username}/copilot-spaces';
const ONE = `${BASE}/{space_number}`;
const space = (s) => (s ? { number: s.number, name: s.name, description: s.description ?? null, general_instructions: s.general_instructions ?? null, base_role: s.base_role ?? null, html_url: s.html_url ?? null, updated_at: s.updated_at ?? null } : null);
const collab = (c) => ({ actor_type: c.actor_type ?? null, identifier: c.login ?? c.slug ?? c.name ?? (c.id !== undefined ? String(c.id) : null), role: c.role ?? null });
const resource = (r) => ({ id: r.id, resource_type: r.resource_type, metadata: r.metadata ?? {}, updated_at: r.updated_at ?? null });
const get = (gh, login, n) => missing(async () => (await gh.request(`GET ${ONE}`, { username: login, space_number: n })).data);
const collaborators = async (gh, login, n) => ((await gh.request(`GET ${BASE}/{space_number}/collaborators`, { username: login, space_number: n })).data?.collaborators ?? []).map(collab);
const resources = async (gh, login, n) => ((await gh.request(`GET ${BASE}/{space_number}/resources`, { username: login, space_number: n })).data?.resources ?? []).map(resource);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const decl = (extra = {}) => ({ production: 'always', confirm: 'always', cred: 'U', profiles: ['full'], ...extra });
// A preview read must not throw when the token is missing (a failed read is treated as production): it flags it instead.
const guarded = (fn) => async (args, ctx, t) => ((await hasMaster(ctx, SCOPE)) ? fn(args, ctx, t) : { needsMaster: true });
const must = (before) => { if (before?.needsMaster) throw refusal(needMasterText(SCOPE), 403); };

const list = defineRead({
  name: 'github_copilot_space_list', area: 'copilot', audience: ['B', 'O'],
  description: 'List your own Copilot Spaces (number, name, instructions, base role). Uses your master token.',
  properties: { max: { type: 'integer', minimum: 1, maximum: 100 } }, required: [],
  handler: (args, ctx) => plain(async () => {
    const { gh, login } = await masterReader(ctx, LIST_SCOPE);
    const spaces = ((await gh.request(`GET ${BASE}`, { username: login, per_page: args.max ?? 50 })).data?.spaces ?? []).map(space);
    return { owner: login, count: spaces.length, spaces };
  })
});
const getTool = defineRead({
  name: 'github_copilot_space_get', area: 'copilot', audience: ['B', 'O'],
  description: 'Read one of your Copilot Spaces: settings, collaborators and resources. Uses your master token.',
  properties: { spaceNumber: NUM }, required: ['spaceNumber'],
  handler: (args, ctx) => plain(async () => {
    const { gh, login } = await masterReader(ctx, SCOPE);
    const s = await get(gh, login, args.spaceNumber);
    if (!s) throw new TypeError(`You have no Copilot Space number ${args.spaceNumber}.`);
    return { ...space(s), collaborators: await collaborators(gh, login, args.spaceNumber), resources: await resources(gh, login, args.spaceNumber) };
  })
});
const collaboratorList = defineRead({
  name: 'github_copilot_space_collaborators', area: 'copilot', audience: ['B', 'O'],
  description: 'List who can use one of your Copilot Spaces and their role. Uses your master token.',
  properties: { spaceNumber: NUM }, required: ['spaceNumber'],
  handler: (args, ctx) => plain(async () => {
    const { gh, login } = await masterReader(ctx, SCOPE);
    return { space: args.spaceNumber, collaborators: await collaborators(gh, login, args.spaceNumber) };
  })
});
const resourceList = defineRead({
  name: 'github_copilot_space_resources', area: 'copilot', audience: ['B', 'O'],
  description: 'List the resources attached to one of your Copilot Spaces, or one resource with resourceId. Uses your master token.',
  properties: { spaceNumber: NUM, resourceId: RID }, required: ['spaceNumber'],
  handler: (args, ctx) => plain(async () => {
    const { gh, login } = await masterReader(ctx, SCOPE);
    if (args.resourceId !== undefined)
      return { resource: resource((await gh.request(`GET ${ONE}/resources/{space_resource_id}`, { username: login, space_number: args.spaceNumber, space_resource_id: args.resourceId })).data) };
    return { space: args.spaceNumber, resources: await resources(gh, login, args.spaceNumber) };
  })
});

const FIELDS = ['name', 'description', 'general_instructions', 'base_role'];
const bodyOf = (a) => Object.fromEntries([['name', a.name], ['description', a.description], ['general_instructions', a.generalInstructions], ['base_role', a.baseRole]].filter(([, v]) => v !== undefined));
const save = defineGithubWrite({
  name: 'github_copilot_space_save', area: 'copilot', audience: ['B', 'O'],
  description: 'Create one of your Copilot Spaces, or edit one with spaceNumber. Read back field by field. Uses your master token.',
  properties: { spaceNumber: NUM, name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 500 }, generalInstructions: { type: 'string', maxLength: 4000 }, baseRole: { type: 'string', enum: ['reader', 'no_access'] } },
  required: [], declarations: decl(), target: userTarget('copilot-space'),
  read: guarded(async (args, ctx) => {
    const { gh, login } = await masterClient(ctx, SCOPE);
    if (args.spaceNumber === undefined) { if (!args.name) throw refusal('A new Copilot Space needs a name.'); return { login, current: null }; }
    if (!Object.keys(bodyOf(args)).length) throw refusal('Give at least one field to change.');
    return { login, current: space(await get(gh, login, args.spaceNumber)) };
  }),
  // base_role "reader" makes the Space PUBLICLY readable (GitHub's description), so a move to it is a public-access change.
  classify: ({ args, before }) => ({ production: 'changes your Copilot Spaces',
    ...(args.baseRole === 'reader' && before?.current?.base_role !== 'reader' ? becomesPublic({ what: `Copilot Space "${args.name ?? before?.current?.name ?? args.spaceNumber}"` }) : {}) }),
  summarize: ({ args, before }) => {
    if (before.needsMaster) return needMasterText(SCOPE);
    const pub = args.baseRole === 'reader' && before.current?.base_role !== 'reader' ? ' It will be PUBLICLY READABLE by anyone (base role reader), not just people you share it with.' : '';
    if (args.spaceNumber === undefined) return `Create Copilot Space "${args.name}" for ${before.login}.${pub}`;
    return before.current ? `Edit Copilot Space ${args.spaceNumber} "${before.current.name}": ${Object.keys(bodyOf(args)).join(', ')}.${pub} Today its base role is ${before.current.base_role}.` : `You have no Copilot Space number ${args.spaceNumber}`;
  },
  apply: async ({ args, ctx, before }) => {
    must(before);
    const { gh, login } = await masterClient(ctx, SCOPE);
    if (login !== before.login) throw refusal('The master token owner changed; nothing was sent.');
    if (args.spaceNumber === undefined) return gh.request(`POST ${BASE}`, { username: login, ...bodyOf(args) });
    if (!before.current) throw refusal(`You have no Copilot Space number ${args.spaceNumber}.`, 404);
    return gh.request(`PUT ${ONE}`, { username: login, space_number: args.spaceNumber, ...bodyOf(args) });
  },
  readAfter: async ({ args, ctx, response }) => {
    const { gh, login } = await masterClient(ctx, SCOPE);
    return { current: space(await get(gh, login, args.spaceNumber ?? response?.data?.number)) };
  },
  verify: ({ args, after }) => !!after.current && FIELDS.every((f) => { const want = bodyOf(args)[f]; return want === undefined || after.current[f] === want; }),
  inverse: ({ args, before }) => (args.spaceNumber !== undefined && before.current
    ? { tool: 'github_copilot_space_save', args: { spaceNumber: args.spaceNumber, ...Object.fromEntries(Object.entries({ name: before.current.name, description: before.current.description, generalInstructions: before.current.general_instructions, baseRole: before.current.base_role })
      .filter(([k, v]) => bodyOf(args)[{ generalInstructions: 'general_instructions', baseRole: 'base_role' }[k] ?? k] !== undefined && typeof v === 'string')) } } : null),
  present: ({ after }) => ({ space: after.current })
});

const del = defineGithubWrite({
  name: 'github_copilot_space_delete', area: 'copilot', audience: ['B', 'O'],
  description: 'Delete one of your Copilot Spaces with its resources and sharing. Cannot be undone. Uses your master token.',
  properties: { spaceNumber: NUM }, required: ['spaceNumber'], declarations: decl(), target: userTarget('copilot-space'),
  read: guarded(async (args, ctx) => { const { gh, login } = await masterClient(ctx, SCOPE); return { login, current: space(await get(gh, login, args.spaceNumber)) }; }),
  classify: () => ({ production: 'permanently deletes a Copilot Space' }),
  summarize: ({ args, before }) => (before.needsMaster ? needMasterText(SCOPE) : before.current ? `DELETE Copilot Space ${args.spaceNumber} "${before.current.name}"; its resources and sharing go with it` : `You have no Copilot Space number ${args.spaceNumber}`),
  apply: async ({ args, ctx, before }) => {
    must(before);
    if (!before.current) throw refusal(`You have no Copilot Space number ${args.spaceNumber}.`, 404);
    const { gh, login } = await masterClient(ctx, SCOPE);
    return gh.request(`DELETE ${ONE}`, { username: login, space_number: args.spaceNumber });
  },
  readAfter: async ({ args, ctx }) => { const { gh, login } = await masterClient(ctx, SCOPE); return { current: await get(gh, login, args.spaceNumber) }; },
  verify: ({ after }) => after.current === null,
  inverse: () => null,
  present: ({ args }) => ({ deleted: args.spaceNumber })
});

const find = (list, who, type) => list.find((c) => same(c.identifier, who) && (!type || c.actor_type === type));
const setCollaborator = defineGithubWrite({
  name: 'github_copilot_space_set_collaborator', area: 'copilot', audience: ['B', 'O'],
  description: 'Give a person or team a role on one of your Copilot Spaces (adds or changes). Widens access. Uses your master token.',
  properties: { spaceNumber: NUM, actorType: { type: 'string', enum: ['User', 'Team'] }, actor: ACTOR, role: ROLE }, required: ['spaceNumber', 'actorType', 'actor', 'role'],
  declarations: decl({ accessWidening: true }), target: userTarget('copilot-space'),
  read: guarded(async (args, ctx) => {
    const { gh, login } = await masterClient(ctx, SCOPE);
    const s = await get(gh, login, args.spaceNumber);
    return { login, exists: !!s, current: s ? (find(await collaborators(gh, login, args.spaceNumber), args.actor, args.actorType) ?? null) : null };
  }),
  classify: ({ args, before }) => accessChange({ who: `${args.actorType} ${args.actor}`, access: args.role, where: `your Copilot Space ${args.spaceNumber}`, before: before?.current?.role ?? 'none' }),
  summarize: ({ args, before }) => (before.needsMaster ? needMasterText(SCOPE) : !before.exists ? `You have no Copilot Space number ${args.spaceNumber}`
    : before.current?.role === args.role ? `${args.actor} already has ${args.role} on Space ${args.spaceNumber}`
      : `${before.current ? 'Change' : 'Give'} ${args.actorType} ${args.actor} ${args.role} access to Copilot Space ${args.spaceNumber} (today: ${before.current?.role ?? 'none'})`),
  apply: async ({ args, ctx, before }) => {
    must(before);
    if (!before.exists) throw refusal(`You have no Copilot Space number ${args.spaceNumber}.`, 404);
    if (before.current?.role === args.role) throw refusal(`${args.actor} already has ${args.role}; nothing to do.`);
    const { gh, login } = await masterClient(ctx, SCOPE);
    const p = { username: login, space_number: args.spaceNumber };
    return before.current
      ? gh.request(`PUT ${BASE}/{space_number}/collaborators/{actor_type}/{actor_identifier}`, { ...p, actor_type: args.actorType, actor_identifier: args.actor, role: args.role })
      : gh.request(`POST ${BASE}/{space_number}/collaborators`, { ...p, actor_type: args.actorType, actor_identifier: args.actor, role: args.role });
  },
  readAfter: async ({ args, ctx }) => { const { gh, login } = await masterClient(ctx, SCOPE); return { current: find(await collaborators(gh, login, args.spaceNumber), args.actor, args.actorType) ?? null }; },
  verify: ({ args, after }) => after.current?.role === args.role,
  inverse: ({ args, before }) => (before.exists
    ? (before.current ? { tool: 'github_copilot_space_set_collaborator', args: { spaceNumber: args.spaceNumber, actorType: args.actorType, actor: args.actor, role: before.current.role } }
      : { tool: 'github_copilot_space_remove_collaborator', args: { spaceNumber: args.spaceNumber, actorType: args.actorType, actor: args.actor } }) : null),
  present: ({ args, after }) => ({ space: args.spaceNumber, collaborator: after.current })
});

const removeCollaborator = defineGithubWrite({
  name: 'github_copilot_space_remove_collaborator', area: 'copilot', audience: ['B', 'O'],
  description: 'Remove a person or team from one of your Copilot Spaces. Uses your master token.',
  properties: { spaceNumber: NUM, actorType: { type: 'string', enum: ['User', 'Team'] }, actor: ACTOR }, required: ['spaceNumber', 'actorType', 'actor'],
  declarations: decl(), target: userTarget('copilot-space'),
  read: guarded(async (args, ctx) => {
    const { gh, login } = await masterClient(ctx, SCOPE);
    const s = await get(gh, login, args.spaceNumber);
    return { login, exists: !!s, current: s ? (find(await collaborators(gh, login, args.spaceNumber), args.actor, args.actorType) ?? null) : null };
  }),
  classify: () => ({ production: 'changes who can use a Copilot Space' }),
  summarize: ({ args, before }) => (before.needsMaster ? needMasterText(SCOPE) : !before.exists ? `You have no Copilot Space number ${args.spaceNumber}`
    : before.current ? `Remove ${args.actorType} ${args.actor} (${before.current.role}) from Copilot Space ${args.spaceNumber}` : `${args.actor} is not on Copilot Space ${args.spaceNumber}`),
  apply: async ({ args, ctx, before }) => {
    must(before);
    if (!before.current) throw refusal(`${args.actor} is not a collaborator on Space ${args.spaceNumber}.`, 404);
    const { gh, login } = await masterClient(ctx, SCOPE);
    return gh.request(`DELETE ${BASE}/{space_number}/collaborators/{actor_type}/{actor_identifier}`, { username: login, space_number: args.spaceNumber, actor_type: args.actorType, actor_identifier: args.actor });
  },
  readAfter: async ({ args, ctx }) => { const { gh, login } = await masterClient(ctx, SCOPE); return { current: find(await collaborators(gh, login, args.spaceNumber), args.actor, args.actorType) ?? null }; },
  verify: ({ after }) => after.current === null,
  inverse: ({ args, before }) => (before.current ? { tool: 'github_copilot_space_set_collaborator', args: { spaceNumber: args.spaceNumber, actorType: args.actorType, actor: args.actor, role: before.current.role } } : null),
  present: ({ args }) => ({ removed: args.actor, space: args.spaceNumber })
});

const setResource = defineGithubWrite({
  name: 'github_copilot_space_set_resource', area: 'copilot', audience: ['B', 'O'],
  description: 'Attach a resource (repository, file, text, issue, PR) to your Copilot Space, or change one with resourceId. Uses your master token.',
  properties: { spaceNumber: NUM, resourceId: RID, resourceType: { type: 'string', enum: RESOURCE_TYPES, description: 'Needed when attaching a new resource' }, metadata: METADATA },
  required: ['spaceNumber', 'metadata'], declarations: decl(), target: userTarget('copilot-space'),
  read: guarded(async (args, ctx) => {
    if (args.resourceId === undefined && !args.resourceType) throw refusal('Attaching a new resource needs resourceType.');
    const { gh, login } = await masterClient(ctx, SCOPE);
    const s = await get(gh, login, args.spaceNumber);
    const all = s ? await resources(gh, login, args.spaceNumber) : [];
    return { login, exists: !!s, current: args.resourceId === undefined ? null : (all.find((r) => r.id === args.resourceId) ?? null), existing: all.map((r) => r.id) };
  }),
  classify: () => ({ production: 'changes what a Copilot Space can read' }),
  summarize: ({ args, before }) => (before.needsMaster ? needMasterText(SCOPE) : !before.exists ? `You have no Copilot Space number ${args.spaceNumber}`
    : args.resourceId === undefined ? `Attach a ${args.resourceType} resource to Copilot Space ${args.spaceNumber}`
      : before.current ? `Change resource ${args.resourceId} of Copilot Space ${args.spaceNumber}` : `Space ${args.spaceNumber} has no resource ${args.resourceId}`),
  apply: async ({ args, ctx, before }) => {
    must(before);
    if (!before.exists) throw refusal(`You have no Copilot Space number ${args.spaceNumber}.`, 404);
    const { gh, login } = await masterClient(ctx, SCOPE);
    const p = { username: login, space_number: args.spaceNumber };
    if (args.resourceId === undefined) return gh.request(`POST ${BASE}/{space_number}/resources`, { ...p, resource_type: args.resourceType, metadata: args.metadata });
    if (!before.current) throw refusal(`Space ${args.spaceNumber} has no resource ${args.resourceId}.`, 404);
    return gh.request(`PUT ${ONE}/resources/{space_resource_id}`, { ...p, space_resource_id: args.resourceId, metadata: args.metadata });
  },
  readAfter: async ({ args, ctx, before, response }) => {
    const { gh, login } = await masterClient(ctx, SCOPE);
    const all = await resources(gh, login, args.spaceNumber);
    const id = args.resourceId ?? response?.data?.id ?? all.find((r) => !before.existing.includes(r.id))?.id;
    return { current: all.find((r) => r.id === id) ?? null };
  },
  verify: ({ args, after }) => !!after.current && Object.entries(args.metadata).every(([k, v]) => after.current.metadata?.[k] === v),
  inverse: ({ args, before }) => (args.resourceId !== undefined && before.current ? { tool: 'github_copilot_space_set_resource', args: { spaceNumber: args.spaceNumber, resourceId: args.resourceId, metadata: before.current.metadata } } : null),
  present: ({ args, after }) => ({ space: args.spaceNumber, resource: after.current })
});

const removeResource = defineGithubWrite({
  name: 'github_copilot_space_remove_resource', area: 'copilot', audience: ['B', 'O'],
  description: 'Detach a resource from one of your Copilot Spaces. Uses your master token.',
  properties: { spaceNumber: NUM, resourceId: RID }, required: ['spaceNumber', 'resourceId'], declarations: decl(), target: userTarget('copilot-space'),
  read: guarded(async (args, ctx) => {
    const { gh, login } = await masterClient(ctx, SCOPE);
    const s = await get(gh, login, args.spaceNumber);
    return { login, exists: !!s, current: s ? ((await resources(gh, login, args.spaceNumber)).find((r) => r.id === args.resourceId) ?? null) : null };
  }),
  classify: () => ({ production: 'changes what a Copilot Space can read' }),
  summarize: ({ args, before }) => (before.needsMaster ? needMasterText(SCOPE) : before.current ? `Detach resource ${args.resourceId} (${before.current.resource_type}) from Copilot Space ${args.spaceNumber}` : `Space ${args.spaceNumber} has no resource ${args.resourceId}`),
  apply: async ({ args, ctx, before }) => {
    must(before);
    if (!before.current) throw refusal(`Space ${args.spaceNumber} has no resource ${args.resourceId}.`, 404);
    const { gh, login } = await masterClient(ctx, SCOPE);
    return gh.request(`DELETE ${ONE}/resources/{space_resource_id}`, { username: login, space_number: args.spaceNumber, space_resource_id: args.resourceId });
  },
  readAfter: async ({ args, ctx }) => { const { gh, login } = await masterClient(ctx, SCOPE); return { current: (await resources(gh, login, args.spaceNumber)).find((r) => r.id === args.resourceId) ?? null }; },
  verify: ({ after }) => after.current === null,
  inverse: ({ args, before }) => (before.current ? { tool: 'github_copilot_space_set_resource', args: { spaceNumber: args.spaceNumber, resourceType: before.current.resource_type, metadata: before.current.metadata } } : null),
  present: ({ args }) => ({ removed: args.resourceId, space: args.spaceNumber })
});

const reads = [list, getTool, collaboratorList, resourceList];
const writes = [save, del, setCollaborator, removeCollaborator, setResource, removeResource];
export const tools = [...reads, ...writes].map((d) => d.tool);
export const handlers = Object.fromEntries([...reads, ...writes].map((d) => [d.tool.name, d.handler]));

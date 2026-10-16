// Y-4b: fields, views, items and status updates of a Projects v2 board. Same shape as projects-manage.js: read first,
// prove the project belongs to a connected account, one mutation, read back. Two rules matter most here:
//  - a single-select option list is replaced as a whole by GitHub, so existing options are always sent back WITH their
//    ids unless the caller names them in removeOptions (otherwise every item would silently lose its value);
//  - deleting a field, an item or a view says exactly what is lost and has no undo.
import { graphql } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { refusal } from './github-write.js';
import { LOGIN } from './public-read.js';
import { notifyOutsiders } from './people-guard.js';
import { OWNER, NUMBER, NODE_ID, COLORS, projectTarget, loadProject, reloadProject, requireEnrolled, readItem, shapeItem, itemTitle, projectClient } from './projects-gql.js';

const low = (s) => String(s).toLowerCase();
const OPTION = { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 50 }, color: { type: 'string', enum: COLORS }, description: { type: 'string', maxLength: 100 } } };
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const SELECT_TYPES = ['SINGLE_SELECT', 'MULTI_SELECT'];

/** The option list to send: every current option (with its id) unless removed, edits applied by name, new names appended. */
export function mergeOptions(current = [], wanted = [], remove = []) {
  const have = new Map(current.map((o) => [low(o.name), o]));
  const gone = new Set(remove.map(low));
  for (const name of remove) if (!have.has(low(name))) throw refusal(`removeOptions names "${name}", which is not an option of this field.`);
  const seen = new Set();
  for (const w of wanted) {
    if (seen.has(low(w.name))) throw refusal(`Option "${w.name}" is listed twice.`);
    seen.add(low(w.name));
    if (gone.has(low(w.name))) throw refusal(`Option "${w.name}" is both kept and removed.`);
  }
  const out = [];
  for (const cur of current) {
    if (gone.has(low(cur.name))) continue;
    const w = wanted.find((x) => low(x.name) === low(cur.name));
    out.push({ id: cur.id, name: cur.name, color: w?.color ?? cur.color, description: w?.description ?? cur.description ?? '' });
  }
  for (const w of wanted) if (!have.has(low(w.name))) out.push({ name: w.name, color: w.color ?? 'GRAY', description: w.description ?? '' });
  if (out.length < 1 || out.length > 50) throw refusal('A select field needs between 1 and 50 options.');
  return out;
}
const optionsOf = (field) => (field?.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color, description: o.description ?? '' }));
const fieldById = (project, id) => (project.fields?.nodes ?? []).find((f) => f?.id === id) ?? null;

// ---- field save -----------------------------------------------------------------------------------------------------
const FIELD_INPUT_KEYS = { SINGLE_SELECT: 'singleSelectOptions', MULTI_SELECT: 'multiSelectOptions' };
const fieldSave = defineGithubWrite({
  name: 'github_project_field_save', area: 'project', audience: ['Op', 'O'],
  description: 'Create a project field (text, number, date, select, iteration) or edit one. Select options keep their ids; list removeOptions to drop any.',
  properties: { owner: OWNER, number: NUMBER, fieldId: NODE_ID, name: { type: 'string', minLength: 1, maxLength: 100 }, dataType: { type: 'string', enum: ['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'ITERATION'] },
    options: { type: 'array', items: OPTION, maxItems: 50 }, removeOptions: { type: 'array', items: { type: 'string', maxLength: 50 }, maxItems: 50 },
    iterations: { type: 'object', additionalProperties: false, required: ['startDate', 'duration', 'items'], properties: { startDate: DATE, duration: { type: 'integer', minimum: 1, maximum: 365 }, items: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['title', 'startDate', 'duration'], properties: { title: { type: 'string', maxLength: 100 }, startDate: DATE, duration: { type: 'integer', minimum: 1, maximum: 365 } } } } } } },
  required: ['number'],
  declarations: { production: 'never', confirm: 'always', cred: 'I,U', profiles: ['full'] },
  target: projectTarget,
  read: async (args, ctx, target) => {
    const { project } = await loadProject(ctx, target.owner, args.number);
    if (!args.fieldId) {
      if (!args.name || !args.dataType) throw refusal('A new field needs name and dataType.');
      if (SELECT_TYPES.includes(args.dataType) && !(args.options?.length)) throw refusal('A select field needs at least one option.');
      if (!SELECT_TYPES.includes(args.dataType) && (args.options || args.removeOptions)) throw refusal('Options only apply to select fields.');
      if (args.dataType === 'ITERATION' && !args.iterations) throw refusal('An iteration field needs iterations (startDate, duration, items).');
      if (args.dataType !== 'ITERATION' && args.iterations) throw refusal('iterations only apply to an iteration field.');
      return { project, field: null, exists: !!fieldBy(project, args.name), merged: SELECT_TYPES.includes(args.dataType) ? mergeOptions([], args.options) : null };
    }
    const field = fieldById(project, args.fieldId);
    if (!field) throw refusal('That field is not in this project.');
    if (args.iterations) throw refusal('Iteration schedules can only be edited on the web (GitHub replaces all iterations at once). Rename the field or use the web page; see github_where_is_setting.');
    if (args.dataType && args.dataType !== field.dataType) throw refusal('A field\'s type cannot be changed.');
    if (!SELECT_TYPES.includes(field.dataType) && (args.options || args.removeOptions)) throw refusal('Options only apply to select fields.');
    if (args.name === undefined && !args.options && !args.removeOptions) throw refusal('Say what to change: name, options or removeOptions.');
    const merged = SELECT_TYPES.includes(field.dataType) && (args.options || args.removeOptions) ? mergeOptions(optionsOf(field), args.options, args.removeOptions) : null;
    return { project, field, merged };
  },
  classify: () => ({}),
  summarize: ({ args, before }) => (before.field
    ? `Edit field "${before.field.name}" of project #${args.number}${args.name ? ` (rename to "${args.name}")` : ''}${before.merged ? `; options after: ${before.merged.map((o) => o.name).join(', ')}` : ''}`
    : `Add ${args.dataType} field "${args.name}" to project #${args.number}`),
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (project.id !== before.project.id) throw refusal('The project changed.');
    if (!before.field) {
      if (before.exists) throw refusal(`A field named "${args.name}" already exists; nothing was created.`);
      const input = { projectId: project.id, name: args.name, dataType: args.dataType };
      if (before.merged) input[FIELD_INPUT_KEYS[args.dataType]] = before.merged;
      if (args.iterations) input.iterationConfiguration = { startDate: args.iterations.startDate, duration: args.iterations.duration, iterations: args.iterations.items };
      return { data: (await graphql(gh, 'mutation($input: CreateProjectV2FieldInput!) { createProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2FieldCommon { id } } } }', { input })).createProjectV2Field };
    }
    const input = { fieldId: before.field.id };
    if (args.name !== undefined) input.name = args.name;
    if (before.merged) input[FIELD_INPUT_KEYS[before.field.dataType]] = before.merged;
    return { data: (await graphql(gh, 'mutation($input: UpdateProjectV2FieldInput!) { updateProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2FieldCommon { id } } } }', { input })).updateProjectV2Field };
  },
  readAfter: async ({ ctx, target, before, response }) => {
    const project = await reloadProject(ctx, target.owner, before.project.id);
    return { project, fieldId: before.field?.id ?? response?.data?.projectV2Field?.id ?? null };
  },
  verify: ({ args, before, after }) => {
    const f = after.project && fieldById(after.project, after.fieldId);
    if (!f) return false;
    if (args.name !== undefined && f.name !== args.name) return false;
    if (!before.field && f.dataType !== args.dataType) return false;
    if (before.merged) {
      const got = optionsOf(f);
      if (got.length !== before.merged.length || before.merged.some((m) => !got.some((g) => low(g.name) === low(m.name)))) return false;
      // Surviving options must keep their ids, otherwise items lost their value.
      return before.merged.filter((m) => m.id).every((m) => got.some((g) => g.id === m.id));
    }
    return true;
  },
  inverse: ({ args, before, target, after }) => {
    if (!before.field) return after.fieldId ? { tool: 'github_project_field_delete', args: { owner: target.owner, number: args.number, fieldId: after.fieldId } } : null;
    return args.name !== undefined && args.name !== before.field.name && !before.merged ? { tool: 'github_project_field_save', args: { owner: target.owner, number: args.number, fieldId: before.field.id, name: before.field.name } } : null;
  },
  present: ({ after }) => { const f = fieldById(after.project, after.fieldId); return { field: { id: f.id, name: f.name, dataType: f.dataType, options: optionsOf(f).map((o) => ({ id: o.id, name: o.name, color: o.color })) } }; }
});
function fieldBy(project, name) { return (project.fields?.nodes ?? []).find((f) => f && low(f.name) === low(name)) ?? null; }

// ---- field delete ---------------------------------------------------------------------------------------------------
const VALUES_QUERY = 'query FieldValues($id: ID!) { node(id: $id) { ... on ProjectV2 { items(first: 100) { totalCount nodes { fieldValues(first: 50) { nodes { ... on ProjectV2ItemFieldValueCommon { field { ... on ProjectV2FieldCommon { id } } } } } } } } } }';
const fieldDelete = defineGithubWrite({
  name: 'github_project_field_delete', area: 'project', audience: ['O'],
  description: 'Delete a custom project field and every value stored in it. The preview says how many items hold a value. No undo.',
  properties: { owner: OWNER, number: NUMBER, fieldId: NODE_ID },
  required: ['number', 'fieldId'],
  declarations: { production: 'always', confirm: 'always', cred: 'I,U', profiles: ['full'] },
  target: projectTarget,
  read: async (args, ctx, target) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    const field = fieldById(project, args.fieldId);
    if (!field) return { project, field: null };
    if (['Title', 'Assignees', 'Status', 'Labels', 'Linked pull requests', 'Milestone', 'Repository', 'Reviewers', 'Parent issue', 'Sub-issues progress'].includes(field.name) && !SELECT_TYPES.includes(field.dataType) && field.__typename === 'ProjectV2Field') throw refusal('Built-in fields cannot be deleted.');
    const items = (await graphql(gh, VALUES_QUERY, { id: project.id })).node?.items;
    const nodes = items?.nodes ?? [];
    const withValue = nodes.filter((n) => (n?.fieldValues?.nodes ?? []).some((v) => v?.field?.id === field.id)).length;
    return { project, field, withValue, total: items?.totalCount ?? nodes.length, sampled: (items?.totalCount ?? nodes.length) > nodes.length };
  },
  classify: ({ before }) => (!before?.field ? {} : { production: `deleting field "${before?.field?.name}" erases its value on ${before?.withValue}${before?.sampled ? '+' : ''} items and cannot be undone` }),
  summarize: ({ args, before }) => !before.field ? 'The field no longer exists' : `DELETE field "${before.field.name}" of project #${args.number}: ${before.withValue}${before.sampled ? '+ (first 100 items checked)' : ''} of ${before.total} items hold a value (no undo)`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (!before.field) throw refusal('The field no longer exists; nothing was deleted.', 404);
    if (project.id !== before.project.id || !fieldById(project, args.fieldId)) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($fieldId: ID!) { deleteProjectV2Field(input: {fieldId: $fieldId}) { clientMutationId } }', { fieldId: args.fieldId })).deleteProjectV2Field };
  },
  readAfter: ({ ctx, target, before }) => reloadProject(ctx, target.owner, before.project.id),
  verify: ({ args, after }) => !!after && !fieldById(after, args.fieldId),
  inverse: () => null,
  present: ({ before }) => ({ deleted: before.field?.name ?? null, valuesLost: before.withValue ?? 0, restorable: false })
});

// ---- views ----------------------------------------------------------------------------------------------------------
const viewSave = defineGithubWrite({
  name: 'github_project_view_save', area: 'project', audience: ['Op', 'O'],
  description: 'Add a view (table, board, roadmap) to a project or delete one. Filters, grouping and charts are web-only: see github_where_is_setting.',
  properties: { owner: OWNER, number: NUMBER, action: { type: 'string', enum: ['create', 'delete'] }, name: { type: 'string', minLength: 1, maxLength: 100 }, layout: { type: 'string', enum: ['TABLE_LAYOUT', 'BOARD_LAYOUT', 'ROADMAP_LAYOUT'] }, viewId: NODE_ID },
  required: ['number', 'action'],
  declarations: { production: 'when-target', confirm: 'always', cred: 'I,U', profiles: ['full'] },
  target: projectTarget,
  read: async (args, ctx, target) => {
    const { project } = await loadProject(ctx, target.owner, args.number);
    const views = (project.views?.nodes ?? []).filter(Boolean);
    if (args.action === 'create') {
      if (!args.name || !args.layout) throw refusal('A new view needs name and layout.');
      return { project, views, exists: views.some((v) => low(v.name) === low(args.name)) };
    }
    return { project, views, view: views.find((v) => v.id === args.viewId) ?? null };
  },
  classify: ({ args, before }) => (args.action === 'delete' && before?.view ? { production: `deleting the view "${before?.view?.name}" cannot be undone` } : {}),
  summarize: ({ args, before }) => (args.action === 'create' ? `Add ${args.layout} view "${args.name}" to project #${args.number}` : before.view ? `DELETE view "${before.view.name}" of project #${args.number} (no undo)` : 'The view no longer exists'),
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (project.id !== before.project.id) throw refusal('The project changed.');
    if (args.action === 'create' && before.exists) throw refusal(`A view named "${args.name}" already exists; nothing was created.`);
    if (args.action === 'delete' && !before.view) throw refusal('The view no longer exists; nothing was deleted.', 404);
    if (args.action === 'create') return { data: (await graphql(gh, 'mutation($input: CreateProjectV2ViewInput!) { createProjectV2View(input: $input) { projectV2View { id } } }', { input: { projectId: project.id, name: args.name, layout: args.layout } })).createProjectV2View };
    return { data: (await graphql(gh, 'mutation($viewId: ID!) { deleteProjectV2View(input: {viewId: $viewId}) { clientMutationId } }', { viewId: args.viewId })).deleteProjectV2View };
  },
  readAfter: ({ ctx, target, before }) => reloadProject(ctx, target.owner, before.project.id),
  verify: ({ args, after }) => {
    const views = (after?.views?.nodes ?? []).filter(Boolean);
    return args.action === 'create' ? views.some((v) => v.name === args.name && v.layout === args.layout) : !views.some((v) => v.id === args.viewId);
  },
  inverse: ({ args, target, after }) => {
    if (args.action !== 'create') return null;
    const v = (after.views?.nodes ?? []).find((x) => x?.name === args.name);
    return v ? { tool: 'github_project_view_save', args: { owner: target.owner, number: args.number, action: 'delete', viewId: v.id } } : null;
  },
  present: ({ after }) => ({ views: (after.views?.nodes ?? []).filter(Boolean).map((v) => ({ id: v.id, name: v.name, layout: v.layout })) })
});

// ---- items ----------------------------------------------------------------------------------------------------------
const ITEM = { ...NODE_ID, description: 'Item id from github_project_list_items (starts with PVTI_)' };
const BASE = { owner: OWNER, number: NUMBER };
const itemWrite = (spec) => defineGithubWrite({ area: 'project', audience: ['Op', 'O'], declarations: { production: 'never', confirm: 'always', cred: 'I,U', profiles: ['full'] }, target: projectTarget, classify: () => ({}), ...spec });

const addDraft = itemWrite({
  name: 'github_project_add_draft',
  declarations: { production: 'never', confirm: 'always', notifies: true, cred: 'I,U', profiles: ['full'] },
  description: 'Add a draft item (title and text, not yet an issue) to a project, optionally assigned to people.',
  properties: { ...BASE, title: { type: 'string', minLength: 1, maxLength: 256 }, body: { type: 'string', maxLength: 20000 }, assignees: { type: 'array', maxItems: 10, items: LOGIN } },
  required: ['number', 'title'],
  read: async (args, ctx, target) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    const ids = [];
    for (const login of args.assignees ?? []) {
      const id = (await graphql(gh, 'query UserNode($login: String!) { user(login: $login) { id } }', { login })).user?.id;
      if (!id) throw refusal(`User ${login} was not found.`);
      ids.push(id);
    }
    return { project, assigneeIds: ids };
  },
  classify: ({ args, ctx }) => (args.assignees?.length ? notifyOutsiders(ctx, { logins: args.assignees }) : {}),
  summarize: ({ args, before }) => `Add draft "${args.title}" to project #${args.number} "${before.project.title}"${args.assignees?.length ? `, assigned to ${args.assignees.join(', ')}` : ''}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (project.id !== before.project.id) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($input: AddProjectV2DraftIssueInput!) { addProjectV2DraftIssue(input: $input) { projectItem { id } } }', { input: { projectId: project.id, title: args.title, body: args.body ?? null, assigneeIds: before.assigneeIds.length ? before.assigneeIds : null } })).addProjectV2DraftIssue };
  },
  readAfter: async ({ ctx, target, before, response }) => {
    const { gh } = await projectClient(ctx, target.owner);
    return response?.data?.projectItem?.id ? readItem(gh, before.project.id, response.data.projectItem.id) : null;
  },
  verify: ({ args, after }) => !!after && after.type === 'DRAFT_ISSUE' && itemTitle(after) === args.title,
  inverse: ({ args, target, after }) => (after ? { tool: 'github_project_delete_item', args: { owner: target.owner, number: args.number, itemId: after.id } } : null),
  present: ({ after }) => shapeItem(after)
});

const convertDraft = itemWrite({
  name: 'github_project_convert_draft',
  description: 'Turn a draft item into a real issue in one of your repositories. The issue is created and the item now points at it.',
  properties: { ...BASE, itemId: ITEM, repo: { type: 'string', maxLength: 140, pattern: '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$' } },
  required: ['number', 'itemId', 'repo'],
  read: async (args, ctx, target) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    const item = await readItem(gh, project.id, args.itemId);
    if (!item) throw refusal('That item was not found.');
    const [ro, rn] = args.repo.split('/');
    await requireEnrolled(ctx, ro);
    const repositoryId = (await graphql(gh, 'query RepoNode($o: String!, $n: String!) { repository(owner: $o, name: $n) { id } }', { o: ro, n: rn })).repository?.id;
    if (!repositoryId) throw refusal('That repository was not found or is not visible to this connection.');
    return { project, item, repositoryId };
  },
  summarize: ({ args, before }) => `Convert draft "${itemTitle(before.item)}" into a new issue in ${args.repo} (anyone watching that repository is notified)`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (before.item.type !== 'DRAFT_ISSUE') throw refusal('Only a draft item can be converted.');
    if (project.id !== before.project.id) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($input: ConvertProjectV2DraftIssueItemToIssueInput!) { convertProjectV2DraftIssueItemToIssue(input: $input) { item { id } } }', { input: { itemId: args.itemId, repositoryId: before.repositoryId } })).convertProjectV2DraftIssueItemToIssue };
  },
  readAfter: async ({ args, ctx, target, before }) => { const { gh } = await projectClient(ctx, target.owner); return readItem(gh, before.project.id, args.itemId); },
  verify: ({ args, after }) => !!after && after.content?.__typename === 'Issue' && low(after.content.repository?.nameWithOwner ?? '') === low(args.repo),
  inverse: () => null,
  present: ({ after }) => shapeItem(after)
});

const archiveItem = itemWrite({
  name: 'github_project_archive_item',
  description: 'Archive or unarchive a project item. Archived items are hidden but keep their values.',
  properties: { ...BASE, itemId: ITEM, archived: { type: 'boolean', description: 'true to archive (default), false to restore' } },
  required: ['number', 'itemId'],
  declarations: { production: 'never', confirm: 'when-needed', cred: 'I,U', profiles: ['full'] },
  read: async (args, ctx, target) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    const item = await readItem(gh, project.id, args.itemId);
    if (!item) throw refusal('That item was not found.');
    return { project, item };
  },
  summarize: ({ args, before }) => `${args.archived === false ? 'Restore' : 'Archive'} "${itemTitle(before.item)}" in project #${args.number}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if ((before.item.isArchived === true) === (args.archived !== false)) throw refusal(`The item is already ${before.item.isArchived ? 'archived' : 'not archived'}; nothing to do.`);
    if (project.id !== before.project.id) throw refusal('The project changed.');
    const m = args.archived === false ? 'unarchiveProjectV2Item' : 'archiveProjectV2Item';
    return { data: (await graphql(gh, `mutation($projectId: ID!, $itemId: ID!) { ${m}(input: {projectId: $projectId, itemId: $itemId}) { item { id } } }`, { projectId: project.id, itemId: args.itemId }))[m] };
  },
  readAfter: async ({ args, ctx, target, before }) => { const { gh } = await projectClient(ctx, target.owner); return readItem(gh, before.project.id, args.itemId); },
  verify: ({ args, after }) => !!after && (after.isArchived === true) === (args.archived !== false),
  inverse: ({ args, target }) => ({ tool: 'github_project_archive_item', args: { owner: target.owner, number: args.number, itemId: args.itemId, archived: args.archived === false } }),
  present: ({ after }) => shapeItem(after)
});

const ORDER_QUERY = 'query ItemOrder($id: ID!) { node(id: $id) { ... on ProjectV2 { items(first: 100) { totalCount nodes { id } } } } }';
const order = async (gh, projectId) => { const items = (await graphql(gh, ORDER_QUERY, { id: projectId })).node?.items; return { ids: (items?.nodes ?? []).map((n) => n?.id), total: items?.totalCount ?? 0 }; };
const moveItem = itemWrite({
  name: 'github_project_move_item',
  description: 'Move an item to the top of a project, or right after another item. Works for projects of up to 100 items.',
  properties: { ...BASE, itemId: ITEM, afterItemId: { ...NODE_ID, description: 'Place right after this item; leave out for the top' } },
  required: ['number', 'itemId'],
  declarations: { production: 'never', confirm: 'when-needed', cred: 'I,U', profiles: ['full'] },
  read: async (args, ctx, target) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    const o = await order(gh, project.id);
    if (o.total > o.ids.length) throw refusal('This project has more than 100 items; the new position cannot be verified, so nothing was moved.');
    if (!o.ids.includes(args.itemId)) throw refusal('That item was not found in this project.');
    if (args.afterItemId && !o.ids.includes(args.afterItemId)) throw refusal('afterItemId is not in this project.');
    if (args.afterItemId === args.itemId) throw refusal('An item cannot be placed after itself.');
    const placed = args.afterItemId ? o.ids[o.ids.indexOf(args.itemId) - 1] === args.afterItemId : o.ids[0] === args.itemId;
    return { project, placed, order: o.ids, previousAfter: o.ids[o.ids.indexOf(args.itemId) - 1] ?? null };
  },
  summarize: ({ args }) => `Move item to ${args.afterItemId ? 'right after another item' : 'the top'} in project #${args.number}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (before.placed) throw refusal('The item is already there; nothing to do.');
    if (project.id !== before.project.id) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($input: UpdateProjectV2ItemPositionInput!) { updateProjectV2ItemPosition(input: $input) { clientMutationId } }', { input: { projectId: project.id, itemId: args.itemId, afterId: args.afterItemId ?? null } })).updateProjectV2ItemPosition };
  },
  readAfter: async ({ ctx, target, before }) => { const { gh } = await projectClient(ctx, target.owner); return order(gh, before.project.id); },
  verify: ({ args, after }) => (args.afterItemId ? after.ids[after.ids.indexOf(args.itemId) - 1] === args.afterItemId : after.ids[0] === args.itemId),
  inverse: ({ args, before, target }) => ({ tool: 'github_project_move_item', args: { owner: target.owner, number: args.number, itemId: args.itemId, ...(before.previousAfter ? { afterItemId: before.previousAfter } : {}) } }),
  present: ({ after }) => ({ order: after.ids.slice(0, 20), total: after.ids.length })
});

const CLEAR_QUERY = 'query ItemFieldValue($id: ID!) { node(id: $id) { ... on ProjectV2Item { fieldValues(first: 50) { nodes { ... on ProjectV2ItemFieldValueCommon { field { ... on ProjectV2FieldCommon { id name } } } } } } } }';
const hasValue = async (gh, itemId, fieldId) => ((await graphql(gh, CLEAR_QUERY, { id: itemId })).node?.fieldValues?.nodes ?? []).some((v) => v?.field?.id === fieldId);
const clearField = itemWrite({
  name: 'github_project_clear_field',
  description: 'Clear one field value on a project item (the item and its other values stay).',
  properties: { ...BASE, itemId: ITEM, fieldId: NODE_ID },
  required: ['number', 'itemId', 'fieldId'],
  declarations: { production: 'never', confirm: 'when-needed', cred: 'I,U', profiles: ['full'] },
  read: async (args, ctx, target) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    const field = fieldById(project, args.fieldId);
    if (!field) throw refusal('That field is not in this project.');
    const item = await readItem(gh, project.id, args.itemId);
    if (!item) throw refusal('That item was not found.');
    return { project, field, item, had: await hasValue(gh, args.itemId, args.fieldId) };
  },
  summarize: ({ args, before }) => `Clear "${before.field.name}" on "${itemTitle(before.item)}" in project #${args.number}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (!before.had) throw refusal('That item has no value in that field; nothing to do.');
    if (project.id !== before.project.id) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($input: ClearProjectV2ItemFieldValueInput!) { clearProjectV2ItemFieldValue(input: $input) { clientMutationId } }', { input: { projectId: project.id, itemId: args.itemId, fieldId: args.fieldId } })).clearProjectV2ItemFieldValue };
  },
  readAfter: async ({ args, ctx, target }) => { const { gh } = await projectClient(ctx, target.owner); return { cleared: !(await hasValue(gh, args.itemId, args.fieldId)) }; },
  verify: ({ after }) => after.cleared === true,
  inverse: () => null,
  present: ({ before }) => ({ field: before.field.name, item: itemTitle(before.item), cleared: true })
});

const deleteItem = itemWrite({
  name: 'github_project_delete_item',
  declarations: { production: 'always', confirm: 'always', cred: 'I,U', profiles: ['full'] },
  description: 'Remove an item from a project (its values are lost). The issue or pull request itself is not deleted. No undo.',
  properties: { ...BASE, itemId: ITEM },
  required: ['number', 'itemId'],
  read: async (args, ctx, target) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    return { project, item: await readItem(gh, project.id, args.itemId) };
  },
  classify: ({ before }) => (!before?.item ? {} : { production: `removing "${itemTitle(before?.item)}" from the project erases its field values${before?.item?.type === 'DRAFT_ISSUE' ? ' and the draft itself' : ''}` }),
  summarize: ({ args, before }) => !before.item ? 'The item no longer exists' : `REMOVE "${itemTitle(before.item)}" (${before.item.type}) from project #${args.number}; field values are lost${before.item.type === 'DRAFT_ISSUE' ? ', and the draft is gone' : '; the issue or pull request stays'}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (!before.item) throw refusal('The item no longer exists; nothing was removed.', 404);
    if (project.id !== before.project.id) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($projectId: ID!, $itemId: ID!) { deleteProjectV2Item(input: {projectId: $projectId, itemId: $itemId}) { deletedItemId } }', { projectId: project.id, itemId: args.itemId })).deleteProjectV2Item };
  },
  readAfter: async ({ args, ctx, target, before }) => { const { gh } = await projectClient(ctx, target.owner); return { item: await readItem(gh, before.project.id, args.itemId) }; },
  verify: ({ after }) => after.item === null,
  inverse: () => null,
  present: ({ args, before }) => ({ removed: args.itemId, title: before.item ? itemTitle(before.item) : null, restorable: false })
});

// ---- status updates ---------------------------------------------------------------------------------------------------
const STATUSES = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'INACTIVE', 'COMPLETE'];
const statusUpdate = itemWrite({
  name: 'github_project_status_update',
  description: 'Post a status update (on track, at risk, ...) on a project. Project members are notified, so outsiders need your confirmation.',
  properties: { ...BASE, status: { type: 'string', enum: STATUSES }, startDate: DATE, targetDate: DATE, body: { type: 'string', maxLength: 20000 } },
  required: ['number', 'status'],
  declarations: { production: 'never', confirm: 'always', notifies: true, cred: 'I,U', profiles: ['full'] },
  read: async (args, ctx, target) => {
    if (args.startDate && args.targetDate && args.startDate > args.targetDate) throw refusal('startDate must not be after targetDate.');
    const { project } = await loadProject(ctx, target.owner, args.number);
    return { project };
  },
  summarize: ({ args, before }) => `Post status ${args.status} on project #${args.number} "${before.project.title}" (members are notified)`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (project.id !== before.project.id) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($input: CreateProjectV2StatusUpdateInput!) { createProjectV2StatusUpdate(input: $input) { statusUpdate { id } } }', { input: { projectId: project.id, status: args.status, startDate: args.startDate ?? null, targetDate: args.targetDate ?? null, body: args.body ?? null } })).createProjectV2StatusUpdate };
  },
  readAfter: async ({ ctx, target, response }) => {
    const { gh } = await projectClient(ctx, target.owner);
    const id = response?.data?.statusUpdate?.id;
    return id ? (await graphql(gh, 'query StatusUpdate($id: ID!) { node(id: $id) { ... on ProjectV2StatusUpdate { id status startDate targetDate body project { id } } } }', { id })).node : null;
  },
  verify: ({ args, before, after }) => !!after && after.project?.id === before.project.id && after.status === args.status && (args.targetDate === undefined || after.targetDate === args.targetDate) && (args.startDate === undefined || after.startDate === args.startDate),
  inverse: () => null,
  present: ({ after }) => ({ id: after.id, status: after.status, startDate: after.startDate ?? null, targetDate: after.targetDate ?? null })
});

const writes = [fieldSave, fieldDelete, viewSave, addDraft, convertDraft, archiveItem, moveItem, clearField, deleteItem, statusUpdate];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));

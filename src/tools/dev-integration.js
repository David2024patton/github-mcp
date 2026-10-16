// V-5: read-only "is GitHub set up for the app I am building?" check. Every item comes back ok, missing or unreadable.
// "Unreadable" is never reported as "missing": a refused or plan-limited read says only that it could not be checked.
// Nothing here writes, and no secret or variable VALUE is ever read — only names.
import { defineRead } from './define-read.js';
import { listAll } from '../github/client.js';
import { octo } from './github-write.js';

const NAME = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' };
const LIST = (items, max = 25) => ({ type: 'array', maxItems: max, uniqueItems: true, items });
const SPEC = {
  type: 'object', additionalProperties: false,
  properties: {
    appPermissions: { type: 'object', maxProperties: 40, additionalProperties: { type: 'string', enum: ['read', 'write', 'admin'] }, description: 'GitHub App permission -> level the app needs, e.g. {"contents":"write"}' },
    webhookEvents: LIST({ type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z_*][a-z0-9_*]*$' }),
    secrets: LIST(NAME), variables: LIST(NAME), environments: LIST({ type: 'string', minLength: 1, maxLength: 100 }),
    workflows: LIST({ type: 'string', minLength: 1, maxLength: 200, description: 'Workflow file path such as .github/workflows/ci.yml' }),
    requiredChecks: LIST({ type: 'string', minLength: 1, maxLength: 200 })
  }
};
const RANK = { read: 1, write: 2, admin: 3 };
const settings = (query) => ({ tool: 'github_where_is_setting', args: { query } });
const GONE = new Set([401, 403, 404, 451]);

/** Run one read; any refusal becomes an "unreadable" reason, never an exception and never "missing". */
async function attempt(fn) {
  try { return { ok: true, data: await fn() }; } catch (error) {
    const status = error?.status;
    if (GONE.has(status) || status === 422 || status >= 500 || error instanceof TypeError) {
      return { ok: false, reason: error instanceof TypeError ? error.message : status === 403 || status === 401 ? 'The connected credential is not allowed to read this.' : status === 404 ? 'GitHub did not return this (it may need a paid plan, or the credential cannot see it).' : 'GitHub could not answer just now.' };
    }
    throw error;
  }
}
const row = (area, item, status, detail, fix = null) => ({ area, item, status, detail, ...(fix ? { fix } : {}) });

export async function checkIntegration(ctx, { owner, repo, spec }) {
  const gh = await octo(ctx, owner);
  const p = { owner, repo };
  const rows = [];
  const all = async (route) => {
    const r = await listAll(gh, `GET ${route}`, { ...p, per_page: 100 }, { max: 100 });
    if (r.capped) throw new TypeError('The list is too long to check completely.');
    return r.items;
  };
  // Secrets, variables, workflows and environments answer with {total_count, <key>: [...]}; one full page is enough or the list is too long.
  const envelope = async (route, key) => {
    const data = (await gh.request(`GET ${route}`, { ...p, per_page: 100 })).data;
    if (!Array.isArray(data?.[key]) || (data.total_count ?? 0) > data[key].length) throw new TypeError('The list is too long to check completely.');
    return data[key];
  };
  const unreadable = (area, item, reason, fix) => row(area, item, 'unreadable', reason, fix);

  if (spec.appPermissions && Object.keys(spec.appPermissions).length) {
    const account = await attempt(() => ctx.db.getAccount(owner));
    const have = account.ok && account.data?.credential_kind === 'app' && account.data.installation_status === 'active' ? (account.data.installation_permissions ?? {}) : null;
    for (const [name, need] of Object.entries(spec.appPermissions)) {
      if (!have) rows.push(unreadable('app permission', name, 'No active GitHub App installation is recorded for this account, so its permissions cannot be compared.', settings('change GitHub App permissions')));
      else if ((RANK[have[name]] ?? 0) >= RANK[need]) rows.push(row('app permission', name, 'ok', `The installation has ${have[name]}; ${need} is needed.`));
      else rows.push(row('app permission', name, 'missing', `The installation has ${have[name] ?? 'no'} access to ${name}; ${need} is needed.`, { tool: 'github_check_permissions', args: { account: owner }, then: settings('change GitHub App permissions') }));
    }
  }
  if (spec.webhookEvents?.length) {
    const hooks = await attempt(() => all('/repos/{owner}/{repo}/hooks'));
    for (const event of spec.webhookEvents) {
      const fix = { tool: 'github_webhook_save', args: { owner, repo, url: '<your public https address>', events: [event] } };
      if (!hooks.ok) rows.push(unreadable('webhook event', event, hooks.reason, { tool: 'github_webhook_list', args: { owner, repo } }));
      else if (hooks.data.some((h) => h.active && (h.events ?? []).some((e) => e === event || e === '*'))) rows.push(row('webhook event', event, 'ok', 'An active webhook subscribes to it.'));
      else rows.push(row('webhook event', event, 'missing', 'No active webhook on this repository subscribes to it.', fix));
    }
  }
  for (const [key, area, route, tool] of [['secrets', 'secret', '/repos/{owner}/{repo}/actions/secrets', 'github_secret_set'], ['variables', 'variable', '/repos/{owner}/{repo}/actions/variables', 'github_variable_set']]) {
    if (!spec[key]?.length) continue;
    const found = await attempt(async () => (await envelope(route, key)).map((x) => x.name));
    for (const name of spec[key]) {
      if (!found.ok) rows.push(unreadable(area, name, found.reason, { tool: key === 'secrets' ? 'github_secret_list' : 'github_variable_list', args: { owner, repo } }));
      else if (found.data.includes(name)) rows.push(row(area, name, 'ok', 'The name exists (the value is never read).'));
      else rows.push(row(area, name, 'missing', 'No such name on this repository.', { tool, args: { owner, repo, name }, note: key === 'secrets' ? 'The value is typed on the setup page, never passed through a tool.' : undefined }));
    }
  }
  if (spec.workflows?.length) {
    const found = await attempt(async () => (await envelope('/repos/{owner}/{repo}/actions/workflows', 'workflows')).map((x) => x.path));
    for (const path of spec.workflows) {
      if (!found.ok) rows.push(unreadable('workflow', path, found.reason, { tool: 'github_content_get_tree', args: { owner, repo } }));
      else if (found.data.includes(path)) rows.push(row('workflow', path, 'ok', 'GitHub lists this workflow.'));
      else rows.push(row('workflow', path, 'missing', 'GitHub does not list a workflow at this path (it must be on the default branch).', { tool: 'github_content_put_file', args: { owner, repo, path, content: '<workflow file>' } }));
    }
  }
  if (spec.environments?.length) {
    const found = await attempt(async () => (await envelope('/repos/{owner}/{repo}/environments', 'environments')).map((x) => x.name));
    for (const name of spec.environments) {
      if (!found.ok) rows.push(unreadable('environment', name, found.reason, { tool: 'github_env_list', args: { owner, repo } }));
      else if (found.data.includes(name)) rows.push(row('environment', name, 'ok', 'The environment exists.'));
      else rows.push(row('environment', name, 'missing', 'No such environment.', { tool: 'github_env_save', args: { owner, repo, environment: name } }));
    }
  }
  if (spec.requiredChecks?.length) {
    const info = await attempt(async () => (await gh.request('GET /repos/{owner}/{repo}', p)).data.default_branch);
    const contexts = info.ok ? await attempt(async () => {
      const rules = (await gh.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { ...p, branch: info.data })).data;
      return rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context));
    }) : info;
    for (const check of spec.requiredChecks) {
      if (!contexts.ok) rows.push(unreadable('required check', check, contexts.reason, { tool: 'github_protection_get', args: { owner, repo } }));
      else if (contexts.data.includes(check)) rows.push(row('required check', check, 'ok', `The default branch requires "${check}".`));
      else rows.push(row('required check', check, 'missing', `No rule on the default branch requires "${check}".`, { tool: 'github_protection_set_required_checks', args: { owner, repo, checks: [check] } }));
    }
  }
  return rows;
}

const check = defineRead({
  name: 'github_dev_check_integration', area: 'dev', audience: ['B'],
  description: 'Check, read-only, that GitHub is set up for an app you are building; each item is ok, missing or unreadable with the exact fix.',
  properties: { owner: { type: 'string', maxLength: 39 }, repo: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }, spec: SPEC },
  required: ['repo', 'spec'],
  handler: async (args, ctx) => {
    const owner = String(args.owner ?? ctx.connection?.default_account ?? '');
    const account = ctx.connection?.accounts?.find((a) => a.toLowerCase() === owner.toLowerCase());
    if (!account) throw new TypeError('The account is not in this connection.');
    const spec = args.spec ?? {};
    if (!Object.values(spec).some((v) => (Array.isArray(v) ? v.length : v && Object.keys(v).length))) throw new TypeError('The spec lists nothing to check.');
    const items = await checkIntegration(ctx, { owner: account, repo: args.repo, spec });
    const count = (s) => items.filter((i) => i.status === s).length;
    return { repo: `${account}/${args.repo}`, ok: count('ok'), missing: count('missing'), unreadable: count('unreadable'), all_ok: items.length > 0 && count('ok') === items.length, items,
      note: 'Read-only. "Unreadable" means GitHub or the credential would not say; it does not mean the item is missing.' };
  }
});
export const tools = [check.tool];
export const handlers = { [check.tool.name]: check.handler };

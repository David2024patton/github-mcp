// G-6: GitHub Pages mutation; explicit publication/visibility approval and state-preserving updates.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const SRC = { type: 'string', minLength: 1, maxLength: 255 };
const PATH = { type: 'string', enum: ['/', '/docs'] };
const BUILD = { type: 'string', enum: ['legacy', 'workflow'] };
const ROUTE = '/repos/{owner}/{repo}/pages';
const params = (t) => ({ owner: t.owner, repo: t.repo });
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo', kind: 'repo-settings' });
const siteGet = async (ctx, t) => missing(async () =>
  (await (await octo(ctx, t.owner)).request('GET ' + ROUTE, params(t))).data);
const repoGet = async (ctx, t) =>
  (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}', params(t))).data;
const view = (site) => site === null ? null : ({
  public: site.public, cname: site.cname ?? null, https_enforced: site.https_enforced ?? false,
  build_type: site.build_type ?? (site.source ? 'legacy' : 'workflow'),
  source: site.source ? { branch: site.source.branch, path: site.source.path } : null
});
const desired = (args, site) => {
  if (!site) {
    if (args.cname !== undefined || args.clearCname || args.httpsEnforced !== undefined)
      throw refusal('Create Pages first, then set the custom domain or HTTPS in a second confirmed change.');
    if (args.buildType === 'workflow') {
      if (args.sourceBranch || args.sourcePath) throw refusal('A workflow Pages site cannot also specify a branch source.');
      return { build_type: 'workflow' };
    }
    if (!args.sourceBranch) throw refusal('A new branch-based Pages site requires sourceBranch.');
    return { build_type: 'legacy', source: { branch: args.sourceBranch, path: args.sourcePath ?? '/' } };
  }
  const patch = {};
  if (args.buildType !== undefined) patch.build_type = args.buildType;
  if (args.sourceBranch !== undefined || args.sourcePath !== undefined) {
    if ((args.buildType ?? site.build_type) === 'workflow')
      throw refusal('Workflow Pages cannot use a legacy branch source.');
    if (!site.source && !args.sourceBranch) throw refusal('sourceBranch is required when changing to legacy Pages.');
    patch.source = { branch: args.sourceBranch ?? site.source.branch, path: args.sourcePath ?? site.source.path };
  }
  if (args.cname !== undefined) patch.cname = args.cname;
  if (args.clearCname === true) patch.cname = null;
  if (args.httpsEnforced !== undefined) patch.https_enforced = args.httpsEnforced;
  if (!Object.keys(patch).length) throw refusal('Choose at least one Pages setting to change.');
  return patch;
};
const validate = (args) => {
  if (args.clearCname !== undefined && args.clearCname !== true) throw new TypeError('clearCname must be true.');
  if (args.clearCname && args.cname !== undefined) throw new TypeError('Choose cname or clearCname.');
  if (args.cname !== undefined && (!/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(args.cname) ||
      args.cname.length > 253)) throw new TypeError('cname must be a valid DNS hostname.');
};
const same = (a, b) => JSON.stringify(view(a)) === JSON.stringify(view(b));

const save = defineGithubWrite({
  name: 'github_pages_save', area: 'pages', audience: ['B', 'O'],
  description: 'Create or update Pages source, domain and HTTPS with publication approval.',
  properties: { owner: OWNER, repo: REPO, buildType: BUILD, sourceBranch: SRC, sourcePath: PATH,
    cname: { type: 'string', minLength: 3, maxLength: 253 }, clearCname: { type: 'boolean' },
    httpsEnforced: { type: 'boolean' } },
  required: ['repo'],
  declarations: { production: 'always', accessWidening: true, confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => { validate(args); return target(args, ctx); },
  read: async (_args, ctx, t) => ({ repo: await repoGet(ctx, t), site: await siteGet(ctx, t) }),
  classify: async ({ ctx, target: t, before }) => ({
    production: await productionReason(ctx, t),
    accessWidening: before?.repo?.private && (!before.site || before.site.public !== false)
      ? 'Pages may expose content from this private repository on a public website' : null
  }),
  summarize: ({ args, before, target: t }) => {
    const patch = desired(args, view(before.site));
    return `${before.site ? 'Update' : 'Enable'} Pages on ${slug(t.owner, t.repo)}: ${JSON.stringify(patch)}. Existing settings not named here are preserved; Pages may publish content externally.`;
  },
  apply: async ({ args, before, ctx, target: t }) => {
    const current = await siteGet(ctx, t);
    const repo = await repoGet(ctx, t);
    if (!same(before.site, current) || repo.private !== before.repo.private)
      throw refusal('Pages settings or repository visibility changed after preview; request a fresh preview.');
    const patch = desired(args, view(current));
    return (await octo(ctx, t.owner)).request((current ? 'PUT ' : 'POST ') + ROUTE, { ...params(t), ...patch });
  },
  readAfter: ({ ctx, target: t }) => siteGet(ctx, t),
  verify: ({ args, before, after }) => {
    if (!after) return false;
    const patch = desired(args, view(before.site));
    return Object.entries(patch).every(([key, value]) => {
      if (key === 'source') return JSON.stringify(view(after).source) === JSON.stringify(value);
      return view(after)[key] === value;
    });
  },
  inverse: () => null,
  present: ({ after, target: t }) => ({ repository: slug(t.owner, t.repo), configured: true, settings: view(after) })
});

const disable = defineGithubWrite({
  name: 'github_pages_disable', area: 'pages', audience: ['O'],
  description: 'Disable GitHub Pages publication, subject to production approval.',
  properties: { owner: OWNER, repo: REPO }, required: ['repo'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target,
  read: async (_args, ctx, t) => ({ site: await siteGet(ctx, t) }),
  classify: async ({ ctx, target: t }) => ({ production: await productionReason(ctx, t) }),
  summarize: ({ target: t, before }) => `Disable Pages on ${slug(t.owner, t.repo)} (${before.site?.html_url ?? 'site missing'}). Existing public URLs will stop serving; source files remain.`,
  apply: async ({ before, ctx, target: t }) => {
    if (!before.site) throw refusal('Pages is not configured; nothing to disable.', 404);
    if (!same(before.site, await siteGet(ctx, t))) throw refusal('Pages settings changed after preview.');
    return (await octo(ctx, t.owner)).request('DELETE ' + ROUTE, params(t));
  },
  readAfter: ({ ctx, target: t }) => siteGet(ctx, t),
  verify: ({ before, after }) => !!before.site && after === null,
  inverse: () => null,
  present: ({ target: t }) => ({ repository: slug(t.owner, t.repo), disabled: true, source_files_untouched: true })
});

export const tools = [save.tool, disable.tool];
export const handlers = { [save.tool.name]: save.handler, [disable.tool.name]: disable.handler };

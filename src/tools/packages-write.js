// G-6: package mutations use scope-specific GitHub routes, safe previews and verified read-back.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const TYPE = { type: 'string', enum: ['npm', 'maven', 'rubygems', 'docker', 'nuget', 'container'] };
const NAME = { type: 'string', minLength: 1, maxLength: 255 };
const ID = { type: 'integer', minimum: 1 };
export const packageProperties = { owner: OWNER, scope: { type: 'string', enum: ['org', 'user'] },
  packageType: TYPE, packageName: NAME };
const template = (t) => t.scope === 'org'
  ? '/orgs/{org}/packages/{package_type}/{package_name}'
  : '/user/packages/{package_type}/{package_name}';
const params = (t) => ({
  ...(t.scope === 'org' ? { org: t.owner } : {}),
  package_type: t.type, package_name: t.name
});
const target = (args, ctx) => ({
  owner: ownerOf(args, ctx), scope: args.scope, type: args.packageType, name: args.packageName
});
const get = (ctx, t, id) => missing(async () => (await (await octo(ctx, t.owner, 'P'))
  .request('GET ' + template(t) + (id ? '/versions/{package_version_id}' : ''),
    { ...params(t), ...(id ? { package_version_id: id } : {}) })).data);
const snapshot = (x) => x === null ? null : JSON.stringify({
  id: x.id, name: x.name, visibility: x.visibility, version_count: x.version_count,
  download_count: x.download_count, created_at: x.created_at, updated_at: x.updated_at
});
const ensureDeletable = (pkg, version, id) => {
  if (!pkg || !version || version.id !== id) throw refusal('Package version is missing or cannot be verified; no deletion sent.');
  if (pkg.visibility === 'public' && Number(version.download_count) > 5000)
    throw refusal('GitHub forbids deleting a public package version with more than 5,000 downloads.');
};
export const packageDeleteVersion = defineGithubWrite({
  name: 'github_package_delete_version', area: 'package', audience: ['B'],
  description: 'Delete a verified package version; recovery may be possible for 30 days.',
  properties: { ...packageProperties, versionId: ID },
  required: ['scope', 'packageType', 'packageName', 'versionId'],
  declarations: { cred: 'P', production: 'always', confirm: 'always', profiles: ['full'] },
  target,
  read: async (args, ctx, t) => ({
    pkg: await get(ctx, t), version: await get(ctx, t, args.versionId)
  }),
  classify: async ({ ctx, target: t }) => ({ production: await productionReason(ctx, t) }),
  summarize: ({ args, before, target: t }) =>
    `Delete ${t.scope} package ${t.owner}/${t.name} version ${before.version?.name ?? args.versionId} (${before.version?.download_count ?? 'unknown'} downloads, visibility ${before.pkg?.visibility ?? 'unknown'}). Recovery is only possible for 30 days if the namespace is available. Public packages with over 5,000 downloads cannot be deleted; GitHub enforces this limit.`,
  apply: async ({ args, before, ctx, target: t }) => {
    ensureDeletable(before.pkg, before.version, args.versionId);
    const freshPkg = await get(ctx, t);
    const freshVersion = await get(ctx, t, args.versionId);
    if (snapshot(freshPkg) !== snapshot(before.pkg) || snapshot(freshVersion) !== snapshot(before.version))
      throw refusal('Package or version changed after preview; review its new state.');
    ensureDeletable(freshPkg, freshVersion, args.versionId);
    return (await octo(ctx, t.owner, 'P')).request('DELETE ' + template(t) + '/versions/{package_version_id}',
      { ...params(t), package_version_id: args.versionId });
  },
  readAfter: ({ args, ctx, target: t }) => get(ctx, t, args.versionId),
  verify: ({ after, response }) => response.status === 204 && after === null,
  inverse: () => null,
  present: ({ args, target: t }) => ({ owner: t.owner, scope: t.scope, package: t.name,
    deleted_version_id: args.versionId, restore_window_days: 30 })
});

// A whole package deletion must name its exact version count, not imply an incomplete
// first page contains every version. GitHub itself enforces the public download ceiling.
const listVersions = async (ctx, t) => {
  const { data } = await (await octo(ctx, t.owner, 'P')).request('GET ' + template(t) + '/versions', {
    ...params(t), per_page: 100, page: 1
  });
  if (!Array.isArray(data)) throw refusal('GitHub did not return package versions.');
  return data.map((v) => ({ id: v.id, name: v.name, download_count: v.download_count ?? null }));
};
const complete = (pkg, versions) => {
  if (!pkg) throw refusal('Package not found; nothing can be deleted.', 404);
  if (!Number.isInteger(pkg.version_count) || pkg.version_count < 0 || versions.length !== pkg.version_count)
    throw refusal('Cannot verify the complete version inventory; whole-package deletion refused.');
  if (pkg.visibility === 'public' && versions.some((v) => Number(v.download_count) > 5000))
    throw refusal('GitHub forbids deleting public packages when any version exceeds 5,000 downloads.');
};
const listSignature = (versions) => JSON.stringify(versions.map((v) => [v.id, v.name, v.download_count]));
export const packageDelete = defineGithubWrite({
  name: 'github_package_delete', area: 'package', audience: ['B'],
  description: 'Delete an entire verified package and all versions with a 30-day restore warning.',
  properties: { ...packageProperties },
  required: ['scope', 'packageType', 'packageName'],
  declarations: { cred: 'P', production: 'always', confirm: 'always', profiles: ['full'] },
  target,
  read: async (_args, ctx, t) => {
    const pkg = await get(ctx, t);
    return { pkg, versions: pkg ? await listVersions(ctx, t) : [] };
  },
  classify: async ({ ctx, target: t }) => ({ production: await productionReason(ctx, t) }),
  summarize: ({ target: t, before }) => {
    const count = before.pkg?.version_count;
    return `Delete ALL ${count ?? 'unknown'} versions of ${t.scope} package "${t.owner}/${t.name}" (visibility ${before.pkg?.visibility ?? 'unknown'}). This breaks consumers and restoration is only possible for 30 days while the namespace stays unused. GitHub forbids deleting a public package if ANY version exceeds 5,000 downloads.`;
  },
  apply: async ({ before, ctx, target: t }) => {
    complete(before.pkg, before.versions);
    const pkg = await get(ctx, t);
    const versions = pkg ? await listVersions(ctx, t) : [];
    complete(pkg, versions);
    if (snapshot(pkg) !== snapshot(before.pkg) || listSignature(versions) !== listSignature(before.versions))
      throw refusal('Package or its version inventory changed after preview; request a new preview.');
    return (await octo(ctx, t.owner, 'P')).request('DELETE ' + template(t), params(t));
  },
  readAfter: ({ ctx, target: t }) => get(ctx, t),
  verify: ({ after, response }) => response.status === 204 && after === null,
  inverse: () => null,
  present: ({ before, target: t }) => ({
    deleted_package: t.name, owner: t.owner, scope: t.scope,
    deleted_version_count: before.versions.length, restore_window_days: 30
  })
});

export const tools = [packageDeleteVersion.tool, packageDelete.tool];
export const handlers = { [packageDeleteVersion.tool.name]: packageDeleteVersion.handler, [packageDelete.tool.name]: packageDelete.handler };

// Shared G-6 scope mapping for restore: a single source of truth for org/user routes.
export { get as getPackageRecord, template as packageRoute, params as packageParams, target as packageTarget };

// G-6: restore deleted whole packages or exact version IDs; no secret tokens in tool arguments.
import { defineGithubWrite } from './define-github-write.js';
import { octo, refusal } from './github-write.js';
import { productionReason } from './production-guard.js';
import { packageProperties, getPackageRecord, packageRoute, packageParams, packageTarget } from './packages-write.js';

const ID = { type: 'integer', minimum: 1 };
const fingerprint = (v) => v ? JSON.stringify({
  id: v.id, name: v.name, package_type: v.package_type, updated_at: v.updated_at
}) : null;
const fullPath = (t, id) => packageRoute(t) + (id ? '/versions/{package_version_id}' : '');
const restore = defineGithubWrite({
  name: 'github_package_restore_version', area: 'package', audience: ['B'],
  description: 'Restore a deleted package or one exact version while GitHub retains it (up to 30 days).',
  properties: { ...packageProperties, versionId: ID },
  required: ['scope', 'packageType', 'packageName'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: packageTarget,
  read: async (args, ctx, t) => {
    const parent = args.versionId ? await getPackageRecord(ctx, t) : null;
    const active = await getPackageRecord(ctx, t, args.versionId);
    return { parent, active };
  },
  classify: async ({ ctx, target: t }) => ({ production: await productionReason(ctx, t) }),
  summarize: ({ args, target: t, before }) =>
    `Restore ${args.versionId ? `version ID ${args.versionId} of` : 'entire'} ${t.scope} package "${t.owner}/${t.name}". ${before.active ? 'Target appears active; restoration will be refused.' : 'GitHub can restore only within 30 days and only if the package namespace/version has not been reused.'} This may republish an artifact to consumers.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (before.active) throw refusal('Target already exists; restoration refused.');
    if (args.versionId && !before.parent)
      throw refusal('Parent package is missing; restore the whole package first.');
    // Never restore an ID into a parent package that changed since approval.
    const fresh = await getPackageRecord(ctx, t, args.versionId);
    if (fresh) throw refusal('Target became active after preview; no restore sent.');
    if (args.versionId && fingerprint(await getPackageRecord(ctx, t)) !== fingerprint(before.parent))
      throw refusal('Parent package changed after preview; request a new preview.');
    return (await octo(ctx, t.owner)).request('POST ' + fullPath(t, args.versionId) + '/restore',
      { ...packageParams(t), ...(args.versionId ? { package_version_id: args.versionId } : {}) });
  },
  readAfter: ({ args, ctx, target: t }) => getPackageRecord(ctx, t, args.versionId),
  verify: ({ args, after, response, target: t }) => response.status === 204 &&
    !!after && (args.versionId ? after.id === args.versionId :
      after.name === t.name && after.package_type === t.type),
  inverse: () => null,
  present: ({ args, target: t, after }) => ({
    owner: t.owner, scope: t.scope, package: t.name,
    restored: args.versionId ? 'version' : 'package',
    ...(args.versionId ? { version_id: after.id } : { package_id: after.id })
  })
});

export const tools = [restore.tool];
export const handlers = { [restore.tool.name]: restore.handler };

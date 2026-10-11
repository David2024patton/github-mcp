// G-5 asset deletion. The target release, not the caller, decides whether this is production.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const ID = { type: 'integer', minimum: 1 };
const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const RELEASE = 'GET /repos/{owner}/{repo}/releases/{release_id}';
const ASSET = 'GET /repos/{owner}/{repo}/releases/assets/{asset_id}';
const DELETE = 'DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}';
const params = (t) => ({ owner: t.owner, repo: t.repo });
const getRelease = async (ctx, t, id) => missing(async () =>
  (await (await octo(ctx, t.owner)).request(RELEASE, { ...params(t), release_id: id })).data);
const getAsset = async (ctx, t, id) => missing(async () =>
  (await (await octo(ctx, t.owner)).request(ASSET, { ...params(t), asset_id: id })).data);
const requireMatch = (release, asset, id) => {
  if (!release || !asset || !(release.assets ?? []).some((row) => row.id === id)) {
    throw refusal('Asset not verified in the requested release. No deletion was sent.');
  }
  if (release.immutable && !release.draft) {
    throw refusal('GitHub marks this published release immutable. Asset deletion is refused.');
  }
};
const del = defineGithubWrite({
  name: 'github_release_delete_asset', area: 'release', audience: ['B'],
  description: 'Delete a verified release asset; publishing status decides production approval.',
  properties: { owner: OWNER, repo: REPO, releaseId: ID, assetId: ID },
  required: ['repo', 'releaseId', 'assetId'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' }),
  read: async (args, ctx, t) => {
    const release = await getRelease(ctx, t, args.releaseId);
    const asset = await getAsset(ctx, t, args.assetId);
    requireMatch(release, asset, args.assetId);
    return { release, asset };
  },
  classify: async ({ ctx, target: t, before }) => ({
    production: before.release.draft ? null : await productionReason(ctx, { ...t, kind: 'release' })
  }),
  summarize: ({ target: t, before }) =>
    `Delete "${before.asset.name}" (${before.asset.download_count ?? 'unknown'} downloads) from ${before.release.draft ? 'draft' : 'published'} release "${before.release.tag_name}" in ${slug(t.owner, t.repo)}. The asset cannot be recovered automatically.`,
  apply: async ({ args, before, ctx, target: t }) => {
    // A release published between preview and apply cannot inherit draft permissions.
    const latest = await getRelease(ctx, t, args.releaseId);
    const asset = await getAsset(ctx, t, args.assetId);
    requireMatch(latest, asset, args.assetId);
    if (latest.draft !== before.release.draft ||
        asset.name !== before.asset.name || asset.size !== before.asset.size) {
      throw refusal('Release or asset changed after preview; request a new preview.');
    }
    return (await octo(ctx, t.owner)).request(DELETE, { ...params(t), asset_id: args.assetId });
  },
  readAfter: async ({ args, ctx, target: t }) => getAsset(ctx, t, args.assetId),
  verify: ({ after }) => after === null,
  inverse: () => null,
  present: ({ args, before }) => ({
    deleted_asset_id: args.assetId, name: before.asset.name,
    release_id: args.releaseId, draft: before.release.draft, irreversible: true
  })
});
export const tools = [del.tool];
export const handlers = { [del.tool.name]: del.handler };

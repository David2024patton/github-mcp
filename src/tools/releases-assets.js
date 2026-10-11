// G-5 asset deletion. The target release, not the caller, decides whether this is production.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';
import { publicHttpsUrl, downloadPublicAsset } from '../github/public-url.js';

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
    // Missing items still reach request-key replay: a successful prior deletion
    // must be replayable even though its asset has vanished. apply fails closed.
    return { release, asset };
  },
  classify: async ({ ctx, target: t, before }) => ({
    production: before.release?.draft === true ? null : await productionReason(ctx, { ...t, kind: 'release' })
  }),
  summarize: ({ args, target: t, before }) => !before.asset || !before.release
    ? `Asset ${args.assetId} cannot be verified in release ${args.releaseId} in ${slug(t.owner, t.repo)}; no deletion will be sent.`
    : `Delete "${before.asset.name}" (${before.asset.download_count ?? 'unknown'} downloads) from ${before.release.draft ? 'draft' : 'published'} release "${before.release.tag_name}" in ${slug(t.owner, t.repo)}. The asset cannot be recovered automatically.`,
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

const uploaded = defineGithubWrite({
  name: 'github_release_upload_asset', area: 'release', audience: ['B'],
  description: 'Upload a bounded public HTTPS file to a release without showing file bytes.',
  properties: { owner: OWNER, repo: REPO, releaseId: ID,
    name: { type: 'string', minLength: 1, maxLength: 255 },
    sourceUrl: { type: 'string', minLength: 9, maxLength: 2048 },
    label: { type: 'string', maxLength: 255 } },
  required: ['repo', 'releaseId', 'name', 'sourceUrl'],
  declarations: { production: 'when-target', confirm: 'when-needed', profiles: ['full'] },
  target: (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' }),
  read: async (args, ctx, t) => {
    publicHttpsUrl(args.sourceUrl);
    if (args.name.includes('/') || args.name.includes('\\') || args.name === '.' || args.name === '..') {
      throw refusal('Asset filename must be a plain filename without directory segments.');
    }
    const release = await getRelease(ctx, t, args.releaseId);
    if (!release) throw refusal('Release not found.');
    const expected = `https://uploads.github.com/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/releases/${args.releaseId}/assets{?name,label}`;
    if (release.upload_url !== expected) throw refusal('GitHub returned an unexpected release upload address.');
    if (release.immutable && !release.draft) throw refusal('GitHub marks the published release immutable.');
    return { release, duplicate: (release.assets ?? []).find((a) => a.name === args.name) ?? null };
  },
  classify: async ({ ctx, target: t, before }) => ({
    production: before?.release?.draft === true ? null : await productionReason(ctx, { ...t, kind: 'release' })
  }),
  summarize: ({ args, target: t, before }) => before.duplicate
    ? `Asset "${args.name}" already exists on release "${before.release.tag_name}" in ${slug(t.owner, t.repo)}; it will not be overwritten.`
    : `Upload "${args.name}" from public HTTPS host ${publicHttpsUrl(args.sourceUrl).hostname} (up to 100 MB) to ${before.release.draft ? 'draft' : 'published'} release "${before.release.tag_name}" in ${slug(t.owner, t.repo)}. Source bytes stay on the server.`,
  apply: async ({ args, before, ctx, target: t }) => {
    const current = await getRelease(ctx, t, args.releaseId);
    if (!current || current.draft !== before.release.draft || current.immutable ||
        current.upload_url !== before.release.upload_url ||
        (current.assets ?? []).some((a) => a.name === args.name) || before.duplicate) {
      throw refusal('Release changed, became immutable or contains this filename; request a new preview.');
    }
    const { bytes, size, contentType } = await downloadPublicAsset(args.sourceUrl);
    if (!size) throw refusal('Empty file cannot be uploaded.');
    const response = await (await octo(ctx, t.owner)).request(`POST ${current.upload_url}`, {
      name: args.name, ...(args.label ? { label: args.label } : {}),
      data: bytes, headers: { 'content-type': contentType, 'content-length': size }
    });
    return { ...response, expectedSize: size };
  },
  readAfter: ({ ctx, target: t, response }) => response.status === 201 && Number.isInteger(response.data?.id)
    ? getAsset(ctx, t, response.data.id) : null,
  verify: ({ args, after, response }) => !!after && response.status === 201 &&
    after.id === response.data.id && after.name === args.name &&
    after.size === response.expectedSize && after.state === 'uploaded',
  inverse: () => null,
  present: ({ after, args }) => ({ release_id: args.releaseId, asset_id: after?.id,
    name: after?.name, size: after?.size, download_url: after?.browser_download_url })
});

export const tools = [uploaded.tool, del.tool];
export const handlers = { [uploaded.tool.name]: uploaded.handler, [del.tool.name]: del.handler };


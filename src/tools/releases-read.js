// G-5 release metadata only. No asset bytes, release publication or tag writes.
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';
import { missing } from './github-write.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const LIST = 'GET /repos/{owner}/{repo}/releases';
const ID = 'GET /repos/{owner}/{repo}/releases/{release_id}';
const TAG = 'GET /repos/{owner}/{repo}/releases/tags/{tag}';
const LATEST = 'GET /repos/{owner}/{repo}/releases/latest';
export const releaseView = (release, includeAssets = false) => ({
  id: release.id, tag_name: release.tag_name, name: release.name,
  draft: release.draft, prerelease: release.prerelease, immutable: release.immutable,
  target_commitish: release.target_commitish, body: release.body,
  author: release.author?.login, created_at: release.created_at,
  published_at: release.published_at, html_url: release.html_url,
  asset_count: (release.assets ?? []).length,
  ...(includeAssets ? { assets: (release.assets ?? []).slice(0, 100).map((asset) => ({
    id: asset.id, name: asset.name, label: asset.label, content_type: asset.content_type,
    size: asset.size, download_count: asset.download_count, state: asset.state,
    browser_download_url: asset.browser_download_url, digest: asset.digest
  })), ...((release.assets ?? []).length > 100 ? { more_assets: true } : {}) } : {})
});

export const releaseList = defineRead({
  name: 'github_release_list', area: 'release', audience: ['B', 'Op'],
  description: 'List release tags, draft flags, dates and asset counts.',
  properties: { owner: OWNER, repo: REPO,
    page: { type: 'integer', minimum: 1 },
    max: { type: 'integer', minimum: 1, maximum: 30 } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const page = args.page ?? 1, max = args.max ?? 20;
    const { data } = await octokit.request(LIST, { owner, repo: args.repo, page, per_page: max });
    const rows = Array.isArray(data) ? data : [];
    return { page, count: rows.length, ...(rows.length === max ? { next_page_possible: page + 1 } : {}),
      items: rows.map((release) => releaseView(release)) };
  })
});

export const releaseGet = defineRead({
  name: 'github_release_get', area: 'release', audience: ['B', 'Op'],
  description: 'Read a release by ID, tag or latest; asset metadata only.',
  properties: { owner: OWNER, repo: REPO,
    selector: { type: 'string', enum: ['id', 'tag', 'latest'] },
    releaseId: { type: 'integer', minimum: 1 },
    tag: { type: 'string', minLength: 1, maxLength: 250 } },
  required: ['repo', 'selector'],
  handler: (args, ctx) => plain(async () => {
    if ((args.selector === 'id' && (!args.releaseId || args.tag !== undefined)) ||
      (args.selector === 'tag' && (!args.tag || args.releaseId !== undefined)) ||
      (args.selector === 'latest' && (args.releaseId !== undefined || args.tag !== undefined)))
      throw new TypeError('Use releaseId only with selector=id, tag only with selector=tag, or selector=latest with neither.');
    const { owner, octokit } = await readerFor(args, ctx);
    const route = args.selector === 'id' ? ID : args.selector === 'tag' ? TAG : LATEST;
    const params = { owner, repo: args.repo, ...(args.selector === 'id' ? { release_id: args.releaseId }
      : args.selector === 'tag' ? { tag: args.tag } : {}) };
    const release = await missing(async () => (await octokit.request(route, params)).data);
    return release ? releaseView(release, true) : { not_found: args.selector === 'id'
      ? args.releaseId : args.selector === 'tag' ? args.tag : 'latest published release' };
  })
});
export const tools = [releaseList.tool, releaseGet.tool];
export const handlers = { [releaseList.tool.name]: releaseList.handler, [releaseGet.tool.name]: releaseGet.handler };

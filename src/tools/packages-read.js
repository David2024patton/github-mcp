// G-6 package discovery: distinct organization and user routes, bounded versions.
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39 };
const TYPE = { type: 'string', enum: ['npm', 'maven', 'rubygems', 'docker', 'nuget', 'container'] };
const LIST_ORG = 'GET /orgs/{org}/packages';
const LIST_USER = 'GET /users/{username}/packages';
const VERSIONS_ORG = 'GET /orgs/{org}/packages/{package_type}/{package_name}/versions';
const VERSIONS_USER = 'GET /users/{username}/packages/{package_type}/{package_name}/versions';
const versionView = (v) => ({
  id: v.id, name: v.name, description: v.description, created_at: v.created_at,
  updated_at: v.updated_at, html_url: v.html_url, metadata: v.metadata?.container
    ? { container: { tags: (v.metadata.container.tags ?? []).slice(0, 20) } } : null
});

export const packageList = defineRead({
  name: 'github_package_list', area: 'package', audience: ['B'],
  description: 'List organization or user packages and bounded version details.',
  properties: {
    owner: OWNER, scope: { type: 'string', enum: ['org', 'user'] }, packageType: TYPE,
    page: { type: 'integer', minimum: 1 },
    max: { type: 'integer', minimum: 1, maximum: 10 },
    includeVersions: { type: 'boolean' },
    versionMax: { type: 'integer', minimum: 1, maximum: 20 }
  },
  required: ['scope', 'packageType'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const scope = args.scope;
    const page = args.page ?? 1, max = args.max ?? 10, versionMax = args.versionMax ?? 10;
    const locator = scope === 'org' ? { org: owner } : { username: owner };
    const route = scope === 'org' ? LIST_ORG : LIST_USER;
    const { data } = await octokit.request(route, {
      ...locator, package_type: args.packageType, per_page: max, page
    });
    const rows = Array.isArray(data) ? data : [];
    const items = [];
    for (const pkg of rows) {
      const item = {
        id: pkg.id, name: pkg.name, package_type: pkg.package_type, visibility: pkg.visibility,
        version_count: pkg.version_count ?? null, owner: pkg.owner?.login ?? owner,
        created_at: pkg.created_at, updated_at: pkg.updated_at,
        html_url: pkg.html_url
      };
      if (args.includeVersions !== false) {
        const { data: versions } = await octokit.request(scope === 'org' ? VERSIONS_ORG : VERSIONS_USER, {
          ...locator, package_type: args.packageType, package_name: pkg.name,
          per_page: versionMax, page: 1
        });
        if (!Array.isArray(versions)) throw new TypeError('GitHub did not return a package version list.');
        item.versions = versions.map(versionView);
        item.versions_page = 1;
        if (pkg.version_count != null ? pkg.version_count > versions.length : versions.length === versionMax) {
          item.more_versions_possible = true;
        }
      }
      items.push(item);
    }
    return { account: owner, scope, package_type: args.packageType, page, count: items.length,
      ...(items.length === max ? { next_page_possible: page + 1 } : {}), items };
  })
});
export const tools = [packageList.tool];
export const handlers = { [packageList.tool.name]: packageList.handler };

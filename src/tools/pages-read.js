// G-6: GitHub Pages metadata only; no publication or setting changes.
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';
import { missing } from './github-write.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const GET = 'GET /repos/{owner}/{repo}/pages';
const BUILD = 'GET /repos/{owner}/{repo}/pages/builds/latest';

export const pagesGet = defineRead({
  name: 'github_pages_get', area: 'pages', audience: ['B', 'O'],
  description: 'Read GitHub Pages settings, HTTPS and the latest build.',
  properties: { owner: OWNER, repo: REPO },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const params = { owner, repo: args.repo };
    const site = await missing(async () => (await octokit.request(GET, params)).data);
    if (!site) return { configured: false, repository: `${owner}/${args.repo}` };
    const build = await missing(async () => (await octokit.request(BUILD, params)).data);
    return {
      configured: true, repository: `${owner}/${args.repo}`, status: site.status,
      url: site.url, html_url: site.html_url, cname: site.cname,
      public: site.public, https_enforced: site.https_enforced,
      protected_domain_state: site.protected_domain_state,
      pending_domain_unverified_at: site.pending_domain_unverified_at,
      source: site.source ? { branch: site.source.branch, path: site.source.path } : null,
      latest_build: build ? {
        status: build.status, created_at: build.created_at, updated_at: build.updated_at,
        error: build.error ? { message: build.error.message } : null,
        pusher: build.pusher?.login
      } : null
    };
  })
});
export const tools = [pagesGet.tool];
export const handlers = { [pagesGet.tool.name]: pagesGet.handler };

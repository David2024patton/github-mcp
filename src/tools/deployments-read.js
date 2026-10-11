// G-4 deployment records: bounded read-only queries, with each deployment's latest status.
// Creating deployments and changing status remain separate guarded writes.
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const LIST = 'GET /repos/{owner}/{repo}/deployments';
const STATUSES = 'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses';
const view = (d, latest) => ({
  id: d.id, ref: d.ref, sha: d.sha, environment: d.environment,
  original_environment: d.original_environment, task: d.task,
  description: d.description, created_at: d.created_at, updated_at: d.updated_at,
  transient_environment: d.transient_environment,
  production_environment: d.production_environment, creator: d.creator?.login,
  latest_status: latest ? {
    id: latest.id, state: latest.state, description: latest.description,
    target_url: latest.target_url, environment_url: latest.environment_url,
    created_at: latest.created_at, updated_at: latest.updated_at
  } : null
});

export const deployList = defineRead({
  name: 'github_deploy_list', area: 'deploy', audience: ['B', 'Op'],
  description: 'List deployments by filter with latest status.',
  properties: {
    owner: OWNER, repo: REPO, ref: { type: 'string', maxLength: 250 },
    sha: { type: 'string', minLength: 7, maxLength: 40 },
    task: { type: 'string', maxLength: 100 },
    environment: { type: 'string', maxLength: 100 },
    page: { type: 'integer', minimum: 1 },
    max: { type: 'integer', minimum: 1, maximum: 30 },
    includeLatestStatus: { type: 'boolean', description: 'Read one latest status per deployment (default true).' }
  },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const page = args.page ?? 1;
    const max = args.max ?? 20;
    const filters = Object.fromEntries(['ref', 'sha', 'task', 'environment']
      .filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
    const { data } = await octokit.request(LIST, { owner, repo: args.repo, ...filters, page, per_page: max });
    const deployments = Array.isArray(data) ? data : [];
    const items = [];
    for (const deployment of deployments) {
      let latest = null;
      if (args.includeLatestStatus !== false) {
        const response = await octokit.request(STATUSES, {
          owner, repo: args.repo, deployment_id: deployment.id, per_page: 1, page: 1
        });
        latest = response.data?.[0] ?? null;
      }
      items.push(view(deployment, latest));
    }
    return { page, count: items.length, ...(deployments.length === max ? { next_page_possible: page + 1 } : {}), items };
  })
});

export const tools = [deployList.tool];
export const handlers = { [deployList.tool.name]: deployList.handler };

// G-4 environments: safe reads of deployment protections and custom branch/tag policies.
// Nothing in this module mutates an environment, creates a deployment, or returns secret values.
import { defineRead } from './define-read.js';
import { readerFor, plain } from './github-read.js';
import { missing } from './github-write.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const ENV = { type: 'string', minLength: 1, maxLength: 100 };
const LIST = 'GET /repos/{owner}/{repo}/environments';
const ONE = 'GET /repos/{owner}/{repo}/environments/{environment_name}';
const POLICIES = 'GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies';
const SECRET_COUNT = 'GET /repos/{owner}/{repo}/environments/{environment_name}/secrets';
const VARIABLE_COUNT = 'GET /repos/{owner}/{repo}/environments/{environment_name}/variables';
const environmentParams = (owner, repo, environment) => ({ owner, repo, environment_name: environment });

export const readEnvironment = (client, owner, repo, environment) => missing(async () =>
  (await client.request(ONE, environmentParams(owner, repo, environment))).data);

export function protectionView(env) {
  const rules = env?.protection_rules ?? [];
  const reviewerRule = rules.find((rule) => rule.type === 'required_reviewers');
  const timerRule = rules.find((rule) => rule.type === 'wait_timer');
  const reviewers = (reviewerRule?.reviewers ?? []).map((entry) => ({
    type: entry.type, id: entry.reviewer?.id ?? entry.id,
    ...(entry.reviewer?.login ? { login: entry.reviewer.login } : {}),
    ...(entry.reviewer?.slug ? { slug: entry.reviewer.slug } : {})
  }));
  return {
    wait_timer: timerRule?.wait_timer ?? 0,
    prevent_self_review: reviewerRule?.prevent_self_review ?? false,
    reviewers,
    deployment_branch_policy: env?.deployment_branch_policy ?? null,
    custom_protection_rules: rules.filter((rule) => !['wait_timer', 'required_reviewers', 'branch_policy'].includes(rule.type))
      .map((rule) => ({ id: rule.id, type: rule.type }))
  };
}

async function countOrUnknown(client, route, params) {
  try {
    const { data } = await client.request(route, { ...params, per_page: 1 });
    return { count: data.total_count ?? null };
  } catch (error) {
    return { count: null, unavailable: error?.status ?? 'unreachable' };
  }
}

export const envList = defineRead({
  name: 'github_env_list', area: 'env', audience: ['B', 'O'],
  description: 'List environments, protections and optional secret/variable counts.',
  properties: { owner: OWNER, repo: REPO, page: { type: 'integer', minimum: 1 },
    max: { type: 'integer', minimum: 1, maximum: 30 },
    includeCounts: { type: 'boolean', description: 'Count secrets and variables; never show values.' } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const page = args.page ?? 1;
    const max = args.max ?? 20;
    const { data } = await octokit.request(LIST, { owner, repo: args.repo, per_page: max, page });
    const rows = [];
    for (const env of data.environments ?? []) {
      const row = { name: env.name, id: env.id, updated_at: env.updated_at, protection: protectionView(env) };
      if (args.includeCounts) {
        const params = environmentParams(owner, args.repo, env.name);
        row.secrets = await countOrUnknown(octokit, SECRET_COUNT, params);
        row.variables = await countOrUnknown(octokit, VARIABLE_COUNT, params);
      }
      rows.push(row);
    }
    return { page, count: rows.length, total_count: data.total_count ?? null,
      ...(data.total_count == null
        ? (rows.length === max ? { next_page_possible: page + 1 } : {})
        : (page * max < data.total_count ? { next_page: page + 1 } : {})),
      items: rows };
  })
});

export const envGet = defineRead({
  name: 'github_env_get', area: 'env', audience: ['B', 'O'],
  description: 'Read environment reviewers, timers and branch/tag rules.',
  properties: { owner: OWNER, repo: REPO, environment: ENV },
  required: ['repo', 'environment'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const env = await readEnvironment(octokit, owner, args.repo, args.environment);
    if (!env) return { not_found: args.environment };
    const protection = protectionView(env);
    let branchPolicies = { items: [], count: 0 };
    if (protection.deployment_branch_policy?.custom_branch_policies) {
      const { data } = await octokit.request(POLICIES, {
        ...environmentParams(owner, args.repo, args.environment), per_page: 100, page: 1
      });
      branchPolicies = { count: data.total_count ?? data.branch_policies?.length ?? 0,
        items: (data.branch_policies ?? []).map((x) => ({ id: x.id, name: x.name, type: x.type })),
        ...((data.total_count ?? 0) > 100 ? { more_pages: true } : {}) };
    }
    return { id: env.id, name: env.name, created_at: env.created_at, updated_at: env.updated_at,
      html_url: env.html_url, protection, branch_policies: branchPolicies };
  })
});

export const tools = [envList.tool, envGet.tool];
export const handlers = { [envList.tool.name]: envList.handler, [envGet.tool.name]: envGet.handler };

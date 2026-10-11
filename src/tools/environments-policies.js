// G-4 separate branch/tag deployment-policy operations. These do not mutate the
// environment PUT settings; GitHub's custom-policy mode must already be enabled.
import { defineGithubWrite } from './define-github-write.js';
import { readEnvironment } from './environments-read.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const ENV = { type: 'string', minLength: 1, maxLength: 100 };
const NAME = { type: 'string', minLength: 1, maxLength: 250 };
const ID = { type: 'integer', minimum: 1 };
const BASE = '/repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies';
const LIST = 'GET ' + BASE;
const ONE = BASE + '/{branch_policy_id}';
const params = (t, id) => ({
  owner: t.owner, repo: t.repo, environment_name: t.environment,
  ...(id !== undefined ? { branch_policy_id: id } : {})
});
const target = (args, ctx) => ({
  owner: ownerOf(args, ctx), repo: args.repo, environment: args.environment, scope: 'repo'
});
const get = async (ctx, t, id) => missing(async () =>
  (await (await octo(ctx, t.owner)).request('GET ' + ONE, params(t, id))).data);
async function list(ctx, t) {
  const { data } = await (await octo(ctx, t.owner)).request(LIST, { ...params(t), per_page: 100, page: 1 });
  const rows = data.branch_policies ?? [];
  if (data.total_count == null || data.total_count > rows.length) {
    throw refusal('The policy list is incomplete, so an existing branch or tag restriction cannot be verified. No changes were made.');
  }
  return rows;
}
async function readBase(ctx, t) {
  const env = await readEnvironment(await octo(ctx, t.owner), t.owner, t.repo, t.environment);
  if (!env) throw refusal('This environment does not exist.', 404);
  if (env.deployment_branch_policy?.custom_branch_policies !== true)
    throw refusal('Enable custom deployment branch policies for this environment first; existing rules were not changed.');
  return env;
}
const common = { owner: OWNER, repo: REPO, environment: ENV };
const declarations = { production: 'when-target', accessWidening: true, confirm: 'always', profiles: ['full'] };
const classify = async ({ ctx, target: t }) => ({
  production: await productionReason(ctx, t), accessWidening: true
});
const address = (t) => `"${t.environment}" in ${slug(t.owner, t.repo)}`;

const create = defineGithubWrite({
  name: 'github_env_policy_create', area: 'env', audience: ['O'],
  description: 'Add a branch or tag deployment-name restriction to an environment using custom branch policies.',
  properties: { ...common, name: NAME, type: { type: 'string', enum: ['branch', 'tag'] } },
  required: ['repo', 'environment', 'name', 'type'],
  declarations, target,
  read: async (_args, ctx, t) => ({ env: await readBase(ctx, t), policies: await list(ctx, t) }),
  classify,
  summarize: ({ args, before, target: t }) => `Allow additional ${args.type} pattern "${args.name}" to deploy to ${address(t)}. Existing rules: ${before.policies.length}. This can broaden deployment access.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (before.policies.some((x) => x.name === args.name && x.type === args.type))
      throw refusal('That branch/tag policy already exists; no duplicate was created.');
    return (await octo(ctx, t.owner)).request('POST ' + BASE, { ...params(t), name: args.name, type: args.type });
  },
  readAfter: async ({ ctx, target: t, response }) => {
    if (response.status !== 200 || !Number.isInteger(response.data?.id)) return null;
    return (await list(ctx, t)).find((p) => p.id === response.data.id) ?? null;
  },
  verify: ({ args, after }) => after?.name === args.name && after?.type === args.type,
  inverse: ({ after, target: t }) => after ? { tool: 'github_env_policy_delete',
    args: { owner: t.owner, repo: t.repo, environment: t.environment, policyId: after.id } } : null,
  present: ({ after }) => ({ policy_id: after?.id, name: after?.name, type: after?.type })
});

const update = defineGithubWrite({
  name: 'github_env_policy_update', area: 'env', audience: ['O'],
  description: 'Change the match pattern of a branch or tag deployment policy without changing its type.',
  properties: { ...common, policyId: ID, name: NAME },
  required: ['repo', 'environment', 'policyId', 'name'],
  declarations, target,
  read: async (args, ctx, t) => ({ env: await readBase(ctx, t), policy: await get(ctx, t, args.policyId),
    policies: await list(ctx, t) }),
  classify,
  summarize: ({ args, before, target: t }) => before.policy
    ? `Replace ${before.policy.type ?? 'existing'} pattern "${before.policy.name}" with "${args.name}" in ${address(t)}. This may broaden deployment access.`
    : `Policy ${args.policyId} does not exist in ${address(t)}.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (!before.policy) throw refusal('Policy not found.', 404);
    if (before.policy.name === args.name) throw refusal('The policy already has that name.');
    if (before.policies.some((x) => x.id !== args.policyId && x.name === args.name && x.type === before.policy.type))
      throw refusal('Another policy already has that name and type.');
    return (await octo(ctx, t.owner)).request('PUT ' + ONE, { ...params(t, args.policyId), name: args.name });
  },
  readAfter: ({ args, ctx, target: t }) => get(ctx, t, args.policyId),
  verify: ({ args, after }) => after?.id === args.policyId && after.name === args.name,
  inverse: ({ before, target: t }) => before.policy ? { tool: 'github_env_policy_update',
    args: { owner: t.owner, repo: t.repo, environment: t.environment, policyId: before.policy.id, name: before.policy.name } } : null,
  present: ({ after }) => ({ policy_id: after?.id, name: after?.name, type: after?.type })
});

const del = defineGithubWrite({
  name: 'github_env_policy_delete', area: 'env', audience: ['O'],
  description: 'Delete one branch/tag deployment policy, preserving all other environment settings and policies.',
  properties: { ...common, policyId: ID },
  required: ['repo', 'environment', 'policyId'],
  declarations, target,
  read: async (args, ctx, t) => ({ env: await readBase(ctx, t), policy: await get(ctx, t, args.policyId) }),
  classify,
  summarize: ({ args, before, target: t }) => before.policy
    ? `Delete ${before.policy.type ?? 'branch/tag'} policy "${before.policy.name}" (ID ${args.policyId}) from ${address(t)}. Other restrictions remain. This action requires confirmation.`
    : `Policy ${args.policyId} does not exist in ${address(t)}.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (!before.policy) throw refusal('Policy not found.', 404);
    return (await octo(ctx, t.owner)).request('DELETE ' + ONE, params(t, args.policyId));
  },
  readAfter: ({ args, ctx, target: t }) => get(ctx, t, args.policyId),
  verify: ({ after }) => after === null,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted_policy_id: args.policyId, deleted_name: before.policy?.name })
});

const defs = [create, update, del];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));

// G-4 deployment writes: dispatch and status updates with the ordinary nine-check
// contract, exact read-back, and production classification using GitHub facts.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const REF = { type: 'string', minLength: 1, maxLength: 250 };
const ENV = { type: 'string', minLength: 1, maxLength: 100 };
const GET = 'GET /repos/{owner}/{repo}/deployments/{deployment_id}';
const CREATE = 'POST /repos/{owner}/{repo}/deployments';
const STATUS = 'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses';
const STATUSES = 'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses';
const params = (t, id) => ({ owner: t.owner, repo: t.repo, ...(id ? { deployment_id: id } : {}) });
const get = async (ctx, t, id) => missing(async () =>
  (await (await octo(ctx, t.owner)).request(GET, params(t, id))).data);
const classify = async (ctx, t) => {
  const reason = await productionReason(ctx, t);
  return reason || (t.productionFlag ? 'this deployment is explicitly marked production' : null);
};
const environmentTarget = (args, ctx) => ({
  owner: ownerOf(args, ctx), repo: args.repo, ref: args.ref, environment: args.environment,
  productionFlag: args.productionEnvironment === true, scope: 'repo'
});
const readStatuses = async (ctx, t, id) =>
  (await (await octo(ctx, t.owner)).request(STATUSES, { ...params(t, id), per_page: 100, page: 1 })).data;

const deployCreate = defineGithubWrite({
  name: 'github_deploy_create', area: 'deploy', audience: ['B'],
  description: 'Request deployment of an existing ref to a named environment without auto-merging branches.',
  properties: {
    owner: OWNER, repo: REPO, ref: REF, environment: ENV,
    task: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    transientEnvironment: { type: 'boolean' },
    productionEnvironment: { type: 'boolean' },
    requiredContexts: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 100 } }
  },
  required: ['repo', 'ref', 'environment'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['everyday', 'full'] },
  target: environmentTarget,
  read: async (_args, ctx, t) => ({
    repo: await missing(async () => (await (await octo(ctx, t.owner)).request(
      'GET /repos/{owner}/{repo}', params(t))).data)
  }),
  classify: async ({ ctx, target: t }) => ({ production: await classify(ctx, t) }),
  summarize: ({ args, before, target: t }) => before.repo
    ? `Request deployment of "${args.ref}" to "${args.environment}" in ${slug(t.owner, t.repo)}. GitHub will not auto-merge; required checks stay enabled. This dispatches a deployment event and cannot be rolled back automatically.`
    : `The repository ${slug(t.owner, t.repo)} does not exist.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (!before.repo) throw refusal('Repository not found.', 404);
    return (await octo(ctx, t.owner)).request(CREATE, {
      ...params(t), ref: args.ref, environment: args.environment,
      auto_merge: false, ...(args.task ? { task: args.task } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.transientEnvironment !== undefined ? { transient_environment: args.transientEnvironment } : {}),
      ...(args.productionEnvironment !== undefined ? { production_environment: args.productionEnvironment } : {}),
      ...(args.requiredContexts ? { required_contexts: args.requiredContexts } : {})
    });
  },
  readAfter: async ({ ctx, target: t, response }) =>
    response.status === 201 && Number.isInteger(response.data?.id)
      ? get(ctx, t, response.data.id) : null,
  verify: ({ args, after }) => !!after && after.ref === args.ref &&
    after.environment === args.environment && !!after.id,
  inverse: () => null,
  present: ({ after, response }) => ({
    ...(after ? { deployment_id: after.id, ref: after.ref, environment: after.environment,
      html_url: after.html_url } : { created: false, status: response?.status ?? null,
      note: 'No deployment ID was verified; a 202 response may mean GitHub only merged a branch. Do not replay blindly.' })
  })
});

const statusTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo,
  deploymentId: args.deploymentId, scope: 'repo' });

const deployStatus = defineGithubWrite({
  name: 'github_deploy_set_status', area: 'deploy', audience: ['B'],
  description: 'Add a status to an actual deployment, deriving its environment and ref from GitHub before guarding the change.',
  properties: {
    owner: OWNER, repo: REPO, deploymentId: { type: 'integer', minimum: 1 },
    state: { type: 'string', enum: ['error', 'failure', 'pending', 'in_progress', 'queued', 'success', 'inactive'] },
    description: { type: 'string', maxLength: 140 },
    targetUrl: { type: 'string', maxLength: 500 },
    logUrl: { type: 'string', maxLength: 500 },
    environmentUrl: { type: 'string', maxLength: 500 },
    autoInactive: { type: 'boolean' }
  },
  required: ['repo', 'deploymentId', 'state'],
  declarations: { production: 'when-target', profiles: ['everyday', 'full'] },
  target: statusTarget,
  read: async (args, ctx, t) => ({ deployment: await get(ctx, t, args.deploymentId) }),
  classify: async ({ ctx, before, target: t }) => ({
    production: before.deployment
      ? await classify(ctx, { ...t, ref: before.deployment.ref, environment: before.deployment.environment,
        productionFlag: before.deployment.production_environment === true })
      : 'the deployment could not be found or its production status checked'
  }),
  summarize: ({ args, before, target: t }) => before.deployment
    ? `Set deployment ${args.deploymentId} (${before.deployment.ref} → ${before.deployment.environment}) in ${slug(t.owner, t.repo)} to "${args.state}". This emits a deployment_status event and is not reversible.`
    : `Deployment ${args.deploymentId} does not exist in ${slug(t.owner, t.repo)}.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (!before.deployment) throw refusal('Deployment not found.', 404);
    return (await octo(ctx, t.owner)).request(STATUS, {
      ...params(t, args.deploymentId), state: args.state,
      ...(args.description ? { description: args.description } : {}),
      ...(args.targetUrl ? { target_url: args.targetUrl } : {}),
      ...(args.logUrl ? { log_url: args.logUrl } : {}),
      ...(args.environmentUrl ? { environment_url: args.environmentUrl } : {}),
      ...(args.autoInactive !== undefined ? { auto_inactive: args.autoInactive } : {})
    });
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    if (!Number.isInteger(response.data?.id)) return null;
    const statuses = await readStatuses(ctx, t, args.deploymentId);
    return statuses.find((x) => x.id === response.data.id) ?? null;
  },
  verify: ({ args, after }) => !!after && after.state === args.state &&
    (!args.description || after.description === args.description) &&
    (!args.targetUrl || after.target_url === args.targetUrl) &&
    (!args.logUrl || after.log_url === args.logUrl) &&
    (!args.environmentUrl || after.environment_url === args.environmentUrl),
  inverse: () => null,
  present: ({ args, after }) => ({ deployment_id: args.deploymentId, status_id: after?.id,
    state: after?.state, confirmed: !!after })
});

const defs = [deployCreate, deployStatus];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));

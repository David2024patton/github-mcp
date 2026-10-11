// G-4: environment settings are read-merge-write; missing fields mean preserve, not clear.
// Unsupported custom protections cause a refusal instead of being silently disabled.
import { defineGithubWrite } from './define-github-write.js';
import { readEnvironment, protectionView } from './environments-read.js';
import { octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const ENV = { type: 'string', minLength: 1, maxLength: 100 };
const REVIEWERS = { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false,
  properties: { type: { type: 'string', enum: ['User', 'Team'] }, id: { type: 'integer', minimum: 1 } },
  required: ['type', 'id'] } };
// Our shared argument validator supports single JSON-schema types; use a distinct
// explicit clearing flag rather than an unsupported nullable object schema.
const POLICY = { type: 'object', additionalProperties: false,
  properties: { protected_branches: { type: 'boolean' }, custom_branch_policies: { type: 'boolean' } },
  required: ['protected_branches', 'custom_branch_policies'] };
const ROUTE = '/repos/{owner}/{repo}/environments/{environment_name}';
const target = (args, ctx) => {
  if (Object.hasOwn(args, 'deploymentBranchPolicy') &&
    (!args.deploymentBranchPolicy || typeof args.deploymentBranchPolicy !== 'object' || Array.isArray(args.deploymentBranchPolicy)))
    throw new TypeError('deploymentBranchPolicy must be an object; use clearDeploymentBranchPolicy: true to remove it.');
  if (Object.hasOwn(args, 'deploymentBranchPolicy') && Object.hasOwn(args, 'clearDeploymentBranchPolicy'))
    throw new TypeError('Choose deploymentBranchPolicy or clearDeploymentBranchPolicy, not both.');
  if (Object.hasOwn(args, 'clearDeploymentBranchPolicy') && args.clearDeploymentBranchPolicy !== true)
    throw new TypeError('clearDeploymentBranchPolicy must be true when supplied.');
  return { owner: ownerOf(args, ctx), repo: args.repo, environment: args.environment, scope: 'repo' };
};
const path = (target) => ({ owner: target.owner, repo: target.repo, environment_name: target.environment });
const get = async (ctx, target) => readEnvironment(await octo(ctx, target.owner), target.owner, target.repo, target.environment);
const sortReviewers = (list) => [...list].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
const EMPTY = Object.freeze({ wait_timer: 0, prevent_self_review: false, reviewers: [], deployment_branch_policy: null });

/** Only fields GitHub accepts in its environment PUT, never IDs, HTML URLs or GET-only rule objects. */
export function writableEnvironment(env) {
  if (!env) return { ...EMPTY, reviewers: [] };
  const view = protectionView(env);
  if (view.custom_protection_rules.length)
    throw refusal('This environment has custom protection rules that the settings endpoint cannot preserve. No changes were sent.');
  if (view.reviewers.some((r) => !Number.isInteger(r.id) || !['User', 'Team'].includes(r.type)))
    throw refusal('GitHub did not return valid reviewer IDs. Refusing to lose approval rules.');
  return {
    wait_timer: view.wait_timer, prevent_self_review: view.prevent_self_review,
    reviewers: sortReviewers(view.reviewers.map((r) => ({ type: r.type, id: r.id }))),
    deployment_branch_policy: view.deployment_branch_policy
  };
}
function plan(args, current) {
  if (!['waitTimer', 'preventSelfReview', 'reviewers', 'deploymentBranchPolicy', 'clearDeploymentBranchPolicy'].some((key) => Object.hasOwn(args, key)))
    throw refusal('Specify at least one environment setting to change.');
  const next = { ...current };
  if (Object.hasOwn(args, 'waitTimer')) next.wait_timer = args.waitTimer;
  if (Object.hasOwn(args, 'preventSelfReview')) next.prevent_self_review = args.preventSelfReview;
  if (Object.hasOwn(args, 'reviewers')) next.reviewers = sortReviewers(args.reviewers);
  if (Object.hasOwn(args, 'deploymentBranchPolicy')) next.deployment_branch_policy = args.deploymentBranchPolicy;
  if (args.clearDeploymentBranchPolicy === true) next.deployment_branch_policy = null;
  const p = next.deployment_branch_policy;
  if (p && p.protected_branches === p.custom_branch_policies)
    throw refusal('Branch-policy modes must be opposite: protected_branches or custom_branch_policies, never both.');
  return next;
}
const argsFrom = (t, prior) => ({
  owner: t.owner, repo: t.repo, environment: t.environment,
  waitTimer: prior.wait_timer, preventSelfReview: prior.prevent_self_review,
  reviewers: prior.reviewers, ...(prior.deployment_branch_policy
    ? { deploymentBranchPolicy: prior.deployment_branch_policy }
    : { clearDeploymentBranchPolicy: true })
});

const envSave = defineGithubWrite({
  name: 'github_env_save', area: 'env', audience: ['B', 'O'],
  description: 'Create or update deployment environment controls without clearing omitted reviewers, timers or branch policies.',
  properties: { owner: OWNER, repo: REPO, environment: ENV,
    waitTimer: { type: 'integer', minimum: 0, maximum: 43200 },
    preventSelfReview: { type: 'boolean' }, reviewers: REVIEWERS, deploymentBranchPolicy: POLICY,
    clearDeploymentBranchPolicy: { type: 'boolean', description: 'Set true to remove the branch policy; mutually exclusive with deploymentBranchPolicy.' } },
  required: ['repo', 'environment'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target,
  read: async (_args, ctx, t) => ({ current: await get(ctx, t) }),
  classify: async ({ args, ctx, before, target: t }) => {
    const previous = writableEnvironment(before.current);
    const proposed = plan(args, previous);
    const production = await productionReason(ctx, t);
    return { production: production ||
      ((proposed.wait_timer > 0 || proposed.reviewers.length > 0) ? 'the proposed environment requires reviewers or a wait timer' : null) };
  },
  summarize: ({ args, before, target: t }) => {
    const old = writableEnvironment(before.current);
    const next = plan(args, old);
    return (before.current ? 'Update ' : 'Create ') + 'environment "' + t.environment + '" in ' +
      slug(t.owner, t.repo) + ': ' + JSON.stringify(old) + ' → ' + JSON.stringify(next) +
      '. Separate branch/tag policy patterns and custom protection rules are not modified.';
  },
  apply: async ({ args, before, ctx, target: t }) => {
    const next = plan(args, writableEnvironment(before.current));
    return (await octo(ctx, t.owner)).request('PUT ' + ROUTE, { ...path(t), ...next });
  },
  readAfter: async ({ ctx, target: t }) => {
    const current = await get(ctx, t);
    return current === null ? null : writableEnvironment(current);
  },
  verify: ({ args, before, after }) => after !== null &&
    JSON.stringify(after) === JSON.stringify(plan(args, writableEnvironment(before.current))),
  inverse: ({ before, target: t }) => before.current ? { tool: 'github_env_save', args: argsFrom(t, writableEnvironment(before.current)) } : null,
  present: ({ target: t, after }) => ({ environment: t.environment, settings: after })
});

const envDelete = defineGithubWrite({
  name: 'github_env_delete', area: 'env', audience: ['O'],
  description: 'Permanently delete an environment, including its deployment rules, secrets and variables.',
  properties: { owner: OWNER, repo: REPO, environment: ENV },
  required: ['repo', 'environment'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target,
  read: async (_args, ctx, t) => ({ current: await get(ctx, t) }),
  classify: async ({ ctx, target: t }) => ({ production: await productionReason(ctx, t) }),
  summarize: ({ before, target: t }) => before.current
    ? 'Permanently delete environment "' + t.environment + '" in ' + slug(t.owner, t.repo) +
      ' with all its secrets, variables, review requirements and branch/tag policies. It cannot be restored.'
    : 'Environment "' + t.environment + '" does not exist in ' + slug(t.owner, t.repo),
  apply: async ({ before, ctx, target: t }) => {
    if (!before.current) throw refusal('The environment does not exist.', 404);
    return (await octo(ctx, t.owner)).request('DELETE ' + ROUTE, path(t));
  },
  readAfter: ({ ctx, target: t }) => get(ctx, t),
  verify: ({ after }) => after === null,
  inverse: () => null,
  present: ({ target: t }) => ({ deleted: t.environment, irreversible: true })
});

export const tools = [envSave.tool, envDelete.tool];
export const handlers = { [envSave.tool.name]: envSave.handler, [envDelete.tool.name]: envDelete.handler };

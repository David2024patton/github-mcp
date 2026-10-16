// V-3: CI on run-owned test refs. Dispatch a workflow on a recorded test branch and wait at most 45 seconds
// (a handle to check later, never a loop), and simulate passing or failing checks on commits the run itself created.
import { createHash } from 'node:crypto';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { workflowProduction } from './actions-write.js';
import { runDevMutationOnce } from '../dev/execute.js';
import { assertRunName, branchOf, deniable, previewOnly, readTestRun, recorded, runIdentity, SHA, TEST_NAME } from '../dev/test-refs.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const RUN = { type: 'string', minLength: 3, maxLength: 42, pattern: '^[a-z][a-z0-9-]{2,41}$' };
const NAME = { type: 'string', minLength: 1, maxLength: 41, pattern: '^[a-z][a-z0-9-]{0,40}$' };
const WAIT_MS_MAX = 45_000;
const POLL_MS = 3_000;
const p = (target) => ({ owner: target.owner, repo: target.repo });
const getRun = (gh, target, id) => missing(async () => (await gh.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', { ...p(target), run_id: id })).data);

const dispatchWait = defineGithubWrite({
  name: 'github_dev_dispatch_and_wait', area: 'dev', audience: ['B'],
  description: 'Run a workflow on a test branch and wait up to 45 seconds; returns the run or a handle.',
  properties: { owner: OWNER, repo: REPO, runId: RUN, name: { ...NAME, description: 'The test branch name used at creation' },
    workflow: { type: 'string', minLength: 1, maxLength: 250, description: 'Workflow file name, for example ci.yml' },
    waitSeconds: { type: 'integer', minimum: 0, maximum: 45, description: 'How long to wait (default 45)' },
    poll: { type: 'integer', minimum: 1, maximum: 50, description: 'Raise this to check an earlier handle again; it never starts a second run' } },
  required: ['repo', 'runId', 'name', 'workflow'], declarations: { production: 'never' },
  target: (args, ctx) => {
    previewOnly(ctx); assertRunName(args.runId);
    if (!TEST_NAME.test(args.name ?? '')) throw new TypeError('A short lowercase test name is required.');
    return { owner: ownerOf(args, ctx), repo: args.repo, ref: branchOf(args.runId, args.name), scope: 'repo' };
  },
  read: (args, ctx, target) => deniable(async () => {
    const { host, objects } = await readTestRun(ctx, { owner: target.owner, repo: args.repo, runId: args.runId });
    if (!recorded(objects, 'branch', target.ref, target.repo)) throw refusal(`${target.ref} is not a recorded test branch of this run; workflows run only on run-owned refs.`);
    const gh = await octo(ctx, target.owner);
    const [branch, workflow] = await Promise.all([
      missing(async () => (await gh.request('GET /repos/{owner}/{repo}/branches/{branch}', { ...p(target), branch: target.ref })).data),
      missing(async () => (await gh.request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}', { ...p(target), workflow_id: args.workflow })).data)
    ]);
    if (!branch || !SHA.test(branch.commit?.sha ?? '') || branch.protected !== false) throw refusal('The test branch is missing or protected.');
    if (!workflow) throw refusal(`There is no workflow ${args.workflow} in ${slug(target.owner, target.repo)}.`, 404);
    // Dispatch runs the workflow code found ON THE BRANCH with the repository's secrets: refuse a changed workflow file.
    const [onBranch, onDefault] = await Promise.all([target.ref, host.default_branch].map((ref) => missing(async () =>
      (await gh.request('GET /repos/{owner}/{repo}/contents/{path}', { ...p(target), path: workflow.path, ref })).data)));
    if (typeof onBranch?.sha !== 'string' || onBranch.sha !== onDefault?.sha) {
      throw refusal(`${workflow.path} on ${target.ref} differs from the default branch, and GitHub would run the changed code with this repository's secrets. Discard that change first.`);
    }
    const intent = await ctx.db.getDevIntent({ runId: args.runId, account: target.owner, connection: ctx.connection.client_id, stepId: `dispatch-${workflow.id}-${args.name}` });
    return { branch, workflow, started: intent?.status === 'recorded' ? intent : null };
  }),
  classify: async ({ ctx, target, before }) => ({ production: before.denied ? null : await workflowProduction(ctx, target, { path: before.workflow.path, ref: target.ref }) }),
  summarize: ({ args, target, before }) => (before.denied ? `Cannot start the workflow: ${before.denied}` : before.started
    ? `Keep waiting (up to ${args.waitSeconds ?? 45}s) for the already started run ${before.started.object_id} of ${before.workflow.path} on ${target.ref}; no second dispatch`
    : `Start workflow ${before.workflow.path} on test branch ${target.ref} (${before.branch.commit.sha.slice(0, 7)}) in ${slug(target.owner, target.repo)} and wait up to ${args.waitSeconds ?? 45}s`),
  apply: async ({ args, ctx, target, before }) => {
    if (before.denied) throw refusal(before.denied);
    const github = await octo(ctx, target.owner);
    const headSha = before.branch.commit.sha;
    const rec = await runDevMutationOnce(ctx, { ...runIdentity(ctx, { owner: target.owner, repo: target.repo, runId: args.runId }),
      stepId: `dispatch-${before.workflow.id}-${args.name}`, type: 'workflow_run', objectName: `${before.workflow.path}@${target.ref}`,
      create: async () => {
        const started = (await github.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', { ...p(target), workflow_id: before.workflow.id, ref: target.ref })).data;
        if (!Number.isSafeInteger(started?.workflow_run_id) || started.workflow_run_id <= 0) throw refusal('GitHub did not return the ID of the run it started.');
        return { objectId: String(started.workflow_run_id), createdSha: headSha };
      } });
    return { data: { githubRunId: Number(rec.objectId), headSha: rec.createdSha, replayed: rec.replayed === true } };
  },
  // Bounded wait: injected sleep, at most 16 reads, never longer than 45 seconds in total.
  readAfter: async ({ args, ctx, target, response }) => {
    const gh = await octo(ctx, target.owner);
    const limit = Math.min(args.waitSeconds ?? 45, 45) * 1000;
    let run = null;
    for (let waited = 0; ; waited += POLL_MS) {
      run = await getRun(gh, target, response.data.githubRunId);
      if (!run || run.status === 'completed' || waited + POLL_MS > Math.min(limit, WAIT_MS_MAX)) break;
      await ctx.sleep(POLL_MS);
    }
    return { run };
  },
  verify: ({ target, after, response }) => after.run?.id === response.data.githubRunId && after.run.head_branch === target.ref &&
    after.run.head_sha === response.data.headSha && after.run.event === 'workflow_dispatch',
  inverse: () => null,
  present: ({ args, after, response }) => {
    const done = after.run?.status === 'completed';
    return { run_id: args.runId, github_run_id: response.data.githubRunId, status: after.run?.status, conclusion: after.run?.conclusion ?? null, html_url: after.run?.html_url, complete: done,
      handle: done ? null : { github_run_id: response.data.githubRunId, check_again: 'Call github_dev_dispatch_and_wait again with the same arguments and a higher poll; it never starts a second run.', or: 'github_actions_get_run' },
      replayed: response.data.replayed };
  }
});

const STATES = { queued: { status: 'queued' }, in_progress: { status: 'in_progress' }, success: { status: 'completed', conclusion: 'success' }, failure: { status: 'completed', conclusion: 'failure' }, neutral: { status: 'completed', conclusion: 'neutral' } };
const ONLY_APPS = 'Only a GitHub App can write check runs, and this account is connected with a token instead. Use a connection backed by the GitHub App.';
const appOnly = (error) => (error?.status === 401 || error?.status === 403 ? refusal(ONLY_APPS, 403) : error);
const stepOf = (name, sha) => `check-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x'}-${createHash('sha256').update(name).digest('hex').slice(0, 6)}-${sha.slice(0, 8)}`;
const getCheck = (gh, target, id) => missing(async () => (await gh.request('GET /repos/{owner}/{repo}/check-runs/{check_run_id}', { ...p(target), check_run_id: id })).data);

const setCheck = defineGithubWrite({
  name: 'github_dev_set_check_run', area: 'dev', audience: ['B'],
  description: 'Create or update a simulated check on a commit this run created (GitHub App only).',
  properties: { owner: OWNER, repo: REPO, runId: RUN, name: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9 ._/-]*$', description: 'Check name, for example ci' },
    headSha: { type: 'string', pattern: '^[a-f0-9]{40}$', description: 'A commit this run created' },
    state: { type: 'string', enum: Object.keys(STATES) }, summary: { type: 'string', maxLength: 500 } },
  required: ['repo', 'runId', 'name', 'headSha', 'state'], declarations: { production: 'never' },
  target: (args, ctx) => { previewOnly(ctx); assertRunName(args.runId); return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' }; },
  read: (args, ctx, target) => deniable(async () => {
    const { objects } = await readTestRun(ctx, { owner: target.owner, repo: args.repo, runId: args.runId });
    // Only a commit this run wrote (its fixture commits), never a pre-existing branch tip.
    if (!objects.some((o) => ['fixture_file', 'fixture_revision', 'workflow_file'].includes(o.object_type) && o.created_sha === args.headSha)) {
      throw refusal('Checks may be written only on a commit this run created.');
    }
    const commit = await missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/commits/{ref}', { ...p(target), ref: args.headSha })).data);
    if (commit?.sha !== args.headSha) throw refusal(`There is no commit ${args.headSha.slice(0, 7)} in ${slug(target.owner, target.repo)}.`, 404);
    return { commit: commit.sha };
  }),
  classify: () => ({}),
  summarize: ({ args, target, before }) => before.denied ? `Cannot set the check: ${before.denied}` : `Set simulated check "${args.name}" to ${args.state} on commit ${args.headSha.slice(0, 7)} of ${slug(target.owner, target.repo)}; it is recorded in run ${args.runId}`,
  apply: async ({ args, ctx, target, before }) => {
    if (before.denied) throw refusal(before.denied);
    const gh = await octo(ctx, target.owner);
    const want = STATES[args.state];
    const output = { title: `Simulated: ${args.state}`, summary: args.summary ?? `Simulated by github_dev_set_check_run rtc_run=${args.runId}` };
    const rec = await runDevMutationOnce(ctx, { ...runIdentity(ctx, { owner: target.owner, repo: target.repo, runId: args.runId }), stepId: stepOf(args.name, args.headSha),
      type: 'check_run', objectName: `${args.name}@${args.headSha.slice(0, 12)}`,
      create: async () => {
        try {
          const made = (await gh.request('POST /repos/{owner}/{repo}/check-runs', { ...p(target), name: args.name, head_sha: args.headSha, external_id: `rtc_run=${args.runId}`, output, ...want })).data;
          if (!Number.isSafeInteger(made?.id) || made.id <= 0) throw refusal('GitHub did not return the created check run.');
          return { objectId: String(made.id), createdSha: args.headSha };
        } catch (error) { throw appOnly(error); }
      } });
    // The same check set again to another state is an update of the one recorded check run.
    if (rec.replayed) {
      try { await gh.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', { ...p(target), check_run_id: Number(rec.objectId), output, ...want }); } catch (error) { throw appOnly(error); }
    }
    return { data: { checkRunId: Number(rec.objectId), replayed: rec.replayed === true } };
  },
  readAfter: async ({ ctx, target, response }) => ({ check: await getCheck(await octo(ctx, target.owner), target, response.data.checkRunId) }),
  verify: ({ args, after }) => after.check?.name === args.name && after.check.head_sha === args.headSha && after.check.external_id === `rtc_run=${args.runId}` &&
    after.check.status === STATES[args.state].status && (STATES[args.state].conclusion === undefined || after.check.conclusion === STATES[args.state].conclusion),
  inverse: () => null,
  present: ({ args, after, response }) => ({ run_id: args.runId, check_run_id: response.data.checkRunId, name: after.check?.name, status: after.check?.status, conclusion: after.check?.conclusion ?? null, html_url: after.check?.html_url, replayed: response.data.replayed })
});

export const tools = [dispatchWait.tool, setCheck.tool];
export const handlers = { [dispatchWait.tool.name]: dispatchWait.handler, [setCheck.tool.name]: setCheck.handler };

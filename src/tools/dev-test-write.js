// V-3: run-owned test branches and draft PRs in any allowed repository (never production, default or protected refs).
// Every GitHub write is one durable claimed step of the caller's run; nothing is created that github_dev_cleanup cannot close.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';
import { createOwnedFixtureBranch, commitOwnedFixtureFile } from '../dev/fixtures.js';
import { createOwnedDraftPr, createOwnedRunLabel, labelOwnedDraftPr } from '../dev/pull-fixtures.js';
import { assertRunName, branchOf, deniable, fileOf, labelOf, previewOnly, readTestRun, recorded, runIdentity, SHA, TEST_NAME } from '../dev/test-refs.js';
import { matchesRunFooter } from '../dev/run-marker.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const RUN = { type: 'string', minLength: 3, maxLength: 42, pattern: '^[a-z][a-z0-9-]{2,41}$' };
const NAME = { type: 'string', minLength: 1, maxLength: 41, pattern: '^[a-z][a-z0-9-]{0,40}$', description: 'Short name; the branch becomes rtc/<run>/<name>' };
const p = (target) => ({ owner: target.owner, repo: target.repo });
const getBranch = (gh, target, branch) => missing(async () => (await gh.request('GET /repos/{owner}/{repo}/branches/{branch}', { ...p(target), branch })).data);
const targetOf = (args, ctx) => {
  previewOnly(ctx);
  assertRunName(args.runId);
  if (!TEST_NAME.test(args.name ?? '')) throw new TypeError('A short lowercase test name is required.');
  return { owner: ownerOf(args, ctx), repo: args.repo, ref: branchOf(args.runId, args.name), scope: 'repo' };
};

const createBranch = defineGithubWrite({
  name: 'github_dev_create_test_branch', area: 'dev', audience: ['B'],
  description: 'Create a run-owned test branch rtc/<run>/<name> from any ref; never production.',
  properties: { owner: OWNER, repo: REPO, runId: RUN, name: NAME, from: { type: 'string', minLength: 1, maxLength: 250, description: 'Branch, tag or commit to start from (default: the default branch)' } },
  required: ['repo', 'runId', 'name'], declarations: { production: 'never' },
  target: targetOf,
  read: (args, ctx, target) => deniable(async () => {
    const { host, objects } = await readTestRun(ctx, { owner: target.owner, repo: args.repo, runId: args.runId });
    const gh = await octo(ctx, target.owner);
    const from = args.from ?? host.default_branch;
    const source = await missing(async () => (await gh.request('GET /repos/{owner}/{repo}/commits/{ref}', { ...p(target), ref: from })).data);
    if (!SHA.test(source?.sha ?? '')) throw refusal(`There is no commit, branch or tag "${from}" in ${slug(target.owner, target.repo)}.`, 404);
    const existing = await getBranch(gh, target, target.ref);
    const owned = recorded(objects, 'branch', target.ref, target.repo);
    if (existing && !owned) throw refusal(`The branch ${target.ref} already exists and this run did not create it.`);
    return { from, sourceSha: source.sha, existing, owned };
  }),
  classify: async ({ ctx, target, before }) => ({ production: before.denied ? null : await productionReason(ctx, target) }),
  summarize: ({ args, target, before }) => (before.denied ? `Cannot create the test branch: ${before.denied}` : before.owned
    ? `Verify the recorded test branch ${target.ref} in ${slug(target.owner, target.repo)}; no second branch is created`
    : `Create test branch ${target.ref} from ${before.from} (${before.sourceSha.slice(0, 7)}) in ${slug(target.owner, target.repo)}; it is recorded in run ${args.runId} and removed by github_dev_cleanup`),
  apply: async ({ args, ctx, target, before }) => (before.denied ? Promise.reject(refusal(before.denied)) : {
    data: await createOwnedFixtureBranch(ctx, {
      github: await octo(ctx, target.owner), run: runIdentity(ctx, { owner: target.owner, repo: target.repo, runId: args.runId }),
      stepId: `test-branch-${args.name}`, name: target.ref, sha: before.sourceSha
    })
  }),
  readAfter: async ({ args, ctx, target }) => ({
    branch: await getBranch(await octo(ctx, target.owner), target, target.ref),
    objects: await ctx.db.listDevObjects({ runId: args.runId, account: target.owner, connection: ctx.connection.client_id, limit: 50 })
  }),
  // The branch may later carry the run's own fixture commit; any other head means somebody else pushed.
  verify: ({ target, after, response }) => {
    const sha = after.branch?.commit?.sha;
    const fixture = after.objects.some((o) => o.object_type === 'fixture_file' && o.created_sha === sha && o.object_id === `${target.ref}.md`);
    return after.branch?.name === target.ref && after.branch.protected === false &&
      (sha === response.data.createdSha || fixture) && !!recorded(after.objects, 'branch', target.ref, target.repo);
  },
  inverse: () => null,
  present: ({ args, target, after, response }) => ({ run_id: args.runId, branch: target.ref, sha: after.branch?.commit?.sha, recorded: true, replayed: response.data.replayed === true })
});

const openPr = defineGithubWrite({
  name: 'github_dev_open_test_pr', area: 'dev', audience: ['B'],
  description: 'Commit a run file to a recorded test branch and open a run-labelled draft PR.',
  properties: { owner: OWNER, repo: REPO, runId: RUN, name: { ...NAME, description: 'The name used to create the test branch' },
    title: { type: 'string', minLength: 1, maxLength: 200 }, base: { type: 'string', minLength: 1, maxLength: 250, description: 'Base branch (default: the default branch; or another recorded test branch)' } },
  required: ['repo', 'runId', 'name'], declarations: { production: 'never' },
  target: targetOf,
  read: (args, ctx, target) => deniable(async () => {
    const { host, objects } = await readTestRun(ctx, { owner: target.owner, repo: args.repo, runId: args.runId, needRoom: 4 });
    const branch = recorded(objects, 'branch', target.ref, target.repo);
    if (!branch) throw refusal(`${target.ref} is not a recorded test branch of this run; create it with github_dev_create_test_branch.`);
    const live = await getBranch(await octo(ctx, target.owner), target, target.ref);
    const file = recorded(objects, 'fixture_file', fileOf(args.runId, args.name), target.repo);
    const expected = file?.created_sha ?? branch.created_sha;
    if (!live || live.commit?.sha !== expected || live.protected !== false) throw refusal('The test branch changed after the run recorded it; reconcile before opening a PR.');
    return { defaultBranch: host.default_branch, base: args.base ?? host.default_branch };
  }),
  classify: async ({ ctx, target, before }) => ({ production: before.denied ? null : await productionReason(ctx, target) }),
  summarize: ({ args, target, before }) => before.denied ? `Cannot open the test PR: ${before.denied}` : `Commit rtc/${args.runId}/${args.name}.md to ${target.ref} and open a DRAFT PR into ${before.base} in ${slug(target.owner, target.repo)}, labelled ${labelOf(args.runId)}; nothing is merged and github_dev_cleanup closes it`,
  apply: async ({ args, ctx, target, before }) => {
    if (before.denied) throw refusal(before.denied);
    const github = await octo(ctx, target.owner);
    const run = runIdentity(ctx, { owner: target.owner, repo: target.repo, runId: args.runId });
    const label = labelOf(args.runId);
    const file = await commitOwnedFixtureFile(ctx, { github, run, stepId: `test-pr-file-${args.name}`, path: fileOf(args.runId, args.name), branch: target.ref,
      content: `RTC test pull request for rtc_run=${args.runId} (${args.name})\n` });
    const tag = await createOwnedRunLabel(ctx, { github, run, stepId: 'test-run-label', label });
    const pr = await createOwnedDraftPr(ctx, { github, run, stepId: `test-pr-${args.name}`, head: target.ref, base: before.base, defaultBranch: before.defaultBranch,
      expectedHeadSha: file.createdSha, title: args.title ?? `RTC ${args.runId} test PR ${args.name}` });
    const assoc = await labelOwnedDraftPr(ctx, { github, run, stepId: `test-pr-label-${args.name}`, prNumber: Number(pr.objectId), label });
    return { data: { objects: [file, tag, pr, assoc], prNumber: Number(pr.objectId), headSha: file.createdSha, base: before.base } };
  },
  readAfter: async ({ ctx, target, response }) => {
    const gh = await octo(ctx, target.owner);
    const number = response.data.prNumber;
    const [pr, labels, ref] = await Promise.all([
      gh.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { ...p(target), pull_number: number }).then((x) => x.data),
      gh.request('GET /repos/{owner}/{repo}/issues/{issue_number}/labels', { ...p(target), issue_number: number }).then((x) => x.data),
      gh.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { ...p(target), ref: `heads/${target.ref}` }).then((x) => x.data)
    ]);
    return { pr, labels, ref };
  },
  verify: ({ args, target, after, response }) => after.pr?.number === response.data.prNumber && after.pr.draft === true && after.pr.state === 'open' &&
    after.pr.head?.ref === target.ref && after.pr.head?.sha === response.data.headSha && after.pr.base?.ref === response.data.base &&
    matchesRunFooter(after.pr.body, args.runId) && Array.isArray(after.labels) && after.labels.some((x) => x.name === labelOf(args.runId)) &&
    after.ref?.object?.sha === response.data.headSha,
  inverse: () => null,
  present: ({ args, target, after, response }) => ({ run_id: args.runId, pr_number: response.data.prNumber, html_url: after.pr?.html_url, draft: true, head: target.ref, base: response.data.base, label: labelOf(args.runId) })
});

export const tools = [createBranch.tool, openPr.tool];
export const handlers = { [createBranch.tool.name]: createBranch.handler, [openPr.tool.name]: openPr.handler };

import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { REFUSED_MUTATIONS, WRITE_SPECS } from '../../src/github/graphql-writes.js';
import { curatedGraphqlMutation } from '../../src/github/mutation-classes.js';
import { buildCapabilityInventory } from '../../src/github/capability-inventory.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const GROUP2 = ['addAssigneesToAssignable', 'removeAssigneesFromAssignable', 'addBlockedBy', 'removeBlockedBy', 'addSubIssue', 'removeSubIssue',
  'reprioritizeSubIssue', 'addLabelsToLabelable', 'removeLabelsFromLabelable', 'clearLabelsFromLabelable', 'createLabel', 'updateLabel', 'deleteLabel',
  'addReaction', 'removeReaction', 'closeIssue', 'reopenIssue', 'updateIssueIssueType', 'transferIssue', 'addComment', 'addPullRequestReview',
  'submitPullRequestReview', 'dismissPullRequestReview', 'addPullRequestReviewThreadReply', 'resolveReviewThread', 'unresolveReviewThread',
  'requestReviews', 'requestReviewsByLogin', 'rerequestReviews', 'updatePullRequestReviewComment', 'deletePullRequestReviewComment',
  'enablePullRequestAutoMerge', 'disablePullRequestAutoMerge', 'updatePullRequestBranch', 'createIssueType', 'updateIssueType', 'deleteIssueType',
  'createIssueField', 'updateIssueField', 'deleteIssueField', 'setIssueFieldValue', 'createIssueFieldValue', 'updateIssueFieldValue'];
const MUTATION = (name, type) => `mutation M($input: ${type}!){ ${name}(input:$input){ clientMutationId } }`;
const run = (w, args) => createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: w.ctx.gates, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })
  .call(null, { registry, name: 'github_graphql_write', args, connection: w.connection, db: w.db }).then(parse);
const world = () => makeWorld({ profile: 'full', mode: 'production', advanceClockOnSleep: true });

describe('GQL-1 group 2: issues, labels, reviews, reactions, discussions', () => {
  it('every covered mutation points at a tool that exists, and none is also a spec or refused', () => {
    const names = new Set(registry.tools.map((t) => t.name));
    for (const m of GROUP2) {
      const tool = curatedGraphqlMutation(m);
      expect(tool, m).toBeTruthy();
      expect(names.has(tool), `${m} -> ${tool}`).toBe(true);
      expect(WRITE_SPECS.has(m) || REFUSED_MUTATIONS.has(m), m).toBe(false);
    }
  });

  it('refused mutations explain themselves and send nothing', async () => {
    for (const [name, type, input] of [
      ['enqueuePullRequest', 'EnqueuePullRequestInput', { pullRequestId: 'PR1' }],
      ['addRelatesTo', 'AddRelatesToInput', { issueId: 'I1', relatedIssueId: 'I2' }],
      ['revertPullRequest', 'RevertPullRequestInput', { pullRequestId: 'PR1' }]]) {
      expect(REFUSED_MUTATIONS.get(name)?.length, name).toBeGreaterThan(30);
      const w = await world();
      const out = await run(w, { mutation: MUTATION(name, type), variables: { input }, owner: 'example-org', repo: 'hello', confirm: true })
        .catch((e) => ({ status: 'error', message: String(e?.message ?? e) }));
      expect(out.status).not.toBe('applied');
      expect(JSON.stringify(out)).toMatch(/refused on purpose/);
      expect(w.gh.calls.filter((c) => /^\s*mutation\b/.test(c.body?.query ?? ''))).toHaveLength(0);
    }
  });

  it('a covered mutation cannot be sent through the generic route', async () => {
    const w = await world();
    const out = await run(w, { mutation: MUTATION('closeIssue', 'CloseIssueInput'), variables: { input: { issueId: 'I1' } }, owner: 'example-org', repo: 'hello', confirm: true })
      .catch((e) => ({ status: 'error', message: String(e?.message ?? e) }));
    expect(out.status).not.toBe('applied');
  });

  it('the inventory leaves no group 2 mutation missing', () => {
    const inv = buildCapabilityInventory({ registryTools: registry.tools });
    const missing = new Set(inv.operations.filter((r) => r.state === 'missing').map((r) => r.operation?.field));
    for (const m of [...GROUP2, ...REFUSED_MUTATIONS.keys(), 'addUpvote', 'addDiscussionPollVote', 'markFileAsViewed', 'unmarkIssueAsDuplicate'])
      expect(missing.has(m), m).toBe(false);
  });
});

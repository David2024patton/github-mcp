// Y-2: spec-driven GraphQL writes. One reviewed entry per mutation says how ownership is proven, what the "before"
// and "after" read looks like, how to tell the change really happened, and what the opposite is. A mutation without
// an entry stays refused by `github_graphql_write` ("use the specialised tool"), exactly as in U-2.
//
// Pure data and pure functions only: nothing here talks to GitHub. `src/tools/universal-graphql.js` runs the reads.
//
// WriteSpec fields:
//   scope      'repo' (every id must resolve into owner/repo) or 'org' (ids must resolve into the enrolled organization)
//   primary    input key holding the node that is read before and after
//   ids        input key -> node types that key may resolve to. Any other ID-typed key is refused.
//   changes    non-ID input keys that are real changes; every key not listed here, in `ids` or `clientMutationId` is refused
//   before     GraphQL selection run on the primary node ("... on Issue { isPinned }"), before and after the write
//   already    (input, before) => true when the node is already in the requested state (nothing to do: refused)
//   verify     (input, after, before) => true only if `after` shows the requested change. For deletes `after` is null.
//   deleted    true when success means the node no longer exists
//   inverse    null, or (input, before, after) => { mutation, input } that restores the previous state
//   preflight  optional name of an extra read-only check implemented by the caller ('pinned-issue-limit', 'repo-admin')
//   cls        { accessWidening, notifies, destructive } — the reviewed marks, recorded for the owner's review. They can only
//              make a write MORE cautious (`destructive`); the generic "access + notifies" marks are never lowered by a
//              spec (Batch Y decision Y4: a lowering needs an owner decision and a DECISIONS entry).
//   undoHint   plain-English opposite for changes with no inverse
const norm = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MINIMIZE_CLASSIFIERS = ['ABUSE', 'OFF_TOPIC', 'OUTDATED', 'RESOLVED', 'DUPLICATE', 'SPAM'];
const classifierFor = (reason) => MINIMIZE_CLASSIFIERS.find((c) => norm(c) === norm(reason)) ?? null;
const CLOSE_REASONS = ['RESOLVED', 'OUTDATED', 'DUPLICATE'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const given = (input, key) => Object.hasOwn(input, key) && input[key] !== undefined;

const COMMENT_TYPES = ['IssueComment', 'DiscussionComment', 'PullRequestReviewComment', 'CommitComment'];
const quiet = Object.freeze({ accessWidening: false, notifies: false, destructive: false });
const notifying = Object.freeze({ accessWidening: false, notifies: true, destructive: false });
const destructive = Object.freeze({ accessWidening: false, notifies: false, destructive: true });

/** @type {Map<string, object>} */
export const WRITE_SPECS = new Map([
  ['pinIssue', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'] }, changes: [], before: '... on Issue { isPinned }',
    already: (_i, b) => b?.isPinned === true, verify: (_i, a) => a?.isPinned === true, preflight: 'pinned-issue-limit',
    inverse: (i) => ({ mutation: 'unpinIssue', input: { issueId: i.issueId } }), cls: quiet
  }],
  ['unpinIssue', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'] }, changes: [], before: '... on Issue { isPinned }',
    already: (_i, b) => b?.isPinned !== true, verify: (_i, a) => a?.isPinned === false,
    inverse: (i) => ({ mutation: 'pinIssue', input: { issueId: i.issueId } }), cls: quiet
  }],
  ['pinIssueComment', {
    scope: 'repo', primary: 'issueCommentId', ids: { issueCommentId: ['IssueComment'] }, changes: [], before: '... on IssueComment { isPinned }',
    already: (_i, b) => b?.isPinned === true, verify: (_i, a) => a?.isPinned === true,
    inverse: (i) => ({ mutation: 'unpinIssueComment', input: { issueCommentId: i.issueCommentId } }), cls: quiet
  }],
  ['unpinIssueComment', {
    scope: 'repo', primary: 'issueCommentId', ids: { issueCommentId: ['IssueComment'] }, changes: [], before: '... on IssueComment { isPinned }',
    already: (_i, b) => b?.isPinned !== true, verify: (_i, a) => a?.isPinned === false,
    inverse: (i) => ({ mutation: 'pinIssueComment', input: { issueCommentId: i.issueCommentId } }), cls: quiet
  }],
  ['lockLockable', {
    scope: 'repo', primary: 'lockableId', ids: { lockableId: ['Issue', 'PullRequest', 'Discussion'] }, changes: ['lockReason'],
    before: '... on Lockable { locked activeLockReason }',
    already: (i, b) => b?.locked === true && (!given(i, 'lockReason') || b.activeLockReason === i.lockReason),
    verify: (i, a) => a?.locked === true && (!given(i, 'lockReason') || a.activeLockReason === i.lockReason),
    inverse: (i) => ({ mutation: 'unlockLockable', input: { lockableId: i.lockableId } }), cls: quiet
  }],
  ['unlockLockable', {
    scope: 'repo', primary: 'lockableId', ids: { lockableId: ['Issue', 'PullRequest', 'Discussion'] }, changes: [],
    before: '... on Lockable { locked activeLockReason }',
    already: (_i, b) => b?.locked !== true, verify: (_i, a) => a?.locked === false,
    inverse: (i, b) => ({ mutation: 'lockLockable', input: { lockableId: i.lockableId, ...(b?.activeLockReason ? { lockReason: b.activeLockReason } : {}) } }),
    cls: quiet
  }],
  ['minimizeComment', {
    scope: 'repo', primary: 'subjectId', ids: { subjectId: COMMENT_TYPES }, changes: ['classifier'],
    before: '... on Minimizable { isMinimized minimizedReason }',
    already: (_i, b) => b?.isMinimized === true,
    verify: (i, a) => a?.isMinimized === true && (a.minimizedReason == null || norm(a.minimizedReason) === norm(i.classifier)),
    inverse: (i) => ({ mutation: 'unminimizeComment', input: { subjectId: i.subjectId } }), cls: quiet
  }],
  ['unminimizeComment', {
    scope: 'repo', primary: 'subjectId', ids: { subjectId: COMMENT_TYPES }, changes: [],
    before: '... on Minimizable { isMinimized minimizedReason }',
    already: (_i, b) => b?.isMinimized !== true, verify: (_i, a) => a?.isMinimized === false,
    inverse: (i, b) => (classifierFor(b?.minimizedReason)
      ? { mutation: 'minimizeComment', input: { subjectId: i.subjectId, classifier: classifierFor(b.minimizedReason) } } : null),
    cls: quiet
  }],
  ['closeDiscussion', {
    scope: 'repo', primary: 'discussionId', ids: { discussionId: ['Discussion'] }, changes: ['reason'], before: '... on Discussion { closed stateReason }',
    already: (_i, b) => b?.closed === true, verify: (i, a) => a?.closed === true && (!given(i, 'reason') || a.stateReason === i.reason),
    inverse: (i) => ({ mutation: 'reopenDiscussion', input: { discussionId: i.discussionId } }), cls: quiet
  }],
  ['reopenDiscussion', {
    scope: 'repo', primary: 'discussionId', ids: { discussionId: ['Discussion'] }, changes: [], before: '... on Discussion { closed stateReason }',
    already: (_i, b) => b?.closed !== true, verify: (_i, a) => a?.closed === false,
    inverse: (i, b) => ({ mutation: 'closeDiscussion', input: { discussionId: i.discussionId, ...(CLOSE_REASONS.includes(b?.stateReason) ? { reason: b.stateReason } : {}) } }),
    cls: quiet
  }],
  ['updateDiscussion', {
    scope: 'repo', primary: 'discussionId', ids: { discussionId: ['Discussion'], categoryId: ['DiscussionCategory'] },
    changes: ['title', 'body', 'categoryId'], before: '... on Discussion { title body category { id } }',
    already: (i, b) => ['title', 'body'].every((k) => !given(i, k) || b?.[k] === i[k]) && (!given(i, 'categoryId') || b?.category?.id === i.categoryId),
    verify: (i, a) => ['title', 'body'].every((k) => !given(i, k) || a?.[k] === i[k]) && (!given(i, 'categoryId') || a?.category?.id === i.categoryId),
    inverse: (i, b) => ({ mutation: 'updateDiscussion', input: { discussionId: i.discussionId,
      ...(given(i, 'title') ? { title: b?.title } : {}), ...(given(i, 'body') ? { body: b?.body } : {}),
      ...(given(i, 'categoryId') ? { categoryId: b?.category?.id } : {}) } }), cls: notifying
  }],
  ['updateDiscussionComment', {
    scope: 'repo', primary: 'commentId', ids: { commentId: ['DiscussionComment'] }, changes: ['body'], before: '... on DiscussionComment { body }',
    already: (i, b) => b?.body === i.body, verify: (i, a) => a?.body === i.body,
    inverse: (i, b) => ({ mutation: 'updateDiscussionComment', input: { commentId: i.commentId, body: b?.body } }), cls: notifying
  }],
  ['deleteDiscussion', {
    scope: 'repo', primary: 'id', ids: { id: ['Discussion'] }, changes: [], before: '... on Discussion { title }', deleted: true,
    verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted discussion cannot be restored. Create a new discussion with github_discussion_create.'
  }],
  ['deleteDiscussionComment', {
    scope: 'repo', primary: 'id', ids: { id: ['DiscussionComment'] }, changes: [], before: '... on DiscussionComment { body }', deleted: true,
    verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted discussion comment cannot be restored. Post the comment again with github_discussion_comment.'
  }],
  ['markDiscussionCommentAsAnswer', {
    scope: 'repo', primary: 'id', ids: { id: ['DiscussionComment'] }, changes: [], before: '... on DiscussionComment { isAnswer }',
    already: (_i, b) => b?.isAnswer === true, verify: (_i, a) => a?.isAnswer === true,
    inverse: (i) => ({ mutation: 'unmarkDiscussionCommentAsAnswer', input: { id: i.id } }), cls: quiet
  }],
  ['unmarkDiscussionCommentAsAnswer', {
    scope: 'repo', primary: 'id', ids: { id: ['DiscussionComment'] }, changes: [], before: '... on DiscussionComment { isAnswer }',
    already: (_i, b) => b?.isAnswer !== true, verify: (_i, a) => a?.isAnswer === false,
    inverse: (i) => ({ mutation: 'markDiscussionCommentAsAnswer', input: { id: i.id } }), cls: quiet
  }],
  ['convertPullRequestToDraft', {
    scope: 'repo', primary: 'pullRequestId', ids: { pullRequestId: ['PullRequest'] }, changes: [], before: '... on PullRequest { isDraft }',
    already: (_i, b) => b?.isDraft === true, verify: (_i, a) => a?.isDraft === true,
    inverse: (i) => ({ mutation: 'markPullRequestReadyForReview', input: { pullRequestId: i.pullRequestId } }), cls: quiet
  }],
  ['markPullRequestReadyForReview', {
    scope: 'repo', primary: 'pullRequestId', ids: { pullRequestId: ['PullRequest'] }, changes: [], before: '... on PullRequest { isDraft }',
    already: (_i, b) => b?.isDraft === false, verify: (_i, a) => a?.isDraft === false,
    inverse: (i) => ({ mutation: 'convertPullRequestToDraft', input: { pullRequestId: i.pullRequestId } }), cls: notifying
  }],
  ['createLinkedBranch', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'], repositoryId: ['Repository'] }, changes: ['name', 'oid'],
    before: '... on Issue { linkedBranches(first: 50) { totalCount nodes { id ref { name } } } }',
    already: (i, b) => given(i, 'name') && (b?.linkedBranches?.nodes ?? []).some((n) => n?.ref?.name === i.name),
    verify: (i, a, b) => {
      const was = new Set((b?.linkedBranches?.nodes ?? []).map((n) => n?.id));
      const added = (a?.linkedBranches?.nodes ?? []).filter((n) => n?.id && !was.has(n.id));
      return added.length === 1 && (!given(i, 'name') || added[0].ref?.name === i.name);
    },
    inverse: (_i, b, a) => {
      const was = new Set((b?.linkedBranches?.nodes ?? []).map((n) => n?.id));
      const added = (a?.linkedBranches?.nodes ?? []).filter((n) => n?.id && !was.has(n.id));
      return added.length === 1 ? { mutation: 'deleteLinkedBranch', input: { linkedBranchId: added[0].id } } : null;
    }, cls: quiet
  }],
  ['deleteLinkedBranch', {
    scope: 'repo', primary: 'linkedBranchId', ids: { linkedBranchId: ['LinkedBranch'] }, changes: [], before: '... on LinkedBranch { ref { name } }', deleted: true,
    verify: (_i, a) => a === null, inverse: null, cls: quiet,
    undoHint: 'Link the branch to the issue again with github_graphql_write createLinkedBranch (the branch itself is not deleted).'
  }],
  ['updateIssueComment', {
    scope: 'repo', primary: 'id', ids: { id: ['IssueComment'] }, changes: ['body'], before: '... on IssueComment { body }',
    already: (i, b) => b?.body === i.body, verify: (i, a) => a?.body === i.body,
    inverse: (i, b) => ({ mutation: 'updateIssueComment', input: { id: i.id, body: b?.body } }), cls: notifying
  }],
  ['deleteIssueComment', {
    scope: 'repo', primary: 'id', ids: { id: ['IssueComment'] }, changes: [], before: '... on IssueComment { body }', deleted: true,
    verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted comment cannot be restored. Post it again with github_issue_comment.'
  }],
  ['deleteIssue', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'] }, changes: [], before: '... on Issue { title number }', deleted: true,
    preflight: 'repo-admin', verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted issue cannot be restored. Open a new issue with github_issue_create.'
  }],
  ['updateTeamReviewAssignment', {
    scope: 'org', primary: 'id', ids: { id: ['Team'] }, changes: ['enabled', 'algorithm', 'teamMemberCount', 'notifyTeam'],
    before: '... on Team { reviewRequestDelegationEnabled reviewRequestDelegationAlgorithm reviewRequestDelegationMemberCount reviewRequestDelegationNotifyTeam }',
    already: (i, b) => b?.reviewRequestDelegationEnabled === i.enabled && (!given(i, 'algorithm') || b.reviewRequestDelegationAlgorithm === i.algorithm)
      && (!given(i, 'teamMemberCount') || b.reviewRequestDelegationMemberCount === i.teamMemberCount)
      && (!given(i, 'notifyTeam') || b.reviewRequestDelegationNotifyTeam === i.notifyTeam),
    verify: (i, a) => a?.reviewRequestDelegationEnabled === i.enabled && (!given(i, 'algorithm') || a.reviewRequestDelegationAlgorithm === i.algorithm)
      && (!given(i, 'teamMemberCount') || a.reviewRequestDelegationMemberCount === i.teamMemberCount)
      && (!given(i, 'notifyTeam') || a.reviewRequestDelegationNotifyTeam === i.notifyTeam),
    inverse: (i, b) => ({ mutation: 'updateTeamReviewAssignment', input: { id: i.id, enabled: b?.reviewRequestDelegationEnabled === true,
      ...(given(i, 'algorithm') && b?.reviewRequestDelegationAlgorithm ? { algorithm: b.reviewRequestDelegationAlgorithm } : {}),
      ...(given(i, 'teamMemberCount') && b?.reviewRequestDelegationMemberCount != null ? { teamMemberCount: b.reviewRequestDelegationMemberCount } : {}),
      ...(given(i, 'notifyTeam') && b?.reviewRequestDelegationNotifyTeam != null ? { notifyTeam: b.reviewRequestDelegationNotifyTeam } : {}) } }),
    cls: quiet
  }]
]);

export const writeSpec = (mutation) => WRITE_SPECS.get(mutation) ?? null;

/** The selection run on the primary node, before and after the write. */
export const specReadQuery = (spec) => `query UniversalSpecRead($id: ID!) { node(id: $id) { __typename id ${spec.before} } }`;

/** Name of GraphQL's input type for a mutation: pinIssue -> PinIssueInput. */
export const inputTypeName = (mutation) => mutation[0].toUpperCase() + mutation.slice(1) + 'Input';

/** The GraphQL document that runs one recorded inverse; the input travels as a typed variable. */
export function inverseDocument(mutation) {
  return `mutation ${mutation[0].toUpperCase() + mutation.slice(1)}Undo($input: ${inputTypeName(mutation)}!) { ${mutation}(input: $input) { clientMutationId } }`;
}

/**
 * Checks a request's `input` object against its spec. Throws a plain TypeError for anything the spec does not cover.
 * @returns {{ primaryId: string, ids: {name:string,value:string}[], changes: Record<string,unknown> }}
 */
export function specInput(spec, mutation, input, idEntries) {
  const allowed = new Set([...Object.keys(spec.ids), ...spec.changes, 'clientMutationId']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`GraphQL ${mutation} input "${key}" is not covered by its reviewed write spec; use the specialised tool or ask for it to be added.`);
  }
  for (const entry of idEntries) {
    if (!Object.hasOwn(spec.ids, entry.name)) {
      throw new TypeError(`GraphQL ${mutation} input "${entry.name}" is an ID the reviewed write spec does not cover.`);
    }
  }
  const primary = idEntries.find((e) => e.name === spec.primary);
  if (!primary) throw new TypeError(`GraphQL ${mutation} needs ${spec.primary}.`);
  return {
    primaryId: primary.value, ids: idEntries,
    changes: Object.fromEntries(spec.changes.filter((k) => given(input, k)).map((k) => [k, input[k]]))
  };
}

/** True when two read snapshots of the primary node differ (concurrent-change protection). */
export const snapshotChanged = (a, b) => !same(a, b);

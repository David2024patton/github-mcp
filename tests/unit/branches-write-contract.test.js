// D-3: every branch and tag write tool passes the write contract (three doors) against the fake GitHub, which validates every request
// against the vendored description. Branch variants: an ordinary branch, and a default or protected one (production).
import { runWriteContract as contract } from '../../test/helpers/write-contract.js';
import { spendGate } from '../../test/helpers/fixture-gates.js';
import { protectionVerdict } from '../../src/tools/protect-guard.js';
import { tools, handlers } from '../../src/tools/branches.js';

// The real protected-resource rules (what pr-only allows; production is never allowed there) instead of the fixture gate.
const gatesFor = ({ protectedLevel, spendLimitCents }) => [
  ...(protectedLevel ? [async ({ name, args, target, classification }) => {
    const verdict = protectionVerdict({ entries: [{ kind: 'repo', target: 'example-org/hello', level: protectedLevel, reason: 'test' }], name, args, target, classification });
    return verdict && protectedLevel === 'locked' ? { ...verdict, by: `${verdict.by} (locked)` } : verdict;
  }] : []),
  spendGate({ limitCents: spendLimitCents ?? 0 })
];
const runWriteContract = (options) => contract({ gatesFor, ...options });
const def = (name) => ({ tool: tools.find((t) => t.name === name), handler: handlers[name] });
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const R = { repo: 'hello' };
const REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}';
const nf = { message: 'Not Found' };
const ref = (sha, type = 'commit') => ({ ref: 'refs/heads/x', object: { sha, type } });
/** Replies in call order; `null` is a 404. */
const seq = (gh, route, ...bodies) => gh.when(route).replySequence(bodies.map((b) => (b === null ? { status: 404, body: nf } : { status: 200, body: b })));

/** What the production guard reads about a branch: the default branch name, and whether the branch is protected. */
function facts(gh, { protectedBranch = false } = {}) {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', full_name: 'example-org/hello' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: 'x', protected: protectedBranch });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
  gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
}

runWriteContract({
  label: 'github_branch_create', definition: def('github_branch_create'), args: { ...R, branch: 'feature' }, needsConfirm: false, conveyor: true,
  arrange(gh, outcome) {
    facts(gh);
    seq(gh, REF, null, outcome === 'ok' ? ref(A) : null);
    gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201, ref(A));
  }
});

for (const [label, branch, protectedBranch, production] of [['ordinary', 'feature', false, false], ['default', 'main', false, true], ['protected', 'release', true, true]]) {
  runWriteContract({
    label: `github_branch_rename (${label} branch)`, definition: def('github_branch_rename'), args: { ...R, branch, newName: `${branch}-2` }, needsConfirm: true, production, conveyor: !production, profile: 'full',
    arrange(gh, outcome) {
      facts(gh, { protectedBranch });
      seq(gh, REF, ref(A), null, outcome === 'ok' ? ref(A) : null, null);
      gh.when('POST /repos/{owner}/{repo}/branches/{branch}/rename').reply(201, { name: `${branch}-2` });
    }
  });
  if (label === 'default') continue; // the default branch is never deleted: refusal is covered in branches-rules.test.js
  runWriteContract({
    label: `github_branch_delete (${label} branch)`, definition: def('github_branch_delete'), args: { ...R, branch: branch === 'main' ? 'main' : branch }, needsConfirm: true, production, conveyor: !production,
    arrange(gh, outcome) {
      facts(gh, { protectedBranch });
      seq(gh, REF, ref(A), outcome === 'ok' ? null : ref(A));
      gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204, null);
    }
  });
}

for (const [label, base, production] of [['ordinary base', 'feature', false], ['default base', 'main', true]]) {
  runWriteContract({
    label: `github_branch_merge (${label})`, definition: def('github_branch_merge'), args: { ...R, base, head: 'topic', commitMessage: 'Merge topic' }, needsConfirm: production, production, conveyor: !production,
    arrange(gh, outcome) {
      facts(gh);
      seq(gh, REF, ref(A), ref(outcome === 'ok' ? B : A));
      gh.when('POST /repos/{owner}/{repo}/merges').reply(201, { sha: B });
    }
  });
}

runWriteContract({
  label: 'github_tag_create', definition: def('github_tag_create'), args: { ...R, tag: 'v1.0.0', from: 'main' }, needsConfirm: true, production: true, profile: 'full',
  arrange(gh, outcome) {
    facts(gh);
    seq(gh, REF, null, outcome === 'ok' ? ref(A) : null);
    gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201, ref(A));
  }
});

runWriteContract({
  label: 'github_tag_delete', definition: def('github_tag_delete'), args: { ...R, tag: 'v1.0.0' }, needsConfirm: true, production: true, profile: 'full',
  arrange(gh, outcome) {
    facts(gh);
    seq(gh, REF, ref(A), outcome === 'ok' ? null : ref(A));
    gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204, null);
  }
});

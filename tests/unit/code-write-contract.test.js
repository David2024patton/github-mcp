// D-2: every file, commit and ref write tool passes the write contract (three doors), against the fake GitHub that validates
// every REST request against the vendored description and every GraphQL document against the vendored schema.
import { runWriteContract as contract } from '../../test/helpers/write-contract.js';
import { spendGate } from '../../test/helpers/fixture-gates.js';
import { protectionVerdict } from '../../src/tools/protect-guard.js';
import { tools, handlers } from '../../src/tools/code-write.js';

// The real protected-resource rules (what pr-only allows, and that production is never allowed there) instead of the fixture gate.
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
const nf = { message: 'Not Found' };
const seq = (gh, route, ...bodies) => gh.when(route).replySequence(bodies.map((b) => (b === null ? { status: 404, body: nf } : { status: 200, body: b })));
const file = (extra = {}) => ({ type: 'file', path: 'docs/a b.md', sha: A, size: 5, encoding: 'base64', content: Buffer.from('hello').toString('base64'), ...extra });
const CONTENT = 'GET /repos/{owner}/{repo}/contents/{path}';

/** What the production guard reads about the branch the change lands on. */
function branchFacts(gh, { branch = 'feature', defaultBranch = 'main', node = 'R_node' } = {}) {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: defaultBranch, node_id: node, full_name: 'example-org/hello' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: branch, protected: false });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
}

const PUT = { ...R, path: 'docs/a b.md', message: 'Add the note', content: 'hello' };
for (const [label, branch, production] of [['feature branch', 'feature', false], ['default branch', 'main', true]]) {
  runWriteContract({
    label: `github_content_put_file (${label})`, definition: def('github_content_put_file'), args: { ...PUT, branch }, needsConfirm: production, production, conveyor: !production,
    arrange(gh, outcome) {
      branchFacts(gh);
      seq(gh, CONTENT, null, outcome === 'ok' ? file({ sha: B }) : null);
      gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201, { content: { sha: B }, commit: { sha: B } });
    }
  });
}

runWriteContract({
  label: 'github_content_delete_file', definition: def('github_content_delete_file'), args: { ...R, path: 'docs/a b.md', branch: 'feature', message: 'Remove it' }, needsConfirm: true, conveyor: true,
  arrange(gh, outcome) {
    branchFacts(gh);
    seq(gh, CONTENT, file(), outcome === 'ok' ? null : file());
    gh.when('DELETE /repos/{owner}/{repo}/contents/{path}').reply(200, { commit: { sha: B } });
  }
});

runWriteContract({
  label: 'github_content_push_files', definition: def('github_content_push_files'), args: { ...R, branch: 'feature', message: 'Two files', files: [{ path: 'a.txt', content: 'one' }, { path: 'b/c.txt', content: 'two' }], deletePaths: ['old.txt'] },
  needsConfirm: false, conveyor: true,
  arrange(gh, outcome) {
    branchFacts(gh);
    seq(gh, 'GET /repos/{owner}/{repo}/git/ref/{ref}', { ref: 'refs/heads/feature', object: { sha: A } }, { ref: 'refs/heads/feature', object: { sha: outcome === 'ok' ? B : A } });
    gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: B, url: 'https://github.com/example-org/hello/commit/b' } } } });
  }
});

runWriteContract({
  label: 'github_commit_comment', definition: def('github_commit_comment'), args: { ...R, sha: A, body: 'Looks fine to @outside-person' }, needsConfirm: true, notifies: ['outside-person'], conveyor: true,
  quietArgs: { ...R, sha: A, body: 'Looks fine to @example-owner' },
  arrange(gh, outcome) {
    gh.when('GET /orgs/{org}/members').reply(200, [{ login: 'example-owner' }]);
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
    gh.when('POST /repos/{owner}/{repo}/commits/{commit_sha}/comments').reply(201, { id: 9, body: outcome === 'ok' ? undefined : 'something else', html_url: 'https://github.com/x' });
    if (outcome === 'ok') gh.when('POST /repos/{owner}/{repo}/commits/{commit_sha}/comments').reply(201, (req) => ({ id: 9, body: req.body.body, html_url: 'https://github.com/x' }));
  }
});

for (const [label, branch, production] of [['feature branch', 'feature', false], ['default branch', 'main', true]]) {
  runWriteContract({
    label: `github_git_update_ref (${label})`, definition: def('github_git_update_ref'), args: { ...R, branch, sha: B }, needsConfirm: true, production, conveyor: !production, profile: 'full',
    arrange(gh, outcome) {
      branchFacts(gh);
      seq(gh, 'GET /repos/{owner}/{repo}/git/ref/{ref}', { ref: `refs/heads/${branch}`, object: { sha: A } }, { ref: `refs/heads/${branch}`, object: { sha: outcome === 'ok' ? B : A } });
      gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { ahead_by: 0, behind_by: 2, status: 'behind' });
      gh.when('POST /graphql').reply(200, { data: { updateRefs: { clientMutationId: null } } });
    }
  });
}

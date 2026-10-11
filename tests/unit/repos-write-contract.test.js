// D-1: every repository write tool passes the write contract (nine checks, three doors), against the fake GitHub, which
// validates every request against the vendored OpenAPI description.
import { runWriteContract } from '../../test/helpers/write-contract.js';
import { tools, handlers } from '../../src/tools/repos.js';

const def = (name) => ({ tool: tools.find((t) => t.name === name), handler: handlers[name] });
const R = { repo: 'hello' };
const REPO = 'GET /repos/{owner}/{repo}';
const full = (extra = {}) => ({ full_name: 'example-org/hello', name: 'hello', private: true, visibility: 'private', default_branch: 'main', topics: [], archived: false, html_url: 'https://github.com/example-org/hello', ...extra });
const nf = { message: 'Not Found' };
/** The fake's replies for one route, in call order; `null` means GitHub answers 404. */
const seq = (gh, route, ...bodies) => gh.when(route).replySequence(bodies.map((b) => (b === null ? { status: 404, body: nf } : { status: 200, body: b })));

runWriteContract({
  label: 'github_repo_create (public)', definition: def('github_repo_create'), args: { ...R, visibility: 'public' }, needsConfirm: true, accessWidening: true,
  arrange(gh, outcome) {
    seq(gh, REPO, null, outcome === 'ok' ? full({ private: false, visibility: 'public' }) : null);
    gh.when('POST /orgs/{org}/repos').reply(201, full({ private: false }));
  }
});

runWriteContract({
  label: 'github_repo_create_from_template', definition: def('github_repo_create_from_template'), args: { ...R, templateOwner: 'example-org', templateRepo: 'starter', visibility: 'public' }, needsConfirm: true, accessWidening: true,
  arrange(gh, outcome) {
    seq(gh, REPO, null, full({ is_template: true, full_name: 'example-org/starter' }), outcome === 'ok' ? full({ private: false }) : null);
    gh.when('POST /repos/{template_owner}/{template_repo}/generate').reply(201, full());
  }
});

runWriteContract({
  label: 'github_repo_update_settings (merge option)', definition: def('github_repo_update_settings'), profile: 'full', args: { ...R, allow_squash_merge: false }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    seq(gh, REPO, full({ allow_squash_merge: true }), full({ allow_squash_merge: outcome !== 'ok' }));
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, full());
  }
});

runWriteContract({
  label: 'github_repo_set_visibility (public)', definition: def('github_repo_set_visibility'), profile: 'full', args: { ...R, visibility: 'public' }, needsConfirm: true, production: true, accessWidening: true,
  arrange(gh, outcome) {
    seq(gh, REPO, full(), full({ visibility: outcome === 'ok' ? 'public' : 'private' }));
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, full());
  }
});

runWriteContract({
  label: 'github_repo_set_default_branch', definition: def('github_repo_set_default_branch'), profile: 'full', args: { ...R, branch: 'develop' }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    seq(gh, REPO, full(), full({ default_branch: outcome === 'ok' ? 'develop' : 'main' }));
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, full());
  }
});

runWriteContract({
  label: 'github_repo_rename', definition: def('github_repo_rename'), profile: 'full', args: { ...R, name: 'hello-two' }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    seq(gh, REPO, full(), full({ name: outcome === 'ok' ? 'hello-two' : 'hello' }));
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, full());
  }
});

runWriteContract({
  label: 'github_repo_set_archived', definition: def('github_repo_set_archived'), profile: 'full', args: { ...R, archived: true }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    seq(gh, REPO, full(), full({ archived: outcome === 'ok' }));
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, full());
  }
});

runWriteContract({
  label: 'github_repo_transfer', definition: def('github_repo_transfer'), profile: 'full', args: { ...R, newOwner: 'someone-else' }, needsConfirm: true, production: true, accessWidening: true,
  arrange(gh, outcome) {
    seq(gh, REPO, full(), null);
    gh.when('POST /repos/{owner}/{repo}/transfer').reply(outcome === 'ok' ? 202 : 200, full());
  }
});

runWriteContract({
  label: 'github_repo_delete', definition: def('github_repo_delete'), profile: 'full', args: { ...R, confirmName: 'hello' }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    seq(gh, REPO, full({ forks_count: 0, pushed_at: '2026-10-01T00:00:00Z' }), outcome === 'ok' ? null : full());
    gh.when('DELETE /repos/{owner}/{repo}').reply(204, null);
  }
});

runWriteContract({
  label: 'github_repo_fork', definition: def('github_repo_fork'), args: { owner: 'upstream-owner', repo: 'hello', organization: 'example-org' }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, REPO, null);
    gh.when('POST /repos/{owner}/{repo}/forks').reply(202, full({ fork: outcome === 'ok' }));
  }
});

runWriteContract({
  label: 'github_repo_sync_fork (default branch)', definition: def('github_repo_sync_fork'), args: { ...R }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    seq(gh, REPO, full({ fork: true, parent: { full_name: 'upstream-owner/hello' } }));
    gh.when('POST /repos/{owner}/{repo}/merge-upstream').reply(200, outcome === 'ok' ? { message: 'Successfully fetched and fast-forwarded from upstream', merge_type: 'fast-forward', base_branch: 'upstream-owner:main' } : { message: 'nothing happened' });
  }
});

runWriteContract({
  label: 'github_repo_set_custom_properties', definition: def('github_repo_set_custom_properties'), profile: 'full', args: { ...R, set: [{ name: 'team', value: 'core' }] }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, 'GET /repos/{owner}/{repo}/properties/values', [], outcome === 'ok' ? [{ property_name: 'team', value: 'core' }] : []);
    gh.when('PATCH /repos/{owner}/{repo}/properties/values').reply(204, null);
  }
});

runWriteContract({
  label: 'github_repo_star', definition: def('github_repo_star'), args: { owner: 'someone', repo: 'cool', starred: true }, needsConfirm: false,
  arrange(gh, outcome) {
    gh.when('GET /user/starred/{owner}/{repo}').replySequence([{ status: 404, body: nf }, outcome === 'ok' ? { status: 204, body: null } : { status: 404, body: nf }]);
    gh.when('PUT /user/starred/{owner}/{repo}').reply(204, null);
  }
});

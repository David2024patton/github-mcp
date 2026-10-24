// GOD-2: every personal-account call site uses the master token when it is added (and covers the scope), keeps the
// App user sign-in (U) otherwise, and never uses the master token on a read-only connection. One shared file instead of
// one case per tool file; each case drives the real tool through the dispatcher against the fake GitHub.
import { describe, expect, it } from 'vitest';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const ALL = ['gist', 'user', 'repo', 'admin:public_key', 'admin:gpg_key', 'admin:ssh_signing_key', 'codespace', 'admin:org'];
const who = { id: 1, login: 'example-owner', type: 'User' };

function withMaster(w, scopes = ALL) {
  const base = w.credentials;
  const credentials = Object.assign(Object.create(base), {
    masterStatus: async () => ({ enrolled: true, scopes, expires_at: null }),
    authorizeOptionalRequest: async () => true,
    token: async (o) => (o.cred === 'M' ? 'ghp_FAKEmaster' : base.token(o))
  });
  return { ...w, credentials, ctx: { ...w.ctx, credentials } };
}
async function call(w, name, args = {}) {
  const run = createDispatch({ env: w.ctx.env, credentials: w.credentials, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep, gates: [] });
  return parse(await run({ registry, name, args, connection: w.connection, db: w.db }));
}
const auths = (w, route) => w.gh.calls.filter((c) => c.route === route).map((c) => c.headers.authorization ?? '');
const usedMaster = (w, route) => auths(w, route).some((a) => a.includes('ghp_FAKEmaster'));

const cases = [
  { name: 'github_gist_list', args: { max: 5 }, route: 'GET /gists', arrange: (gh) => { gh.when('GET /user').reply(200, who); gh.when('GET /gists').reply(200, []); } },
  { name: 'github_account_get', args: {}, route: 'GET /user', arrange: (gh) => { gh.when('GET /user').reply(200, who); gh.when('GET /user/emails').reply(200, []); gh.when('GET /user/blocks').reply(200, []); gh.when('GET /user/orgs').reply(200, []); } },
  { name: 'github_account_list_keys', args: {}, route: 'GET /user/keys', arrange: (gh) => { gh.when('GET /user').reply(200, who); gh.when('GET /user/keys').reply(200, []); gh.when('GET /user/ssh_signing_keys').reply(200, []); gh.when('GET /user/gpg_keys').reply(200, []); } },
  { name: 'github_codespace_list', args: { scope: 'user' }, route: 'GET /user/codespaces', arrange: (gh) => { gh.when('GET /user').reply(200, who); gh.when('GET /user/codespaces').reply(200, { total_count: 0, codespaces: [] }); } },
  { name: 'github_user_follow', args: { username: 'octocat', dryRun: true }, route: 'GET /user/following/{username}', mode: 'preview', arrange: (gh) => { gh.when('GET /user').reply(200, who); gh.when('GET /user/following/{username}').reply(404, { message: 'Not Found' }); } },
  { name: 'github_repo_watch', args: { owner: 'example-org', repo: 'sample', state: 'watching', dryRun: true }, route: 'GET /repos/{owner}/{repo}/subscription', mode: 'preview', arrange: (gh) => { gh.when('GET /user').reply(200, who); gh.when('GET /repos/{owner}/{repo}/subscription').reply(404, { message: 'Not Found' }); } },
  { name: 'github_repo_star', args: { repo_owner: 'example-org', repo: 'sample', dryRun: true }, route: 'GET /user/starred/{owner}/{repo}', mode: 'preview', arrange: (gh) => { gh.when('GET /user/starred/{owner}/{repo}').reply(404, { message: 'Not Found' }); } },
  { name: 'github_org_migration_status', args: { migrationId: 5 }, route: 'GET /orgs/{org}/migrations/{migration_id}', arrange: (gh) => { gh.when('GET /orgs/{org}/migrations/{migration_id}').reply(200, { id: 5, state: 'pending', lock_repositories: false, repositories: [], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }); } }
];

describe('GOD-2 personal tools pick the credential', () => {
  for (const c of cases) {
    it(`${c.name}: uses the master token when added`, async () => {
      const w = withMaster(await makeWorld({ profile: 'full', mode: c.mode ?? 'preview' }));
      c.arrange(w.gh);
      await call(w, c.name, c.args);
      expect(usedMaster(w, c.route), JSON.stringify(auths(w, c.route))).toBe(true);
    });
    // Write tools are not even offered on a read-only connection (the call is refused before any GitHub request).
    it(`${c.name}: read-only connection keeps U (never the master token)`, async () => {
      const w = withMaster(await makeWorld({ profile: 'read_only', mode: 'preview' }));
      c.arrange(w.gh);
      if (c.mode) {
        const run = createDispatch({ env: w.ctx.env, credentials: w.credentials, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep, gates: [] });
        const out = await run({ registry, name: c.name, args: c.args, connection: w.connection, db: w.db });
        expect(out.isError).toBe(true);
      } else await call(w, c.name, c.args);
      expect(w.gh.calls.some((x) => (x.headers.authorization ?? '').includes('ghp_FAKEmaster'))).toBe(false);
    });
    it(`${c.name}: without a master token behaves as before`, async () => {
      const w = await makeWorld({ profile: 'full', mode: 'preview' });
      c.arrange(w.gh);
      await call(w, c.name, c.args);
      expect(w.gh.calls.some((x) => (x.headers.authorization ?? '').includes('ghp_FAKEmaster'))).toBe(false);
    });
  }
  it('key listing picks the credential per key kind', async () => {
    const w = withMaster(await makeWorld({ profile: 'full' }), ['admin:gpg_key']);
    cases[2].arrange(w.gh);
    await call(w, 'github_account_list_keys', {});
    expect(usedMaster(w, 'GET /user/gpg_keys')).toBe(true);
    expect(usedMaster(w, 'GET /user/keys')).toBe(false);
    expect(usedMaster(w, 'GET /user/ssh_signing_keys')).toBe(false);
  });
  it('a master token without the needed scope falls back to U', async () => {
    const w = withMaster(await makeWorld({ profile: 'full' }), ['repo']);
    cases[0].arrange(w.gh);
    await call(w, 'github_gist_list', { max: 5 });
    expect(usedMaster(w, 'GET /gists')).toBe(false);
  });
});

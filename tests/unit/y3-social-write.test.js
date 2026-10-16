import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as social from '../../src/tools/social-write.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const def = (name) => ({ tool: social.tools.find((t) => t.name === name), handler: social.handlers[name] });
const ME = { id: 55, login: 'example-owner', type: 'User' };

// ---- follow --------------------------------------------------------------------------------------------------------
// The fake keys replies by route template and fixes the status per reply, so a write re-registers the read route.
const NF = { message: 'Not Found' };
const arrangeFollow = (gh, outcome) => {
  gh.when('GET /user').reply(200, ME);
  gh.when('GET /user/following/{username}').reply(404, NF);
  gh.when('PUT /user/following/{username}').reply(204, () => { if (outcome === 'ok') gh.when('GET /user/following/{username}').reply(204, {}); return null; });
};
runWriteContract({ label: 'github_user_follow', definition: def('github_user_follow'), args: { username: 'outside-person' }, needsConfirm: true, notifies: ['outside-person'], arrange: arrangeFollow, profile: 'full' });

// ---- watch ---------------------------------------------------------------------------------------------------------
const SUB = (subscribed) => ({ subscribed, ignored: false, reason: null, created_at: '2026-01-01T00:00:00Z', url: 'https://api.github.com/repos/example-org/app/subscription', repository_url: 'https://api.github.com/repos/example-org/app' });
const arrangeWatch = (gh, outcome) => {
  gh.when('GET /user').reply(200, ME);
  gh.when('GET /repos/{owner}/{repo}/subscription').reply(404, NF);
  gh.when('PUT /repos/{owner}/{repo}/subscription').reply(200, () => { if (outcome === 'ok') gh.when('GET /repos/{owner}/{repo}/subscription').reply(200, SUB(true)); return SUB(true); });
};
runWriteContract({ label: 'github_repo_watch', definition: def('github_repo_watch'), args: { owner: 'example-org', repo: 'app', state: 'watching' }, needsConfirm: false, arrange: arrangeWatch, profile: 'full' });

// ---- profile links -------------------------------------------------------------------------------------------------
const arrangeSocial = (gh, outcome) => {
  const link = [{ provider: 'generic', url: 'https://example.com/me' }];
  gh.when('GET /user').reply(200, ME);
  gh.when('GET /user/social_accounts').reply(200, []);
  gh.when('POST /user/social_accounts').reply(201, () => { if (outcome === 'ok') gh.when('GET /user/social_accounts').reply(200, link); return link; });
};
runWriteContract({ label: 'github_user_set_social', definition: def('github_user_set_social'), args: { add: ['https://example.com/me'] }, needsConfirm: true, production: true, accessWidening: true, arrange: arrangeSocial, profile: 'full' });

describe('Y-3 social tools: refusals and registration', () => {
  const run = async (w, name, args) => parse(await createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })({ registry, name, args, connection: w.connection, db: w.db }));
  it('all twelve tools are registered with short descriptions', () => {
    for (const n of ['github_user_get', 'github_user_list_repos', 'github_user_list_social', 'github_user_list_followers', 'github_user_list_following', 'github_public_repo_get', 'github_public_repo_list', 'github_user_follow', 'github_repo_watch', 'github_user_set_social', 'github_star_list_manage', 'github_star_list_get']) {
      const t = registry.tools.find((x) => x.name === n);
      expect(t, n).toBeTruthy();
      expect(t.description.length, n).toBeLessThanOrEqual(160);
    }
  });
  it('refuses following yourself and sends no write', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    arrangeFollow(w.gh, 'ok');
    const r = await run(w, 'github_user_follow', { username: 'example-owner', confirm: true }).catch(() => ({ done: false }));
    expect(r.done).toBe(false);
    expect(w.gh.requests?.filter((q) => q.method === 'PUT') ?? []).toHaveLength(0);
  });
  it('refuses a non-https link and a link that is not on the profile', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    arrangeSocial(w.gh, 'ok');
    for (const bad of [{ add: ['http://example.com/x'] }, { remove: ['https://example.com/absent'] }, {}]) {
      const r = await run(w, 'github_user_set_social', { ...bad, confirm: true }).catch(() => ({ done: false }));
      expect(r.done, JSON.stringify(bad)).toBe(false);
    }
  });
});

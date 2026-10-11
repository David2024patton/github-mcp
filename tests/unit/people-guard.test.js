import { describe, expect, it } from 'vitest';
import { GITHUB_ACTIONS_BOT, accessChange, becomesPublic, cleanLogins, invitation, mentionsIn, notifyOutsiders, ownPeople, peopleGate } from '../../src/tools/people-guard.js';
import { sampleCollaborator, sampleComment } from '../../test/helpers/sample-writes.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const MEMBERS = 'GET /orgs/{org}/members';
async function world({ members = ['chris-owner', 'teammate'], gates = [peopleGate()] } = {}) {
  const w = await makeWorld({ gates });
  await w.db.upsertAccount({ login: 'example-org', accountId: 5, accountType: 'Organization', label: 'x', credentialKind: 'fine_grained' });
  if (members) w.gh.when(MEMBERS).reply(200, members.map((login) => ({ login, id: 1, type: 'User' })));
  return w;
}

describe('mentions and names', () => {
  it('finds @names and @org/team, not email addresses or code spans', () => {
    expect(mentionsIn('hi @alice and @Bob-1, cc @example-org/devs. mail me@site.com and `@code`')).toEqual(['alice', 'Bob-1', 'example-org/devs']);
    expect(mentionsIn('')).toEqual([]);
    expect(mentionsIn(undefined)).toEqual([]);
  });
  it('cleans the own-people list typed on the setup page', () => {
    expect(cleanLogins('@alice, bob  carol')).toEqual({ logins: ['alice', 'bob', 'carol'] });
    expect(cleanLogins('my-app[bot]')).toEqual({ logins: ['my-app[bot]'] });
    expect(cleanLogins('bad name!').error).toContain('not a valid GitHub name');
    expect(cleanLogins(Array.from({ length: 60 }, (_, i) => `u${i}`)).error).toContain('At most');
  });
});

describe('who counts as your own people (IN-13)', () => {
  it('is connected accounts, their organization members, github-actions[bot], this server\'s App bots and the owner\'s extras', async () => {
    const w = await world();
    await w.db.upsertAccount({ login: 'christcr2012', accountId: 6, accountType: 'User', label: 'me', credentialKind: 'fine_grained' });
    await w.db.setSetting('own_people', { logins: ['Friend'] });
    const { people, complete } = await ownPeople(w.ctx);
    for (const n of ['example-org', 'christcr2012', 'chris-owner', 'teammate', GITHUB_ACTIONS_BOT, 'friend']) expect(people.has(n)).toBe(true);
    expect(people.has('stranger')).toBe(false);
    expect(complete).toBe(true);
  });
  it('treats members as outsiders when the member list cannot be read, and says so', async () => {
    const w = await world({ members: null });
    w.gh.when(MEMBERS).reply(403, { message: 'Resource not accessible by integration' });
    const { people, complete } = await ownPeople(w.ctx);
    expect(complete).toBe(false);
    expect(people.has('teammate')).toBe(false);
  });
});

describe('who a change would notify', () => {
  it('names outsiders mentioned in text or listed as people, and ignores own people', async () => {
    const w = await world();
    const r = await notifyOutsiders(w.ctx, { logins: ['teammate', 'stranger'], text: 'thanks @chris-owner and @other-person, cc @example-org/devs @elsewhere/team', repoOwner: 'example-org' });
    expect(r.notifies).toEqual(['stranger', 'other-person', 'elsewhere/team']);
  });
  it('a repository of an account that is not connected notifies everyone watching it', async () => {
    const w = await world();
    const r = await notifyOutsiders(w.ctx, { text: 'no mentions', repoOwner: 'someone-else' });
    expect(r.notifies).toEqual(['everyone watching someone-else']);
  });
  it('nobody outside means no notification and no confirmation', async () => {
    const w = await world();
    expect((await notifyOutsiders(w.ctx, { text: 'plain text @teammate', repoOwner: 'example-org' })).notifies).toEqual([]);
  });
});

describe('access helpers', () => {
  it('say who gets what and what they have today', () => {
    expect(accessChange({ who: 'Sam (sam-dev)', access: 'write', where: 'example-org/app', before: 'none' }).accessWidening)
      .toBe('Sam (sam-dev) gets write access to example-org/app; today: none');
    expect(invitation({ who: 'sam-dev', access: 'read', where: 'example-org/app' })).toMatchObject({ notifies: ['sam-dev'] });
    expect(becomesPublic({ what: 'example-org/app' }).accessWidening).toContain('visible to everyone');
  });
  it('the gate makes a tool declared as widening access always ask', async () => {
    const v = await peopleGate()({ classification: {}, declarations: { accessWidening: true } });
    expect(v.confirm).toContain('always asks');
    expect(await peopleGate()({ classification: { accessWidening: 'x' }, declarations: { accessWidening: true } })).toBeNull();
    expect(await peopleGate()({ classification: {}, declarations: {} })).toBeNull();
  });
});

describe('the sample tools still behave with the real people gate', () => {
  it('a collaborator invitation always asks and names the person', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/collaborators').reply(200, []);
    const res = parse(await sampleCollaborator.handler({ owner: 'example-org', repo: 'app', username: 'sam-dev', permission: 'push' }, w.ctx));
    expect(res.status).toBe('needs_confirmation');
    expect(res.preview).toContain('ACCESS CHANGE');
    expect(res.preview).toContain('NOTIFIES sam-dev');
  });
  it('a comment that mentions only own people needs no confirmation', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/comments').replySequence([{ status: 200, body: [] }, { status: 200, body: [{ id: 1 }] }]);
    w.gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/comments').reply(201, { id: 1 });
    const res = parse(await sampleComment.handler({ owner: 'example-org', repo: 'app', issue_number: 3, body: 'ok @teammate' , dryRun: true}, w.ctx));
    expect(res.status).toBe('preview');
  });
});

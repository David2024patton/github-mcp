import { describe, expect, it } from 'vitest';
import { runWriteContract, doorsFor, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { sampleLabel, sampleSetting, sampleComment, sampleCollaborator, sampleSeat, SEAT_PRICE_CENTS } from '../../test/helpers/sample-writes.js';
import { ownPeople } from '../../src/tools/people-guard.js';

const R = { owner: 'example-org', repo: 'hello' };
const seq = (gh, route, before, after) => gh.when(route).replySequence([{ status: 200, body: before }, { status: 200, body: after }]);

// Plain tool: an ordinary preview-able write, no confirmation needed, never production.
runWriteContract({
  label: 'plain tool (label)', definition: sampleLabel, args: { ...R, issue_number: 7, label: 'bug' }, needsConfirm: false, conveyor: true,
  arrange(gh, outcome) {
    seq(gh, 'GET /repos/{owner}/{repo}/issues/{issue_number}/labels', [], outcome === 'ok' ? [{ name: 'bug' }] : []);
    gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200, [{ name: 'bug' }]);
  }
});

// Production tool: a repository setting.
runWriteContract({
  label: 'production tool (setting)', definition: sampleSetting, args: { ...R, description: 'Hello world' }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    seq(gh, 'GET /repos/{owner}/{repo}', { description: 'Old', default_branch: 'main' }, { description: outcome === 'ok' ? 'Hello world' : 'Old', default_branch: 'main' });
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, { description: 'Hello world' });
  }
});

// Message tool: confirm only when someone outside the own people is mentioned.
runWriteContract({
  label: 'message tool (comment)', definition: sampleComment, args: { ...R, issue_number: 3, body: 'Thanks @outside-person' }, needsConfirm: true, notifies: ['outside-person'], conveyor: true,
  quietArgs: { ...R, issue_number: 3, body: 'Thanks @example-owner, merging now' },
  arrange(gh, outcome) {
    seq(gh, 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments', [], outcome === 'ok' ? [{ id: 1 }] : []);
    gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/comments').reply(201, { id: 1 });
  }
});

// Access tool: always names the person and the access, always confirms.
runWriteContract({
  label: 'access tool (collaborator)', definition: sampleCollaborator, args: { ...R, username: 'new-dev', permission: 'push' }, needsConfirm: true, accessWidening: true, notifies: ['new-dev'],
  arrange(gh, outcome) {
    seq(gh, 'GET /repos/{owner}/{repo}/collaborators', [{ login: 'example-owner' }], outcome === 'ok' ? [{ login: 'example-owner' }, { login: 'new-dev' }] : [{ login: 'example-owner' }]);
    gh.when('PUT /repos/{owner}/{repo}/collaborators/{username}').reply(201, { id: 1 });
  }
});

// Spending tool: the cost comes from the price table (seats not already assigned), never from the arguments.
runWriteContract({
  label: 'spending tool (seat)', definition: sampleSeat, args: { owner: 'example-org', usernames: ['dev-one'] }, needsConfirm: true, spendCents: SEAT_PRICE_CENTS,
  arrange(gh, outcome) {
    seq(gh, 'GET /orgs/{org}/copilot/billing/seats', { seats: [] }, { seats: outcome === 'ok' ? [{ assignee: { login: 'dev-one' } }] : [] });
    gh.when('POST /orgs/{org}/copilot/billing/selected_users').reply(201, { seats_created: 1 });
  }
});

describe('bounded fake write spacing across all execution doors', () => {
  it('injects simulated sleep through dispatch and github_call without bypassing reserved write slots', async () => {
    for (const door of doorsFor(sampleLabel).filter((item) => item.name !== 'handler')) {
      const w = await makeWorld();
      const waits = [];
      w.ctx.sleep = async (ms) => { waits.push(ms); };
      w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/labels').replySequence([
        { status: 200, body: [] },
        { status: 200, body: [{ name: 'first' }] },
        { status: 200, body: [{ name: 'first' }] },
        { status: 200, body: [{ name: 'first' }, { name: 'second' }] }
      ]);
      w.gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/labels')
        .reply(200, [{ name: 'first' }, { name: 'second' }]);
      const first = parse(await door.call(w, { ...R, issue_number: 7, label: 'first' }));
      const second = parse(await door.call(w, { ...R, issue_number: 7, label: 'second' }));
      expect(first.status).toBe('applied');
      expect(second.status).toBe('applied');
      expect(waits).toEqual([1000]);
      expect(w.gh.invalid).toEqual([]);
    }
  });
});

describe('complete fake membership fixtures', () => {
  it('supplies organization members without retryable fake 501 errors', async () => {
    const w = await makeWorld();
    const result = await ownPeople(w.ctx);
    expect(result.complete).toBe(true);
    expect(result.people.has('example-owner')).toBe(true);
    expect(w.gh.calls.filter((call) => call.route === 'GET /orgs/{org}/members')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('still lets permission tests explicitly refuse organization membership reads', async () => {
    const w = await makeWorld();
    w.gh.when('GET /orgs/{org}/members').reply(403, { message: 'Forbidden' });
    const result = await ownPeople(w.ctx);
    expect(result.complete).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { exactIntegers, githubFor } from '../../src/github/client.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const CONNECTION = Object.freeze({ client_id: 'c', default_account: 'example-org', accounts: Object.freeze(['example-org']),
  mode: 'preview', profile: 'everyday', listing: 'catalog' });

describe('integers beyond 2^53 from GitHub (webhook delivery IDs)', () => {
  it('exactIntegers turns every BigInt into its exact digits and leaves the rest alone', () => {
    const out = exactIntegers({ id: 240000000000000001n, small: 7, name: 'x', nested: [{ id: 9007199254740993n }], none: null });
    expect(out).toEqual({ id: '240000000000000001', small: 7, name: 'x', nested: [{ id: '9007199254740993' }], none: null });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('a real client response with an unsafe integer comes back as exact text that can be saved and sent as JSON', async () => {
    const db = createFakeDb({ clock: () => Date.UTC(2026, 9, 23) });
    await db.initSchema();
    const ctx = { connection: CONNECTION, db, now: () => Date.UTC(2026, 9, 23), sleep: async () => {},
      credentials: { token: async () => 'ghs_FAKEinstallationtoken' },
      fetch: async () => new Response('[{"id":240000000000000001,"event":"ping"},{"id":12,"event":"push"}]',
        { status: 200, headers: { 'content-type': 'application/json' } }) };
    const octokit = await githubFor(ctx, { owner: 'example-org' });
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries', { owner: 'example-org', repo: 'hello', hook_id: 1 });
    expect(data[0].id).toBe('240000000000000001');
    expect(data[1].id).toBe(12);
    expect(() => JSON.stringify(data)).not.toThrow();
  });
});

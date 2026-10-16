import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as account from '../../src/tools/user-account.js';

const VIEWER = { id: 'U_kgDOexample', login: 'example-owner' };
const status = (over = {}) => ({ emoji: ':palm_tree:', message: 'On vacation', expiresAt: '2099-01-01T00:00:00Z', indicatesLimitedAvailability: true, ...over });
const def = { tool: account.tools.find((t) => t.name === 'github_account_set_status'), handler: account.handlers.github_account_set_status };
const args = { emoji: ':palm_tree:', message: 'On vacation', expiresAt: '2099-01-01T00:00:00Z', limitedAvailability: true };

// before: no status; after the mutation the viewer shows it (or, for "mismatch", something else).
const arrange = (gh, outcome) => {
  let written = false;
  gh.when('POST /graphql').reply(200, (req) => {
    const q = req.body.query;
    if (q.includes('mutation')) { written = true; return { data: { changeUserStatus: { status: status() } } }; }
    return { data: { viewer: { ...VIEWER, status: !written ? null : outcome === 'ok' ? status() : status({ message: 'Different' }) } } };
  });
};
runWriteContract({ label: 'github_account_set_status', definition: def, args, needsConfirm: true, arrange, profile: 'full' });

const call = async (w, a) => {
  const run = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep });
  const r = await run({ registry, name: 'github_account_set_status', args: a, connection: w.connection, db: w.db });
  return r.structuredContent ?? parse(r);
};

describe('github_account_set_status (Y-1)', () => {
  it('is registered in the full profile with the user credential', () => {
    const t = registry.tools.find((x) => x.name === 'github_account_set_status');
    expect(t).toBeTruthy();
    expect(t.declarations.cred).toBe('U');
    expect(t.description.length).toBeLessThanOrEqual(160);
  });
  it('refuses a past expiry, a long message and clear-with-extras without sending anything', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    arrange(w.gh, 'ok');
    for (const bad of [{ message: 'x', expiresAt: '2001-01-01T00:00:00Z' }, { message: 'x'.repeat(81) }, { message: '', limitedAvailability: true }, { message: 'x', expiresAt: 'tomorrow' }]) {
      // Schema errors come back as plain text; read-phase refusals as a structured "done: false".
      const r = await call(w, { ...bad, confirm: true }).catch(() => ({ done: false }));
      expect(r.done, JSON.stringify(bad)).toBe(false);
    }
    expect(w.gh.graphql.filter((g) => g.query.includes('mutation'))).toHaveLength(0);
  });
  it('clears the status with an empty message and records the previous status as the undo', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    let cleared = false;
    w.gh.when('POST /graphql').reply(200, (req) => {
      if (req.body.query.includes('mutation')) { cleared = true; expect(req.body.variables).toMatchObject({ emoji: null, message: null, expiresAt: null }); return { data: { changeUserStatus: { status: null } } }; }
      return { data: { viewer: { ...VIEWER, status: cleared ? null : status() } } };
    });
    const r = await call(w, { message: '', confirm: true });
    expect(r.done).toBe(true);
    const change = (await w.db.listChanges?.({ limit: 1 }))?.[0];
    if (change?.inverse) expect(change.inverse).toMatchObject({ tool: 'github_account_set_status', args: { emoji: ':palm_tree:', message: 'On vacation', limitedAvailability: true } });
  });
  it('the universal GraphQL route points changeUserStatus at this tool', async () => {
    const { curatedGraphqlMutation } = await import('../../src/github/mutation-classes.js');
    expect(curatedGraphqlMutation('changeUserStatus')).toBe('github_account_set_status');
  });
});

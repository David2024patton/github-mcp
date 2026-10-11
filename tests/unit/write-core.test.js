import { describe, expect, it } from 'vitest';
import { defineWrite } from '../../src/core/write.js';
import { requestKey } from '../../src/github/client.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runWriteContract } from '../helpers/write-contract.js';

const CONNECTION = Object.freeze({ client_id: 'client-1', default_account: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'everyday', listing: 'catalog' });

/** A sample service with its own state, so the generic layer is tested without GitHub. */
function sampleTool({ name, classify, production = 'never', accessWidening = false, notifies = false, spend = false, mismatch = false, failApply = false, readFails = false, inverse = true }) {
  const state = { writes: 0, items: new Map() };
  const { tool, handler } = defineWrite({
    name, description: 'Sample write', inputSchema: { type: 'object', properties: { item: { type: 'string' } } }, area: 'sample', profiles: ['everyday'], cred: 'I',
    production, accessWidening, notifies, spend,
    plan: async (args) => ({ before: { exists: state.items.has(args.item) } }),
    target: (args) => ({ owner: 'example-org', repo: 'hello', label: `example-org/hello:${args.item}` }),
    classify, summary: (args) => `Create item "${args.item}" in example-org/hello.`,
    apply: async (args) => { if (failApply) throw Object.assign(new Error('GitHub said no'), { requestId: 'REQ-FAIL' }); state.writes++; state.items.set(args.item, true); return { requestId: 'REQ-1' }; },
    readAfter: async (args) => { if (readFails) throw new Error('read exploded'); return { item: args.item, present: state.items.has(args.item) }; },
    verify: (args, ctx, plan, after) => (mismatch ? { ok: false } : after.present === true),
    inverse: inverse ? (args) => ({ tool: 'sample_delete', args: { item: args.item } }) : undefined,
    requestKey
  });
  return { tool, handler, state };
}

async function world(options = {}, { mode = 'preview', guards } = {}) {
  const db = createFakeDb();
  await db.initSchema();
  const t = sampleTool(options);
  const ctx = { connection: { ...CONNECTION, mode }, db, requestKey, guards, now: () => Date.UTC(2026, 9, 11, 12, 0, 0) };
  return { ...t, ctx, db, toolName: t.tool.name, writes: () => t.state.writes };
}
const builder = (options) => async ({ guards, mode, mismatch } = {}) => world({ ...options, mismatch: !!mismatch }, { guards, mode });
const ARGS = { item: 'bug' };

runWriteContract('plain tool', { build: builder({ name: 'sample_plain' }), args: ARGS });
runWriteContract('production tool', { build: builder({ name: 'sample_prod', production: 'when-target', classify: () => ({ production: true }) }), args: ARGS, production: true, protectedLevel: 'pr-only' });
runWriteContract('locked-resource tool', { build: builder({ name: 'sample_locked' }), args: ARGS, protectedLevel: 'locked' });
runWriteContract('access-widening tool', { build: builder({ name: 'sample_access', accessWidening: true, classify: () => ({ accessWidening: true }) }), args: ARGS, accessWidening: true });
runWriteContract('message tool (outsider)', { build: builder({ name: 'sample_msg', notifies: true, classify: () => ({ notifies: ['sam-dev'] }) }), args: ARGS, notifiesOutsider: true });
runWriteContract('spending tool', { build: builder({ name: 'sample_spend', spend: true, classify: () => ({ spendCents: 1900 }) }), args: ARGS, spendCents: 1900 });

describe('defineWrite: declarations and schema', () => {
  it('refuses a missing or invalid declaration and adds dryRun, confirm and requestKey to the schema', () => {
    const base = { name: 'sample_x', description: 'd', summary: () => 's', apply: async () => ({}), production: 'never', accessWidening: false, notifies: false, spend: false };
    expect(() => defineWrite({ ...base, production: 'sometimes' })).toThrow(/production/);
    expect(() => defineWrite({ ...base, spend: undefined })).toThrow(/spend/);
    expect(() => defineWrite({ ...base, spend: true })).toThrow(/price/);
    expect(() => defineWrite({ ...base, apply: undefined })).toThrow(/apply/);
    const { tool } = defineWrite(base);
    expect(Object.keys(tool.inputSchema.properties)).toEqual(['dryRun', 'confirm', 'requestKey']);
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.writes).toBe(true);
    expect(tool.writeContract).toMatchObject({ production: 'never', spend: false });
  });
});

describe('defineWrite: safety behavior', () => {
  it('rejects non-boolean dryRun and confirm values, so "false" or "yes" can never count as consent', async () => {
    const w = await world({ name: 'sample_flags', production: 'always' });
    await expect(w.handler({ ...ARGS, confirm: 'yes' }, w.ctx)).rejects.toThrow(/confirm/);
    await expect(w.handler({ ...ARGS, dryRun: 1 }, w.ctx)).rejects.toThrow(/dryRun/);
    expect(w.writes()).toBe(0);
  });

  it('fails closed when classify throws: production and access change, so it asks first', async () => {
    const w = await world({ name: 'sample_closed', classify: () => { throw new Error('GitHub unreachable'); } });
    const res = await w.handler({ ...ARGS }, w.ctx);
    expect(res.status).toBe('confirmation_required');
    expect(res.reasons).toEqual(expect.arrayContaining(['production', 'access change']));
    expect(w.writes()).toBe(0);
  });

  it('ignores a classification claimed in the arguments; only classify decides', async () => {
    const w = await world({ name: 'sample_args', classify: () => ({}) });
    const res = await w.handler({ ...ARGS, production: false, notifies: [], spendCents: 0, confirm: false }, w.ctx).catch((e) => e);
    expect(res.status).toBe('applied');
  });

  it('a guard error refuses with a plain message and writes nothing; a guard can demand confirm', async () => {
    const boom = await world({ name: 'sample_gerr' }, { guards: [() => { throw new Error('db down'); }] });
    expect(await boom.handler({ ...ARGS, confirm: true }, boom.ctx)).toMatchObject({ status: 'refused_by_guard', code: 'guard_error' });
    expect(boom.writes()).toBe(0);
    const ask = await world({ name: 'sample_gask' }, { guards: [() => ({ confirm: 'outside project' })] });
    expect(await ask.handler({ ...ARGS }, ask.ctx)).toMatchObject({ status: 'confirmation_required', reasons: ['outside project'] });
  });

  it('declared production "always" asks even if classify says nothing', async () => {
    const w = await world({ name: 'sample_always', production: 'always' });
    const res = await w.handler({ ...ARGS }, w.ctx);
    expect(res.status).toBe('confirmation_required');
    expect(res.preview).toContain('PRODUCTION.');
  });

  it('a failed apply stores a failed row, rethrows, and a retry does not write again', async () => {
    const w = await world({ name: 'sample_fail', failApply: true });
    await expect(w.handler({ ...ARGS }, w.ctx)).rejects.toThrow('GitHub said no');
    const row = await w.db.getChangeByRequestKey(requestKey(w.ctx, 'sample_fail', ARGS));
    expect(row).toMatchObject({ confirmed: false, github_request_id: 'REQ-FAIL', after: { error: 'GitHub said no' } });
    const retry = await w.handler({ ...ARGS }, w.ctx);
    expect(retry).toMatchObject({ status: 'replayed', ok: false });
    expect(retry.message).toMatch(/new requestKey/);
    expect(w.writes()).toBe(0);
  });

  it('a read-back that throws is reported as unconfirmed with a warning, not as a failure', async () => {
    const w = await world({ name: 'sample_readfail', readFails: true });
    const res = await w.handler({ ...ARGS }, w.ctx);
    expect(res).toMatchObject({ status: 'applied', confirmed: false });
    expect(res.warning).toContain('could not be read back');
    expect(w.writes()).toBe(1);
  });

  it('two simultaneous identical calls write once; the other reports in_progress or replayed', async () => {
    const w = await world({ name: 'sample_race' });
    const results = await Promise.all([w.handler({ ...ARGS }, w.ctx), w.handler({ ...ARGS }, w.ctx), w.handler({ ...ARGS }, w.ctx)]);
    expect(w.writes()).toBe(1);
    expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 'applied')) expect(['in_progress', 'replayed']).toContain(r.status);
  });

  it('stores the inverse and the pre-change state; a different requestKey is a different change', async () => {
    const w = await world({ name: 'sample_inv' });
    const res = await w.handler({ ...ARGS, requestKey: 'first' }, w.ctx);
    expect(res.undo_available).toBe(true);
    const row = await w.db.getChangeByRequestKey(requestKey(w.ctx, 'sample_inv', { ...ARGS, requestKey: 'first' }));
    expect(row.inverse).toEqual({ tool: 'sample_delete', args: { item: 'bug' } });
    expect(row.before).toEqual({ exists: false });
    await w.handler({ ...ARGS, requestKey: 'second' }, w.ctx);
    expect(w.writes()).toBe(2);
  });
});

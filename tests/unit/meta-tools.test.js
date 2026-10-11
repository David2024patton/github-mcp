import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { mergeNamespaces, listedDescription, listedTool, toolsForListing, toolsForProfile } from '../../src/core/registry.js';
import { areaOf, describeTool, kindOf, marksOf, searchTools } from '../../src/core/meta.js';
import { createGates } from '../../src/tools/gates.js';
import { makeWorld } from '../../test/helpers/write-contract.js';
import { defineRead } from '../../src/tools/define-read.js';
import { sampleSeat, sampleLabel } from '../../test/helpers/sample-writes.js';
import * as meta from '../../src/tools/meta.js';

async function world(profile = 'full', extra = {}) {
  const w = await makeWorld({ profile, accounts: ['example-org', 'example-user'], gates: createGates(), ...extra });
  const dispatch = createDispatch({ credentials: w.credentials, gates: w.ctx.gates, fetch: w.gh.fetch, now: w.ctx.now });
  const run = (name, args, reg = registry) => dispatch({ registry: reg, name, args, connection: w.connection, db: w.db });
  return { ...w, run };
}
const data = (r) => r.structuredContent;

describe('github_search_tools', () => {
  it('finds tools by plain words, with kind and safety marks', async () => {
    const w = await world();
    const r = data(await w.run('github_search_tools', { query: 'default account' }));
    expect(r.tools[0]).toMatchObject({ name: 'github_set_default_account', kind: 'change', area: 'server' });
    expect(r.tools[0].safety).toContain('preview first (dryRun)');
    const prod = data(await w.run('github_search_tools', { query: 'production' })).tools.map((t) => t.name);
    expect(prod).toContain('github_enable_production');
  });
  it('shows only the tools the profile includes', async () => {
    const full = await world('full');
    const low = await world('read_only');
    expect(data(await full.run('github_search_tools', { query: 'spend limit' })).tools.map((t) => t.name)).toContain('github_set_spend_limit');
    expect(data(await low.run('github_search_tools', { query: 'spend limit' })).tools.map((t) => t.name)).not.toContain('github_set_spend_limit');
  });
  it('filters by area and audience, caps the count, and wants something to go on', async () => {
    const w = await world();
    const byArea = data(await w.run('github_search_tools', { area: 'meta' }));
    expect(byArea.tools.map((t) => t.name).sort()).toEqual(['github_batch', 'github_call', 'github_describe_tool', 'github_search_tools']);
    const op = data(await w.run('github_search_tools', { audience: 'Op', limit: 2 }));
    expect(op.count).toBe(2);
    expect((await w.run('github_search_tools', {})).isError).toBe(true);
    expect(data(await w.run('github_search_tools', { query: 'zzzzqqqq' })).count).toBe(0);
    expect((await w.run('github_search_tools', { query: 'x', limit: 99 })).isError).toBe(true);
  });
});

describe('github_describe_tool', () => {
  it('gives the arguments and safety of a read and of a change', async () => {
    const w = await world();
    const read = data(await w.run('github_describe_tool', { name: 'github_recent_changes' }));
    expect(read).toMatchObject({ kind: 'read', safety: ['read-only'] });
    expect(read.arguments.properties).toHaveProperty('includePreviews');
    const write = data(await w.run('github_describe_tool', { name: 'github_revoke_connection' }));
    expect(write).toMatchObject({ kind: 'change', profiles: ['full'] });
    expect(write.safety).toContain('always asks first');
    expect(write.how_to_change).toContain('dryRun');
  });
  it('does not describe a tool the profile cannot see, or one that does not exist', async () => {
    const low = await world('read_only');
    for (const name of ['github_revoke_connection', 'github_nope']) {
      const r = await low.run('github_describe_tool', { name });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('Unknown or unavailable');
    }
  });
});

describe('github_call', () => {
  it('runs a read tool exactly as calling it directly', async () => {
    const w = await world();
    const direct = data(await w.run('github_whoami', {}));
    const called = data(await w.run('github_call', { name: 'github_whoami', args: {} }));
    expect(called).toEqual(direct);
  });
  it('runs a change through the write layer: preview, then the same refusals', async () => {
    const w = await world();
    await w.db.upsertAccount({ login: 'example-user', accountId: 55, accountType: 'User', label: 'P', credentialKind: 'fine_grained' });
    const preview = data(await w.run('github_call', { name: 'github_set_default_account', args: { account: 'example-user', dryRun: true } }));
    expect(preview.preview).toContain('example-user');
    const refused = await w.run('github_call', { name: 'github_set_default_account', args: { account: 'unrelated-org', confirm: true } });
    expect(data(refused).status).toBe('refused');
  });
  it('cannot be used to reach a tool the profile hides, a tool that does not exist, bad arguments, or the tool-finding tools', async () => {
    const low = await world('read_only');
    for (const [name, args] of [['github_revoke_connection', { connection: 'x', confirm: true }], ['github_nope', {}], ['github_call', { name: 'github_whoami' }], ['github_batch', { calls: [{ name: 'github_whoami' }] }], ['github_search_tools', { query: 'x' }]]) {
      const r = await low.run('github_call', { name, args });
      expect(r.isError, name).toBe(true);
    }
    expect((await low.run('github_call', { name: 'github_whoami', args: { detail: 'huge' } })).isError).toBe(true);
    expect((await low.run('github_call', {})).isError).toBe(true);
    expect((await low.run('github_call', { name: 'github_whoami', extra: 1 })).isError).toBe(true);
  });
  it('is not listed as read-only, because it can run changes', () => {
    const tool = meta.tools.find((t) => t.name === 'github_call');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe('github_batch', () => {
  it('runs several reads and reports each, including one that fails', async () => {
    const w = await world();
    const r = data(await w.run('github_batch', { calls: [{ name: 'github_whoami' }, { name: 'github_list_accounts', args: { detail: 'huge' } }, { name: 'github_recent_changes', args: { limit: 1 } }] }));
    expect(r.count).toBe(3);
    expect(r.results[0]).toMatchObject({ name: 'github_whoami', ok: true });
    expect(r.results[0].result.accounts).toBeTruthy();
    expect(r.results[1]).toMatchObject({ name: 'github_list_accounts', ok: false });
    expect(r.results[2]).toMatchObject({ name: 'github_recent_changes', ok: true });
  });
  it('refuses changes, the runner and tool-finding tools, tools it cannot see, empty and oversize batches', async () => {
    const w = await world();
    for (const name of ['github_set_default_account', 'github_call', 'github_batch', 'github_search_tools', 'github_nope']) {
      const r = await w.run('github_batch', { calls: [{ name: 'github_whoami' }, { name }] });
      expect(r.isError, name).toBe(true);
      expect(r.content[0].text).toContain('read tools only');
    }
    expect((await w.run('github_batch', { calls: [] })).isError).toBe(true);
    expect((await w.run('github_batch', { calls: Array.from({ length: 11 }, () => ({ name: 'github_whoami' })) })).isError).toBe(true);
  });
  it('keeps a combined result that is too big behind a handle', async () => {
    const w = await world();
    const bigRead = defineRead({ name: 'github_t_big', description: 'Big.', handler: async () => ({ text: 'word '.repeat(1500), list: Array.from({ length: 30 }, (_, i) => ({ i, note: 'n'.repeat(100) })) }) });
    const reg = mergeNamespaces([meta, { tools: [bigRead.tool], handlers: { github_t_big: bigRead.handler } }]);
    const r = data(await w.run('github_batch', { calls: [{ name: 'github_t_big' }, { name: 'github_t_big' }, { name: 'github_t_big' }] }, reg));
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(8192);
    expect(r.kept_result?.handle ?? r.results[0].result.kept_result?.handle).toMatch(/^res_/);
  });
});

describe('listing', () => {
  it('compact lists only the tools marked compact; catalog lists everything the profile may see', () => {
    const compact = toolsForListing(registry, 'full', 'compact').map((t) => t.name);
    expect(compact).toEqual(['github_search_tools', 'github_describe_tool', 'github_call', 'github_batch', 'github_whoami', 'github_get_result']);
    expect(toolsForListing(registry, 'full', 'catalog')).toHaveLength(registry.tools.length);
    expect(toolsForListing(registry, 'read_only', 'catalog')).toEqual(toolsForProfile(registry, 'read_only'));
    expect(toolsForListing(registry, 'read_only', 'whatever')).toEqual(toolsForProfile(registry, 'read_only'));
  });
  it('puts PRODUCTION and SPENDS MONEY first in the description of a tool that is, and sends annotations', () => {
    expect(listedDescription(sampleSeat.tool)).toBe('SPENDS MONEY: Sample: assign Copilot seats (costs money).');
    expect(listedDescription(sampleLabel.tool)).toBe(sampleLabel.tool.description);
    const prod = { name: 'github_x', description: 'Delete it.', writes: true, declarations: { production: 'always', spend: true } };
    expect(listedDescription(prod)).toBe('PRODUCTION, SPENDS MONEY: Delete it.');
    expect(listedDescription({ ...prod, description: 'PRODUCTION, SPENDS MONEY: Delete it.' })).toBe('PRODUCTION, SPENDS MONEY: Delete it.');
    expect(listedTool(sampleSeat.tool)).toHaveProperty('annotations.readOnlyHint', false);
    expect(Object.keys(listedTool(sampleSeat.tool)).sort()).toEqual(['annotations', 'description', 'inputSchema', 'name']);
  });
});

describe('the finding helpers', () => {
  it('derive area, kind, marks and a description', () => {
    expect(areaOf({ name: 'github_pr_merge' })).toBe('pr');
    expect(areaOf({ name: 'github_pr_merge', area: 'custom' })).toBe('custom');
    expect(kindOf(meta.tools.find((t) => t.name === 'github_call'))).toBe('runner');
    expect(marksOf(sampleSeat.tool)).toContain('SPENDS MONEY');
    expect(marksOf({ name: 'x', writes: true, declarations: { production: 'when-target', accessWidening: true, notifies: true, confirm: 'always' } })).toEqual(['production when the target is', 'changes who has access', 'may notify people', 'always asks first']);
    expect(describeTool(sampleSeat.tool).arguments).toBe(sampleSeat.tool.inputSchema);
    expect(searchTools([sampleSeat.tool, sampleLabel.tool], { query: 'copilot seats' }).map((t) => t.name)).toEqual(['github_sample_seat']);
  });
});

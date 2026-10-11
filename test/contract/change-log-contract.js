// Contract for the change log (B-1): previews and refusals are plain rows, a real write claims its request key exactly once
// (even when two callers race), and the claimed row is finished with the outcome. Run against the in-memory fake and real PostgreSQL.
import { describe, expect, it } from 'vitest';

const base = { account: 'example-org', repo: 'example-org/hello', mode: 'preview', connection: 'client-1', tool: 'github_sample_write', target: 'example-org/hello#1', summary: 'Do a thing' };

export function runChangeLogContract(name, make) {
  describe(`change log: ${name}`, () => {
    it('records a preview row and reads it back', async () => {
      const db = await make();
      const id = await db.recordChange({ ...base, dryRun: true, production: true, notifies: ['outsider'], spendCents: 1900 });
      expect(await db.getChange(id)).toMatchObject({ id, summary: 'Do a thing', dryRun: true, production: true, notifies: ['outsider'], spendCents: 1900, tool: 'github_sample_write', confirmed: null });
      expect(await db.getChange(id + 999)).toBeNull();
      await expect(db.recordChange({ ...base, summary: '' })).rejects.toThrow(TypeError);
      await expect(db.recordChange({ ...base, tool: '' })).rejects.toThrow(TypeError);
    });

    it('lets many previews share a request key but never records a real write without claiming it', async () => {
      const db = await make();
      await db.recordChange({ ...base, dryRun: true, requestKey: 'rmcp_a_1_1' });
      await db.recordChange({ ...base, dryRun: true, requestKey: 'rmcp_a_1_1' });
      await expect(db.recordChange({ ...base, dryRun: false, requestKey: 'rmcp_a_1_1' })).rejects.toThrow(TypeError);
    });

    it('lets exactly one caller claim a request key, and shows the others the first claim', async () => {
      const db = await make();
      const first = await db.claimChange({ ...base, requestKey: 'rmcp_b_1_1', summary: 'PENDING: first' });
      expect(first.claimed).toBe(true);
      const second = await db.claimChange({ ...base, requestKey: 'rmcp_b_1_1', summary: 'PENDING: second' });
      expect(second).toMatchObject({ claimed: false, existing: { id: first.id, summary: 'PENDING: first', confirmed: null } });
      const other = await db.claimChange({ ...base, requestKey: 'rmcp_b_1_2' });
      expect(other.claimed).toBe(true);
      await expect(db.claimChange({ ...base, requestKey: '' })).rejects.toThrow(TypeError);
    });

    it('lets only one of several simultaneous claims win', async () => {
      const db = await make();
      const results = await Promise.all(Array.from({ length: 5 }, (_, i) => db.claimChange({ ...base, requestKey: 'rmcp_race_1_1', summary: `PENDING ${i}` })));
      expect(results.filter((r) => r.claimed)).toHaveLength(1);
      const winner = results.find((r) => r.claimed);
      for (const loser of results.filter((r) => !r.claimed)) expect(loser.existing.id).toBe(winner.id);
    });

    it('finishes a claimed row with the outcome, read-back and inverse', async () => {
      const db = await make();
      const { id } = await db.claimChange({ ...base, requestKey: 'rmcp_c_1_1', before: { state: 'open' } });
      expect(await db.finishChange(id, { summary: 'Did a thing', after: { state: 'closed' }, confirmed: true, githubRequestId: 'ABCD:1234', inverse: { tool: 'github_sample_undo', args: { n: 1 } } })).toBe(true);
      expect(await db.getChange(id)).toMatchObject({ summary: 'Did a thing', confirmed: true, after: { state: 'closed' }, before: { state: 'open' }, githubRequestId: 'ABCD:1234', inverse: { tool: 'github_sample_undo', args: { n: 1 } } });
      expect(await db.finishChange(id + 999, { summary: 'x', confirmed: true })).toBe(false);
      const again = await db.claimChange({ ...base, requestKey: 'rmcp_c_1_1' });
      expect(again).toMatchObject({ claimed: false, existing: { confirmed: true, after: { state: 'closed' } } });
    });

    it('frees a request key after a definitive rejection so a corrected retry can claim it again', async () => {
      const db = await make();
      const { id } = await db.claimChange({ ...base, requestKey: 'rmcp_d_1_1' });
      await db.finishChange(id, { summary: 'REJECTED: nope', confirmed: false, releaseKey: true });
      expect(await db.getChange(id)).toMatchObject({ confirmed: false, requestKey: null });
      const retry = await db.claimChange({ ...base, requestKey: 'rmcp_d_1_1' });
      expect(retry.claimed).toBe(true);
      expect(retry.id).not.toBe(id);
    });
  });
}

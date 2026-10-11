// Contract for the change log (B-1): previews, claiming a request key, finishing a row, replay look-up and the 64 KB cap.
// Run against the in-memory fake and against real PostgreSQL so the two cannot drift.
import { describe, expect, it } from 'vitest';
import { CHANGE_JSON_LIMIT_BYTES } from '../../src/db.js';

const ROW = (over = {}) => ({
  account: 'example-org', repo: 'hello', mode: 'preview', connection: 'client-1', tool: 'github_label_create', target: 'example-org/hello',
  summary: 'Create label "bug" in example-org/hello.', before: { exists: false }, production: false, accessWidening: false, notifies: [], spendCents: null,
  requestKey: 'rmcp_github_label_create_abc_1', ...over
});

export function runChangeLogContract(name, make) {
  describe(`change log: ${name}`, () => {
    it('stores any number of previews and never lets one stand in for a real write', async () => {
      const db = await make();
      const a = await db.addChangePreview(ROW());
      const b = await db.addChangePreview(ROW());
      expect(b).not.toBe(a);
      expect(await db.getChangeByRequestKey('rmcp_github_label_create_abc_1')).toBeNull();
      const claim = await db.claimChange(ROW());
      expect(claim.claimed).toBe(true);
    });

    it('lets exactly one caller claim a request key; the other sees the first row', async () => {
      const db = await make();
      const results = await Promise.all([db.claimChange(ROW()), db.claimChange(ROW()), db.claimChange(ROW())]);
      expect(results.filter((r) => r.claimed)).toHaveLength(1);
      const losers = results.filter((r) => !r.claimed);
      expect(losers).toHaveLength(2);
      for (const loser of losers) {
        expect(loser.existing.tool).toBe('github_label_create');
        expect(loser.existing.confirmed).toBeNull();
      }
    });

    it('finishes a claimed row with the read-back, then replays it by key', async () => {
      const db = await make();
      const { id } = await db.claimChange(ROW({ production: true, notifies: ['sam-dev'], spendCents: 1900 }));
      expect(await db.finishChange(id, { after: { name: 'bug' }, confirmed: true, githubRequestId: 'REQ-1', inverse: { tool: 'github_label_delete', args: { name: 'bug' } } })).toBe(true);
      const row = await db.getChangeByRequestKey('rmcp_github_label_create_abc_1');
      expect(row).toMatchObject({ id, confirmed: true, after: { name: 'bug' }, github_request_id: 'REQ-1', production: true, spend_cents: 1900, inverse: { tool: 'github_label_delete' } });
      expect(row.notifies).toEqual(['sam-dev']);
      const again = await db.claimChange(ROW());
      expect(again).toMatchObject({ claimed: false, existing: { id, confirmed: true } });
      expect(await db.finishChange(999999, { confirmed: true })).toBe(false);
    });

    it('keeps different keys apart and refuses a real write without a key or a summary', async () => {
      const db = await make();
      expect((await db.claimChange(ROW({ requestKey: 'k1' }))).claimed).toBe(true);
      expect((await db.claimChange(ROW({ requestKey: 'k2' }))).claimed).toBe(true);
      await expect(db.claimChange(ROW({ requestKey: null }))).rejects.toThrow(TypeError);
      await expect(db.claimChange(ROW({ summary: '' }))).rejects.toThrow(TypeError);
      await expect(db.addChangePreview(ROW({ tool: undefined }))).rejects.toThrow(TypeError);
    });

    it('replaces a value over 64 KB with a marker', async () => {
      const db = await make();
      const big = { text: 'x'.repeat(CHANGE_JSON_LIMIT_BYTES + 10) };
      const { id } = await db.claimChange(ROW({ before: big }));
      await db.finishChange(id, { after: big, confirmed: false });
      const row = await db.getChangeByRequestKey('rmcp_github_label_create_abc_1');
      expect(row.before).toMatchObject({ truncated: true });
      expect(row.after).toMatchObject({ truncated: true });
      expect(JSON.stringify(row).length).toBeLessThan(2000);
    });
  });
}

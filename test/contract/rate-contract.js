// Contract for the GitHub rate discipline store (A-4): write slots, rate state and the ETag cache. Run against the
// in-memory fake (with a controllable clock) and against real PostgreSQL so the two cannot drift.
// `make()` returns a fresh database; `advance(ms)` moves time forward for the fake (real Postgres uses real sleeps and
// is only asked for sub-second differences).
import { describe, expect, it } from 'vitest';
import { ETAG_BODY_LIMIT_BYTES } from '../../src/db.js';

export function runRateContract(name, make) {
  describe(`GitHub rate store: ${name}`, () => {
    it('hands out write slots at least one spacing apart, per installation', async () => {
      const db = await make({fixedClock:true});
      const first = await db.claimWriteSlot('inst-1', { spacingMs: 1000, maxWaitMs: 5000 });
      const second = await db.claimWriteSlot('inst-1', { spacingMs: 1000, maxWaitMs: 5000 });
      const third = await db.claimWriteSlot('inst-1', { spacingMs: 1000, maxWaitMs: 5000 });
      const other = await db.claimWriteSlot('inst-2', { spacingMs: 1000, maxWaitMs: 5000 });
      expect(first.waitMs).toBeLessThan(100);
      expect(second.waitMs - first.waitMs).toBeGreaterThanOrEqual(900);
      expect(third.waitMs - second.waitMs).toBeGreaterThanOrEqual(900);
      expect(other.waitMs).toBeLessThan(100);
    });

    it('two simultaneous claims never get the same second', async () => {
      const db = await make({fixedClock:true});
      const results = await Promise.all(Array.from({ length: 4 }, () => db.claimWriteSlot('inst-race', { spacingMs: 1000, maxWaitMs: 10000 })));
      const waits = results.map((r) => r.waitMs).sort((a, b) => a - b);
      for (let i = 1; i < waits.length; i++) expect(waits[i] - waits[i - 1]).toBeGreaterThanOrEqual(900);
    });

    it('refuses to queue beyond the maximum wait and reserves nothing when it refuses', async () => {
      const db = await make({fixedClock:true});
      await db.claimWriteSlot('inst-3', { spacingMs: 3000, maxWaitMs: 5000 }); // ends in 3 s
      await db.claimWriteSlot('inst-3', { spacingMs: 3000, maxWaitMs: 5000 }); // starts in 3 s, ends in 6 s
      expect(await db.claimWriteSlot('inst-3', { spacingMs: 3000, maxWaitMs: 5000 })).toBeNull(); // would start in 6 s
      const again = await db.claimWriteSlot('inst-3', { spacingMs: 3000, maxWaitMs: 7000 });
      expect(again.waitMs).toBeGreaterThanOrEqual(5900); // the refused claim did not move the queue
      expect(again.waitMs).toBeLessThan(6500);
      await expect(db.claimWriteSlot('', {})).rejects.toThrow(TypeError);
    });

    it('records rate state and reports a block only while it is in the future', async () => {
      const db = await make();
      expect(await db.getRateState('example-org', 'core')).toBeNull();
      const resetAt = new Date(Date.now() + 3600_000);
      await db.recordRateState({ account: 'example-org', resource: 'core', remaining: 4000, resetAt, blockedUntil: null });
      expect(await db.getRateState('example-org', 'core')).toMatchObject({ remaining: 4000, blocked_until: null });
      await db.recordRateState({ account: 'example-org', resource: 'core', remaining: 0, resetAt, blockedUntil: new Date(Date.now() + 60_000) });
      const blocked = await db.getRateState('example-org', 'core');
      expect(blocked.remaining).toBe(0);
      expect(new Date(blocked.blocked_until).getTime()).toBeGreaterThan(Date.now());
      await db.recordRateState({ account: 'example-org', resource: 'core', remaining: 0, resetAt, blockedUntil: new Date(Date.now() - 1000) });
      expect((await db.getRateState('example-org', 'core')).blocked_until).toBeNull();
      expect(await db.getRateState('example-org', 'graphql')).toBeNull();
      expect(await db.getRateState('other-org', 'core')).toBeNull();
    });

    it('caches an ETag with its body per account and url, replacing it on update, and skips large bodies', async () => {
      const db = await make();
      expect(await db.getEtag('example-org', '/repos/x/y/pulls/1')).toBeNull();
      expect(await db.putEtag('example-org', '/repos/x/y/pulls/1', 'W/"a"', { n: 1 })).toBe(true);
      expect(await db.getEtag('example-org', '/repos/x/y/pulls/1')).toEqual({ etag: 'W/"a"', body: { n: 1 } });
      expect(await db.getEtag('other-org', '/repos/x/y/pulls/1')).toBeNull();
      await db.putEtag('example-org', '/repos/x/y/pulls/1', 'W/"b"', { n: 2 });
      expect(await db.getEtag('example-org', '/repos/x/y/pulls/1')).toEqual({ etag: 'W/"b"', body: { n: 2 } });
      const big = { text: 'x'.repeat(ETAG_BODY_LIMIT_BYTES) };
      expect(await db.putEtag('example-org', '/repos/x/y/pulls/1', 'W/"c"', big)).toBe(false);
      expect(await db.getEtag('example-org', '/repos/x/y/pulls/1')).toBeNull(); // the stale entry is dropped, not served
    });
  });
}

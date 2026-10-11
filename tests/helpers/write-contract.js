// The write-contract helper (BATCH-B §3): the nine checks every write tool passes. `build()` returns a fresh world:
//   { handler, ctx, db, writes(): number of write requests so far, other?: mismatch switch }
// Checks 1-5 always run. Checks 6-9 run when the matching option is given. The stub guards below stand in until B-2..B-4
// supply the real production, protected-resource and spend guards; the core's own behavior (confirm for access, people and
// money) is what checks 8 and 9 exercise.
import { describe, expect, it } from 'vitest';
import { requestKey } from '../../src/github/client.js';

export const stubProductionGuard = ({ classification, ctx }) =>
  (classification.production && ctx.connection.mode !== 'production'
    ? { refuse: { code: 'production_on_preview', message: 'This touches production and this connection is a preview connection.' } }
    : undefined);
export const stubProtectedGuard = (level) => () => ({ refuse: { code: `protected_${level}`, message: `This resource is protected (${level}).` } });
export const stubSpendGuard = ({ classification }) =>
  (classification.spendCents > 0 ? { refuse: { code: 'spend_limit', message: 'The monthly spend limit is $0.00.' } } : undefined);

/**
 * @param {string} name
 * @param {{ build: (options?: object) => Promise<object>|object, args: object, production?: boolean, accessWidening?: boolean,
 *   notifiesOutsider?: boolean, spendCents?: number, protectedLevel?: 'pr-only'|'locked' }} options
 */
export function runWriteContract(name, { build, args, production = false, accessWidening = false, notifiesOutsider = false, spendCents = 0, protectedLevel }) {
  const mustConfirm = production || accessWidening || notifiesOutsider || spendCents > 0;
  describe(`write contract: ${name}`, () => {
    it('1. dryRun changes nothing and leaves a preview row', async () => {
      const w = await build();
      const res = await w.handler({ ...args, dryRun: true }, w.ctx);
      expect(res.status).toBe('preview');
      expect(w.writes()).toBe(0);
      expect(res.preview).toMatch(/\S/);
      expect(res.needs_confirm).toBe(mustConfirm);
      expect(await w.db.getChangeByRequestKey(requestKey(w.ctx, w.toolName, args))).toBeNull(); // a preview is not a real write
    });

    it('2. without confirm, a write that needs it changes nothing and says to ask first', async () => {
      const w = await build();
      const res = await w.handler({ ...args }, w.ctx);
      if (mustConfirm) {
        expect(res.status).toBe('confirmation_required');
        expect(w.writes()).toBe(0);
        expect(res.message).toMatch(/ask/i);
      } else {
        expect(res.status).toBe('applied');
      }
    });

    it('3. with confirm: exactly one write, a read-back, and a log row carrying the request key', async () => {
      const w = await build();
      const res = await w.handler({ ...args, confirm: true }, w.ctx);
      expect(res.status).toBe('applied');
      expect(res.confirmed).toBe(true);
      expect(res.after).not.toBeNull();
      expect(w.writes()).toBe(1);
      const row = await w.db.getChangeByRequestKey(requestKey(w.ctx, w.toolName, args));
      expect(row).toMatchObject({ tool: w.toolName, confirmed: true });
      expect(row.request_key).toMatch(/^rmcp_/);
    });

    it('4. the same call again does not write a second time and says replayed', async () => {
      const w = await build();
      await w.handler({ ...args, confirm: true }, w.ctx);
      const again = await w.handler({ ...args, confirm: true }, w.ctx);
      expect(again).toMatchObject({ status: 'replayed', replayed: true, confirmed: true });
      expect(w.writes()).toBe(1);
    });

    it('5. a read-back that does not match gives confirmed false and a warning', async () => {
      const w = await build({ mismatch: true });
      const res = await w.handler({ ...args, confirm: true }, w.ctx);
      expect(res.status).toBe('applied');
      expect(res.confirmed).toBe(false);
      expect(res.warning).toMatch(/check/i);
    });

    if (production) {
      it('6. production on a preview connection is refused before anything is written; on a production connection it needs confirm', async () => {
        const w = await build({ guards: [stubProductionGuard] });
        const refused = await w.handler({ ...args, confirm: true }, w.ctx);
        expect(refused).toMatchObject({ status: 'refused_by_guard', code: 'production_on_preview' });
        expect(w.writes()).toBe(0);
        const p = await build({ guards: [stubProductionGuard], mode: 'production' });
        const ask = await p.handler({ ...args }, p.ctx);
        expect(ask).toMatchObject({ status: 'confirmation_required', mode: 'PRODUCTION' });
        const done = await p.handler({ ...args, confirm: true }, p.ctx);
        expect(done).toMatchObject({ status: 'applied', mode: 'PRODUCTION' });
        expect((await p.db.getChangeByRequestKey(requestKey(p.ctx, p.toolName, args))).production).toBe(true);
      });
    }

    if (protectedLevel) {
      it(`7. a ${protectedLevel} resource is refused naming the level, even with confirm`, async () => {
        const w = await build({ guards: [stubProtectedGuard(protectedLevel)] });
        const res = await w.handler({ ...args, confirm: true }, w.ctx);
        expect(res).toMatchObject({ status: 'refused_by_guard', code: `protected_${protectedLevel}` });
        expect(res.message).toContain(protectedLevel);
        expect(w.writes()).toBe(0);
      });
    }

    if (accessWidening || notifiesOutsider) {
      it('8. access-widening or outsider-notifying changes need confirm, and the preview says so', async () => {
        const w = await build();
        const res = await w.handler({ ...args }, w.ctx);
        expect(res.status).toBe('confirmation_required');
        expect(res.preview).toMatch(accessWidening ? /ACCESS CHANGE/ : /NOTIFIES/);
        expect(w.writes()).toBe(0);
      });
    }

    if (spendCents > 0) {
      it('9. a cost shows a dollar line, always needs confirm, and a spend guard at $0 refuses it', async () => {
        const w = await build();
        const res = await w.handler({ ...args }, w.ctx);
        expect(res.status).toBe('confirmation_required');
        expect(res.preview).toContain(`COSTS $${(spendCents / 100).toFixed(2)}`);
        const g = await build({ guards: [stubSpendGuard] });
        const refused = await g.handler({ ...args, confirm: true }, g.ctx);
        expect(g.writes()).toBe(0);
        expect(refused.status).toBe('refused_by_guard');
      });
    }
  });
}

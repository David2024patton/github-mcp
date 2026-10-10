import { expect, it } from 'vitest';
// TEMPORARY (A-1 acceptance): proves a failing unit test turns `unit` and the aggregate `ci` red. Removed next push.
it('deliberately fails to prove CI goes red', () => { expect(1 + 1).toBe(3); });

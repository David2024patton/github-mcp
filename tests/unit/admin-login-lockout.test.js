import { describe, expect, it } from 'vitest';
import { evaluateLogin, MAX_FAILED_LOGINS, MAX_GLOBAL_FAILED_LOGINS, LOCKOUT_WINDOW_MINUTES } from '../../src/core/oauth.js';

// In-memory stand-in for the login_attempts table in src/db.js: same helper names evaluateLogin
// calls, plus a settable clock so tests can move time through the lockout window.
function createLoginStore(clock = () => 0) {
  const rows = [];
  let nextId = 0;
  return {
    rows,
    async recordLoginAttempt(ip) { rows.push({ id: ++nextId, ip, at: clock(), success: false }); return nextId; },
    async markLoginAttemptSucceeded(id) { const row = rows.find((r) => r.id === id); if (row) row.success = true; },
    async countRecentFailedLogins(ip, minutes = 15) {
      const cutoff = clock() - minutes * 60000;
      return rows.filter((r) => r.ip === ip && !r.success && r.at > cutoff).length;
    },
    async countRecentFailedLoginsAll(minutes = 15) {
      const cutoff = clock() - minutes * 60000;
      return rows.filter((r) => !r.success && r.at > cutoff).length;
    },
    async purgeExpiredLoginAttempts(minutes = 15) {
      const cutoff = clock() - minutes * 60000;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].at < cutoff) rows.splice(i, 1);
    },
  };
}

describe('admin login lockout', () => {
  it('still locks a single address after five wrong attempts and lets other addresses through', async () => {
    let time = 1_000_000;
    const store = createLoginStore(() => time);
    for (let n = 0; n < MAX_FAILED_LOGINS; n++) {
      expect(await evaluateLogin({ ip: '192.0.2.1', supplied: 'wrong', expected: 'correct', store }))
        .toMatchObject({ status: 'wrong', attemptsLeft: MAX_FAILED_LOGINS - (n + 1) });
    }
    // The sixth attempt is refused even with the right passphrase, and the verdict is the same shape
    // as any other lockout so callers cannot tell which limit fired.
    expect(await evaluateLogin({ ip: '192.0.2.1', supplied: 'correct', expected: 'correct', store })).toEqual({ status: 'locked' });
    expect(await evaluateLogin({ ip: '192.0.2.2', supplied: 'correct', expected: 'correct', store })).toEqual({ status: 'ok' });
  });

  it('locks every address once the global budget is spent, then reopens when the window passes', async () => {
    let time = 1_000_000;
    const store = createLoginStore(() => time);
    // Spread wrong guesses across many addresses so no single per-IP cap can be what trips: only the
    // global budget can.
    for (let n = 0; n < MAX_GLOBAL_FAILED_LOGINS; n++) {
      expect((await evaluateLogin({ ip: `198.51.100.${n}`, supplied: 'wrong', expected: 'correct', store })).status).toBe('wrong');
    }
    // A fresh address with the correct passphrase is still refused: the shared passphrase is under a
    // whole-table budget now, not just per-address caps.
    expect(await evaluateLogin({ ip: '203.0.113.9', supplied: 'correct', expected: 'correct', store })).toEqual({ status: 'locked' });
    // After the window passes the budget resets and the same address and passphrase succeed.
    time += (LOCKOUT_WINDOW_MINUTES + 1) * 60000;
    expect(await evaluateLogin({ ip: '203.0.113.9', supplied: 'correct', expected: 'correct', store })).toEqual({ status: 'ok' });
  });

  it('purges attempts older than the window on each evaluation while keeping the recent ones', async () => {
    let time = 1_000_000;
    const store = createLoginStore(() => time);
    await evaluateLogin({ ip: '192.0.2.1', supplied: 'wrong', expected: 'correct', store });
    time += 10 * 60000;
    await evaluateLogin({ ip: '192.0.2.2', supplied: 'wrong', expected: 'correct', store });
    time += 10 * 60000; // 20 minutes after the first attempt, inside the window for the second.
    await evaluateLogin({ ip: '192.0.2.3', supplied: 'correct', expected: 'correct', store });
    expect(store.rows).toHaveLength(2);
    expect(store.rows.map((r) => r.ip)).toEqual(['192.0.2.2', '192.0.2.3']);
  });

  it('does not let successful logins poison either counter', async () => {
    let time = 1_000_000;
    const store = createLoginStore(() => time);
    await evaluateLogin({ ip: '192.0.2.1', supplied: 'wrong', expected: 'correct', store });
    expect(await evaluateLogin({ ip: '192.0.2.2', supplied: 'correct', expected: 'correct', store })).toEqual({ status: 'ok' });
    // Existing behavior: the successful attempt's own row never counts as a failure, so honest
    // sign-ins cannot eat the per-IP or the global budget (earlier failures still age out with the
    // window rather than being cleared).
    expect(await store.countRecentFailedLogins('192.0.2.2', LOCKOUT_WINDOW_MINUTES)).toBe(0);
    expect(await store.countRecentFailedLoginsAll(LOCKOUT_WINDOW_MINUTES)).toBe(1);
    // Repeated honest sign-ins stay working and keep the global tally flat.
    expect(await evaluateLogin({ ip: '192.0.2.3', supplied: 'correct', expected: 'correct', store })).toEqual({ status: 'ok' });
    expect(await store.countRecentFailedLoginsAll(LOCKOUT_WINDOW_MINUTES)).toBe(1);
    // And the one earlier failure expires with the window.
    time += (LOCKOUT_WINDOW_MINUTES + 1) * 60000;
    expect(await store.countRecentFailedLoginsAll(LOCKOUT_WINDOW_MINUTES)).toBe(0);
  });

  it('keeps the per-IP contract for stores that predate the purge and global helpers', async () => {
    // A minimal store with only the three original helpers must keep working: the new checks are
    // optional so nothing that passes today starts failing.
    const attempts = [];
    let nextId = 0;
    const legacyStore = {
      async recordLoginAttempt(ip) { attempts.push({ id: ++nextId, ip, success: false }); return nextId; },
      async markLoginAttemptSucceeded(id) { const row = attempts.find((r) => r.id === id); if (row) row.success = true; },
      async countRecentFailedLogins(ip) { return attempts.filter((r) => r.ip === ip && !r.success).length; },
    };
    for (let n = 0; n < MAX_FAILED_LOGINS; n++) {
      expect((await evaluateLogin({ ip: '192.0.2.1', supplied: 'wrong', expected: 'correct', store: legacyStore })).status).toBe('wrong');
    }
    expect(await evaluateLogin({ ip: '192.0.2.1', supplied: 'correct', expected: 'correct', store: legacyStore })).toEqual({ status: 'locked' });
    expect(await evaluateLogin({ ip: '192.0.2.2', supplied: 'correct', expected: 'correct', store: legacyStore })).toEqual({ status: 'ok' });
  });
});

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { randomToken, hashToken, secretsMatch, verifyPkce, validRedirectUri, clientIp, evaluateLogin, MAX_FAILED_LOGINS } from '../../src/core/oauth.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

describe('portable OAuth security', () => {
  it('generates unpredictable-looking tokens and returns stable hashes, never plaintext', () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
    expect(() => hashToken('')).toThrow(TypeError);
    expect(secretsMatch(a, a)).toBe(true);
    expect(secretsMatch(a, b)).toBe(false);
    expect(secretsMatch('', '')).toBe(false);
    expect(secretsMatch(undefined, 'x')).toBe(false);
  });

  it('requires S256 PKCE with a properly sized verifier, rejects plain or absent PKCE', () => {
    const verifier = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
    expect(verifyPkce(verifier, challenge, 'plain')).toBe(false);
    expect(verifyPkce('wrong-' + verifier, challenge)).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
    expect(verifyPkce(verifier, undefined)).toBe(false);
    expect(verifyPkce('short', challenge)).toBe(false);
  });

  it('accepts HTTPS and localhost redirects, rejects insecure external and open redirect forms', () => {
    expect(validRedirectUri('https://example.test/connector/callback')).toBe(true);
    expect(validRedirectUri('http://localhost:3456/callback')).toBe(true);
    expect(validRedirectUri('http://127.0.0.1:2345/callback')).toBe(true);
    for (const value of ['http://example.test/cb', 'javascript:alert(1)', 'https://user:pass@example.test/cb', 'https://example.test/cb#fragment', 'not a url']) {
      expect(validRedirectUri(value)).toBe(false);
    }
  });

  it('does not trust caller-controlled forwarded-for or accept a missing address as a bypass', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.1' } })).toBe('unknown');
    expect(clientIp({ headers: { 'x-real-ip': '198.51.100.2' } })).toBe('198.51.100.2');
    expect(clientIp({ headers: { 'x-vercel-forwarded-for': '198.51.100.3' } })).toBe('198.51.100.3');
    expect(clientIp({ socket: { remoteAddress: '::ffff:198.51.100.4' } })).toBe('198.51.100.4');
    expect(clientIp({})).toBe('unknown');
    expect(clientIp({ headers: { 'x-real-ip': '2001:db8:1:2:3:4:5:6' } })).toBe('2001:db8:1:2::/64');
  });

  it('locks an address after five wrong attempts for fifteen minutes', async () => {
    let time = 1_000_000;
    const db = createFakeDb({ clock: () => time });
    for (let n = 0; n < MAX_FAILED_LOGINS; n++) {
      const result = await evaluateLogin({ ip: '192.0.2.1', supplied: 'wrong', expected: 'correct', store: db });
      expect(result).toMatchObject({ status: 'wrong', attemptsLeft: MAX_FAILED_LOGINS - (n + 1) });
    }
    expect((await evaluateLogin({ ip: '192.0.2.1', supplied: 'correct', expected: 'correct', store: db })).status).toBe('locked');
    expect((await evaluateLogin({ ip: '192.0.2.2', supplied: 'correct', expected: 'correct', store: db })).status).toBe('ok');
    time += 16 * 60_000;
    expect((await evaluateLogin({ ip: '192.0.2.1', supplied: 'correct', expected: 'correct', store: db })).status).toBe('ok');
  });

  it('treats an empty or missing submitted passphrase as wrong, not as a crash', async () => {
    const db = createFakeDb();
    for (const supplied of ['', undefined, null, 42]) {
      expect(await evaluateLogin({ ip: '192.0.2.9', supplied, expected: 'correct', store: db })).toMatchObject({ status: 'wrong' });
    }
  });

  it('refuses a missing passphrase configuration instead of letting anyone in', async () => {
    const db = createFakeDb();
    await expect(evaluateLogin({ ip: 'unknown', supplied: '', expected: '', store: db })).rejects.toThrow(/not configured/);
    await expect(evaluateLogin({ ip: 'unknown', supplied: '', expected: undefined, store: db })).rejects.toThrow(/not configured/);
  });
});

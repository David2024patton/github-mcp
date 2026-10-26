import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { call, json, request } from '../../test/helpers/http-harness.js';
import { handleOAuth } from '../../src/oauth/routes.js';
import { createIpRateLimiter } from '../../src/core/ip-rate-limit.js';

const baseEnv = { PUBLIC_BASE_URL: 'https://github-mcp.example.test', ADMIN_PASSPHRASE: 'only-the-owner-knows' };

// The limiter instances in routes.js are module-level, exactly as in one deployed instance,
// so every test gets its own client IP (clientIp trusts x-real-ip, which platforms set).
let ipNumber = 0;
const testIp = () => `198.18.0.${(ipNumber++ % 254) + 1}`;

const post = (which, body, ip, env = baseEnv, db = createFakeDb()) =>
  call((req, res) => handleOAuth(which, req, res, { db, env }), request('POST', body, { 'content-type': 'application/json', 'x-real-ip': ip }));
const postRaw = (which, rawBody, ip, headers = {}, env = baseEnv, db = createFakeDb()) =>
  call((req, res) => handleOAuth(which, req, res, { db, env }), request('POST', rawBody, { 'content-type': 'application/json', 'x-real-ip': ip, ...headers }));

afterEach(() => vi.useRealTimers());

describe('ip-rate-limit window behaviour', () => {
  it('allows up to the limit per window, refuses with a shrinking retry, and resets when the window passes', () => {
    let now = 1_000_000;
    const limiter = createIpRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
    expect(limiter.check('ip-a')).toEqual({ allowed: true, retryAfterSeconds: 60 });
    now += 1_500;
    expect(limiter.check('ip-a')).toEqual({ allowed: true, retryAfterSeconds: 59 });
    now += 1_000;
    expect(limiter.check('ip-a')).toEqual({ allowed: false, retryAfterSeconds: 58 });
    // A different key has its own window.
    expect(limiter.check('ip-b').allowed).toBe(true);
    // At the reset the same key is welcome again.
    now = 1_060_000;
    expect(limiter.check('ip-a')).toEqual({ allowed: true, retryAfterSeconds: 60 });
  });

  it('refuses nonsensical configuration', () => {
    expect(() => createIpRateLimiter({ limit: 0, windowMs: 60_000 })).toThrow(TypeError);
    expect(() => createIpRateLimiter({ limit: 2.5, windowMs: 60_000 })).toThrow(TypeError);
    expect(() => createIpRateLimiter({ limit: 2, windowMs: 0 })).toThrow(TypeError);
  });
});

describe('per-IP rate limiting on the unauthenticated endpoints', () => {
  it('answers 429 with Retry-After once an IP exceeds the 30/min registration budget', async () => {
    const ip = testIp();
    for (let n = 0; n < 30; n += 1) {
      // Bodies without redirect_uris are refused with 400, but still count: the limiter runs first.
      expect((await post('register', {}, ip)).statusCode).toBe(400);
    }
    const limited = await post('register', {}, ip);
    expect(limited.statusCode).toBe(429);
    expect(json(limited).error).toBe('slow_down');
    expect(limited.headers['Retry-After']).toMatch(/^[0-9]+$/);
    expect(Number(limited.headers['Retry-After'])).toBeGreaterThan(0);
    expect(Number(limited.headers['Retry-After'])).toBeLessThanOrEqual(60);
  });

  it('answers 429 with Retry-After once an IP exceeds the 60/min token budget', async () => {
    const ip = testIp();
    for (let n = 0; n < 60; n += 1) {
      // Empty token requests are refused with 400 before any client lookup, but still count.
      expect((await post('token', {}, ip)).statusCode).toBe(400);
    }
    const limited = await post('token', {}, ip);
    expect(limited.statusCode).toBe(429);
    expect(json(limited).error).toBe('slow_down');
    expect(Number(limited.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('lets a throttled IP back in once the window resets, and not a moment before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const ip = testIp();
    for (let n = 0; n < 30; n += 1) await post('register', {}, ip);
    expect((await post('register', {}, ip)).statusCode).toBe(429);
    vi.setSystemTime(new Date('2026-01-01T00:00:59Z'));
    expect((await post('register', {}, ip)).statusCode).toBe(429);
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    expect((await post('register', {}, ip)).statusCode).toBe(400);
  });

  it('throttles each IP independently', async () => {
    const loud = testIp();
    for (let n = 0; n < 30; n += 1) await post('register', {}, loud);
    expect((await post('register', {}, loud)).statusCode).toBe(429);
    expect((await post('register', {}, testIp())).statusCode).toBe(400);
  });
});

describe('malformed JSON on the unauthenticated endpoints', () => {
  it('answers 400 invalid_request (not 503) on /api/oauth/register with the owner flow', async () => {
    const res = await postRaw('register', '{oops, not json', testIp());
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toBe('invalid_request');
  });

  it('answers 400 invalid_request on /api/oauth/register with public connect on (previously 503)', async () => {
    const res = await postRaw('register', '{oops, not json', testIp(), {}, { ...baseEnv, GITHUB_PUBLIC_CONNECT: 'enabled' });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toBe('invalid_request');
  });

  it('answers 400 invalid_request on /api/oauth/token with malformed JSON', async () => {
    const res = await postRaw('token', '"a string, not an object"', testIp());
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toBe('invalid_request');
  });
});

describe('oversized registration bodies', () => {
  it('rejects a raw body larger than 64 KB with 413 before parsing', async () => {
    const raw = JSON.stringify({ redirect_uris: ['https://client.example.test/cb'], padding: 'x'.repeat(70 * 1024) });
    const res = await postRaw('register', raw, testIp());
    expect(res.statusCode).toBe(413);
    expect(json(res).error).toBe('too_large');
  });

  it('rejects a declared content-length over 64 KB even when the platform pre-parsed the body', async () => {
    const res = await postRaw('register', { redirect_uris: ['https://client.example.test/cb'] }, testIp(), { 'content-length': String(999 * 1024) });
    expect(res.statusCode).toBe(413);
    expect(json(res).error).toBe('too_large');
  });

  it('accepts exactly 64 KB past the size guard (the limit is over, not at)', async () => {
    const raw = JSON.stringify({ padding: 'x'.repeat(65_522) });
    expect(Buffer.byteLength(raw)).toBe(64 * 1024);
    // The shared paramsOf() parser keeps its own 16 KB cap, so this is a 400, never a 413.
    const res = await postRaw('register', raw, testIp());
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toBe('invalid_request');
  });
});

describe('real outages are not swallowed by the new guards', () => {
  it('a database failure during registration still answers the existing 503 without details', async () => {
    const db = { createOAuthClient: async () => { throw new Error('relation "oauth_clients" does not exist'); } };
    const res = await post('register', { redirect_uris: ['https://client.example.test/cb'] }, testIp(), baseEnv, db);
    expect(res.statusCode).toBe(503);
    expect(json(res).error).toBe('temporarily_unavailable');
    expect(res.body).not.toContain('oauth_clients');
  });

  it('a database failure during the token exchange still answers the existing 503', async () => {
    const db = { getOAuthClient: async () => { throw new Error('connection pool exhausted'); } };
    const res = await post('token', { grant_type: 'refresh_token', resource: baseEnv.PUBLIC_BASE_URL + '/api/mcp', refresh_token: 'r'.repeat(40) }, testIp(), baseEnv, db);
    expect(res.statusCode).toBe(503);
    expect(json(res).error).toBe('temporarily_unavailable');
    expect(res.body).not.toContain('connection pool');
  });
});

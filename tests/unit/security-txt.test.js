// RFC 9116: /.well-known/security.txt must be plain text with Contact and Expires, reachable
// without auth; vercel.json rewrites that path to this route.
import { describe, expect, it } from 'vitest';
import handler, { securityTxt } from '../../api/security-txt.js';
import { call, request } from '../../test/helpers/http-harness.js';

describe('security.txt', () => {
  it('publishes the contact the /security page publishes, the canonical URL and the policy page', async () => {
    const result = await call(handler, request('GET', {}));
    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toContain('text/plain');
    expect(result.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(result.body).toContain('Contact: mailto:hello@robinsonaisystems.com');
    expect(result.body).toContain('Canonical: https://github.robinsonaisystems.com/.well-known/security.txt');
    expect(result.body).toContain('Policy: https://github.robinsonaisystems.com/security');
    expect(result.body).toContain('Preferred-Languages: en');
  });

  it('expires about a year out, computed per response so the file never serves a stale date', async () => {
    const before = Date.now();
    const result = await call(handler, request('GET', {}));
    const expires = Date.parse(/^Expires: (.+)$/m.exec(result.body)?.[1] ?? '');
    expect(Number.isFinite(expires)).toBe(true);
    expect(expires).toBeGreaterThanOrEqual(before + 364 * 24 * 60 * 60 * 1000);
    expect(expires).toBeLessThanOrEqual(before + 367 * 24 * 60 * 60 * 1000);
    expect(Math.abs(Date.parse(securityTxt(before).match(/^Expires: (.+)$/m)[1]) - expires)).toBeLessThan(2000);
  });

  it('is served as UTF-8 line-separated fields with no scripts and no cookies', async () => {
    const result = await call(handler, request('GET', {}));
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(result.headers['Set-Cookie']).toBeUndefined();
    expect(result.body).not.toMatch(/[<>{}]/);
    expect(result.body.endsWith('\n')).toBe(true);
    expect(result.body.split('\n').filter((line) => line && !line.startsWith('#')))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/^Contact: https?:\/\/|^Contact: mailto:/),
        expect.stringMatching(/^Expires: \d{4}-\d{2}-\d{2}T/),
        expect.stringMatching(/^Canonical: https:\/\//),
        expect.stringMatching(/^Policy: https:\/\//),
        expect.stringMatching(/^Preferred-Languages: [a-z]/)
      ]));
  });

  it('answers only GET, refusing other methods with 405 and an Allow header', async () => {
    const post = await call(handler, request('POST', {}));
    expect(post.statusCode).toBe(405);
    expect(post.headers['Allow']).toBe('GET');
  });
});

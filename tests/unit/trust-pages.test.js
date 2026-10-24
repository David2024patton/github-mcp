import { describe, expect, it } from 'vitest';
import { renderTrustBody, supportEmail, legalApproved, TRUST_PAGES } from '../../src/tenancy/trust-pages.js';
import { publicTrust } from '../../src/tenancy/public-http.js';
import { brandFooter } from '../../src/brand/brand.js';

const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; };
const on = { GITHUB_PUBLIC_CONNECT: 'enabled' };

describe('trust pages', () => {
  it('has the four pages and each carries the draft banner until LEGAL_APPROVED=yes', () => {
    expect([...TRUST_PAGES].sort()).toEqual(['privacy', 'security', 'support', 'terms']);
    for (const name of TRUST_PAGES) {
      const draft = renderTrustBody(name, {});
      expect(draft.html).toContain('DRAFT');
      const final = renderTrustBody(name, { LEGAL_APPROVED: 'yes' });
      expect(final.html).not.toContain('DRAFT');
      expect(final.html).not.toContain('Status:');
    }
    expect(legalApproved({ LEGAL_APPROVED: 'Yes' })).toBe(false);
  });
  it('shows "coming soon" until a valid support email is set, then a mailto link', () => {
    expect(renderTrustBody('support', {}).html).toContain('support email coming soon');
    expect(renderTrustBody('support', { PUBLIC_SUPPORT_EMAIL: 'not an email' }).html).toContain('coming soon');
    expect(supportEmail({ PUBLIC_SUPPORT_EMAIL: 'help@example.test' })).toBe('help@example.test');
    expect(renderTrustBody('security', { PUBLIC_SUPPORT_EMAIL: 'help@example.test' }).html).toContain('href="mailto:help@example.test"');
  });
  it('never turns draft text into markup', () => {
    const html = renderTrustBody('privacy', { PUBLIC_SUPPORT_EMAIL: 'a"><script>@example.test' }).html;
    expect(html).not.toContain('<script');
    expect(html).toContain('<h2>');
    expect(html).toContain('<li>');
  });
  it('answers GET only, only for the four names, and is off while the public sign-in is off', async () => {
    const ok = res(); await publicTrust({ method: 'GET', query: { page: 'terms' } }, ok, { env: on });
    expect(ok.code).toBe(200); expect(String(ok.body)).toContain('Terms of use');
    const bad = res(); await publicTrust({ method: 'GET', query: { page: 'nope' } }, bad, { env: on });
    expect(bad.code).toBe(404);
    const post = res(); await publicTrust({ method: 'POST', query: { page: 'terms' } }, post, { env: on });
    expect(post.code).toBe(405);
    const off = res(); await publicTrust({ method: 'GET', query: { page: 'terms' } }, off, { env: {} });
    expect(off.code).not.toBe(200);
  });
  it('links all four pages from the footer', () => {
    for (const path of ['/privacy', '/terms', '/security', '/support']) expect(brandFooter()).toContain(`href="${path}"`);
  });
});

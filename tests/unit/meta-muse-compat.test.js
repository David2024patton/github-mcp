import { describe, expect, it } from 'vitest';
import { renderHome, SERVER_ADDRESS, HOME_CSP } from '../../src/brand/home-page.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { MUSE_PUBLIC_CLIENT_ID, MUSE_REDIRECT_URI } from '../../src/tenancy/muse-client.js';

const origin = 'https://github.robinsonaisystems.com';
const dummyPolicy = { choices: async () => [], page: () => '', validate: () => ({}), tokenSettings: () => ({}) };
function response() {
  return { headers: {}, statusCode: 0, body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    send(value) { this.body = value; return this; } };
}

describe('Meta Muse Code standard MCP interoperability contract', () => {
  it('advertises a resource-bound OAuth authorization server with dynamic client registration and PKCE', () => {
    const h = createOAuthHandlers({ db: {}, env: { PUBLIC_BASE_URL: origin }, policy: dummyPolicy });
    const as = response();
    h.metadata({ method: 'GET' }, as);
    expect(as.statusCode).toBe(200);
    const metadata = JSON.parse(as.body);
    expect(metadata).toMatchObject({
      issuer: origin,
      registration_endpoint: origin + '/api/oauth/register',
      authorization_endpoint: origin + '/api/oauth/authorize',
      token_endpoint: origin + '/api/oauth/token',
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none']
    });
    const resource = response();
    h.resourceMetadata({ method: 'GET' }, resource);
    expect(resource.statusCode).toBe(200);
    expect(JSON.parse(resource.body)).toMatchObject({
      resource: SERVER_ADDRESS(origin), authorization_servers: [origin]
    });
  });

  it('uses a single public MCP URL, valid Muse Code config and no unsafe credential copying', () => {
    const html = renderHome(origin);
    const config = html.match(/<pre id="muse-code-config">([\s\S]*?)<\/pre>/)?.[1];
    expect(config).toBeTruthy();
    expect(JSON.parse(config).mcp_servers['github-robinson']).toEqual({
      transport: 'streamable_http', url: SERVER_ADDRESS(origin), enabled: true, mode: 'optional'
    });
    expect(html).toContain('muse mcp login github-robinson');
    expect(html).toContain('muse mcp logout github-robinson');
    expect(html).toContain('custom connector');
    expect(MUSE_PUBLIC_CLIENT_ID).toMatch(/^pcl_[A-Za-z0-9_-]{32,64}$/);
    expect(MUSE_REDIRECT_URI).toBe('https://agent.meta.ai/api/hatch/oauth/callback');
    expect(html).toContain(MUSE_PUBLIC_CLIENT_ID);
    expect(html).toContain('Client Secret: leave blank.');
    expect(html).toContain('their own GitHub account');
    expect(html).toContain('not a Meta-reviewed or Meta-listed connector');
    expect(html).not.toMatch(/<script|ghp_[A-Za-z0-9]|github_pat_[A-Za-z0-9]/i);
    expect(HOME_CSP).toContain("default-src 'none'");
  });
});

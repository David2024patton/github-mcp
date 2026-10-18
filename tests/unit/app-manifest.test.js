import { describe, expect, it } from 'vitest';
import { Y1_ADDED_PERMISSIONS, MANIFEST_PERMISSIONS, REPOSITORY_PERMISSIONS, ORGANIZATION_PERMISSIONS, appNameFor, buildManifest, installUrl, isValidLogin, manifestFormUrl } from '../../src/github/app-manifest.js';
import { openApi } from '../../test/helpers/github-descriptions.js';

// Names in GitHub's docs data (server-to-server-permissions.json @ github/docs be38ec5d, checked 2026-10-10) that the REST
// description's app-permissions schema does not list. Audited by hand; the test fails if this set and the manifest drift apart.
const DOCS_ONLY = ['actions_variables', 'codespaces_secrets', 'organization_actions_variables', 'organization_codespaces',
  'organization_codespaces_secrets', 'organization_codespaces_settings', 'organization_dependabot_secrets'];

describe('app manifest', () => {
  const schema = openApi().components.schemas['app-permissions'].properties;

  it('requests only permission names GitHub knows, with an access level GitHub offers', () => {
    for (const [name, level] of Object.entries(MANIFEST_PERMISSIONS)) {
      if (schema[name]) expect(schema[name].enum, name).toContain(level);
      expect(['read', 'write']).toContain(level);
    }
    expect(Object.keys(MANIFEST_PERMISSIONS).filter((name) => !schema[name]).sort()).toEqual(
      [...DOCS_ONLY,...(schema.organization_copilot_agent_settings?[]:['organization_copilot_agent_settings'])].sort());
    expect(Object.keys(MANIFEST_PERMISSIONS).length).toBe(Object.keys(REPOSITORY_PERMISSIONS).length + Object.keys(ORGANIZATION_PERMISSIONS).length);
  });

  it('asks for the minimum on the sensitive ones: metadata, attestations and organization reads are read-only, no account permissions', () => {
    expect(MANIFEST_PERMISSIONS).toMatchObject({ metadata: 'read', attestations: 'read', organization_administration: 'write', organization_copilot_agent_settings: 'write', organization_plan: 'read', organization_custom_org_roles: 'read' });
    for (const account of ['emails', 'email_addresses', 'followers', 'gists', 'keys', 'git_ssh_keys', 'gpg_keys', 'profile', 'starring', 'watching', 'blocking', 'plan']) {
      expect(MANIFEST_PERMISSIONS[account], account).toBeUndefined();
    }
  });

  it('requests the Y-1 additions at the stated levels and still no account permissions', () => {
    for (const [name, level] of Object.entries(Y1_ADDED_PERMISSIONS)) expect(MANIFEST_PERMISSIONS[name], name).toBe(level);
    expect(MANIFEST_PERMISSIONS.repository_advisories).toBeUndefined();
  });

  it('never asks GitHub.com for the unavailable organization_packages grant, even when the token schema lists it', () => {
    for (const permissions of [MANIFEST_PERMISSIONS, ORGANIZATION_PERMISSIONS, Y1_ADDED_PERMISSIONS,
      buildManifest({ origin: 'https://github-mcp.example.test', login: 'example-org' }).default_permissions]) {
      expect(permissions).not.toHaveProperty('organization_packages');
    }
    expect(REPOSITORY_PERMISSIONS.packages).toBe('write');
    expect(Y1_ADDED_PERMISSIONS.packages).toBe('write');
  });

  it('builds a private App whose URLs all point at this server and which listens for no extra events', () => {
    const manifest = buildManifest({ origin: 'https://github-mcp.example.test', login: 'example-org' });
    expect(manifest).toMatchObject({
      name: 'robinson-mcp-example-org', url: 'https://github-mcp.example.test', public: false, default_events: [], request_oauth_on_install: false,
      hook_attributes: { url: 'https://github-mcp.example.test/api/github/webhook', active: true },
      redirect_url: 'https://github-mcp.example.test/api/github/manifest-callback',
      callback_urls: ['https://github-mcp.example.test/api/github/user-callback'], setup_url: 'https://github-mcp.example.test/api/github/setup'
    });
    expect(manifest.default_permissions).toEqual(MANIFEST_PERMISSIONS);
    manifest.default_permissions.contents = 'read';
    expect(MANIFEST_PERMISSIONS.contents).toBe('write'); // a built manifest is a copy
    expect(JSON.stringify(manifest)).not.toMatch(/secret_value|ghp_|BEGIN/);
  });

  it('posts to the organization or the personal settings page with the state', () => {
    const state = 'S'.repeat(43);
    expect(manifestFormUrl({ login: 'example-org', accountType: 'Organization', state })).toBe(`https://github.com/organizations/example-org/settings/apps/new?state=${state}`);
    expect(manifestFormUrl({ login: 'example-user', accountType: 'User', state })).toBe(`https://github.com/settings/apps/new?state=${state}`);
    expect(() => manifestFormUrl({ login: 'bad/login', accountType: 'User', state })).toThrow(TypeError);
    expect(() => manifestFormUrl({ login: 'ok', accountType: 'User', state: 'short' })).toThrow(TypeError);
    expect(installUrl('example-org-mcp')).toBe('https://github.com/apps/example-org-mcp/installations/new');
  });

  it('names Apps within GitHub\'s 34-character limit and refuses bad account names', () => {
    expect(appNameFor('Robinson-AI-Systems')).toBe('robinson-mcp-Robinson-AI-Systems');
    expect(appNameFor('a'.repeat(39)).length).toBeLessThanOrEqual(34);
    for (const bad of ['', 'has space', '-lead', 'a/b', 'a'.repeat(40), undefined, 5, 'x.y', '../x']) {
      expect(isValidLogin(bad), String(bad)).toBe(false);
      expect(() => appNameFor(bad)).toThrow(TypeError);
    }
    expect(isValidLogin('christcr2012')).toBe(true);
  });
});

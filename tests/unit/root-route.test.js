import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import handler, { publicInfo } from '../../api/index.js';
import { call, json, request } from '../../test/helpers/http-harness.js';

const rewrites = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).rewrites;

describe('public informational root route', () => {
  it('maps the exact root path to the deployed API info function without intercepting OAuth discovery', () => {
    expect(rewrites.filter((rule) => rule.source === '/')).toEqual([{ source: '/', destination: '/api/index' }]);
    expect(rewrites.find((rule) => rule.source === '/.well-known/oauth-authorization-server')?.destination)
      .toBe('/api/well-known/oauth-authorization-server');
    expect(rewrites.find((rule) => rule.source === '/.well-known/oauth-protected-resource')?.destination)
      .toBe('/api/well-known/oauth-protected-resource');
    expect(rewrites.every((rule) => rule.destination.startsWith('/api/'))).toBe(true);
  });

  it('answers GET without credentials using only non-sensitive setup information', async () => {
    const result = await call(handler, request('GET', {}));
    const body = json(result);
    expect(result.statusCode).toBe(200);
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(body).toMatchObject({
      name: 'Robinson GitHub MCP', status: 'service-online',
      connected_provider: 'not_assessed', custom_mcp_acceptance: 'not_assessed',
      source_sha_independently_verified: false,
      oauth: '/.well-known/oauth-authorization-server', endpoint: '/api/mcp'
    });
    expect(Number.isInteger(body.tools) && body.tools > 0).toBe(true);
    expect(body.note).toMatch(/not GitHub App setup/);
    expect(body).not.toHaveProperty('accounts');
    expect(JSON.stringify(body)).not.toMatch(/secret|token_encryption_key|private.key/i);
  });
  it('reports only a valid self-reported build SHA without asserting deployed or provider acceptance', () => {
    const sha = 'a'.repeat(40);
    expect(publicInfo(sha)).toMatchObject({
      deployed_source_sha: sha, source_sha_independently_verified: false,
      connected_provider: 'not_assessed', custom_mcp_acceptance: 'not_assessed'
    });
    expect(publicInfo('malformed')).toMatchObject({deployed_source_sha: null});
    expect(publicInfo('ghp_FAKE_not_a_sha')).toMatchObject({deployed_source_sha: null});
  });
  it('serves /favicon.ico from the existing 64px brand icon route', () => {
    expect(rewrites).toContainEqual({source: '/favicon.ico', destination: '/api/index?brand_icon=64'});
  });
});

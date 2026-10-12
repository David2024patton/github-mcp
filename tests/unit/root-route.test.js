import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import handler from '../../api/index.js';
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
      name: 'Robinson GitHub MCP', status: 'setup-required',
      oauth: '/.well-known/oauth-authorization-server', endpoint: '/api/mcp'
    });
    expect(Number.isInteger(body.tools) && body.tools > 0).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secret|token_encryption_key|private.key/i);
  });
});

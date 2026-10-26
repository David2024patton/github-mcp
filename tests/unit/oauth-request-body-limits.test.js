import { describe, expect, it } from 'vitest';
import { paramsOf, MAX_REQUEST_BODY_BYTES } from '../../src/core/http.js';
import { publicRegister } from '../../src/tenancy/public-http.js';
import { handleOAuth } from '../../src/oauth/routes.js';
import { call, json, request } from '../../test/helpers/http-harness.js';

describe('bounded unauthenticated OAuth request bodies', () => {
  const post = (body, contentType = 'application/json', length = '1') =>
    request('POST', body, { 'content-type': contentType, 'content-length': length });

  it('accepts safe parsed objects and raw urlencoded strings, including the exact 16 KB boundary', () => {
    expect(paramsOf(post({ name: 'ok' }))).toEqual({ name: 'ok' });
    const raw = 'a=' + 'x'.repeat(MAX_REQUEST_BODY_BYTES - 2);
    expect(paramsOf(post(raw, 'application/x-www-form-urlencoded')).a).toHaveLength(MAX_REQUEST_BODY_BYTES - 2);
  });

  it('rejects raw or parsed input larger than 16 KB even with forged small content-length', () => {
    expect(() => paramsOf(post('a=' + 'x'.repeat(MAX_REQUEST_BODY_BYTES), 'application/x-www-form-urlencoded')))
      .toThrow(/Invalid request body/);
    expect(() => paramsOf(post({ name: 'a'.repeat(MAX_REQUEST_BODY_BYTES) }))).toThrow(/Invalid request body/);
    expect(() => paramsOf(post({ name: 'é'.repeat(9000) }))).toThrow(/Invalid request body/);
  });

  it('accepts object at exact serialized limit and rejects the next byte', () => {
    const prefix = JSON.stringify({ v: '' }).length;
    const permitted = { v: 'x'.repeat(MAX_REQUEST_BODY_BYTES - prefix) };
    expect(Buffer.byteLength(JSON.stringify(permitted))).toBe(MAX_REQUEST_BODY_BYTES);
    expect(paramsOf(post(permitted))).toEqual(permitted);
    expect(() => paramsOf(post({ v: permitted.v + 'x' }))).toThrow(/Invalid request body/);
  });

  it('fails closed on cycles, arrays, missing data and malformed JSON', () => {
    const cycle = {}; cycle.self = cycle;
    for (const body of [cycle, [], null, undefined]) expect(() => paramsOf(post(body))).toThrow();
    expect(() => paramsOf(post('{invalid json'))).toThrow();
  });

  it('rejects malformed or oversized public registration with 400 and no registration side effects', async () => {
    let registrations = 0;
    const connect = { registerClient: async () => { registrations++; return { client_id: 'not-created' }; } };
    const env = { GITHUB_PUBLIC_CONNECT: 'enabled' };
    for (const body of [{ name: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }, '{invalid json']) {
      const res = await call((req, out) => publicRegister(req, out, { env, connect }), post(body));
      expect(res.statusCode).toBe(400);
      expect(json(res)).toMatchObject({ error: 'invalid_client_metadata' });
    }
    expect(registrations).toBe(0);
    const res = await call((req, out) => publicRegister(req, out, { env, connect }), post({ redirect_uris: ['https://example.test/cb'] }));
    expect(res.statusCode).toBe(201);
    expect(registrations).toBe(1);
  });

  it('responds 400 on oversized token and authorize requests before looking up a client', async () => {
    const env = { PUBLIC_BASE_URL: 'https://example.test' };
    const db = { getOAuthClient: () => { throw new Error('No DB access allowed'); } };
    for (const which of ['token', 'authorize']) {
      const res = await call((req, out) => handleOAuth(which, req, out, { env, db }), post({ data: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }));
      expect(res.statusCode).toBe(400);
      expect(json(res)).toMatchObject({ error: 'invalid_request' });
    }
  });
});

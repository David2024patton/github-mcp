import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleGithub } from '../../src/github/routes.js';
import { createCredentials } from '../../src/github/credentials.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { call, json, request } from '../../test/helpers/http-harness.js';

const ENV = { VERCEL_ENV: 'production', PUBLIC_BASE_URL: 'https://github-mcp.example.test', ADMIN_PASSPHRASE: 'fixture-admin-passphrase', TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };

describe('the GitHub setup routes', () => {
  it('serves the setup page, answers 404 for anything else, and refuses prototype-name actions', async () => {
    const db = createFakeDb();
    await db.initSchema();
    const runtime = { db, credentials: createCredentials({ db, env: ENV, fetch }) };
    const page = await call((req, res) => handleGithub('setup', req, res, { runtime, env: ENV }), request('GET', {}));
    expect(page.statusCode).toBe(200);
    expect(page.headers['Cache-Control']).toBe('no-store');
    for (const action of ['webhook', 'constructor', '__proto__', 'toString', undefined, '']) {
      const res = await call((req, r) => handleGithub(action, req, r, { runtime, env: ENV }), request('GET', {}));
      expect(res.statusCode, String(action)).toBe(404);
    }
  });

  it('answers 503 with no detail when the database or configuration is unavailable', async () => {
    const runtime = { get db() { throw new Error('postgres://user:password@host/db failed'); } };
    const res = await call((req, r) => handleGithub('setup', req, r, { runtime, env: ENV }), request('GET', {}));
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('postgres');
    expect(json(res).error).toBe('temporarily_unavailable');
  });
});

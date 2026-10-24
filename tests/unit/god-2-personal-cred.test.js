import { describe, expect, it } from 'vitest';
import { personalCred, scopeCovered } from '../../src/github/personal-cred.js';

const ctx = (over = {}, status = { enrolled: true, scopes: ['gist'] }) => ({
  connection: { profile: 'full' },
  credentials: { masterStatus: async () => status },
  ...over
});

describe('GOD-2 personalCred', () => {
  it('uses U when there is no masterStatus', async () => {
    expect(await personalCred({ connection: {}, credentials: {} }, 'gist')).toBe('U');
  });
  it('uses M when enrolled with the exact scope', async () => {
    expect(await personalCred(ctx(), 'gist')).toBe('M');
  });
  it('uses M when a broader scope covers the needed one', async () => {
    expect(await personalCred(ctx({}, { enrolled: true, scopes: ['user'] }), 'user:email')).toBe('M');
  });
  it('uses U when the granted scopes do not cover it', async () => {
    expect(await personalCred(ctx({}, { enrolled: true, scopes: ['repo'] }), 'gist')).toBe('U');
  });
  it('uses U for read-only connections', async () => {
    expect(await personalCred(ctx({ connection: { profile: 'read_only' } }), 'gist')).toBe('U');
  });
  it('uses U for passes', async () => {
    expect(await personalCred(ctx({ connection: { profile: 'full', pass: true } }), 'gist')).toBe('U');
  });
  it('uses U when masterStatus throws', async () => {
    expect(await personalCred(ctx({ credentials: { masterStatus: async () => { throw new Error('x'); } } }), 'gist')).toBe('U');
  });
  it('uses U when not enrolled', async () => {
    expect(await personalCred(ctx({}, { enrolled: false, scopes: ['gist'] }), 'gist')).toBe('U');
  });
  it('scopeCovered treats no needed scope as covered and checks inclusion', () => {
    expect(scopeCovered([], undefined)).toBe(true);
    expect(scopeCovered(['admin:org'], 'read:org')).toBe(true);
    expect(scopeCovered(['read:org'], 'admin:org')).toBe(false);
  });
});

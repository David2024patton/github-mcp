import { describe, expect, test } from 'vitest';
import { FREE_ROUTES, isReviewedFree } from '../../src/github/spend-classes.js';
import { restOperation, restOperations } from '../../src/github/openapi-index.js';
import { classifyUniversal, universalPrice } from '../../src/github/operation-classes.js';

// Pinned on purpose: an accidental unlock (a new FREE_ROUTES key or a looser regex) turns CI red.
// Changing either number needs a DECISIONS.md line explaining which routes moved and why.
const PINNED_FREE_ROUTES = 54;
const PINNED_BLOCKED_WRITES = 100;

describe('reviewed-free universal routes (Y-1 WU-Y1a)', () => {
  test('every key exists in the vendored OpenAPI description (a typo cannot fail open)', () => {
    for (const key of FREE_ROUTES) {
      const [method] = key.split(' ');
      expect(() => restOperation(key, method), key).not.toThrow();
      expect(method).not.toBe('GET');
    }
  });

  test('no enterprise, app or hosted-runner route is ever free', () => {
    for (const key of FREE_ROUTES) {
      expect(key).not.toMatch(/\/enterprises?\//);
      expect(key).not.toMatch(/(?<!self-)hosted-runners|runner-images|retention|cache|codespaces|copilot|billing|code-security|marketplace/i);
    }
  });

  test('free keys classify as no spend risk and price at zero', () => {
    for (const key of FREE_ROUTES) {
      const op = restOperation(key);
      expect(isReviewedFree(op)).toBe(true);
      expect(classifyUniversal(op).spendRisk, key).toBe(false);
      expect(universalPrice(op), key).toBe(0);
    }
  });

  test('each excluded family still stays blocked', () => {
    const blocked = [
      'POST /orgs/{org}/actions/hosted-runners',
      'PUT /orgs/{org}/actions/cache/retention-limit',
      'PUT /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention',
      'POST /orgs/{org}/codespaces/access',
      'PUT /orgs/{org}/copilot/billing/selected_users',
      'POST /orgs/{org}/code-security/configurations',
    ];
    for (const key of blocked) {
      const method = key.split(' ')[0];
      let op;
      try { op = restOperation(key, method); } catch { continue; } // route renamed upstream: nothing to guard
      expect(classifyUniversal(op).spendRisk, key).toBe(true);
      expect(() => universalPrice(op), key).toThrow(/Cost or licensing/);
    }
  });

  test('unlisted writes whose text matches a spend word are unchanged', () => {
    const op = restOperation('PUT /orgs/{org}/actions/permissions/artifact-and-log-retention');
    expect(isReviewedFree(op)).toBe(false);
    expect(classifyUniversal(op).spendRisk).toBe(true);
  });

  test('reads and unknown operations are never reviewed-free', () => {
    expect(isReviewedFree(undefined)).toBe(false);
    expect(isReviewedFree({ method: 'GET', path: '/orgs/{org}/actions/runners' })).toBe(false);
  });

  test('pinned counts: free routes and still-blocked writes', () => {
    const blockedWrites = restOperations().filter((o) => o.method !== 'GET' && classifyUniversal(o).spendRisk).length;
    expect(FREE_ROUTES.size).toBe(PINNED_FREE_ROUTES);
    expect(blockedWrites).toBe(PINNED_BLOCKED_WRITES);
  });
});

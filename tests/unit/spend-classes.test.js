import { describe, expect, test } from 'vitest';
import { FREE_ROUTES, isReviewedFree } from '../../src/github/spend-classes.js';
import { restOperation, restOperations } from '../../src/github/openapi-index.js';
import { classifyUniversal, universalPrice } from '../../src/github/operation-classes.js';

// Preserve the exact 54 provider-reviewed free routes and a minimum of the
// historical 100 denied-risk routes. Stronger owner-authority requirement:
// EVERY OTHER pinned mutation is unknown-priced, including names with no spend keyword.
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

  test('each formerly blocked paid family stays unknown-cost, without an unconditional product ban', () => {
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
      expect(universalPrice(op), key).toBeNull();
    }
  });

  test('unlisted writes are uncertain-cost even when the provider name looks free', () => {
    const op = restOperation('PUT /orgs/{org}/actions/permissions/artifact-and-log-retention');
    expect(isReviewedFree(op)).toBe(false);
    expect(classifyUniversal(op).spendRisk).toBe(true);
    expect(universalPrice(op)).toBeNull();
    const innocuous=restOperation('PUT /repos/{owner}/{repo}/interaction-limits');
    expect(isReviewedFree(innocuous)).toBe(false);
    expect(classifyUniversal(innocuous).spendRisk).toBe(true);
    expect(universalPrice(innocuous)).toBeNull();
  });

  test('reads and unknown operations are never reviewed-free', () => {
    expect(isReviewedFree(undefined)).toBe(false);
    expect(isReviewedFree({ method: 'GET', path: '/orgs/{org}/actions/runners' })).toBe(false);
  });

  test('pinned 54 free keys and no unreviewed REST write is falsely free', () => {
    const writes=restOperations().filter((o)=>o.method!=='GET');
    const blockedWrites=writes.filter((o)=>classifyUniversal(o).spendRisk).length;
    expect(FREE_ROUTES.size).toBe(PINNED_FREE_ROUTES);
    expect(writes.filter((o)=>isReviewedFree(o)).length).toBe(PINNED_FREE_ROUTES);
    expect(blockedWrites).toBe(writes.length-PINNED_FREE_ROUTES);
    expect(blockedWrites).toBeGreaterThanOrEqual(PINNED_BLOCKED_WRITES);
    for (const op of writes) {
      expect(universalPrice(op)===0,op.route).toBe(isReviewedFree(op));
      expect(universalPrice(op)===null,op.route).toBe(!isReviewedFree(op));
    }
  });
});

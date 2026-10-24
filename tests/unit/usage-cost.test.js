import { describe, expect, it } from 'vitest';
import { estimatePublicCost } from '../../src/tenancy/usage-cost.js';
import { renderSetup } from '../../src/github/setup-html.js';

const usage = (week) => ({ peopleConnected: 4, moreThanShown: false, unreadable: 0, lastDay: { calls: 1, refused: 0, throttled: 0, errors: 0 }, lastWeek: { calls: week } });

describe('public hosting cost estimate', () => {
  it('turns a week of calls into integer cents for a month, with dollars for display', () => {
    const c = estimatePublicCost(usage(7000), { PUBLIC_COST_PER_1K_CALLS_CENTS: '10' });
    expect(c.monthCalls).toBe(30000);
    expect(c.estimateCents).toBe(300);
    expect(Number.isInteger(c.estimateCents)).toBe(true);
    expect(c.estimate_display).toBe('$3.00');
    expect(c.overAlert).toBe(false);
  });
  it('rounds up, never down to free', () => {
    expect(estimatePublicCost(usage(1), {}).estimateCents).toBe(1);
    expect(estimatePublicCost(usage(0), {}).estimateCents).toBe(0);
  });
  it('flags the alert once the estimate reaches the owner level (default $20)', () => {
    expect(estimatePublicCost(usage(7000), { PUBLIC_COST_PER_1K_CALLS_CENTS: '10', PUBLIC_COST_ALERT_CENTS: '300' }).overAlert).toBe(true);
    expect(estimatePublicCost(usage(7000), { PUBLIC_COST_PER_1K_CALLS_CENTS: '10', PUBLIC_COST_ALERT_CENTS: '301' }).overAlert).toBe(false);
    expect(estimatePublicCost(usage(1), {}).alert_display).toBe('$20.00');
  });
  it('ignores bad settings and falls back to the defaults', () => {
    const c = estimatePublicCost(usage(7000), { PUBLIC_COST_PER_1K_CALLS_CENTS: 'abc', PUBLIC_COST_ALERT_CENTS: '-5' });
    expect(c.per1kCents).toBe(5);
    expect(c.alertCents).toBe(2000);
  });
  it('shows on the owner page as a plain sentence, with a warning only over the alert level', () => {
    const quiet = renderSetup({ csrf: 'c', publicUsage: { ...usage(7000), cost: estimatePublicCost(usage(7000), { PUBLIC_COST_PER_1K_CALLS_CENTS: '10' }) } });
    expect(quiet).toContain('Estimated hosting cost at this rate: about $3.00 a month');
    expect(quiet).toContain('not a bill');
    expect(quiet).not.toContain('Heads up');
    const loud = renderSetup({ csrf: 'c', publicUsage: { ...usage(7000), cost: estimatePublicCost(usage(7000), { PUBLIC_COST_PER_1K_CALLS_CENTS: '10', PUBLIC_COST_ALERT_CENTS: '100' }) } });
    expect(loud).toContain('Heads up');
    expect(loud).toContain('$1.00 a month');
  });
});

describe('setup collisions between first-time sign-ins', () => {
  it('retries Postgres "tuple concurrently updated" and raises anything else at once', async () => {
    const { retryConcurrent } = await import('../../src/tenancy/directory.js');
    let n = 0;
    const out = await retryConcurrent(async () => { n += 1; if (n < 3) throw new Error('tuple concurrently updated'); return 'ok'; });
    expect(out).toBe('ok'); expect(n).toBe(3);
    let m = 0;
    await expect(retryConcurrent(async () => { m += 1; throw new Error('permission denied'); })).rejects.toThrow('permission denied');
    expect(m).toBe(1);
    await expect(retryConcurrent(async () => { throw new Error('tuple concurrently updated'); }, 2)).rejects.toThrow('tuple concurrently');
  });
});

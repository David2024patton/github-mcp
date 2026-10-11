import { describe, expect, it } from 'vitest';
import { CODESPACES_COMPUTE, PRICES, codespacesComputeCents, codespacesStorageCents, copilotSeatsCents, dollars, priceLine, securityCents } from '../../src/github/prices.js';

describe('GitHub prices', () => {
  it('every price carries its source page and the date it was read', () => {
    for (const p of Object.values(PRICES)) {
      expect(p.source).toMatch(/^https:\/\//);
      expect(p.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isSafeInteger(p.cents)).toBe(true);
    }
    expect(CODESPACES_COMPUTE.source).toMatch(/^https:\/\//);
  });
  it('computes in whole cents from the table', () => {
    expect(copilotSeatsCents(3)).toBe(5700);
    expect(securityCents('secret_protection', 2)).toBe(3800);
    expect(securityCents('code_security', 2)).toBe(6000);
    expect(codespacesComputeCents(4, 2.5)).toBe(90);
    expect(codespacesComputeCents(2, 0.01)).toBe(1);
    expect(codespacesStorageCents(10)).toBe(70);
  });
  it('refuses nonsense instead of guessing', () => {
    expect(() => copilotSeatsCents(0)).toThrow(TypeError);
    expect(() => copilotSeatsCents(1.5)).toThrow(TypeError);
    expect(() => securityCents('other', 1)).toThrow(TypeError);
    expect(() => codespacesComputeCents(3, 1)).toThrow(TypeError);
    expect(() => codespacesComputeCents(2, 0)).toThrow(TypeError);
  });
  it('formats dollars and a preview line with the source date', () => {
    expect(dollars(1900)).toBe('$19.00');
    expect(priceLine(3800, 'copilot_business_seat')).toContain('$19.00 per seat per month');
    expect(priceLine(3800, 'copilot_business_seat')).toContain('2026-10-10');
  });
});

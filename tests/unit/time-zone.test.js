import { describe, expect, it } from 'vitest';
import { COMMON_ZONES, currentZone, formatLocal, loadZone, validZone, withTimeZone } from '../../src/core/time-zone.js';

describe('per-person display time zone', () => {
  it('defaults to UTC, clearly labelled', () => {
    expect(currentZone()).toBe('UTC');
    expect(formatLocal('2026-10-23T20:00:00Z')).toBe('Oct 23, 2026, 8:00 PM UTC');
  });
  it('uses the person\'s own zone inside a request, across daylight saving, and does not leak out', () => {
    expect(withTimeZone('America/Denver', () => formatLocal('2026-10-23T20:00:00Z'))).toBe('Oct 23, 2026, 2:00 PM MDT');
    expect(withTimeZone('Asia/Tokyo', () => formatLocal('2026-10-23T20:00:00Z'))).toContain('Oct 24, 2026, 5:00 AM');
    expect(currentZone()).toBe('UTC');
  });
  it('keeps two overlapping requests separate', async () => {
    const run = (zone, wait) => withTimeZone(zone, async () => { await new Promise((r) => setTimeout(r, wait)); return currentZone(); });
    expect(await Promise.all([run('America/Chicago', 20), run('Europe/Paris', 5)])).toEqual(['America/Chicago', 'Europe/Paris']);
  });
  it('falls back to UTC for anything that is not a real zone', async () => {
    for (const bad of ['Mars/Base', '', null, 42, '../etc', 'a'.repeat(80)]) expect(validZone(bad)).toBeNull();
    expect(withTimeZone('Mars/Base', () => currentZone())).toBe('UTC');
    expect(await loadZone({ getSetting: async () => 'Mars/Base' })).toBe('UTC');
    expect(await loadZone({ getSetting: async () => { throw new Error('db down'); } })).toBe('UTC');
    expect(await loadZone({ getSetting: async () => 'Europe/Paris' })).toBe('Europe/Paris');
  });
  it('every name offered on the sign-in page is a real zone', () => {
    for (const zone of COMMON_ZONES) expect(validZone(zone)).toBe(zone);
  });
});

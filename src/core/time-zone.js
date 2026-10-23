// Per-person display time zone. Times are always stored in UTC; only the wording shown to a person changes.
// The zone for the current request is carried in an AsyncLocalStorage so the many places that print a time need no
// extra argument. No zone chosen = UTC, clearly labelled. The zone is a display setting only: it is never used for
// security, budgets or scheduling decisions.
import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_ZONE = 'UTC';
export const ZONE_SETTING = 'time_zone';
const store = new AsyncLocalStorage();

/** A short list for the sign-in page; any real IANA name is accepted when set another way. */
export const COMMON_ZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Athens', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland'
];

/** The zone name when it is a real IANA zone (shape and existence), otherwise null. */
export function validZone(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-/]{1,63}$/.test(value)) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return value; } catch { return null; }
}

export const currentZone = () => store.getStore()?.zone ?? DEFAULT_ZONE;

/** Runs `fn` with `zone` as the display zone (falls back to UTC when it is missing or not a real zone). */
export const withTimeZone = (zone, fn) => store.run({ zone: validZone(zone) ?? DEFAULT_ZONE }, fn);

/** Reads the person's saved zone from their settings store; any failure means UTC. */
export async function loadZone(db) {
  try { return validZone(await db?.getSetting?.(ZONE_SETTING)) ?? DEFAULT_ZONE; } catch { return DEFAULT_ZONE; }
}

/** "Oct 10, 2026, 7:45 PM MDT" in the person's zone ("UTC" when none was chosen). */
export function formatLocal(date, zone = currentZone()) {
  const d = date instanceof Date ? date : new Date(date);
  const text = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  const label = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value;
  return `${text} ${zone === 'UTC' ? 'UTC' : label || zone}`;
}

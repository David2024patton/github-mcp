// Exact run ownership markers shared by seed verification and guarded cleanup.
import { RUN_ID } from './ledger.js';

export function matchesRunDescription(value, runId) {
  if (typeof value !== 'string' || !RUN_ID.test(runId ?? '')) return false;
  // A longer run ID must never pass the current run's ownership check.
  return new RegExp(`(?:^|\\s)rtc_run=${runId}(?=$|\\s|\\))`).test(value);
}

export function matchesRunFooter(value, runId) {
  return typeof value === 'string' && RUN_ID.test(runId ?? '') &&
    value.includes(`<!-- rtc_run=${runId} -->`);
}

// What GitHub charges for the things this server can switch on (B4). Every price carries the page it came from and the date it was
// read there, so a stale price is visible. Money is whole cents. The spend guard and the previews compute costs from this table only,
// never from tool arguments. A price GitHub does not publish is absent, and a tool that needs it refuses instead of guessing.
const DAY = '2026-10-10';

export const PRICES = Object.freeze({
  copilot_business_seat: Object.freeze({ cents: 1900, unit: 'seat per month', source: 'https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses', readOn: DAY,
    note: 'billed monthly; seats added mid-cycle are charged immediately, prorated for the rest of the cycle (the full price is used as the estimate)' }),
  copilot_enterprise_seat: Object.freeze({ cents: 3900, unit: 'seat per month', source: 'https://docs.github.com/en/copilot/get-started/plans', readOn: '2026-10-14',
    note: 'full monthly estimate; confirm actual enterprise plan and proration on GitHub bill' }),
  codespaces_storage: Object.freeze({ cents: 7, unit: 'GB per month', source: 'https://docs.github.com/en/billing/concepts/product-billing/github-codespaces', readOn: DAY }),
  secret_protection_committer: Object.freeze({ cents: 1900, unit: 'active committer per month', source: 'https://github.com/security/plans', readOn: DAY,
    note: 'an active committer pushed in the last 90 days to a repository with the feature on; bots are ignored' }),
  code_security_committer: Object.freeze({ cents: 3000, unit: 'active committer per month', source: 'https://github.com/security/plans', readOn: DAY })
});

/** Codespaces compute, cents per hour by number of cores. */
export const CODESPACES_COMPUTE = Object.freeze({
  cents_per_hour: Object.freeze({ 2: 18, 4: 36, 8: 72, 16: 144, 32: 288 }),
  source: 'https://docs.github.com/en/billing/concepts/product-billing/github-codespaces', readOn: DAY
});

export const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const count = (n, what) => { if (!Number.isSafeInteger(n) || n < 1 || n > 100000) throw new TypeError(`${what} must be a whole number from 1 to 100000.`); return n; };

/** Monthly cost of `n` Copilot Business seats. */
export const copilotSeatsCents = (n) => count(n, 'The number of seats') * PRICES.copilot_business_seat.cents;
/** Monthly cost of paid security features for `n` active committers. `feature` is 'secret_protection' or 'code_security'. */
export function securityCents(feature, n) {
  const price = PRICES[`${feature}_committer`];
  if (!price) throw new TypeError('The feature is secret_protection or code_security.');
  return count(n, 'The number of committers') * price.cents;
}
/** Cost of running a Codespace of `cores` cores for `hours` hours (rounded up to whole cents). */
export function codespacesComputeCents(cores, hours) {
  const rate = CODESPACES_COMPUTE.cents_per_hour[cores];
  if (rate === undefined) throw new TypeError(`Codespaces come in ${Object.keys(CODESPACES_COMPUTE.cents_per_hour).join(', ')} cores.`);
  if (!(hours > 0) || hours > 100000) throw new TypeError('Hours must be above 0.');
  return Math.ceil(rate * hours);
}
/** Monthly cost of `gb` GB of Codespaces storage. */
export const codespacesStorageCents = (gb) => Math.ceil(count(gb, 'The storage') * PRICES.codespaces_storage.cents);

/** One plain line for a preview: the amount and where the price came from. */
export function priceLine(cents, key) {
  const p = PRICES[key];
  return p ? `about ${dollars(cents)} (${dollars(p.cents)} per ${p.unit}, GitHub's price as read on ${p.readOn})` : `about ${dollars(cents)}`;
}

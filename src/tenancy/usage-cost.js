// LAUNCH-1: a plain-words monthly cost ESTIMATE for the owner, from counts only. It is a rough rule of thumb, not a bill:
// the real charge comes from Vercel and Neon. Rates are stored settings (integer cents), so the owner can match them to the
// current price list at https://vercel.com/pricing (Pro plan, function invocations and active CPU) and https://neon.com/pricing.
// Nothing here spends money, changes a plan or calls a provider.
const whole = (text, fallback, max) => {
  const n = Number(text ?? fallback);
  return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : fallback;
};
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

/** @param {{lastWeek:{calls:number}, peopleConnected:number}} usage from publicUsageSummary
 *  @param {Record<string,string|undefined>} env */
export function estimatePublicCost(usage, env = process.env) {
  const per1kCents = whole(env.PUBLIC_COST_PER_1K_CALLS_CENTS, 5, 100000);
  const alertCents = whole(env.PUBLIC_COST_ALERT_CENTS, 2000, 100000000);
  const weekCalls = Math.max(0, Math.trunc(Number(usage?.lastWeek?.calls) || 0));
  const monthCalls = Math.round((weekCalls / 7) * 30);
  const estimateCents = Math.ceil((monthCalls * per1kCents) / 1000);
  return { monthCalls, per1kCents, estimateCents, estimate_display: dollars(estimateCents),
    alertCents, alert_display: dollars(alertCents), overAlert: alertCents > 0 && estimateCents >= alertCents };
}

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

const CACHE_KEY = 'public_cost_estimate_cache';
const CACHE_MS = 10 * 60 * 1000;

/** PUB-5 B: the estimated monthly cost from the last 7 days of calls (calls x 30/7 x the price per 1,000 calls), cached for
 *  10 minutes in the shared settings so a burst of sign-ups does not recount every time. Counts only; it changes nothing.
 *  @param {{rootSql:Function, root:{getSetting:Function,setSetting:Function}, env:Record<string,string|undefined>, now?:()=>number}} deps */
export async function publicCostEstimateCents({ rootSql, root, env = process.env, now = Date.now }) {
  const cached = await root.getSetting(CACHE_KEY).catch(() => null);
  if (cached && Number.isFinite(cached.at) && Number.isSafeInteger(cached.cents) && now() - cached.at >= 0 && now() - cached.at < CACHE_MS) return cached.cents;
  const [{ calls }] = await rootSql`SELECT COALESCE(SUM(calls), 0)::bigint AS calls FROM gh_public_usage_daily
    WHERE day > (now() AT TIME ZONE 'UTC')::date - 7`;
  const cents = estimatePublicCost({ lastWeek: { calls: Number(calls) } }, env).estimateCents;
  await root.setSetting(CACHE_KEY, { at: now(), cents }).catch(() => {});
  return cents;
}

/** PUB-5 B: are NEW sign-ups open? Paused by hand (GITHUB_PUBLIC_NEW_SIGNUPS=paused) or because the estimate reached the pause level.
 *  People who already have a store are never affected; this is only asked for brand-new people. */
export async function publicSignupState({ rootSql, root, env = process.env, limits, now = Date.now }) {
  const manual = env.GITHUB_PUBLIC_NEW_SIGNUPS === 'paused';
  const estimateCents = await publicCostEstimateCents({ rootSql, root, env, now });
  const pausedByCost = limits.costPauseCents > 0 && estimateCents >= limits.costPauseCents;
  return { paused: manual || pausedByCost, manual, pausedByCost, estimateCents, pauseCents: limits.costPauseCents,
    reason: manual ? 'paused by hand' : pausedByCost ? `estimated monthly cost ${dollars(estimateCents)} reached ${dollars(limits.costPauseCents)}` : null };
}

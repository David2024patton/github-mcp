// Fixed-window per-key (normally per-IP) rate limiter for unauthenticated HTTP endpoints.
// State is IN-MEMORY and PER-INSTANCE: on serverless (Vercel) each warm instance counts
// separately, so the effective global limit is roughly limit x instances — best-effort
// abuse damping, not a hard guarantee. Checked the repo's DB-backed options first:
// gh_rate_state mirrors GitHub API bucket state keyed by (account, resource) and cannot
// count anonymous per-IP requests, and admitTenantOAuth/claimTenantBudget is keyed by
// client_id, which an unauthenticated caller chooses or omits entirely — so neither fits
// pre-authentication per-IP throttling and an in-memory limiter is used instead.
export function createIpRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new TypeError('createIpRateLimiter needs an integer limit >= 1 and a positive windowMs.');
  }
  const buckets = new Map();
  let lastSweep = 0;
  return {
    // Consumes one slot for `ip`; returns { allowed, retryAfterSeconds } where the retry
    // count is the whole seconds left until the current window resets.
    check(ip) {
      const at = now();
      // Periodically drop expired buckets so an attacker rotating source IPs cannot grow memory unboundedly.
      if (at - lastSweep >= windowMs) {
        for (const [key, bucket] of buckets) if (bucket.resetAt <= at) buckets.delete(key);
        lastSweep = at;
      }
      let bucket = buckets.get(ip);
      if (!bucket || bucket.resetAt <= at) {
        bucket = { count: 0, resetAt: at + windowMs };
        buckets.set(ip, bucket);
      }
      bucket.count += 1;
      return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - at) / 1000)) };
    }
  };
}

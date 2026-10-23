// GitHub answers 403 "Upgrade to GitHub Pro or make this repository public to enable this feature." for branch rules and branch protection
// reads on a private repository whose plan has neither. That exact answer means "this repository cannot hold any" -- not "unreadable".
// Any other 403, a different status or a different message is NOT a plan limit. Shared so every reader agrees.
const PLAN_LIMIT = /^Upgrade to GitHub (Pro|Team)\b.*to enable this feature\.?$/i;

export function isPlanLimit(error) {
  return (error?.status ?? null) === 403 && PLAN_LIMIT.test(String(error?.response?.data?.message ?? '').trim());
}

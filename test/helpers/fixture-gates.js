// Stand-in guard gates for the write-contract tests of B-1. The real gates arrive with B-3 (protected resources) and B-4 (spend);
// those cards switch the contract's `gatesFor` to the real ones, so the same nine checks then run against them.
export const CONVEYOR_TOOLS = new Set(['github_sample_label', 'github_sample_comment']);

export function protectionGate(level) {
  return async ({ name }) => {
    if (level === 'locked') return { refuse: 'This resource is locked: no change may be made to it.', by: 'protected resource (locked)' };
    if (level === 'pr-only' && !CONVEYOR_TOOLS.has(name)) return { refuse: 'This resource only allows normal pull-request work; this change is not part of it.', by: 'protected resource (pr-only)' };
    return null;
  };
}

export function spendGate({ limitCents, spentCents = 0 }) {
  return async ({ classification }) => {
    if (!classification.spendCents) return null;
    if (limitCents <= 0) return { refuse: 'The spend limit for this account is $0.00. It can be raised only on the setup page.', by: 'spend limit' };
    if (spentCents + classification.spendCents > limitCents) return { refuse: 'This would go over the monthly spend limit for this account.', by: 'spend limit' };
    return null;
  };
}

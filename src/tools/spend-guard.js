// The spend guard (B4). Anything that costs money (Copilot seats, Codespaces, paid security features, raised budgets) is `$`:
// the preview shows the dollar estimate, it always asks first, and it must fit the account's monthly spend limit (default $0, so
// every `$` tool is refused until the owner raises the limit on the setup page). The month is the calendar month in Denver.
// The amount comes from tool classification (prices in `src/github/prices.js`), never from an argument.
import { dollars } from '../github/prices.js';

const DENVER = 'America/Denver';

/** The instant the current calendar month began in Denver (a Date). */
export function denverMonthStart(now) {
  const at = new Date(now);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: DENVER, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  const firstUtcGuess = Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0);
  // Denver is 6 or 7 hours behind UTC; the offset on the 1st decides which.
  for (const offsetHours of [6, 7]) {
    const candidate = new Date(firstUtcGuess + offsetHours * 3_600_000);
    const local = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: DENVER, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(candidate).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
    if (local.year === parts.year && local.month === parts.month && local.day === 1 && local.hour === 0) return candidate;
  }
  throw new Error('Could not work out the start of the month in Denver.');
}

/** Limit, spent so far this month, and what is left for one account. */
export async function spendStatus(ctx, login) {
  const row = await ctx.db.getAccount(login);
  if (!row) return null;
  const now = (ctx.now ?? Date.now)();
  const since = denverMonthStart(now);
  const limitCents = Number(row.spend_limit_cents) || 0;
  const usedCents = await ctx.db.sumSpendCents(row.login, since);
  return { login: row.login, limitCents, usedCents, remainingCents: Math.max(0, limitCents - usedCents), since };
}

/** The gate for `src/tools/gates.js`. It also enforces "the spend limit tool can only lower the limit". */
export function spendGate() {
  return async ({ name, args, ctx, target, classification, declarations }) => {
    if (name === 'github_set_spend_limit') {
      const status = await spendStatus(ctx, target.owner);
      if (status && Number.isSafeInteger(args.limitCents) && args.limitCents > status.limitCents) {
        return { refuse: `The limit is ${dollars(status.limitCents)} and this would raise it to ${dollars(args.limitCents)}. Only the setup page (with your passphrase) can raise it; this tool can only lower it.`, by: 'spend limit' };
      }
      return null;
    }
    if (!declarations?.spend && !(classification.spendCents > 0)) return null;
    const status = await spendStatus(ctx, target.owner);
    if (!status) return { refuse: `${target.owner} is not a connected account, so its spend limit is unknown.`, by: 'spend limit' };
    const cost = classification.spendCents || 0;
    if (status.limitCents <= 0) {
      return { refuse: `This costs money (${cost ? `about ${dollars(cost)} a month` : 'an amount GitHub bills'}) and the monthly spend limit for ${status.login} is $0.00. To allow spending, raise the limit on the setup page with your passphrase.`, by: 'spend limit' };
    }
    if (status.usedCents + cost > status.limitCents) {
      return { refuse: `This would cost about ${dollars(cost)}; ${dollars(status.usedCents)} of the ${dollars(status.limitCents)} monthly limit for ${status.login} is already used this month (${dollars(status.remainingCents)} left). Raise the limit on the setup page if you want this.`, by: 'spend limit' };
    }
    return { confirm: `This costs about ${dollars(cost)}; ${dollars(status.usedCents)} of ${dollars(status.limitCents)} is used this month for ${status.login}.` };
  };
}

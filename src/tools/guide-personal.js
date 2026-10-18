// The selected organization and its enrolled personal user are different GitHub principals.
// These owner guides are navigational only: never invent a member username from an org.
const LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

export async function enrolledGuideUser(ctx, selectedAccount) {
  const canonical = ctx.connection.accounts.find(x =>
    x.toLowerCase() === String(selectedAccount).toLowerCase());
  if (!canonical) throw new TypeError('This account is not enrolled in the active connection.');
  const row = await ctx.db.getAccount(canonical);
  if (!row) throw new TypeError('This account is not enrolled on the server.');
  // A personal account needs an enrolled U matching its account login, not merely
  // a populated database row or an unrelated OAuth actor.
  const user = row.account_type === 'User'
    ? row.user_token_enc && Number.isSafeInteger(row.account_id) && row.account_id > 0 &&
      typeof row.user_login === 'string' &&
      row.login.toLowerCase() === row.user_login.toLowerCase() ? row.login : null
    : row.user_token_enc && row.user_login;
  return typeof user === 'string' && LOGIN.test(user) ? user : null;
}

// Link-free is more truthful than linking someone's organization as their personal profile.
export function restrictUnknownUserLink(guide, template, user) {
  if (user || !template.includes('{user}')) return guide;
  return {
    ...guide, url: null, identity: 'not_verified',
    reason: 'No enrolled personal identity can be verified for this account. A profile link cannot be inferred from the organization name.'
  };
}

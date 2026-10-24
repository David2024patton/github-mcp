// GOD-5: a write on an "extra place" (an account reached with the person's master token, no App installed) is refused until the
// person switches changes on for that place on My connection, and a place limited to named repositories refuses every other
// repository and every owner-level change. Protected resources, production, spend and people gates still apply after this.
export function extraPlaceGate() {
  return async ({ ctx, target }) => {
    if (!target?.owner) return null;
    const row = await ctx.db.getAccount(target.owner);
    if (row?.credential_kind !== 'master') return null;
    if (row.allow_changes !== true) return { refuse: `Changes are off for ${row.login}. Turn on 'allow changes' for it on My connection.`, by: 'extra place' };
    const list = row.allowed_repos;
    if (Array.isArray(list) && list.length) {
      if (!target.repo) return { refuse: `${row.login} was added only for ${list.join(', ')}; changes to the account itself are not allowed there.`, by: 'extra place' };
      if (!list.some((r) => r.toLowerCase() === String(target.repo).toLowerCase())) return { refuse: `${target.repo} is not one of the repositories you added for ${row.login} (${list.join(', ')}).`, by: 'extra place' };
    }
    return null;
  };
}

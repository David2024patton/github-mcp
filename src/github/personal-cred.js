// GOD-2: which credential acts on the person's OWN GitHub account. The master token (M) when it is added and covers
// the needed classic scope; otherwise the App user sign-in (U), exactly as before. Read-only connections and passes
// never use M (credentialFor refuses it), so they always get U.
export const COVERS = { // a granted classic scope -> the scopes it includes (GitHub docs: "Scopes for OAuth apps")
  repo: ['repo', 'public_repo', 'repo:status', 'repo_deployment', 'repo:invite', 'security_events'],
  user: ['user', 'read:user', 'user:email', 'user:follow'],
  'admin:org': ['admin:org', 'write:org', 'read:org'],
  'admin:public_key': ['admin:public_key', 'write:public_key', 'read:public_key'],
  'admin:gpg_key': ['admin:gpg_key', 'write:gpg_key', 'read:gpg_key'],
  'admin:ssh_signing_key': ['admin:ssh_signing_key', 'write:ssh_signing_key', 'read:ssh_signing_key'],
  'write:packages': ['write:packages', 'read:packages'],
  codespace: ['codespace', 'codespace:secrets'],
  project: ['project', 'read:project'],
  'admin:enterprise': ['admin:enterprise', 'manage_runners:enterprise', 'manage_billing:enterprise', 'read:enterprise']
};

export function scopeCovered(granted = [], needed) {
  if (!needed) return true;
  return granted.some((g) => g === needed || (COVERS[g] ?? []).includes(needed));
}

export async function personalCred(ctx, needed) {
  if (ctx.connection?.profile === 'read_only' || ctx.connection?.pass === true) return 'U';
  if (typeof ctx.credentials?.masterStatus !== 'function') return 'U';
  const status = await ctx.credentials.masterStatus().catch(() => null);
  return status?.enrolled === true && scopeCovered(status.scopes, needed) ? 'M' : 'U';
}

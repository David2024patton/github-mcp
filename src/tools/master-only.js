// GOD-4 B: tools that GitHub only lets a person's own login use (Copilot Spaces, Classroom, hovercards...) run on the master token.
// Without it (or without the needed permission) the answer is one plain sentence and nothing is sent to GitHub.
import { githubFor } from '../github/client.js';
import { personalCred } from '../github/personal-cred.js';
import { refusal } from './github-write.js';

export const needMasterText = (scope) => `Add your master token (My connection) with permission ${scope} to use this.`;
export const hasMaster = async (ctx, scope) => (await personalCred(ctx, scope)) === 'M';

/** The master-token client plus who it is. Throws a plain refusal when the token or permission is missing. */
export async function masterClient(ctx, scope) {
  if (!(await hasMaster(ctx, scope))) throw refusal(needMasterText(scope), 403);
  const gh = await githubFor(ctx, { owner: ctx.connection.default_account, cred: 'M' });
  const me = (await gh.request('GET /user')).data;
  if (!me?.id || !me?.login) throw refusal('The master token owner could not be read.');
  return { gh, login: me.login, id: me.id };
}

/** Same for read tools: a TypeError is shown to the person as written. */
export async function masterReader(ctx, scope, { identity = true } = {}) {
  if (!(await hasMaster(ctx, scope))) throw new TypeError(needMasterText(scope));
  if (!identity) return { gh: await githubFor(ctx, { owner: ctx.connection.default_account, cred: 'M' }) };
  return masterClient(ctx, scope);
}

export const userTarget = (kind) => (args, ctx) => ({ owner: String(ctx.connection.default_account), scope: 'user', kind });

// V-4 read-only forwarder listing: host names, events and bindings only; never a URL path, a secret or its ciphertext.
import { defineRead } from './define-read.js';
import { forwarderUrl } from '../dev/forward-sender.js';

const OWNER = { type: 'string', maxLength: 39 };
const list = defineRead({
  name: 'github_dev_list_forwarders', area: 'dev', audience: ['B'],
  description: 'List your webhook forwarders (host, events, run); signing secrets are never shown.',
  properties: { owner: OWNER },
  handler: async (args, ctx) => {
    const owner = String(args.owner ?? ctx.connection?.default_account ?? '');
    const account = ctx.connection?.accounts?.find((a) => a.toLowerCase() === owner.toLowerCase());
    if (!account) throw new TypeError('The account is not in this connection.');
    const rows = await ctx.db.listDevForwarders({ account, connection: ctx.connection.client_id, limit: 50 });
    const items = rows.map((r) => {
      let host = null;
      try { host = forwarderUrl(r.url).hostname; } catch { /* stored before a rule tightened: shown as unusable */ }
      return { id: r.id, host, usable: host !== null, events: r.events ?? [], run_id: r.run_id ?? null, repo: r.repo ?? null, created_at: r.created_at, last_used_at: r.last_used_at ?? null };
    });
    return { count: items.length, items };
  }
});
export const tools = [list.tool];
export const handlers = { [list.tool.name]: list.handler };

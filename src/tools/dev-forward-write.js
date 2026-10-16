// V-4: webhook deliveries replayed into an app under development, and test webhooks in scratch repositories.
// Safety shape: a forwarder is an account- and connection-scoped record whose signing secret is generated here, stored only as
// ciphertext and shown once on the setup page; a target is contacted only through the pinned, redirect-refusing sender; the
// change journal sees host names and counts, never a URL, a payload or a secret.
import { randomBytes } from 'node:crypto';
import { resolvePublicIpv4 } from '../github/public-url.js';
import { listAll } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { forwarderUrl, sendSigned } from '../dev/forward-sender.js';
import { forwarderKey as key, forwarderSecret, forwarderView as view, oneTimeStore as store, registerForwarder } from '../dev/forwarders.js';
import { MAX_FORWARDERS } from '../dev/ledger.js';
import { webhookLimit } from '../dev/scenario-ownership.js';
import { runDevMutationOnce } from '../dev/execute.js';
import { requireScratchOrg } from '../dev/scratch.js';
import { assertRunName, deniable, MAX_TEST_OBJECTS, previewOnly, TEST_NAME } from '../dev/test-refs.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const RUN = { type: 'string', minLength: 3, maxLength: 42, pattern: '^[a-z][a-z0-9-]{2,41}$' };
const FWD = { type: 'string', minLength: 20, maxLength: 20, pattern: '^fwd_[A-Za-z0-9_-]{16}$', description: 'Forwarder ID from github_dev_create_forwarder' };
const URL_ARG = { type: 'string', minLength: 12, maxLength: 2048, description: 'Public HTTPS address (port 443) of the app under development' };
const EVENTS = { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-zA-Z_*][a-zA-Z0-9_*-]*$' } };
const MAX_SENDS = 10, SEND_BUDGET_MS = 45_000;
const eq = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

const accountTarget = (args, ctx) => {
  previewOnly(ctx);
  return { owner: ownerOf(args, ctx), scope: 'account' };
};
const repoTarget = (args, ctx) => {
  previewOnly(ctx);
  return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' };
};
const scoped = (ctx, target) => ({ account: target.owner, connection: ctx.connection.client_id });
async function publicTarget(ctx, input) {
  const url = forwarderUrl(input);
  try { await resolvePublicIpv4(url.hostname); } catch { throw refusal('That address resolves to a private, reserved or unknown network address, so it was refused.'); }
  return url;
}
async function loadForwarder(ctx, target, id) {
  const row = await ctx.db.getDevForwarder({ id, ...scoped(ctx, target) });
  if (!row) throw refusal('No such forwarder on this account and connection.', 404);
  return row;
}
/** A forwarder bound to a run or repository can only act inside it; this is what refuses cross-run and cross-repository use. */
async function assertBinding(ctx, target, row, repo) {
  if (row.repo && !eq(row.repo, repo)) throw refusal('This forwarder is bound to a different repository.');
  if (row.run_id) {
    const run = await ctx.db.getDevRun({ id: row.run_id, ...scoped(ctx, target) });
    if (run?.status !== 'active') throw refusal('The run this forwarder belongs to is not active.');
    const objects = await ctx.db.listDevObjects({ runId: row.run_id, ...scoped(ctx, target), limit: 50 });
    if (!objects.some((o) => eq(o.repo, repo))) throw refusal('This forwarder belongs to a different run and may not be used for that repository.');
  }
}

// ---------------------------------------------------------------- forwarders
const createForwarder = defineGithubWrite({
  name: 'github_dev_create_forwarder', area: 'dev', audience: ['B'],
  description: 'Register a public HTTPS address of your app to receive replayed GitHub deliveries; a new signing secret is shown once.',
  properties: { owner: OWNER, url: URL_ARG, events: EVENTS, runId: RUN, repo: REPO },
  required: ['url'], declarations: { production: 'never' },
  target: accountTarget,
  read: (args, ctx, target) => deniable(async () => {
    key(ctx);
    const url = await publicTarget(ctx, args.url);
    if (args.runId) {
      assertRunName(args.runId);
      const run = await ctx.db.getDevRun({ id: args.runId, ...scoped(ctx, target) });
      if (run?.status !== 'active') throw refusal('That run does not exist for this connection or is no longer active.');
    }
    const existing = await ctx.db.listDevForwarders({ ...scoped(ctx, target), limit: 50 });
    if (existing.length >= MAX_FORWARDERS) throw refusal(`This connection already has ${MAX_FORWARDERS} forwarders; delete one first.`);
    return { host: url.hostname, events: args.events ?? [], count: existing.length };
  }),
  classify: () => ({}),
  summarize: ({ before }) => (before.denied ? `Cannot register the forwarder: ${before.denied}`
    : `Register a forwarder to ${before.host} (${before.events.length ? before.events.join(', ') : 'all events'}); a new signing secret is generated and shown once on the setup page. Nothing is sent to it now.`),
  apply: async ({ args, ctx, target, before }) => {
    if (before.denied) throw refusal(before.denied);
    return await registerForwarder(ctx, { ...scoped(ctx, target), url: args.url, events: args.events ?? [], runId: args.runId ?? null, repo: args.repo ?? null });
  },
  readAfter: async ({ ctx, target, response }) => {
    const row = await ctx.db.getDevForwarder({ id: response.id, ...scoped(ctx, target) });
    if (!row) return null;
    let secretReadable = false;
    try { secretReadable = forwarderSecret(ctx, row).length === 64; } catch { /* reported as unconfirmed */ }
    return { ...view(row), secret_readable: secretReadable };
  },
  verify: ({ args, after, response }) => !!after && after.id === response.id && after.secret_readable === true &&
    after.host === forwarderUrl(args.url).hostname && (args.events ?? []).length === after.events.length && (args.events ?? []).every((e) => after.events.includes(e)) &&
    after.run_id === (args.runId ?? null) && after.repo === (args.repo ?? null),
  inverse: () => null,
  present: ({ after, response }) => ({ forwarder_id: after.id, host: after.host, events: after.events, signing_secret_reveal: response.reveal, secret_expires_in_minutes: 10,
    note: 'Open the setup page link to copy the signing secret once; put it in your app as the webhook secret. It is never shown again.' })
});

const deleteForwarder = defineGithubWrite({
  name: 'github_dev_delete_forwarder', area: 'dev', audience: ['B'],
  description: 'Delete one of your forwarders and its stored signing secret.',
  properties: { owner: OWNER, forwarderId: FWD }, required: ['forwarderId'], declarations: { production: 'never', confirm: 'always' },
  target: accountTarget,
  read: (args, ctx, target) => deniable(async () => ({ forwarder: view(await loadForwarder(ctx, target, args.forwarderId)) })),
  classify: () => ({}),
  summarize: ({ before }) => (before.denied ? `Cannot delete the forwarder: ${before.denied}` : `Delete forwarder ${before.forwarder.id} (${before.forwarder.host}) and its signing secret; webhooks that already use that secret keep it, but replays to it stop.`),
  apply: async ({ args, ctx, target, before }) => {
    if (before.denied) throw refusal(before.denied);
    return { deleted: await ctx.db.deleteDevForwarder({ id: args.forwarderId, ...scoped(ctx, target) }) };
  },
  readAfter: async ({ args, ctx, target }) => ({ present: !!(await ctx.db.getDevForwarder({ id: args.forwarderId, ...scoped(ctx, target) })) }),
  verify: ({ after }) => after.present === false,
  inverse: () => null,
  present: ({ args }) => ({ deleted_forwarder_id: args.forwarderId })
});

// ---------------------------------------------------------------- forwarding
const hookRoute = '/repos/{owner}/{repo}/hooks/{hook_id}';
const deliveryList = async (gh, target, hookId) => (await listAll(gh, `GET ${hookRoute}/deliveries`, { owner: target.owner, repo: target.repo, hook_id: hookId, per_page: 100 }, { max: 100 })).items;
async function selectDeliveries(gh, target, args) {
  const filter = (d) => (!args.events || args.events.includes(d.event)) && (!args.since || (d.delivered_at && Date.parse(d.delivered_at) >= Date.parse(args.since)));
  if (args.deliveryIds) {
    const picked = [];
    for (const id of args.deliveryIds) {
      const d = await missing(async () => (await gh.request(`GET ${hookRoute}/deliveries/{delivery_id}`, { owner: target.owner, repo: target.repo, hook_id: args.hookId, delivery_id: id })).data);
      if (!d || d.id !== id || typeof d.event !== 'string') throw refusal(`Delivery ${id} was not found for that webhook.`, 404);
      picked.push({ id: d.id, event: d.event, guid: d.guid ?? null });
    }
    return picked;
  }
  const seen = new Set();
  const out = [];
  for (const d of await deliveryList(gh, target, args.hookId)) {
    if (!filter(d) || seen.has(d.guid)) continue; // newest first; a redelivery shares its original's guid
    seen.add(d.guid);
    out.push({ id: d.id, event: d.event, guid: d.guid ?? null });
    if (out.length >= (args.limit ?? 5)) break;
  }
  return out.reverse(); // send oldest first
}

const forwardDeliveries = defineGithubWrite({
  name: 'github_dev_forward_deliveries', area: 'dev', audience: ['B'],
  description: 'Re-send real past webhook deliveries to one of your forwarders, signed with its secret; reports each target status.',
  properties: { owner: OWNER, repo: REPO, forwarderId: FWD, hookId: { type: 'integer', minimum: 1 },
    deliveryIds: { type: 'array', minItems: 1, maxItems: MAX_SENDS, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
    since: { type: 'string', minLength: 10, maxLength: 40, description: 'Only deliveries at or after this date and time' }, events: EVENTS, limit: { type: 'integer', minimum: 1, maximum: MAX_SENDS } },
  required: ['repo', 'forwarderId', 'hookId'], declarations: { production: 'never' },
  target: (args, ctx) => {
    const t = repoTarget(args, ctx);
    if ([args.deliveryIds, args.since].filter((v) => v !== undefined).length > 1) throw new TypeError('Give deliveryIds or since, not both.');
    if (args.since !== undefined && Number.isNaN(Date.parse(args.since))) throw new TypeError('since must be a date and time.');
    return t;
  },
  read: (args, ctx, target) => deniable(async () => {
    const row = await loadForwarder(ctx, target, args.forwarderId);
    await assertBinding(ctx, target, row, target.repo);
    const gh = await octo(ctx, target.owner);
    const hook = await missing(async () => (await gh.request(`GET ${hookRoute}`, { owner: target.owner, repo: target.repo, hook_id: args.hookId })).data);
    if (!hook || hook.id !== args.hookId) throw refusal('That webhook does not exist on this repository.', 404);
    // A forwarder's own event list narrows the search itself, so the limit counts only deliveries it would accept.
    const events = row.events?.length ? (args.events ? args.events.filter((e) => row.events.includes(e)) : row.events) : args.events;
    const wanted = events?.length === 0 ? [] : await selectDeliveries(gh, target, { ...args, events });
    const allowed = row.events?.length ? wanted.filter((d) => row.events.includes(d.event)) : wanted;
    if (!allowed.length) throw refusal(wanted.length ? 'Every matching delivery is an event this forwarder does not subscribe to.' : 'No matching deliveries were found for that webhook.', 404);
    return { forwarder: view(row), hook_id: hook.id, selected: allowed, skipped_by_event: wanted.length - allowed.length };
  }),
  classify: () => ({}),
  summarize: ({ args, target, before }) => {
    if (before.denied) return `Cannot forward deliveries: ${before.denied}`;
    const n = before.selected.length;
    return `Re-send ${n} real GitHub ${n === 1 ? 'delivery' : 'deliveries'} from webhook #${args.hookId} of ${slug(target.owner, target.repo)} to ${before.forwarder.host}, each with a fresh delivery ID and a signature made with the forwarder's secret. A send that times out is never repeated.`;
  },
  apply: async ({ args, ctx, target, before }) => {
    if (before.denied) throw refusal(before.denied);
    const row = await loadForwarder(ctx, target, args.forwarderId);
    await assertBinding(ctx, target, row, target.repo);
    const secret = forwarderSecret(ctx, row);
    const gh = await octo(ctx, target.owner);
    const started = (ctx.now ?? Date.now)();
    const results = [];
    for (const d of before.selected) {
      if ((ctx.now ?? Date.now)() - started > SEND_BUDGET_MS) { results.push({ delivery_id: d.id, event: d.event, outcome: 'not_attempted', reason: 'Time budget used up; run again for the rest.' }); continue; }
      const detail = (await gh.request(`GET ${hookRoute}/deliveries/{delivery_id}`, { owner: target.owner, repo: target.repo, hook_id: args.hookId, delivery_id: d.id })).data;
      const payload = detail?.request?.payload;
      if (detail?.id !== d.id || detail.event !== d.event || payload === null || typeof payload !== 'object') {
        results.push({ delivery_id: d.id, event: d.event, outcome: 'not_attempted', reason: 'GitHub did not return the original payload.' });
        continue;
      }
      const sent = await sendSigned({ url: row.url, event: d.event, body: JSON.stringify(payload), secret });
      results.push({ delivery_id: d.id, event: d.event, outcome: sent.outcome, ...(sent.status ? { status: sent.status } : {}), ...(sent.reason ? { reason: sent.reason } : {}) });
    }
    return { results };
  },
  readAfter: async ({ args, ctx, target, response }) => ({ results: response.results, recorded: await ctx.db.touchDevForwarder({ id: args.forwarderId, ...scoped(ctx, target) }) }),
  verify: ({ before, after }) => after.recorded === true && after.results.length === before.selected.length && after.results.every((r) => typeof r.outcome === 'string'),
  inverse: () => null,
  present: ({ args, target, before, after }) => ({
    forwarder_id: args.forwarderId, host: before.forwarder.host, repo: slug(target.owner, target.repo), hook_id: args.hookId,
    delivered: after.results.filter((r) => r.outcome === 'delivered').length,
    needs_attention: after.results.filter((r) => r.outcome !== 'delivered').length,
    skipped_by_event: before.skipped_by_event, results: after.results,
    note: 'A timeout is not retried: the target may have received it. Look at your app, then forward again only if it did not.'
  })
});

// ---------------------------------------------------------------- test webhooks
const hookView = (hook) => {
  let host = null;
  try { host = forwarderUrl(hook?.config?.url).hostname; } catch { /* leave null: unsafe or unreadable */ }
  return { id: hook?.id, active: hook?.active === true, events: Array.isArray(hook?.events) ? hook.events : [], host,
    secure_tls: String(hook?.config?.insecure_ssl ?? '0') !== '1', content_type: hook?.config?.content_type ?? null };
};
const createTestWebhook = defineGithubWrite({
  name: 'github_dev_create_test_webhook', area: 'dev', audience: ['B'],
  description: 'Add a webhook to a scratch repository of your run, pointing at a forwarder or your app address.',
  properties: { owner: OWNER, repo: REPO, runId: RUN, name: { type: 'string', minLength: 1, maxLength: 41, pattern: '^[a-z][a-z0-9-]{0,40}$' },
    forwarderId: FWD, url: URL_ARG, events: { ...EVENTS, description: 'Default: push and pull_request' } },
  required: ['repo', 'runId', 'name'], declarations: { production: 'never' },
  target: (args, ctx) => {
    const t = repoTarget(args, ctx);
    assertRunName(args.runId);
    if (!TEST_NAME.test(args.name ?? '')) throw new TypeError('A short lowercase test name is required.');
    if (Boolean(args.forwarderId) === Boolean(args.url)) throw new TypeError('Give exactly one of forwarderId or url.');
    return t;
  },
  read: (args, ctx, target) => deniable(async () => {
    await requireScratchOrg(ctx, target.owner);
    const scope = scoped(ctx, target);
    const run = await ctx.db.getDevRun({ id: args.runId, ...scope });
    if (run?.status !== 'active') throw refusal('That run does not exist for this connection or is no longer active.');
    const objects = await ctx.db.listDevObjects({ runId: args.runId, ...scope, limit: 50 });
    if (!objects.some((o) => o.object_type === 'repo' && eq(o.repo, target.repo))) throw refusal('Test webhooks go only in the scratch repository this run created.');
    if (objects.length + 1 > MAX_TEST_OBJECTS) throw refusal(`A run holds at most ${MAX_TEST_OBJECTS} recorded objects; start a new run.`);
    const allowed = run.scenarios?.length === 1 ? webhookLimit(run.scenarios[0]) : 0;
    if (objects.filter((o) => o.object_type === 'webhook').length >= allowed) throw refusal(`This run may hold at most ${allowed} test webhook${allowed === 1 ? '' : 's'}.`);
    let host;
    if (args.forwarderId) {
      const row = await loadForwarder(ctx, target, args.forwarderId);
      if (row.run_id && row.run_id !== args.runId) throw refusal('This forwarder belongs to a different run.');
      if (row.repo && !eq(row.repo, target.repo)) throw refusal('This forwarder is bound to a different repository.');
      host = forwarderUrl(row.url).hostname;
    } else host = (await publicTarget(ctx, args.url)).hostname;
    key(ctx);
    return { host, source: args.forwarderId ? 'forwarder' : 'url', events: args.events ?? ['push', 'pull_request'] };
  }),
  classify: () => ({}),
  summarize: ({ args, target, before }) => (before.denied ? `Cannot create the test webhook: ${before.denied}`
    : `Create webhook "${args.name}" on scratch repository ${slug(target.owner, target.repo)} sending ${before.events.join(', ')} to ${before.host}; it is recorded in run ${args.runId} and removed with the scratch repository by github_dev_cleanup.`
      + (before.source === 'forwarder' ? " It uses the forwarder's signing secret." : ' A new signing secret is generated and shown once.')),
  apply: async ({ args, ctx, target, before }) => {
    if (before.denied) throw refusal(before.denied);
    let url; let secret; let reveal = null;
    if (args.forwarderId) {
      const row = await loadForwarder(ctx, target, args.forwarderId);
      url = row.url;
      secret = forwarderSecret(ctx, row);
    } else {
      url = forwarderUrl(args.url).toString();
      secret = randomBytes(32).toString('hex');
      reveal = (await store(ctx).issue({ account: target.owner, kind: 'github-webhook-signing-secret', secret })).setupPath;
    }
    const gh = await octo(ctx, target.owner);
    const hook = await runDevMutationOnce(ctx, {
      runId: args.runId, account: target.owner, connection: ctx.connection.client_id, stepId: `test-webhook-${args.name}`, type: 'webhook',
      owner: target.owner, repo: target.repo, objectName: args.name,
      create: async () => {
        const created = (await gh.request('POST /repos/{owner}/{repo}/hooks', { owner: target.owner, repo: target.repo, name: 'web', active: true,
          events: before.events, config: { url, content_type: 'json', secret, insecure_ssl: '0' } })).data;
        if (!Number.isSafeInteger(created?.id) || created.id < 1) throw refusal('GitHub accepted the webhook but returned no exact ID; check the repository before retrying.');
        return { objectId: String(created.id) };
      }
    });
    return { hook_id: Number(hook.objectId), reveal: hook.replayed ? null : reveal, replayed: hook.replayed === true };
  },
  readAfter: async ({ args, ctx, target, response }) => {
    const gh = await octo(ctx, target.owner);
    const hook = await gh.request(`GET ${hookRoute}`, { owner: target.owner, repo: target.repo, hook_id: response.hook_id });
    const objects = await ctx.db.listDevObjects({ runId: args.runId, ...scoped(ctx, target), limit: 50 });
    return { hook: hookView(hook.data), recorded: objects.some((o) => o.object_type === 'webhook' && o.object_id === String(response.hook_id) && eq(o.repo, target.repo)) };
  },
  verify: ({ before, after, response }) => after.recorded === true && after.hook.id === response.hook_id && after.hook.active === true && after.hook.secure_tls === true &&
    after.hook.host === before.host && after.hook.events.length === before.events.length && before.events.every((e) => after.hook.events.includes(e)),
  inverse: () => null,
  present: ({ args, target, before, after, response }) => ({ run_id: args.runId, repo: slug(target.owner, target.repo), hook_id: response.hook_id, host: after.hook.host, events: after.hook.events,
    secret_source: before.source === 'forwarder' ? 'the forwarder' : 'new', signing_secret_reveal: response.reveal, recorded: true, replayed: response.replayed })
});

export const tools = [createForwarder.tool, deleteForwarder.tool, forwardDeliveries.tool, createTestWebhook.tool];
export const handlers = Object.fromEntries([createForwarder, deleteForwarder, forwardDeliveries, createTestWebhook].map((d) => [d.tool.name, d.handler]));

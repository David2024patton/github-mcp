import { afterEach, describe, expect, it, vi } from 'vitest';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { Webhooks } from '@octokit/webhooks';
import { makeWorld, parse, runWriteContract } from '../../test/helpers/write-contract.js';
import { runDevMutationOnce } from '../../src/dev/execute.js';
import { createOneTimeStore } from '../../src/core/one-time-secrets.js';
import { decryptSecret, encryptSecret, readEncryptionKey } from '../../src/core/crypto.js';
import * as forward from '../../src/tools/dev-forward-write.js';
import * as forwardRead from '../../src/tools/dev-forward-read.js';

// DNS: every name resolves to a public address except the one named "rebind", which resolves to the metadata address.
vi.mock('node:dns/promises', () => ({ lookup: async (host) => [{ address: host.startsWith('rebind') ? '169.254.169.254' : '8.8.8.8', family: 4 }] }));

const OWNER = 'example-org', REPO = 'scratch-repo', RUN = 'run-fwd-101', OTHER_RUN = 'run-fwd-202';
const FID = 'fwd_AAAAAAAAAAAAAAAA', FID2 = 'fwd_BBBBBBBBBBBBBBBB';
const TARGET = 'https://app.example.org/hooks/github?token=abc';
const def = (name) => ({ tool: forward.tools.find((t) => t.name === name), handler: forward.handlers[name] });
const create = def('github_dev_create_forwarder'), del = def('github_dev_delete_forwarder'), send = def('github_dev_forward_deliveries'), hook = def('github_dev_create_test_webhook');
const list = { tool: forwardRead.tools[0], handler: forwardRead.handlers.github_dev_list_forwarders };
const scope = { account: OWNER, connection: 'client-1' };

// The outbound sender is the only network user: replace https.request and record what each call would have sent.
let sent = [];
function targetBehaviour(behaviour = () => ({ status: 200 })) {
  sent = [];
  vi.spyOn(https, 'request').mockImplementation((url, options, callback) => {
    const req = new EventEmitter();
    req.end = (body) => queueMicrotask(() => {
      const record = { host: url.hostname, headers: options.headers, body: body.toString('utf8') };
      sent.push(record);
      const result = behaviour(record);
      if (result.error) return req.emit('error', result.error);
      const response = Readable.from(['ok']);
      response.statusCode = result.status;
      callback(response);
    });
    return req;
  });
}
afterEach(() => vi.restoreAllMocks());

async function addForwarder(w, { id = FID, url = TARGET, events = [], runId = null, repo = null, secret = 'a'.repeat(64) } = {}) {
  const key = readEncryptionKey(w.ctx.env);
  await w.db.createDevForwarder({ id, ...scope, url, events, secretEnc: encryptSecret(secret, { aad: `github-forwarder/${id}/${OWNER}/client-1`, key }), runId, repo });
  return secret;
}
const revealedSecret = async (w, out) => {
  const id = new URL(out.result.signing_secret_reveal, 'https://setup.invalid').searchParams.get('show');
  return (await createOneTimeStore({ db: w.db, service: 'github', setupPath: '/api/github/setup', encryptionKey: readEncryptionKey(w.ctx.env) }).consume(id))?.secret;
};
const mismatchSeam = (gh, replies) => { gh.mismatch = replies === 'mismatch'; };

// ---- create
runWriteContract({ label: 'github_dev_create_forwarder', definition: create, args: { url: TARGET, events: ['push'] }, previewOnly: true, needsConfirm: false, expectedWrites: 0,
  arrange: mismatchSeam, prepare: (w) => {
    if (!w.gh.mismatch) return;
    const real = w.db.getDevForwarder;
    w.db.getDevForwarder = async (a) => { const row = await real(a); return row && { ...row, url: 'https://elsewhere.example.org/x' }; };
  } });

// ---- delete
runWriteContract({ label: 'github_dev_delete_forwarder', definition: del, args: { forwarderId: FID }, previewOnly: true, needsConfirm: true, expectedWrites: 0,
  arrange: mismatchSeam, prepare: async (w) => { await addForwarder(w); if (w.gh.mismatch) w.db.deleteDevForwarder = async () => true; } });

// ---- forward
const delivery = (id, event = 'push') => ({ id, guid: `guid-${id}`, event, delivered_at: `2026-10-1${id % 10}T10:00:00Z`, redelivery: false, request: { headers: {}, payload: { zen: 'Keep it logically awesome', event, id } } });
function arrangeForward(gh, deliveries = [delivery(11)]) {
  gh.mismatch = false;
  gh.when('GET /repos/{owner}/{repo}/hooks/{hook_id}').reply(200, { id: 5, name: 'web', active: true, events: ['push'], config: { url: 'https://app.example.org/h', content_type: 'json' } });
  gh.when('GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}').reply(200, (req) => deliveries.find((d) => d.id === Number(req.params?.delivery_id)) ?? deliveries[0]);
  gh.when('GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries').reply(200, deliveries.map((d) => ({ id: d.id, guid: d.guid, event: d.event, delivered_at: d.delivered_at, redelivery: d.redelivery })));
}
runWriteContract({ label: 'github_dev_forward_deliveries', definition: send, args: { repo: REPO, forwarderId: FID, hookId: 5, deliveryIds: [11] }, previewOnly: true, needsConfirm: false, expectedWrites: 0,
  arrange: (gh, replies) => { arrangeForward(gh); gh.mismatch = replies === 'mismatch'; },
  prepare: async (w) => { targetBehaviour(); await addForwarder(w); if (w.gh.mismatch) w.db.touchDevForwarder = async () => false; } });

// ---- test webhook
const hookBody = (changes = {}) => ({ id: 700, name: 'web', type: 'Repository', active: true, events: ['push', 'pull_request'], config: { url: TARGET, content_type: 'json', insecure_ssl: '0' }, ...changes });
const arrangeHook = (gh, replies) => {
  gh.when('POST /repos/{owner}/{repo}/hooks').reply(201, hookBody());
  gh.when('GET /repos/{owner}/{repo}/hooks/{hook_id}').reply(200, hookBody(replies === 'mismatch' ? { active: false } : {}));
};
const scratchRun = (w, runId = RUN) => runDevMutationOnce(w.ctx, { runId, account: OWNER, connection: 'client-1', stepId: 'create-scratch-repo', type: 'repo', owner: OWNER, repo: REPO, objectName: REPO, scenarios: ['repo-basic'],
  create: async () => ({ objectId: `${OWNER}/${REPO}` }) });
runWriteContract({ label: 'github_dev_create_test_webhook', definition: hook, args: { repo: REPO, runId: RUN, name: 'hook', forwarderId: FID }, scratchAccount: true, previewOnly: true, needsConfirm: false,
  arrange: arrangeHook, prepare: async (w) => { await scratchRun(w); await addForwarder(w, { runId: RUN }); } });

const call = async (d, w, args) => (d === list ? d.handler(args, w.ctx) : parse(await d.handler(args, w.ctx)));
describe('V-4 forwarder registration', () => {
  it('shows the secret once, keeps it out of every result, journal row and stored column, and the secret really signs', async () => {
    const w = await makeWorld();
    const out = await call(create, w, { url: TARGET, events: ['push'], confirm: true });
    expect(out.status).toBe('applied');
    const secret = await revealedSecret(w, out);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await revealedSecret(w, out)).toBeUndefined();
        const stored = await w.db.getDevForwarder({ id: out.result.forwarder_id, ...scope });
    const everything = JSON.stringify([out, await call(list, w, {}), await w.db.getChange(1), await w.db.getChange(2)]);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain('token=abc');
    expect(stored.secret_enc).not.toContain(secret);
    expect(decryptSecret(stored.secret_enc, { aad: `github-forwarder/${stored.id}/${OWNER}/client-1`, key: readEncryptionKey(w.ctx.env) })).toBe(secret);
    // The same secret signs forwarded deliveries (end to end).
    arrangeForward(w.gh);
    targetBehaviour();
    const forwarded = await call(send, w, { repo: REPO, forwarderId: stored.id, hookId: 5, deliveryIds: [11], confirm: true });
    expect(forwarded.result).toMatchObject({ delivered: 1, needs_attention: 0 });
    expect(await new Webhooks({ secret }).verify(sent[0].body, sent[0].headers['X-Hub-Signature-256'])).toBe(true);
    expect(JSON.stringify(forwarded)).not.toContain(secret);
  });
  it('refuses private, plain, local and credentialed addresses, and a name that resolves to a private address', async () => {
    for (const url of ['http://app.example.org/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://u:p@app.example.org/x', 'https://169.254.169.254/x', 'https://rebind.example.org/x']) {
      const w = await makeWorld();
      const out = await call(create, w, { url, confirm: true });
      expect(out.done).toBe(false);
      expect(await w.db.listDevForwarders({ ...scope })).toEqual([]);
      expect(JSON.stringify(out)).not.toContain('169.254');
    }
    const w = await makeWorld();
    const dns = await call(create, w, { url: 'https://rebind.example.org/x', dryRun: true });
    expect(dns.preview).toMatch(/private, reserved|resolves/);
  });
  it('holds at most 20 per connection, and only the caller sees them', async () => {
    const w = await makeWorld({ accounts: ['example-org', 'other-org'] });
    for (let i = 0; i < 20; i += 1) await addForwarder(w, { id: `fwd_${String(i).padStart(16, 'c')}` });
    const out = await call(create, w, { url: TARGET, confirm: true });
    expect(out.done).toBe(false);
    expect((await call(list, w, {})).count).toBe(20);
    expect((await call(list, w, { owner: 'other-org' })).count).toBe(0);
    expect(await w.db.createDevForwarder({ id: 'fwd_DDDDDDDDDDDDDDDD', ...scope, url: TARGET, events: [], secretEnc: 'x'.repeat(30) })).toBe(false);
  });
  it('binds an optional run, and refuses a run that does not exist', async () => {
    const w = await makeWorld();
    expect((await call(create, w, { url: TARGET, runId: RUN, confirm: true })).done).toBe(false);
    await scratchRun(w);
    const ok = await call(create, w, { url: TARGET, runId: RUN, repo: REPO, confirm: true });
    expect(ok.status).toBe('applied');
    expect(await w.db.getDevForwarder({ id: ok.result.forwarder_id, ...scope })).toMatchObject({ run_id: RUN, repo: REPO });
  });
  it('refuses production connections before touching anything', async () => {
    const w = await makeWorld({ mode: 'production' });
    expect((await create.handler({ url: TARGET, confirm: true }, w.ctx)).isError).toBe(true);
    expect(await w.db.listDevForwarders({ ...scope })).toEqual([]);
  });
});

describe('V-4 listing and deleting', () => {
  it('lists host names only and deletes exactly one forwarder', async () => {
    const w = await makeWorld();
    await addForwarder(w); await addForwarder(w, { id: FID2, events: ['push'] });
    const items = (await call(list, w, {})).items;
    expect(items.map((i) => i.host)).toEqual(['app.example.org', 'app.example.org']);
    expect(JSON.stringify(items)).not.toMatch(/token=abc|secret_enc|https:/);
    expect((await call(del, w, { forwarderId: FID, confirm: true })).status).toBe('applied');
    expect((await call(list, w, {})).items.map((i) => i.id)).toEqual([FID2]);
    expect((await call(del, w, { forwarderId: FID, confirm: true })).status).toBe('replayed');
    expect((await call(del, w, { forwarderId: 'fwd_ZZZZZZZZZZZZZZZZ', confirm: true })).done).toBe(false);
  });
  it("cannot touch another account's forwarder", async () => {
    const w = await makeWorld({ accounts: ['example-org', 'other-org'] });
    await addForwarder(w);
    expect((await call(del, w, { owner: 'other-org', forwarderId: FID, confirm: true })).done).toBe(false);
    expect(await w.db.getDevForwarder({ id: FID, ...scope })).not.toBeNull();
  });
});

describe('V-4 forwarding deliveries', () => {
  const base = { repo: REPO, forwarderId: FID, hookId: 5 };
  it('reports each target status, never repeats a timeout, and keeps payloads out of the journal', async () => {
    const w = await makeWorld();
    await addForwarder(w);
    arrangeForward(w.gh, [delivery(11), delivery(12), delivery(13)]);
    targetBehaviour((r) => (JSON.parse(r.body).id === 12 ? { status: 500 } : JSON.parse(r.body).id === 13 ? { error: Object.assign(new Error('x'), { name: 'AbortError' }) } : { status: 200 }));
    const out = await call(send, w, { ...base, deliveryIds: [11, 12, 13], confirm: true });
    expect(out.result.results.map((r) => r.outcome)).toEqual(['delivered', 'rejected_by_target', 'timeout_unconfirmed']);
    expect(out.result).toMatchObject({ delivered: 1, needs_attention: 2 });
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((s) => s.headers['X-GitHub-Delivery'])).size).toBe(3);
    expect(sent[0].headers['X-GitHub-Event']).toBe('push');
    expect(JSON.stringify(await w.db.getChange(1))).not.toContain('Keep it logically awesome');
    const again = await call(send, w, { ...base, deliveryIds: [11, 12, 13], confirm: true });
    expect(again.status).toBe('replayed');
    expect(sent).toHaveLength(3);
  });
  it('selects by since and events, newest ones first limited, oldest sent first, skipping events the forwarder does not subscribe to', async () => {
    const w = await makeWorld();
    await addForwarder(w, { events: ['push'] });
    arrangeForward(w.gh, [delivery(18, 'push'), delivery(17, 'pull_request'), delivery(16, 'push'), delivery(15, 'push')]);
    targetBehaviour();
    const out = await call(send, w, { ...base, since: '2026-10-16T00:00:00Z', limit: 2, confirm: true });
    expect(out.result.results.map((r) => r.delivery_id)).toEqual([16, 18]);
    const explicit = await call(send, w, { ...base, deliveryIds: [16, 17], confirm: true });
    expect(explicit.result.results.map((r) => r.delivery_id)).toEqual([16]);
    expect(explicit.result.skipped_by_event).toBe(1);
    const none = await call(send, w, { ...base, events: ['issues'], confirm: true });
    expect(none.done).toBe(false);
  });
  it('refuses another account, an unknown webhook or delivery, and a forwarder bound to another repository or run', async () => {
    const w = await makeWorld({ accounts: ['example-org', 'other-org'] });
    await addForwarder(w);
    arrangeForward(w.gh);
    targetBehaviour();
    expect((await call(send, w, { owner: 'other-org', ...base, deliveryIds: [11], confirm: true })).done).toBe(false);
    w.gh.when('GET /repos/{owner}/{repo}/hooks/{hook_id}').reply(404, { message: 'Not Found' });
    expect((await call(send, w, { ...base, deliveryIds: [11], confirm: true })).done).toBe(false);
    const bound = await makeWorld();
    await addForwarder(bound, { repo: 'another-repo' });
    arrangeForward(bound.gh);
    targetBehaviour();
    expect((await call(send, bound, { ...base, deliveryIds: [11], confirm: true })).done).toBe(false);
    const run = await makeWorld();
    await scratchRun(run, OTHER_RUN);
    await addForwarder(run, { runId: RUN });
    arrangeForward(run.gh);
    targetBehaviour();
    expect((await call(send, run, { ...base, deliveryIds: [11], confirm: true })).done).toBe(false);
    expect(sent).toEqual([]);
  });
  it('refuses a stored target that no longer passes the address rules, sending nothing', async () => {
    const w = await makeWorld();
    await addForwarder(w, { url: 'https://rebind.example.org/hook' });
    arrangeForward(w.gh);
    targetBehaviour();
    const out = await call(send, w, { ...base, deliveryIds: [11], confirm: true });
    expect(out.result.results[0].outcome).toBe('blocked');
    expect(sent).toEqual([]);
  });
});

describe('V-4 test webhooks', () => {
  it('works only in the verified scratch organization, in the repository this run created', async () => {
    const plain = await makeWorld();
    await addForwarder(plain);
    expect((await call(hook, plain, { repo: REPO, runId: RUN, name: 'hook', forwarderId: FID, confirm: true })).done).toBe(false);
    const w = await makeWorld({ scratchAccount: true });
    arrangeHook(w.gh);
    await addForwarder(w);
    expect((await call(hook, w, { repo: REPO, runId: RUN, name: 'hook', forwarderId: FID, confirm: true })).done).toBe(false);
    await scratchRun(w);
    expect((await call(hook, w, { repo: 'some-other-repo', runId: RUN, name: 'hook', forwarderId: FID, confirm: true })).done).toBe(false);
    expect(w.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
  it("signs with the forwarder's secret, records the hook for cleanup, and refuses a forwarder of another run", async () => {
    const w = await makeWorld({ scratchAccount: true });
    arrangeHook(w.gh);
    await scratchRun(w);
    const secret = await addForwarder(w, { runId: RUN });
    const out = await call(hook, w, { repo: REPO, runId: RUN, name: 'hook', forwarderId: FID, confirm: true });
    expect(out).toMatchObject({ status: 'applied', result: { hook_id: 700, secret_source: 'the forwarder', signing_secret_reveal: null, recorded: true } });
    expect(w.gh.calls.find((c) => c.route === 'POST /repos/{owner}/{repo}/hooks').body.config).toMatchObject({ secret, url: TARGET, insecure_ssl: '0', content_type: 'json' });
    expect(JSON.stringify(out)).not.toContain(secret);
    expect((await w.db.listDevObjects({ ...scope, runId: RUN, limit: 50 })).some((o) => o.object_type === 'webhook' && o.object_id === '700')).toBe(true);
    const foreign = await makeWorld({ scratchAccount: true });
    arrangeHook(foreign.gh);
    await scratchRun(foreign);
    await addForwarder(foreign, { runId: OTHER_RUN });
    expect((await call(hook, foreign, { repo: REPO, runId: RUN, name: 'hook', forwarderId: FID, confirm: true })).done).toBe(false);
    expect(foreign.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
  it('generates and reveals a new secret for a plain app address, and never reveals it again on a replayed step', async () => {
    const w = await makeWorld({ scratchAccount: true });
    arrangeHook(w.gh);
    await scratchRun(w);
    const out = await call(hook, w, { repo: REPO, runId: RUN, name: 'hook', url: TARGET, events: ['push'], confirm: true });
    expect(out.result.signing_secret_reveal).toMatch(/^\/api\/github\/setup\?show=/);
    const secret = await revealedSecret(w, out);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(w.gh.calls.find((c) => c.route === 'POST /repos/{owner}/{repo}/hooks').body.config.secret).toBe(secret);
    expect(JSON.stringify(out)).not.toContain(secret);
    expect((await call(hook, w, { repo: REPO, runId: RUN, name: 'hook', url: 'https://rebind.example.org/x', confirm: true })).done).toBe(false);
  });
  it('allows at most three per run and needs exactly one of forwarderId or url', async () => {
    const w = await makeWorld({ scratchAccount: true });
    arrangeHook(w.gh);
    await scratchRun(w);
    for (let i = 0; i < 3; i += 1) await runDevMutationOnce(w.ctx, { runId: RUN, account: OWNER, connection: 'client-1', stepId: `h${i}`, type: 'webhook', owner: OWNER, repo: REPO, objectName: `h${i}`, create: async () => ({ objectId: String(800 + i) }) });
    expect((await call(hook, w, { repo: REPO, runId: RUN, name: 'hook', url: TARGET, confirm: true })).done).toBe(false);
    expect((await call(hook, w, { repo: REPO, runId: RUN, name: 'hook', confirm: true })).done).toBe(false);
    expect((await call(hook, w, { repo: REPO, runId: RUN, name: 'hook', url: TARGET, forwarderId: FID, confirm: true })).done).toBe(false);
  });
});

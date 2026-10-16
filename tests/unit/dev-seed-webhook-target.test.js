import { describe, expect, it, vi } from 'vitest';
import { makeWorld, parse, runWriteContract } from '../../test/helpers/write-contract.js';
import { createOneTimeStore } from '../../src/core/one-time-secrets.js';
import { readEncryptionKey } from '../../src/core/crypto.js';
import * as seeded from '../../src/tools/dev-seed-write.js';

vi.mock('node:dns/promises', () => ({ lookup: async (host) => [{ address: host.startsWith('rebind') ? '10.1.2.3' : '8.8.8.8', family: 4 }] }));

const ID = 'run-hooked-101', REPO = 'hook-demo', OWNER = 'example-org', COMMIT = 'b'.repeat(40), TARGET = 'https://app.example.org/hooks/github?token=abc';
const MARK = `rtc_run=${ID}`;
const def = { tool: seeded.tools[0], handler: seeded.handlers.github_dev_seed };
const repository = (v = {}) => ({ full_name: `${OWNER}/${REPO}`, private: true, description: `Developer fixture for ${MARK} (webhook-target)`, default_branch: 'main', ...v });
const hookBody = (v = {}) => ({ id: 901, name: 'web', type: 'Repository', active: true, events: ['push', 'pull_request'], config: { url: TARGET, content_type: 'json', insecure_ssl: '0' }, ...v });
const arrange = (gh, outcome) => {
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    { status: 404, body: { message: 'Not Found' } },
    { status: 200, body: repository(outcome === 'mismatch' ? { private: false } : {}) },
    { status: 200, body: repository() }
  ]);
  gh.when('POST /orgs/{org}/repos').reply(201, repository());
  gh.when('GET /repos/{owner}/{repo}/labels').reply(200, []);
  gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, (request) => ({ ref: `refs/${request.params.ref}`, object: { sha: COMMIT } }));
  gh.when('POST /repos/{owner}/{repo}/hooks').reply(201, hookBody());
  gh.when('GET /repos/{owner}/{repo}/hooks/{hook_id}').reply(200, hookBody());
};
runWriteContract({ label: 'github_dev_seed(webhook-target)', definition: def, args: { repo: REPO, runId: ID, scenario: 'webhook-target', url: TARGET }, arrange,
  scratchAccount: true, previewOnly: true, needsConfirm: false, expectedWrites: 2 });

describe('V-1 webhook-target scenario', () => {
  it('creates the repository, a run-bound forwarder and a test webhook signed with the forwarder secret, and records all three', async () => {
    const w = await makeWorld({ scratchAccount: true });
    arrange(w.gh, 'ok');
    const out = parse(await def.handler({ repo: REPO, runId: ID, scenario: 'webhook-target', url: TARGET, confirm: true }, w.ctx));
    expect(out).toMatchObject({ status: 'applied', done: true, confirmed: true });
    const objects = await w.db.listDevObjects({ runId: ID, account: OWNER, connection: 'client-1', limit: 50 });
    expect(objects.map((o) => o.object_type).sort()).toEqual(['forwarder', 'repo', 'webhook']);
    expect(objects.every((o) => o.repo === REPO)).toBe(true);
    const forwarders = await w.db.listDevForwarders({ account: OWNER, connection: 'client-1' });
    expect(forwarders).toHaveLength(1);
    expect(forwarders[0]).toMatchObject({ run_id: ID, repo: REPO, events: ['push', 'pull_request'] });
    const show = new URL(out.result.signing_secret_reveal, 'https://setup.invalid').searchParams.get('show');
    const secret = (await createOneTimeStore({ db: w.db, service: 'github', setupPath: '/api/github/setup', encryptionKey: readEncryptionKey(w.ctx.env) }).consume(show)).secret;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(w.gh.calls.find((c) => c.route === 'POST /repos/{owner}/{repo}/hooks').body.config).toMatchObject({ secret, url: TARGET, insecure_ssl: '0', content_type: 'json' });
    expect(JSON.stringify([out, await w.db.getChange(1), await w.db.getChange(2)])).not.toContain(secret);
    expect(JSON.stringify([out, await w.db.getChange(1), await w.db.getChange(2)])).not.toContain('token=abc');
    for (const step of ['seed-repo', 'seed-forwarder', 'seed-test-hook']) {
      expect(await w.db.getDevIntent({ runId: ID, account: OWNER, connection: 'client-1', stepId: step })).toMatchObject({ status: 'recorded' });
    }
    expect(w.gh.invalid).toEqual([]);
  });
  it('needs an address for this scenario only, and refuses private, plain and name-rebinding addresses without any GitHub call', async () => {
    const w = await makeWorld({ scratchAccount: true });
    arrange(w.gh, 'ok');
    for (const args of [{ scenario: 'webhook-target' }, { scenario: 'repo-basic', url: TARGET }, { scenario: 'webhook-target', url: 'http://app.example.org/x' },
      { scenario: 'webhook-target', url: 'https://10.0.0.5/x' }, { scenario: 'webhook-target', url: 'https://rebind.example.org/x' }]) {
      expect(parse(await def.handler({ repo: REPO, runId: ID, confirm: true, ...args }, w.ctx)).done).toBe(false);
    }
    expect(w.gh.calls).toEqual([]);
    expect(await w.db.listDevForwarders({ account: OWNER, connection: 'client-1' })).toEqual([]);
  });
  it('is held to its planned objects: no second test webhook can be added to the run', async () => {
    const w = await makeWorld({ scratchAccount: true });
    arrange(w.gh, 'ok');
    await def.handler({ repo: REPO, runId: ID, scenario: 'webhook-target', url: TARGET, confirm: true }, w.ctx);
    const hook = (await import('../../src/tools/dev-forward-write.js')).handlers.github_dev_create_test_webhook;
    const second = parse(await hook({ repo: REPO, runId: ID, name: 'extra', url: TARGET, confirm: true }, w.ctx));
    expect(second.done).toBe(false);
    expect(w.gh.calls.filter((c) => c.route === 'POST /repos/{owner}/{repo}/hooks')).toHaveLength(1);
  });
});

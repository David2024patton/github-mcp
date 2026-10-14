import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as transfer from '../../src/tools/issues-transfer-write.js';

const SOURCE = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
const DEST = 'GET /repos/{owner}/{repo}';
const NODE = 'I_source_7';
const ORIGIN = 'https://api.github.com/repos/example-org/dest';
const source = { number: 7, node_id: NODE, title: 'Transfer me', state: 'open' };
const destination = { node_id: 'R_destination', full_name: 'example-org/dest', has_issues: true };
const moved = (extras = {}) => ({ number: 12, node_id: NODE, repository_url: ORIGIN,
  html_url: 'https://github.com/example-org/dest/issues/12', ...extras });
const response = { data: { transferIssue: { issue: {
  id: NODE, number: 12, url: 'https://github.com/example-org/dest/issues/12',
  repository: { nameWithOwner: 'example-org/dest' } } } } };
const seq = (gh, route, entries) => gh.when(route).replySequence(entries.map(([status, body]) => ({ status, body })));
const args = { repo: 'hello', number: 7, destinationRepo: 'dest' };
const def = { tool: transfer.tools[0], handler: transfer.handlers.github_issue_transfer };
const arrange = (gh, result) => {
  seq(gh, SOURCE, [[200, source], [200, result === 'ok' ? moved() : moved({ node_id: 'I_foreign' })]]);
  gh.when(DEST).reply(200, destination);
  gh.when('POST /graphql').reply(200, response);
};
runWriteContract({ label: 'github_issue_transfer', definition: def, args,
  needsConfirm: true, arrange });

async function call(w, input) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch,
    now: w.ctx.now, sleep: async () => {} });
  const out = await dispatch({ registry, name: 'github_issue_transfer', args: input,
    connection: w.connection, db: w.db });
  return out.structuredContent ?? parse(out);
}
const mutations = gh => gh.graphql.filter(g => /^mutation\b/.test(g.query.trim()));
describe('issue transfer destination boundaries', () => {
  it('requires explicit confirmation and does not transfer on preview', async () => {
    const w = await makeWorld({});
    arrange(w.gh, 'ok');
    const preview = await call(w, { ...args, dryRun: true });
    expect(preview).toMatchObject({ status: 'preview', needsConfirmation: true });
    expect(preview.preview).toContain('example-org/dest');
    expect(mutations(w.gh)).toEqual([]);
  });
  it('uses independently verified GraphQL node IDs, not user-provided IDs', async () => {
    const w = await makeWorld({});
    arrange(w.gh, 'ok');
    const out = await call(w, { ...args, createLabelsIfMissing: true, confirm: true });
    expect(out).toMatchObject({ done: true, status: 'applied' });
    expect(mutations(w.gh)).toHaveLength(1);
    expect(mutations(w.gh)[0].variables).toMatchObject({
      issue: NODE, destination: 'R_destination', createLabels: true
    });
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses transferring a PR as an issue', async () => {
    const w = await makeWorld({});
    w.gh.when(SOURCE).reply(200, { ...source, pull_request: { url: 'pr' } });
    w.gh.when(DEST).reply(200, destination);
    const out = await call(w, { ...args, confirm: true });
    expect(out.done).not.toBe(true);
    expect(mutations(w.gh)).toEqual([]);
  });
  it('rejects transfers into another unconnected account without any mutation', async () => {
    const w = await makeWorld({});
    const out = await call(w, { ...args, destinationOwner: 'foreign', confirm: true });
    expect(out.done).not.toBe(true);
    expect(mutations(w.gh)).toEqual([]);
  });
  it('refuses protected destination repositories even if source is writable', async () => {
    const w = await makeWorld({ accounts: ['example-org', 'robinson-ai-systems'] });
    const out = await call(w, { ...args, destinationOwner: 'robinson-ai-systems',
      destinationRepo: 'github-mcp', confirm: true });
    expect(out.done).not.toBe(true);
    expect(mutations(w.gh)).toEqual([]);
  });
  it('refuses destination mismatch and ignores GraphQL response as sole proof', async () => {
    const w = await makeWorld({});
    arrange(w.gh, 'mismatch');
    const out = await call(w, { ...args, confirm: true });
    expect(out).toMatchObject({ done: false, status: 'unconfirmed' });
    expect(mutations(w.gh)).toHaveLength(1);
  });
});

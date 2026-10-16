// X-2: read-only smoke test. Runs every read tool with minimal arguments on a PREVIEW, READ-ONLY connection and writes a
// plain report: pass, gap (a permission the account lacks), limitation (a GitHub plan feature the account does not have),
// skipped (no known safe argument - never an invented resource) or fail. Nothing here can change GitHub: only read tools are
// selected, and the network function it hands the server refuses every request except GET, HEAD and GraphQL queries.
//
//   node scripts/smoke-readonly.mjs --account <login> [--repo <name>] [--fixtures file.json] [--out docs/audits/smoke-<date>.md]
//
// The command needs the server's own environment (database and encryption key) and uses the account's saved read credential;
// it prints no credential and never copies one anywhere. Running it against a real account is an owner step (docs/OWNER-INPUTS.md).
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SMOKE_PROFILE = 'read_only';
const REQUIRED_MODE = 'preview';
const MAX_BODY = 4000;
const PLAN_WORDS = /upgrade|github (?:pro|team|enterprise)|plan|not available (?:for|on)|requires? (?:a )?(?:paid|public)|billing/i;

/** The tools a smoke run may call: plain reads only. Changes, composed runners and anything not marked read-only are never selected. */
export function selectReadTools(registry) {
  const chosen = []; const excluded = [];
  for (const tool of registry.tools) {
    const isRead = tool.writes !== true && tool.passthrough !== true && tool.annotations?.readOnlyHint === true;
    (isRead && Object.hasOwn(registry.handlers, tool.name) ? chosen : excluded).push(tool);
  }
  return { chosen, excluded };
}

/** Arguments from the caller's fixtures only. A required argument with no fixture means "skipped", never a guess. */
export function argumentsFor(tool, fixtures = {}) {
  const schema = tool.inputSchema ?? {};
  const props = schema.properties ?? {};
  const args = {}; const missing = [];
  for (const key of schema.required ?? []) {
    if (Object.hasOwn(fixtures, key) && fixtures[key] !== undefined) args[key] = fixtures[key];
    else missing.push(key);
  }
  // Optional ones the fixtures name are still passed, so owner/repo scope the call to the intended account.
  for (const key of ['owner', 'repo', 'org', 'account']) if (key in props && Object.hasOwn(fixtures, key) && !(key in args)) args[key] = fixtures[key];
  return { args, missing };
}

const isReadRequest = (method, url, body) => {
  const m = String(method ?? 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return true;
  if (m === 'POST' && /\/graphql$/.test(new URL(url).pathname)) {
    let text = typeof body === 'string' ? body : '';
    try { text = String(JSON.parse(text)?.query ?? ''); } catch { /* not JSON: judged as plain text below */ }
    return !/\bmutation\b/i.test(text);
  }
  return false;
};

/**
 * The only network function a smoke run gets. It refuses everything but reads before any bytes leave, and keeps a small
 * log (status and GitHub's request ID, never a header that could hold a credential) for the report.
 */
export function guardedFetch(inner) {
  const log = [];
  const guarded = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const method = init.method ?? input?.method ?? 'GET';
    if (!isReadRequest(method, url, init.body ?? input?.body)) {
      log.push({ method: String(method).toUpperCase(), blocked: true });
      throw new Error('The read-only smoke test refused a request that could change something.');
    }
    const response = await inner(input, init);
    let message = '';
    if (response.status >= 400) { try { message = String(JSON.parse((await response.clone().text()).slice(0, MAX_BODY))?.message ?? ''); } catch { message = ''; } }
    log.push({ method: String(method).toUpperCase(), status: response.status, requestId: response.headers?.get?.('x-github-request-id') ?? null, message });
    return response;
  };
  return { fetch: guarded, log };
}

/** Pass, plan limitation, permission gap or failure for one tool run, from the tool answer and its recorded GitHub answers. */
export function classifyRun({ result, calls }) {
  const blocked = calls.some((c) => c.blocked);
  const refused = calls.filter((c) => !c.blocked && c.status >= 400);
  const requestId = refused.map((c) => c.requestId).find(Boolean) ?? calls.map((c) => c.requestId).find(Boolean) ?? null;
  if (blocked) return { outcome: 'fail', note: 'tried to send a change; the smoke test blocked it', requestId };
  if (result?.isError !== true) return { outcome: 'pass', requestId };
  const planLimited = refused.find((c) => (c.status === 403 || c.status === 404 || c.status === 451) && PLAN_WORDS.test(c.message));
  if (planLimited) return { outcome: 'limitation', note: `GitHub says this needs a different plan (HTTP ${planLimited.status}); not a code failure`, requestId: planLimited.requestId ?? requestId };
  const denied = refused.find((c) => c.status === 403 || c.status === 401);
  if (denied) return { outcome: 'gap', note: `permission not granted to this account (HTTP ${denied.status})`, requestId: denied.requestId ?? requestId };
  const text = String(result?.content?.[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 200);
  return { outcome: 'fail', note: refused[0] ? `GitHub answered HTTP ${refused[0].status}: ${text}` : text, requestId };
}

/**
 * @param {object} o
 * @param {{ tools: object[], handlers: object }} o.registry
 * @param {(o) => Promise<object>} o.dispatchFor `(guardedFetch) => dispatch` - builds the server's dispatcher around the guarded network function
 * @param {object} o.connection must be preview mode with the read_only profile
 * @param {object} o.db
 * @param {object} [o.fixtures] argument values keyed by argument name (owner, repo, number ...)
 */
export async function runSmoke({ registry, dispatchFor, connection, db, fixtures = {}, innerFetch = globalThis.fetch }) {
  if (connection?.mode !== REQUIRED_MODE || connection?.profile !== SMOKE_PROFILE) {
    throw new TypeError('The smoke test runs only on a preview connection with the read_only profile.');
  }
  const { chosen, excluded } = selectReadTools(registry);
  const results = [];
  for (const tool of chosen) {
    const { args, missing } = argumentsFor(tool, fixtures);
    if (missing.length) { results.push({ tool: tool.name, outcome: 'skipped', note: `needs ${missing.join(', ')}; give it with --fixtures` }); continue; }
    const net = guardedFetch(innerFetch);
    const dispatch = dispatchFor(net.fetch);
    let result;
    try { result = await dispatch({ registry, name: tool.name, args, connection, db }); } catch { result = { isError: true, content: [{ type: 'text', text: 'The tool raised an unexpected error.' }] }; }
    results.push({ tool: tool.name, ...classifyRun({ result, calls: net.log }) });
  }
  return { results, excludedCount: excluded.length };
}

const LABEL = { pass: 'PASS', limitation: 'LIMITATION', gap: 'GAP', skipped: 'SKIPPED', fail: 'FAIL' };

export function renderReport({ results, excludedCount, account, date, revision = null }) {
  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  const lines = [
    `# Read-only smoke report — ${date}`, '',
    `Account: ${account}. Connection: preview, read_only profile. Server revision: ${revision ?? 'not recorded'}.`,
    'Only read tools were run, and every network request that could change something was refused before it was sent.', '',
    `Tools run or accounted for: ${results.length}. Not selected because they change things or run other tools: ${excludedCount}.`,
    `PASS ${count('pass')} · LIMITATION ${count('limitation')} · GAP ${count('gap')} · SKIPPED ${count('skipped')} · FAIL ${count('fail')}`, '',
    'A limitation is a GitHub plan feature this account does not have. A gap is a permission the account has not granted. Neither is counted as a pass, and neither is a code failure. A skipped tool had no safe example argument.', '',
    '| Tool | Result | Note | GitHub request ID |', '| --- | --- | --- | --- |',
    ...results.map((r) => `| \`${r.tool}\` | ${LABEL[r.outcome]} | ${String(r.note ?? '').replace(/\|/g, '/').slice(0, 220)} | ${r.requestId ?? ''} |`), ''
  ];
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!key || argv[i + 1] === undefined) throw new TypeError(`Missing value for ${argv[i]}`);
    out[key] = argv[i + 1];
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.account) throw new TypeError('Say which connected account to test: --account <login>');
  const { createDb } = await import('../src/db.js');
  const { createCredentials } = await import('../src/github/credentials.js');
  const { createDispatch } = await import('../src/tools/dispatch.js');
  const { registry } = await import('../src/tools/index.js');
  const db = createDb();
  const credentials = createCredentials({ db, env: process.env });
  const connection = Object.freeze({ client_id: 'smoke-readonly', default_account: opts.account, accounts: Object.freeze([opts.account]), mode: 'preview', profile: SMOKE_PROFILE, listing: 'catalog' });
  const fixtures = { owner: opts.account, account: opts.account, ...(opts.repo ? { repo: opts.repo } : {}), ...(opts.fixtures ? JSON.parse(readFileSync(opts.fixtures, 'utf8')) : {}) };
  const run = await runSmoke({ registry, connection, db, fixtures,
    dispatchFor: (fetch) => createDispatch({ env: process.env, credentials, fetch, gates: [] }) });
  const date = new Date().toISOString().slice(0, 10);
  const report = renderReport({ ...run, account: opts.account, date, revision: process.env.VERCEL_GIT_COMMIT_SHA ?? null });
  const out = opts.out ?? `docs/audits/smoke-${date}.md`;
  writeFileSync(out, report);
  console.log(`Wrote ${out}: ${run.results.length} tools.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { console.error(error instanceof TypeError ? error.message : 'The smoke test could not run.'); process.exitCode = 1; });
}

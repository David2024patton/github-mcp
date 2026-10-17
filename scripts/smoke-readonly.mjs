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
import { parse as parseGraphql, Kind } from 'graphql';

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

// This runner can carry privileged GitHub credentials. A plain GET to an
// arbitrary domain is not a safe read: it can exfiltrate authorization headers.
// Likewise an opaque GraphQL payload can execute an unknown persisted mutation.
// Only the exact public GitHub REST/GraphQL endpoint is an approved target.
function githubUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'api.github.com' &&
      u.port === '' && !u.username && !u.password && !u.hash &&
      ![...u.searchParams.keys()].some(k => /^(?:token|access_token|api_key|client_secret)$/i.test(k));
  } catch { return false; }
}
function oneGraphqlRead(body) {
  if (typeof body !== 'string' || body.length > 50000) return false;
  let payload;
  try { payload = JSON.parse(body); } catch { return false; }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' ||
      typeof payload.query !== 'string' || !payload.query.trim() ||
      Object.keys(payload).some(k => !['query', 'variables', 'operationName'].includes(k))) return false;
  let document;
  try { document = parseGraphql(payload.query); } catch { return false; }
  const operations = document.definitions.filter(d => d.kind === Kind.OPERATION_DEFINITION);
  // A fragment-only/empty/multiple-operation document is ambiguous. Reject
  // even a named read when the same request contains an unused mutation.
  if (operations.length !== 1 || operations[0].operation !== 'query') return false;
  if (payload.operationName !== undefined &&
      (typeof payload.operationName !== 'string' ||
       operations[0].name?.value !== payload.operationName)) return false;
  if (payload.variables !== undefined &&
      (payload.variables === null || typeof payload.variables !== 'object' || Array.isArray(payload.variables))) return false;
  return true;
}
const isReadRequest = (method, url, body) => {
  if (!githubUrl(url)) return false;
  const m = String(method ?? 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return new URL(url).pathname !== '/graphql';
  return m === 'POST' && new URL(url).pathname === '/graphql' && oneGraphqlRead(body);
};

// Provider messages and header values are untrusted. Never let credentials,
// control characters or Markdown structure leak into a checked-in smoke report.
const protect = (value, max = 220) => String(value ?? '')
  .replace(/\b(?:github_pat_|gh[pousr]_|ghs_|ghr_)[A-Za-z0-9_]{8,}\b/gi, '[REDACTED]')
  .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED]')
  .replace(/([?&](?:access_token|token|client_secret|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
  .replace(/(?:authorization|x-api-key|private-key)\s*[:=]\s*[^\s,;}]+/gi, '[REDACTED]')
  .replace(/[\x00-\x1f\x7f|<>\[\]`\\]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const safeRequestId = value => /^[A-Za-z0-9_-]{1,80}$/.test(String(value ?? '')) ? String(value) : null;

/** A read that reports partial coverage is not evidence of a successful smoke.
 * Recognize the registered workflow envelopes, not arbitrary user file text. */
function incompleteResult(result) {
  let data = result?.structuredContent;
  if (!data && typeof result?.content?.[0]?.text === 'string') {
    try { data = JSON.parse(result.content[0].text); } catch { /* plain responses are allowed */ }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const wrong = x => x?.complete === false || x?.done === false ||
    ['partial', 'not_readable', 'not_attempted', 'incomplete', 'refused', 'refused_by_guard', 'needs_confirmation', 'pending'].includes(x?.status) ||
    x?.more_possible === true || x?.more_exist === true || x?.incomplete_results === true ||
    x?.next_page_possible || x?.kept_result;
  const sectionBad = values => Array.isArray(values) && values.some(v =>
    v?.status && v.status !== 'observed' && v.status !== 'pass' && v.status !== 'success');
  if (wrong(data) || sectionBad(data.sections) || sectionBad(data.evidence)) return true;
  if (Array.isArray(data.groups) && data.groups.some(wrong)) return true;
  if (Array.isArray(data.accounts) && data.accounts.some(account =>
    wrong(account.billed_usage) || Array.isArray(account.repositories) &&
      account.repositories.some(repo => wrong(repo.ci) ||
        Object.values(repo.open_alerts ?? {}).some(v => v === null || wrong(v))))) return true;
  return false;
}

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
    // Prevent automatic redirects from carrying an OAuth request outside the
    // pinned API destination. GitHub may legitimately redirect downloads; these
    // are recorded as incomplete instead of silently fetching an outside host.
    const response = await inner(input, { ...init, redirect: 'manual' });
    let message = '';
    if (response.status >= 400) { try { message = String(JSON.parse((await response.clone().text()).slice(0, MAX_BODY))?.message ?? ''); } catch { message = ''; } }
    log.push({ method: String(method).toUpperCase(), status: response.status, requestId: safeRequestId(response.headers?.get?.('x-github-request-id')), message: protect(message, 250) });
    return response;
  };
  return { fetch: guarded, log };
}

/** Pass, plan limitation, permission gap or failure for one tool run, from the tool answer and its recorded GitHub answers. */
export function classifyRun({ result, calls }) {
  const blocked = calls.some(c => c.blocked);
  const refused = calls.filter(c => !c.blocked && c.status >= 400);
  const requestId = safeRequestId(refused.map(c => c.requestId).find(Boolean) ??
    calls.map(c => c.requestId).find(Boolean));
  if (blocked) return { outcome: 'fail', note: 'tried to send a change or reach a non-GitHub destination; the smoke test blocked it', requestId };
  const planLimited = refused.find(c => (c.status === 403 || c.status === 404 || c.status === 451) && PLAN_WORDS.test(c.message));
  const denied = refused.find(c => c.status === 403 || c.status === 401);
  if (result?.isError === true) {
    if (planLimited) return { outcome: 'limitation', note: `GitHub says this needs a different plan (HTTP ${planLimited.status}); not a code failure`, requestId };
    if (denied) return { outcome: 'gap', note: `permission not granted to this account (HTTP ${denied.status})`, requestId };
    const message = protect(result?.content?.[0]?.text ?? 'The tool returned an error.');
    return { outcome: 'fail', note: refused[0] ? `GitHub answered HTTP ${refused[0].status}: ${message}` : message, requestId };
  }
  // Wrapped read-only workflows commonly complete a request successfully but
  // explicitly label some provider sections partial/unknown. This is not PASS.
  if (incompleteResult(result)) return {
    outcome: planLimited ? 'limitation' : denied ? 'gap' : 'fail',
    note: 'The read reported incomplete, unreadable or unverified coverage; not a complete provider PASS.',
    requestId
  };
  return { outcome: 'pass', requestId };
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
  for (const field of ['owner', 'account', 'org']) {
    if (fixtures[field] !== undefined &&
        (typeof fixtures[field] !== 'string' ||
         !connection.accounts?.some(x => x.toLowerCase() === fixtures[field].toLowerCase())))
      throw new TypeError(`The smoke fixture ${field} is not enrolled in this connection.`);
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
    ...results.map((r) => `| \`${protect(r.tool, 96)}\` | ${LABEL[r.outcome] ?? 'FAIL'} | ${protect(r.note)} | ${safeRequestId(r.requestId) ?? ''} |`), ''
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

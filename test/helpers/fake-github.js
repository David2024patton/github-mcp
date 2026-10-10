// Built for github-mcp (A-1). A fake GitHub HTTP server reached through Octokit's `request.fetch` — no network.
// Every request is recorded as { method, route, path, params, query, body, headers }, where `route` is the matched
// OpenAPI template (e.g. 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge'). In A-1 the route table is the small
// hand-written list below; A-4 replaces it with the vendored GitHub description and validates every request against it.

/** Templates the A-1 fake knows. Each `{name}` matches one path segment, except `{path}` (file paths span segments). */
export const A1_ROUTES = [
  'GET /user',
  'GET /repos/{owner}/{repo}',
  'GET /repos/{owner}/{repo}/contents/{path}',
  'PUT /repos/{owner}/{repo}/contents/{path}',
  'GET /repos/{owner}/{repo}/pulls/{pull_number}',
  'POST /repos/{owner}/{repo}/pulls',
  'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
  'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
  'POST /graphql'
];

const MULTI_SEGMENT = new Set(['path']);

function compile(route) {
  const [method, template] = route.split(' ');
  const names = [];
  const source = template.split('/').map((segment) => segment.replace(/\{([^}]+)\}/g, (_m, name) => {
    names.push(name);
    return MULTI_SEGMENT.has(name) ? '(.+)' : '([^/]+)';
  })).join('/');
  return { route, method, names, regex: new RegExp(`^${source}$`) };
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function lowerHeaders(headers) {
  if (!headers) return {};
  const entries = headers instanceof Headers || Array.isArray(headers)
    ? [...new Headers(headers).entries()] : Object.entries(headers);
  return Object.fromEntries(entries.map(([k, v]) => [String(k).toLowerCase(), String(v)]));
}

function parseBody(body) {
  if (body === undefined || body === null || body === '') return undefined;
  if (typeof body !== 'string') return body;
  try { return JSON.parse(body); } catch { return body; }
}

function json(status, body, headers = {}) {
  const noBody = status === 204 || status === 304;
  return new Response(noBody ? null : JSON.stringify(body ?? {}), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

/**
 * @param {{ routes?: string[], baseUrl?: string }} [options] extra route templates (A-4 passes the vendored list).
 * @returns {{ fetch: Function, calls: object[], unmatched: object[], graphql: object[], when: Function, routes: string[] }}
 */
export function makeFakeGitHub({ routes = [], baseUrl = 'https://api.github.com' } = {}) {
  const table = [...new Set([...A1_ROUTES, ...routes])].map(compile);
  const known = new Set(table.map((r) => r.route));
  const replies = new Map();
  const calls = [];
  const unmatched = [];
  const graphql = [];

  function when(route) {
    if (!known.has(route)) throw new Error(`fake GitHub does not know route "${route}"`);
    return {
      /** reply(status, body | (request) => body, headers?) */
      reply(status, body = {}, headers = {}) {
        replies.set(route, { status, body, headers });
        return this;
      }
    };
  }

  async function fetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(init.method || input.method || 'GET').toUpperCase();
    const base = new URL(baseUrl);
    const rawPath = url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')
      ? url.pathname.slice(base.pathname.replace(/\/$/, '').length) : url.pathname;
    const request = {
      method,
      route: null,
      path: rawPath,
      params: {},
      query: Object.fromEntries(url.searchParams),
      body: parseBody(init.body),
      headers: lowerHeaders(init.headers)
    };
    const hit = url.origin === base.origin
      ? table.find((r) => r.method === method && r.regex.test(rawPath)) : undefined;
    if (!hit) {
      const record = { ...request, unmatched: true };
      calls.push(record);
      unmatched.push(record);
      return json(404, { message: `Not Found (fake GitHub has no route for ${method} ${rawPath})`, status: '404' });
    }
    const values = rawPath.match(hit.regex).slice(1);
    request.route = hit.route;
    request.params = Object.fromEntries(hit.names.map((name, i) => [name, decode(values[i])]));
    calls.push(request);
    if (hit.route === 'POST /graphql') {
      graphql.push({ query: request.body?.query, variables: request.body?.variables ?? {} });
    }
    const reply = replies.get(hit.route);
    if (!reply) {
      return json(501, { message: `fake GitHub: no reply configured for ${hit.route}` });
    }
    const body = typeof reply.body === 'function' ? await reply.body(request) : reply.body;
    return json(reply.status, body, reply.headers);
  }

  return { fetch, calls, unmatched, graphql, when, routes: [...known] };
}

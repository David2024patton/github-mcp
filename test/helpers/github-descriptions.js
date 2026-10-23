// Built for github-mcp (A-4). Loads the vendored GitHub REST description and GraphQL schema ONCE per process and
// answers three questions: which operations exist (`operations()`), is this REST request valid for its operation
// (`validateRestRequest()`), and is this GraphQL document valid against the schema (`validateGraphql()`).
// Dev/test only: the 13 MB description is never loaded by the server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OPENAPI_FILE = path.join(ROOT, 'vendor/github-openapi/api.github.com.2026-03-10.json');
export const GRAPHQL_FILE = path.join(ROOT, 'vendor/github-graphql/schema.docs.graphql');

const METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'];
let doc = null;
let ops = null;
const ajvs = new Map(); // query strings need type coercion ("100" → 100); JSON bodies must not get it
const compiled = new Map();

/**
 * OpenAPI 3.0 allows `nullable: true` on a schema with no `type` (only oneOf/anyOf/allOf); Ajv refuses that. Such a node
 * becomes `anyOf: [<the node>, { type: 'null' }]`, which means the same thing. Applied to the in-memory copy only.
 */
function fixNullable(node) {
  if (Array.isArray(node)) { node.forEach(fixNullable); return; }
  if (!node || typeof node !== 'object') return;
  for (const value of Object.values(node)) fixNullable(value);
  if (node.nullable === true && node.type === undefined && !node.$ref) {
    const { nullable: _nullable, ...rest } = node;
    for (const key of Object.keys(node)) delete node[key];
    node.anyOf = [rest, { type: 'null' }];
  }
}

export function openApi() {
  if (!doc) {
    doc = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
    fixNullable(doc.components);
    for (const item of Object.values(doc.paths)) fixNullable(item);
  }
  return doc;
}

/** Every operation: { method, path, route, operationId, summary, category, triggersNotification, deprecated, operation }. */
export function operations() {
  if (ops) return ops;
  ops = [];
  for (const [p, item] of Object.entries(openApi().paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      ops.push({
        method: method.toUpperCase(), path: p, route: `${method.toUpperCase()} ${p}`, operationId: operation.operationId,
        summary: operation.summary || '', category: operation['x-github']?.category || '',
        triggersNotification: operation['x-github']?.triggersNotification === true,
        deprecated: operation.deprecated === true, operation, pathItem: item
      });
    }
  }
  return ops;
}

const byRoute = () => (operations().byRoute ??= new Map(operations().map((o) => [o.route, o])));

function resolveRef(node) {
  if (node && node.$ref) {
    const parts = node.$ref.replace(/^#\//, '').split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur = openApi();
    for (const part of parts) cur = cur?.[part];
    return cur;
  }
  return node;
}

function getAjv(coerce) {
  if (ajvs.has(coerce)) return ajvs.get(coerce);
  const ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: coerce, allowUnionTypes: true });
  addFormats(ajv);
  // The whole description is registered once so every internal $ref ("#/components/schemas/…") resolves.
  ajv.addSchema(openApi(), 'gh');
  ajvs.set(coerce, ajv);
  return ajv;
}

function validator(key, schema, { coerce = false } = {}) {
  if (!compiled.has(key)) compiled.set(key, getAjv(coerce).compile(schema));
  return compiled.get(key);
}

/** The parameters of an operation, with path-level ones merged and $refs resolved. */
export function parametersOf(op) {
  const merged = new Map();
  for (const raw of [...(op.pathItem.parameters || []), ...(op.operation.parameters || [])]) {
    const p = resolveRef(raw);
    merged.set(`${p.in}:${p.name}`, p);
  }
  return [...merged.values()];
}

const asErrors = (prefix, errors) => (errors || []).map((e) => `${prefix}${e.instancePath || ''} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`.trim());

/**
 * @param {string} route e.g. 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge'
 * @param {{ params: object, query: object, body: any, headers: object }} request as recorded by the fake
 * @returns {string[]} problems (empty when the request is valid for the operation)
 */
export function validateRestRequest(route, request) {
  const op = byRoute().get(route);
  if (!op) return [`${route} is not an operation in the vendored description`];
  const problems = [];
  const parameters = parametersOf(op);
  for (const p of parameters.filter((x) => x.in === 'path')) {
    if (request.params[p.name] === undefined || request.params[p.name] === '') problems.push(`path parameter ${p.name} is missing`);
  }
  const query = parameters.filter((x) => x.in === 'query');
  const querySchema = {
    type: 'object',
    properties: Object.fromEntries(query.map((p) => [p.name, p.schema || {}])),
    required: query.filter((p) => p.required).map((p) => p.name),
    additionalProperties: false
  };
  const queryValue = structuredClone(request.query || {});
  const checkQuery = validator(`q:${route}`, querySchema, { coerce: true });
  if (!checkQuery(queryValue)) problems.push(...asErrors('query', checkQuery.errors));
  let body = request.body;
  // Known divergence, observed on the real API (2026-10-23): the pinned description marks the deprecated `contexts` list as
  // required for branch protection, yet GitHub answers 422 ("More than one subschema in oneOf matched") when `contexts` and
  // `checks` are both sent, even if both are empty. The app-bound `checks` list alone is what must go out.
  if (route === 'PUT /repos/{owner}/{repo}/branches/{branch}/protection' && body?.required_status_checks &&
      Array.isArray(body.required_status_checks.checks) && !('contexts' in body.required_status_checks)) {
    body = { ...body, required_status_checks: { ...body.required_status_checks, contexts: [] } };
  } else if (route === 'PUT /repos/{owner}/{repo}/branches/{branch}/protection' && body?.required_status_checks &&
      'contexts' in body.required_status_checks && 'checks' in body.required_status_checks) {
    problems.push('required_status_checks must not send both contexts and checks (GitHub answers 422)');
  }
  const content = resolveRef(op.operation.requestBody)?.content;
  const required = resolveRef(op.operation.requestBody)?.required === true;
  if (content) {
    const json = content['application/json'];
    if (json?.schema) {
      if (body === undefined || body === null) { if (required) problems.push('request body is required'); }
      else if (typeof body === 'object') {
        // Compile through a pointer into the registered document so the schema's own "#/components/…" references resolve.
        const segment = encodeURIComponent(op.path.replace(/~/g, '~0').replace(/\//g, '~1')).replace(/%7E/gi, '~');
        const check = validator(`b:${route}`, { $ref: `gh#/paths/${segment}/${op.method.toLowerCase()}/requestBody/content/application~1json/schema` });
        if (!check(structuredClone(body))) problems.push(...asErrors('body', check.errors));
        // GitHub's description rarely forbids extra fields, but sending one is always a mistake on our side
        // (a misspelling, or a field from another API version), so unknown top-level fields are refused here.
        const known = topLevelProperties(json.schema);
        if (known) for (const name of Object.keys(body)) if (!known.has(name)) problems.push(`body has unknown field ${name}`);
      }
    } else if (required && (body === undefined || body === null)) problems.push('request body is required');
  } else if (body !== undefined && body !== null && !(typeof body === 'object' && Object.keys(body).length === 0)) {
    problems.push('this operation takes no request body');
  }
  return problems;
}

/** Names a body schema allows at the top level (following $ref/allOf/oneOf/anyOf); null when it accepts anything. */
function topLevelProperties(schema, seen = new Set()) {
  const node = resolveRef(schema);
  if (!node || seen.has(node)) return new Set();
  seen.add(node);
  if (node.additionalProperties === true || (node.additionalProperties && typeof node.additionalProperties === 'object')) return null;
  const names = new Set(Object.keys(node.properties || {}));
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    for (const part of node[key] || []) {
      const inner = topLevelProperties(part, seen);
      if (inner === null) return null;
      for (const name of inner) names.add(name);
    }
  }
  return names;
}

let graphqlLib = null;
let schema = null;

async function graphqlSchema() {
  graphqlLib ??= await import('graphql');
  schema ??= graphqlLib.buildSchema(fs.readFileSync(GRAPHQL_FILE, 'utf8'), { assumeValidSDL: true, assumeValid: true }); // GitHub's own SDL breaks graphql 17's deprecation-consistency rule; documents are still validated
  return { lib: graphqlLib, schema };
}

/** @returns {Promise<string[]>} problems with a GraphQL document (syntax or validation against the vendored schema). */
export async function validateGraphql(query) {
  if (typeof query !== 'string' || !query.trim()) return ['GraphQL query is missing'];
  const { lib, schema: s } = await graphqlSchema();
  let documentNode;
  try { documentNode = lib.parse(query); } catch (error) { return [`syntax: ${error.message}`]; }
  return lib.validate(s, documentNode).map((e) => e.message);
}

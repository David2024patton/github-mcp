// Skills catalog reads (SKILLS-1): search and route over David Patton's
// skills collection, metadata only. Skill text is never stored in this
// server and never returned by these tools; the catalog data module
// (src/data/skills-catalog.js) carries names, purposes, keywords, risk
// classes and checksums for MIT-cleared records only.
//
// The section is inert by default: both tools refuse every call until the
// owner sets SKILLS_CATALOG_ENABLED=enabled (the same shape as the tenant
// pilot and marketplace switches elsewhere in this server).
import { createHash, randomBytes } from 'node:crypto';
import { defineRead } from './define-read.js';
import { SKILLS_BUNDLE, SKILLS_CATALOG } from '../data/skills-catalog.js';
import { PLANS } from '../skills/github-plans.js';
import { verifyTenantCredential } from '../tenancy/routed-credential.js';
import { isPublicClientId } from '../tenancy/public-code.js';

export const RISK_ORDER = Object.freeze(['read', 'write', 'external-send', 'money', 'destructive']);
const riskRank = (risk) => RISK_ORDER.indexOf(risk);
const maxRisk = (a, b) => (riskRank(a) >= riskRank(b) ? a : b);

const refused = (error) => ({ done: false, status: 'refused', error });

/**
 * Which tenant a connection belongs to, from the connection object a tool
 * actually receives. Finding (from api/mcp.js, src/oauth/policy.js and
 * src/tenancy/mcp-route.js): the connection built by policy.toConnection is
 * the same frozen shape for the owner door and the tenant door -
 * { client_id, default_account, accounts, mode, profile, listing } - and it
 * carries NO tenant field. The tenant identity resolved in mcp-route.js
 * (claim.tenantId, from the tac_/trf_ bearer) stays at the route layer and
 * is not forwarded into the connection. The only tenant markers a handler
 * can see are therefore on client_id:
 * - a signed `tcl_` client id is a tenant client: its tenant UUID is inside
 *   the signed payload and verifyTenantCredential recovers it when the
 *   tenant pilot is enabled and its routing key is configured;
 * - a public `pcl_` client id is also a tenant connection, but the tenant
 *   id is deliberately NOT inside it (see mcp-route.js), so it cannot be
 *   recovered from the connection at all;
 * - an explicit tenant_id / tenantId / tenant field, if a future door adds
 *   one, wins over both.
 * A tenant connection whose id cannot be recovered is entitled only by the
 * '*' entry in SKILLS_CATALOG_TENANTS, never by a guessed id.
 */
function tenantInfo(connection, env) {
  if (typeof connection.tenant_id === 'string' && connection.tenant_id) return { isTenant: true, tenantId: connection.tenant_id };
  if (typeof connection.tenantId === 'string' && connection.tenantId) return { isTenant: true, tenantId: connection.tenantId };
  const nested = connection.tenant;
  if (nested && typeof nested === 'object') {
    if (typeof nested.tenantId === 'string' && nested.tenantId) return { isTenant: true, tenantId: nested.tenantId };
    if (typeof nested.id === 'string' && nested.id) return { isTenant: true, tenantId: nested.id };
  }
  const clientId = typeof connection.client_id === 'string' ? connection.client_id : '';
  if (clientId.startsWith('tcl_')) {
    let tenantId = null;
    try { tenantId = verifyTenantCredential(clientId, 'tcl', env)?.tenantId ?? null; } catch { tenantId = null; }
    return { isTenant: true, tenantId };
  }
  if (isPublicClientId(clientId)) return { isTenant: true, tenantId: null };
  if (/^(?:tac|trf)_/.test(clientId)) return { isTenant: true, tenantId: null };
  return { isTenant: false, tenantId: null };
}

/**
 * The shared gate for every skills catalog tool: null when the caller may
 * use the catalog, else the house refusal object. Owner connections may use
 * it once enabled; service passes never may; tenant connections only when
 * their tenant is listed in SKILLS_CATALOG_TENANTS (or '*' lists all).
 */
export function skillsGate(ctx) {
  const env = ctx?.env ?? process.env;
  if (env.SKILLS_CATALOG_ENABLED !== 'enabled') {
    return refused('The skills catalog is not enabled on this server. The owner enables it by setting SKILLS_CATALOG_ENABLED=enabled.');
  }
  const connection = ctx?.connection ?? {};
  if (connection.pass_id || connection.pass === true) {
    return refused('Service passes cannot use the skills catalog.');
  }
  const tenant = tenantInfo(connection, env);
  if (tenant.isTenant) {
    const entitled = String(env.SKILLS_CATALOG_TENANTS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
    if (entitled.includes('*')) return null;
    if (tenant.tenantId && entitled.includes(tenant.tenantId)) return null;
    return refused('This tenant is not entitled to the skills catalog.');
  }
  return null;
}

const tokensOf = (text) => [...new Set(String(text ?? '').toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])];

function recordTokens(record) {
  const set = new Set();
  for (const token of tokensOf(record.id)) set.add(token);
  for (const token of tokensOf(record.name)) set.add(token);
  for (const keyword of record.keywords ?? []) {
    set.add(String(keyword).toLowerCase());
    for (const token of tokensOf(keyword)) set.add(token);
  }
  for (const token of tokensOf(record.description)) set.add(token);
  return set;
}
const RECORD_TOKENS = new Map(SKILLS_CATALOG.map((record) => [record.id, recordTokens(record)]));

const publicRecord = (record) => ({
  id: record.id, name: record.name, kind: record.kind, category: record.category,
  description: record.description, keywords: [...record.keywords],
  risk_class: record.risk_class, license_status: record.license_status
});

function searchSkills(args) {
  const queryTokens = tokensOf(args.query);
  const maxRank = args.maxRisk ? riskRank(args.maxRisk) : RISK_ORDER.length - 1;
  const scored = [];
  for (const record of SKILLS_CATALOG) {
    if (args.category && record.category !== args.category) continue;
    if (riskRank(record.risk_class) > maxRank) continue;
    const tokens = RECORD_TOKENS.get(record.id);
    const matched = queryTokens.filter((token) => tokens.has(token)).length;
    if (queryTokens.length && matched === 0) continue;
    scored.push({ record, matched });
  }
  scored.sort((a, b) => (b.matched - a.matched) || (a.record.id < b.record.id ? -1 : 1));
  const skills = scored.slice(0, 25).map(({ record }) => publicRecord(record));
  return { count: skills.length, skills, bundle: SKILLS_BUNDLE };
}

/** Canonical JSON: object keys sorted at every depth, so a payload hash is stable for the same plan. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');
const nowMs = (ctx) => (typeof ctx?.now === 'function' ? ctx.now() : (typeof ctx?.now === 'number' ? ctx.now : Date.now()));
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CONTEXT_KEYS = Object.freeze(['owner', 'repo', 'number', 'head', 'base', 'title', 'body', 'draft', 'labels']);
function pickedContext(context) {
  const picked = {};
  for (const key of CONTEXT_KEYS) if (context?.[key] !== undefined) picked[key] = context[key];
  return picked;
}

function matchPlan(intent) {
  const normalized = ` ${String(intent).toLowerCase().replace(/\s+/g, ' ')} `;
  let best = null;
  for (const plan of PLANS) {
    for (const trigger of plan.triggers) {
      if (normalized.includes(trigger) && (!best || trigger.length > best.trigger.length)) best = { plan, trigger };
    }
  }
  return best;
}

function matchExplicitId(intent) {
  const byLength = [...SKILLS_CATALOG].sort((a, b) => b.id.length - a.id.length);
  for (const record of byLength) {
    const pattern = new RegExp(`(^|[^a-z0-9-])${escapeRegExp(record.id)}([^a-z0-9-]|$)`, 'i');
    if (pattern.test(intent)) return record;
  }
  return null;
}

async function planDecision({ plan, trigger, context, ctx }) {
  const missing = plan.requiredContext.filter((key) => context?.[key] === undefined || context?.[key] === null || context?.[key] === '');
  if (missing.length) {
    return {
      decision: 'ask', skill_id: 'github', plan_id: plan.id, missing,
      note: `To plan "${plan.title}" I still need: ${missing.join(', ')}.`
    };
  }
  const steps = plan.steps(context);
  const payloadSha256 = sha256Hex(stableStringify({ skill_id: 'github', plan_id: plan.id, steps }));
  const skill = SKILLS_CATALOG.find((record) => record.id === 'github');
  const riskClass = maxRisk(skill?.risk_class ?? 'write', plan.riskClass);
  const reason = `The intent matches the ${plan.id} plan trigger "${trigger}".`;
  const expiresAt = new Date(nowMs(ctx) + 30 * 60 * 1000).toISOString();
  const connectionKey = String(ctx.connection?.client_id ?? ctx.connection?.pass_id ?? '');
  let stored = null;
  if (connectionKey && typeof ctx.db?.putRouteDecision === 'function') {
    const id = `skd_${randomBytes(16).toString('base64url')}`;
    try {
      stored = await ctx.db.putRouteDecision({
        id, connection: connectionKey, skillId: 'github',
        plan: { plan_id: plan.id, context: pickedContext(context), steps, executable: true },
        riskClass, payloadSha256, ttlMinutes: 30
      });
    } catch { stored = null; }
    if (stored) {
      return {
        task_id: id, decision: 'route',
        selected: [{ skill_id: 'github', reason, confidence: 0.9 }],
        risk_class: riskClass, confirmation_required: true,
        plan_id: plan.id, plan: steps.map((step) => step.tool),
        payload_sha256: payloadSha256, expires_at: expiresAt,
        executable: true, execute_with: 'github_skills_execute'
      };
    }
  }
  return {
    decision: 'route',
    selected: [{ skill_id: 'github', reason, confidence: 0.9 }],
    risk_class: riskClass, confirmation_required: true,
    plan_id: plan.id, plan: steps.map((step) => step.tool),
    payload_sha256: payloadSha256, expires_at: expiresAt,
    executable: false,
    note: 'Route decisions cannot be stored on this connection, so this plan cannot be executed here. Route again on a connection with decision storage to get an executable decision.'
  };
}

function keywordScores(intent) {
  const intentTokens = tokensOf(intent);
  if (!intentTokens.length) return { intentTokens, scored: [] };
  const scored = SKILLS_CATALOG.map((record) => {
    const tokens = RECORD_TOKENS.get(record.id);
    const matched = intentTokens.filter((token) => tokens.has(token)).length;
    return { record, score: matched / intentTokens.length };
  }).filter((entry) => entry.score > 0);
  scored.sort((a, b) => (b.score - a.score) || (a.record.id < b.record.id ? -1 : 1));
  return { intentTokens, scored };
}

async function routeIntent(args, ctx) {
  const intent = String(args.intent ?? '');
  const context = args.context ?? {};
  const explicit = matchExplicitId(intent);
  const planned = matchPlan(intent);

  // (b) A GitHub plan trigger: the executable path, unless the intent
  // explicitly named a different skill.
  if (planned && (!explicit || explicit.id === 'github')) {
    return planDecision({ plan: planned.plan, trigger: planned.trigger, context, ctx });
  }
  // (a) The intent names a catalog id (word boundary): select it.
  if (explicit) {
    return {
      decision: 'route',
      selected: [{ skill_id: explicit.id, reason: 'The intent names this skill id.', confidence: 0.97 }],
      risk_class: explicit.risk_class,
      confirmation_required: explicit.risk_class !== 'read',
      executable: false, execution: 'host',
      note: explicit.id === 'github'
        ? 'The GitHub skill executes in this server only as a named plan. Name the task (pr status, open a pr, or ci triage) with its repository context to get an executable plan.'
        : "Only GitHub-family plans execute in this server; other skills execute on David's host."
    };
  }
  // (c) Keyword scoring over the whole catalog.
  const { scored } = keywordScores(intent);
  const top = scored[0];
  if (!top || top.score < 0.4) {
    return { decision: 'ask', candidates: [], note: 'No skill in the catalog fits that intent closely enough to route it. Name a skill, or describe the task with the words the skill uses.' };
  }
  const candidates = scored.slice(0, 3).map(({ record, score }) => ({
    skill_id: record.id, score: Math.round(score * 1000) / 1000, risk_class: record.risk_class
  }));
  const second = scored[1];
  const nearTie = second && (top.score - second.score) < 0.1;
  if (top.score >= 0.75 && !nearTie) {
    return {
      decision: 'route',
      selected: [{ skill_id: top.record.id, reason: 'The intent words match this skill catalog record.', confidence: Math.round(top.score * 1000) / 1000 }],
      risk_class: top.record.risk_class,
      confirmation_required: top.record.risk_class !== 'read',
      executable: false, execution: 'host',
      note: "Only GitHub-family plans execute in this server; other skills execute on David's host."
    };
  }
  return { decision: 'ask', candidates, note: 'More than one skill could fit, or the fit is not strong enough to route without asking. Pick one of the candidates or add detail.' };
}

const search = defineRead({
  name: 'github_skills_search', area: 'skills', audience: ['B', 'O', 'Op'],
  description: "Search David Patton's skills catalog by task words; returns skill names, purposes and risk classes, never skill text.",
  properties: {
    query: { type: 'string', maxLength: 200, description: 'Task words to match against skill names, keywords and purposes' },
    category: { type: 'string', maxLength: 64, description: 'Only this catalog category' },
    maxRisk: { type: 'string', enum: [...RISK_ORDER], description: 'Highest risk class to include' }
  },
  handler: (args, ctx) => {
    const gate = skillsGate(ctx);
    if (gate) return gate;
    return searchSkills(args ?? {});
  }
});

const route = defineRead({
  name: 'github_skills_route', area: 'skills', audience: ['B', 'O', 'Op'],
  description: 'Plan a task against the skills catalog: the fitting skill, its risk class and, for GitHub work, the exact steps; runs nothing.',
  properties: {
    intent: { type: 'string', minLength: 3, maxLength: 500, description: 'The task, in the caller\'s words' },
    context: {
      type: 'object', additionalProperties: false,
      properties: {
        owner: { type: 'string', maxLength: 39 },
        repo: { type: 'string', maxLength: 100 },
        number: { type: 'integer', minimum: 1 },
        head: { type: 'string', maxLength: 250 },
        base: { type: 'string', maxLength: 250 },
        title: { type: 'string', maxLength: 256 },
        body: { type: 'string', maxLength: 20000 },
        draft: { type: 'boolean' },
        labels: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 100 } }
      }
    }
  },
  required: ['intent'],
  handler: async (args, ctx) => {
    const gate = skillsGate(ctx);
    if (gate) return gate;
    return routeIntent(args ?? {}, ctx);
  }
});

export const tools = [search.tool, route.tool];
export const handlers = { [search.tool.name]: search.handler, [route.tool.name]: route.handler };

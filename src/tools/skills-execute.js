// github_skills_execute (SKILLS-1): runs a routed GitHub skills plan from
// github_skills_route, step by step through this server's own guarded tools.
// The runner adds no write path of its own: every step goes through dispatch
// (ctx.callTool), so write steps keep their preview, confirmation, request
// key deduplication, change log and undo handling from defineWrite.
//
// The plan is bound to its payload hash. The route tool stored the decision
// with payload_sha256 = sha256 of the canonical { skill_id, plan_id, steps };
// a confirming call must restate that exact hash, so a plan cannot be
// previewed one way and confirmed another.
import { createHash } from 'node:crypto';
import { defineWrite } from '../core/write.js';
import { SKILLS_CATALOG } from '../data/skills-catalog.js';
import { PLAN_CORPUS } from '../skills/github-plans.js';

const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');
const nowMs = (ctx) => (typeof ctx?.now === 'function' ? ctx.now() : (typeof ctx?.now === 'number' ? ctx.now : Date.now()));
export const connectionKey = (ctx) => String(ctx?.connection?.client_id ?? ctx?.connection?.pass_id ?? '');

const normalizeText = (text) => String(text).toLowerCase().replace(/\s+/g, ' ').trim();
const OVERLAP_CORPUS = Object.freeze([
  ...PLAN_CORPUS,
  ...SKILLS_CATALOG.map((record) => record.description).filter((description) => typeof description === 'string' && description.length >= 40)
]);
const NORMALIZED_CORPUS = Object.freeze(OVERLAP_CORPUS.map((entry) => ({ entry, normalized: normalizeText(entry) })));

/**
 * The skill-text overlap check (anti-extraction, C05 section 6.5 layer 2):
 * returns the matched corpus string when `text` (at least 40 characters)
 * contains a corpus string, or is contained by one, after normalization
 * (lowercase, whitespace collapsed); otherwise null. Corpus entries are the
 * plan corpus plus catalog descriptions of at least 40 characters.
 */
export function findSkillTextOverlap(text) {
  if (typeof text !== 'string' || text.length < 40) return null;
  const normalized = normalizeText(text);
  if (normalized.length < 40) return null;
  for (const { entry, normalized: corpus } of NORMALIZED_CORPUS) {
    if (corpus.length < 40) continue;
    if (normalized.includes(corpus) || corpus.includes(normalized)) return entry;
  }
  return null;
}

const STOP_STATUSES = new Set(['refused', 'refused_by_guard', 'needs_confirmation', 'rejected']);

function refusal(ctx, error) {
  const body = { mode: ctx?.connection?.mode === 'production' ? 'PRODUCTION' : 'PREVIEW', done: false, status: 'refused', error };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
}

async function loadDecision(args, ctx) {
  const key = connectionKey(ctx);
  if (!key || typeof ctx?.db?.getRouteDecision !== 'function') return null;
  try { return await ctx.db.getRouteDecision(args.decisionId, key); } catch { return null; }
}

/**
 * Everything that must hold before the write lifecycle starts. defineWrite's
 * target() is synchronous, but loading the stored route decision is async,
 * so the exported handler runs this precheck first and only hands off to
 * the defineWrite handler when the decision is present, unconsumed,
 * executable and (for a confirming call) hash-bound. That is why the
 * exported handler is a wrapper rather than def.handler itself.
 */
async function precheck(args, ctx) {
  if (!connectionKey(ctx) || typeof ctx?.db?.getRouteDecision !== 'function') {
    return refusal(ctx, 'Route decisions are not available on this connection. Run github_skills_route again on a connection with decision storage.');
  }
  if (typeof ctx?.callTool !== 'function' || !ctx?.registry) {
    return refusal(ctx, 'The guarded tool dispatcher is unavailable, so this plan was refused.');
  }
  const row = await loadDecision(args, ctx);
  if (!row) return refusal(ctx, 'That route decision was not found or has expired. Run github_skills_route again.');
  if (row.consumed_at) return refusal(ctx, 'That route decision has already been used. Run github_skills_route again for a new one.');
  if (row.plan?.executable !== true || !Array.isArray(row.plan?.steps)) {
    return refusal(ctx, 'That route decision is not an executable plan. Run github_skills_route again.');
  }
  const stored = row.plan.context ?? {};
  if (stored.owner && args.owner && String(stored.owner).toLowerCase() !== String(args.owner).toLowerCase()) {
    return refusal(ctx, `The decision was routed for ${stored.owner}, not ${args.owner}. Run github_skills_route again for this account.`);
  }
  if (stored.repo && args.repo && String(stored.repo).toLowerCase() !== String(args.repo).toLowerCase()) {
    return refusal(ctx, `The decision was routed for ${stored.owner}/${stored.repo}, not ${args.owner}/${args.repo}. Run github_skills_route again for this repository.`);
  }
  if (args.confirm === true && args.dryRun !== true && args.payloadHash !== row.payload_sha256) {
    return refusal(ctx, 'The confirmation hash does not match the previewed plan. Nothing was sent. Route again and confirm with the payload_sha256 shown.');
  }
  return null;
}

/** Resolves a { $fromStep, field } placeholder from a prior step's body: the field, or the same field under its `result`. */
function resolveStepArgs(value, priorBodies) {
  if (Array.isArray(value)) return value.map((entry) => resolveStepArgs(entry, priorBodies));
  if (value && typeof value === 'object') {
    if (Number.isInteger(value.$fromStep) && typeof value.field === 'string') {
      const body = priorBodies[value.$fromStep];
      if (body && typeof body === 'object') {
        if (body[value.field] !== undefined) return body[value.field];
        if (body.result && typeof body.result === 'object' && body.result[value.field] !== undefined) return body.result[value.field];
      }
      return undefined;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveStepArgs(entry, priorBodies)]));
  }
  return value;
}

const def = defineWrite({
  name: 'github_skills_execute', area: 'skills', audience: ['B', 'O', 'Op'],
  description: 'Run a routed GitHub skills plan from github_skills_route, step by step through the guarded tools, bound to its payload hash.',
  properties: {
    decisionId: { type: 'string', minLength: 20, maxLength: 80, description: 'The task_id given by github_skills_route' },
    owner: { type: 'string', maxLength: 39, description: 'The GitHub account the plan was routed for' },
    repo: { type: 'string', maxLength: 100, description: 'The repository the plan was routed for' },
    payloadHash: { type: 'string', minLength: 64, maxLength: 64, description: 'The payload_sha256 shown by the route and the preview; required to confirm' }
  },
  required: ['decisionId', 'owner'],
  declarations: { production: 'never', confirm: 'always', cred: '—', profiles: ['everyday', 'full'] },
  target: (args) => ({ owner: args.owner, ...(args.repo ? { repo: args.repo } : {}), scope: 'skills plan' }),
  // defineWrite calls read positionally (args, ctx); accept that and the
  // object shape the other lifecycle functions receive, so either works.
  read: async (argsOrInput, ctxArg) => {
    const args = argsOrInput?.args ?? argsOrInput;
    const ctx = argsOrInput?.ctx ?? ctxArg;
    return loadDecision(args, ctx);
  },
  // The plan's own steps carry no classification of their own here: every
  // delegated tool re-reads, re-classifies and re-runs its own gates inside
  // dispatch when apply calls it, so this layer delegates classification to
  // the steps themselves.
  classify: () => ({}),
  summarize: ({ before }) => {
    if (!before?.plan) return 'Run a routed skills plan';
    const steps = Array.isArray(before.plan.steps) ? before.plan.steps.map((step) => step.tool).join(', ') : '';
    return `Run skills plan ${before.plan.plan_id} for ${before.skill_id} on ${before.plan.context?.owner ?? ''}/${before.plan.context?.repo ?? ''}: steps ${steps}. Confirmation payload sha256 ${before.payload_sha256}.`.slice(0, 1024);
  },
  apply: async ({ args, ctx, before }) => {
    const steps = Array.isArray(before?.plan?.steps) ? before.plan.steps : [];
    const priorBodies = [];
    const results = [];
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const resolvedArgs = resolveStepArgs(step.args ?? {}, priorBodies);
      const tool = ctx.registry?.tools?.find((entry) => entry.name === step.tool);
      const stepArgs = tool?.writes === true
        ? { ...resolvedArgs, dryRun: false, confirm: true, requestKey: `${args.decisionId}:${i}` }
        : resolvedArgs;
      const reply = await ctx.callTool(step.tool, stepArgs);
      const body = reply?.structuredContent ?? null;
      const status = typeof body?.status === 'string' ? body.status : (reply?.isError ? 'error' : 'ok');
      priorBodies.push(body);
      results.push({ tool: step.tool, status, result: body });
      if (reply?.isError || STOP_STATUSES.has(status)) break;
    }
    let consumed = false;
    if (typeof ctx.db?.consumeRouteDecision === 'function') {
      try {
        const row = await ctx.db.consumeRouteDecision(args.decisionId, connectionKey(ctx), { steps: results });
        consumed = Boolean(row);
      } catch { consumed = false; }
    }
    return { steps: results, consumed };
  },
  readAfter: async ({ args, ctx }) => loadDecision(args, ctx),
  verify: ({ after }) => Boolean(after?.consumed_at) && Array.isArray(after?.result?.steps),
  present: ({ before, after }) => {
    let withheld = false;
    const steps = (Array.isArray(after?.result?.steps) ? after.result.steps : []).map((step) => {
      if (step?.result === undefined || step?.result === null) return step;
      const hit = findSkillTextOverlap(JSON.stringify(step.result));
      if (!hit) return step;
      withheld = true;
      return { ...step, result: { withheld: 'A step result was withheld because it matched packaged skill text.' } };
    });
    return {
      decision_id: before?.id ?? after?.id ?? null,
      skill_id: before?.skill_id ?? after?.skill_id ?? null,
      plan_id: before?.plan?.plan_id ?? after?.plan?.plan_id ?? null,
      payload_sha256: before?.payload_sha256 ?? after?.payload_sha256 ?? null,
      steps,
      note: 'Changes made by steps are in the change log; undo one with github_undo_change.',
      ...(withheld ? { overlap_note: 'One or more step results were withheld by the skill-text overlap check.' } : {})
    };
  },
  inverse: () => null,
  explain: () => 'The skills plan could not be completed.',
  requestKey: (ctx, args) => `rmcp_github_skills_execute_${sha256Hex(`${args.decisionId}:${args.payloadHash ?? ''}`).slice(0, 32)}_${Math.floor(nowMs(ctx) / 600000)}`
});

const tool = Object.freeze({ ...def.tool, usesRegistry: true });

async function handler(args, ctx) {
  const problem = await precheck(args ?? {}, ctx);
  if (problem) return problem;
  return def.handler(args, ctx);
}

export const tools = [tool];
export const handlers = { [tool.name]: handler };

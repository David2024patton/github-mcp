// SKILLS-1, Lane 3: github_skills_execute runs a stored route decision step by step through the
// guarded tools (Decision S9/S11). Confirmation is bound to the exact plan: confirm:true plus the
// payloadHash route issued. A decision is consumed exactly once, and a step result that carries
// packaged skill text (a catalog description or a plan summary) is withheld by the overlap check.
// The delegated GitHub tools here are fakes built with the real factories (defineRead/defineWrite),
// so every step still passes the real dispatcher and the real write lifecycle.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import { defineRead } from '../../src/tools/define-read.js';
import { defineWrite } from '../../src/core/write.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import * as skillsModule from '../../src/tools/skills.js';
import * as skillsExecuteModule from '../../src/tools/skills-execute.js';
import { findSkillTextOverlap } from '../../src/tools/skills-execute.js';
import { SKILLS_CATALOG } from '../../src/data/skills-catalog.js';
import * as githubPlans from '../../src/skills/github-plans.js';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const clock = () => NOW;
const ENV = { SKILLS_CATALOG_ENABLED: 'enabled' };
const REFUSALS = ['refused', 'refused_by_guard'];

const parse = (result) => {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return { errorText: text }; }
};

/** Accept a Lane 1 module whether it exports the house {tools, handlers} pair or the named definitions. */
function moduleOf(mod, names) {
  if (Array.isArray(mod?.tools) && mod?.handlers) return mod;
  const defs = names.map((n) => mod?.[n]).filter((d) => d?.tool && d?.handler);
  return { tools: defs.map((d) => d.tool), handlers: Object.fromEntries(defs.map((d) => [d.tool.name, d.handler])) };
}

/** The house fake db plus the route-decision store of src/db.js, in memory, with the same semantics:
 *  getRouteDecision returns null when the row is expired or belongs to another connection;
 *  consumeRouteDecision returns null when the row is already consumed. The change-log surface
 *  (recordChange/claimChange/finishChange) is the house fake's own, as the write contract expects. */
function withRouteDecisions(db) {
  const decisions = new Map();
  const connKey = (c) => (typeof c === 'string' ? c : c?.client_id ?? c?.pass_id ?? null);
  const view = (row) => (row ? {
    id: row.id, connection: row.connection, skill_id: row.skill_id, plan: structuredClone(row.plan),
    risk_class: row.risk_class, payload_sha256: row.payload_sha256,
    expires_at: new Date(row.expires_at), consumed_at: row.consumed_at ? new Date(row.consumed_at) : null,
    result: row.result ? structuredClone(row.result) : null
  } : null);
  db.putRouteDecision = async ({ id, connection, skillId, plan, riskClass, payloadSha256, ttlMinutes = 30 }) => {
    const row = { id, connection: connKey(connection), skill_id: skillId, plan: structuredClone(plan ?? null),
      risk_class: riskClass, payload_sha256: payloadSha256, expires_at: clock() + ttlMinutes * 60_000, consumed_at: null, result: null };
    decisions.set(id, row);
    return view(row);
  };
  db.getRouteDecision = async (id, connection) => {
    const row = decisions.get(id);
    if (!row || row.connection !== connKey(connection) || row.expires_at <= clock()) return null;
    return view(row);
  };
  db.consumeRouteDecision = async (id, connection, result = null) => {
    const row = decisions.get(id);
    if (!row || row.connection !== connKey(connection) || row.expires_at <= clock() || row.consumed_at) return null;
    row.consumed_at = clock();
    row.result = result ?? null;
    return view(row);
  };
  /** Test seam: age a stored decision past its expiry. */
  db.__expireRouteDecision = (id) => { const row = decisions.get(id); if (row) row.expires_at = clock() - 1000; };
  return db;
}

/** The delegated tools of the pr_open / pr_status plans, faked in memory with the real factories. */
function makeFakeTools({ prGetBody = null } = {}) {
  const calls = { prGet: [], prCreateApply: [] };
  const prGet = defineRead({
    name: 'github_pr_get', description: 'Fake: read a pull request.', area: 'pr',
    properties: { owner: { type: 'string', maxLength: 39 }, repo: { type: 'string', maxLength: 100 }, number: { type: 'integer', minimum: 1 } },
    required: ['repo', 'number'],
    handler: async (args) => {
      calls.prGet.push({ ...args });
      return { number: 7, head_sha: 'abc', title: 'x', ...(prGetBody !== null ? { body: prGetBody } : {}) };
    }
  });
  const prCreate = defineWrite({
    name: 'github_pr_create', description: 'Fake: open a pull request.', area: 'pr',
    properties: {
      owner: { type: 'string', maxLength: 39 }, repo: { type: 'string', maxLength: 100 },
      head: { type: 'string', maxLength: 255 }, base: { type: 'string', maxLength: 255 },
      title: { type: 'string', maxLength: 256 }, body: { type: 'string', maxLength: 10000 }, draft: { type: 'boolean' }
    },
    required: ['repo', 'head', 'title'],
    declarations: { production: 'never', confirm: 'always', cred: '—', profiles: ['everyday', 'full'] },
    target: (args, ctx) => ({ owner: args.owner ?? ctx.connection.default_account, repo: args.repo, scope: 'repo' }),
    read: async () => null,
    classify: () => ({}),
    summarize: ({ args }) => `Open a pull request "${args.title}" in ${args.owner ?? 'octo'}/${args.repo} from ${args.head}`,
    apply: async ({ args }) => { calls.prCreateApply.push({ ...args }); return { number: 7 }; },
    readAfter: async () => ({ number: 7 }),
    verify: ({ after }) => after?.number === 7,
    present: ({ after }) => ({ number: after.number }),
    requestKey: (ctx, args) => `rmcp_fake_pr_create_${createHash('sha256').update(JSON.stringify(args.requestKey ?? args)).digest('hex').slice(0, 32)}`
  });
  return { calls, module: { tools: [prGet.tool, prCreate.tool], handlers: { github_pr_get: prGet.handler, github_pr_create: prCreate.handler } } };
}

async function makeWorld({ prGetBody = null } = {}) {
  const db = withRouteDecisions(createFakeDb({ clock }));
  const fake = makeFakeTools({ prGetBody });
  const registry = mergeNamespaces([
    moduleOf(skillsModule, ['github_skills_search', 'github_skills_route']),
    moduleOf(skillsExecuteModule, ['github_skills_execute']),
    fake.module
  ]);
  const dispatch = createDispatch({ env: ENV, gates: [], now: clock });
  const connection = Object.freeze({ client_id: 'conn-1', accounts: Object.freeze(['octo']), profile: 'full', mode: 'preview' });
  const call = (name, args, conn = connection) => dispatch({ registry, name, args, connection: conn, db });
  return { db, dispatch, registry, connection, call, fake };
}

/** Route the pr_open plan against the mini registry and hand back the stored decision's public face. */
async function mintPrOpen(world) {
  const out = parse(await world.call('github_skills_route',
    { intent: 'open a pull request', context: { owner: 'octo', repo: 'demo', head: 'feat', title: 'Add thing' } }));
  expect(out.decision).toBe('route');
  expect(out.executable).toBe(true);
  expect(out.task_id).toMatch(/^skd_/);
  expect(out.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
  return out;
}

const findSteps = (value) => {
  if (Array.isArray(value?.steps)) return value.steps;
  for (const key of ['result', 'execution', 'outcome']) {
    if (value?.[key]) { const found = findSteps(value[key]); if (found) return found; }
  }
  return null;
};

/** A string of at least 40 characters from the packaged corpus: a plan summary or a catalog description. */
function plantedCorpusString() {
  const pool = [];
  const corpus = githubPlans.PLAN_CORPUS ?? null;
  if (Array.isArray(corpus)) pool.push(...corpus);
  else if (typeof corpus === 'string') pool.push(corpus);
  const plans = githubPlans.GITHUB_PLANS ?? githubPlans.PLANS ?? githubPlans.plans ?? [];
  if (Array.isArray(plans)) {
    for (const plan of plans) {
      if (typeof plan?.summary === 'string') pool.push(plan.summary);
      if (Array.isArray(plan?.steps)) for (const step of plan.steps) if (typeof step?.summary === 'string') pool.push(step.summary);
    }
  }
  for (const record of SKILLS_CATALOG) if (typeof record?.description === 'string') pool.push(record.description);
  return pool.find((s) => typeof s === 'string' && s.length >= 40) ?? null;
}

describe('github_skills_execute: registration', () => {
  it('is a defineWrite-v1 write that uses the registry, in the everyday and full profiles', () => {
    const def = skillsExecuteModule.github_skills_execute;
    const tool = def?.tool ?? moduleOf(skillsExecuteModule, ['github_skills_execute']).tools[0];
    expect(tool, 'github_skills_execute must be exported').toBeTruthy();
    expect(tool.name).toBe('github_skills_execute');
    expect(tool.writes).toBe(true);
    expect(tool.writeContract).toBe('defineWrite-v1');
    expect(tool.usesRegistry).toBe(true);
    expect(tool.declarations).toMatchObject({ production: 'never', confirm: 'always', cred: '—' });
    expect(tool.profiles).toEqual(['everyday', 'full']);
    for (const prop of ['decisionId', 'owner', 'payloadHash', 'dryRun', 'confirm', 'requestKey']) {
      expect(tool.inputSchema.properties).toHaveProperty(prop);
    }
  });
});

describe('github_skills_execute: refusals send nothing', () => {
  it('refuses an unknown decision id', async () => {
    const world = await makeWorld();
    const out = parse(await world.call('github_skills_execute', { decisionId: `skd_${'A'.repeat(22)}`, owner: 'octo', confirm: true, payloadHash: 'a'.repeat(64) }));
    expect(out.done).toBe(false);
    expect(REFUSALS).toContain(out.status);
    expect(world.fake.calls.prCreateApply).toEqual([]);
    expect(world.fake.calls.prGet).toEqual([]);
  });

  it('refuses a decision that belongs to another connection', async () => {
    const world = await makeWorld();
    const decision = await mintPrOpen(world);
    const stranger = Object.freeze({ client_id: 'conn-2', accounts: Object.freeze(['octo']), profile: 'full', mode: 'preview' });
    const out = parse(await world.call('github_skills_execute',
      { decisionId: decision.task_id, owner: 'octo', confirm: true, payloadHash: decision.payload_sha256 }, stranger));
    expect(out.done).toBe(false);
    expect(REFUSALS).toContain(out.status);
    expect(world.fake.calls.prCreateApply).toEqual([]);
    // and the decision is still there, unconsumed, for its own connection
    expect((await world.db.getRouteDecision(decision.task_id, 'conn-1'))?.consumed_at ?? null).toBeNull();
  });

  it('refuses an expired decision', async () => {
    const world = await makeWorld();
    const decision = await mintPrOpen(world);
    world.db.__expireRouteDecision(decision.task_id);
    expect(await world.db.getRouteDecision(decision.task_id, 'conn-1')).toBeNull();
    const out = parse(await world.call('github_skills_execute',
      { decisionId: decision.task_id, owner: 'octo', confirm: true, payloadHash: decision.payload_sha256 }));
    expect(out.done).toBe(false);
    expect(REFUSALS).toContain(out.status);
    expect(world.fake.calls.prCreateApply).toEqual([]);
  });

  it('refuses confirm:true without a payloadHash, and never calls the delegated write', async () => {
    const world = await makeWorld();
    const decision = await mintPrOpen(world);
    const out = parse(await world.call('github_skills_execute', { decisionId: decision.task_id, owner: 'octo', confirm: true }));
    expect(out.done).toBe(false);
    expect(REFUSALS).toContain(out.status);
    expect(world.fake.calls.prCreateApply).toEqual([]);
    expect((await world.db.getRouteDecision(decision.task_id, 'conn-1'))?.consumed_at ?? null).toBeNull();
  });

  it('refuses confirm:true with the wrong payloadHash, and never calls the delegated write', async () => {
    const world = await makeWorld();
    const decision = await mintPrOpen(world);
    const wrong = decision.payload_sha256.startsWith('0') ? 'f'.repeat(64) : '0'.repeat(64);
    const out = parse(await world.call('github_skills_execute',
      { decisionId: decision.task_id, owner: 'octo', confirm: true, payloadHash: wrong }));
    expect(out.done).toBe(false);
    expect(REFUSALS).toContain(out.status);
    expect(world.fake.calls.prCreateApply).toEqual([]);
    expect((await world.db.getRouteDecision(decision.task_id, 'conn-1'))?.consumed_at ?? null).toBeNull();
  });
});

describe('github_skills_execute: the confirmation flow', () => {
  it('first call asks for confirmation, and the preview names the payload sha256', async () => {
    const world = await makeWorld();
    const decision = await mintPrOpen(world);
    const out = parse(await world.call('github_skills_execute', { decisionId: decision.task_id, owner: 'octo' }));
    expect(out.done).toBe(false);
    expect(out.status).toBe('needs_confirmation');
    const previewText = out.preview ?? out.summary ?? '';
    expect(previewText).toContain(decision.payload_sha256);
    expect(world.fake.calls.prCreateApply).toEqual([]);
    expect((await world.db.getRouteDecision(decision.task_id, 'conn-1'))?.consumed_at ?? null).toBeNull();
  });

  it('dryRun previews only: nothing is called and the decision is not consumed', async () => {
    const world = await makeWorld();
    const decision = await mintPrOpen(world);
    const out = parse(await world.call('github_skills_execute', { decisionId: decision.task_id, owner: 'octo', dryRun: true }));
    expect(out.done).toBe(false);
    expect(out.status).toBe('preview');
    expect(world.fake.calls.prCreateApply).toEqual([]);
    expect((await world.db.getRouteDecision(decision.task_id, 'conn-1'))?.consumed_at ?? null).toBeNull();
  });

  it('confirm:true with the correct hash runs the steps once, in order, and consumes the decision exactly once', async () => {
    const world = await makeWorld();
    const decision = await mintPrOpen(world);
    const out = parse(await world.call('github_skills_execute',
      { decisionId: decision.task_id, owner: 'octo', confirm: true, payloadHash: decision.payload_sha256 }));
    expect(out.done).toBe(true);
    expect(out.status).toBe('applied');

    // the delegated write ran exactly once, confirmed, under the decision-scoped request key
    expect(world.fake.calls.prCreateApply).toHaveLength(1);
    expect(world.fake.calls.prCreateApply[0].confirm).toBe(true);
    expect(world.fake.calls.prCreateApply[0].requestKey).toMatch(new RegExp(`^${decision.task_id}:\\d+$`));
    expect(world.fake.calls.prCreateApply[0]).toMatchObject({ owner: 'octo', repo: 'demo', head: 'feat', title: 'Add thing' });

    // the result envelope carries per-step statuses
    const steps = findSteps(out);
    expect(Array.isArray(steps), 'the execute result must carry per-step statuses').toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(steps)).toContain('github_pr_create');
    expect(JSON.stringify(steps)).toMatch(/applied|ok|completed/);

    // consumed exactly once: a second execute refuses and sends nothing more
    expect((await world.db.getRouteDecision(decision.task_id, 'conn-1'))?.consumed_at).not.toBeNull();
    const again = parse(await world.call('github_skills_execute',
      { decisionId: decision.task_id, owner: 'octo', confirm: true, payloadHash: decision.payload_sha256 }));
    expect(again.done).toBe(false);
    expect(REFUSALS).toContain(again.status);
    expect(world.fake.calls.prCreateApply).toHaveLength(1);
  });
});

describe('the overlap check (findSkillTextOverlap)', () => {
  it('returns the matched corpus string for a hit and null for a miss', () => {
    const planted = plantedCorpusString();
    expect(planted, 'a corpus string of at least 40 characters must be derivable from the packaged plans or catalog').toBeTruthy();
    const hit = findSkillTextOverlap(`An ordinary lead-in sentence. ${planted} And a short tail.`);
    expect(typeof hit).toBe('string');
    expect(hit.length).toBeGreaterThanOrEqual(40);
    expect(planted).toContain(hit);
    expect(findSkillTextOverlap('The quick brown fox jumps over the lazy dog near the river bank at dawn.')).toBeNull();
    expect(findSkillTextOverlap('')).toBeNull();
  });

  it('withholds a step result that carries corpus text from the execute reply', async () => {
    const planted = plantedCorpusString();
    expect(planted).toBeTruthy();
    const world = await makeWorld({ prGetBody: planted });
    const decision = parse(await world.call('github_skills_route',
      { intent: 'pull request status', context: { owner: 'octo', repo: 'demo', number: 7 } }));
    expect(decision.decision).toBe('route');
    expect(decision.plan_id).toBe('pr_status');
    expect(decision.executable).toBe(true);

    let out = parse(await world.call('github_skills_execute', { decisionId: decision.task_id, owner: 'octo' }));
    if (out.status === 'needs_confirmation') {
      out = parse(await world.call('github_skills_execute',
        { decisionId: decision.task_id, owner: 'octo', confirm: true, payloadHash: decision.payload_sha256 }));
    }
    // the read step really ran, but its corpus-carrying body never reaches the caller
    expect(world.fake.calls.prGet.length).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(out);
    expect(json).not.toContain(planted);
    expect(json.toLowerCase()).toContain('withheld');
  });
});

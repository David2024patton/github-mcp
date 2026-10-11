// The write contract (B-1). Contract-generic: nothing here knows about GitHub, so the hub can extract it later.
// Every tool that changes something is built with `defineWrite`. The order is fixed and cannot be skipped by a tool:
//   plan (read the target) -> target -> classify (fails closed) -> guards -> preview -> dry run? -> confirmation? ->
//   claim the request key (a repeat returns the stored outcome) -> apply -> read back -> verify -> finish the log row.
// Guards (production, protected resources, people, spend: B-2..B-4) are plain functions that return nothing, `{ refuse }`
// or `{ confirm }`; they come from the server (`ctx.guards`) and from the tool (`spec.guards`).

const DECLARED = Object.freeze(['always', 'when-target', 'never']);

const flag = (value, name) => {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be true or false.`);
  return value;
};

const failure = (error) => String(error?.message ?? error ?? 'unknown error').slice(0, 300);

/** Never trusted from a tool: anything missing is "none", and a non-list `notifies` is treated as unknown people. */
function normalizeClass(raw) {
  const notifies = Array.isArray(raw?.notifies) ? raw.notifies.map(String) : raw?.notifies ? ['unknown'] : [];
  const spend = Number(raw?.spendCents ?? 0);
  return { production: !!raw?.production, accessWidening: !!raw?.accessWidening, notifies, spendCents: Number.isFinite(spend) && spend > 0 ? Math.round(spend) : 0 };
}

const FAIL_CLOSED = Object.freeze({ production: true, accessWidening: true, notifies: ['unknown'], spendCents: 0 });

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

/** Plain-English marks appended to the preview sentence. */
export function marksFor(c) {
  const marks = [];
  if (c.production) marks.push('PRODUCTION.');
  if (c.accessWidening) marks.push('ACCESS CHANGE.');
  if (c.notifies.length) marks.push(`NOTIFIES ${c.notifies.join(', ')}.`);
  if (c.spendCents > 0) marks.push(`COSTS ${dollars(c.spendCents)}.`);
  return marks;
}

/**
 * @param {object} spec
 *   name, description, inputSchema ({ type:'object', properties }), area, profiles, cred
 *   production: 'always'|'when-target'|'never', accessWidening, notifies, spend (booleans): declarations checked by B-7
 *   plan(args, ctx) -> { before }        reads the target first; a failed read stops the write
 *   target(args, ctx, plan) -> object    what is touched (feeds the guards)
 *   classify(args, ctx, plan, target) -> { production, accessWidening, notifies[], spendCents }   computed, never from arguments
 *   summary(args, ctx, plan, target) -> string   one plain-English sentence naming the target
 *   apply(args, ctx, plan, target) -> { result?, requestId? }
 *   readAfter(args, ctx, plan, applied, target) -> after      verify(args, ctx, plan, after, applied) -> boolean | { ok, warning }
 *   inverse(args, before, after) -> { tool, args } | null
 *   guards: [({ name, args, ctx, plan, target, classification }) => void | { refuse: { code, message } } | { confirm: string }]
 * @returns {{ tool: object, handler: Function }} handler(args, ctx) with ctx = { connection, db|store, requestKey?, guards? }
 */
export function defineWrite(spec) {
  for (const field of ['name', 'description', 'summary', 'apply']) {
    if (!spec?.[field]) throw new TypeError(`defineWrite: ${field} is required.`);
  }
  if (!DECLARED.includes(spec.production)) throw new TypeError(`defineWrite ${spec.name}: production must be one of ${DECLARED.join(', ')}.`);
  for (const field of ['accessWidening', 'notifies', 'spend']) {
    if (typeof spec[field] !== 'boolean') throw new TypeError(`defineWrite ${spec.name}: ${field} must be declared true or false.`);
  }
  if (spec.spend && !spec.classify) throw new TypeError(`defineWrite ${spec.name}: a tool that spends money must classify its price.`);

  const properties = {
    ...(spec.inputSchema?.properties ?? {}),
    dryRun: { type: 'boolean', description: 'Preview only: say what would change, change nothing' },
    confirm: { type: 'boolean', description: 'Set true after the owner agrees, when the preview asks for it' },
    requestKey: { type: 'string', maxLength: 120, description: 'Optional: same value = same change, never applied twice' }
  };
  const tool = {
    name: spec.name, description: spec.description, area: spec.area, profiles: spec.profiles, cred: spec.cred,
    inputSchema: { ...(spec.inputSchema ?? { type: 'object' }), type: 'object', properties, additionalProperties: false },
    writes: true,
    production: spec.production, accessWidening: spec.accessWidening, notifies: spec.notifies, spend: spec.spend,
    writeContract: Object.freeze({ production: spec.production, accessWidening: spec.accessWidening, notifies: spec.notifies, spend: spec.spend, hasInverse: !!spec.inverse })
  };

  async function handler(args = {}, ctx) {
    const dryRun = flag(args.dryRun, 'dryRun');
    const confirm = flag(args.confirm, 'confirm');
    const store = ctx.store ?? ctx.db;
    const banner = ctx.connection?.mode === 'production' ? 'PRODUCTION' : 'PREVIEW';

    const plan = (await spec.plan?.(args, ctx)) ?? { before: null };
    const target = (await spec.target?.(args, ctx, plan)) ?? {};
    let classification;
    try {
      classification = normalizeClass(await spec.classify?.(args, ctx, plan, target));
    } catch {
      classification = { ...FAIL_CLOSED }; // cannot tell what this touches: treat it as the most serious kind
    }
    if (spec.production === 'always') classification.production = true;

    const confirmReasons = [];
    for (const guard of [...(ctx.guards ?? []), ...(spec.guards ?? [])]) {
      let verdict;
      try {
        verdict = await guard({ name: spec.name, args, ctx, plan, target, classification });
      } catch {
        return { ok: false, status: 'refused_by_guard', mode: banner, code: 'guard_error', message: 'A safety check could not finish, so nothing was changed.' };
      }
      if (verdict?.refuse) return { ok: false, status: 'refused_by_guard', mode: banner, code: verdict.refuse.code ?? 'refused', message: verdict.refuse.message };
      if (verdict?.confirm) confirmReasons.push(String(verdict.confirm));
    }

    const sentence = String(await spec.summary(args, ctx, plan, target));
    const marks = marksFor(classification);
    const preview = [sentence.replace(/\s+$/, ''), ...marks].join(' ');
    const reasons = [
      ...(classification.production ? ['production'] : []), ...(classification.accessWidening ? ['access change'] : []),
      ...(classification.notifies.length ? ['notifies people'] : []), ...(classification.spendCents > 0 ? ['costs money'] : []), ...confirmReasons
    ];
    const needsConfirm = reasons.length > 0;
    const owner = target.owner ?? null;
    const logRow = (requestKey) => ({
      account: owner, repo: target.repo ?? null, mode: ctx.connection?.mode ?? null, connection: ctx.connection?.client_id ?? null, tool: spec.name,
      target: target.label ?? [owner, target.repo, target.ref].filter(Boolean).join('/'), summary: preview, before: plan.before,
      production: classification.production, accessWidening: classification.accessWidening, notifies: classification.notifies,
      spendCents: classification.spendCents || null, requestKey
    });
    const key = (spec.requestKey ?? ctx.requestKey)(ctx, spec.name, args);

    if (dryRun) {
      const changeId = await store.addChangePreview(logRow(key));
      return { ok: true, status: 'preview', mode: banner, preview, needs_confirm: needsConfirm, reasons, change_id: changeId };
    }
    if (needsConfirm && !confirm) {
      return {
        ok: true, status: 'confirmation_required', mode: banner, preview, reasons,
        message: 'Nothing was changed. Ask the owner first, then call again with confirm: true.'
      };
    }

    const claim = await store.claimChange(logRow(key));
    if (!claim.claimed) {
      const prior = claim.existing;
      if (prior.confirmed == null) {
        return { ok: true, status: 'in_progress', replayed: true, mode: banner, preview: prior.summary, change_id: prior.id, message: 'This same change was already started and is not finished. It was not repeated; check again shortly.' };
      }
      const failed = prior.after?.error;
      return {
        ok: !failed, status: 'replayed', replayed: true, mode: banner, preview: prior.summary, confirmed: prior.confirmed === true, after: prior.after, change_id: prior.id,
        ...(failed ? { message: `The earlier attempt failed (${failed}). It was not repeated. Use a new requestKey to try again.` } : {})
      };
    }

    let applied;
    try {
      applied = (await spec.apply(args, ctx, plan, target)) ?? {};
    } catch (error) {
      await store.finishChange(claim.id, { after: { error: failure(error) }, confirmed: false, githubRequestId: error?.requestId ?? null });
      throw error;
    }

    let after = applied.result ?? null;
    let ok = true;
    let warning;
    try {
      if (spec.readAfter) after = await spec.readAfter(args, ctx, plan, applied, target);
      if (spec.verify) {
        const verdict = await spec.verify(args, ctx, plan, after, applied);
        ok = typeof verdict === 'object' && verdict ? !!verdict.ok : !!verdict;
        if (!ok) warning = (verdict && verdict.warning) || 'The change was sent, but reading it back did not show what was expected. Check it before relying on it.';
      }
    } catch (error) {
      ok = false;
      warning = `The change was sent, but it could not be read back (${failure(error)}). Check it before relying on it.`;
    }
    let inverse = null;
    try { inverse = spec.inverse?.(args, plan.before, after) ?? null; } catch { inverse = null; }
    await store.finishChange(claim.id, { after, confirmed: ok, githubRequestId: applied.requestId ?? null, inverse });
    return {
      ok: true, status: 'applied', mode: banner, preview, confirmed: ok, replayed: false, after, change_id: claim.id,
      ...(warning ? { warning } : {}), ...(inverse ? { undo_available: true } : {})
    };
  }

  return { tool, handler };
}

// PAR-1: GitHub Code Quality findings (two reads) and its repository setup (one guarded write).
// The text comes from GitHub's own analysis, not from a person, so it is not marked untrusted; the normal result shaping still
// redacts token-shaped text. Endpoints are the pinned `code-quality/*` operations.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain, readerFor } from './github-read.js';
import { octo, ownerOf, refusal } from './github-write.js';
import { cap, LOGIN, REPO_NAME } from './public-read.js';

const OWNER = { ...LOGIN, description: 'Connected account (default account)' };
const FINDINGS = '/repos/{owner}/{repo}/code-quality/findings';
const SETUP = '/repos/{owner}/{repo}/code-quality/setup';
const LANGUAGES = ['csharp', 'go', 'java-kotlin', 'javascript-typescript', 'python', 'ruby'];
const NOT_ON = (owner, repo) => `Code quality is not turned on for ${owner}/${repo}, or this account cannot see it.`;

/** GitHub answers 403/404 when the feature is off or not visible; say that plainly instead of a bare status. */
async function quality(owner, repo, run) {
  try { return await run(); } catch (error) {
    if ([403, 404].includes(error?.status)) throw new TypeError(NOT_ON(owner, repo));
    throw error;
  }
}
const nextCursor = (headers) => {
  const match = /<[^>]*[?&]after=([^&>]+)[^>]*>\s*;\s*rel="next"/.exec(headers?.link ?? '');
  return match ? decodeURIComponent(match[1]) : null;
};
export const shapeFinding = (f, messageMax) => ({
  number: f.number, state: f.state,
  rule: { id: f.rule?.id ?? null, title: cap(f.rule?.title, 200), severity: f.rule?.severity ?? null, category: f.rule?.category ?? null },
  path: f.location?.path ?? null, start_line: f.location?.start_line ?? null, end_line: f.location?.end_line ?? null,
  message: cap(f.message?.text, messageMax), url: f.url ?? null, created_at: f.created_at ?? null
});
const shapeSetup = (s) => ({
  state: s?.state ?? 'not-configured', languages: s?.languages ?? [], runnerType: s?.runner_type ?? null, runnerLabel: s?.runner_label ?? null,
  aiFindingsOption: s?.ai_findings_option ?? null, schedule: s?.schedule ?? null, updatedAt: s?.updated_at ?? null
});

const list = defineRead({
  name: 'github_code_quality_list', area: 'code_quality', audience: ['B', 'O', 'Op'],
  description: 'List GitHub Code Quality findings (maintainability and reliability problems) in a repository, open or dismissed.',
  properties: { owner: OWNER, repo: REPO_NAME, state: { type: 'string', enum: ['open', 'dismissed'] }, max: { type: 'integer', minimum: 1, maximum: 100, description: 'How many (default 30)' },
    after: { type: 'string', maxLength: 200, description: 'Cursor from a previous answer\'s next' }, before: { type: 'string', maxLength: 200 } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const res = await quality(owner, args.repo, () => octokit.request(`GET ${FINDINGS}`, { owner, repo: args.repo, per_page: args.max ?? 30,
      ...(args.state ? { state: args.state } : {}), ...(args.after ? { after: args.after } : {}), ...(args.before ? { before: args.before } : {}) }));
    const next = nextCursor(res.headers);
    return { owner, repo: args.repo, count: (res.data ?? []).length, items: (res.data ?? []).map((f) => shapeFinding(f, 300)), ...(next ? { next } : {}) };
  })
});

const get = defineRead({
  name: 'github_code_quality_get', area: 'code_quality', audience: ['B', 'O'],
  description: 'Read one Code Quality finding by number, or with setup: true the repository\'s Code Quality setup (state, languages, runner).',
  properties: { owner: OWNER, repo: REPO_NAME, number: { type: 'integer', minimum: 1, description: 'Finding number' }, setup: { type: 'boolean', description: 'Read the setup instead of a finding' } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    if (!args.setup && !args.number) throw new TypeError('Give the finding number, or setup: true.');
    const { owner, octokit } = await readerFor(args, ctx);
    if (args.setup) {
      const data = (await quality(owner, args.repo, () => octokit.request(`GET ${SETUP}`, { owner, repo: args.repo }))).data;
      return { owner, repo: args.repo, setup: shapeSetup(data) };
    }
    const data = (await quality(owner, args.repo, () => octokit.request(`GET ${FINDINGS}/{finding_number}`, { owner, repo: args.repo, finding_number: args.number }))).data;
    return { owner, repo: args.repo, ...shapeFinding(data, 2000) };
  })
});

const sorted = (a) => [...(a ?? [])].sort().join('\u0000');
const readSetup = async (ctx, t) => {
  const data = (await quality(t.owner, t.repo, async () => (await (await octo(ctx, t.owner)).request(`GET ${SETUP}`, { owner: t.owner, repo: t.repo })).data));
  return shapeSetup(data);
};
const setup = defineGithubWrite({
  name: 'github_code_quality_setup', area: 'code_quality', audience: ['O'],
  description: 'Turn GitHub Code Quality on or off for a repository, or change its languages, runner or AI findings. Scans may use Actions minutes.',
  properties: { owner: OWNER, repo: REPO_NAME, state: { type: 'string', enum: ['configured', 'not-configured'] },
    languages: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', enum: LANGUAGES } },
    runnerType: { type: 'string', enum: ['standard', 'labeled'] }, runnerLabel: { type: 'string', maxLength: 100 }, aiFindingsOption: { type: 'string', enum: ['disabled', 'on_push'] } },
  required: ['repo'],
  declarations: { production: 'always', confirm: 'always', cred: 'I', profiles: ['full'], spend: true },
  target: (args, ctx) => {
    if (args.state === undefined && args.languages === undefined && args.runnerType === undefined && args.runnerLabel === undefined && args.aiFindingsOption === undefined)
      throw new TypeError('Give at least one setting to change (state, languages, runnerType, runnerLabel or aiFindingsOption).');
    return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' };
  },
  read: (args, ctx, t) => readSetup(ctx, t),
  price: ({ args, before }) => (args.state === 'configured' && before.state !== 'configured' ? null : 0),
  classify: ({ args }) => ({ production: args.state === 'not-configured' ? 'switching Code Quality off stops its maintainability and reliability checks' : 'changes how the repository\'s code is analysed' }),
  summarize: ({ args, target: t, before }) => `Code Quality setup for ${t.owner}/${t.repo}: ${before.state}${args.state ? ` -> ${args.state}` : ''}${args.languages ? `, languages ${args.languages.join(', ')}` : ''}${args.aiFindingsOption ? `, AI findings ${args.aiFindingsOption}` : ''}${args.state === 'configured' && before.state !== 'configured' ? ' - scans may use Actions minutes; the future cost is not capped' : ''}`,
  apply: async ({ args, ctx, target: t, before }) => {
    const same = (args.state === undefined || args.state === before.state) && (args.languages === undefined || sorted(args.languages) === sorted(before.languages))
      && (args.runnerType === undefined || args.runnerType === before.runnerType) && (args.runnerLabel === undefined || args.runnerLabel === before.runnerLabel)
      && (args.aiFindingsOption === undefined || args.aiFindingsOption === before.aiFindingsOption);
    if (same) throw refusal('Code Quality setup already matches; nothing to do.');
    return quality(t.owner, t.repo, async () => (await octo(ctx, t.owner)).request(`PATCH ${SETUP}`, { owner: t.owner, repo: t.repo,
      ...(args.state ? { state: args.state } : {}), ...(args.languages ? { languages: args.languages } : {}), ...(args.runnerType ? { runner_type: args.runnerType } : {}),
      ...(args.runnerLabel !== undefined ? { runner_label: args.runnerLabel } : {}), ...(args.aiFindingsOption ? { ai_findings_option: args.aiFindingsOption } : {}) }));
  },
  readAfter: ({ ctx, target: t }) => readSetup(ctx, t),
  verify: ({ args, after }) => (args.state === undefined || after.state === args.state) && (args.languages === undefined || args.languages.every((l) => after.languages.includes(l)))
    && (args.runnerType === undefined || after.runnerType === args.runnerType) && (args.runnerLabel === undefined || after.runnerLabel === args.runnerLabel)
    && (args.aiFindingsOption === undefined || after.aiFindingsOption === args.aiFindingsOption),
  inverse: ({ args, before, target: t }) => ({ tool: 'github_code_quality_setup', args: { owner: t.owner, repo: t.repo, state: before.state,
    ...(args.languages !== undefined && before.languages.length ? { languages: before.languages } : {}),
    ...(args.runnerType !== undefined && before.runnerType ? { runnerType: before.runnerType } : {}),
    ...(args.runnerLabel !== undefined && before.runnerLabel ? { runnerLabel: before.runnerLabel } : {}),
    ...(args.aiFindingsOption !== undefined && before.aiFindingsOption ? { aiFindingsOption: before.aiFindingsOption } : {}) } }),
  present: ({ after }) => ({ setup: after, note: 'GitHub starts the first analysis in the background.' })
});

export const tools = [list.tool, get.tool, setup.tool];
export const handlers = { [list.tool.name]: list.handler, [get.tool.name]: get.handler, [setup.tool.name]: setup.handler };

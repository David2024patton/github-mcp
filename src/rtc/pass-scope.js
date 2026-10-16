// R-1: what a scoped service pass may do. Pure functions only: the same rules are checked when a pass is issued (validateGrant),
// every time the HTTPS door authenticates it (connectionFromPass) and on every tool call, including calls a workflow makes on
// the pass's behalf (passRefusal, used inside the dispatcher). A pass never widens: each refusal here is final for that call.
import { areaOf } from '../core/meta.js';

export const PASS_PROFILES = Object.freeze(['read_only', 'everyday', 'full']);
export const PASS_MODES = Object.freeze(['preview', 'production']);
export const DEFAULT_RATE_PER_MINUTE = 120;
export const MAX_RATE_PER_MINUTE = 600;
export const MAX_DAYS = 30;
export const MAX_HUB_DAYS = 365;
const AREA = /^[a-z][a-z0-9-]{1,30}$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
// The owner's own controls are never available to a pass, whatever its areas.
const SERVER_READS_FOR_REPO_PASSES = new Set(['github_whoami', 'github_get_result', 'github_rate_status']);
const lower = (value) => String(value).toLowerCase();

const fail = (message) => { throw new TypeError(message); };

/** Checks and normalises what a pass may do. `account` is the one GitHub account the pass belongs to. */
export function validateGrant(input = {}, account) {
  const profile = input.profile ?? 'read_only';
  const mode = input.mode ?? 'preview';
  if (!PASS_PROFILES.includes(profile)) fail(`The profile must be one of ${PASS_PROFILES.join(', ')}.`);
  if (!PASS_MODES.includes(mode)) fail('The mode must be preview or production.');
  const allowWrites = input.allowWrites === true;
  const allowAccessChanges = input.allowAccessChanges === true;
  const moneyLimitCents = input.moneyLimitCents ?? 0;
  if (!Number.isSafeInteger(moneyLimitCents) || moneyLimitCents < 0) fail('The spend allowance must be a whole number of cents, zero or more.');
  if (profile === 'read_only' && (allowWrites || allowAccessChanges || moneyLimitCents > 0)) fail('A read-only pass cannot write, change access or spend. Choose the everyday or full profile for that.');
  if (profile !== 'read_only' && !allowWrites && (allowAccessChanges || moneyLimitCents > 0)) fail('Access changes and a spend allowance need writes to be allowed.');
  if (allowAccessChanges && !allowWrites) fail('Access changes need writes to be allowed.');
  if (mode === 'production' && (!allowWrites || profile === 'read_only')) fail('A production pass exists to make changes: allow writes and choose the everyday or full profile.');
  const forHub = input.forHub === true;
  const days = input.days ?? 1;
  if (!Number.isInteger(days) || days < 1 || days > (forHub ? MAX_HUB_DAYS : MAX_DAYS)) {
    fail(forHub ? `A pass for Robinson's Toolkit lasts 1 to ${MAX_HUB_DAYS} days.` : `A pass lasts 1 to ${MAX_DAYS} days; only a pass marked for Robinson's Toolkit may last longer.`);
  }
  const ratePerMinute = input.ratePerMinute ?? DEFAULT_RATE_PER_MINUTE;
  if (!Number.isInteger(ratePerMinute) || ratePerMinute < 1 || ratePerMinute > MAX_RATE_PER_MINUTE) fail(`The request limit must be a whole number from 1 to ${MAX_RATE_PER_MINUTE} per minute.`);
  let areas = null;
  if (input.areas !== undefined && input.areas !== null) {
    if (!Array.isArray(input.areas) || input.areas.length > 40 || input.areas.some((a) => typeof a !== 'string' || !AREA.test(a))) fail('Areas must be a short list of area names such as pr or issue.');
    areas = [...new Set(input.areas)].sort();
    if (!areas.length) areas = null;
  }
  let repos = null;
  if (input.repos !== undefined && input.repos !== null) {
    if (!Array.isArray(input.repos) || input.repos.length > 50 || input.repos.some((r) => typeof r !== 'string' || !REPO.test(r))) fail('Repositories must be a short list written owner/name.');
    if (input.repos.some((r) => lower(r.split('/')[0]) !== lower(account))) fail(`A pass can only name repositories of ${account}.`);
    repos = [...new Set(input.repos.map(lower))].sort();
    if (!repos.length) repos = null;
  }
  return { profile, mode, areas, repos, allowWrites, allowAccessChanges, moneyLimitCents, forHub, days, ratePerMinute };
}

/** The connection a grant-bearing pass row stands for. Its restrictions are the pass's own and are never copied from anywhere else. */
export function connectionFromPass(row) {
  const g = row.grant;
  return Object.freeze({
    client_id: row.client_id, default_account: row.default_account, accounts: Object.freeze([row.default_account]),
    mode: row.mode, profile: row.profile, listing: row.listing ?? 'compact', pass: true, for_hub: g.for_hub === true,
    areas: g.areas ? Object.freeze([...g.areas]) : null, repos: g.repos ? Object.freeze([...g.repos]) : null,
    allow_writes: g.allow_writes === true, allow_access_changes: g.allow_access_changes === true,
    spend_limit_cents: Number(g.money_limit_cents) || 0
  });
}

const makesChanges = (tool) => tool.writes === true || (tool.passthrough === true && Array.isArray(tool.delegatedWrites) && tool.delegatedWrites.length > 0);
const repoSlug = (args, connection) => (typeof args?.repo === 'string' ? `${lower(args.owner ?? connection.default_account)}/${lower(args.repo)}` : null);

/** Why this pass may not run this tool with these arguments, or null. Applies to every call the pass causes, nested ones included. */
export function passRefusal({ tool, args, connection, listing = false }) {
  if (connection?.pass !== true) return null;
  const area = areaOf(tool);
  if (area === 'server' && (makesChanges(tool) || tool.usesRegistry === true)) return 'Owner controls are not available to a pass.';
  if (makesChanges(tool) && connection.allow_writes !== true) return 'This pass is read-only.';
  if (Array.isArray(connection.areas) && !['server', 'meta'].includes(area) && !connection.areas.includes(area)) return `This pass does not include the ${area} area.`;
  if (Array.isArray(connection.repos)) {
    if (area === 'server' || area === 'meta') return SERVER_READS_FOR_REPO_PASSES.has(tool.name) ? null : 'This pass is limited to named repositories; this tool is not repository-specific.';
    if (!tool.inputSchema?.properties?.repo) return 'This pass is limited to named repositories; this tool is not repository-specific.';
    if (listing) return null;
    const slug = repoSlug(args, connection);
    if (!slug || !connection.repos.includes(slug)) return 'That repository is outside this pass.';
  }
  return null;
}

/** The tools a grant-bearing pass is offered over HTTPS: its profile's tools minus whatever passRefusal rules out for any arguments. */
export function passTools(tools, connection) {
  return tools.filter((tool) => !(areaOf(tool) === 'meta' && tool.usesRegistry === true) && !passRefusal({ tool, args: {}, connection, listing: true }));
}

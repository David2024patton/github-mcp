// AUTH-1: read-only. Lists every tool that can cost money, is production-class or is destructive, and every dashboard setting that is
// provider-UI-only, so docs/audits/END-USER-AUTHORITY-2026-10.md can be checked against the code. Calls nothing, changes nothing.
// Usage: node scripts/authority-audit.mjs [--markdown]
import { registry } from '../src/tools/index.js';
import { SETTINGS } from '../src/data/dashboard-map.js';

const tools = registry.tools;
const row = (t) => ({ tool: t.name, area: t.area, credential: t.declarations?.cred ?? null, spend: t.declarations?.spend === true,
  production: t.declarations?.production ?? 'never', accessWidening: t.declarations?.accessWidening === true,
  confirm: t.declarations?.confirm ?? null, changesGitHub: t.annotations?.readOnlyHint === false, destructive: t.annotations?.destructiveHint === true });
const spend = tools.filter((t) => t.declarations?.spend).map(row);
const out = {
  totals: { tools: tools.length, canCostMoney: spend.length, productionAlways: tools.filter((t) => t.declarations?.production === 'always').length,
    destructive: tools.filter((t) => t.annotations?.destructiveHint).length },
  spendTools: spend,
  providerUiOnly: SETTINGS.filter((s) => s.apiAvailable === false).map((s) => ({ id: s.id, scope: s.scope, reason: s.reason }))
};
if (process.argv.includes('--markdown')) {
  console.log('| tool | area | credential | production | widens access | changes GitHub |\n|---|---|---|---|---|---|');
  for (const r of spend) console.log(`| \`${r.tool}\` | ${r.area} | ${r.credential} | ${r.production} | ${r.accessWidening ? 'yes' : 'no'} | ${r.changesGitHub ? 'yes' : 'no'} |`);
} else console.log(JSON.stringify(out, null, 2));

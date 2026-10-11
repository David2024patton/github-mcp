// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-writes.mjs @ e2f90e8; completed for B-7.
// Every registered write tool must (1) offer dryRun and confirm, (2) be built with defineWrite and carry its declarations,
// (3) give a price function when it spends money, and (4) match its row in docs/TOOL-CATALOG.md: the catalog's Safety, Cred
// and Profile cells and the tool's own declarations must say the same thing. Every registered tool needs a catalog row.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Reads every tool row of the catalog: `{ name, safety, cred, profile, card }`. */
export function parseCatalog(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('| `github_')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length !== 8) continue;
    rows.set(cells[0].replace(/`/g, ''), { name: cells[0].replace(/`/g, ''), safety: cells[2], cred: cells[4], profile: cells[6], card: cells[7] });
  }
  return rows;
}

/** The marks in a Safety cell: `{ read, confirmAlways, prod, access, notifies, spend, preview }`. null for "as the tool". */
export function parseSafety(cell) {
  if (cell === 'as the tool') return null;
  if (cell === '—') return { read: true };
  const compact = cell.replace(/\s*\(always\)/, '');
  const parts = compact.split('·').map((p) => p.trim());
  return {
    read: false,
    confirmAlways: parts.includes('C'),
    preview: parts.includes('P'),
    prod: parts.includes('Prod') ? 'always' : parts.includes('Prod*') ? 'when-target' : 'never',
    access: parts.some((p) => p === 'A' || p === 'A*'),
    notifies: parts.some((p) => p === 'M' || p === 'M*'),
    spend: parts.some((p) => p === '$' || p === '$*')
  };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** @returns {string[]} failures for the given tool definitions (and, when given, the parsed catalog). */
export function checkWrites(tools, catalog) {
  const failures = [];
  for (const tool of tools) {
    const row = catalog?.get(tool.name);
    if (catalog && !row) failures.push(`${tool.name}: registered tool has no row in docs/TOOL-CATALOG.md`);
    const safety = row ? parseSafety(row.safety) : null;
    if (!tool.writes) {
      if (safety && !safety.read) failures.push(`${tool.name}: the catalog says it changes things (${row.safety}) but the tool is read-only`);
      continue;
    }
    const p = tool.inputSchema?.properties;
    if (!p?.dryRun || !p?.confirm) failures.push(`${tool.name}: write tool without dryRun/confirm inputs`);
    if (!tool.writeContract) failures.push(`${tool.name}: write tool without a declared write contract (defineWrite)`);
    const d = tool.declarations;
    if (!d || typeof d !== 'object') { failures.push(`${tool.name}: write tool without declarations`); continue; }
    if (d.spend && !tool.priced) failures.push(`${tool.name}: spend tool without a price function`);
    if (!row || !safety) continue;
    if (safety.read) { failures.push(`${tool.name}: the catalog says read-only (—) but the tool is a write tool`); continue; }
    if (d.production !== safety.prod) failures.push(`${tool.name}: production is "${d.production}" but the catalog says "${safety.prod}" (${row.safety})`);
    if (!!d.accessWidening !== safety.access) failures.push(`${tool.name}: accessWidening is ${!!d.accessWidening} but the catalog says ${safety.access} (${row.safety})`);
    if (!!d.notifies !== safety.notifies) failures.push(`${tool.name}: notifies is ${!!d.notifies} but the catalog says ${safety.notifies} (${row.safety})`);
    if (!!d.spend !== safety.spend) failures.push(`${tool.name}: spend is ${!!d.spend} but the catalog says ${safety.spend} (${row.safety})`);
    if ((d.confirm === 'always') !== safety.confirmAlways) failures.push(`${tool.name}: confirm is "${d.confirm}" but the catalog says ${safety.confirmAlways ? 'always needs confirm (C)' : 'preview only (P)'}`);
    if (d.cred !== row.cred) failures.push(`${tool.name}: credential is "${d.cred}" but the catalog says "${row.cred}"`);
    const wanted = row.profile === 'F' ? ['full'] : row.profile === 'E' ? ['everyday', 'full'] : null;
    if (!wanted) failures.push(`${tool.name}: the catalog profile "${row.profile}" is not valid for a write tool (use E or F)`);
    else if (!sameSet(d.profiles ?? [], wanted)) failures.push(`${tool.name}: profiles are ${JSON.stringify(d.profiles)} but the catalog says ${row.profile} (${wanted.join(', ')})`);
  }
  return failures;
}

async function main() {
  const { registry } = await import('../src/tools/index.js');
  if (!registry.tools.length) {
    console.log('Write safety: 0 tools registered — nothing to check');
    return;
  }
  const catalog = parseCatalog(fs.readFileSync(path.join(ROOT, 'docs/TOOL-CATALOG.md'), 'utf8'));
  const failures = checkWrites(registry.tools, catalog);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Write safety: ${registry.tools.length} tools checked against the catalog`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();

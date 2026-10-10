// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-budgets.mjs @ e2f90e8.
// Starting form of the token-budget check (C-2 gives it the per-profile budgets): every listing description is at most
// 160 characters and the whole catalog stays under 20,000 estimated tokens. With no tools registered it says so.
// `--print` also prints the estimate.
import path from 'node:path';

export const DESCRIPTION_LIMIT = 160;
export const CATALOG_TOKEN_LIMIT = 20000;
export const estimateTokens = (value) => Math.ceil(JSON.stringify(value).length / 4);

/** @returns {string[]} failures for the given tool definitions. */
export function checkBudgets(tools) {
  const failures = [];
  for (const t of tools) {
    if ((t.description || '').length > DESCRIPTION_LIMIT) failures.push(`${t.name}: description over ${DESCRIPTION_LIMIT} characters`);
  }
  if (estimateTokens(tools) > CATALOG_TOKEN_LIMIT) failures.push(`tool catalog over ${CATALOG_TOKEN_LIMIT} estimated tokens`);
  return failures;
}

async function main() {
  const { registry } = await import('../src/tools/index.js');
  const tools = registry.tools;
  if (!tools.length) console.log('Token budgets: 0 tools registered — nothing to check');
  else {
    const failures = checkBudgets(tools);
    if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
    else console.log(`Token budgets pass for ${tools.length} tools`);
  }
  if (process.argv.includes('--print')) console.log(`Catalog estimated tokens: ${estimateTokens(tools)}`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();

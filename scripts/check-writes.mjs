// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-writes.mjs @ e2f90e8.
// Starting form of the write-safety check (B-7 gives it the full nine-check rules): every registered write tool
// must offer dryRun and confirm and declare its write contract. With no tools registered it says so and passes.
import path from 'node:path';

/** @returns {string[]} failures for the given tool definitions. */
export function checkWrites(tools) {
  const failures = [];
  for (const tool of tools) {
    if (!tool.writes) continue;
    const p = tool.inputSchema?.properties;
    if (!p?.dryRun || !p?.confirm) failures.push(`${tool.name}: write tool without dryRun/confirm inputs`);
    if (!tool.writeContract) failures.push(`${tool.name}: write tool without a declared write contract (defineWrite)`);
  }
  return failures;
}

async function main() {
  const { registry } = await import('../src/tools/index.js');
  if (!registry.tools.length) {
    console.log('Write safety: 0 tools registered — nothing to check');
    return;
  }
  const failures = checkWrites(registry.tools);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Write safety: ${registry.tools.length} tools checked`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();

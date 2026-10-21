// CAP-1: deterministic read-only CLI; never contacts a provider or changes state.
import {registry} from '../src/tools/index.js';
import {buildCapabilityInventory, validateCapabilityInventory} from '../src/github/capability-inventory.js';

export function printSummary(catalog, {maxFamilies = 80} = {}) {
  const s = catalog.summary;
  const lines = [
    'GitHub source-pinned capability inventory (NOT provider/live acceptance)',
    'Pinned REST 2026-03-10; GraphQL schema 2026-10-09; host and credential support remain per-operation.',
    'Operation keys: ' + s.totalOperations,
    'Implementation: ' + Object.entries(s.byState).map(([k,v]) => k + '=' + v).join(', '),
    'Unresolved credential decisions: ' + s.unknownCredentialDecisions,
    'Officially reviewed operation/credential decisions: ' + s.reviewedCredentialDecisions,
    'Host/version applicability requiring verification: ' + s.unverifiedHostApplicability,
    'Operations with unresolved official-source conflicts: ' + s.unresolvedConflictRows,
    'Functional coverage percentage: NOT COMPUTED (no proven denominator/numerator).',
    'Family | operations | missing | implemented-unverified | verified | unresolved | retired | UI-only | universal-candidates | unknown-credentials | conflict-rows'
  ];
  for (const [family, f] of Object.entries(s.families).slice(0, maxFamilies))
    lines.push([family, f.total, f.byState.missing, f.byState['implemented-unverified'],
      f.byState.verified, f.byState.unresolved, f.byState['provider-retired'],
      f.byState['provider-UI-only'], f.universalCandidates, f.credentialUnknowns,
      f.unresolvedConflicts].join(' | '));
  return lines.join('\n') + '\n';
}

function main(args) {
  if (args.length !== 1 || !['--summary','--validate','--json'].includes(args[0])) {
    console.error('Usage: node scripts/capability-inventory.mjs --summary|--validate|--json');
    process.exitCode = 2;
    return;
  }
  const inventory = buildCapabilityInventory({registryTools: registry.tools});
  const result = validateCapabilityInventory(inventory);
  if (args[0] === '--json') {
    process.stdout.write(JSON.stringify(inventory) + '\n');
  } else if (args[0] === '--summary') {
    process.stdout.write(printSummary(inventory));
  } else {
    process.stdout.write('CAP-1 inventory valid: ' + result.totalOperations +
      ' source operations reconciled; no provider or live operation was invoked.\n');
  }
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href)
  main(process.argv.slice(2));

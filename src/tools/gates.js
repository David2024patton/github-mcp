// The ordered guard gates every write passes after it is classified (B-1). A gate sees the tool, the arguments, the target,
// the current state and the classification and answers nothing (carry on), `{ refuse, by }` (stop, with the reason) or
// `{ confirm }` (this needs confirmation, with the reason). A gate that throws refuses. The list is built here, in one place,
// and each guard card adds its own: production names and profiles (B-2), protected resources and project ownership (B-3),
// people and spend (B-4). `scripts/check-writes.mjs` (B-7) fails the build if a tool's declarations need a guard that is not listed.
import { productionEnabledGate } from './production-guard.js';
import { protectedResourceGate } from './protect-guard.js';
import { peopleGate } from './people-guard.js';
import { spendGate } from './spend-guard.js';

// R-1: a service pass changes who has access only when its owner said so when issuing it.
export function passAccessGate() {
  return async ({ ctx, classification, declarations }) => {
    if (ctx.connection?.pass !== true || ctx.connection.allow_access_changes === true) return null;
    if (classification.accessWidening || declarations?.accessWidening) return { refuse: 'This pass was not allowed to change who has access. Issue a pass with access changes allowed, or make this change yourself.', by: 'pass access permission' };
    return null;
  };
}

export function createGates() {
  return [passAccessGate(), productionEnabledGate(), protectedResourceGate(), peopleGate(), spendGate()];
}

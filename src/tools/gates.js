// The ordered guard gates every write passes after it is classified (B-1). A gate sees the tool, the arguments, the target,
// the current state and the classification and answers nothing (carry on), `{ refuse, by }` (stop, with the reason) or
// `{ confirm }` (this needs confirmation, with the reason). A gate that throws refuses. The list is built here, in one place,
// and each guard card adds its own: production names and profiles (B-2), protected resources and project ownership (B-3),
// people and spend (B-4). `scripts/check-writes.mjs` (B-7) fails the build if a tool's declarations need a guard that is not listed.
import { productionEnabledGate } from './production-guard.js';
import { protectedResourceGate } from './protect-guard.js';

export function createGates() {
  return [productionEnabledGate(), protectedResourceGate()];
}

import { mergeNamespaces } from '../core/registry.js';
import * as server from './server.js';
import * as diagnostics from './server-diagnostics.js';

// Tool modules are added here as their cards land.
export const registry = mergeNamespaces([server, diagnostics]);

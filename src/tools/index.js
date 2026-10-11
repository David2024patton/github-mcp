import { mergeNamespaces } from '../core/registry.js';
import * as server from './server.js';
import * as diagnostics from './server-diagnostics.js';
import * as meta from './meta.js';
import * as repos from './repos.js';

// Tool modules are added here as their cards land.
export const registry = mergeNamespaces([meta, server, diagnostics, repos]);

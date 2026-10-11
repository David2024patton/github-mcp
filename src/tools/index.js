import { mergeNamespaces } from '../core/registry.js';
import * as server from './server.js';

// Tool modules are added here as their cards land. A-5c: the two server tools.
export const registry = mergeNamespaces([server]);

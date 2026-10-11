import { mergeNamespaces } from '../core/registry.js';
import * as server from './server.js';
import * as diagnostics from './server-diagnostics.js';
import * as meta from './meta.js';
import * as repos from './repos.js';
import * as reposWrite from './repos-write.js';
import * as codeRead from './code-read.js';
import * as codeWrite from './code-write.js';
import * as branches from './branches.js';
import * as reviews from './reviews.js';
import * as pullsRead from './pulls-read.js';

// Tool modules are added here as their cards land.
export const registry = mergeNamespaces([meta, server, diagnostics, repos, reposWrite, codeRead, codeWrite, branches, pullsRead, reviews]);

// PAR-1: github_docs_search — search GitHub's help pages. Read-only, no GitHub credential, fixed host (see src/github/docs-search.js).
import { defineRead } from './define-read.js';
import { searchDocs } from '../github/docs-search.js';

const search = defineRead({
  name: 'github_docs_search', area: 'docs', audience: ['B', 'O', 'Op'],
  description: 'Search GitHub\'s own help pages (docs.github.com) in plain words; returns titles, links and short snippets.',
  properties: { query: { type: 'string', minLength: 2, maxLength: 200 }, max: { type: 'integer', minimum: 1, maximum: 10, description: 'How many (default 5)' } },
  required: ['query'],
  handler: async (args, ctx) => {
    const found = await searchDocs({ query: args.query, max: args.max ?? 5, fetch: ctx.fetch ?? globalThis.fetch });
    return { query: args.query, total: found.total, items: found.items };
  }
});
export const tools = [search.tool];
export const handlers = { [search.tool.name]: search.handler };

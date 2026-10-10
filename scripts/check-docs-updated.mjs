// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-docs-updated.mjs @ e2f90e8.
// DRIFT-PROTOCOL checklist B, minimum enforced by CI: a PR that changes api/, src/ or packages/ must also change
// docs/STATUS.md and a PR card or work-index.json, and docs/TOOL-CATALOG.md when src/tools/ changes — unless the PR
// body says "Docs-update: not needed — <reason>". Runs only when BASE_SHA is set (CI pull_request runs).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const EXCEPTION = /Docs-update: not needed — .{8,}/;

/** @returns {string[]} the docs a change set is missing (empty when it passes). */
export function missingDocs(changed, prBody = '') {
  const has = (p) => changed.includes(p);
  const code = changed.some((p) => /^(src|api|packages)\//.test(p));
  const tools = changed.some((p) => p.startsWith('src/tools/'));
  if (!code || EXCEPTION.test(prBody || '')) return [];
  const missing = [];
  if (!has('docs/STATUS.md')) missing.push('docs/STATUS.md');
  if (!changed.some((p) => /^docs\/pr-cards\/(?!README\.md$|validate-index\.py$)/.test(p))) missing.push('a PR card or docs/pr-cards/work-index.json');
  if (tools && !has('docs/TOOL-CATALOG.md')) missing.push('docs/TOOL-CATALOG.md');
  return missing;
}

function main() {
  const base = process.env.BASE_SHA;
  if (!base) {
    console.log('Docs check: no PR base (not a pull_request run); diff rule skipped.');
    return;
  }
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid BASE_SHA');
  const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath && fs.existsSync(eventPath) ? JSON.parse(fs.readFileSync(eventPath, 'utf8')) : null;
  const missing = missingDocs(changed, event?.pull_request?.body || '');
  if (missing.length) {
    console.error(`Docs check failed: this PR changes code but not ${missing.join(', ')} (DRIFT-PROTOCOL checklist B).`);
    process.exitCode = 1;
  } else console.log(`Docs reconciliation check passed (${changed.length} changed files)`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main();

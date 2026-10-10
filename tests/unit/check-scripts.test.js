import { describe, expect, it } from 'vitest';
import { missingDocs } from '../../scripts/check-docs-updated.mjs';
import { checkWrites } from '../../scripts/check-writes.mjs';
import { checkBudgets } from '../../scripts/check-budgets.mjs';

describe('docs check (DRIFT-PROTOCOL B)', () => {
  it('passes docs-only and tooling-only changes', () => {
    expect(missingDocs(['docs/PLAN.md', 'scripts/x.mjs'])).toEqual([]);
  });
  it('requires STATUS and a card when code changes', () => {
    expect(missingDocs(['src/github/client.js'])).toEqual(['docs/STATUS.md', 'a PR card or docs/pr-cards/work-index.json']);
    expect(missingDocs(['src/github/client.js', 'docs/STATUS.md', 'docs/pr-cards/README.md'])).toEqual(['a PR card or docs/pr-cards/work-index.json']);
    expect(missingDocs(['api/mcp.js', 'docs/STATUS.md', 'docs/pr-cards/work-index.json'])).toEqual([]);
  });
  it('requires TOOL-CATALOG when src/tools changes', () => {
    expect(missingDocs(['src/tools/repo.js', 'docs/STATUS.md', 'docs/pr-cards/B-1.md'])).toEqual(['docs/TOOL-CATALOG.md']);
  });
  it('honours the written exception only with a reason', () => {
    expect(missingDocs(['src/x.js'], 'Docs-update: not needed — comment-only change')).toEqual([]);
    expect(missingDocs(['src/x.js'], 'Docs-update: not needed — ')).not.toEqual([]);
  });
});

describe('write-safety check (starting form)', () => {
  it('fails a write tool without dryRun/confirm or a write contract and ignores reads', () => {
    const tools = [
      { name: 'github_repo_get', writes: false },
      { name: 'github_label_create', writes: true, inputSchema: { properties: { name: {} } } },
      { name: 'github_pr_merge', writes: true, writeContract: {}, inputSchema: { properties: { dryRun: {}, confirm: {} } } }
    ];
    expect(checkWrites(tools)).toEqual([
      'github_label_create: write tool without dryRun/confirm inputs',
      'github_label_create: write tool without a declared write contract (defineWrite)'
    ]);
  });
});

describe('token-budget check (starting form)', () => {
  it('fails a description over 160 characters and an oversized catalog', () => {
    expect(checkBudgets([{ name: 'github_ok', description: 'short' }])).toEqual([]);
    expect(checkBudgets([{ name: 'github_long', description: 'x'.repeat(161) }])).toEqual(['github_long: description over 160 characters']);
    const huge = Array.from({ length: 600 }, (_, i) => ({ name: `github_t${i}`, description: 'y'.repeat(150) }));
    expect(checkBudgets(huge)).toContain('tool catalog over 20000 estimated tokens');
  });
});

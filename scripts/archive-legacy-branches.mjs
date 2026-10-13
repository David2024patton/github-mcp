// One-time, explicit owner-authorized historical ref consolidation. Do not use as a generic archive tool.
// The archival commit has the current main tree and parents for *all* preserved old heads.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ARCHIVE_REF = 'archive/legacy-ai-2026-10-13';
export const OLD_HEADS = Object.freeze([
  ['ai/claude/a-5c-webhook-server-tools', 'dcd7d4d82cd5950e20f0497a4e002310082effdb'],
  ['ai/claude/b-1-write-layer', '83b3c3781ef7c4a222d50f2eca1eb1130f7da7ba'],
  ['ai/claude/d-1-repositories', '0aa65dc48739093eb68962328b50f2db4d47e2a4'],
  ['ai/claude/d-1b-repo-writes', 'c57b886ea1bd1626cd61548a9547ade4241f5a65'],
  ['ai/claude/d-2b-code-writes', '58545cb15a318991f6c37e0b3fec1b0904f4d463'],
  ['ai/claude/d-3-branches-tags', '3109f58f164cb77dceb2c6969619fea584209dbf'],
  ['ai/claude/e-1-pull-requests', '253f0bb571d540c01ba79a5d272c25679bfc886f'],
  ['ai/codex/hosting-cost-handoff-2026-10-12', '37b37c12c5e9c3bcc523c47c4e54a273c7071624'],
  ['ai/gpt6/g-5a-releases-read', '82d74d22d05e0e5560a865d146130443b6df06fb'],
  ['ai/gpt6/g-5b-release-lifecycle', 'bb165d819fc49139553527763d9b1044e5a1cea6'],
  ['ai/gpt6/v2-all-runs-inventory', 'e34551c619d19db8771a9fbb8f8e867f32fc9ca7'],
  ['ai/gpt6/v2-intent-reconciliation', 'f3ba1b05b5a138533381f216d17e642b5737410f'],
  ['ai/gpt6/v2-ledger-collision', 'cd28ef9ca8d3cf25ea59971656171516056e3fe2'],
  ['ai/gpt6/v2-run-inventory-cursors', 'f674e7369cb77f1bffd6f775fbf39b0525c42cf8'],
  ['ai/gpt6/v2-scratch-foreign-artifacts', 'ddf655b0cb6aadcd2bd3868487e33e48904cc44d']
]);

export function validateOldHeads(heads) {
  if (!Array.isArray(heads) || heads.length !== 15) throw new Error('The historical manifest must have exactly 15 refs');
  const unique = new Set();
  for (const [name, sha] of heads) {
    if (!/^ai\/[A-Za-z0-9/_-]+$/.test(name) || !/^[a-f0-9]{40}$/.test(sha) || unique.has(name)) {
      throw new Error('Invalid, duplicate or non-AI archive target');
    }
    unique.add(name);
  }
  return true;
}

export function validateArchiveHistory(parents, archivedTree, baselineTree, heads = OLD_HEADS) {
  validateOldHeads(heads);
  if (!Array.isArray(parents) || parents.length !== heads.length + 1 ||
      !parents.every((sha) => /^[a-f0-9]{40}$/.test(sha)) ||
      !/^[a-f0-9]{40}$/.test(archivedTree) || archivedTree !== baselineTree) {
    throw new Error('Existing archive has incorrect parents or a modified file tree');
  }
  for (let i = 0; i < heads.length; i += 1) {
    if (parents[i + 1] !== heads[i][1]) {
      throw new Error('Existing archive does not preserve pinned historical tip ' + heads[i][0]);
    }
  }
  return parents[0];
}

export function archiveCommitArgs(tree, main, heads = OLD_HEADS) {
  validateOldHeads(heads);
  if (![tree, main].every((v) => /^[a-f0-9]{40}$/.test(v))) throw new Error('Invalid archive parent or tree');
  return ['commit-tree', tree, '-p', main, ...heads.flatMap(([, sha]) => ['-p', sha]),
    '-m', 'Archive superseded AI branch tips without changing the production tree'];
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function checkAncestor(older, newer) {
  return spawnSync('git', ['merge-base', '--is-ancestor', older, newer],
    { stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
}

// Actions maintenance control-plane call, not a provider tool: same pinned REST API version.
async function activePRHeads() {
  if (process.env.GITHUB_REPOSITORY !== 'Robinson-AI-Systems/github-mcp' || !process.env.GITHUB_TOKEN) {
    throw new Error('Wrong repository or no GitHub Actions token; no archive or deletion');
  }
  const url = (process.env.GITHUB_API_URL || 'https://api.github.com') +
    '/repos/Robinson-AI-Systems/github-mcp/pulls?state=open&per_page=100';
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }
  });
  if (!response.ok) throw new Error('Open PR list unavailable; no archival or deletion');
  const prs = await response.json();
  if (!Array.isArray(prs) || prs.length >= 100) throw new Error('Open PR list incomplete');
  return new Set(prs.filter((pr) => pr.head?.repo?.full_name === process.env.GITHUB_REPOSITORY)
    .map((pr) => pr.head.ref));
}

async function main() {
  validateOldHeads(OLD_HEADS);
  const open = await activePRHeads();
  git(['fetch', '--no-tags', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
  const mainSha = git(['rev-parse', 'refs/remotes/origin/main']);
  const archiveRemote = git(['ls-remote', '--heads', 'origin', 'refs/heads/' + ARCHIVE_REF])
    .split(/\s+/)[0];
  let archive;
  if (archiveRemote) {
    // A partial prior success is resumable, but only after complete remote ancestry proof.
    archive = archiveRemote;
  } else {
    for (const [name, sha] of OLD_HEADS) {
      if (open.has(name)) throw new Error('Historical branch now has an open PR: ' + name);
      const remote = git(['rev-parse', '--verify', 'refs/remotes/origin/' + name]);
      if (remote !== sha) throw new Error('Historical branch changed: ' + name);
      if (checkAncestor(sha, mainSha)) throw new Error('Expected distinct history changed: ' + name);
    }
    git(['config', 'user.name', 'github-actions[bot]']);
    git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    const mainTree = git(['rev-parse', mainSha + '^{tree}']);
    archive = git(archiveCommitArgs(mainTree, mainSha));
    if (git(['rev-parse', archive + '^{tree}']) !== mainTree ||
        OLD_HEADS.some(([, sha]) => !checkAncestor(sha, archive))) {
      throw new Error('New archive failed its complete ancestry or unchanged-tree proof');
    }
    const created = spawnSync('git', [
      'push', '--porcelain',
      '--force-with-lease=refs/heads/' + ARCHIVE_REF + ':',
      'origin', archive + ':refs/heads/' + ARCHIVE_REF
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (created.status !== 0) throw new Error('Archive creation refused; original branches untouched');
  }

  const published = git(['ls-remote', '--heads', 'origin', 'refs/heads/' + ARCHIVE_REF])
    .split(/\s+/)[0];
  if (published !== archive) throw new Error('Archive ref changed or unavailable; no branch deletion');
  const parents = git(['show', '-s', '--format=%P', archive]).split(/\s+/);
  const archivedTree = git(['rev-parse', archive + '^{tree}']);
  const baseline = validateArchiveHistory(parents, archivedTree,
    git(['rev-parse', parents[0] + '^{tree}']));
  if (!checkAncestor(baseline, mainSha) ||
      OLD_HEADS.some(([, sha]) => !checkAncestor(sha, archive))) {
    throw new Error('Archive history incomplete or not based on current main');
  }
  const tree = archivedTree;

  const deleted = [], refused = [];
  const previouslyDeleted = [];
  for (const [name, sha] of OLD_HEADS) {
    // A fully validated existing archive makes an already absent source ref safe to skip.
    const remote = git(['ls-remote', '--heads', 'origin', 'refs/heads/' + name])
      .split(/\s+/)[0];
    if (!remote) {
      previouslyDeleted.push(name);
      continue;
    }
    if (remote !== sha) {
      refused.push(name + ' (branch tip changed)');
      continue;
    }
    // A lease protects commits, not a newly opened PR. Re-read just before each deletion.
    if ((await activePRHeads()).has(name)) {
      refused.push(name + ' (now has an open PR)');
      continue;
    }
    const attempt = spawnSync('git', [
      'push', '--porcelain',
      '--force-with-lease=refs/heads/' + name + ':' + sha,
      'origin', ':refs/heads/' + name
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (attempt.status === 0) deleted.push(name);
    else refused.push(name);
  }
  const summary = [
    '### Historical branches safely archived',
    'Archive ref: ' + ARCHIVE_REF,
    'Exact archive commit: ' + archive,
    'Unchanged main tree: ' + tree,
    'Historical commits preserved as parents: ' + OLD_HEADS.length,
    'Original refs deleted in this run: ' + deleted.length,
    'Previously deleted, safely resumed: ' + previouslyDeleted.length,
    'Deletion refusals: ' + refused.length,
    ...refused.map((name) => '- Refused: ' + name)
  ].join('\n') + '\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (refused.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error('Archival safely stopped: ' + error.message);
    process.exitCode = 1;
  });
}

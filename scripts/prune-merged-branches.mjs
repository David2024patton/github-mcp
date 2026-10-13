// Maintenance-only GitHub Actions helper. Never deletes a ref with commits outside main.
// The remote lease also refuses a deletion if someone advanced the branch after inspection.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function cleanupCandidate(name, only = '') {
  if (typeof name !== 'string' || !/^ai\/[A-Za-z0-9._/-]+$/.test(name)) return false;
  if (name.split('/').some((segment) => segment === '.' || segment === '..' || !segment)) return false;
  if (name.includes('..') || name.endsWith('.lock') || name.endsWith('.')) return false;
  return !only || name === only;
}

export function parseTrackingRefs(output) {
  return output.split('\n').filter(Boolean).map((line) => {
    const [name, sha, extra] = line.split('\t');
    if (extra !== undefined || !cleanupCandidate(name) || !/^[a-f0-9]{40}$/.test(sha || '')) {
      throw new Error('Unrecognized AI tracking ref; refusing cleanup');
    }
    return { name, sha };
  });
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function openPRHeads() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (repo !== 'Robinson-AI-Systems/github-mcp' || !token) {
    throw new Error('Wrong repository or no authorized GitHub Actions token');
  }
  const url = (process.env.GITHUB_API_URL || 'https://api.github.com') +
    '/repos/' + repo + '/pulls?state=open&per_page=100';
  const response = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!response.ok) throw new Error('Cannot independently read open PRs; preserving every branch');
  const prs = await response.json();
  if (!Array.isArray(prs) || prs.length >= 100) {
    throw new Error('Open PR list is not known complete; preserving every branch');
  }
  return new Set(prs.filter((pr) => pr.head?.repo?.full_name === repo)
    .map((pr) => pr.head.ref));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const only = process.env.MERGED_HEAD_BRANCH || '';
  if (only && !cleanupCandidate(only)) {
    throw new Error('Merged PR head is outside the AI branch namespace; no cleanup attempted');
  }
  // A failed API read is a hard refusal, not evidence that no work is open.
  const open = await openPRHeads();
  git(['fetch', '--no-tags', '--prune', 'origin',
    '+refs/heads/*:refs/remotes/origin/*']);
  const mainSha = git(['rev-parse', 'refs/remotes/origin/main']);
  const refs = parseTrackingRefs(git(['for-each-ref',
    '--format=%(refname:strip=3)%09%(objectname)', 'refs/remotes/origin/ai/']));
  const report = { deleted: [], alreadyMerged: [], protectedOpen: [], unpublished: [], failed: [] };
  for (const { name, sha } of refs) {
    if (!cleanupCandidate(name, only)) continue;
    if (open.has(name)) {
      report.protectedOpen.push(name);
      continue;
    }
    const test = spawnSync('git', ['merge-base', '--is-ancestor', sha, mainSha], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    if (test.status === 1) {
      report.unpublished.push(name + ' @ ' + sha.slice(0, 12));
      continue;
    }
    if (test.status !== 0) {
      report.failed.push(name + ' (ancestry unavailable)');
      continue;
    }
    if (!apply) {
      report.alreadyMerged.push(name);
      continue;
    }
    // Exact-tip lease: a newer push cannot accidentally be discarded.
    const removed = spawnSync('git', [
      'push',
      '--porcelain',
      '--force-with-lease=refs/heads/' + name + ':' + sha,
      'origin', ':refs/heads/' + name
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (removed.status === 0) report.deleted.push(name);
    else report.failed.push(name + ' (deletion refused or branch changed)');
  }
  const summary = [
    '### Safe AI branch cleanup',
    'Verified main: ' + mainSha,
    'Already merged ' + (apply ? 'deleted' : 'eligible') + ': ' +
      (apply ? report.deleted.length : report.alreadyMerged.length),
    'Open PR branches preserved: ' + report.protectedOpen.length,
    'Unpublished/divergent branches preserved: ' + report.unpublished.length,
    'Failed/refused: ' + report.failed.length,
    ...(report.unpublished.length ? ['**Preserved exceptions:**',
      ...report.unpublished.map((name) => '- ' + name)] : []),
    ...(report.failed.length ? ['**Failures:**',
      ...report.failed.map((name) => '- ' + name)] : [])
  ].join('\n') + '\n';
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (report.failed.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error('Cleanup safely stopped: ' + error.message);
    process.exitCode = 1;
  });
}

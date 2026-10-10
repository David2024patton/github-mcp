import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { scanFiles, scanText, isEnvFile } from '../../scripts/check-secrets.mjs';

// Real-shaped values are assembled at run time so this file itself never contains one.
const base62 = (n) => 'Zq8Lm3Xv'.repeat(Math.ceil(n / 8)).slice(0, n);
const token = (prefix) => `${prefix}_${base62(36)}`;
const fineGrained = () => 'github' + '_pat_' + base62(82);
const pem = () => '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIEow\n-----END ' + 'RSA PRIVATE KEY-----';
const SCRIPT = resolve('scripts/check-secrets.mjs');

let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

describe('secret scan', () => {
  it('fails on a planted real-shaped ghs_ token and a PEM private key in a file', () => {
    dir = mkdtempSync(join(tmpdir(), 'github-mcp-secret-'));
    const file = join(dir, 'planted.js');
    writeFileSync(file, `const t = '${token('ghs')}';\n\n${pem()}\n`);
    const found = scanFiles([file]);
    expect(found.map((f) => [f.label, f.line])).toEqual([['GitHub token', 1], ['private key', 3]]);
  });

  it('flags every GitHub token family and fine-grained tokens', () => {
    for (const prefix of ['ghp', 'gho', 'ghu', 'ghs', 'ghr']) {
      expect(scanText(`x ${token(prefix)} y`).map((f) => f.label)).toEqual(['GitHub token']);
    }
    expect(scanText(fineGrained()).map((f) => f.label)).toEqual(['GitHub fine-grained token']);
  });

  it('allows explicit fakes', () => {
    expect(scanText(`ghp_FAKE${base62(32)} ghs_FAKEfixture github_pat_FAKE${base62(78)} -----BEGIN FAKE KEY-----`)).toEqual([]);
  });

  it('flags non-local database URLs with passwords, Neon and Vercel identifiers, but not localhost', () => {
    const labels = scanText([
      'postgres' + 'ql://u:pw@ep-' + 'cool-darkness-a1b2c3.us-east-2.aws.neon.tech/db',
      'postgres' + 'ql://postgres:ci-only-not-a-secret@127.0.0.1:5432/postgres',
      'prj_' + base62(24),
      'team_' + base62(24)
    ].join('\n')).map((f) => f.label);
    expect(labels).toEqual(['database URL', 'Neon endpoint ID', 'Vercel project ID', 'Vercel team ID']);
  });

  it('shows only the first 6 characters of a match', () => {
    const [finding] = scanText(token('ghp'));
    expect(finding.preview).toBe('ghp_Zq');
  });

  it('refuses committed .env files but allows .env.example', () => {
    expect(isEnvFile('a/.env')).toBe(true);
    expect(isEnvFile('.env.production')).toBe(true);
    expect(isEnvFile('.env.example')).toBe(false);
  });

  it('scans tracked files of a git repository and exits non-zero without printing the value', () => {
    dir = mkdtempSync(join(tmpdir(), 'github-mcp-repo-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(join(dir, 'clean.md'), 'ghp_FAKEexample\n');
    writeFileSync(join(dir, 'untracked.txt'), token('ghp'));
    expect(spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' }).status).toBe(0); // nothing tracked yet
    git('add', 'clean.md');
    expect(spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' }).status).toBe(0);
    const leaked = token('ghs');
    writeFileSync(join(dir, 'leak.js'), `export const t = '${leaked}';\n`);
    git('add', 'leak.js');
    const run = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('GitHub token: leak.js:1');
    expect(run.stderr + run.stdout).not.toContain(leaked);
  });
});

// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-secrets.mjs @ e2f90e8 (GitHub, PEM, Neon and Vercel rules).
// Scans every tracked file (`git ls-files`) for real-looking credentials. Prints only the label, file, line and the
// first 6 characters of a match — never the value. Explicit fakes (text containing FAKE) are allowed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'example.test', 'example.com', 'host']);

const RULES = [
  // GitHub personal, OAuth, user-to-server, server-to-server (installation) and refresh tokens: prefix + 36 base62.
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, fakeAllowed: true },
  // Fine-grained personal access tokens: github_pat_ + 82 characters.
  { label: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g, fakeAllowed: true },
  // PEM private keys (RSA, EC, OPENSSH, ENCRYPTED, PKCS#8 …). `-----BEGIN FAKE KEY-----` does not match.
  { label: 'private key', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g, fakeAllowed: true },
  // Postgres URLs with a password and a non-local host (Neon or any other server).
  { label: 'database URL', pattern: /\bpostgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@(\[[^\]]+\]|[A-Za-z0-9][A-Za-z0-9.-]*)/gi,
    hostGroup: 1 },
  // Neon: API keys and compute endpoint identifiers (ep-<word>-<word>-<id>).
  { label: 'Neon API key', pattern: /\bnapi_[A-Za-z0-9]{40,}\b/g, fakeAllowed: true },
  { label: 'Neon endpoint ID', pattern: /\bep-[a-z]+-[a-z]+-[a-z0-9]{6,}\b/g, fakeAllowed: true },
  // Vercel project and team identifiers.
  { label: 'Vercel project ID', pattern: /\bprj_[A-Za-z0-9]{20,}\b/g, fakeAllowed: true },
  { label: 'Vercel team ID', pattern: /\bteam_[A-Za-z0-9]{20,}\b/g, fakeAllowed: true }
];

/** @returns {{label: string, line: number, preview: string}[]} findings in one text. */
export function scanText(text) {
  const findings = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.fakeAllowed && match[0].includes('FAKE')) continue;
      if (rule.hostGroup && LOCAL_HOSTS.has(match[rule.hostGroup].toLowerCase())) continue;
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ label: rule.label, line, preview: match[0].slice(0, 6) });
    }
  }
  return findings;
}

/** A committed environment file is refused whatever it contains (`.env.example` is allowed). */
export function isEnvFile(file) {
  const base = path.basename(file);
  return /^\.env(\..+)?$/.test(base) && base !== '.env.example';
}

/** @returns {{file: string, label: string, line: number, preview: string}[]} */
export function scanFiles(files) {
  const failures = [];
  for (const file of files) {
    if (isEnvFile(file)) failures.push({ file, label: 'committed .env file', line: 0, preview: '' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) continue; // binary
    for (const finding of scanText(bytes.toString('utf8'))) failures.push({ file, ...finding });
  }
  return failures;
}

export function trackedFiles(cwd = process.cwd()) {
  return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
}

export function formatFailure(f) {
  return `${f.label}: ${f.file}${f.line ? `:${f.line}` : ''}${f.preview ? ` (starts "${f.preview}…")` : ''}`;
}

function main() {
  const cwd = process.cwd();
  const files = process.argv[2] === '--file' ? process.argv.slice(3) : trackedFiles(cwd);
  const failures = scanFiles(files.map((f) => path.resolve(cwd, f))).map((f) => ({ ...f, file: path.relative(cwd, f.file) }));
  if (failures.length) {
    for (const f of failures) console.error(`Secret scan: ${formatFailure(f)}`);
    console.error(`Secret scan failed: ${failures.length} finding(s). Use fake values only (ghp_FAKE…, -----BEGIN FAKE KEY-----).`);
    process.exitCode = 1;
  } else console.log(`Secret scan passed (${files.length} tracked files)`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main();

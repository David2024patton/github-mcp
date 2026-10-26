// PAR-2: bounded, on-demand review of ALREADY HOSTED GitHub files.
// No raw source code, secret value, snippet or token enters tool arguments or results.
// Not GitHub's proprietary remote-MCP run_secret_scanning: that has no public REST equivalent.
import { isUtf8 } from 'node:buffer';
import { defineRead } from './define-read.js';
import { readerFor, plain } from './github-read.js';
import { looksBinary } from './code-read.js';

const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' };
const OWNER = { type: 'string', minLength: 1, maxLength: 39 };
const REF = { type: 'string', minLength: 1, maxLength: 250 };
const MAX_FILES = 12;
const FILE_BYTES = 100_000;
const TOTAL_BYTES = 400_000;
const MAX_FINDINGS = 30;

// Intentionally narrow signatures. This is not a general-purpose secret detection engine.
// Do not add a rule that returns, captures or logs matched text.
const RULES = Object.freeze([
  { id: 'github_personal_access_token', label: 'GitHub personal access token',
    pattern: /(?:^|[^A-Za-z0-9_])(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,})/ },
  { id: 'github_oauth_or_app_token', label: 'GitHub OAuth, refresh or App token',
    pattern: /(?:^|[^A-Za-z0-9_])gh[ousr]_[A-Za-z0-9]{30,}/ },
  { id: 'slack_api_token', label: 'Slack token',
    pattern: /(?:^|[^A-Za-z0-9_-])xox[baprs]-[A-Za-z0-9-]{20,}/ },
  { id: 'private_key', label: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: 'aws_access_key_id', label: 'AWS access-key identifier (check whether a secret is also exposed)',
    pattern: /(?:^|[^A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?:$|[^A-Z0-9])/ },
  { id: 'aws_secret_key_assignment', label: 'Assigned AWS secret access key',
    pattern: /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[:=]\s*['"]?[A-Za-z0-9/+]{40}(?:['"]|\s|$)/ }
]);

export const SCAN_LIMITS = Object.freeze({ maxFiles: MAX_FILES, maxFileBytes: FILE_BYTES,
  maxTotalBytes: TOTAL_BYTES, maxFindings: MAX_FINDINGS });

/** Returns positions and generic remediation only — never matching bytes or neighboring text. */
export function detectCredentialPatterns(source, path, limit = MAX_FINDINGS) {
  if (typeof source !== 'string' || typeof path !== 'string')
    throw new TypeError('Scan requires text and an existing repository path.');
  const findings = [];
  const lines = source.split('\n');
  for (let line = 0; line < lines.length; line += 1) {
    for (const rule of RULES) {
      if (!rule.pattern.test(lines[line])) continue;
      findings.push({ path, line: line + 1, rule: rule.id, kind: rule.label,
        action: 'Remove the credential from the file and rotate or revoke it at its provider.' });
      if (findings.length >= limit) return { findings, capped: true };
    }
  }
  return { findings, capped: false };
}

export function validScanPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 255 &&
    !path.startsWith('/') && !path.endsWith('/') && !/[\\\x00-\x1f\x7f?#%]/.test(path) &&
    path.split('/').every(x => x.length && x !== '.' && x !== '..');
}

export const securityScanFiles = defineRead({
  name: 'github_security_scan_files', area: 'security', audience: ['B', 'O', 'Op'],
  description: 'Scan selected committed GitHub files for common credential patterns; findings omit secrets. Not GitHub Secret Protection.',
  guidance: 'Supply 1-12 existing file paths in a connected repository, optionally at a ref. Scans only GitHub-hosted file versions, not uncommitted local edits. Uses bounded signatures, not the official run_secret_scanning engine; zero matches is NOT proof that a file has no secrets. No raw source or secret is returned or stored.',
  properties: {
    owner: OWNER, repo: REPO,
    paths: { type: 'array', minItems: 1, maxItems: MAX_FILES,
      items: { type: 'string', minLength: 1, maxLength: 255 } },
    ref: REF
  },
  required: ['repo', 'paths'],
  handler: (args, ctx) => plain(async () => {
    if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > MAX_FILES ||
        !args.paths.every(validScanPath) || new Set(args.paths).size !== args.paths.length)
      throw new TypeError('Use 1-12 distinct relative file paths with no traversal, URL or query syntax.');
    const { owner, octokit: gh } = await readerFor(args, ctx);
    const reviewed = [], skipped = [], findings = [];
    let totalBytes = 0, incomplete = false;
    for (const path of args.paths) {
      if (findings.length >= MAX_FINDINGS || totalBytes >= TOTAL_BYTES) {
        incomplete = true; skipped.push({ path, reason: 'scan_limit' }); continue;
      }
      let data;
      try {
        data = (await gh.request('GET /repos/{owner}/{repo}/contents/{path}',
          { owner, repo: args.repo, path, ...(args.ref ? { ref: args.ref } : {}) })).data;
      } catch (error) {
        if (error?.status === 404) {
          incomplete = true; skipped.push({ path, reason: 'missing_or_not_accessible' }); continue;
        }
        throw error; // credential or repository-level 403/401 fails the scan closed
      }
      if (!data || Array.isArray(data) || data.type !== 'file' ||
          data.encoding !== 'base64' || typeof data.content !== 'string' ||
          !Number.isSafeInteger(data.size) || data.size < 0) {
        incomplete = true; skipped.push({ path, reason: 'not_a_readable_file' }); continue;
      }
      if (data.size > FILE_BYTES || totalBytes + data.size > TOTAL_BYTES) {
        incomplete = true; skipped.push({ path, reason: 'size_limit' }); continue;
      }
      if (!/^[A-Za-z0-9+/=\s]*$/.test(data.content)) {
        incomplete = true; skipped.push({ path, reason: 'invalid_encoding' }); continue;
      }
      const bytes = Buffer.from(data.content, 'base64');
      if (bytes.length !== data.size || bytes.length > FILE_BYTES || totalBytes + bytes.length > TOTAL_BYTES ||
          looksBinary(bytes) || !isUtf8(bytes)) {
        incomplete = true; skipped.push({ path, reason: 'binary_or_invalid_text' }); continue;
      }
      totalBytes += bytes.length;
      const matched = detectCredentialPatterns(bytes.toString('utf8'), path,
        MAX_FINDINGS - findings.length);
      reviewed.push({ path, bytes: bytes.length });
      findings.push(...matched.findings);
      if (matched.capped) incomplete = true;
    }
    return {
      owner, repo: args.repo, ref: args.ref ?? 'default_branch',
      scanned_files: reviewed.length, scanned_bytes: totalBytes, reviewed,
      skipped, findings, finding_count: findings.length,
      complete: !incomplete && skipped.length === 0,
      engine: 'bounded_common_credential_patterns',
      note: 'Only selected GitHub-hosted files and a limited set of patterns were checked. No matches never guarantees safety. This is not GitHub\'s remote MCP secret scan or push protection. Findings do not create GitHub alerts.'
    };
  })
});
export const tools = [securityScanFiles.tool];
export const handlers = { [securityScanFiles.tool.name]: securityScanFiles.handler };

// INV-1: builds the small committed file vendor/github-app-permissions/fpt-2026-03-10.json from GitHub's OWN published list of which
// operations each kind of token can call (github/docs, src/github-apps/data/fpt-2026-03-10). Offline after you have a checkout:
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/github/docs <dir> && git -C <dir> sparse-checkout set src/github-apps/data
//   node scripts/vendor-app-permissions.mjs <dir> <commit-sha> <commit-date>
// The file is data: never edit it by hand. Presence of an operation in a list means GitHub documents that token type for it;
// absence means GitHub's list does not include it. It says nothing about classic tokens (those come from the operation's own text).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, commit, committed] = process.argv.slice(2);
if (!dir || !/^[0-9a-f]{40}$/.test(commit ?? '') || !committed) { console.error('Usage: node scripts/vendor-app-permissions.mjs <github/docs checkout> <commit sha> <commit date>'); process.exit(2); }
const base = join(dir, 'src/github-apps/data/fpt-2026-03-10');
const read = (name) => JSON.parse(readFileSync(join(base, name), 'utf8'));
const key = (verb, path) => `${String(verb).toUpperCase()} ${path}`;
const listed = (file) => { const set = new Set(); for (const group of Object.values(read(file))) for (const op of group) set.add(key(op.verb, op.requestPath)); return set; };

const permsFrom = (file, flag) => {
  const map = new Map();
  for (const [name, entry] of Object.entries(read(file))) for (const p of entry.permissions) {
    if (flag && p[flag] !== true) continue;
    const k = key(p.verb, p.requestPath);
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(`${name}:${p.access}`);
  }
  return map;
};
const lists = { i: listed('server-to-server-rest.json'), u: listed('user-to-server-rest.json'), f: listed('fine-grained-pat.json') };
const perms = { i: permsFrom('server-to-server-permissions.json', 'server-to-server'), u: permsFrom('server-to-server-permissions.json', 'user-to-server'),
  f: permsFrom('fine-grained-pat-permissions.json') };
const ops = {};
for (const [kind, set] of Object.entries(lists)) for (const k of set) {
  (ops[k] ||= {})[kind] = [...(perms[kind].get(k) ?? [])].sort();
}
const sorted = Object.fromEntries(Object.keys(ops).sort().map((k) => [k, ops[k]]));
const out = { format: 'github-app-permissions/v1', source: { repository: 'https://github.com/github/docs', commit, committed,
  paths: ['src/github-apps/data/fpt-2026-03-10/server-to-server-rest.json', 'src/github-apps/data/fpt-2026-03-10/user-to-server-rest.json',
    'src/github-apps/data/fpt-2026-03-10/fine-grained-pat.json', 'src/github-apps/data/fpt-2026-03-10/server-to-server-permissions.json',
    'src/github-apps/data/fpt-2026-03-10/fine-grained-pat-permissions.json'],
  officialPages: ['https://docs.github.com/en/rest/authentication/endpoints-available-for-github-app-installation-access-tokens',
    'https://docs.github.com/en/rest/authentication/endpoints-available-for-github-app-user-access-tokens',
    'https://docs.github.com/en/rest/authentication/endpoints-available-for-fine-grained-personal-access-tokens'],
  keys: { i: 'GitHub App installation token', u: 'GitHub App user token', f: 'fine-grained personal access token' } }, ops: sorted };
writeFileSync(new URL('../vendor/github-app-permissions/fpt-2026-03-10.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(Object.keys(sorted).length + ' operations written');

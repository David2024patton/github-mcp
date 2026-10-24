// CI speed: decides whether a pull request needs the heavy test jobs (unit, db, shapes, rtc, browser).
// It prints `code=false` ONLY when every changed file is documentation that no test reads; anything else, any error,
// and every push to main print `code=true` (run everything). The `check` job always runs in full regardless.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOC = /^docs\/.+\.md$|^[^/]+\.md$/;

/** Every file under the test folders, as text (what the heavy jobs actually execute or read). */
export function testTexts(root, dirs = ['tests', 'test']) {
  const out = [];
  const walk = (dir) => {
    let names = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|json)$/.test(name)) out.push(readFileSync(p, 'utf8'));
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out;
}

/** true = run the heavy jobs. `changed` is the list of changed paths; `texts` the test file contents. */
export function needsCode(changed, texts) {
  if (!Array.isArray(changed) || changed.length === 0) return true;
  for (const path of changed) {
    if (!DOC.test(path)) return true;                                   // any non-documentation change
    const name = basename(path);
    if (texts.some((t) => t.includes(name))) return true;               // a test reads this document
  }
  return false;
}

/** Changed paths between `base` and HEAD. `--no-renames` keeps BOTH sides of a move visible (a test or code file moved
 * into docs/ must still count as a code change). */
export function changedFiles(root, base) {
  return execFileSync('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const base = process.env.BASE_SHA;
  let code = true;
  try {
    if (process.env.GITHUB_EVENT_NAME === 'pull_request' && /^[0-9a-f]{40}$/.test(String(base))) {
      execFileSync('git', ['fetch', '--quiet', '--depth=1', 'origin', base], { cwd: root, stdio: 'ignore' });
      const changed = changedFiles(root, base);
      code = needsCode(changed, testTexts(root));
      console.error(`ci-scope: ${changed.length} changed file(s); heavy jobs ${code ? 'run' : 'skipped (documentation only)'}`);
    }
  } catch { code = true; }
  console.log('code=' + code);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

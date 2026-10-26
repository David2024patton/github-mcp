// Contract-generic code (src/core/) must import nothing GitHub-specific, so the hub can extract it into
// robinson-mcp-core (BATCH-A decision A2). Fails when any file under src/core/ imports from src/github/, src/tools/
// or any @octokit/* package (static import, export … from, dynamic import() or require()).
// Usage: node scripts/check-core-imports.mjs [repoRoot]
import fs from 'node:fs';
import path from 'node:path';

const SPECIFIER = /(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s+[^'"()]*?\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listFiles(full);
    return /\.(?:m?js|cjs|ts)$/.test(e.name) ? [full] : [];
  });
}

/** @returns {{files: number, violations: {file: string, specifier: string}[]}} */
export function findCoreImportViolations(root) {
  const coreDir = path.join(root, 'src', 'core');
  const forbiddenDirs = [path.join(root, 'src', 'github'), path.join(root, 'src', 'tools')];
  const files = listFiles(coreDir);
  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(SPECIFIER)) {
      const spec = match[1];
      let bad = spec === 'octokit' || spec.startsWith('@octokit/');
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        bad = forbiddenDirs.some((dir) => target === dir || target.startsWith(dir + path.sep));
      }
      // Report repo-relative POSIX paths: path.relative yields backslashes on Windows, and both
      // the human message and the test compare against 'src/core/x.js'. On POSIX split/join is a
      // no-op, so CI output is byte-identical.
      if (bad) violations.push({ file: path.relative(root, file).split(path.sep).join('/'), specifier: spec });
    }
  }
  return { files: files.length, violations };
}

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const { files, violations } = findCoreImportViolations(root);
  if (violations.length) {
    for (const v of violations) console.error(`Core imports: ${v.file} imports "${v.specifier}" (src/core must stay GitHub-free)`);
    process.exitCode = 1;
  } else if (!files) console.log('Core imports: src/core/ is empty — nothing to check');
  else console.log(`Core imports: ${files} src/core file(s) import nothing from src/github, src/tools or @octokit/*`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main();

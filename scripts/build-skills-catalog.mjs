#!/usr/bin/env node
// Builds src/data/skills-catalog.js from David Patton's skills registry.
//
// Only registry units that are BOTH role 'canonical' AND license_status
// 'mit-cleared' are emitted. Section C ('not-cleared') records never enter the
// catalog; the build hard-fails if a record that would be emitted is not
// cleared. The output is reproducible: records are sorted by id and the module
// carries no wall-clock timestamps, so running the generator twice against the
// same registry produces byte-identical output.
//
// Usage:
//   node scripts/build-skills-catalog.mjs --registry <registry.json> \
//     --skills-root <tree> --snapshot <tag> [--out src/data/skills-catalog.js]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

function fail(message) {
  console.error(`build-skills-catalog: ${message}`);
  process.exit(1);
}

/** YAML frontmatter of a markdown file: the text between the two --- lines, or null. */
function frontmatter(text) {
  if (!text.startsWith('---')) return null;
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const end = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---');
  if (end < 0) return null;
  return lines.slice(1, end);
}

/**
 * The `description:` value from SKILL.md frontmatter. Handles a single-line
 * value (quoted or plain) and simple folded continuations: following lines
 * that are indented and are not a new top-level key are joined with a space.
 * Surrounding single or double quotes are stripped (with their basic escapes).
 */
function descriptionFromFrontmatter(lines) {
  const start = lines.findIndex((line) => /^description\s*:/.test(line));
  if (start < 0) return null;
  let value = lines[start].replace(/^description\s*:\s*/, '');
  const parts = [value];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^[ \t]+\S/.test(line)) break;
    // An indented "key:" line is a nested mapping entry (for example under
    // metadata:), not a continuation of the description.
    if (/^[ \t]+[A-Za-z0-9_-]+:\s/.test(line) || /^[ \t]+[A-Za-z0-9_-]+:\s*$/.test(line)) break;
    parts.push(line.trim());
  }
  value = parts.join(' ').trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, ' ');
  } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1).replace(/''/g, "'");
  } else if ((value.startsWith('"') && !value.endsWith('"')) || (value.startsWith("'") && !value.endsWith("'"))) {
    value = value.slice(1);
  }
  return value.trim() || null;
}

/** Trims to at most `max` characters, cutting at the last word boundary inside the limit. */
function trimAtWord(text, max = 300) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
}

async function descriptionFor(unit, skillsRoot) {
  const keywords = Array.isArray(unit.triggers?.keywords) ? unit.triggers.keywords.map(String) : [];
  const skillFile = path.join(skillsRoot, unit.path, 'SKILL.md');
  if (existsSync(skillFile)) {
    try {
      const fm = frontmatter(await readFile(skillFile, 'utf8'));
      const parsed = fm ? descriptionFromFrontmatter(fm) : null;
      if (parsed) return trimAtWord(parsed);
    } catch { /* fall through to the fallback below */ }
  }
  const fallback = keywords.length ? `${unit.name} — ${keywords.join(', ')}` : String(unit.name);
  return trimAtWord(fallback);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { fail(error.message); }
  const registryPath = args.registry;
  const skillsRoot = args['skills-root'];
  const snapshot = args.snapshot;
  const outPath = args.out ?? 'src/data/skills-catalog.js';
  if (!registryPath || !skillsRoot || !snapshot) {
    fail('usage: node scripts/build-skills-catalog.mjs --registry <registry.json> --skills-root <tree> --snapshot <tag> [--out src/data/skills-catalog.js]');
  }

  let registry;
  try { registry = JSON.parse(await readFile(registryPath, 'utf8')); } catch (error) { fail(`cannot read registry ${registryPath}: ${error.message}`); }
  const units = registry.units ?? registry.skills;
  if (!Array.isArray(units)) fail('registry has no units array');
  const registryCommit = registry.generated_from_commit;
  if (typeof registryCommit !== 'string' || !registryCommit) fail('registry has no generated_from_commit');

  const selected = units
    .filter((unit) => unit && unit.role === 'canonical' && unit.license_status === 'mit-cleared')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const records = [];
  for (const unit of selected) {
    // Hard fail: nothing not-cleared may ever be emitted, even if the filter
    // above is changed later by mistake.
    if (unit.license_status !== 'mit-cleared') fail(`refusing to emit not-cleared record ${unit.id}`);
    const keywords = (Array.isArray(unit.triggers?.keywords) ? unit.triggers.keywords : []).map(String).slice(0, 10);
    records.push({
      id: String(unit.id),
      name: String(unit.name),
      kind: String(unit.kind),
      category: String(unit.category),
      description: await descriptionFor(unit, skillsRoot),
      keywords,
      risk_class: String(unit.risk_class),
      license_status: String(unit.license_status),
      checksum_sha256: String(unit.checksum_sha256)
    });
  }
  for (const record of records) {
    if (record.license_status !== 'mit-cleared') fail(`refusing to write not-cleared record ${record.id}`);
  }

  const recordLines = records.map((record) => `  Object.freeze(${JSON.stringify(record, null, 2).replace(/\n/g, '\n  ')})`);
  const moduleText = `// GENERATED by scripts/build-skills-catalog.mjs - do not edit.
// Source registry commit: ${registryCommit}
// Snapshot: ${snapshot}
// Records: ${records.length}
// Catalog metadata from David Patton's skills collection, MIT-cleared records only.
// Regenerate: node scripts/build-skills-catalog.mjs --registry <registry.json> --skills-root <tree> --snapshot <tag>

export const SKILLS_BUNDLE = { version: '1.0.0', registryCommit: ${JSON.stringify(registryCommit)}, snapshot: ${JSON.stringify(snapshot)}, records: ${records.length} };

export const SKILLS_CATALOG = Object.freeze([
${recordLines.join(',\n')}
]);
`;

  const resolvedOut = path.resolve(process.cwd(), outPath);
  await mkdir(path.dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, moduleText, 'utf8');
  console.log(`build-skills-catalog: wrote ${records.length} records (registry ${registryCommit}, snapshot ${snapshot}) to ${path.relative(process.cwd(), resolvedOut)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => fail(error.message));
}

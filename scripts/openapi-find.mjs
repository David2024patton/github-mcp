// Finds GitHub REST operations in the vendored description without reading the 13 MB file (AGENTS.md, working rule 1).
//   node scripts/openapi-find.mjs "<words>"             up to 20 operations whose route, summary, id or category contain every word
//   node scripts/openapi-find.mjs --show "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge"
//                                                        parameters, body fields, required fields and response codes of one operation
import { operations, parametersOf } from '../test/helpers/github-descriptions.js';

const MAX = 20;

export function findOperations(words, ops = operations()) {
  const needles = words.map((w) => w.toLowerCase()).filter(Boolean);
  return ops.filter((o) => {
    const hay = `${o.route} ${o.summary} ${o.operationId} ${o.category}`.toLowerCase();
    return needles.every((n) => hay.includes(n));
  });
}

export function describeOperation(op) {
  const lines = [`${op.route}`, `  ${op.summary}${op.deprecated ? ' (deprecated)' : ''}`,
    `  id: ${op.operationId}   category: ${op.category}   triggersNotification: ${op.triggersNotification}`];
  const params = parametersOf(op);
  for (const where of ['path', 'query']) {
    const list = params.filter((p) => p.in === where);
    if (list.length) lines.push(`  ${where}: ${list.map((p) => `${p.name}${p.required ? '*' : ''}`).join(', ')}`);
  }
  const body = op.operation.requestBody;
  const schema = body?.content?.['application/json']?.schema;
  if (schema) {
    const props = Object.keys(schema.properties || {});
    const required = schema.required || [];
    lines.push(`  body${body.required ? ' (required)' : ''}: ${props.map((p) => `${p}${required.includes(p) ? '*' : ''}`).join(', ') || '(see description)'}`);
  }
  lines.push(`  responses: ${Object.keys(op.operation.responses || {}).join(', ')}`);
  return lines.join('\n');
}

function main(argv) {
  if (argv[0] === '--show') {
    const route = argv.slice(1).join(' ');
    const op = operations().find((o) => o.route === route);
    if (!op) { console.error(`No operation "${route}" in the vendored description.`); process.exitCode = 1; return; }
    console.log(describeOperation(op));
    return;
  }
  if (!argv.length) { console.error('Usage: node scripts/openapi-find.mjs "<words>" | --show "<METHOD /path>"'); process.exitCode = 2; return; }
  const hits = findOperations(argv.join(' ').split(/\s+/));
  for (const o of hits.slice(0, MAX)) {
    console.log(`${o.method.padEnd(6)} ${o.path} — ${o.summary} [${o.category}]${o.triggersNotification ? ' triggersNotification' : ''}`);
  }
  if (hits.length > MAX) console.log(`… ${hits.length - MAX} more; add words to narrow.`);
  if (!hits.length) { console.log('No match.'); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main(process.argv.slice(2));

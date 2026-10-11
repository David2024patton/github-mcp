// Finds GitHub GraphQL queries, mutations and types in the vendored schema without reading the 1.5 MB file.
//   node scripts/graphql-find.mjs <name>     Query/Mutation fields whose name contains <name> (case-insensitive, ≤20), with
//                                            their arguments; and, for an exact type name, that type's fields or input fields.
import fs from 'node:fs';
import { buildSchema } from 'graphql';
import { GRAPHQL_FILE } from '../test/helpers/github-descriptions.js';

const MAX = 20;

const typeString = (t) => String(t);
const args = (field) => field.args.map((a) => `${a.name}: ${typeString(a.type)}`).join(', ');

export function loadSchema() {
  return buildSchema(fs.readFileSync(GRAPHQL_FILE, 'utf8'), { assumeValidSDL: true, assumeValid: true });
}

export function findGraphql(name, schema = loadSchema()) {
  const needle = name.toLowerCase();
  const out = [];
  for (const root of [schema.getQueryType(), schema.getMutationType()]) {
    if (!root) continue;
    for (const field of Object.values(root.getFields())) {
      if (field.name.toLowerCase().includes(needle)) {
        out.push(`${root.name === 'Query' ? 'query' : 'mutation'} ${field.name}(${args(field)}): ${typeString(field.type)}${field.deprecationReason ? '  [deprecated]' : ''}`);
      }
    }
  }
  const type = schema.getType(name);
  const typeLines = [];
  if (type && typeof type.getFields === 'function') {
    typeLines.push(`${type.constructor.name.replace('GraphQL', '')} ${type.name}`);
    for (const f of Object.values(type.getFields()).slice(0, 40)) typeLines.push(`  ${f.name}${f.args?.length ? `(${args(f)})` : ''}: ${typeString(f.type)}`);
  }
  return { fields: out, type: typeLines };
}

function main(argv) {
  if (!argv.length) { console.error('Usage: node scripts/graphql-find.mjs <name>'); process.exitCode = 2; return; }
  const { fields, type } = findGraphql(argv[0]);
  for (const line of fields.slice(0, MAX)) console.log(line);
  if (fields.length > MAX) console.log(`… ${fields.length - MAX} more; use a longer name.`);
  for (const line of type) console.log(line);
  if (!fields.length && !type.length) { console.log('No match.'); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main(process.argv.slice(2));

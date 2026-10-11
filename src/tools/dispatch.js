// The dispatcher in use until Batch B supplies the full safety layer (A-5c). It is default-deny: it runs only tools that declare
// themselves read-only, checks the arguments against the tool's own schema, and withholds any result that looks like it holds a
// credential. Anything else answers "unknown tool", exactly like the deny-all dispatcher it replaces.
const SECRET_SHAPES = [/\bgh[pousr]_[A-Za-z0-9]{8,}/, /\bgithub_pat_[A-Za-z0-9_]{8,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

/** Checks arguments against the small subset of JSON Schema the read tools use: flat properties, strings, enums, string arrays. */
export function validateArgs(schema, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'Arguments must be an object.';
  const props = schema.properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    const spec = props[key];
    if (!spec) return `Unknown argument: ${key.slice(0, 40)}.`;
    if (spec.type === 'string') {
      if (typeof value !== 'string') return `${key} must be text.`;
      if (spec.enum && !spec.enum.includes(value)) return `${key} must be one of: ${spec.enum.join(', ')}.`;
    } else if (spec.type === 'array') {
      if (!Array.isArray(value) || value.length > (spec.maxItems ?? 100) || value.some((v) => typeof v !== 'string' || v.length > 64)) return `${key} must be a short list of names.`;
    } else return `${key} has an unsupported type.`;
  }
  for (const key of schema.required ?? []) if (!(key in args)) return `${key} is required.`;
  return null;
}

export function createReadOnlyDispatch({ env = process.env, now = Date.now } = {}) {
  return async function dispatch({ registry, name, args, connection, db }) {
    const tool = registry.tools.find((t) => t.name === name);
    const handler = tool && Object.hasOwn(registry.handlers, name) ? registry.handlers[name] : null;
    if (!tool || !handler || tool.annotations?.readOnlyHint !== true) return fail(`Unknown or unavailable tool: ${String(name).slice(0, 80)}`);
    const problem = validateArgs(tool.inputSchema, args);
    if (problem) return fail(problem);
    let result;
    try {
      result = await handler(args ?? {}, { connection, db, env, now });
    } catch (error) {
      return fail(error instanceof TypeError ? error.message : 'That tool could not complete right now. Nothing was changed.');
    }
    const text = JSON.stringify(result);
    if (SECRET_SHAPES.some((shape) => shape.test(text))) return fail('The result was withheld because it looked like it contained a credential.');
    return { content: [{ type: 'text', text }], structuredContent: result };
  };
}

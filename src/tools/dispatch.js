// The tool dispatcher (A-5c, extended in B-1). Default-deny: it runs only tools it can vouch for, checks arguments against the
// tool's own schema, and withholds any result that looks like it holds a credential.
//  - read-only tools (`readOnlyHint`) run with the connection and database;
//  - write tools (`defineWrite-v1`) run with, in addition, the credentials and the ordered guard gates; the write layer itself
//    refuses a profile that may not change anything, an account outside the connection, and a missing change log or gate list.
// Anything else answers "unknown tool". Profile-based hiding of tools is added in B-6.
import { validateArgs } from '../core/validate.js';

const SECRET_SHAPES = [/\bgh[pousr]_[A-Za-z0-9]{8,}/, /\bgithub_pat_[A-Za-z0-9_]{8,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

export function createDispatch({ env = process.env, now = Date.now, fetch = globalThis.fetch, credentials = null, gates = null } = {}) {
  return async function dispatch({ registry, name, args, connection, db }) {
    const tool = registry.tools.find((t) => t.name === name);
    const handler = tool && Object.hasOwn(registry.handlers, name) ? registry.handlers[name] : null;
    const isWrite = tool?.writes === true && tool.writeContract === 'defineWrite-v1';
    const isRead = tool?.annotations?.readOnlyHint === true && tool.writes !== true;
    if (!handler || (!isWrite && !isRead)) return fail(`Unknown or unavailable tool: ${String(name).slice(0, 80)}`);
    const problem = validateArgs(tool.inputSchema, args);
    if (problem) return fail(problem);
    let result;
    try {
      result = await handler(args ?? {}, { connection, db, env, now, fetch, ...(isWrite ? { credentials, gates } : {}) });
    } catch (error) {
      return fail(error instanceof TypeError ? error.message : 'That tool could not complete right now. Nothing was changed.');
    }
    const shaped = isWrite ? result : { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    if (SECRET_SHAPES.some((shape) => shape.test(JSON.stringify(shaped)))) return fail('The result was withheld because it looked like it contained a credential.');
    return shaped;
  };
}

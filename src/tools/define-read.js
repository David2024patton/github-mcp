// How a read tool is defined (C-1). The tool gives its arguments and a handler that returns GitHub's object (or a list of them);
// the dispatcher applies the result rules: `detail` (summary by default) and `fields`, then the text caps and the size budget.
import { SUMMARY_TYPES } from './summaries.js';

const NAME = /^github_[a-z][a-z0-9_]*$/;
export const DETAIL_PROPERTY = { type: 'string', enum: ['summary', 'full'], description: 'summary (default) or the whole object' };
export const FIELDS_PROPERTY = { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20, description: 'Only these fields (dotted paths such as user.login)' };

/**
 * @param {object} spec
 * @param {string} spec.name
 * @param {string} spec.description at most 160 characters, starting with the action
 * @param {object} [spec.properties] JSON-schema properties of the arguments
 * @param {string[]} [spec.required]
 * @param {string} [spec.summaryType] one of SUMMARY_TYPES; omit for a result with no summary form (the text caps and size budget still apply)
 * @param {(args: object, ctx: object) => any} spec.handler returns the raw object, or a list of them
 */
export function defineRead({ name, description, properties = {}, required = [], summaryType, handler }) {
  if (!NAME.test(name ?? '')) throw new TypeError('A valid tool name is required.');
  if (typeof description !== 'string' || !description) throw new TypeError(`${name}: a description is required.`);
  if (typeof handler !== 'function') throw new TypeError(`${name}: handler must be a function.`);
  if (summaryType !== undefined && !SUMMARY_TYPES.includes(summaryType)) throw new TypeError(`${name}: unknown summary type "${summaryType}".`);
  for (const key of ['detail', 'fields']) if (key in properties) throw new TypeError(`${name}: "${key}" is added by the read layer.`);
  const tool = Object.freeze({
    name, description, readContract: 'defineRead-v1', results: Object.freeze({ summaryType: summaryType ?? null }),
    inputSchema: {
      type: 'object',
      properties: { ...properties, ...(summaryType ? { detail: DETAIL_PROPERTY } : {}), fields: FIELDS_PROPERTY },
      ...(required.length ? { required } : {}),
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  });
  return { tool, handler };
}

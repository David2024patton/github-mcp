import { describe, expect, it } from 'vitest';
import { validateArgs } from '../../src/core/validate.js';

const schema = { type: 'object', properties: { milestone: { type: ['integer','null'], minimum: 1 } }, additionalProperties: false };
describe('strict nullable JSON schema arguments', () => {
  it('accepts absent, positive integer and explicit null without conflating them', () => {
    expect(validateArgs(schema, {})).toBeNull();
    expect(validateArgs(schema, { milestone: 3 })).toBeNull();
    expect(validateArgs(schema, { milestone: null })).toBeNull();
  });
  it('refuses invalid values and non-supported type unions', () => {
    for (const milestone of [-1, 0, 2.5, '3', false, {}, []]) expect(validateArgs(schema, { milestone })).not.toBeNull();
    expect(validateArgs({ type: 'object', properties: { x: { type: ['string','any'] } } }, { x: 'ok' })).toMatch(/unsupported type/);
    expect(validateArgs({ type: 'object', properties: { x: { type: ['integer','integer'] } } }, { x: 1 })).toMatch(/unsupported type/);
  });
});

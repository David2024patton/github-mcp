import { describe, expect, it } from 'vitest';
import { registry } from '../../src/tools/index.js';

describe('annotations match what each tool is', () => {
  for (const tool of registry.tools) {
    it(`${tool.name}`, () => {
      const a = tool.annotations;
      expect(a, 'annotations').toBeTruthy();
      for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) expect(typeof a[key], key).toBe('boolean');
      if (tool.writes) {
        expect(a.readOnlyHint).toBe(false);
        expect(a.destructiveHint).toBe(tool.declarations.production !== 'never');
      } else if (tool.passthrough) {
        // a runner can run changes, so it must not claim to be read-only
        expect(a.readOnlyHint).toBe(false);
        expect(a.destructiveHint).toBe(true);
      } else {
        expect(a.readOnlyHint).toBe(true);
        expect(a.destructiveHint).toBe(false);
        expect(a.idempotentHint).toBe(true);
      }
    });
  }
});

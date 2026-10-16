import { describe, expect, it } from 'vitest';
import { registry } from '../../src/tools/index.js';

// H-2 design test: signing secrets are generated here and shown once; no tool may take one as an argument or hand one back by name.
const WEBHOOK_TOOLS = registry.tools.filter((t) => /^github_(webhook_|dev_(create_forwarder|forward_deliveries|create_test_webhook|list_forwarders|delete_forwarder))/.test(t.name));
const SECRETISH = /secret|token|password|passphrase|private_?key|signature|credential/i;

describe('H-2 no webhook tool accepts or returns a signing secret by argument', () => {
  it('covers all eight webhook tools and the five developer forwarder tools', () => {
    expect(WEBHOOK_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining([
      'github_webhook_list', 'github_webhook_get', 'github_webhook_save', 'github_webhook_delete', 'github_webhook_list_deliveries',
      'github_webhook_redeliver', 'github_webhook_ping', 'github_webhook_rotate_secret',
      'github_dev_create_forwarder', 'github_dev_list_forwarders', 'github_dev_delete_forwarder', 'github_dev_forward_deliveries', 'github_dev_create_test_webhook'
    ]));
    expect(WEBHOOK_TOOLS).toHaveLength(13);
  });
  it('has no input property whose name suggests a secret, token, password, key or signature', () => {
    for (const tool of WEBHOOK_TOOLS) {
      for (const name of Object.keys(tool.inputSchema?.properties ?? {})) {
        expect(SECRETISH.test(name), `${tool.name}.${name}`).toBe(false);
      }
    }
  });
  it('rejects unexpected arguments so a secret cannot be smuggled in under another name', () => {
    for (const tool of WEBHOOK_TOOLS) expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
  });
});

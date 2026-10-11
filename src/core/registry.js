// Copied from Robinson-AI-Systems/stripe-mcp src/core/registry.js @ e2f90e8.
/** Contract-generic registry: no service-specific imports. */
export function mergeNamespaces(modules) {
  const tools = [];
  const handlers = Object.create(null);
  const seen = new Set();
  for (const mod of modules) {
    for (const tool of mod.tools) {
      if (!tool?.name || seen.has(tool.name) || Object.hasOwn(handlers, tool.name)) {
        throw new Error(`Duplicate or invalid tool name registered: ${tool?.name}`);
      }
      if (typeof mod.handlers?.[tool.name] !== 'function') {
        throw new Error(`Missing handler for registered tool: ${tool.name}`);
      }
      seen.add(tool.name);
      tools.push(tool);
      handlers[tool.name] = mod.handlers[tool.name];
    }
  }
  return { tools, handlers };
}

/** Write tools are available only to the profiles they list; read-only tools to every profile. */
export const isToolVisible = (tool, profile) => !(tool.writes === true) || (Array.isArray(tool.profiles) && tool.profiles.includes(profile));

/** The tools a connection with this profile may see and call. */
export const toolsForProfile = (registry, profile) => registry.tools.filter((tool) => isToolVisible(tool, profile));

/** How many tools each profile sees, for the home page. */
export function profileCounts(registry, profiles = ['read_only', 'everyday', 'full']) {
  return Object.fromEntries(profiles.map((profile) => [profile, toolsForProfile(registry, profile).length]));
}

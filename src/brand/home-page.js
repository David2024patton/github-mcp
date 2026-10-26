// The public home page "/": what the service does, the one address to paste, and how to connect each kind of AI app.
// No scripts (the address is plain selectable text), strict CSP, fits a 412 px phone. Client steps were checked against each
// client's own official documentation on 2026-10-24; the pages are cited in the HTML comments below.
import { BRAND, BRAND_CSS, brandHeader, brandFooter } from './brand.js';
import { escapeHtml as h } from '../core/http.js';

export const HOME_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
export const SERVER_ADDRESS = (origin) => `${origin}/api/mcp`;

const STYLE = BRAND_CSS + 'main{max-width:640px}.addr{display:block;background:var(--surface);border:1px solid var(--brand);border-radius:12px;padding:14px;margin:10px 0 18px;font:600 15px/1.4 ui-monospace,Menlo,Consolas,monospace;word-break:break-all;user-select:all}' +
  'pre{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:8px 0 14px;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}' +
  'section{border-top:1px solid var(--border);padding-top:14px;margin-top:18px}h2{font:700 19px/1.3 Inter,-apple-system,sans-serif;margin:0 0 8px}ol{padding-left:22px;margin:0 0 12px}li{margin:4px 0}' +
  'a.button{display:block;text-align:center;font:600 16px Inter,-apple-system,sans-serif;color:#fff;background:var(--grad);border-radius:50px;padding:13px 20px;text-decoration:none;margin:14px 0}ul.links{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px}';

/** @param {string} origin the public https address of this service, no trailing slash */
export function renderHome(origin = 'https://github.robinsonaisystems.com') {
  const address = h(SERVER_ADDRESS(origin));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(BRAND.product)}</title>
<meta name="description" content="Let your AI assistant work with your GitHub safely: repositories, pull requests, issues and more. Free."><style>${STYLE}</style></head><body><main>${brandHeader()}
<h1>Let your AI assistant work with your GitHub, safely</h1>
<p>${h(BRAND.product)} connects Claude, ChatGPT and other AI apps to your GitHub account. You sign in with GitHub and choose what the assistant may do.</p>
<ul><li>Read and manage repositories, files, branches, pull requests, issues and Actions.</li>
<li>Read-only mode blocks all changes. Changes touching production, access, notifications or spend always come back for a preview and confirmation first; other small changes go through in one step — unless your app previews first, with dryRun on every write tool.</li>
<li>Free. You can disconnect and delete your data at any time.</li></ul>
<p><small>Not affiliated with or endorsed by GitHub.</small></p>
<section id="connect"><h2>Connect your AI app</h2><p>Paste this address into your AI app when it asks for a server or connector address:</p>
<code class="addr" id="address">${address}</code>
<!-- Steps below checked on 2026-10-24 against each client's official documentation:
  Claude: https://www.claude.com/docs/connectors/custom/remote-mcp (phone app confirmed by the owner 2026-10-24; Customize > Connectors > Add custom connector > paste the URL > Add > Connect).
  ChatGPT: https://developers.openai.com/api/docs/guides/custom-mcp-server (ChatGPT Plugins > plus > Add custom MCP server > name and URL > OAuth > confirm > Create as a plugin; install it before use).
  Claude Code: https://code.claude.com/docs/en/mcp (claude mcp add --transport http <name> <url>; run /mcp to sign in).
  Cursor: https://cursor.com/docs/context/mcp (.cursor/mcp.json or ~/.cursor/mcp.json, "mcpServers" with a "url").
  VS Code: https://code.visualstudio.com/docs/copilot/reference/mcp-configuration (.vscode/mcp.json, "servers" with "type": "http" and "url"). -->
<h2>Claude (web, desktop and phone app)</h2><ol><li>Open Claude on the web, or in the desktop or phone app, and go to <b>Customize</b>, then <b>Connectors</b>.</li><li>Choose <b>Add custom connector</b> and paste the address above.</li><li>Choose <b>Add</b>, then <b>Connect</b>, and sign in with GitHub.</li></ol>
<p><small>On a team or company plan, an owner adds it first under Organization settings, then members choose Connect.</small></p>
<h2>ChatGPT</h2><ol><li>Open ChatGPT on the web and go to <b>Plugins</b>.</li><li>Choose the plus button, then <b>Add custom MCP server</b>.</li><li>Enter a name and paste the address above. For authentication choose <b>OAuth</b>.</li><li>Confirm the warning, choose <b>Create as a plugin</b>, then install it and sign in with GitHub.</li></ol>
<h2>Claude Code</h2><pre>claude mcp add --transport http github-robinson ${address}</pre><p><small>Then type /mcp inside Claude Code and sign in.</small></p>
<h2>Cursor</h2><p>Add this to <code>.cursor/mcp.json</code> (or <code>~/.cursor/mcp.json</code>), then sign in when asked:</p>
<pre>{
  "mcpServers": {
    "github-robinson": { "url": "${address}" }
  }
}</pre>
<h2>VS Code</h2><p>Add this to <code>.vscode/mcp.json</code>, then sign in when asked:</p>
<pre>{
  "servers": {
    "github-robinson": { "type": "http", "url": "${address}" }
  }
}</pre></section>
<section><h2>Already connected?</h2><a class="button" href="/connection">Open My connection</a>
<ul class="links"><li><a href="/limits">Free use limits</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li><li><a href="/security">Security</a></li><li><a href="/support">Support</a></li></ul></section>
${brandFooter()}</main></body></html>`;
}

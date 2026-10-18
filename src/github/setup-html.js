// The private setup page's HTML (A4/A5/A11). Plain words for a non-developer owner. Every dynamic value is escaped; no script
// runs on the page; the only inputs that accept a secret are the token boxes and the passphrase boxes.
import { escapeHtml as h } from '../core/http.js';
import { installUrl } from './app-manifest.js';

const STYLE = 'body{font:16px system-ui,sans-serif;max-width:640px;margin:4vh auto;padding:16px;line-height:1.5}form,.card{display:grid;gap:10px;margin:18px 0;padding:14px;border:1px solid #ccc;border-radius:10px}.card{display:block}input,select,button{font:inherit;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:10px;border-radius:6px}button{cursor:pointer}.ok{color:#116611}.todo{color:#8a5200}small{color:#555}';

const hidden = (name, value) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`;
const passphrase = '<label>Administrator passphrase<input type="password" name="passphrase" required autocomplete="current-password"></label>';

function accountCard(a) {
  if (a.error) return `<div class="card"><strong>${h(a.login)}</strong><p>${h(a.error)}</p></div>`;
  const lines = [];
  const mark = (ok, good, todo) => `<li class="${ok ? 'ok' : 'todo'}">${h(ok ? good : todo)}</li>`;
  if (a.credential_kind === 'fine_grained') {
    lines.push(mark(a.fine_grained.present, `Fine-grained token saved (ends in ${a.fine_grained.last4}).`, 'No fine-grained token saved yet.'));
  } else {
    lines.push(mark(a.app.created, `GitHub App created${a.app.slug ? ` (${a.app.slug})` : ''}.`, 'The GitHub App has not been created yet.'));
    if (a.app.error) lines.push(`<li class="todo">${h(a.app.error)}</li>`);
    if (a.app.created) {
      const i = a.installation;
      lines.push(mark(i.status === 'active', `Installed on ${h(a.login)}${i.repository_selection ? ` (${h(i.repository_selection)} repositories)` : ''}.`,
        i.status === 'suspended' ? 'The installation is suspended on GitHub.' : 'The App is not installed on this account yet.'));
      if (i.missing_permissions?.length) lines.push(`<li class="todo">GitHub has not granted ${i.missing_permissions.length} requested permission(s): ${h(i.missing_permissions.slice(0, 8).join(', '))}${i.missing_permissions.length > 8 ? ', …' : ''}. Open the App's page on GitHub and accept the new permissions.</li>`);
    }
    lines.push(mark(a.user.authorized, `You are signed in as ${h(a.user.login || 'yourself')} for personal settings.`, a.user.error || 'Not authorized for personal settings yet (optional).'));
  }
  lines.push(`<li>${a.classic.present ? `Notifications token saved (ends in ${h(a.classic.last4)}, scopes: ${h((a.classic.scopes || []).join(', '))}).` : 'No notifications token (optional).'}</li>`);
  lines.push(`<li>${a.packages?.present ? `Package token saved for ${h(a.packages.actor)} (scopes: ${h((a.packages.scopes || []).join(', '))}).` : 'No package token (optional; package tools require one).'}</li>`);
  lines.push(`<li>Production changes: <strong>${a.production_enabled ? 'on' : 'off'}</strong>${a.is_default ? ' · default account' : ''}</li>`);
  lines.push(`<li>Disposable scratch organization: <strong>${a.is_scratch ? 'yes' : 'no'}</strong></li>`);
  return `<div class="card"><strong>${h(a.label)}</strong> <small>${h(a.login)} · ${h(a.account_type)} · ${h(a.credential_kind === 'app' ? 'GitHub App' : 'fine-grained token')}</small><ul>${lines.join('')}</ul></div>`;
}

/**
 * @param {object} view `{ csrf, result?, revealed?, show?, accounts?, manifestForm?, installLink?, blocked?, keyHelp? }`
 */
export function renderSetup({ csrf, result = '', revealed = null, show = '', accounts = null, manifestForm = null, installLink = null, blocked = '', keyHelp = '', productionNames = null, protectedList = null, spendLimits = null, ownPeopleExtra = null, secretEntry = null, oauthReadiness = null, connections = null }) {
  const form = (action, inner, button, extra = '') => `<form method="post" action="#setup-feedback" autocomplete="off">${hidden('csrf', csrf)}${hidden('action', action)}${extra}${inner}${passphrase}<button type="submit">${h(button)}</button></form>`;
  const login = '<label>GitHub account name (for example your organization or user name)<input name="login" required maxlength="39" autocomplete="off"></label>';
  const type = '<label>Account type<select name="accountType"><option value="Organization">Organization</option><option value="User">Personal user</option></select></label>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Robinson GitHub MCP — private setup</title><style>${STYLE}</style></head><body>` +
    '<h1 id="setup-feedback">Robinson GitHub MCP — private setup</h1>' +
    '<p>Everything secret about GitHub is entered or created here, never in a chat. Each step asks for your administrator passphrase.</p>' +
    (blocked ? `<p role="alert"><strong>${h(blocked)}</strong></p>` : '') +
    (keyHelp ? `<p role="alert"><strong>${h(keyHelp)}</strong></p>` : '') +
    (result ? `<p role="status"><strong>Setup response:</strong> ${h(result)}</p>` : '') +
    (installLink ? `<p><a href="${h(installLink)}">Install the App on GitHub →</a></p>` : '') +
    (secretEntry ? `<h2>Type a secret for GitHub</h2><p>${h(secretEntry.summary)}</p><p><small>The value is sealed with GitHub's public key on this server and sent straight to GitHub. It is not saved, not logged and never shown to Claude. Link is good until ${h(secretEntry.expires)}.</small></p>` +
      form('enter-secret', '<label>Secret value<input type="password" name="value" required maxlength="48000" autocomplete="off"></label>', 'Seal and send to GitHub', hidden('id', secretEntry.id)) : '') +
    (revealed ? `<h2>One-time secret — copy it now</h2><pre>${h(revealed)}</pre><p>It has been deleted from the server and will not appear again.</p>` : '') +
    (manifestForm ? `<h2>Create the GitHub App</h2><p>GitHub will show you the App it is about to create. Check the account name, then click <em>Create GitHub App</em> on GitHub. The keys go straight to this server; you copy nothing.</p>
      <form method="post" action="${h(manifestForm.action)}">${hidden('manifest', manifestForm.manifest)}<button type="submit">Continue to GitHub</button></form>` : '') +
    (accounts ? `<h2>Your accounts</h2>${accounts.length ? accounts.map(accountCard).join('') : '<p>No accounts are set up yet. Create a GitHub App below.</p>'}` : '') +
    (oauthReadiness ? `<div class="card"><h2>Custom MCP OAuth connection status</h2>
      <p><strong>${h(oauthReadiness.summary)}</strong></p>
      <p>Registered clients: ${h(oauthReadiness.registered_clients)} · Non-revoked connector sessions: ${h(oauthReadiness.unrevoked_sessions)} · Current access tokens: ${h(oauthReadiness.usable_access_tokens)} · Stored refresh credentials: ${h(oauthReadiness.refresh_credentials)}</p>
      <p>Custom server address: <code>${h(oauthReadiness.mcp_url)}</code></p>
      <p>${h(oauthReadiness.next_action)}</p>
      <p><small>These are counts only. No client IDs or bearer secrets are shown. Recorded sessions are not proof of real custom-MCP acceptance. Production permissions stay independently controlled.</small></p></div>` : '') +
    (connections ? `<div class="card"><h2>Custom MCP connections (owner only)</h2><p>These identifiers are not passwords. Select the exact existing ChatGPT connection.</p><ul>${connections.map((c) => `<li><strong>${h(c.name)}</strong> — <code>${h(c.id)}</code> — ${h(c.mode.toUpperCase())} / ${h(c.profile)} — accounts: ${h(c.accounts.join(', '))}</li>`).join('')}</ul></div>` : '') +
    form('status', '', 'Show my accounts and check them with GitHub') +
    '<h2>1. Create the GitHub App for an account</h2><p>Private to that account. You will do this once for each account (your organization, and your personal account).</p>' +
    form('start-app', login + type, 'Prepare the GitHub App') +
    '<h2>2. Install the App</h2><p>After the App is created this page shows an install link. When GitHub sends you back here, the account turns green above.</p>' +
    '<h2>IN-06: Disposable scratch organization</h2><p>Only designate a separate organization containing nothing important. Preview developer tools can create and delete run-owned test repositories there. An active GitHub App installed on <strong>All repositories</strong> with the required permissions is mandatory. Production must stay OFF. Never mark your normal organization as disposable.</p>' +
    form('set-scratch', login + '<label>Scratch setting<select name="enabled"><option value="true">Enable for this disposable organization</option><option value="false">Disable scratch mode</option></select></label><label>Re-type the exact organization name<input name="confirmLogin" required maxlength="39" autocomplete="off"></label>', 'Save scratch organization setting') +
    '<h2>Hub RTC test pass (preview, read-only only)</h2><p>Create one short-lived pass scoped to the exact disposable scratch organization. It cannot authorize writes, production, spending or changes in any other account. Reveal once through this protected page, pass privately to the test runner, then revoke immediately.</p>' +
    form('create-rtc-pass', login + '<label>Expiry (days; max 30)<input type="number" name="days" min="1" max="30" value="1" required></label><label>Requests per minute (1–600; default 120)<input type="number" name="rate" min="1" max="600" value="120" required></label>', 'Create read-only RTC pass') +
    '<h2>Scoped service pass (own limits)</h2><p>A pass that can do more than read, but only what you tick here. Leave Areas and Repositories empty for everything the profile offers. Owner controls (connections, production switches, spend settings, secrets) are never available to a pass. Production passes work only on an account where production is already switched on. Reveal once, then revoke when finished.</p>' +
    form('create-scoped-pass', login + '<label>Profile<select name="profile"><option value="read_only">Read-only</option><option value="everyday">Everyday</option><option value="full">Full</option></select></label><label>Mode<select name="mode"><option value="preview">Preview</option><option value="production">Production</option></select></label><label>Allow changes<select name="writes"><option value="false">No</option><option value="true">Yes</option></select></label><label>Allow access changes (members, teams, keys)<select name="access"><option value="false">No</option><option value="true">Yes</option></select></label><label>Spend allowance in dollars (0 = none)<input name="spend" value="0" maxlength="9"></label><label>Areas (comma separated, optional)<input name="areas" maxlength="400"></label><label>Repositories as owner/name (comma separated, optional)<input name="repos" maxlength="2000"></label><label>Expiry (days; max 30, or 365 for Robinson\'s Toolkit)<input type="number" name="days" min="1" max="365" value="1" required></label><label>Robinson\'s Toolkit pass<select name="hub"><option value="false">No</option><option value="true">Yes</option></select></label><label>Requests per minute (1–600; default 120)<input type="number" name="rate" min="1" max="600" value="120" required></label>', 'Create scoped pass') +
    form('revoke-rtc-pass', '<label>RTC pass identifier (24 hex characters)<input name="passId" required minlength="24" maxlength="24" autocomplete="off"></label>', 'Revoke RTC pass') +
    '<h2>3. Authorize as me (optional, for personal settings)</h2>' +
    form('start-user-auth', login.replace('GitHub account name (for example your organization or user name)', 'Account whose App you are authorizing'), 'Authorize on GitHub') +
    '<h2>4. Turn on production for an account</h2><p>Production lets a connection change real branches, releases and settings, always asking first. It is off until you do two steps: ask Claude to turn it on for the account, then confirm here within 10 minutes.</p>' +
    form('confirm-production', login.replace('GitHub account name (for example your organization or user name)', 'Account to turn production on for'), 'Turn on production') +
    '<h2>Upgrade existing custom connection to PRODUCTION</h2><p>If ChatGPT used its own sign-in and kept a FULL/PREVIEW server connection, first press Show my accounts and copy that custom connection ID. The account must already have production enabled. This widens what this connection can request, but never bypasses separate write confirmations, GitHub permissions, spending or protected-resource rules. The official GitHub ChatGPT connector remains separate.</p>' +
    form('upgrade-connection-production', login + '<label>Existing custom connection ID<input name="connection" required maxlength="128" autocomplete="off"></label>', 'Upgrade this connection to PRODUCTION') +
    '<h2>Names that count as production</h2><p>A repository\'s default branch, its protected branches, tags, releases, settings and environments named production, prod or live always count as production. Add more names here (separated by commas; * is a wildcard). Built-in names cannot be removed.</p>' +
    (productionNames ? `<p><small>Environments: ${h(productionNames.environments.join(', ') || 'none')} · Branches: ${h(productionNames.branches.join(', ') || 'none')}</small></p>` : '') +
    form('set-production-names', '<label>Extra environment names<input name="environments" maxlength="400" autocomplete="off"></label><label>Extra branch names<input name="branches" maxlength="400" autocomplete="off"></label>', 'Save production names') +
    '<h2>Protected repositories and installations</h2><p>The server never changes these except as described. <strong>pr-only</strong>: only pull requests (branches, commits, reviews, checks, issues) and merges on green at an exact head. <strong>locked</strong>: nothing at all. Only this page can change the list. For an installation enter its number, or * for all of this server\'s own GitHub Apps.</p>' +
    (protectedList ? `<ul>${protectedList.map((e) => `<li><code>${h(e.kind)}</code> ${h(e.target)} — <strong>${h(e.level)}</strong> (${h(e.reason)})</li>`).join('')}</ul>` : '') +
    form('save-protected', '<label>Kind<select name="kind"><option value="repo">Repository (owner/name)</option><option value="installation">App installation</option></select></label><label>Repository or installation<input name="target" required maxlength="140" autocomplete="off"></label><label>Level<select name="level"><option value="pr-only">pr-only</option><option value="locked">locked</option></select></label><label>Reason<input name="reason" required maxlength="300" autocomplete="off"></label>', 'Add or change this entry') +
    form('remove-protected', '<label>Kind<select name="kind"><option value="repo">Repository</option><option value="installation">App installation</option></select></label><label>Repository or installation to remove<input name="target" required maxlength="140" autocomplete="off"></label>', 'Remove this entry') +
    '<h2>Monthly spend limit</h2><p>How much new monthly GitHub spend (Copilot seats, Codespaces, paid security features) this server may add for an account. <strong>$0 means every action that costs money is refused.</strong> Claude can lower the limit but only this page can raise it. Enter dollars, for example 25 or 19.50.</p>' +
    (spendLimits ? `<ul>${spendLimits.map((a) => `<li>${h(a.login)} — limit ${h(a.limit)}, used this month ${h(a.used)}</li>`).join('')}</ul>` : '') +
    form('set-spend-limit', login + '<label>New monthly limit in dollars<input name="dollars" required maxlength="12" inputmode="decimal" autocomplete="off"></label>', 'Set the spend limit') +
    '<h2>Your own people</h2><p>Comments, reviews and assignments that only reach your own people need no confirmation. These always count: your connected accounts, their organization members, github-actions[bot] and this server\'s own App bots. Add other GitHub names here, separated by commas. Saving replaces this extra list.</p>' +
    (ownPeopleExtra ? `<p><small>Extra names: ${h(ownPeopleExtra.join(', ') || 'none')}</small></p>` : '') +
    form('set-own-people', '<label>Extra names<input name="logins" maxlength="1000" autocomplete="off"></label>', 'Save own people') +
    '<h2>Alternative: use a fine-grained token instead of a GitHub App</h2><p>Simpler, but no per-connection read-only tokens and no check runs. Classic tokens are refused.</p>' +
    form('add-fine-grained', login + '<label>Fine-grained personal access token<input type="password" name="token" required autocomplete="off"></label>', 'Verify and save encrypted token') +
    '<h2>Optional: package token</h2><p>GitHub Packages requires a classic token. Use read:packages to list, add delete:packages to delete, and write:packages to restore. Only repository-scoped registries need repo. It must belong to the personal account or the person signed in for this organization. This token can only be used for this account’s package operations. Repository-limited passes cannot use it. GitHub package access and SSO rules still apply.</p>' +
    form('add-package', login + '<label>Classic package token<input type="password" name="token" required autocomplete="off"></label>', 'Verify and save encrypted package token') +
    form('remove-package', login, 'Remove stored package token') +
    '<h2>Optional: notifications token</h2><p>GitHub only lets a classic token read notifications. It must have only the <em>notifications</em> scope; anything else is refused.</p>' +
    form('add-classic', login + '<label>Classic token (notifications scope only)<input type="password" name="token" required autocomplete="off"></label>', 'Verify and save encrypted token') +
    (show ? `<h2>Reveal a one-time secret</h2>${form('reveal', '', 'Reveal this one-time secret', hidden('id', show))}` : '') +
    '</body></html>';
}

export const resultPage = ({ title, message, installSlug = null, back = true }) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<title>${h(title)}</title><style>${STYLE}</style></head><body><h1>${h(title)}</h1><p>${h(message)}</p>` +
  (installSlug ? `<p><a href="${h(installUrl(installSlug))}">Install the App on GitHub →</a></p>` : '') +
  (back ? '<p><a href="/api/github/setup">Back to setup</a></p>' : '') + '</body></html>';

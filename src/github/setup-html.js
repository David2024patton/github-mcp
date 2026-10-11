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
  lines.push(`<li>Production changes: <strong>${a.production_enabled ? 'on' : 'off'}</strong>${a.is_default ? ' · default account' : ''}</li>`);
  return `<div class="card"><strong>${h(a.label)}</strong> <small>${h(a.login)} · ${h(a.account_type)} · ${h(a.credential_kind === 'app' ? 'GitHub App' : 'fine-grained token')}</small><ul>${lines.join('')}</ul></div>`;
}

/**
 * @param {object} view `{ csrf, result?, revealed?, show?, accounts?, manifestForm?, installLink?, blocked?, keyHelp? }`
 */
export function renderSetup({ csrf, result = '', revealed = null, show = '', accounts = null, manifestForm = null, installLink = null, blocked = '', keyHelp = '' }) {
  const form = (action, inner, button, extra = '') => `<form method="post" autocomplete="off">${hidden('csrf', csrf)}${hidden('action', action)}${extra}${inner}${passphrase}<button type="submit">${h(button)}</button></form>`;
  const login = '<label>GitHub account name (for example your organization or user name)<input name="login" required maxlength="39" autocomplete="off"></label>';
  const type = '<label>Account type<select name="accountType"><option value="Organization">Organization</option><option value="User">Personal user</option></select></label>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Robinson GitHub MCP — private setup</title><style>${STYLE}</style></head><body>` +
    '<h1>Robinson GitHub MCP — private setup</h1>' +
    '<p>Everything secret about GitHub is entered or created here, never in a chat. Each step asks for your administrator passphrase.</p>' +
    (blocked ? `<p role="alert"><strong>${h(blocked)}</strong></p>` : '') +
    (keyHelp ? `<p role="alert"><strong>${h(keyHelp)}</strong></p>` : '') +
    (result ? `<p role="status">${h(result)}</p>` : '') +
    (installLink ? `<p><a href="${h(installLink)}">Install the App on GitHub →</a></p>` : '') +
    (revealed ? `<h2>One-time secret — copy it now</h2><pre>${h(revealed)}</pre><p>It has been deleted from the server and will not appear again.</p>` : '') +
    (manifestForm ? `<h2>Create the GitHub App</h2><p>GitHub will show you the App it is about to create. Check the account name, then click <em>Create GitHub App</em> on GitHub. The keys go straight to this server; you copy nothing.</p>
      <form method="post" action="${h(manifestForm.action)}">${hidden('manifest', manifestForm.manifest)}<button type="submit">Continue to GitHub</button></form>` : '') +
    (accounts ? `<h2>Your accounts</h2>${accounts.length ? accounts.map(accountCard).join('') : '<p>No accounts are set up yet. Create a GitHub App below.</p>'}` : '') +
    form('status', '', 'Show my accounts and check them with GitHub') +
    '<h2>1. Create the GitHub App for an account</h2><p>Private to that account. You will do this once for each account (your organization, and your personal account).</p>' +
    form('start-app', login + type, 'Prepare the GitHub App') +
    '<h2>2. Install the App</h2><p>After the App is created this page shows an install link. When GitHub sends you back here, the account turns green above.</p>' +
    '<h2>3. Authorize as me (optional, for personal settings)</h2>' +
    form('start-user-auth', login.replace('GitHub account name (for example your organization or user name)', 'Account whose App you are authorizing'), 'Authorize on GitHub') +
    '<h2>Alternative: use a fine-grained token instead of a GitHub App</h2><p>Simpler, but no per-connection read-only tokens and no check runs. Classic tokens are refused.</p>' +
    form('add-fine-grained', login + '<label>Fine-grained personal access token<input type="password" name="token" required autocomplete="off"></label>', 'Verify and save encrypted token') +
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

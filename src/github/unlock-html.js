// The guided "Unlock more tools" section of the setup page. Plain words for a non-developer: what each extra token opens,
// numbered steps, and a link that opens GitHub's token page with the right boxes already ticked. A token is only ever typed
// into the protected forms built by the caller (never through chat or a tool argument).
import { escapeHtml as h } from '../core/http.js';

const NEW_TOKEN = 'https://github.com/settings/tokens/new';
const link = (scopes, description) => `${NEW_TOKEN}?scopes=${scopes.join(',')}&description=${encodeURIComponent(description)}`;

const STEPS = (url, scopeText) => `<ol><li>Open <a href="${h(url)}" target="_blank" rel="noopener noreferrer">GitHub's token page</a> (sign in as the account named below if asked). The right boxes are already ticked: ${h(scopeText)}.</li>` +
  '<li>Pick an expiry you are comfortable with and press <em>Generate token</em> at the bottom.</li>' +
  '<li>Copy the token GitHub shows once, paste it into the box below, and press the save button.</li></ol>';

/**
 * @param {{ form: (action: string, inner: string, button: string) => string, login: string }} deps
 * `form` builds a protected form (CSRF and passphrase included); `login` is the account-name field.
 */
export function unlockSection({ form, login }) {
  const field = (label) => `${login}<label>${h(label)}<input type="password" name="token" required autocomplete="off"></label>`;
  return '<h2>Unlock more tools</h2><p>Signing in gives Claude the everyday tools. A few tools need an extra key that GitHub only allows in a separate token. Each one below says what it opens. Tokens are typed only on this protected page, saved encrypted, and can be removed at any time. Never paste one into a chat.</p>' +
    '<h3>Packages <small>(list, delete and restore packages)</small></h3>' +
    '<p>Opens the package tools. GitHub only accepts a classic token for packages, and it must belong to the personal account, or to the person signed in for an organization.</p>' +
    STEPS(link(['read:packages', 'write:packages', 'delete:packages'], 'GitHub MCP package token'), 'read:packages, write:packages, delete:packages') +
    form('add-package', field('Classic package token'), 'Verify and save encrypted package token') +
    form('remove-package', login, 'Remove stored package token') +
    '<h3>Notifications <small>(read your unread notifications)</small></h3>' +
    '<p>Opens the notification tools. GitHub only lets a classic token read notifications, and it must have only that one box ticked.</p>' +
    STEPS(link(['notifications'], 'GitHub MCP notifications token'), 'notifications') +
    form('add-classic', field('Classic token (notifications only)'), 'Verify and save encrypted token') +
    form('remove-classic', login, 'Remove stored notifications token') +
    '<h3>Fine-grained token <small>(instead of a GitHub App)</small></h3>' +
    '<p>A simpler alternative to the GitHub App, with no per-connection read-only tokens and no check runs. Classic tokens are refused here. Create it on GitHub under Settings, Developer settings, Fine-grained tokens, choose the repositories, then paste it below.</p>' +
    '<p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Open GitHub\'s fine-grained token page</a></p>' +
    form('add-fine-grained', field('Fine-grained personal access token'), 'Verify and save encrypted token') +
    form('remove-fine-grained', login, 'Remove stored fine-grained token');
}

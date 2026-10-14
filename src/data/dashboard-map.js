import { EXTRA_GUIDES } from './dashboard-sections.js';
// Settings GitHub gives no API for (B-8 seed; O-1 walks every settings page against the live dashboard and completes the map).
// Each entry returns structured steps (contract section 11): `{ n, action, target, value? }`, the page `url` (with {org} / {user}
// filled in when the account is known), what the owner should see afterwards, and, where GitHub lets the value be read, the
// read-back `verifyWith` (a tool that exists in docs/TOOL-CATALOG.md). A guided setting is never reported done unless it is
// read back or Chris says so.
export const MAP_STATUS = 'Guided owner settings index: verify the current GitHub page before changing settings; UI-only changes need manual confirmation.';

const org = (path) => `https://github.com/organizations/{org}/${path}`;
const me = (path) => `https://github.com/settings/${path}`;

export const SETTINGS = Object.freeze([
  {
    id: 'org-require-2fa', scope: 'org', title: 'Require two-factor authentication for an organization', page: 'Organization settings → Authentication security',
    words: ['2fa', 'two-factor', 'two factor', 'mfa', 'authentication', 'security'], url: org('settings/security'),
    steps: [
      { action: 'Open the page', target: 'Authentication security' },
      { action: 'Tick the box', target: 'Require two-factor authentication for everyone in the organization', value: 'on' },
      { action: 'Press the button', target: 'Save' }
    ],
    expected: 'The box stays ticked. Members without two-factor are removed unless they turn it on, so check the member list first.',
    verifyWith: { tool: 'github_admin_check_setting', args: { settingId: 'org-require-2fa', owner: '{org}', expectedBoolean: true }, field: 'verified', equals: true }
  },
  {
    id: 'org-saml-sso', scope: 'org', title: 'SAML single sign-on (Enterprise Cloud)', page: 'Organization settings → Authentication security',
    words: ['saml', 'sso', 'single sign-on', 'identity provider', 'enterprise'], url: org('settings/security'),
    steps: [
      { action: 'Open the page', target: 'Authentication security' },
      { action: 'Turn on', target: 'Enable SAML authentication' },
      { action: 'Enter the values from your identity provider', target: 'Sign on URL, Issuer, Public certificate' },
      { action: 'Test the connection, then save', target: 'Test SAML configuration, Save' }
    ],
    expected: 'Needs GitHub Enterprise Cloud. A test sign-in succeeds before you save.'
  },
  {
    id: 'org-plan', scope: 'org', title: 'Change the plan or buy seats', page: 'Organization settings → Billing and licensing',
    words: ['plan', 'upgrade', 'downgrade', 'seats', 'billing', 'subscription', 'pricing'], url: org('settings/billing'),
    steps: [
      { action: 'Open the page', target: 'Billing and licensing → Plans and usage' },
      { action: 'Choose', target: 'Upgrade or Change plan' },
      { action: 'Review the price shown, then confirm yourself', target: 'Payment' }
    ],
    expected: 'The new plan shows on the page. This server never buys anything.'
  },
  {
    id: 'org-marketplace', scope: 'org', title: 'Buy or cancel a Marketplace app', page: 'GitHub Marketplace',
    words: ['marketplace', 'app', 'subscribe', 'purchase', 'buy'], url: 'https://github.com/marketplace',
    steps: [
      { action: 'Open the app\'s Marketplace page', target: 'github.com/marketplace' },
      { action: 'Pick the plan and the account', target: 'Set up a plan' },
      { action: 'Review the price, then confirm yourself', target: 'Payment' }
    ],
    expected: 'The app appears under the account\'s installed apps. This server never buys anything.'
  },
  {
    id: 'org-oauth-app-policy', scope: 'org', title: 'OAuth app access policy', page: 'Organization settings → Third-party access',
    words: ['oauth', 'third-party', 'third party', 'app access', 'restrictions', 'approve app'], url: org('settings/oauth_application_policy'),
    steps: [
      { action: 'Open the page', target: 'Third-party access' },
      { action: 'Choose', target: 'Setup application access restrictions' },
      { action: 'Approve or deny each listed app', target: 'Grant / Deny' }
    ],
    expected: 'Only approved OAuth apps can read the organization\'s private data.'
  },
  {
    id: 'org-token-policy', scope: 'org', title: 'Fine-grained token policy for the organization', page: 'Organization settings → Personal access tokens',
    words: ['personal access token', 'fine-grained', 'pat', 'token policy', 'tokens'], url: org('settings/personal-access-tokens'),
    steps: [
      { action: 'Open the page', target: 'Personal access tokens → Settings' },
      { action: 'Choose whether fine-grained tokens may access the organization, and whether each needs approval', target: 'Allow access via fine-grained personal access tokens' },
      { action: 'Press the button', target: 'Save' }
    ],
    expected: 'The choice you made is shown under Settings.'
  },
  {
    id: 'org-transfer', scope: 'org', title: 'Transfer an organization to another owner', page: 'Organization settings → Danger zone',
    words: ['transfer', 'ownership', 'owner', 'danger zone', 'hand over'], url: org('settings'),
    steps: [
      { action: 'Make the new owner an organization owner first', target: 'People → Change role' },
      { action: 'Open the page', target: 'Settings → Danger zone' },
      { action: 'Type the organization name to confirm, yourself', target: 'Leave organization / Transfer ownership' }
    ],
    expected: 'The new owner appears under People as Owner. This cannot be undone from here.'
  },
  {
    id: 'org-delete', scope: 'org', title: 'Delete an organization', page: 'Organization settings → Danger zone',
    words: ['delete', 'remove organization', 'danger zone', 'close'], url: org('settings'),
    steps: [
      { action: 'Open the page', target: 'Settings → Danger zone' },
      { action: 'Press the button and type the organization name yourself', target: 'Delete this organization' }
    ],
    expected: 'The organization and all its repositories are gone. This cannot be undone and this server will never do it.'
  },
  {
    id: 'org-interaction-limit', scope: 'org', title: 'Interaction limits longer than six months', page: 'Organization settings → Moderation',
    words: ['interaction limit', 'limit interactions', 'moderation', 'comments restricted', 'temporary'], url: org('settings/interaction_limits'),
    steps: [
      { action: 'Open the page', target: 'Moderation → Interaction limits' },
      { action: 'Choose who may interact and for how long', target: 'Limit to existing users / prior contributors / collaborators' }
    ],
    expected: 'A banner shows the limit and when it ends. The API only allows up to six months.'
  },
  {
    id: 'user-password', scope: 'user', title: 'Password, passkeys and recovery codes', page: 'Settings → Password and authentication',
    words: ['password', 'passkey', 'recovery codes', 'two-factor', '2fa', 'security key', 'authenticator'], url: me('security'),
    steps: [
      { action: 'Open the page', target: 'Password and authentication' },
      { action: 'Change the password, add a passkey or security key, or download recovery codes — yourself', target: 'Change password / Passkeys / Recovery codes' }
    ],
    expected: 'The page lists the new method. Store recovery codes somewhere safe; this server never sees them.'
  },
  {
    id: 'user-copilot-policy', scope: 'user', title: 'Personal Copilot policies', page: 'Settings → Copilot',
    words: ['copilot', 'suggestions', 'public code', 'policies', 'personal'], url: me('copilot'),
    steps: [
      { action: 'Open the page', target: 'Copilot' },
      { action: 'Change the policy you want', target: 'Suggestions matching public code, Allow GitHub to use my data' }
    ],
    expected: 'The setting shows your new choice after the page reloads.'
  },
  {
    id: 'user-notification-email', scope: 'user', title: 'Notification email routing', page: 'Settings → Notifications',
    words: ['notification email', 'email routing', 'notifications', 'custom routing', 'which email'], url: me('notifications'),
    steps: [
      { action: 'Open the page', target: 'Notifications → Default notifications email' },
      { action: 'Choose the address', target: 'Default notifications email' },
      { action: 'Optionally route an organization to another address', target: 'Custom routing' }
    ],
    expected: 'The chosen address shows under Default notifications email.'
  },
  {
    id: 'user-security-log', scope: 'user', title: 'Personal security log', page: 'Settings → Security log',
    words: ['security log', 'audit', 'sign-ins', 'login history', 'sessions'], url: me('security-log'),
    steps: [
      { action: 'Open the page', target: 'Security log' },
      { action: 'Filter by event or date if needed', target: 'Search box' }
    ],
    expected: 'A list of recent security events for your account. It is read-only.'
  },
  {
    id: 'user-sponsors', scope: 'user', title: 'GitHub Sponsors', page: 'Sponsors dashboard',
    words: ['sponsors', 'sponsor', 'funding', 'donate'], url: 'https://github.com/sponsors/accounts',
    steps: [
      { action: 'Open the dashboard', target: 'Sponsors' },
      { action: 'Choose the account and set tiers or sponsorships — yourself', target: 'Your tiers / Your sponsorships' }
    ],
    expected: 'The dashboard shows the change. This server never spends money.'
  },
  {
    id: 'user-scheduled-reminders', scope: 'user', title: 'Scheduled reminders', page: 'Settings → Scheduled reminders',
    words: ['scheduled reminders', 'reminders', 'pull request reminders', 'slack reminders'], url: me('reminders'),
    steps: [
      { action: 'Open the page', target: 'Scheduled reminders' },
      { action: 'Pick the organization, the days and times, and which events trigger a reminder', target: 'Add scheduled reminders' }
    ],
    expected: 'The reminder is listed with its schedule.'
  },
  {
    id: 'user-delete-account', scope: 'user', title: 'Delete or rename the personal account', page: 'Settings → Account',
    words: ['delete account', 'close account', 'rename', 'change username', 'danger zone'], url: me('admin'),
    steps: [
      { action: 'Open the page', target: 'Account → Change username / Delete account' },
      { action: 'Type your username to confirm, yourself', target: 'Delete your account' }
    ],
    expected: 'Deleting removes everything and cannot be undone. This server will never do it.'
  },
  ...EXTRA_GUIDES
]);

const norm = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Best matches for a plain-words query, highest score first (at most `max`). */
export function findSettings(query, { max = 3, scope } = {}) {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(' ').filter((t) => t.length > 1);
  const scored = [];
  for (const s of SETTINGS) {
    if (scope && s.scope !== scope) continue;
    const title = norm(s.title);
    const page = norm(s.page);
    let score = title.includes(q) ? 10 : 0;
    for (const w of s.words) if (q.includes(norm(w))) score += 4;
    for (const t of terms) { if (title.includes(t)) score += 2; if (page.includes(t)) score += 1; }
    if (score > 0) scored.push({ s, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.s);
}

/** Fills {org} and {user} in a string, an object or an array. */
export function fill(value, { org: orgName, user, repo }) {
  if (typeof value === 'string') return value.replaceAll('{org}', orgName ?? '{org}').replaceAll('{user}', user ?? '{user}').replaceAll('{repo}', repo ?? '{repo}');
  if (Array.isArray(value)) return value.map((v) => fill(v, { org: orgName, user, repo }));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, { org: orgName, user })]));
  return value;
}

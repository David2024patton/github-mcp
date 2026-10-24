import { EXTRA_GUIDES } from './dashboard-sections.js';
import { Y1_ADDED_PERMISSIONS } from '../github/app-manifest.js';
// Settings GitHub gives no API for (B-8 seed; O-1 walks every settings page against the live dashboard and completes the map).
// Each entry returns structured steps (contract section 11): `{ n, action, target, value? }`, the page `url` (with {org} / {user}
// filled in when the account is known), what the owner should see afterwards, and, where GitHub lets the value be read, the
// read-back `verifyWith` (a tool that exists in docs/TOOL-CATALOG.md). A guided setting is never reported done unless it is
// read back or Chris says so.
export const MAP_STATUS = 'Guided owner settings index: verify the current GitHub page before changing settings; UI-only changes need manual confirmation.';

const org = (path) => `https://github.com/organizations/{org}/${path}`;
const me = (path) => `https://github.com/settings/${path}`;


// Y-9c: settings that GitHub offers only in the browser. Each says so (apiAvailable:false) and why, and which steps a browser agent could do.
const webOnly = (id, scope, title, page, words, url, steps, expected, reason, browserAgent) => ({ id, scope, title, page, words, url, steps, expected, apiAvailable: false, reason, browserAgent });
const WEB_ONLY = [
  webOnly('user-avatar', 'user', 'Profile picture', 'Settings → Public profile', ['avatar', 'profile picture', 'photo', 'profile image'], me('profile'),
    [{ action: 'Open the page', target: 'Public profile' }, { action: 'Press', target: 'Edit under Profile picture, then Upload a photo' }, { action: 'Crop and press', target: 'Set new profile picture' }],
    'The new picture shows on your profile after a refresh.', 'GitHub has no API for profile pictures.', 'A browser agent can do the clicks; choosing the file needs a file picker the owner may have to complete.'),
  webOnly('org-avatar', 'org', 'Organization picture', 'Organization settings → Profile', ['avatar', 'logo', 'organization picture', 'org image'], org('settings/profile'),
    [{ action: 'Open the page', target: 'Organization settings → Profile' }, { action: 'Press', target: 'Upload new picture' }, { action: 'Save', target: 'Update profile' }],
    'The organization page shows the new picture.', 'GitHub has no API for organization pictures.', 'A browser agent can do the clicks; the file picker may need the owner.'),
  webOnly('repo-social-preview', 'repo', 'Repository social preview image', 'Repository → Settings → General', ['social preview', 'og image', 'preview image', 'link preview'], 'https://github.com/{org}/{repo}/settings',
    [{ action: 'Open the page', target: 'Settings → General' }, { action: 'Scroll to', target: 'Social preview' }, { action: 'Press', target: 'Edit → Upload an image' }],
    'Links to the repository show the new image (it can take a few minutes).', 'GitHub has no API for the social preview image.', 'A browser agent can reach the page; the image upload needs a file picker.'),
  webOnly('user-pinned', 'user', 'Pinned repositories and gists on your profile', 'Your profile page', ['pinned', 'pin repositories', 'pin gists', 'profile pins'], 'https://github.com/{user}',
    [{ action: 'Open the page', target: 'Your profile' }, { action: 'Press', target: 'Customize your pins' }, { action: 'Tick up to six items, then press', target: 'Save pins' }],
    'The pinned items show at the top of your profile.', 'GitHub offers pinning of profile items only in the browser (its GraphQL schema has no mutation).', 'A browser agent can do every step.'),
  webOnly('user-profile-readme', 'user', 'Show your profile README', 'Your profile page', ['profile readme', 'readme toggle', 'special repository', 'about me'], 'https://github.com/{user}',
    [{ action: 'Create a public repository', target: 'named exactly like your username, with a README.md (this server can do that)' }, { action: 'Open', target: 'Your profile and check the README shows' }],
    'The README appears on your profile.', 'The toggle itself is browser-only; the repository and file can be made with this server\'s repository and file tools.', 'A browser agent can check the result.'),
  webOnly('user-contribution-visibility', 'user', 'Contribution graph and achievements visibility', 'Settings → Public profile', ['contributions', 'private contributions', 'achievements', 'activity overview', 'contribution graph'], me('profile'),
    [{ action: 'Open the page', target: 'Public profile' }, { action: 'Tick or untick', target: 'Include private contributions on my profile; Show Achievements on my profile' }, { action: 'Press', target: 'Update profile' }],
    'The profile shows or hides the items as chosen.', 'These profile switches have no API.', 'A browser agent can do every step.'),
  webOnly('user-recovery-codes', 'user', 'Recovery codes and trusted devices', 'Settings → Password and authentication', ['recovery codes', 'devices', 'sessions', 'two-factor recovery', 'passkey recovery'], me('security'),
    [{ action: 'Open the page', target: 'Password and authentication' }, { action: 'Press', target: 'View recovery codes (re-enter your password)' }, { action: 'Save them somewhere safe', target: 'Download or print' }],
    'You hold a current copy of the codes. Never paste them into any chat or tool.', 'Recovery codes are secrets and have no API.', 'Not for an agent: the codes are secrets and must stay with the owner.'),
  webOnly('project-v2-workflows', 'org', 'Projects v2 workflows, charts and layout', 'Project → ··· menu', ['project workflows', 'charts', 'insights', 'project layout', 'auto add', 'auto archive'], 'https://github.com/orgs/{org}/projects',
    [{ action: 'Open the project', target: 'the project page' }, { action: 'Open the menu', target: '··· → Workflows (automations) or Insights (charts)' }, { action: 'Choose and save', target: 'the workflow, chart or layout you want' }],
    'The workflow shows as enabled; charts appear under Insights.', 'GitHub has no API to create or edit project workflows or charts. Views are covered by github_project_view_save, and an existing workflow can be deleted with github_graphql_write (deleteProjectV2Workflow).', 'A browser agent can do every step.'),
  webOnly('discussion-categories', 'repo', 'Discussion categories and polls', 'Repository → Discussions', ['discussion categories', 'poll', 'discussions categories', 'category'], 'https://github.com/{org}/{repo}/discussions',
    [{ action: 'Open the page', target: 'Discussions' }, { action: 'Press', target: 'the pencil next to Categories (create, edit, delete)' }, { action: 'To add a poll', target: 'New discussion → Poll category' }],
    'Categories show in the sidebar; polls appear in the new discussion.', 'Categories and polls cannot be created through GitHub\'s API (discussions themselves can).', 'A browser agent can do every step.'),
  webOnly('org-announcement-banner', 'org', 'Organization announcement banner', 'Organization settings → Announcements', ['announcement', 'banner', 'announcement banner', 'notice'], org('settings/announcements'),
    [{ action: 'Open the page', target: 'Organization settings → Announcements' }, { action: 'Type the message and choose an expiry', target: 'Announcement' }, { action: 'Press', target: 'Save' }],
    'Members see the banner on the organization pages until it expires.', 'No API exists for organization announcements.', 'A browser agent can do every step.'),
  webOnly('user-revoke-leaked-credential', 'user', 'Revoke a leaked token or key', 'Settings → Developer settings', ['leaked token', 'revoke token', 'leaked secret', 'compromised key', 'credential leak', 'revoke credential'], me('tokens'),
    [{ action: 'Open the page', target: 'Developer settings → Personal access tokens (or SSH and GPG keys, or Applications)' }, { action: 'Find the leaked credential and press', target: 'Delete / Revoke' }, { action: 'Then create a new one', target: 'and update wherever it is used' }],
    'The credential no longer appears in the list; anything still using it fails.', 'GitHub\'s revoke-credentials endpoint takes the secret itself, and no secret ever passes through a tool here, so revoking is done on github.com.', 'Not for an agent: never give a secret to an agent.'),
  webOnly('repo-tag-protection', 'repo', 'Tag protection (retired — use rulesets)', 'Repository → Settings → Rules', ['tag protection', 'protected tags', 'tags'], 'https://github.com/{org}/{repo}/settings/rules',
    [{ action: 'Do not use the old tag protection', target: 'GitHub retired it' }, { action: 'Use a ruleset instead', target: 'github_ruleset_save with target "tag" (this server can do that)' }],
    'A ruleset targeting tags blocks the changes you wanted to stop.', 'Tag protection rules were retired by GitHub; rulesets replace them and have an API.', 'Not needed: use the ruleset tool.')
];

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
    expected: 'The new plan shows on the page. This is a navigation guide, not a purchase. Where the provider supports an API action, it requires the user’s delegated authority, cost disclosure and confirmation.'
  },
  {
    id: 'org-marketplace', scope: 'org', title: 'Buy or cancel a Marketplace app', page: 'GitHub Marketplace',
    words: ['marketplace', 'app', 'subscribe', 'purchase', 'buy'], url: 'https://github.com/marketplace',
    steps: [
      { action: 'Open the app\'s Marketplace page', target: 'github.com/marketplace' },
      { action: 'Pick the plan and the account', target: 'Set up a plan' },
      { action: 'Review the price, then confirm yourself', target: 'Payment' }
    ],
    expected: 'The app appears under the account\'s installed apps. This is a navigation guide, not a purchase. Where the provider supports an API action, it requires the user’s delegated authority, cost disclosure and confirmation.'
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
    id: 'app-permissions-review', scope: 'org', title: 'Approve new permissions for the server\'s GitHub App', page: 'Developer settings → GitHub Apps → Permissions & events',
    words: ['app permissions', 'github app permissions', 'accept new permissions', 'permissions & events', 'packages permission', 'runner permission', 'merge queue permission', 'upgrade app'], url: org('settings/apps'),
    steps: [
      { action: 'Open the page', target: 'Developer settings → GitHub Apps → this server\'s App → Permissions & events' },
      { action: 'Raise each of these permissions, then save', target: Object.entries(Y1_ADDED_PERMISSIONS).map(([name, level]) => `${name}: ${level}`).join(', '), value: 'Save changes' },
      { action: 'Open the installation page for each account and accept the new permissions', target: 'Settings → Installed GitHub Apps → Configure → Review request' }
    ],
    expected: 'Each installation shows the new permissions as accepted. GitHub does not let an API change an App\'s permissions, and nothing here claims a permission the installation has not accepted.',
    verifyWith: { tool: 'github_check_permissions', args: { account: '{org}' }, field: 'accounts', note: 'status must read "all good" for the account' }
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
    expected: 'The organization and all its repositories are gone. This cannot be undone and this guide does not delete it. Any supported destructive action requires separate exact authorization and confirmation.'
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
    expected: 'The dashboard shows the change. This guide does not send payment. Actual supported sponsorship actions require the user’s delegated payment authorization and confirmed cost.'
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
    expected: 'Deleting removes everything and cannot be undone. This guide does not delete the account. Any supported destructive action requires the user’s exact authorization and confirmation.'
  },
  {
    id: 'repo-wiki-edit', scope: 'repo', title: 'Create the first page of a repository wiki (editing later: use the wiki tools)', page: 'Repository → Wiki',
    words: ['wiki', 'wiki page', 'documentation page', 'edit wiki', 'new wiki page', 'first wiki page'], url: 'https://github.com/{org}/{repo}/wiki',
    steps: [
      { action: 'Open the page', target: 'Wiki tab of the repository (turn the wiki on first under Settings → Features if it is missing)' },
      { action: 'Press the button', target: 'Create the first page' },
      { action: 'Type the title and text, then press', target: 'Save Page' }
    ],
    expected: 'The page appears in the wiki sidebar. GitHub only creates a wiki\'s git repository when its first page is saved in the browser; after that github_wiki_list, github_wiki_read and github_wiki_write work.',
    apiAvailable: false, reason: 'GitHub has no API to create a wiki; the first page has to be saved in the browser.', browserAgent: 'A browser agent can do every step.'
  },
  ...WEB_ONLY,
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
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, { org: orgName, user, repo })]));
  return value;
}

// O-1: explicit guided GitHub dashboard page coverage, not fabricated API support.
// Each row names the control/action the owner can locate and what to verify.
// Deep links are navigation aids; GitHub can move a control between pages.
// Account deletion and purchases deliberately remain browser-only.
const root={
  repo:'https://github.com/{org}/{repo}/settings',
  org:'https://github.com/organizations/{org}/settings',
  user:'https://github.com/settings'
};
const pages={
  repo:[
    ['general','General','', 'Repository features, default branch and merge methods','The chosen repository option remains selected'],
    ['access','Collaborators and teams','/access','Individual and team repository permissions','The access list reflects the named principal and new role'],
    ['moderation','Moderation','/interaction_limits','Interaction limits and temporary restrictions','The selected limit and expiration appear'],
    ['branches','Branches','/branches','Branch protection and branch-level rules','The named protected branch retains its intended checks'],
    ['tags','Tags','/tags','Tag protections and tag rules','The named tag pattern and actions are visible'],
    ['rules','Rules and rulesets','/rules','Repository rulesets and enforcement mode','The active ruleset lists the requested rules and bypass policy'],
    ['actions','Actions — General','/actions','Allowed actions, default workflow access and token permissions','The Actions policy and token access match the intended settings'],
    ['runners','Actions — Runners','/actions/runners','Self-hosted runner groups and enrollment','The runner appears only in its authorized runner group'],
    ['models','GitHub Models','/models','Model access and organization policy','The repository model policy displays the intended access'],
    ['webhooks','Webhooks','/hooks','Event subscriptions and delivery destination','The webhook events and last delivery health match the intended integration'],
    ['copilot','Copilot','/copilot','Copilot access and repository policies','GitHub displays the selected Copilot policy'],
    ['environments','Environments','/environments','Deployment approval, secrets and protection rules','The named environment shows the same reviewers and restrictions'],
    ['codespaces','Codespaces','/codespaces','Dev container and Codespaces repository policies','The Codespaces settings show the intended configuration'],
    ['pages','Pages','/pages','Pages source, branch and custom domain','The published source and certificate state are visible'],
    ['security','Code security and analysis','/security_analysis','Dependabot, code scanning and secret protection','Security controls and alerts reflect the selected eligible features'],
    ['deploy-keys','Deploy keys','/keys','SSH deploy keys and read-only versus write access','The named deploy key appears with the intended access mode'],
    ['actions-secrets','Actions secrets and variables','/secrets/actions','Actions environment and repository secret names','Only secret names and update time appear; values remain hidden'],
    ['codespaces-secrets','Codespaces secrets','/secrets/codespaces','Codespaces secret names and repository exposure','Only the selected secret names and access scope appear'],
    ['dependabot-secrets','Dependabot secrets','/secrets/dependabot','Dependabot secret names and access scope','The Dependabot secret metadata reflects the intended scope'],
    ['apps','GitHub Apps','/installations','Repository access for installed GitHub Apps','The installation shows the intended repository and grants'],
    ['notifications','Email notifications','/notifications','Repository-level notification routing','The relevant notification preferences remain selected'],
    ['autolinks','Autolink references','/autolink_references','External issue prefix and URL template','New references resolve to the intended issue tracker'],
    ['properties','Custom properties','/custom_properties','Repository property values','Property names and values match the chosen repository classification'],
    ['topics','Topics and About','', 'Repository description, topics and social preview','The public repository page displays the intended About metadata']
  ],
  org:[
    ['general','General and profile','', 'Organization display name, contact and profile','Organization profile reflects the saved values'],
    ['member-privileges','Member privileges','/member_privileges','Default permission and who may create repositories or forks','The member policy shows the intended privileges'],
    ['org-roles','Organization roles','/roles','Organization owner and custom organization-role assignments','Role holders have exactly the intended permissions'],
    ['repo-roles','Repository roles','/repository-roles','Custom repository roles when the current plan supports them','The role appears with the intended permission set or the plan limitation'],
    ['members','People and members','/member_privileges','Member role and access requirements','The People roster shows members and permissions'],
    ['import-export','Repository import and export','/repository_defaults','Import, transfer and export policy','The organization policy reflects the selected restriction'],
    ['moderation','Moderation','/moderation','Organization-wide interaction and moderation limits','The active moderation rule and expiry are visible'],
    ['repo-defaults','Repository defaults','/repository_defaults','Default visibility, permissions and repository creation policy','New-repository defaults match the intended policy'],
    ['topics','Organization topics','', 'Organization description, topics and profile details','The organization profile displays the updated metadata'],
    ['properties','Custom properties','/custom-properties','Organization property schema and allowed values','Custom property definitions appear in the organization schema'],
    ['rulesets','Rulesets','/rules','Organization default branch and push policy','Ruleset scope and bypass principals appear'],
    ['codespaces','Codespaces','/codespaces','Codespaces policies, machine types and paying organization','Organization Codespaces access and spending limits are visible'],
    ['planning','Planning and Projects','/projects','Project creation and organization planning permissions','Projects follow the intended organization visibility rules'],
    ['copilot','Copilot','/copilot','Copilot seat assignment and enterprise policy','Seats and selected organizations match the desired access'],
    ['actions','Actions policies','/actions','Allowed actions, fork approvals and workflow token defaults','Actions permissions and workflow defaults match the policy'],
    ['models','GitHub Models','/models','Organization model usage and access policy','Model policy displays the intended grant'],
    ['webhooks','Webhooks','/hooks','Organization event subscriptions and delivery endpoints','Events and webhook delivery statuses are visible'],
    ['discussions','Organization discussions','/discussions','Organization discussion visibility and moderation','Discussion permissions match the selected option'],
    ['packages','Packages','/packages','Package permissions and retention','Package access and retention controls display correctly'],
    ['pages','Pages','/pages','Organization Pages publication policy','Pages access policy reflects the chosen visibility'],
    ['compute-network','Hosted compute networking','/actions/runners','Hosted runner/network restrictions','Runner connectivity restrictions reflect the selected policy'],
    ['authentication','Authentication security','/security','2FA, SAML and enforced sign-in policies','Account security settings and any affected members are reviewed'],
    ['advanced-security','Advanced Security','/security_analysis','Secret scanning, code security and paid-feature policy','Enabled features and costs are checked in billing before approval'],
    ['deploy-keys','Deploy key policy','/security','Organization deploy-key restrictions','Allowed key access follows the organization policy'],
    ['verified-domains','Verified domains','/verified_domains','DNS domain verification and approved addresses','Verified domain shows successful DNS ownership'],
    ['secrets','Secrets and variables','/secrets/actions','Organization Actions and Codespaces secret metadata','Only names, assigned repositories and update times appear'],
    ['git-apps','GitHub Apps','/installations','Installed GitHub Apps and repository grant scope','Installation permissions and selected repository list are correct'],
    ['pat-policy','Personal access token policy','/personal-access-tokens','Fine-grained token restrictions and approval policy','Token requests and approvals match the organization policy'],
    ['reminders','Scheduled reminders','/reminders','Team review reminders and notification cadence','Reminder schedule and target team are listed'],
    ['billing','Billing and licensing','/billing','Plan seats and product usage','The billing page shows the expected line items, without purchases'],
    ['budgets','Billing budgets','/billing/budgets','Spend budgets and stop-usage controls','The budget amount and whether usage stops at the cap are visible'],
    ['developer','Developer settings','/applications','Organization App and integration configuration','The integration has the expected owner and callback setup']
  ],
  user:[
    ['profile','Public profile','/profile','Profile name, bio and social links','The public profile shows the saved details'],
    ['account','Account','/admin','Username, account identity and closure options','The account identity matches the intended settings'],
    ['appearance','Appearance','/appearance','Theme and appearance preference','The selected theme is visible after reload'],
    ['accessibility','Accessibility','/accessibility','Motion, keyboard and accessibility preferences','Accessibility settings persist after reload'],
    ['notifications','Notifications','/notifications','Email, web and mobile notification rules','Email routing and watched subscriptions match preferences'],
    ['billing','Billing and licensing','/billing','Plans, usage and billing limits','The cost and plan shown agree with owner decisions'],
    ['emails','Emails','/emails','Verified email addresses and primary visibility','Only verified addresses appear as confirmed'],
    ['authentication','Password and authentication','/security','Passkeys, 2FA and recovery methods','The enabled authentication method is shown; recovery codes stay private'],
    ['sessions','Sessions','/sessions','Signed-in sessions and device access','Unrecognized sessions are revoked when directed'],
    ['ssh','SSH and GPG keys','/keys','Authentication/signing public keys and expiration','Only intended keys remain listed'],
    ['organizations','Organizations','/organizations','Member organizations, invites and SSO authorizations','Membership and invitations match approved organizations'],
    ['moderation','Moderation','/blocked_users','Blocked users and interaction limits','The affected account appears in the block list'],
    ['repos','Repositories','/repositories','Repository identity and defaults','Only intended repository access appears'],
    ['codespaces','Codespaces','/codespaces','Codespaces defaults, secrets and policy','Codespaces configuration reflects selected choices'],
    ['packages','Packages','/packages','Package permissions and publishing preferences','Selected package access persists'],
    ['copilot','Copilot','/copilot','Copilot model and feature policy','Copilot preferences remain selected'],
    ['pages','Pages','/pages','Personal Pages and verified domains','Pages publication status and domain are visible'],
    ['replies','Saved replies','/replies','Reusable message responses','Saved reply appears and has the intended text'],
    ['code-security','Code security','/security','Code/security notification and vulnerability preferences','Security alert subscriptions reflect preferences'],
    ['applications','Applications','/applications','Authorized OAuth Apps and installed GitHub Apps','Only approved applications retain access'],
    ['reminders','Scheduled reminders','/reminders','PR/team reminder schedule','Configured reminders have the intended cadence'],
    ['security-log','Security log','/security-log','Login and account security events','Security events list only expected actions'],
    ['sponsorship-log','Sponsorship log','/sponsors-log','Sponsors and sponsorship billing history','Sponsorship details and billing match the account owner-approved consent'],
    ['developer','Developer settings','/developers','OAuth and GitHub Apps created by this account','App ownership, callbacks and permissions match the intended design']
  ]
};
export const EXTRA_GUIDES=Object.freeze(
  Object.entries(pages).flatMap(([scope,items])=>items.map(([suffix,title,path,control,expected])=>({
    id:scope+'-page-'+suffix,scope,title,
    page:(scope==='repo'?'Repository':scope==='org'?'Organization':'Personal')+
      ' settings → '+title,
    words:[...title.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2),
      ...control.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>4)].slice(0,16),
    url:root[scope]+path,
    steps:[{action:'Open',target:title+' settings page'},
      {action:'Review or choose',target:control},
      {action:'Save and independently verify',target:title+' setting when GitHub offers a Save/Confirm control'}],
    expected,
    // No verifyWith on visually inspected UI-only controls. Owner/browser
    // confirmation is required before reporting completion.
    verification:'manual_dashboard_confirmation'
  })))
);

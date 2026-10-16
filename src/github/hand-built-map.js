// U-1: curated tools preserve specialized guards; never permit universal bypass.
// Non-exhaustive examples beyond the patterns remain subject to conservative production classification.
const maps=[
  [/^PUT \/repos\/\{owner\}\/\{repo\}\/pulls\/\{pull_number\}\/merge$/, 'github_pr_merge'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/merge-upstream$/, 'github_pr_merge'],
  [/^PUT \/repos\/\{owner\}\/\{repo\}\/actions\/secrets\//, 'github_secret_set'],
  [/^PUT \/orgs\/\{org\}\/actions\/secrets\//, 'github_secret_set'],
  [/^PUT \/repos\/\{owner\}\/\{repo\}\/dependabot\/secrets\//, 'github_secret_set'],
  [/^PUT \/repos\/\{owner\}\/\{repo\}\/branches\/\{branch\}\/protection/, 'github_branch_protection_save'],
  [/^PUT \/repos\/\{owner\}\/\{repo\}\/rulesets/, 'github_ruleset_save'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/pulls$/, 'github_pr_create'],
  [/^PATCH \/repos\/\{owner\}\/\{repo\}\/pulls\/\{pull_number\}$/, 'github_pr_update'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/issues$/, 'github_issue_create'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/issues\/\{issue_number\}\/comments$/, 'github_issue_comment'],
  [/^PATCH \/repos\/\{owner\}\/\{repo\}$/, 'github_repo_update_settings'],
  [/^POST \/orgs\/\{org\}\/repos$/, 'github_repo_create'],
  [/^POST \/user\/repos$/, 'github_repo_create'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/releases$/, 'github_release_create'],
  [/^PATCH \/repos\/\{owner\}\/\{repo\}\/releases\//, 'github_release_update'],
  [/^DELETE \/repos\/\{owner\}\/\{repo\}\/git\/refs\//, 'github_branch_delete'],
  [/\/copilot\/billing\/selected_users$/, 'github_copilot_add_seats'],
  [/\/settings\/billing\/budgets/, 'github_billing_save_budget'],
  [/\/codespaces/, 'github_codespace_manage']
];
export function curatedTool(op) {
  if (!op || !op.route) return null;
  return maps.find(([pattern])=>pattern.test(op.route))?.[1]??null;
}

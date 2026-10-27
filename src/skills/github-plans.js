// Plan templates for the GitHub skill family (catalog skill id 'github').
//
// Each plan is data plus a pure steps(context) builder: an ordered list of
// calls to this server's own guarded tools, so every step executed through
// github_skills_execute inherits that tool's own preview, confirmation,
// change log and undo handling. No GitHub request is built here.
//
// Tool names and argument shapes were verified against the live registry
// (src/tools/index.js) on 2026-10-27:
// - github_pr_get, github_pr_list_files and github_review_list_threads all
//   take { owner, repo, number } with repo and number required.
// - github_check_get_ci_state takes { owner, repo, pr } (or ref/base) with
//   only repo required, so the PR status plan passes the PR number directly
//   as `pr`; no head_sha lookup step is needed.
// - github_pr_create takes { owner, repo, head, title } plus optional
//   base, body and draft; repo, head and title are required.
// - github_issue_set_labels takes { owner, repo, number, mode, labels }
//   with all of repo, number, mode and labels required.
// - github_actions_list_runs takes { owner, repo } plus optional workflow,
//   branch, event, status and max; only repo is required.

const base = (context) => ({ owner: context.owner, repo: context.repo });

export const PLANS = Object.freeze([
  Object.freeze({
    id: 'pr_status',
    skillId: 'github',
    title: 'PR status',
    triggers: Object.freeze(['pr status', 'pull request status', 'review status', 'check this pr', 'pr checks', 'status of pr']),
    requiredContext: Object.freeze(['owner', 'repo', 'number']),
    optionalContext: Object.freeze([]),
    riskClass: 'read',
    steps: (context) => [
      { tool: 'github_pr_get', args: { ...base(context), number: context.number } },
      { tool: 'github_pr_list_files', args: { ...base(context), number: context.number } },
      { tool: 'github_review_list_threads', args: { ...base(context), number: context.number } },
      { tool: 'github_check_get_ci_state', args: { ...base(context), pr: context.number } }
    ]
  }),
  Object.freeze({
    id: 'pr_open',
    skillId: 'github',
    title: 'Open a pull request',
    triggers: Object.freeze(['open a pr', 'create a pull request', 'open pr', 'create pr', 'open a pull request']),
    requiredContext: Object.freeze(['owner', 'repo', 'head', 'title']),
    optionalContext: Object.freeze(['base', 'body', 'draft', 'labels']),
    riskClass: 'write',
    steps: (context) => {
      const steps = [{
        tool: 'github_pr_create',
        args: {
          ...base(context),
          head: context.head,
          title: context.title,
          ...(context.base ? { base: context.base } : {}),
          ...(typeof context.body === 'string' && context.body ? { body: context.body } : {}),
          ...(typeof context.draft === 'boolean' ? { draft: context.draft } : {})
        }
      }];
      // Labels are applied to the PR the create step just opened; its number
      // is resolved by the executor from step 0's result ({ $fromStep, field }).
      if (Array.isArray(context.labels) && context.labels.length) {
        steps.push({
          tool: 'github_issue_set_labels',
          args: {
            ...base(context),
            number: { $fromStep: 0, field: 'number' },
            mode: 'add',
            labels: [...context.labels]
          }
        });
      }
      return steps;
    }
  }),
  Object.freeze({
    id: 'ci_triage',
    skillId: 'github',
    title: 'CI triage',
    triggers: Object.freeze(['ci status', 'ci triage', 'failing checks', 'checks failing', 'ci failures']),
    requiredContext: Object.freeze(['owner', 'repo']),
    optionalContext: Object.freeze(['ref', 'branch']),
    riskClass: 'read',
    steps: (context) => [
      { tool: 'github_check_get_ci_state', args: { ...base(context), ...(context.ref ? { ref: context.ref } : {}) } },
      {
        tool: 'github_actions_list_runs',
        args: { ...base(context), status: 'failure', max: 20, ...(context.branch ? { branch: context.branch } : {}) }
      }
    ]
  })
]);

/**
 * Long-form plan text for the skill-text overlap check in
 * src/tools/skills-execute.js: one string per plan, its title plus a
 * one-sentence summary of what the plan does.
 */
export const PLAN_CORPUS = Object.freeze([
  'PR status: Read one pull request together with its changed files, its review threads and the CI state for its head, so the caller gets a single complete picture of where that pull request stands.',
  'Open a pull request: Create a pull request from the given head branch with the given title, applying any requested labels to the newly opened pull request through the guarded label tool.',
  'CI triage: Read the CI state for a repository or ref and list its recent failed workflow runs, so failing checks can be identified and investigated without changing anything.'
]);

# Owner guide — what you can ask for

Plain-English things to say to Claude once each part is built. Each line names the batch that delivers it; until then
it does not work yet. This file is updated as features ship. Anything that touches your real `main` branches, releases,
settings, access or spending always shows you a preview and waits for your OK.

| Say something like… | What happens | Batch |
|---|---|---|
| "Which GitHub accounts am I connected to?" | Your accounts, PREVIEW or PRODUCTION, what the server may do, how much GitHub rate budget is left, your spend limit | A/B |
| "What's the state of PR 42?" | CI at the latest commit (which checks are required), mergeable or not, reviews, open review threads, and the next step in one sentence | W |
| "Merge it when it's green." | Merges only if every required check passed on exactly the latest commit and no review thread is open; otherwise says what is missing | E/W |
| "Merge the stack." | Merges stacked PRs from the bottom up, waiting for fresh CI on each one after it is retargeted to `main` | W |
| "Why did CI fail?" | The failing job and step, the error lines, and whether `main` fails the same way — no giant log | G/W |
| "Answer and resolve the review comments." | Checks each fix on the latest commit, replies, resolves — one preview, one OK | E/W |
| "Cut a release." | Draft release with generated notes; publishes only after you say yes | G/W |
| "Clean up old branches." | Deletes only branches whose PR is merged or closed — never `main`, protected or project branches | W |
| "Set up a new repo for my project the standard way." | Private repo, `main` protected by a rule requiring `ci`, merge commits, secret scanning, labels — previewed first | W/P |
| "Is GitHub set up right for Appliance Desk?" | Every row of the Appliance Desk list: ok, fixed with your OK, or exactly what to click | P |
| "Set the STRIPE_KEY secret for this repo." | Gives you a link to type the value on your setup page — the value never goes through chat | G |
| "Give me a throwaway repo to test this workflow." / "Clean up that test run." | A scratch repository in your scratch organization, then removes exactly what the run created | V |
| "Send my app a test GitHub webhook." | Replays a real delivery into the app you are building, correctly signed | V |
| "Review my GitHub organization." | Members and two-factor, security features, apps and tokens, spending, anything needing attention | O |
| "Who has access to my repos?" | Members, outside collaborators, teams, deploy keys, apps and tokens; anything unusual flagged | O/W |
| "Add Sam to the organization." | Shows exactly what access Sam would get, asks you, sends the invitation | O |
| "How much am I spending on GitHub this month?" | Usage by product in dollars, budgets and how close each is | O |
| "Turn on two-factor for the org." / "Change my plan." | GitHub has no way to do these by API, so you get exact numbered steps, then it checks the result where it can | O |
| "Turn on production for Robinson-AI-Systems." | Two steps: Claude asks, then you re-enter your passphrase on the setup page | B |
| "What changed in GitHub through Claude this week?" | The change log | B |
| "Undo that." | Reverses the last change when it has a clean opposite; says plainly when it doesn't (for example a merge needs a revert PR) | X |
| "Make a 24-hour read-only pass for Codex." | A pass shown once on your setup page; the agent uses it through Robinson's Toolkit or the HTTPS API | R |
| Anything else on GitHub | The universal tools find the right GitHub operation and run it with the same safety | U |

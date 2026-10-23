# 2026-10-23 — Sign-in works end to end; offer the person's own account

Chris's real phone sign-in completed: GitHub recognized him silently, an account space was made, Claude collected the code, a token was issued and two assistant calls ran. His space holds `christcr2012` (personal) and `robinson-ai-scratch` (organization) together, so more than one account in one connection already works.

Change: if a person did not type account names and their OWN personal account does not have the App yet while some other account is connectable, they are sent once to GitHub's install page for it. After they come back we never loop: whatever is connectable is connected. People who type account names are never pushed to install a personal account. Nothing is offered when the App is already on their personal account.

Next: an "Add another account" path for later, and the optional move to a name the owner picks (App is now named Robinson GitHub MCP and installable by any account).

Update (replaces the earlier "send straight to install" rule): the connection is made FIRST. If the person's personal account, or an organization they administer, does not have the App yet (and they did not type account names), a short "You are connected" page lists what is connected and offers "Add <account>" buttons (each goes to GitHub's install page aimed at that account) and "Continue with what is connected". Cancelling GitHub's install page therefore never loses the connection. God mode's extra-keys page still follows. Organizations are found with GitHub's membership list, best effort (if it is unavailable only the personal account is offered).

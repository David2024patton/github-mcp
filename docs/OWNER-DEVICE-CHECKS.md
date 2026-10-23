# Owner device checks — separate from development

Owner request (Chris, 2026-10-22): checks that need a real phone, desktop app or other device of Chris's are tracked
**here**, apart from implementation. They are **never** a blocker for building, reviewing or merging code.

Rules for agents:
- Build and merge the engineering first. Do not hold a PR, a card or the next piece of work for a device check.
- A device check needs Chris (or his device). Do not ask him to do one during implementation. When code for a
  check is merged and deployed, add or update its row below, in plain English, once.
- Never mark a device check passed without real observations from that device. Merged code is not a passed check.
- Chris does these when convenient. Results go in `docs/developer-evidence.json` per the acceptance rules.

| Check | Needs | Status |
|---|---|---|
| PUB-4: private mobile and desktop connection — install on both, sign in, run `github_whoami` and a read | Chris's phone and desktop; PUB-4 code merged and deployed (see `docs/pr-cards/PUB-4.md` on its branch, PR #268) | Waiting for PUB-4 code to merge; not started |

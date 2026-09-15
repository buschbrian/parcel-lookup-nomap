# Office prompts — 2026-09-15

> **Status, 2026-09-15 afternoon: prompt 6 is done.** #30-#42 are all merged and
> this repository has no open PRs. The prompts below are kept as written, so the
> "#38 needs a commit first" and "until PR #39 merges" notes now read as history
> rather than instructions. What actually happened, and where this review's
> process advice was wrong, is recorded under "What actually happened" in the
> evidence file. Still to do: cut `release/<date>` (the version is untouched at
> `2026.08.13`), then promote.

Copy-paste prompts for work in this repository on 2026-09-15. Evidence:
`docs/reviews/2026-09-15-a-stack-merge-readiness.md` (PR #39, merged).

This repository is public. Nothing pasted into a session here is committed
unless it belongs in the code or its documentation.

## Context — paste first

```text
Context (2026-09-15): parcel-lookup-nomap is Millcreek's accessible, text-only property lookup, live at https://lookup.gis.millcreekut.gov. PRs #30–#36 (A1–A7) are one stacked chain that was reviewed as ready to merge in order; #37 is safe after them; #38 (vite) needs a commit first.

Run `git fetch`. Read AGENTS.md, RELEASE.md, and docs/reviews/2026-09-15-a-stack-merge-readiness.md (from origin/docs/2026-09-15-a-stack-review if PR #39 is not merged). Commit on local branches only; never push, merge, or delete remote branches — I merge. Browser tests run only through this repo's npm scripts with PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH pointed at the system Chrome; never download Playwright browsers. Summarize the review in 10 lines and wait.
```

## 6. Merge the A stack and prepare the release

```text
In parcel-lookup-nomap, follow docs/reviews/2026-09-15-a-stack-merge-readiness.md.

1. Confirm nothing moved since the review: head SHA and `gh pr checks` for #30–#36 (#36 head was 225df10). If any head changed or a check is red, stop and tell me.
2. I run the merges. Give me the commands one at a time, in order: `gh pr merge 30 --merge --delete-branch`, then 31, 32, 33, 34, 35, 36, then 37. After each, confirm the next PR retargeted to main and its checks are green before I run the next command.
3. With the stack on main: run `npm run check:deployment` with DEPLOY_URL set to the staging host named in docs/azure-hosting.md. Report the result.
4. Branch release/<CalVer YYYY.MM.DD for the day it will be published>: bump the version in package.json and CFG.release.version in index.html and business-licensing.html; set the other CFG.release dates per RELEASE.md; update section review dates only where a real re-check happened (zoning fields were re-checked 2026-09-10); add the changelog entry; fix the two stale "outFields=*" comments at .github/workflows/live-service-monitor.yml:73 and tests/service-contract.test.mjs:118. Run `npm test`. Commit; do not push.
5. Leave #38 (vite) for another day.
6. After I confirm the merges, list the wt-lookup-* worktrees with the exact `git worktree remove` commands for me to run.
```

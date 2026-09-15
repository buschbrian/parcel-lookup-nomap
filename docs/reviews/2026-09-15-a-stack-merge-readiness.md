# A-stack merge readiness — 2026-09-15

Read-only review of PRs #30–#36 (the A items from the 2026-09-10 planning-director
review, whose checklist lives in `millcreek-planning-map`'s `tasks/todo.md`) and
the two Dependabot PRs. Nothing was pushed, merged, or commented by the review.

## Verdict

**Ready to merge, in order, with no blockers.** #37 is safe afterwards. #38 needs
one commit first.

## Stack and order

One straight chain; each PR is based on the one before it:

`main` ← #30 A1 ← #31 A2 ← #32 A3 (+A8) ← #33 A4 ← #34 A7 ← #35 A6 ← #36 A5

- Merge order: **30, 31, 32, 33, 34, 35, 36**.
- A throwaway merge of all seven in that order had no conflicts, and its tree is
  identical to the #36 tip (`225df10`). #37 and #38 also apply cleanly on top.
- Use `gh pr merge <n> --merge --delete-branch`, not squash — squashing makes the
  later PRs show duplicate commits. GitHub retargets the next PR onto `main`
  when its base branch is deleted.
- Each merge to `main` deploys to **staging** only (`deploy-staging.yml`).
  Production changes only through `promote-production.yml`.

## Per PR

| PR | Item | Verdict | Notes |
|---|---|---|---|
| #30 | A1 POST past the URL limit | Ready | Both pages; geometry never rounded; timeout, retry and error handling identical for GET and POST |
| #31 | A2 explicit `outFields` | Ready | Every attribute read on the page (FEMA and parcel-record fields included) is in the new field lists; the live contract check confirms the fields exist |
| #32 | A3 + A8 zoning coverage | Ready | Never reports "none" from a failed, truncated, or unreadable response. Low, non-blocking edge: inconsistent object ids from the service could still yield "No" for City Center Overlay |
| #33 | A4 zoning row names | Ready | New code-section links pass the existing http(s) link check |
| #34 | A7 zoning first | Ready | With no Zoning card, Property record still renders first |
| #35 | A6 deep links | Ready | `?parcel=` validated before use; `?address=` length-capped; only the parcel id is written to the URL, and the referrer policy keeps it on this origin. `millcreek-planning-map` reads `lon`, `lat`, `scale` |
| #36 | A5 owner and review date | Ready | Dates formatted without the visitor's clock; the 90-day warning never fails the run |
| #37 | @playwright/test 1.63.0 | Safe after the stack | CI green; stack touches no package files. Not run locally (would install Playwright) |
| #38 | vite 8.3.0 | **Needs a commit** | Fails "the release toolchain is pinned consistently". Compare built output before and after, then change `tests/unit.test.mjs:467` from `"8.2.2"` to `"8.3.0"` on the PR |

CI: `deterministic-tests` passes on #30–#37 and fails on #38. No PR is a draft;
none has a review or an unresolved thread. The only comment on #30–#36 is the
posted outside review of the whole stack (round one: five fixes, all made;
round two: approved).

## Verification on the merged stack

Local Node v26.8.1 (pinned is 22.15.0); system Chrome.

| Check | Result |
|---|---|
| `npm test` | unit 100/100, Python 4/4, build ok, browser 129 passed |
| `npm run check:services` | all 57 live service contracts hold; review date 33 days old |
| typecheck | no script in this repository |
| `npm run check:deployment` | exit 1 **expected**: compared against live production, which does not have this code. Published paths 24/24 and security headers passed. Rerun with `DEPLOY_URL` set to staging after merging |

## Open after merging

Not blocking the merge; needed before promoting to production.

- [ ] Release PR per `RELEASE.md`: version is still `2026.08.13` in
  `package.json` and both pages; bump all three, add the changelog entry.
- [ ] Section review dates still read 9 August 2026, although zoning fields were
  re-checked 10 September.
- [ ] `npm run check:deployment` against staging.
- [ ] Outside-review follow-up: a paging test for a truncated first page followed
  by a final page.
- [ ] Outside-review follow-up: two comments still say `outFields=*` —
  `.github/workflows/live-service-monitor.yml:73` and
  `tests/service-contract.test.mjs:118`.
- [ ] #38 before/after build comparison, then the pin update.
- [ ] A9 "Development activity at this property" has no PR; it follows C0–C5 in
  `millcreek-minutes-pipeline`.
- [ ] Remove the `wt-lookup-*` worktrees once the stack is merged.

# Releasing the Millcreek property lookup

This is a public municipal service. A release is not a deploy — it is a decision, made by a named
person, on evidence that is kept. This file is the convention for making that decision and for
recording it. It exists because production readiness Task 9 asked for one; the checklist it produces
is what Task 12 rehearses.

## Version

**CalVer, `YYYY.MM.DD`, zero-padded**, matching the date the release is published. This project is a
municipal service with no API and no dependants: nobody needs to reason about compatibility from the
number, and everybody needs to know how old what they are reading is. A resident who copies their
results gets the version in the pasted text, and staff answering the phone need to know whether that
paste is from this month or from last spring.

The version appears in **three** places and they must agree:

| Where | Why it exists |
|:--|:--|
| `package.json` `version` | the repository's own record |
| `index.html` `CFG.release.version` | shown on the page, and in copied results |
| `business-licensing.html` `CFG.release.version` | the same, on the licensing screen |

A unit test fails if they disagree. They did disagree — `2026.8.13` against `2026.08.13` — for
long enough that both were quoted in different documents, which is exactly the confusion the padding
rule and the test now prevent.

`CFG.release` carries two further dates, and they are not the version:

- **`publishedOn`** — when this release went live.
- **`dataReviewedOn`** — when a person last checked the GIS layers behind it. This one ages on its
  own. A release published today against layers reviewed in April is a stale-data release, and the
  page says so to every resident who reads it.

## Tags

Tag the released commit `v<version>`, e.g. `v2026.08.26`, annotated, with the release record in the
tag message. A second release on the same date takes a `-2` suffix: `v2026.08.26-2`.

The tag is the artifact identity. Everything in the release record refers to it, and a rollback
target is named as a tag rather than "the previous deploy", which stops meaning anything the moment
a second deploy happens.

## Changelog

Dated files at the repository root: `CHANGES-YYYY-MM-DD.md`. The existing ones set the standard, and
it is a high one — they record what was found, not only what was changed, including the defects the
work exposed in itself. **Keep writing them that way.** A changelog that lists only successes is how
a project forgets that its deployment gate never gated anything for two months.

## Release record

Retained per release. The plan's Release Evidence list is the source of this template; keep them in
step if either changes.

```markdown
# Release v2026.08.26

## Artifact
- Commit: <sha>            Tag: v2026.08.26
- Node/npm: <from .nvmrc and engines>     Lockfile: <sha256 of package-lock.json>
- Built artifact: sha256 of dist/index.html and dist/business-licensing.html

## Automated gates
- Deterministic CI: <run URL>, green
- Clean install: npm ci, npm audit --audit-level=high
- Suite: <n> unit, <n> Python, <n> browser/axe
- Deploy preview: <url>
  - check:deployment: all gates, tolerated transformations listed
  - test:production: both flows, peak concurrency, timings, zero errors/violations
- check:services: <n>/<n>, report attached

## Data
- dataReviewedOn: <date>, reviewed by <name>
- Any layer whose source owner or review date changed since the last release

## Human gates
- Keyboard and NVDA walkthrough: <name>, <date>, findings and resolution
- Counsel: disclaimer wording confirmed <date>, or unchanged since <release>
- Privacy and records determinations: <name>, <date>

## Decision
- Approver: <name, role>          Decision: GO / NO-GO
- Promoted at: <timestamp>        Observed for: <window>
- Rollback target: <tag>          Rollback owner: <name>
- Open findings accepted into production, and why:
```

## Repository controls

Branch protection is GitHub state, not a file, so it is written down here — otherwise nobody can
tell whether it was ever applied, or notice when it is turned off. Applied to `main` on
26 August 2026:

| Setting | Value | Why |
|:--|:--|:--|
| Require a pull request | yes | nothing reaches production without a reviewable diff |
| Required approvals | **0** | see below |
| Dismiss stale reviews | yes | an approval describes a diff, not a branch |
| Required status check | `deterministic-tests` | the whole suite, on Linux, before merge |
| Strict (branch up to date) | no | avoids a rebuild on every merge; the check still runs per PR |
| Include administrators | **yes** | see below |
| Force pushes | blocked | published history stays published |
| Branch deletion | blocked | |
| Conversation resolution | required | a review comment cannot be merged past in silence |

**Required approvals is 0, and that is deliberate.** There is one code owner and he is also the only
author; GitHub does not let an author approve their own pull request. A requirement that cannot be
satisfied is not a control — it is a bypass everyone learns to perform. Raise it to 1 the same day a
second reviewer is added to CODEOWNERS, and not before.

**Include administrators took two attempts, and the first was wrong.** It was set to *no* first, on
the reasoning that an admin escape hatch avoids lockout. A direct push to `main` was then attempted
as a test and **succeeded**, with GitHub reporting `Bypassed rule violations`. Every setting in the
table was already in place; the branch simply was not protected against the one person most likely
to push to it. With approvals at 0 there was never a lockout to avoid. It is now *yes*, and a second
push attempt was rejected with `GH006: Protected branch update failed`.

Two things follow from that. **Verify a control by trying to violate it** — the configuration read
back correctly both times, and only the push attempt told the truth. And the first probe's empty
commit is still on `main`: force-pushing it away was declined as too blunt an instrument for public
history, which is the right answer.

**If a merge is ever blocked by a check that never started,** the required run has not fired —
automatic `pull_request` runs were intermittent on this repository through August 2026. Push an
empty commit to the branch to re-trigger it, or temporarily uncheck *Include administrators* in
Settings > Branches, merge, and turn it back on. Prefer the first.

## Sequence

1. Confirm `dataReviewedOn` is current, or review the layers and update it.
2. Bump the version in all three places; add or extend the dated changelog.
3. Open a pull request. Deterministic CI must be green. Required approvals is **0** today — there is
   one code owner and he is also the only author, so GitHub cannot route an approving review; see
   Repository controls. When a second reviewer exists, they approve here.
4. Verify the deploy preview: `npm run build && npm run check:deployment`, then `test:production`,
   against its URL. The check refuses to run without `dist/`.
5. Complete the human gates. None of them is a formality, and none is skippable because the code did
   not change — counsel wording and accessibility apply to what is served, not to the diff.
6. Merge, tag, and watch the production deploy. Re-run both checks against production.
7. Fill in the release record and retain it with the evidence.
8. If anything is wrong, roll back to the previous tag first and diagnose afterwards.

## What must never be true of a release

- That it was promoted by automation rather than by a named person.
- That a gate was skipped because it was inconvenient, rather than failed and accepted deliberately
  with the reason written down.
- That an assertion was weakened to get a green run. If a check is wrong, fix the check and say so
  in the changelog; a test edited to pass is a test that has stopped being evidence.
- That the artifact in production was built from anything other than the tagged commit.

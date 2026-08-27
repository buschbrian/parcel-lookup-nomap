# Implementation Plan: Production Readiness

## Overview

Move the Millcreek property lookups from a publicly reachable preview to a controlled,
reproducible municipal production service. The work is intentionally split into small gates:
first restore trustworthy engineering feedback, then prove the deployed artifact and live user
flows, then harden runtime reliability, and finally complete the institutional and human approvals
that code cannot supply.

The existing Netlify deployment remains a **pre-production reference** until the release rehearsal
in Phase 4 passes. Early phases do not authorize a production promotion, repository transfer,
branch-protection change, counsel-record deletion, DNS change, or other external administrative
mutation.

## Current Baseline

Audit date: 24 August 2026.

- `main` and `origin/main` both point to `6a7d8411530010aa559d2627374d9edf275f3822`.
- A clean locked install passes 23 Node tests, 4 Python tests, and 62 Chromium/axe tests on Windows.
- `npm audit` reports zero known vulnerabilities in the locked dependency graph.
- Both deployed lookup flows currently succeed, but one general lookup peaks at 36 concurrent
  requests to ArcGIS/FEMA.
- GitHub Actions has 16 consecutive failures beginning with `16a795d`; private step logs are not
  available until GitHub CLI authentication is restored.
- `scripts/check-deployment.mjs` cannot currently pass because Netlify Pretty URLs performs two
  known HTML rewrites before the exact-content assertion.
- `main` is unprotected and Netlify auto-deploys it.
- Manual screen-reader, counsel, privacy/records, institutional ownership, support, and production
  approval gates remain open.

## Architecture Decisions

1. **Separate deterministic quality from external availability.** Pull requests and `main` must be
   gated only by reproducible checks of this repository. ArcGIS/FEMA checks run in a separate
   scheduled monitor with distinct alert semantics.
2. **Pin the build inputs.** The repository declares its Node/npm versions, uses the lockfile with
   `npm ci`, pins Vite exactly, and pins GitHub Actions to reviewed commit SHAs.
3. **Build once and verify the promoted artifact.** Staging and production must be derived from one
   tagged commit and one immutable build, not independent untracked rebuilds.
4. **Treat production verification as a user-flow contract.** Byte/content integrity, security
   headers, publish allowlist, and both live lookup paths must pass against the candidate URL.
5. **Keep monitoring privacy-preserving.** Synthetic checks use a published test address, never emit
   returned owner data, and do not add resident search telemetry.
6. **Make releases human-approved and reversible.** A designated municipal approver promotes the
   release only after staging evidence exists, with a previously verified artifact ready to restore.
7. **Do not infer institutional decisions.** Repository ownership, hosting, DNS, legal language,
   records retention, accessibility sign-off, and named approvers require explicit municipal input.

## Verified Pipeline Inputs

The current official GitHub Action releases were checked on 24 August 2026. Implementation should
pin these reviewed commits and retain the release tags in comments:

| Action | Release | Immutable commit |
|:--|:--|:--|
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/setup-python` | `v7.0.0` | `5fda3b95a4ea91299a34e894583c3862153e4b97` |
| `actions/upload-artifact` | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

Re-resolve and review these SHAs if implementation starts after a material delay.

## Dependency Graph

```text
Task 1: reproducible toolchain
  -> Task 2: diagnostic deterministic CI
     -> Task 3: separate live-service monitor
        -> Checkpoint A: first observable Linux run

Task 1
  -> Task 4: exact deployment matcher
     -> Task 5: live browser smoke
        -> Task 6: candidate verification workflow
           -> Checkpoint B: deploy-preview evidence

Task 5
  -> Task 7: bounded lookup concurrency
Task 3
  -> Task 8: resilient service monitoring
     -> Checkpoint C: runtime reliability evidence

Checkpoints A-C
  -> Task 9: repository and release governance
  -> Task 10: human accessibility/legal/privacy/records gates
  -> Task 11: institutional staging and production configuration
     -> Task 12: release rehearsal and production go/no-go
```

## Task List

The executable checklist and per-task acceptance criteria live in [`tasks/todo.md`](todo.md).

### Phase 1: Restore trustworthy feedback

- [x] Task 1: Pin the Node/npm/Vite toolchain.
- [x] Task 2: Make deterministic CI step-specific and diagnostic.
- [x] Task 3: Separate the live-service monitor from merge quality.
- [x] Checkpoint A: Closed. The first diagnostic Linux run named the failing step, and the failure was
      real — `.nav a` is shrink-to-fit and overflowed a 320 px container at 400% under the Linux
      default sans while Windows' Segoe UI happened to fit. Fixed in `757d483` with a reproduction
      test; no assertion was weakened. Deterministic CI is green (PR #3).

### Phase 2: Prove a release candidate

- [x] Task 4: Repair exact deployment-content verification.
- [x] Task 5: Add a privacy-preserving live browser smoke test.
- [x] Task 6: Add candidate deployment verification with retained evidence.
- [x] Checkpoint B: Closed 26 August 2026. Deterministic CI green on Linux, and every deployment gate
      plus both live flows verified against `deploy-preview-3`, whose artifact is byte-identical to
      this branch's. Verifying a real preview exposed two defects in the new check — the injected
      preview drawer and an allowlist cascade — both fixed and covered. No promotion occurred.

      One item remains external: the **Verify deployment candidate** workflow cannot be dispatched
      until it exists on the default branch, which is a GitHub constraint on `workflow_dispatch`, not
      a defect. Its contract is unit-tested and both commands it runs were executed by hand against
      the same preview.

### Phase 3: Harden runtime dependencies

- [x] Task 7: Bound concurrency in the general lookup. 36 -> 12, chosen by measurement.
- [x] Task 8: Add transient retry and machine-readable evidence to live-service monitoring.
- [x] Checkpoint C: Closed 26 August 2026 apart from its human gate — the GIS/data owner still has to
      accept the monitoring cadence and alert recipient, and may want `maxConcurrent` lower than 12.

### Phase 4: Establish accountable production delivery

- [x] Task 9: Establish repository and release governance. Branch protection active on `main`,
      administrators included; conventions and controls recorded in `RELEASE.md`.
- [ ] Task 10: Complete accessibility, counsel, privacy, and records gates.
- [ ] Task 11: Configure institutionally owned staging and production.
- [ ] Task 12: Rehearse release and rollback, then hold the production go/no-go review.
- [ ] Checkpoint D: A designated municipal approver signs the release record after every automated
      and human gate is green.

## Verification Strategy

Each implementation slice follows RED -> GREEN -> REFACTOR where behavior changes:

1. Add or update a focused test that demonstrates the missing gate or defect.
2. Run it and confirm the expected failure.
3. Make the smallest implementation change.
4. Run the focused test, then the repository's affected suite.
5. At each checkpoint, reproduce a clean install with `npm ci`, run the full suite, build, dependency
   audit, live-service monitor, and candidate deployment verification as applicable.
6. Commit each verified slice separately on a short-lived `codex/production-readiness` branch.

Configuration-only changes that cannot have a meaningful RED test must be validated by a repository
test that inspects the resulting contract and by the first real GitHub Actions run.

## Release Evidence

Every release candidate should retain:

- commit SHA, tag, Node/npm versions, and lockfile hash;
- deterministic CI results and Playwright report/trace on failure;
- built artifact hash and deploy-preview URL;
- deployed-content, header, allowlist, and live-flow verification output;
- GIS service-contract output and data-review date;
- manual keyboard/screen-reader result and named accessibility sign-off;
- counsel wording confirmation plus privacy and records determinations;
- production approver, promotion time, monitoring observation, and rollback target.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|:--|:--|:--|
| Linux-only browser failure remains hidden | High | Name every CI step and retain Playwright report/trace before changing assertions |
| External outage blocks a code release | High | Keep live-service monitoring separate from deterministic required checks |
| Host HTML processing hides real deployment drift | High | Accept only exact bytes or the two explicitly tested legacy rewrites; report first difference |
| Auto-deploy publishes a red commit | High | Protect `main`, require checks/review, and move production behind an environment approval |
| ArcGIS rate limiting or partial outage | High | Cap client concurrency, preserve graceful degradation, and monitor synthetic flows |
| Monitoring collects resident searches | High | Use one published synthetic fixture and sanitize all artifacts/logs |
| Personal accounts become recovery bottlenecks | High | Transfer repository, hosting, DNS, credentials, and recovery access to municipal control |
| Counsel or records artifact is mishandled | High | Get counsel/records direction before deletion or history rewriting |
| Accessibility automation creates false confidence | High | Require signed NVDA/keyboard evidence for the production candidate |
| Dated GIS layers remain technically available but stale | Medium | Assign source owners, review cadence, freshness thresholds, and visible release metadata |

## Open Questions Requiring Human Decisions

1. Which municipal organization will own the repository, hosting site, custom domain, deployment
   credentials, billing, and recovery access? **Still open.** Everything currently sits under one
   individual's personal accounts; the request to correct that is drafted and unsent.
2. Who fills the code reviewer, GIS/data owner, accessibility reviewer, privacy reviewer, records
   officer, incident owner, and production approver roles? **Answered 26 August 2026, and the answer
   is a finding in itself — see "Role assignments" below.**
3. Should the existing Netlify site remain the staging environment, and which approved platform/site
   becomes production? **Decided 26 August 2026: yes.** Netlify becomes staging once the IT
   provider's CDN is confirmed able to meet the hosting requirements; the CDN becomes production.
   Until then Netlify remains the only environment, and the pre-production caveat above still holds. **Update, 26 August 2026: the municipality's IT provider is supplying a CDN,
   which is the likely production host.** That makes the current Netlify site a strong candidate for
   staging rather than production, and it sets a date for removing the hosting-injection allowance in
   `scripts/deployment-content.mjs`. Task 11 should not be started until the CDN's owner, deploy
   mechanism and header support are known — `public/_headers` is Netlify-specific, and every security
   header the deployment gate asserts depends on the new host honouring an equivalent.
4. Is the attorney-returned disclaimer approved for release, and how should the review document be
   retained or removed from the public repository? **Half answered.** The wording is approved and is
   implemented verbatim — all seven passages, on the correct pages, in the placement the attorney
   specified, verified word-for-word on 26 August 2026. What remains is not a wording question: the
   attorney asked whether his text may sit inside an **expandable footer** that a resident must click
   to open. That is the only open item, and it is his to answer. The review document itself was
   purged from the repository on 26 August.
5. What privacy notice and records schedule apply to public owner display, ArcGIS query URLs,
   pipeline evidence, and operational monitoring?
6. What custom domain, support hours, outage communication path, and recovery-time objective apply?
   **Domain decided 26 August 2026: `propertylookup.millcreekut.gov`**, to be created by whoever
   administers Millcreek DNS. Support hours, outage communication and recovery-time objective remain
   open and belong with Task 11.
7. Should the current date-based application version become a tagged release version, and who owns
   the changelog and release record?

## Role assignments

Answered by the repository owner, 26 August 2026.

| Role | Holder |
|:--|:--|
| Code reviewer | Brian Busch |
| GIS / data owner | Brian Busch |
| Accessibility reviewer | Brian Busch |
| Privacy reviewer | **Open** |
| Records officer | The City Recorder, or the custodian of Planning records |
| Incident owner | Brian Busch |
| Production approver | Brian Busch |

**Six of the seven roles are one person, and that person is also the only author.** This is the real
answer for a municipality of this size and it should be recorded as such rather than dressed up. What
it means concretely is that **separation of duties does not exist**: the person who writes a change
reviews it, approves its release, and signs its accessibility test. The plan asks for an approver who
is not the author (architecture decision 6, Task 9, Task 12) and that control cannot be satisfied
today.

What stands in for it, and why this is still materially better than where the project started:

- **Every change passes a gate the author cannot bypass.** `main` requires a pull request and a green
  deterministic CI run, with administrators included, so the sole maintainer is subject to the same
  rule as anyone else. This is the one genuine control, and it is why `enforce_admins` matters more
  here than it would in a team.
- **The evidence is written down, so review can happen after the fact.** A release record naming the
  artifact, the gates, the timings and the decision lets an auditor, a successor, or the City Attorney
  reconstruct what was released and on what basis, without the reviewer having been present.
- **The automated suite is the second opinion.** 124 tests, deployment verification against the
  served bytes, and a weekly service-contract monitor catch the classes of mistake a self-review
  reliably misses.

**Where self-review is weakest, and should not be papered over:**

- **Accessibility.** The author testing their own work is the least reliable configuration, because
  the tester already knows the intended path through the page. Automated axe coverage runs on every
  change and catches roughly a third of real problems. **Recommendation: treat the signed manual test
  as provisional, and obtain one independent walkthrough** — a colleague, another municipality's
  accessibility staff, or a paid audit — before Millcreek asserts WCAG 2.1 AA conformance anywhere
  other than as a good-faith effort. The current page wording ("working to conform") is already
  careful about this and should not be strengthened until an independent check exists.
- **Release approval.** A self-approved release is a record of a decision, not a check on it. The
  honest mitigation is the written record plus a rehearsed rollback, and adding a second approver
  should stay on the list as the first thing to fix when any second person becomes available.

**Privacy reviewer is open.** Two of the three privacy questions — public display of owner names, and
what monitoring evidence is retained — are records questions as much as privacy ones, so they may be
answerable by the same person who takes the records officer role. Folding them into that request is
likely faster than finding a separate privacy owner.

## First Approved Implementation Slice

After plan approval, execute Tasks 1-3 only. Stop at Checkpoint A, push the short-lived branch, and
inspect the newly diagnostic Linux run before attempting to fix the suspected 400% reflow failure.
This keeps the first change reviewable and prevents a speculative CI fix.

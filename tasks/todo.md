# Production Readiness Task List

This checklist implements [`tasks/plan.md`](plan.md). A task is complete only when all acceptance
criteria and verification items are checked. Tasks that require external account changes or human
approval must not be marked complete from repository evidence alone.

## Task 1: Pin the build toolchain

**Description:** Declare one reproducible Node/npm/Vite contract for developer machines, GitHub
Actions, and Netlify without changing application behavior.

**Acceptance criteria:**

- [x] Add a checked-in Node version file and matching `engines`/`packageManager` declarations.
- [x] Pin Vite to the already locked `7.3.6` release and keep `package-lock.json` consistent.
- [x] Add a unit assertion that fails if these release-critical pins drift independently.

**Verification:**

- [x] RED: focused unit assertion fails before the declarations are added.
- [x] GREEN: `npm run test:unit` passes.
- [x] Clean-room `npm ci`, `npm audit --audit-level=high`, and `npm run build` pass.

**Dependencies:** None.

**Files likely touched:** `.nvmrc`, `package.json`, `package-lock.json`, `tests/unit.test.mjs`.

**Estimated scope:** Medium (4 files).

## Task 2: Make deterministic CI diagnostic

**Description:** Turn the merge-quality workflow into an observable, reproducible sequence so the
first failing gate and its artifacts are available without reading one monolithic `npm test` step.

**Acceptance criteria:**

- [ ] Run on pull requests, pushes to `main`, and manual dispatch with concurrency cancellation.
- [ ] Use a fixed Ubuntu image, the repository Node contract, and reviewed action commit SHAs.
- [ ] Name install, audit, unit, Python, build, browser-install, and Playwright steps separately; upload
      Playwright report and test-results artifacts on failure.

**Verification:**

- [ ] RED: workflow contract assertions fail against the current monolithic workflow.
- [ ] GREEN: `npm run test:unit` validates triggers, pins, named steps, and artifacts.
- [ ] The first pushed run identifies one exact failing step and preserves its browser evidence.

**Dependencies:** Task 1.

**Files likely touched:** `.github/workflows/quality.yml`, `tests/unit.test.mjs`,
`playwright.config.mjs` if report retention needs adjustment.

**Estimated scope:** Medium (2-3 files).

## Task 3: Separate the live-service monitor

**Description:** Move ArcGIS/FEMA availability and schema checks out of merge-quality CI so external
availability produces a clear operational alert without obscuring repository correctness.

**Acceptance criteria:**

- [ ] A dedicated workflow runs on schedule and manual dispatch only.
- [ ] The deterministic workflow contains no scheduled external-service job.
- [ ] The monitor records a concise step summary and fails visibly when its contract fails.

**Verification:**

- [ ] RED: workflow contract assertion detects the current mixed workflow.
- [ ] GREEN: `npm run test:unit` validates trigger and job separation.
- [ ] Manual monitor run succeeds or reports the exact failed service check.

**Dependencies:** Task 2.

**Files likely touched:** `.github/workflows/quality.yml`,
`.github/workflows/live-service-monitor.yml`, `tests/unit.test.mjs`.

**Estimated scope:** Medium (3 files).

## Checkpoint A: Restore Linux feedback

- [ ] Tasks 1-3 pass locally from a clean install.
- [ ] Changes are reviewed as separate, atomic commits on `codex/production-readiness`.
- [ ] The branch is pushed and the first diagnostic Linux workflow completes.
- [ ] The exact failing assertion is fixed with a reproduction test; no assertion is weakened,
      skipped, or made platform-conditional merely to obtain green CI.
- [ ] Deterministic CI is green before Phase 2 begins.

## Task 4: Repair deployed-content verification

**Description:** Compare the deployed pages with the built artifact while permitting only the two
documented legacy Pretty URLs transformations and continuing through all header and allowlist gates.

**Acceptance criteria:**

- [ ] Pure comparison logic accepts exact bytes and each precisely documented rewrite form.
- [ ] Any other byte change fails with the page name and useful first-difference context.
- [ ] `check:deployment` reaches and enforces repository-path and security-header assertions.

**Verification:**

- [ ] RED: focused tests reproduce the current Pretty URLs failure and an unexpected-drift case.
- [ ] GREEN: comparison unit tests and `npm run test:unit` pass.
- [ ] `npm run build && npm run check:deployment` passes against the current deployment.

**Dependencies:** Task 1.

**Files likely touched:** `scripts/deployment-content.mjs`, `scripts/check-deployment.mjs`,
`tests/unit.test.mjs`, `README.md`.

**Estimated scope:** Medium (4 files).

## Task 5: Add a live browser smoke test

**Description:** Verify both built/deployed pages through a real browser and live services using the
published synthetic address, without logging returned owner or property details.

**Acceptance criteria:**

- [ ] General and licensing lookups reach “Results ready” against a configurable `DEPLOY_URL`.
- [ ] The check fails on page errors, failed critical requests, HTTP errors, or axe violations.
- [ ] Output contains timings, request counts, and pass/fail state but no returned resident data.

**Verification:**

- [ ] RED: the smoke test fails against an intentionally invalid local URL or controlled failed route.
- [ ] GREEN: it passes against a locally served `dist/` using test-controlled services where needed.
- [ ] A large/manual run passes against the deploy-preview URL and the current live services.

**Dependencies:** Task 4.

**Files likely touched:** `tests/production.spec.mjs`, `package.json`, `playwright.production.config.mjs`,
`README.md`.

**Estimated scope:** Medium (4 files).

## Task 6: Add candidate deployment verification

**Description:** Provide a manual/reusable GitHub workflow that verifies a staging or production
candidate URL and retains the resulting release evidence.

**Acceptance criteria:**

- [ ] Workflow requires a candidate URL and runs deployment integrity plus live browser smoke.
- [ ] It uses pinned actions, least privileges, bounded timeouts, and uploads sanitized evidence.
- [ ] The workflow is not an automatic production promotion and has no production credentials.

**Verification:**

- [ ] `npm run test:unit` validates workflow permissions, inputs, pins, and commands.
- [ ] A manual run passes against a Netlify deploy preview.
- [ ] An intentionally wrong candidate URL produces a clear failed gate.

**Dependencies:** Tasks 4 and 5.

**Files likely touched:** `.github/workflows/verify-deployment.yml`, `tests/unit.test.mjs`, `README.md`.

**Estimated scope:** Medium (3 files).

## Checkpoint B: Prove a release candidate

- [ ] Clean `npm ci`, audit, full tests, and build pass.
- [ ] Deterministic GitHub CI is green.
- [ ] One deploy preview is verified for exact content, headers, publish allowlist, and both live flows.
- [ ] Artifact hashes, workflow URL, and sanitized browser evidence are retained.
- [ ] No production promotion occurs at this checkpoint.

## Task 7: Bound general-lookup concurrency

**Description:** Limit simultaneous ArcGIS/FEMA requests while preserving partial-result behavior,
abort semantics, result ordering, and current accessibility behavior.

**Acceptance criteria:**

- [ ] A configurable conservative limit replaces the current all-layer burst.
- [ ] Cancellation stops queued work and stale searches cannot update the page.
- [ ] Complete and degraded results remain in configured layer order.

**Verification:**

- [ ] RED: a browser test demonstrates current peak concurrency exceeds the intended limit.
- [ ] GREEN: focused browser tests prove the limit, ordering, cancellation, and degraded results.
- [ ] Full 89-test baseline (plus new tests), build, axe, and live smoke pass.

**Dependencies:** Task 5.

**Files likely touched:** `index.html`, `tests/app.spec.mjs`, `tests/unit.test.mjs` if a pure helper is
introduced, and one shared source file only if extraction is clearly simpler.

**Estimated scope:** Medium (2-4 files).

## Task 8: Make service monitoring resilient and evidentiary

**Description:** Distinguish transient transport failure from real schema/data-contract drift and
retain a machine-readable, privacy-safe report.

**Acceptance criteria:**

- [ ] Retry only network, timeout, 429, and 5xx failures with bounded backoff.
- [ ] Do not retry or soften schema, field, parity, or known-result mismatches.
- [ ] Emit a sanitized JSON summary and GitHub step summary identifying every failed contract.

**Verification:**

- [ ] RED: focused tests reproduce transient and permanent service failures.
- [ ] GREEN: retry classification and report tests pass deterministically without live network access.
- [ ] Manual live monitor passes and uploads its sanitized report.

**Dependencies:** Task 3.

**Files likely touched:** `scripts/check-services.mjs`, `scripts/service-contract-core.mjs`,
`tests/service-contract.test.mjs`, `.github/workflows/live-service-monitor.yml`.

**Estimated scope:** Medium (4 files).

## Checkpoint C: Runtime reliability

- [ ] The production smoke fixture completes with bounded concurrency and unchanged results.
- [ ] No HTTP, console, page, or axe failures occur.
- [ ] The live-service monitor demonstrates useful output for both a controlled transient failure and
      a controlled contract failure.
- [ ] GIS/data owner accepts the monitoring cadence and alert recipient.

## Task 9: Establish repository and release governance

**Description:** Put review ownership, dependency maintenance, security reporting, protected-branch
rules, and release records under accountable institutional control.

**Acceptance criteria:**

- [ ] Named municipal owners approve CODEOWNERS, security contact, dependency update cadence, and
      incident/build-cop responsibility.
- [ ] `main` requires review and the deterministic CI check; force pushes and direct production
      deployment from unreviewed commits are blocked.
- [ ] The project has an approved version/tag/changelog convention and retained release template.

**Verification:**

- [ ] Repository files pass local tests and contain real approved owners, not placeholders.
- [ ] GitHub branch metadata proves protection and required checks are active.
- [ ] A test pull request cannot merge while CI is red or review is absent.

**Dependencies:** Checkpoints A and B.

**Files likely touched:** `.github/CODEOWNERS`, `.github/dependabot.yml`, `SECURITY.md`,
`.github/PULL_REQUEST_TEMPLATE.md`, release documentation.

**Estimated scope:** Split into multiple small repository and external-configuration increments.

## Task 10: Complete human accessibility, legal, privacy, and records gates

**Description:** Obtain and retain the human approvals the automated suite cannot supply.

**Acceptance criteria:**

- [ ] Parts A-D of the manual keyboard/NVDA script are signed against the exact candidate.
- [ ] Counsel confirms public disclaimer wording and placement.
- [ ] Privacy and records owners document owner-display, third-party query, monitoring, release-record,
      and counsel-document decisions.

**Verification:**

- [ ] Signed evidence identifies candidate commit/tag, tester/approver, date, findings, and resolution.
- [ ] Accessibility blockers are fixed and regression-tested before sign-off.
- [ ] Counsel/records direction is followed before removing or rewriting any public Git history.

**Dependencies:** Checkpoint B.

**Files likely touched:** `docs/manual-screen-reader-test.md`, accessibility statement or municipal
record link, counsel/records-approved repository changes only.

**Estimated scope:** Human gate; implementation depends on findings.

## Task 11: Configure institutionally owned staging and production

**Description:** Establish municipal ownership, custom domain, credentials/recovery access, staging,
manual production approval, monitoring destination, and rollback permissions.

**Acceptance criteria:**

- [ ] Repository, host, DNS/domain, billing, credentials, and recovery access have at least two
      institutionally controlled administrators.
- [ ] Staging deploys automatically from reviewed candidates; production requires the designated
      environment approver and promotes the same immutable artifact.
- [ ] DNS/SSL, support ownership, incident communication, monitoring, and rollback access are tested.

**Verification:**

- [ ] Access/recovery exercise succeeds without an individual employee account.
- [ ] Staging and production artifact hashes match the approved candidate.
- [ ] Production cannot be promoted without the configured approver.

**Dependencies:** Tasks 9 and 10; Checkpoint C.

**Files likely touched:** Hosting/repository environment configuration plus approved deployment and
operations documentation.

**Estimated scope:** External institutional project; split by platform after ownership is chosen.

## Task 12: Rehearse release and rollback

**Description:** Run the complete launch sequence with a release candidate before authorizing the
first production release.

**Acceptance criteria:**

- [ ] Tag/build candidate, deploy staging, retain every automated and human gate, and obtain approval.
- [ ] Promote the same artifact, observe the defined window, and verify both critical flows.
- [ ] Restore the previous artifact in a timed rehearsal and prove post-rollback checks pass.

**Verification:**

- [ ] Release record includes tag/SHA, artifact hash, approvals, evidence links, timestamps, metrics,
      rollback target, and go/no-go decision.
- [ ] Rollback completes inside the approved recovery objective.
- [ ] Designated municipal approver—not automation—records production approval.

**Dependencies:** Tasks 9-11 and Checkpoints A-C.

**Files likely touched:** Release record/changelog and external deployment records.

**Estimated scope:** Coordinated release exercise.

## Checkpoint D: Production go/no-go

- [ ] All prior tasks and checkpoints are green with retained evidence.
- [ ] No unresolved high-severity security, accessibility, privacy, legal, data, or operational finding
      remains.
- [ ] Monitoring recipient and first-hour observer are present.
- [ ] Rollback artifact and operator are ready.
- [ ] The designated municipal approver records **GO**; otherwise the release remains **NO-GO**.

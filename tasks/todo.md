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

- [x] Run on pull requests, pushes to `main`, and manual dispatch with concurrency cancellation.
- [x] Use a fixed Ubuntu image, the repository Node contract, and reviewed action commit SHAs.
- [x] Name install, audit, unit, Python, build, browser-install, and Playwright steps separately; upload
      Playwright report and test-results artifacts on failure.

**Verification:**

- [x] RED: workflow contract assertions fail against the current monolithic workflow.
- [x] GREEN: `npm run test:unit` validates triggers, pins, named steps, and artifacts.
- [ ] The first pushed run identifies one exact failing step and preserves its browser evidence.

**Dependencies:** Task 1.

**Files likely touched:** `.github/workflows/quality.yml`, `tests/unit.test.mjs`,
`playwright.config.mjs` if report retention needs adjustment.

**Estimated scope:** Medium (2-3 files).

## Task 3: Separate the live-service monitor

**Description:** Move ArcGIS/FEMA availability and schema checks out of merge-quality CI so external
availability produces a clear operational alert without obscuring repository correctness.

**Acceptance criteria:**

- [x] A dedicated workflow runs on schedule and manual dispatch only.
- [x] The deterministic workflow contains no scheduled external-service job.
- [x] The monitor records a concise step summary and fails visibly when its contract fails.

**Verification:**

- [x] RED: workflow contract assertion detects the current mixed workflow.
- [x] GREEN: `npm run test:unit` validates trigger and job separation.
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

- [x] Pure comparison logic accepts exact bytes and each precisely documented rewrite form.
- [x] Any other byte change fails with the page name and useful first-difference context.
- [x] `check:deployment` reaches and enforces repository-path and security-header assertions.

**Verification:**

- [x] RED: focused tests reproduce the current Pretty URLs failure and an unexpected-drift case.
- [x] GREEN: comparison unit tests and `npm run test:unit` pass — 33 tests, 8 new.
- [x] `npm run build && npm run check:deployment` reaches every gate against the live site:
      `index.html` matches with the documented rewrite tolerated, 20/20 repository paths are
      unpublished, and both pages carry every declared header. `business-licensing.html` reports a
      **true** difference — the live deploy predates `81f23dc`, and the same comparison against
      `main:business-licensing.html` matches with only the recorded root-collapse rewrite. The gate
      now detects a stale deployment, which is the behaviour it was missing.

**Dependencies:** Task 1.

**Files likely touched:** `scripts/deployment-content.mjs`, `scripts/check-deployment.mjs`,
`tests/unit.test.mjs`, `README.md`.

**Estimated scope:** Medium (4 files).

## Task 5: Add a live browser smoke test

**Description:** Verify both built/deployed pages through a real browser and live services using the
published synthetic address, without logging returned owner or property details.

**Acceptance criteria:**

- [x] General and licensing lookups reach “Results ready” against a configurable `DEPLOY_URL`, which
      is required rather than defaulted, so the suite cannot smoke-test production by accident.
- [x] The check fails on page errors, failed critical requests, HTTP errors, axe violations, or a
      status reporting an unavailable data source.
- [x] Output contains timings, request counts, peak concurrency and pass/fail state but no returned
      resident data. Tracing, screenshots and video are off; the results body is blanked before the
      test body returns, because Playwright writes its `error-context.md` page snapshot after it. A
      unit test fails if any of that is undone.

**Verification:**

- [x] RED: both flows fail against an intentionally unresolvable host.
- [x] GREEN: both pass against a locally served `dist/` and the live services — 40 and 4 service
      requests, 0 page errors, 0 failed requests, 0 axe violations.
- [x] A manual run passes against the live deployment: general 224 ms load / 1,365 ms lookup, 40
      requests, peak concurrency **36**; licensing 131 ms / 872 ms, 4 requests, peak 2. This closes
      MIGRATION.md's last open step-1 item, the built-page-to-live-service seam.
- [x] The measured peak of 36 concurrent requests independently reproduces the plan's baseline
      figure, and this run is the instrument Task 7 needs to prove its limit.

**Dependencies:** Task 4.

**Files likely touched:** `tests/production.spec.mjs`, `package.json`, `playwright.production.config.mjs`,
`README.md`.

**Estimated scope:** Medium (4 files).

## Task 6: Add candidate deployment verification

**Description:** Provide a manual/reusable GitHub workflow that verifies a staging or production
candidate URL and retains the resulting release evidence.

**Acceptance criteria:**

- [x] Workflow requires a candidate URL and runs deployment integrity plus live browser smoke.
      It also builds from the checked-out commit and records the artifact SHA-256, so the content
      gate compares the candidate against the artifact that commit produces.
- [x] It uses pinned actions, `contents: read`, a 20-minute bound, and uploads the deployment output
      and the sanitized smoke evidence for 90 days. The Playwright output directory is deliberately
      not uploaded.
- [x] The workflow is not an automatic production promotion: no `environment`, no `secrets.`, no
      push or schedule trigger, and a unit test fails if any of those appear.

**Verification:**

- [x] `npm run test:unit` validates triggers, inputs, permissions, pins, commands and evidence paths
      — and was confirmed to bite by temporarily adding `environment: production` and an unpinned
      action, which failed it.
- [ ] A manual run passes against a Netlify deploy preview. **Needs the branch pushed** — a preview
      does not exist until then. This is Checkpoint B.
- [x] An intentionally wrong candidate URL produces a clear failed gate: locally, both flows fail on
      an unresolvable host. The workflow additionally rejects a non-https `candidate_url` before
      checking anything out. Re-confirm at Checkpoint B through the workflow itself.

**Dependencies:** Tasks 4 and 5.

**Files likely touched:** `.github/workflows/verify-deployment.yml`, `tests/unit.test.mjs`, `README.md`.

**Estimated scope:** Medium (3 files).

## Checkpoint B: Prove a release candidate

- [x] Clean `npm ci`, audit, full tests, and build pass. **26 August 2026, Windows:** 0
      vulnerabilities, 35 Node tests, 4 Python tests, 63 browser/axe tests, build green.
- [x] Deterministic GitHub CI is green. Run
      [32986842819](https://github.com/buschbrian/parcel-lookup-nomap/actions/runs/32986842819) on
      Linux: install, audit, unit, Python, build, Chromium, browser tests, all green.
- [x] One deploy preview is verified for exact content, headers, publish allowlist, and both live
      flows. **`deploy-preview-3`, 26 August 2026: every gate passed.** Both pages match the built
      artifact with the tolerated transformations named, 20/20 repository paths unpublished, every
      declared header present on both pages; both live lookups clean — general 2,905 ms load /
      1,906 ms lookup / 40 requests, licensing 139 ms / 860 ms / 4 requests, zero page errors,
      failed requests or axe violations. Phase 2 changes no entry HTML, so that preview's artifact
      is byte-identical to this branch's.
- [x] Artifact hashes, workflow URL, and sanitized browser evidence are retained — in
      `production-evidence/` locally, and by the verification workflow for 90 days once it can be
      dispatched.
- [x] No production promotion occurred at this checkpoint.

**Two defects the preview run found, both now fixed and tested.** Verifying a preview for the first
time is what exposed them:

1. **Netlify injects its deploy-preview drawer before `</body>`.** Without an allowance, no deploy
   preview could ever pass the content gate — the gate would have been useless precisely where a
   release candidate is verified. Tolerated explicitly and named in the output.
2. **One page-level difference cascaded into all twenty allowlist probes.** The probes compared
   against the built bytes, but the catch-all answers them with the deployed index page, chrome and
   all, so every probe was reported as a published repository file. They now compare against the app
   as that deployment served it. **This was a false-positive generator on the most security-relevant
   gate in the check**, and it would have fired on any host post-processing at all.

**Against production**, `check:deployment` reaches every gate and reports one real difference:
`business-licensing.html` on the live site predates `81f23dc`. Against the commit actually deployed
it matches with only the recorded rewrite. That is the gate detecting a stale deployment — the first
time it has detected anything.

### Findings from this phase, for the phases that own them

0. **Netlify began injecting vendor marketing into both deployed pages, 26 August 2026.** Within
   twenty minutes of the repaired gate first passing against production, the next deploy started
   serving an HTML comment advertising Netlify with UTM campaign tracking, plus
   `<meta name="hosting-provider">` and `<meta name="netlify-deploy">` carrying a `netlify.new`
   referral URL and the site id. Third-party marketing with campaign tracking on a municipal
   government page is a policy question, not only an engineering one.

   The lookups are unaffected — `test:production` passes on both flows — and the injection is inert
   metadata with no script. `deploy-preview-3`, built on 24 August, does not carry it, so it is
   applied at deploy post-processing rather than at the edge.

   **The content gate caught it within minutes of first being able to catch anything**, which is the
   clearest possible argument for the gate. It is also the plan's named risk "host HTML processing
   hides real deployment drift" arriving in reality.

   **Resolved as far as it can be, 26 August 2026.** Netlify documents no opt-out — post-processing
   offers snippet injection, Pretty URLs and prerendering, and none of them governs this.
   `[build.processing.html] pretty_urls = false` shipped to production and the injection survived it,
   which does at least prove it is not post-processing. The municipality reports no way to remove it
   below a paid plan.

   The gate now tolerates it, narrowly: all three parts, in order, contiguous, reported on every
   passing run. The alternative was a production gate that is red forever, which teaches everyone to
   ignore it — the exact failure this check was repaired to escape. Widening the allowance fails the
   unit suite. **Remove the allowance when hosting moves or the plan changes.**

   Net effect on the production pages: the Pretty URLs rewrite is gone, so the only tolerated
   difference is this injection. Everything else is byte-exact.

1. **Task 8 has already reproduced itself.** `npm run check:services` hit a TLS `ECONNRESET` after 7
   of 51 checks on one run on 26 August 2026 and passed 51/51 on the next, with no change in between.
   That is precisely the transient-versus-contract distinction Task 8 exists to draw, and it means the
   weekly monitor will raise false alarms until it does.
2. **The developer toolchain drifts from the pin.** `npm ci` warns `EBADENGINE`: the pinned contract
   is Node 22.15.0 / npm 10.9.2, this machine runs Node 24.16.0 / npm 11.13.0. Everything passes, but
   the checks that gate a release are being run on a runtime the release does not declare. Whoever
   runs the release rehearsal should be on the pinned version, or the pin should be revised
   deliberately. Related: Task 9.
3. **The attorney review document was committed to a public repository.** `counsel-review/
   Public-Facing-GIS-Disclaimer-One-Page-Review.docx` was tracked while its sibling was gitignored
   with the comment "this repository is public on GitHub, so committing it would publish it".
   `.gitignore` listed files by name, so a document with a slightly different filename fell outside
   the rule meant to cover it, and nothing noticed for six days.

   **Untracked 26 August 2026 on instruction.** The document stays on disk; the whole
   `counsel-review/` directory is now ignored rather than named files; a unit test asserts that
   nothing under it is tracked. `check:deployment` also probes the path, and the site has never
   served it.

   **It remains in git history and is still readable on GitHub**, at commit `278d895` (20 August
   2026) and in the merge that carried it to `main`. Erasing it requires rewriting published history
   and force-pushing a public repository, which invalidates every existing clone and the open pull
   requests. **Task 10 and open question 4 still own that decision — do not rewrite history before
   counsel and records direction.** The exposure window to date is 20-26 August 2026; whether that
   requires notification is a records determination, not an engineering one.

## Task 7: Bound general-lookup concurrency

**Description:** Limit simultaneous ArcGIS/FEMA requests while preserving partial-result behavior,
abort semantics, result ordering, and current accessibility behavior.

**Acceptance criteria:**

- [x] `CFG.request.maxConcurrent` replaces the all-layer burst. The gate is in the shared request
      layer at `fetchJson`, the one choke point every request already passes through, so queries,
      schema reads and attachment fetches are all bounded — including any added later. FIFO.
- [x] Cancellation stops queued work: a superseded request is checked before it is queued and again
      after it acquires its slot, so it never reaches the network. A browser test clears a search
      mid-lookup and asserts that not one further request is issued.
- [x] Complete and degraded results remain in configured layer order, both covered by tests. The
      degraded case fails a layer in the middle of the configured order, which would reorder the
      page rather than truncate it if display order followed completion.

**Verification:**

- [x] RED: the concurrency assertion failed before the limit existed, and peak was measured at
      **36** — on production, and again locally with the limit set to 36.
- [x] GREEN: four browser tests prove the limit, ordering, degraded ordering, and cancellation.
- [x] 41 unit, 4 Python, **67** browser/axe (was 63), build, and both live flows pass.

**The value was chosen by measurement, not by feel** — three samples per setting against the live
services:

| `maxConcurrent` | lookup | cost to a resident |
|:--|:--|:--|
| 6 | 1365-1891 ms | +57% to +117% |
| 8 | ~1386 ms | +59% |
| **12** | **~879 ms** | **+1%** |
| unbounded (36) | ~871 ms | — |

12 cuts the burst on the public services by two thirds and costs a resident about 1%; 6 or 8 would
cost roughly 60% more waiting for no further reduction that matters. The critical path is the
slowest single request, and at 12 the queue drains inside it. **Lowering the value is always safe**
— it only makes lookups slower — so the GIS/data owner can trade speed for politeness at Checkpoint
C without any code change.

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

# ADR-0004: The data review date stays human, and the monitor only warns when it ages

## Status

Accepted.

## Date

2026-09-10

## Context

PR A5 puts a data owner and a review date on every card a resident reads (`CODE.md` section 6,
`docs/changes/CHANGES-2026-09-10.md` §10), sourced from `CFG.LAYERS[].sourceOwner`/`reviewedOn` and
`CFG.parcel.sourceOwner`/`reviewedOn` — fields that already existed "for governance" (`CODE.md`
section 3) and are now also resident-facing text. `CFG.release.dataReviewedOn` is the site-wide
version of the same idea: RELEASE.md defines it as "when a person last checked the GIS layers behind
[a release]" and says a release published against a stale review "is a stale-data release, and the
page says so to every resident who reads it."

Making the per-layer dates visible raises an obvious question: should the site-wide date update
itself, or should the live monitor (`npm run check:services`, `.github/workflows/live-service-monitor.yml`)
at least be allowed to bump it when a run is clean? Three facts constrain the answer.

**`npm run check:services` proves a contract, not a review.** It confirms that configured fields
still exist in the live schema, that known parcels still intersect the layers they are expected to,
and that spatial-relation directions and transport rules still hold. None of that is what
`dataReviewedOn` means. A layer can pass every one of the monitor's 57 contracts today and still be
the wrong layer to publish — Planning could have adopted a new zoning map, a boundary could have
shifted in a way that still intersects every test parcel, or a "no external steward identified"
informational layer (`DATA-SOURCES.md`'s debris-flow and alluvial-fan rows) could still be waiting on
the authoritative replacement the register already calls for. The monitor cannot see any of that. It
is a floor, not a review.

**`live-service-monitor.yml` runs with `permissions: contents: read`.** It has no path to commit a
changed `dataReviewedOn` back to `main` even if the monitor decided it should — and a workflow that
commits every green Monday would fire `deploy-staging.yml` (ADR-0002) on a schedule, publishing to
staging on a cadence nobody reviewed, for a change nobody but a script authored. That contradicts
ADR-0002's own reason for splitting deploy from promotion: promotion is a human act.

**The page cannot fetch its own freshness from anywhere else.** `public/_headers`' CSP `connect-src`
allows exactly the two data hosts (Millcreek ArcGIS Online and FEMA); a status file, even a same-origin
one Netlify or Azure served statically, is still a fetch the page does not otherwise need, and every
new fetch is a new thing to keep working across both hosts (ADR-0002) at every deploy. The self-
contained-page constraint (ADR-0001) already rules out a build step that could inject a "generated at"
timestamp GIS did not choose to write.

## Decision

`CFG.release.dataReviewedOn` stays exactly what RELEASE.md already defined it as: a date a named
person sets by hand, the same way the version and `publishedOn` are set, following RELEASE.md's
Sequence step 1. Nothing in this repository writes it automatically.

The live monitor's role is to make the date's age visible to whoever reads its output, without ever
treating age as a contract failure:

- `scripts/service-contract-core.mjs`'s `buildReport()` takes `dataReviewedOn` alongside
  `generatedAt` and returns `dataReviewedOn` and a computed `dataReviewedAgeDays` on the report. Both
  ride alongside `ok`/`failed`/`contractFailures` without touching any of them — an old review date
  is never a reason `report.ok` is `false`.
- `scripts/check-services.mjs` passes `CFG.release.dataReviewedOn` — the exact value the page
  publishes, not a value the monitor tracks separately — and always prints the computed age. Only
  once it exceeds **90 days**, matching RELEASE.md's stated review expectation, does it also print a
  `::warning::` annotation and add a line to `GITHUB_STEP_SUMMARY`. The process exit code is
  unaffected either way; a stale review date cannot fail a CI run or block a merge.
- RELEASE.md's Sequence step 1 states the 90-day expectation next to the instruction it has always
  given: confirm the date is current, or review the layers and update it by hand.

## Alternatives Considered

### Let the monitor bump `dataReviewedOn` on a clean run

The monitor already knows every configured field and spatial contract passed; auto-advancing the
date on a green run would keep it perpetually "fresh" with no additional workflow permission beyond
what write access would require.

Rejected: this is exactly the failure mode the Context section describes. A green contract run is not
a review — it is evidence that nothing detectably broke, which is a different and weaker claim than
"a person looked at these layers and confirmed they are still the right ones." Advancing the date
automatically would make the resident-facing claim ("checked 13 August 2026") false in the specific
way that matters: it would say a person did something no person did. It would also require granting
the monitor `contents: write` and a commit path to `main`, which — per ADR-0002 — fires
`deploy-staging.yml` on every such commit, turning a scheduled Monday check into a scheduled Monday
deploy.

### Fail the CI run when the date exceeds 90 days

Make staleness a hard gate: `check:services` exits non-zero past 90 days, the same as a contract
failure.

Rejected. `check:services` is explicitly not a pull-request dependency (`CODE.md` section 8) — it
runs on a schedule against live public services, and AGENTS.md's distinction between transport and
contract failure exists precisely so a class of finding that is not "the page is now wrong" does not
block merges. A stale review date is a "someone should look at this" finding, not a "the page
answered incorrectly" finding; conflating the two would make every PR's merge depend on a fact no PR
diff changed, and would pressure whoever hits the gate to bump the date without actually reviewing
anything — the "test edited to pass" failure mode RELEASE.md's own "What must never be true of a
release" section already names.

### Give the page a status endpoint to read its own freshness

Publish a small JSON file (age, last-checked) that `index.html` fetches at load and displays instead
of (or in addition to) the static `CFG.release.dataReviewedOn`.

Rejected for now. It requires a new same-origin or cross-origin fetch — a CSP change either way, on
both `public/_headers` and `public/staticwebapp.config.json` (ADR-0002) — for a value that is, today,
only ever a warning to staff rather than something a resident needs to poll live. Revisit only if a
future requirement needs the age reflected on the page itself between releases, which is a different
problem than what PR A5 solves (naming the owner and date already on record).

## Consequences

### Positive

- The resident-facing claim stays true: "checked `<date>`" always names a date a person actually set,
  never one a script advanced to look current.
- Staff get an early, low-friction signal — a `::warning::` in the Actions log and a step-summary
  line, both non-blocking — well before a stale review turns into a stale-data release RELEASE.md
  already says not to ship without acknowledging.
- No new CSP host, no new workflow permission, no new commit path to `main`.

### Negative

- The date can still go stale silently between scheduled monitor runs (weekly, per
  `live-service-monitor.yml`) if nobody reads the log or the step summary — the same operational risk
  every non-blocking warning carries, accepted here because the alternative (a hard gate) has the
  worse failure mode described above.
- A person still has to remember to run RELEASE.md's Sequence step 1 at release time; this ADR makes
  the reminder louder, not automatic.

### Governance

- No workflow may write `CFG.release.dataReviewedOn` (or a layer's `reviewedOn`) on its own. Only a
  person, following RELEASE.md's Sequence or USAGE.md's GIS-staff maintenance instructions, sets
  either.
- The 90-day figure is RELEASE.md's; if that document's stated expectation ever changes,
  `DATA_REVIEW_MAX_AGE_DAYS` in `scripts/service-contract-core.mjs` changes with it in the same PR.

## References

- `RELEASE.md` — `dataReviewedOn`'s definition and the Sequence step this ADR annotates
- `CODE.md` section 6 — the per-card attribution PR A5 built, and section 8 — why `check:services` is
  not a pull-request dependency
- `docs/changes/CHANGES-2026-09-10.md` §10 — this PR's own record
- [ADR-0001](0001-use-vite-with-build-time-configuration.md) — the self-contained-page constraint
- [ADR-0002](0002-host-on-azure-static-web-apps.md) — why an unattended commit to `main` is not a
  free action in this repository

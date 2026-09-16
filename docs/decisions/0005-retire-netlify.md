# ADR-0005: Retire Netlify and make Azure the only host

## Status

Accepted.

## Date

2026-09-16

## Context

[ADR-0002](0002-host-on-azure-static-web-apps.md) moved production to Azure Static Web Apps and kept
Netlify serving in parallel as the rollback, with no deadline — the same standing instruction the
planning map cutover used. That parallel run has held since 2026-09-02 through three promotions
(2026-09-02, 2026-09-03, 2026-09-15), the most recent publishing release `2026.09.15`.

Running two hosts was never free. It cost the repository three kinds of accommodation:

**Content allowances.** `scripts/deployment-content.mjs` tolerated three transformations Netlify
applied to served bytes: two Pretty URLs link rewrites, the deploy-preview drawer, and — from
2026-08-26 — a marketing comment and two meta tags carrying UTM campaign tracking and the site id.
The third was tolerated under protest. Netlify documented no opt-out below a paid plan, and the
alternative was a gate red on every production deploy forever, which teaches everyone to ignore it.
A gate that tolerates an injection cannot also prove the absence of one.

**Two header files.** `public/_headers` (Netlify) and `public/staticwebapp.config.json` (Azure)
declared the same six response headers. Each host silently ignores the other's file, so nothing at
runtime would notice them drifting apart — a CSP edit could ship to one host and not the other with
every check still passing. A unit test compared them header by header purely to make either file
safe to edit. That test existed only because there were two files.

**A host the repository could not verify.** `check:deployment` points at one URL. Whichever host it
was not pointed at was unverified, and in practice it was always Netlify.

The condition ADR-0002 set for retirement was that the parallel run settle. It has: DNS resolves
`lookup.gis.millcreekut.gov` to the Azure app with no Netlify dependency, the planning map's outbound
link was repointed on 2026-09-02, and `check-deployment.mjs` has defaulted to the Azure production
URL since the same date.

## Decision

Retire Netlify. Azure Static Web Apps is the only host.

1. **Remove all three content allowances.** The deployment gate requires the live bytes to equal the
   built artifact exactly. There is no tolerated transformation of any kind.
2. **Delete `netlify.toml` and `public/_headers`**, and with them the cross-host drift test.
   `public/staticwebapp.config.json` is the single source of response headers, routes and cache
   rules.
3. **Rollback is a re-promotion**, not a second live site: run `promote-production.yml` with the run
   id of the last known-good staging run. Artifacts are retained 90 days, the digest is checked on
   download, and the same approver gate applies in both directions.

## Consequences

**The gate gets stricter, which is the point.** Each retired allowance is now asserted to fail. A
host that injects marketing into a municipal page is precisely what `check:deployment` exists to
catch; before this change it was tolerated and reported, and now it fails. Verified rather than
assumed: the deployed commit `297e8667` was rebuilt with the stricter gate and checked against
`https://lookup.gis.millcreekut.gov/` — both pages byte-exact, 24/24 repository paths unpublished,
every declared header present, no tolerated transformation on any page.

**Header coverage moves rather than disappears.** The Azure-only test asserts what the drift test
used to guarantee: HSTS present with at least a year of `max-age` and `includeSubDomains` intact, a
CSP whose `connect-src` reaches only Millcreek ArcGIS and FEMA, `must-revalidate` on both documents
and the readable licensing URL, `/business-licensing` rewritten rather than redirected, and the host
config denied by role with the 401→404 override and `navigationFallback` exclusion that make the
denial work. `_headers` also carried reasoning in comments that JSON cannot hold — why
`'unsafe-inline'` is accepted, and the warning that HSTS `includeSubDomains` sent from
`lookup.gis.millcreekut.gov` reaches only that name's children and not the `millcreekut.gov` apex.
That moved to CODE.md section 1 rather than being lost with the file.

**One host is one point of failure.** This is a real reduction in redundancy, accepted deliberately.
The mitigation is that rollback never depended on Netlify being *live* — it depended on a known-good
artifact being promotable, which it still is. What is lost is the ability to serve from a second
provider during an Azure outage. For a lookup whose documented fallback is already a staffed phone
number and a five-business-day accessible-format commitment, that tradeoff is acceptable.

**The Netlify site still exists.** Deleting it is a dashboard action, not a repository change, and it
is deliberately the last step: the repository stops configuring and verifying Netlify first, the site
is confirmed unnecessary, and only then is it deleted. Until it is, the old address keeps serving a
copy of this site that no gate here can verify and that still carries the injected marketing.

**`playwright.production.config.mjs` and the smoke run are unaffected.** They already targeted the
production hostname, which has been Azure since 2026-09-02.

## Alternatives considered

**Keep Netlify indefinitely as a dark fallback.** Rejected. An unverified host serving a stale copy
of a municipal service under a `.netlify.app` address, with third-party marketing injected into it,
is a liability rather than a safety net. Nobody would be watching it, and the repository would keep
paying the three accommodations above to support something nobody checks.

**Delete the Netlify site first, then clean the repository.** Rejected as sequencing. It removes the
fallback before the replacement work has been reviewed. Doing the repository changes first means
every step is reversible by `git revert` until the final, irreversible dashboard action.

**Move the allowances behind a host flag rather than deleting them.** Rejected. A conditional
allowance is an allowance; the value of deleting them is that the gate can no longer be configured to
tolerate an injection. The history is in git if a future host ever needs the same shape of tolerance.

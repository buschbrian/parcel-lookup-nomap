# ADR-0002: Host on Azure Static Web Apps, with promotion behind a human approver

## Status

Accepted. Supersedes the hosting paragraph of [ADR-0001](0001-use-vite-with-build-time-configuration.md)
and the 2026-08-27 conclusion recorded in `tasks/todo.md`.

## Date

2026-09-02

## Context

ADR-0001 chose Netlify for development and migration deployments and deferred
institutional hosting "until ownership and operating requirements are decided". Those
requirements are now decided, and two things changed that the earlier decision could not
have accounted for.

**The municipality has an Azure footprint, and it is proven.** On 2026-09-01 the Millcreek
Planning Map cut over to Azure Static Web Apps at `planning.gis.millcreekut.gov`. CivicPlus
delegated the `gis.millcreekut.gov` zone to Azure DNS, the custom domain bound with a valid
certificate, and GitHub Actions became the only publisher. A hostname for this application
under the same zone needs a CNAME, not a delegation, a procurement, or a new relationship.

**The 2026-08-27 conclusion no longer holds.** That entry found that `maps.millcreekut.gov`
ran on the IT provider's Netlify account with no injected marketing, and concluded the right
move was an account transfer within Netlify rather than a platform change. It was correct at
the time. It is now the worse option: `maps.millcreekut.gov` is itself being retired as part
of the planning map cutover, so the precedent it rested on is disappearing, and an account
transfer would still leave two municipal applications on two different platforms with two
different publishing models.

The operational facts that motivated the move are unchanged and still live. As of 2026-09-02
the production site serves a Netlify marketing comment and two `netlify.new` meta tags
carrying UTM campaign tracking, on every page, from an individual employee's personal
account. `scripts/deployment-content.mjs` tolerates that injection under protest and says in
its own comment to remove the allowance when hosting moves.

There is one constraint that Azure does not relax and must not be allowed to erode. This
repository has committed repeatedly, in `verify-deployment.yml` and in readiness Tasks 11 and
12, that promotion to production is a human act performed by a designated municipal approver.
The planning map deploys to production automatically on every push to `main`. Copying that
pipeline here would silently delete a control this application's governance depends on.

## Decision

Host on Azure Static Web Apps, as two separate resources, and split deployment from promotion.

- **Two Static Web Apps**, not one app with preview environments: a staging resource and a
  production resource, each with its own deployment token. Named preview environments are a
  paid-plan feature; two resources give the same separation on any plan and make the
  production token reachable from exactly one workflow.
- **`deploy-staging.yml`** runs on every push to `main`. It runs the full gate chain, uploads
  `dist/` as an artifact, and deploys that artifact to staging. It is unattended, and it
  cannot reference the production token.
- **`promote-production.yml`** runs only by hand. It builds and tests nothing: it downloads
  the artifact a named staging run produced and publishes those exact bytes. The approval is
  the `production` GitHub environment's required-reviewers setting, so GitHub records who
  approved which artifact and when.
- **`public/staticwebapp.config.json`** carries the response headers, cache rules, the
  `/business-licensing` rewrite and the fallback, mirroring `public/_headers` exactly. A unit
  test compares the two files, because each host silently ignores the other's.
- **Netlify stays up, untouched, during a parallel run**, on the same reasoning the planning
  map used: both sites are reachable by different names, so nothing about the current service
  changes at the moment the new one appears.
- **Production hostname: `lookup.gis.millcreekut.gov`**, a CNAME in the already-delegated
  `gis.millcreekut.gov` Azure DNS zone.

Operationally this is ADR-0001's own instruction finally implemented rather than a change of
direction: "generate one immutable static artifact in `dist/` and promote that same artifact
through staging and production."

## Alternatives Considered

### Transfer the Netlify site to the IT provider's account

The 2026-08-27 conclusion. Removes the marketing injection and the personal-account risk in a
single action, and needs no new configuration.

Rejected because the precedent it rested on is being retired, it leaves two municipal
applications on two platforms, and it does not supply the artifact-promotion model ADR-0001
asked for — Netlify builds from Git, so what deploys is a rebuild rather than the bytes a
gate ran against. It remains the correct fallback if Azure access is delayed.

### Copy the planning map's push-to-production pipeline

One workflow, deploy on merge to `main`, no approver. Simpler, and already proven in this
municipality.

Rejected because it contradicts this repository's stated governance in four documents and
would remove the approver control that readiness Task 12 exists to establish. The planning map
serves staff workflows that predate any approval process; this application is a resident-facing
legal-adjacent lookup under active counsel review.

### One Static Web App with named preview environments

Fewer resources, staging as an environment of production rather than a separate app.

Rejected because named preview environments require the Standard plan, and because the
production deployment token would then be the same token staging deploys with — an unattended
job would hold a credential that can reach the public site.

### Azure Storage static website / Azure App Service

Both were considered and rejected in ADR-0001 for reasons that still hold: Storage static
websites cannot serve custom response headers without fronting them with a CDN, and App
Service is a server runtime for an application that has no server.

## Consequences

### Positive

- The marketing injection disappears, and with it the allowance in
  `scripts/deployment-content.mjs` and the open question in `tasks/todo.md` that owns it.
- A public municipal service stops depending on an individual employee's personal account.
- The artifact residents load is the artifact the gates ran against and the approver approved,
  proven by hash at both ends rather than asserted.
- Readiness Task 11's acceptance criteria — staging automatic, production approver-gated,
  matching artifact hashes — become properties of the pipeline instead of items on a list.
- Both municipal GIS applications land on one platform with one publishing model.

### Negative

- Two host config files must be kept in agreement for as long as the parallel run lasts. The
  drift test makes that a build failure rather than a silent divergence, but it is real work.
- Two Azure resources and two deployment tokens to hold, rotate and document.
- The approver becomes a release dependency. That is the intent, and it is still a person who
  can be unavailable; `docs/azure-hosting.md` names the rollback path that does not wait.

### Governance

- Promotion remains a human act. Nothing in this repository can publish to production without
  a listed reviewer approving a specific artifact, and removing that control requires a
  repository-settings change rather than a workflow edit.
- `verify-deployment.yml` is unchanged and still holds no credential. It verifies a candidate;
  it does not promote one.
- Retiring Netlify is a separate, later decision with its own record, taken after the parallel
  run settles. Until then this ADR adds a host; it does not remove one.

## References

- [ADR-0001](0001-use-vite-with-build-time-configuration.md), hosting paragraph and the Azure
  alternatives it deferred
- `docs/azure-hosting.md` — resources, secrets, cutover and rollback
- [Azure Static Web Apps configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration)
- `tasks/todo.md`, readiness Tasks 11 and 12

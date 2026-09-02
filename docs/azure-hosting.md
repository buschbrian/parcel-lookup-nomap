# Azure hosting — resources, secrets, cutover, rollback

Operational companion to [ADR-0002](decisions/0002-host-on-azure-static-web-apps.md), which
records *why* the site is moving to Azure Static Web Apps and why promotion stays a human act.
This file is *how*.

**Status, 2026-09-02: the repository half is done; nothing has been created in Azure yet.**
`public/staticwebapp.config.json`, `deploy-staging.yml` and `promote-production.yml` are in the
repository and the suite is green. Every step below is still open, and none of it has run.
Netlify is untouched and remains the live production host until the cutover section says
otherwise.

## What has to exist

| | Staging | Production |
|---|---|---|
| Static Web App | `swa-millcreek-lookup-staging` | `swa-millcreek-lookup` |
| Plan | Free is sufficient | Free is sufficient |
| Hostname | the Azure default `*.azurestaticapps.net` | `lookup.gis.millcreekut.gov` |
| Deployed by | `deploy-staging.yml`, on every push to `main` | `promote-production.yml`, by hand |
| Token secret | `AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING` | `AZURE_STATIC_WEB_APPS_API_TOKEN` |
| GitHub environment | `staging`, no reviewers | `production`, **required reviewers** |

Two resources rather than one app with named environments: ADR-0002 explains the reasoning,
and the short version is that a free plan has no named preview environments and that an
unattended job must not hold a credential that can reach the public site.

### 1. Create the Static Web Apps

Create them **without** linking a GitHub repository. The Azure portal offers to wire up a
workflow for you; decline it. That generated workflow builds with Oryx inside the deploy
container, which would publish a bundle no gate in this repository ever saw — the exact
property `deploy-staging.yml` exists to guarantee. This repository deploys with `action:
upload` and `skip_app_build`, and it supplies its own workflows.

Resource group, region and SKU match `swa-millcreek-planning`, so both municipal GIS
applications sit together and nothing new has to be provisioned or budgeted.

```bash
az staticwebapp create --name swa-millcreek-lookup-staging \
  --resource-group rg-millcreek-devpipeline --location westus2 --sku Free
az staticwebapp create --name swa-millcreek-lookup \
  --resource-group rg-millcreek-devpipeline --location westus2 --sku Free
```

Pass no `--source`, `--branch` or `--token`. Those link the app to the repository and generate
a workflow that builds with Oryx in the deploy container — a bundle no gate in this repository
would ever see. A disconnected app that accepts uploads against a deployment token is what
`deploy-staging.yml` and `promote-production.yml` expect.

Read each deployment token — this is the value that goes into the matching GitHub secret, and
the only credential either workflow holds:

```bash
az staticwebapp secrets list --name swa-millcreek-lookup-staging \
  --resource-group rg-millcreek-devpipeline --query "properties.apiKey" -o tsv
az staticwebapp secrets list --name swa-millcreek-lookup \
  --resource-group rg-millcreek-devpipeline --query "properties.apiKey" -o tsv
```

### 2. Configure GitHub

Repository → Settings → Environments.

- **`staging`** — no protection rules. Add the secret
  `AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING`. This environment is deliberately unattended; a
  reviewer here would mean every merge to `main` waits on a person for a deploy nobody sees.
- **`production`** — add **required reviewers**: the designated municipal approver, and at
  least one other person so a single absence cannot block a release. Add the secret
  `AZURE_STATIC_WEB_APPS_API_TOKEN`.

The required-reviewers setting *is* the approval control. It is not asserted by any test in
this repository, because it lives in repository settings rather than in a file — which is the
point: removing it is a visible, audited settings change rather than a quiet edit to YAML.
What the unit suite does assert is that no workflow builds a path around it.

Scope each token to its environment, not to the repository. A repository-level
`AZURE_STATIC_WEB_APPS_API_TOKEN` would be readable by any workflow, including the unattended
staging job, and the test that proves staging cannot reach production would become a
statement about one file rather than about the credential.

### 3. Bind the production hostname

`gis.millcreekut.gov` is already delegated to Azure DNS — CivicPlus delegated it on
2026-09-01 for `planning.gis.millcreekut.gov`. So this is a record in an existing zone, not a
delegation request.

The zone lives in `rg-millcreek-dns` and already holds `planning`, `cases` and `server`. This
adds `lookup` beside them. Create the CNAME **first** — Azure validates the custom domain by
resolving it, so binding before the record exists just fails and has to be retried.

```bash
# The value to point at is the new app's own default hostname.
az staticwebapp show --name swa-millcreek-lookup \
  --resource-group rg-millcreek-devpipeline --query defaultHostname -o tsv

az network dns record-set cname set-record -g rg-millcreek-dns -z gis.millcreekut.gov \
  -n lookup -c <that default hostname>

az staticwebapp hostname set --name swa-millcreek-lookup \
  --resource-group rg-millcreek-devpipeline --hostname lookup.gis.millcreekut.gov
```

Then wait for the certificate to reach status **Ready**. Do not proceed while it is pending;
a half-bound domain serves certificate errors to anyone who finds the name early.

```bash
az staticwebapp hostname list --name swa-millcreek-lookup \
  --resource-group rg-millcreek-devpipeline -o table
```

No repository change is needed for the hostname. Nothing in the config or the workflows
hardcodes one, and the CSP needs no edit either: `frame-ancestors` already allows
`https://*.millcreekut.gov`, and a CSP host wildcard matches any depth of subdomain, so
`lookup.gis.millcreekut.gov` is covered by the value already shipping.

## How a release flows

```text
push to main
   └─ deploy-staging.yml
        build job    npm ci → audit → unit → python → build → browser tests
                     → sha256 of both pages into the run summary
                     → upload artifact  site-<sha>          (90 days)
        deploy job   download that artifact → upload to staging SWA
                     → prints the run id to promote with

   └─ verify-deployment.yml          (run by hand, against the staging URL)
        rebuilds from the same commit, compares served bytes to built bytes,
        probes the publish allowlist, asserts every security header, and runs a
        real lookup on both pages against the live public services.
        Evidence is retained for 90 days. This is what an approval rests on.

   └─ promote-production.yml         (run by hand, with that run id)
        validates the run is a green deploy-staging run from main
        → ⏸  HELD at the `production` environment until a reviewer approves
        → downloads the SAME artifact (digest checked) → uploads to production
        → prints the same two hashes for the record
```

The artifact is never rebuilt between the gate and the public site. That is the property the
whole split exists for: the approver approves specific bytes, and those bytes are what
deploys.

## Cutover

**Parallel run, no deadline** — the same standing instruction the planning map cutover used.
Netlify stays live and untouched until the city decides the Azure site takes the traffic. Both
are reachable at once under different names, which is what makes the switch low risk.

1. Create both Static Web Apps and configure both environments (above). Nothing is public yet.
2. Merge this branch. `deploy-staging.yml` runs and staging exists.
3. Run `verify-deployment.yml` against the staging URL. Expect it to pass **with no tolerated
   transformation reported** — Azure does not post-process HTML, so the Pretty URLs allowances
   and the marketing-injection allowance should all be inert. If the run reports a tolerated
   transformation on Azure, stop: something is rewriting the pages and it is not Netlify.
4. Bind `lookup.gis.millcreekut.gov` to the production app and wait for a Ready certificate.
5. Promote the verified candidate with `promote-production.yml`.
6. Run `verify-deployment.yml` again, against `https://lookup.gis.millcreekut.gov/`.
7. Run the manual keyboard/NVDA script in `docs/manual-screen-reader-test.md` against the
   real hostname, not a preview, and sign it.
8. Announce the new address. Netlify is still live and still correct at this point.

### After the parallel run settles

Not before, and each of these is a separate reviewed change:

- Update the planning map's outbound link. `planning.gis.millcreekut.gov` currently offers
  `https://parcel-lookup-millcreek.netlify.app/` as the map's documented non-visual
  equivalent — a `.gov` map sending screen-reader users to a personal Netlify account.
  Repointing it at `lookup.gis.millcreekut.gov` is the single highest-value follow-up.
- Update `scripts/check-deployment.mjs`'s default `DEPLOY_URL`.
- Delete the marketing-injection allowance in `scripts/deployment-content.mjs` and the unit
  tests that pin it, and close the open question in `tasks/todo.md` that owns it.
- Delete `netlify.toml`, `public/_headers`, the cross-host drift test, and the redirect in
  `netlify.toml` that denies `staticwebapp.config.json`. Then delete the Netlify site.
- Record the retirement as its own decision entry.

## Rollback

Rolling back is a promotion, not a special case: run `promote-production.yml` again with the
run id of the last known-good staging run. The artifacts are retained for 90 days, the digest
is checked on download, and the same approver gate applies.

Two consequences worth knowing before you need them:

- **A rollback needs an approver too.** That is deliberate — an unapproved path to production
  is an unapproved path whichever direction it moves the site. It is also why the `production`
  environment should list more than one reviewer.
- **A rollback past 90 days has no artifact.** Re-run `deploy-staging.yml` on the good commit
  via `workflow_dispatch` to rebuild and re-gate it, then promote that run.

## Open

- Nothing in Azure has been created yet. Every step in "What has to exist" is outstanding.
- The designated municipal approver is not yet named — readiness Task 12. Until a person is
  listed as a required reviewer on the `production` environment, the gate exists but is
  unconfigured, and `promote-production.yml` should not be run.
- Repository, host, DNS, billing and recovery access still need at least two people
  (readiness Task 11). Creating these resources under one individual's Azure account would
  reproduce, on a new platform, the exact risk this move exists to close.

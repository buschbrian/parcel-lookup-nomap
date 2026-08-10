# Modular Municipal Geospatial Application

## Problem Statement

How might we make Millcreek's property lookups faster and safer for developers to change, test,
review, and deploy while preserving a configuration surface that GIS staff can maintain without
working inside application logic?

The application must remain an accessible public service, not become a general-purpose mapping
framework. Changes to geospatial sources and public determinations must remain attributable,
reviewable, reproducible, and reversible.

## Recommended Direction

Build the two lookup pages as a Vite multi-page application using plain JavaScript, shared modules,
shared CSS, and validated build-time JSON configuration. Vite produces static HTML, CSS, and
JavaScript in `dist/`; it does not introduce a production application server or runtime package
dependency.

Keep the architecture repository- and pipeline-neutral. GitHub Enterprise, Azure Repos, or another
municipally controlled Git host may eventually own the source. Netlify is the current development
and migration deployment target: it already exercises routing, response headers, previews, and
rollback without forcing an infrastructure decision before the application has been modularized.
Azure hosting and Azure DevOps remain possible later institutional choices, not migration
prerequisites.

Keep the resident-facing runtime REST-first. The browser should call the published ArcGIS REST
services directly, as it does now. Use ArcGIS API for Python outside the request path for portal
inventory, item discovery, metadata and schema validation, lineage reports, representative-parcel
comparisons, and reviewed batch data work across ArcGIS Online and ArcGIS Enterprise.

Treat automated improvement as a governed pull-request loop. Automation may observe failures,
open issues, propose code or configuration changes, and run verification. It may not approve its
own work, promote a new geospatial source, change a public determination, or deploy itself to
production.

## Proposed Source Shape

```text
index.html
business-licensing.html
src/
  property/main.js
  licensing/main.js
  shared/
    address-search.js
    arcgis-client.js
    combobox.js
    dom.js
    request-manager.js
    result-rendering.js
  styles/
    base.css
    components.css
    print.css
config/
  property.json
  business-licensing.json
schemas/
  property-config.schema.json
  business-licensing-config.schema.json
public/
  assets/
    millcreek-logo.png
tests/
scripts/
tools/
  arcgis/
netlify.toml
_headers
```

The exact module names may change during migration. The important boundaries are separate page
entry points, shared behavior, declarative GIS configuration, and one static build artifact.

## ArcGIS Operating Model

### Resident request path

- Static HTML, CSS, and JavaScript run in the browser.
- Read-only requests go directly to configured public ArcGIS REST endpoints and FEMA where needed.
- No Python service, application server, portal credential, or ArcGIS API for Python dependency is
  required to answer a resident lookup.
- The configured item ID, service URL, layer ID, and fields remain pinned until a reviewed change is
  released.

### GIS engineering and release path

ArcGIS API for Python may connect to ArcGIS Online or ArcGIS Enterprise using an approved profile
or workload identity. Repository tools should support:

- Searching organization content by owner, type, tags, categories, item ID, and service URL
- Exporting item, service, layer, field, domain, extent, spatial-reference, sharing, and date facts
- Checking whether configured services still resolve to the intended portal items and layers
- Comparing schemas and representative parcel outcomes before a source or layer change
- Producing source-lineage reports for derived county, state, federal, and municipal products
- Preparing metadata findings or proposed updates for the item owner to review

These tools produce evidence. They must not choose an item because it merely appears newer,
overwrite metadata, republish data, change sharing, or promote a source without an authenticated
operator and an explicit reviewed operation. Discovery access can be anonymous for public ArcGIS
Online content; any mutation requires institutionally managed credentials and least privilege.

## Configuration Boundary

### GIS-maintainable JSON

- Service and layer URLs
- Layer indices and field mappings
- Public labels, notes, and disclaimers
- Point versus full-parcel geometry mode
- Cardinality and ranking configuration
- Contacts and response commitments
- Address synonyms and reviewed street aliases
- Portal URL, ArcGIS item ID, service URL, layer ID, and authoritative/derived classification
- Municipal data owner, upstream source organization and URL, and derivation method
- Item owner, review date, source dates, refresh cadence, and source-snapshot metadata
- Acknowledgements/credits, terms of use, license or access constraints, and contact
- Release and data-review metadata

Every schema should reject unknown properties and require governance fields for displayed layers.
CI should report configuration errors with the JSON path and a plain-language correction.

ArcGIS item details and standards-based metadata are the starting evidence, not an automatic
guarantee of authority. A derived municipal layer must identify the upstream county, state, or
federal product and explain the transformation. Item-level and layer-level metadata should both be
checked because ArcGIS does not automatically keep all of those values synchronized.

### Application code

- Fetch, timeout, retry, cancellation, and ArcGIS error classification
- DOM creation and safe URL/telephone rendering
- Accessible combobox behavior and focus management
- FEMA normalization and display precedence
- Registered value formatters such as integer, acreage, and date formatting
- Regular expressions, field-suppression policy, and other executable rules
- Rendering policy for Yes, No, Unknown, partial failures, and conflicting sources

JSON must not contain executable code. Existing formatter functions and regular expressions should
move into named registries or application modules rather than being serialized.

## Governed Improvement Loop

```text
Observe
  -> create an issue or proposed pull request
  -> validate configuration and deterministic behavior
  -> compare affected parcel outcomes and live services
  -> obtain code, GIS, and accessibility review
  -> deploy to staging
  -> complete human production approval
  -> deploy and run post-deployment checks
  -> retain evidence and a tested rollback point
```

### Automation may

- Detect broken services, schema drift, accessibility regressions, or deployment mismatches
- Reproduce failures and add regression tests
- Propose source or code changes in a branch or pull request
- Produce affected-parcel counts and before/after comparisons
- Recommend simplifications supported by passing tests

### Automation may not

- Merge or approve its own pull request
- Replace a configured geospatial source because another item appears newer
- Rewrite disclaimers, legal interpretations, or regulatory classifications without an owner
- Publish a configuration that has not passed schema and outcome validation
- Promote staging to production without the designated human approval
- Add tracking or analytics without privacy, notice, retention, and records review

## Municipal Release Gates

1. **Code:** unit tests, Python tests where applicable, formatting, dependency review, and a clean
   production build.
2. **Accessibility:** Playwright and axe tests, keyboard coverage, reflow and print checks, plus the
   municipality's assigned manual keyboard and screen-reader review for material UI changes.
3. **GIS:** configured schema checks, portal-item resolution, required metadata and lineage,
   known-positive and known-negative parcels, boundary cases, source ownership, review dates, and
   result-change counts.
4. **Privacy:** no search-term telemetry by default; any tracking change requires review under the
   Utah Government Data Privacy Act and an updated website privacy notice where applicable.
5. **Records:** release approvals, source migrations, and retained pipeline evidence follow a
   schedule confirmed with the municipal records officer. Git history is supporting evidence, not
   an assumed records-retention system.
6. **Deployment:** staging smoke test, security-header verification, exact release identification,
   manual production approval, post-deployment contract check, and documented rollback.

Accessibility reference: [DOJ Title II web rule fact sheet](https://www.ada.gov/resources/2024-03-08-web-rule/).
Privacy reference: [Utah Government Data Privacy Act](https://le.utah.gov/xcode/Title63A/Chapter19/63A-19-S101.html).
Records reference: [Utah Division of Archives retention schedules](https://archives.utah.gov/records/retention-schedules/).

## Migration Scope

Each slice must leave the current application deployable and must not mix source changes or new
resident-facing features into the architecture migration.

### Slice 0: Freeze the behavioral contract

- Preserve the current deterministic fixtures and live service-contract checks.
- Add representative parcel cases for every result group and both lookup pages.
- Record current copy output, accessibility semantics, routes, security headers, and failure states.
- Define the permitted versus forbidden output differences during migration.
- Capture an ArcGIS inventory for every configured REST layer: portal, item ID, owner, service and
  layer URLs, schema, sharing, authoritative status, upstream source, credits, terms, and dates.

### Slice 1: Establish the static build

- Add Vite with `index.html` and `business-licensing.html` as entry points.
- Produce a deployable `dist/` without changing application behavior.
- Copy the Netlify routing and header configuration into the artifact root.
- Add build and artifact-inspection commands to CI.

### Slice 2: Extract shared styles

- Move common design tokens, base styles, controls, cards, flags, and print rules into CSS files.
- Keep only genuinely page-specific CSS beside each page.
- Verify light, dark, forced-colors, reduced-motion, reflow, and print behavior.

### Slice 3: Extract and validate configuration

- Move declarative values into `config/*.json`.
- Add strict JSON Schemas and useful validation errors.
- Move executable formatters and policies into named code registries.
- Add read-only ArcGIS API for Python inventory and metadata checks as an optional GIS toolchain;
  keep REST checks runnable without the heavyweight `arcgis` package.
- Confirm every configured source and every known parcel produces the same result as before.

### Slice 4: Extract shared behavior

- Move request handling, ArcGIS queries, address parsing, combobox behavior, safe DOM creation, and
  common result primitives into shared modules.
- Retain page-specific orchestration and result interpretation in each page entry point.
- Remove duplication only after both pages use the shared implementation and tests remain green.

### Slice 5: Establish staging and production delivery

- Use Netlify deploy previews and the current site for migration and development validation.
- Build once and promote the same immutable artifact rather than rebuilding per environment.
- Store deployment credentials in institutionally controlled secret management.
- Require designated approval before production promotion.
- Run live service and deployed-artifact checks after release.
- Decide on the municipality's long-term Git, pipeline, and production host only after ownership,
  security, support, domain, records, recovery, and procurement requirements are known.

### Slice 6: Introduce bounded improvement automation

- Start with scheduled observation and issue creation.
- Permit automated pull-request proposals only after the relevant evaluation suite exists.
- Record the evidence, tool/model identity, inputs, and verification results with each proposal.
- Reassess runtime-managed configuration only after GIS staff have used build-time JSON successfully.

## Key Assumptions to Validate

- [ ] GIS staff can safely edit strict JSON with schema-aware editor support. Validate with a
  realistic contact, layer, field, and disclaimer change performed without developer intervention.
- [ ] The current outputs can be captured strongly enough to detect migration drift. Validate with
  representative and boundary parcel fixtures before moving logic.
- [ ] Netlify can build the modular artifact and reproduce the required routes, CSP, cache,
  permissions, referrer, HSTS, and MIME-sniffing headers. Validate with deploy previews and the
  existing deployment check.
- [ ] The municipality can own the eventual repository, host, custom domain, credentials, and
  recovery access independently of any employee account. Validate before an institutional cutover.
- [ ] ArcGIS items used by the application have enough item- and layer-level metadata to establish
  authority and upstream lineage. Produce a gap report before extracting configuration.
- [ ] Manual accessibility ownership can be assigned for material releases. Name the role and
  required evidence before the first production migration.
- [ ] Pipeline and approval records can follow an approved municipal retention schedule. Confirm
  the series and retention period with the records officer.

## MVP Scope

The migration MVP is complete when both current pages are generated from modular plain-JavaScript
source, share address and ArcGIS behavior, read schema-validated build-time configuration, pass the
existing and migration-specific test suite, and deploy a verified static artifact to Netlify with
preview evidence and rollback. The GIS inventory and metadata-gap report must cover every
resident-facing layer.

Moving production to Azure or another municipally selected platform is a later infrastructure
decision with its own acceptance criteria.

## Not Doing (and Why)

- **React, Vue, Svelte, or a client-side router** -- the current service does not need framework
  state management, and a framework would add migration and accessibility risk without user value.
- **Runtime configuration in the first migration** -- it adds availability, authentication,
  publication, and rollback problems before the build-time editing model has been validated.
- **A GIS administration portal** -- premature until JSON editing proves inadequate.
- **A production API or application server** -- the lookup can remain a static application making
  read-only requests to public authoritative services.
- **ArcGIS API for Python in the browser request path** -- it belongs in GIS engineering and release
  tooling; adding a Python runtime would reduce the availability and simplicity of a static lookup.
- **Analytics or search logging** -- unnecessary for the migration and consequential for municipal
  privacy, notice, retention, and public trust.
- **Geospatial source upgrades** -- architecture migration and data-source migration require
  different evidence and reviewers and must remain separate.
- **A visual redesign or new lookup topics** -- would obscure behavioral parity and expand the
  accessibility review surface.
- **Autonomous merge or deployment** -- incompatible with accountable public determinations and
  separation of duties.

## Open Questions

- Which organization will own the eventual production repository, hosting account, custom domain,
  deployment credentials, and recovery access?
- Will the authoritative repository live in GitHub Enterprise, Azure Repos, or another approved
  municipal Git service?
- Who fills the code, GIS/data-owner, accessibility, privacy, records, and production-approver roles?
- What shortcomings, if any, would justify moving from Netlify, and what Azure or other environments
  would then be required?
- Which ArcGIS Online and Enterprise portals, organization IDs, authoritative-content categories,
  metadata style, service accounts, and credential rules are in scope?
- Which representative and boundary parcels form the permanent migration fixture set?
- Which approval and pipeline records must be retained, and for how long?
- What evidence is required before an automated process may move from issue creation to pull-request
  creation?

## ArcGIS References

- [ArcGIS API for Python overview](https://developers.arcgis.com/python/latest/guide/overview-of-the-arcgis-api-for-python/)
- [Searching and accessing content](https://developers.arcgis.com/python/latest/guide/accessing-and-creating-content/)
- [Metadata in ArcGIS Online](https://doc.arcgis.com/en/arcgis-online/manage-data/metadata.htm)
- [Configure item details and acknowledgements](https://doc.arcgis.com/en/arcgis-online/manage-data/configure-item-details.htm)
- [Edit item and layer metadata](https://doc.arcgis.com/en/arcgis-online/manage-data/edit-metadata.htm)

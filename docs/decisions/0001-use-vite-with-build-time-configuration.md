# ADR-0001: Use Vite with build-time municipal GIS configuration

## Status

Accepted for migration planning

## Date

2026-08-10

## Context

The application currently consists of two self-contained HTML pages. That structure made initial
deployment and GIS maintenance straightforward, but recent additions have produced duplicated
address, ArcGIS, accessibility, request, rendering, and styling behavior. The general property page
is also large enough that routine code review and targeted testing are becoming difficult.

Both developers and GIS staff must be able to maintain the application. Developers need focused
modules, fast local feedback, reusable behavior, and reliable CI/CD. GIS staff need an explicit,
validated surface for service URLs, layer indices, fields, labels, contacts, source ownership, and
review dates without editing application control flow.

The application serves a Utah municipality. Accessibility, privacy, records management,
geospatial provenance, human approval, reproducibility, and rollback are architectural constraints,
not optional operational additions.

## Decision

Migrate to a Vite multi-page static application using plain JavaScript.

- Keep `index.html` and `business-licensing.html` as separate public entry points.
- Extract common behavior and styles into shared source modules.
- Move declarative, GIS-maintainable values into strict build-time JSON configuration.
- Validate configuration with JSON Schema before tests or builds run.
- Keep browser lookups REST-first. Use ArcGIS API for Python as an optional, read-only-by-default
  engineering tool for portal discovery, metadata and lineage reports, schema validation, and
  before/after parcel comparisons across ArcGIS Online and ArcGIS Enterprise.
- Keep executable formatting, validation, accessibility, error-handling, and interpretation policy
  in application code.
- Generate one immutable static artifact in `dist/` and promote that same artifact through
  staging and production.
- Use Netlify for the current development and migration deployments. Keep repository, build, and CI
  definitions portable; defer Azure or other institutional production hosting until ownership and
  operating requirements are decided.
- Limit automated improvement to observable, auditable issue and pull-request proposals. Require
  designated human approval for source changes, merge, and production promotion.

The detailed migration scope and governance model are recorded in
[`docs/ideas/modular-municipal-geospatial-application.md`](../ideas/modular-municipal-geospatial-application.md).

## Alternatives Considered

### Native browser modules without a build

- Pros: Minimal tooling and direct deployment of source files.
- Cons: No strict build-time configuration boundary, asset hashing, artifact inspection, or clean
  distinction between authored source and deployed output.
- Rejected: It improves file size but does not fully address validation and release repeatability.

### Generated self-contained HTML pages

- Pros: Preserves portable one-file production pages.
- Cons: Requires custom inlining, makes built output harder to debug, and retains the deployment
  artifact shape that caused the maintenance problem.
- Rejected: It modularizes authoring at the cost of an unnecessary generation layer.

### Framework single-page application

- Pros: Mature component systems and development tooling.
- Cons: Adds runtime and migration complexity, client-side routing, dependencies, and accessibility
  regression risk without a corresponding resident-facing requirement.
- Rejected: Plain JavaScript modules are sufficient for two static lookup pages.

### Runtime-managed configuration

- Pros: GIS staff could publish source and content changes without rebuilding the application.
- Cons: Requires authenticated editing, drafts, validation, audit history, atomic publication,
  runtime availability, cache behavior, and rollback.
- Deferred: Reconsider only after build-time JSON has been used successfully and its limitations are
  observed rather than assumed.

### ArcGIS API for Python as an application backend

- Pros: Provides a rich ArcGIS object model and analysis toolsets.
- Cons: Adds a server runtime, credentials, scaling, patching, and another availability dependency
  to public read-only lookups that ArcGIS REST already serves directly.
- Rejected for the resident request path: Use it in controlled GIS engineering and release tools,
  where its portal inventory, metadata, analysis, and administration capabilities are valuable.

### Immediate Azure hosting migration

- Pros: Could align early with a future municipal Azure or Azure DevOps standard.
- Cons: Hosting ownership, support, domain, pipeline, procurement, recovery, and security
  requirements are not decided, while Netlify already supports the current migration work.
- Deferred: Modularize and validate the static artifact on Netlify first. A later platform decision
  should compare the same artifact and explicit institutional requirements.

### Azure Storage static website

- Pros: Low-cost static hosting and straightforward artifact upload.
- Cons: Static website hosting cannot directly configure the security headers the application
  requires; an additional CDN or Front Door rules layer would be necessary.
- Deferred: Storage plus an edge service remains an infrastructure option if future municipal
  standards require it; it is not needed for the current migration.

### Azure App Service

- Pros: Full web-server control and broad deployment support.
- Cons: Introduces a server runtime and operational surface that the static application does not
  need.
- Rejected for the current scope: Reconsider only if authenticated APIs or server-side processing
  become real requirements.

## Consequences

### Positive

- Developers can review and test focused modules rather than large embedded scripts.
- Both pages can share one implementation of high-risk request, address, and accessibility logic.
- GIS configuration becomes explicit, schema-validated, and independently reviewable.
- Inline scripts and styles can be removed, allowing a stricter Content Security Policy.
- CI can validate configuration, behavior, accessibility, the production build, and the exact
  artifact that is promoted.
- Hosting and repository choices remain replaceable because production output is static.
- ArcGIS staff can use the Python API for faster content discovery and evidence collection without
  coupling that heavyweight dependency to the public application.

### Negative

- Local development and every configuration change require Node.js and a build command.
- GIS staff need schema-aware JSON editing support and training.
- Vite and its transitive dependencies become development supply-chain responsibilities.
- Source files no longer match deployed files byte-for-byte; deployment checks must compare the
  built artifact rather than repository HTML.
- Migration must prove behavior and output parity before the original inline implementation is
  removed.

### Governance

- A newer-looking GIS layer is not an automatic upgrade. Source-owner approval and parcel-outcome
  comparison remain mandatory.
- ArcGIS item and layer metadata must identify authority, credits, terms, dates, and upstream
  lineage for derived products; metadata is review evidence, not self-approval.
- Automated tools may create issues or proposed pull requests but may not self-approve, merge, or
  deploy.
- Material UI changes require automated and assigned manual accessibility evidence.
- Tracking and telemetry remain disabled unless municipal privacy, notice, retention, and records
  requirements are addressed explicitly.
- The eventual production repository, hosting resources, domains, credentials, and recovery access
  must be owned institutionally rather than by an individual employee.

## References

- [ArcGIS API for Python overview](https://developers.arcgis.com/python/latest/guide/overview-of-the-arcgis-api-for-python/)
- [Accessing and searching ArcGIS content](https://developers.arcgis.com/python/latest/guide/accessing-and-creating-content/)
- [Metadata in ArcGIS Online](https://doc.arcgis.com/en/arcgis-online/manage-data/metadata.htm)
- [Configure ArcGIS item details](https://doc.arcgis.com/en/arcgis-online/manage-data/configure-item-details.htm)
- [Netlify configuration overview](https://docs.netlify.com/configure-builds/file-based-configuration/)
- [Azure Static Web Apps configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration)
- [Azure Storage static website hosting](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-static-website)
- [DOJ Title II web accessibility rule fact sheet](https://www.ada.gov/resources/2024-03-08-web-rule/)
- [Utah Government Data Privacy Act](https://le.utah.gov/xcode/Title63A/Chapter19/63A-19-S101.html)
- [Utah Division of Archives retention schedules](https://archives.utah.gov/records/retention-schedules/)

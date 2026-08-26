## What changed, and why

<!-- The change, and the problem it solves. If it fixes a defect, say what the
     defect actually did — a reviewer who understands the failure reviews better
     than one reading a summary of the fix. -->

## Evidence

<!-- Paste real output, not "tests pass". A reviewer should be able to see the
     numbers without checking out the branch. -->

- [ ] `npm ci` from a clean tree, `npm audit --audit-level=high` clean
- [ ] `npm test` — unit, Python, and browser/axe counts stated below
- [ ] `npm run build`
- [ ] Deterministic CI green on this branch

Counts:

## If this changes what the site serves

- [ ] `npm run build && DEPLOY_URL=<deploy preview> npm run check:deployment` — all gates
- [ ] `DEPLOY_URL=<deploy preview> npm run test:production` — both live flows, peak concurrency stated
- [ ] Any newly tolerated host transformation is declared in `scripts/deployment-content.mjs`
      with the date it was measured and the condition for removing it

## If this changes the lookup pages

- [ ] Keyboard reachable, and the status region still announces the outcome
- [ ] Reflow holds at 320 px with text at 200% and 400%
- [ ] The `SHARED REQUEST LAYER` region is still byte-identical across both pages
- [ ] Disclaimer wording under legal review is unchanged, or counsel has approved the change

## If this changes what residents are told

- [ ] No new claim the data cannot support — informational layers stay non-regulatory
- [ ] Nothing in a test, log, report, or CI artifact can carry resident data — owner names and
      mailing details come back from live parcel queries, and CI uploads artifacts publicly

## Anything a reviewer should push back on

<!-- Say it here rather than hoping nobody notices. A tolerated allowance, a
     measurement taken once, a judgement call made on the author's own authority. -->

# Reporting a security issue

This is a public service operated by Millcreek, Utah. It displays public records — parcel, zoning
and hazard information published by Millcreek, Salt Lake County and FEMA — and it holds no accounts,
no sessions and no resident-submitted data.

## How to report

Email **<bbusch@millcreekut.gov>** with `SECURITY` in the subject line.

Please include what you found, how to reproduce it, and what you think it lets someone do. If it is
sensitive, say so and we will arrange another channel before you send details.

**Do not open a public GitHub issue for a vulnerability.** This repository is public.

## What to expect

- **Acknowledgement within 3 business days.** If you do not hear back, the address may have failed;
  call Millcreek GIS on 801-214-2754 and ask for the property lookup maintainer.
- An assessment of severity, and what we intend to do about it.
- Credit in the changelog if you would like it, and none if you would rather not.

We do not operate a bounty programme.

> **A limitation worth stating plainly:** the address above reaches one person. Until this repository
> and its hosting move to institutional Millcreek ownership — readiness plan Task 11 — a report sent
> while that person is unavailable will wait. If your finding is urgent and unacknowledged, use the
> GIS phone number above rather than waiting on email.

## What is in scope

- The two lookup pages and the code in this repository.
- The deployment configuration here: security headers, the publish allowlist, redirects.
- Anything that would let a page served from this site mislead a resident about a property.

## What is not in scope, but is still worth telling us

- The upstream ArcGIS and FEMA services. We do not operate them, but we do depend on them, and we
  want to know — report to the operator as well.
- The accuracy of the underlying GIS data. That is a data question rather than a security one; send
  it to <gis@millcreekut.gov> and it will reach the right people faster.
- Findings that require an attacker to already control the resident's browser or machine.

## What we have already decided

These are deliberate, tested, and not findings:

- **All data is read-only and public.** The site issues no authenticated request and stores nothing
  about a visitor. There is no login to break.
- **A strict Content-Security-Policy** limits connections to the two authoritative service hosts.
  Both the policy and its delivery are asserted after every deploy by `npm run check:deployment`.
- **The publish directory is an allowlist.** No repository file becomes public by being committed,
  and the same post-deploy check proves it against the live site.
- **Owner names shown on the page are public Salt Lake County Assessor records.** That they appear
  is a policy decision by Millcreek rather than a leak. If you believe the policy is wrong, that is
  a legitimate concern and one for the records officer — say so and it will be routed there.

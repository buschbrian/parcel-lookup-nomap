# ADR-0001 migration: from two self-contained pages to a Vite build

**Status: step 1 executed and building. 13 August 2026.** Nothing has been extracted yet — that is
step 2.

### Step 1 result

`npm install` resolved **vite 7.3.6**, the entry pages moved to the repository root, and
`npm run build` succeeded. The important outcome:

> **`dist/index.html` and `dist/business-licensing.html` are byte-identical to their sources.**

That is exactly what step 1 was supposed to demonstrate. Both pages still carry a single plain
(non-module) `<script>`, which Vite passes through untouched, and the only asset reference —
`/assets/millcreek-logo.png` — is absolute, so it is served from `publicDir` rather than rewritten.
**The running application did not change.** The build is currently a verified pass-through, which is
the safest possible position from which to start extracting.

`dist/` contains exactly: both entry pages, `_headers`, and `assets/`. No Markdown, no `tests/`, no
`scripts/`, no `package.json`. `dist/assets/README.md` is present but was equally published before
the migration, so it is not a regression.

Because source and build are byte-identical, `scripts/check-deployment.mjs` passes whether it
compares against `dist/` or source — the migration cannot break the deployment check at this step.

**Two defects were found and fixed during execution:**

- `vite.config.mjs` used `__dirname`, which does not exist in ESM. The build would have crashed on
  first run.
- `tests/unit.test.mjs` read `public/index.html` with a hardcoded path, bypassing the dual-location
  resolver in `scripts/app-config.mjs`. The whole unit file failed to load after the move. It now
  reads through `readApp()` / `readBusinessApp()`, so it will not need changing again at the next
  structural step.

### Verified on Windows, 13 August 2026 — and it found a bug

**Both gaps below are now closed.** `npm install` resolved **vite 7.3.6**; `npm run build` succeeds;
`dist/index.html` and `dist/business-licensing.html` are byte-identical to their sources by SHA-256;
`dist/` contains only the two entries plus `_headers` and `assets/`; `dist/_headers` retains the full
CSP; the inline `<script>` is still present, so nothing has been bundled out of it yet.

| Gate | Result |
|:--|:--|
| `npm run build` | pass, pages byte-identical to source |
| `npm run test:unit` | 23 pass |
| `npm run test:python` | 4 pass |
| `npm run test:e2e` | **62 pass** — was 58 pass / 2 fail before the fix below |
| `npm run check:services` | 51/51 against live services |
| `npm run check:deployment` | **red, and structurally cannot pass** — see below |

The two e2e failures were **not** caused by this migration. They were the 400% reflow assertion
re-enabled on `main` earlier the same day, which had never been run in a real browser: the header logo
is sized in `rem` and reached 288 px inside a 320 px viewport. Fixed on `main` and merged forward; git
followed the `public/` → root renames without conflict. See CHANGES-2026-08-13.md §7.

That is the migration's first real dividend, incidentally — the branch is what caused the suite to be
run at all.

**`check:deployment` fails at `assert.equal(deployed, html)` for a pre-existing reason.** Netlify's
Pretty URLs post-processing rewrites `href="/business-licensing.html"` to `href='/business-licensing'`
in the deployed HTML, so the live bytes match no commit in the repository and byte-equality can never
hold while that setting is on. The risk named below — "if `dist/` is missing it falls back to source
and says so" — is real but is not what happened: the fallback line correctly printed `dist/`. The
assertions it aborts before reaching were verified by hand and pass: every security header on both
pages, and 17 repository paths confirmed unpublished.

**This matters more after the migration than before it.** Once Netlify publishes `dist/`, this check is
the only automated proof that the build produced what the repository intended and that the publish
allowlist still holds. **Repair it before switching the publish directory** — §7 of the changelog sets
out the two options and recommends turning Pretty URLs off, since `netlify.toml` already routes
`/business-licensing` explicitly.

**One more thing to know before step 2:** `dist/` was briefly committed on `main` in `28f7543` and
untracked again in `ca2a5b2`. It is ignored on both branches now. If it ever shows up in `git status`,
a build has been committed.

---

## Why migrate at all

Not for its own sake. The concrete cost is measurable: the 13 August accessibility round applied
**five CSS fixes by hand across two files** — three accessibility rules plus a reflow sizing set.
Every fix from here is duplicated manually, and a mistake in one copy is invisible until someone
tests that page specifically. One such mistake already happened: prose landed outside a CSS comment
in `business-licensing.html` and left an unmatched `*/`.

`el()` exists only on the property page. `pair()`, `flagPair()`, `parseAddress()`, `say()`,
`explain()` and `dialable()` exist in both, and only the `SHARED REQUEST LAYER` region is currently
guarded against drift.

---

## The order, smallest verifiable step first

Each step is independently revertible and independently testable. **Run `npm test` between every
step.** Do not batch them.

### Step 1 — introduce the build, move no application code ← *this commit*

Vite is added with both pages as entry points. No JavaScript is extracted, no CSS is moved. The
built pages should be functionally identical to the current ones; that is the whole point of doing
this first.

**Configuration already written:**

| File | Change |
|:--|:--|
| `vite.config.mjs` | new — MPA with both HTML files as entries, `minify: false`, output to `dist/` |
| `package.json` | `vite` devDependency, `dev`/`build`/`preview` scripts, `test:e2e` builds first |
| `netlify.toml` | `publish = "dist"`, `command = "npm run build"` |
| `playwright.config.mjs` | serves `dist/` instead of `public/` |
| `scripts/app-config.mjs` | resolves entry HTML from **either** location during the move |
| `scripts/check-deployment.mjs` | compares the deployment against `dist/` when built, source otherwise |
| `.gitignore` | `dist/` |

**The one action that is not in this commit** — the entry pages must leave `public/`:

```bash
git mv public/index.html index.html
git mv public/business-licensing.html business-licensing.html
```

**Why this move is mandatory.** Vite treats `publicDir` — which defaults to `public/` — as a
verbatim passthrough. Any entry HTML left inside it is copied unprocessed and **silently bypasses
the build**, which is the worst possible failure: everything appears to work while nothing is
actually built. `public/assets/` and `public/_headers` stay exactly where they are and continue to
be copied to `dist/` untouched.

**Then verify, in this order:**

```bash
npm install
npm run build          # dist/index.html and dist/business-licensing.html must exist
npm test               # 23 unit, 4 Python, ~58 browser/axe
```

Then confirm by hand, because these are the things a green suite will not tell you:

- [x] `dist/_headers` exists and still contains the full CSP. **Verified 13 August.**
- [x] `dist/assets/millcreek-logo.png` exists and resolves from `dist/`. **Verified** — the file is
      present and the browser suite, which serves `dist/`, fetched it at HTTP 200 on every page load.
      Not visually confirmed in `npm run preview`.
- [x] `dist/` contains no `tests/`, no `scripts/`, no `package.json`. **Verified** — contents are
      exactly both entry pages, `_headers`, `assets/millcreek-logo.png` and `assets/README.md`. Note
      that last one **is** a `.md`, so the check as originally written does not pass literally; it was
      equally published before the migration, so it is not a regression, but `public/assets/README.md`
      is worth removing or moving if the intent is a strictly Markdown-free artifact.
- [ ] Both pages perform a real lookup in `npm run preview`. **Not done.** The browser suite exercises
      `dist/` with mocked ArcGIS responses, which is not the same as one live lookup through the built
      artifact. `check:services` passing 51/51 covers the services themselves, so the untested seam is
      specifically built-page-to-live-service. **Do this before deploying.**
- [x] `dist/index.html` still contains the inline `<script>` — at step 1 nothing should be bundled
      out of it yet. **Verified**, and the built pages are byte-identical to source, which is the
      stronger form of the same claim.

Deploy only after all five pass — **four do; the live-lookup-in-preview check is still open.** Then run
`npm run check:deployment`, which will now compare against `dist/` — but see the verification note
above: that check cannot currently pass, and repairing it should come before the publish directory
changes.

> **Rollback:** revert the commit and the two `git mv`s. Netlify returns to publishing `public/`.
> Nothing about the application code has changed at this step, which is exactly why it goes first.

---

### Step 2 — extract the shared request layer

Already delimited by `/* ==== SHARED REQUEST LAYER ==== */` in both pages and already asserted
byte-identical by a unit test. That makes this mechanical: move the region to
`src/shared/request.mjs`, import it from both entries, and delete the byte-identity test — it exists
only to hold the copies together until this step removes the duplication it was guarding.

Requires converting the inline `<script>` to `<script type="module">`, which is the first real
behavioural change in the migration. Watch for: execution timing (modules are deferred), and `CFG`
needing to be reachable by the module.

### Step 3 — extract one function per commit

`pair()`, `flagPair()`, `parseAddress()`, `say()`, `explain()`, `dialable()`. One commit each, full
suite between each. Where the two copies differ, **the diff is the finding** — resolve it
deliberately and note it in the changelog rather than silently picking one.

### Step 4 — port `el()` to the licensing page

The licensing page has no `el()` and builds DOM by other means. This step makes both pages use the
same helper, and is the last one before the two pages genuinely share their rendering vocabulary.

### Step 5 — move `CFG` to build-time JSON with schema validation

The ADR's real goal: GIS staff edit validated JSON, not application control flow. Do this **last**.
It is the step that changes who can safely edit what, and it should land on a codebase that is
already deduplicated and green.

`scripts/app-config.mjs` reads `CFG` out of the inline script today; it will need rewriting here,
along with the unit tests that consume it.

---

## Risks worth naming

**The deployment check changes meaning.** It compared deployed bytes to repository bytes, which
worked only because `public/` was published verbatim. Vite rewrites entry HTML, so it now compares
against `dist/`. If `dist/` is missing it falls back to source and says so — read the line it
prints, because a silent fallback would let a broken build pass.

**`minify: false` is deliberate at step 1** and should stay off until step 2 has real module
entries. Minifying inline non-module scripts would rewrite working code this step is meant to leave
untouched.

**The `vite` version is `^7`,** chosen without network access to confirm the current release. If
`npm install` objects, pin whatever major is current and note it here.

**`"type": "module"` was added to `package.json`.** Every script in this repository is already
`.mjs`, so this should be inert — but if any tooling starts interpreting a `.js` file as ESM
unexpectedly, this is the cause.

**Netlify will now run a build.** The site currently deploys by copying files. After step 1 a failed
`npm run build` means a failed deploy. That is the intended trade — but it is a new failure mode on
a live public service, so watch the first deploy rather than assuming it.

---

## What this migration must not break

The properties below are load-bearing and each is covered by a test. If a step breaks one, stop and
fix it before continuing rather than adjusting the test.

- The publish directory is an **allowlist**. No repository file becomes public by being committed.
- Every security header in `public/_headers` reaches the deployed site.
- Both pages remain independently usable with the keyboard and a screen reader.
- The **four** accessibility fixes from 13 August survive: `overflow-wrap`, the programmatic focus
  outline, `aria-atomic` on the status regions, and the reflow sizing set — `fieldset`/`input`
  `min-width:0`, wrapping button labels, and the `.brand-logo` px caps. The logo caps are the easiest
  of these to mistake for cosmetic: without them, 400% text overflows a 320 px viewport by 32 px even
  with `flex-wrap` in force. Two rules set that cap, at two breakpoints; sabotaging one proves nothing.
- `CFG` stays editable by GIS staff without touching control flow — that is the point of step 5, and
  the reason it comes last rather than first.
- Disclaimer wording is under legal review. Three test assertions deliberately pin **short** phrases
  rather than full sentences for that reason — see the comments in `tests/unit.test.mjs` and
  `tests/app.spec.mjs`. Do not tighten them into full-clause matches during an extraction step.

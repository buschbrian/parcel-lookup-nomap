# Manual screen-reader and keyboard test script

**Purpose.** This is the final accessibility gate. Everything automatable is already covered by
`npm test` (23 unit, 4 Python, ~56 browser/axe). What remains are the checks no tool can perform:
whether a person using a screen reader actually receives the information, in a usable order, with
enough context to act on it.

**Until this script is run and signed, do not:**

- claim WCAG 2.1 AA conformance publicly,
- assert conformance in the accessibility statement, or
- cite this app as the alternative access in a §35.164 undue burden determination without noting
  that its own testing is incomplete.

**Time required:** about 60 minutes for both pages.
**Skill required:** none beyond following the steps. You do not need to be a screen-reader user.

---

## Setup

| Item | Detail |
|:--|:--|
| Screen reader | **NVDA** (free, Windows) — <https://www.nvaccess.org/download/> |
| Browser | Firefox or Chrome |
| Pages | `/index.html` and `/business-licensing.html` on the deployed site |
| Test address | `3300 East Santa Rosa Avenue` |
| Test parcel | `16264570030000` |
| A "Yes" case for CCOZ | `3398 S HIGHLAND DR` |

**Essential NVDA keys**

| Key | Action |
|:--|:--|
| <kbd>Ctrl</kbd> | **Stop speech** — the one to remember |
| <kbd>Insert</kbd>+<kbd>Down</kbd> | Read from here |
| <kbd>H</kbd> / <kbd>Shift</kbd>+<kbd>H</kbd> | Next / previous heading |
| <kbd>D</kbd> | Next landmark |
| <kbd>K</kbd> | Next link |
| <kbd>F</kbd> | Next form field |
| <kbd>Insert</kbd>+<kbd>F7</kbd> | Elements list (headings / links / landmarks) |
| <kbd>Tab</kbd> | Next focusable control |

Turn on **speech viewer** (NVDA menu → Tools → Speech Viewer) so you can read back what was spoken.
Copy anything surprising into the results table at the bottom.

> **Record what you hear, not what you expect to hear.** If a step's spoken output differs from the
> "Expected" column at all, write down the actual words. A near-miss is a finding.

---

## Part A — Keyboard only, no screen reader (10 min)

Close NVDA for this part. Use <kbd>Tab</kbd> only — **do not touch the mouse.**

| # | Step | Expected |
|:--|:--|:--|
| A1 | Load `/index.html`. Press <kbd>Tab</kbd> once. | A "Skip to main content" link **becomes visible** in the top-left. It is hidden until focused. |
| A2 | Press <kbd>Enter</kbd> on it. | Focus moves to the main region and **an outline is visible around it.** |
| A3 | <kbd>Tab</kbd> to the address box and type `3300 East Santa Rosa Avenue`. | A list of matches appears below. |
| A4 | Press <kbd>Down</kbd>. | One option is highlighted. The highlight is clearly distinguishable, not colour-only. |
| A5 | Press <kbd>Down</kbd> repeatedly past the last option. | Selection **wraps** to the first. |
| A6 | Press <kbd>Esc</kbd>. | The list closes. Focus stays in the address box. |
| A7 | Retype, <kbd>Down</kbd>, <kbd>Enter</kbd>. | Results load. **An outline is visible around the "Results for…" heading.** ← the 13 Aug fix |
| A8 | Keep pressing <kbd>Tab</kbd> through the whole page. | Focus is **always visible**, never jumps backwards, never disappears, never gets stuck. |
| A9 | <kbd>Tab</kbd> to "Copy results as text", press <kbd>Enter</kbd>. | Confirmation appears. Nothing is lost. |
| A10 | <kbd>Tab</kbd> to "Full disclaimer…", press <kbd>Enter</kbd>. | It expands. <kbd>Enter</kbd> again collapses it. |
| A11 | Zoom to **200%** (<kbd>Ctrl</kbd>+<kbd>+</kbd> ×4) and narrow the window to roughly a phone width. | **No horizontal scrollbar.** No text cut off. ← the 13 Aug fix |
| A12 | Repeat A1–A8 on `/business-licensing.html`. | Same behaviour. |

---

## Part B — Screen reader, the search (15 min)

Start NVDA. Load `/index.html`.

| # | Step | Expected |
|:--|:--|:--|
| B1 | <kbd>Insert</kbd>+<kbd>F7</kbd> → Headings. | A sensible outline: "Property Lookup" (level 1), then level 2s. Nothing empty or duplicated. |
| B2 | <kbd>Insert</kbd>+<kbd>F7</kbd> → Landmarks. | banner, main, content info. No unlabelled or repeated regions. |
| B3 | Press <kbd>F</kbd> to reach the address field. | Announced as a **combobox** with the name "Street address or parcel number". Not "edit", not "blank". |
| B4 | Listen for the hint. | The example and "type at least 3 characters" guidance is read, either with the field or on request. |
| B5 | Type `3300 East Santa`. | The **number of matches is announced** without you asking. |
| B6 | Press <kbd>Down</kbd>. | The **highlighted address is spoken**, and it is the one visually highlighted. |
| B7 | Press <kbd>Down</kbd> again. | The **new** address is spoken each time. Not silence, not the same one repeated. |
| B8 | Type `santa rosa` (no house number). | You hear that the search was **broadened** — words to the effect of "Showing addresses on that street" — *and* the count. |
| B9 | Type `zzzz nowhere`. | A **spoken** failure message including the advice to try house number + street, and a phone number. Not silence. |
| B10 | Type `16264570030000`. | You hear that it looks like a parcel number and to choose "Look up property". |
| B11 | Press <kbd>Esc</kbd> with the list open. | Collapse is conveyed. Focus stays in the field. |

> **B5–B8 are the most important steps in this script.** They are the whole reason the live region
> exists. If any of them is silent, that is a 4.1.3 failure and it blocks sign-off.

---

## Part C — Screen reader, the results (20 min)

Look up `3300 East Santa Rosa Avenue` and let it load.

| # | Step | Expected |
|:--|:--|:--|
| C1 | Listen immediately after it loads. | "Results ready" (or similar) is spoken, and you land on the **"Results for 3300 E SANTA ROSA AVE"** heading. You are not left at the top of the page hunting. |
| C2 | Press <kbd>H</kbd> repeatedly. | You move through Property record → Hazard and special designations → Zoning → Subdivision and plat → Natural hazards → Representation → Services → Location. |
| C3 | In Property record, read down with <kbd>Insert</kbd>+<kbd>Down</kbd>. | Each label is followed by its value: "Property address, 3300 E SANTA ROSA AVE", "Parcel number, 1 6 2 6 4…". **Labels and values must not run together into one stream you cannot separate.** |
| C4 | **Listen to how the parcel number is spoken.** | 14 digits. Digit-by-digit or in groups is fine; a single enormous number is acceptable but note what you hear. This is a known readability question, not a known defect. |
| C5 | Reach "Owners of record". | Announced as a **list of 2 items**, each ending "joint tenants" — not "jay tee". |
| C6 | Reach Hazard and special designations. | Each row spoken as **"…, No"** or **"…, Yes"** — the **word**, never a described symbol, never a colour, never silence. ← 1.4.1 |
| C7 | Look up a property that **is** flagged, then re-read. | "Yes" is spoken, **and** the plain-language "What this means" explanation is reachable and read. |
| C8 | Reach Services. | Every row identifies **whose** it is: "Culinary water — Phone", "Electrical — Phone". You should never hear a bare "Phone" and have to guess. ← the 6 Aug fix |
| C9 | Press <kbd>K</kbd> through the links. | Every link says what it is — "Rocky Mountain Power", "Recorded plat — EL SERRITO 2 (PDF, 2415 KB)". **No link says "here", "link", or reads a raw URL aloud.** ← 2.4.4 |
| C10 | Reach the "About this data" disclaimers. | Read as normal text, not skipped, not announced as a warning. |
| C11 | Reach the recorded plat row. | You hear it is a **PDF with its size**, and the explanation that it is a scanned drawing a screen reader cannot read, with the offer to have staff read it. |
| C12 | Activate "Copy results as text", then paste into Notepad. | Plain text, labels and values on their own lines, readable start to finish. |
| C13 | Look up `3398 S HIGHLAND DR`. | "In the City Center Overlay (CCOZ)" is spoken as **Yes**. |
| C14 | Turn off Wi-Fi, then search. | A spoken, comprehensible error naming the phone number. Not silence, not a raw error code. |

---

## Part D — Licensing page (10 min)

Repeat **B3–B9** and **C1–C2, C6, C8, C9** on `/business-licensing.html`.

| # | Step | Expected |
|:--|:--|:--|
| D1 | Trigger an unavailable data source if you can. | The row says **"Unknown"** in words, and the status message says a data source was unavailable. Never a silent blank. |
| D2 | Check the contact number offered on failure. | It is the **Planning** number for this page, not the GIS number. |

---

## Part E — One real user (optional, high value)

Thirty minutes with one screen-reader user is worth more than all of Parts B–D. Utah's Centers for
Independent Living are the nearest source, and their members use these services already. Pay them
for their time.

Ask them to do one thing, without coaching: **"Find out whether your property is in a flood zone."**
Then watch where they hesitate.

---

## Results

| Part | Tester | Date | Pass / Fail | Findings |
|:--|:--|:--|:--|:--|
| A — keyboard | | | | |
| B — search | | | | |
| C — results | | | | |
| D — licensing | | | | |
| E — user test | | | | |

**Sign-off.** All of A–D pass, findings recorded and either fixed or accepted in writing:

Name ............................ Role ............................ Date ....................

On sign-off, record it in the changelog, update the accessibility statement, and note the date in
any undue burden determination citing this app as alternative access.

---

## If you find something

1. Write down **the words you actually heard** and the step number.
2. Open an issue in this repository with both.
3. Anything in **B5–B8** or **C6** blocks sign-off. Everything else is triaged normally.

A finding is a good outcome. Three defects that this repository's 56 automated checks could not see
were found by exactly this kind of manual pass on 13 August 2026.

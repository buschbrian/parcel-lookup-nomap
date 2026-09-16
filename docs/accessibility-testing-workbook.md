# Accessibility testing workbook

**Who this is for.** Any Millcreek staff member or intern asked to accessibility-test a city web
application. You do not need to know what WCAG is, you do not need to have used a screen reader,
and you do not need to be able to code. If you can follow a numbered list and write down what you
hear, you can do this.

**What you are actually doing.** You are checking whether a resident who cannot see the screen, or
cannot use a mouse, can still get the information the page exists to provide. Automated tools
already check everything a tool can check. What is left is the part that needs a person: *did the
information actually arrive?*

**Time.** About 90 minutes the first time, including setup. About 60 minutes once you have done it
before.

**The single most important instruction:** when something does not match what this workbook says to
expect, **write down the words you actually heard**, not your interpretation of them. "It said
'blank'" is a useful bug report. "The heading seemed wrong" is not.

---

## Before you start

### You need a Windows machine

NVDA, the screen reader this workbook uses, runs on Windows only. It is free.

If you only have a Mac, you have two options:

- **Use VoiceOver instead** (built into macOS, <kbd>Cmd</kbd>+<kbd>F5</kbd> to toggle). The steps
  below still apply, but the keystrokes differ — see [Appendix: VoiceOver
  equivalents](#appendix-voiceover-equivalents). Findings are still valid and still worth
  recording. Note on the results sheet **which screen reader you used**, because a defect that
  appears in one and not the other is itself a finding.
- **Borrow a Windows machine** for the pass. Preferred, because NVDA + Firefox is the most common
  combination among screen-reader users, so it is the combination most likely to match a real
  resident's experience.

### Install NVDA (Windows only, ~5 minutes)

1. Go to <https://www.nvaccess.org/download/>.
2. Download and run the installer. Accept the defaults.
3. NVDA starts talking immediately. **This is normal and it is loud.**
4. **Learn this key first: <kbd>Ctrl</kbd> stops speech.** Press it any time NVDA will not stop
   talking. You will use it constantly and it is the difference between a calm session and a
   frustrating one.
5. To quit NVDA entirely: <kbd>Insert</kbd>+<kbd>Q</kbd>, then <kbd>Enter</kbd>.

> **If NVDA's voice is too fast to follow**, press <kbd>Insert</kbd>+<kbd>Ctrl</kbd>+<kbd>Left/Right
> arrow</kbd> to reach the speed setting, then <kbd>Up/Down</kbd> to change it. Slow it right down
> for your first pass. Nobody is timing you.

### Keys you will actually use

| Key | What it does |
|:--|:--|
| <kbd>Ctrl</kbd> | **Stop talking.** The one to remember. |
| <kbd>Tab</kbd> | Move to the next control |
| <kbd>Insert</kbd>+<kbd>Down</kbd> | Read everything from here down |
| <kbd>H</kbd> | Jump to the next heading |
| <kbd>K</kbd> | Jump to the next link |
| <kbd>F</kbd> | Jump to the next form field |
| <kbd>D</kbd> | Jump to the next landmark (banner, main, footer) |
| <kbd>Insert</kbd>+<kbd>F7</kbd> | Open a list of all headings / links / landmarks |
| <kbd>Insert</kbd>+<kbd>Q</kbd> | Quit NVDA |

---

## How to record what you find

Keep the results sheet open in a second window, or print it. For each step, you are recording one
of three outcomes:

| Mark | Meaning |
|:--|:--|
| **Pass** | It did what the "Expected" column says |
| **Fail** | It did not, and you wrote down what happened instead |
| **N/A** | The step could not be run (say why — e.g. no test data available) |

**A "Fail" is a good outcome.** It means the pass was worth doing. Three real defects that this
project's automated checks could not detect were found by exactly this kind of manual session on
13 August 2026. Nobody is graded on finding nothing.

### What makes a useful finding

> **Step C6.** Expected "Flood zone, No". Heard "Flood zone" then silence, about one second, then
> it moved on to the next row. Repeated three times, same result. Firefox 141, NVDA 2025.1.

That is actionable. Compare:

> **Step C6.** Hazard section seemed broken.

That is not. The difference is: the actual words, the step number, and whether it repeated.

---

## The test pass

The app-specific steps live in a separate script, because they change as the app changes:

**→ [`manual-screen-reader-test.md`](manual-screen-reader-test.md)** — the Property Lookup script.

Work through it in order. It has five parts:

| Part | What it covers | Screen reader on? |
|:--|:--|:--|
| A | Keyboard only — can you reach everything without a mouse? | **No** — close NVDA |
| B | The search — does the screen reader announce what is happening? | Yes |
| C | The results — does the information actually arrive? | Yes |
| D | The licensing page — same checks, second page | Yes |
| E | One real screen-reader user (optional, most valuable of all) | They bring their own |

**Parts B5–B8 and C6 are the ones that block sign-off.** Everything else is triaged normally. If one
of those fails, stop and report it rather than working around it — those steps exist because a
silent live region is invisible to automated testing and total for the resident.

---

## Sign-off

When A–D are complete:

1. Fill in the results table at the bottom of the app script — tester, date, pass/fail, findings.
2. Sign the line below it. **Sign for what you actually ran.** If you ran A–C but not D, write that.
   A partial pass honestly recorded is worth more than a complete one that is not true.
3. Note **which screen reader and browser** you used.
4. Open a GitHub issue for each finding, with the words you heard and the step number.
5. Tell the GIS Analyst the pass is done.

**What sign-off unlocks, and why it matters.** Until this is signed, the city cannot claim WCAG 2.1
AA conformance for the app, cannot assert conformance in its accessibility statement, and cannot
cite the app as the accessible alternative in an ADA §35.164 undue burden determination without
noting that its own testing is incomplete. Your signature is what moves those from "we believe" to
"we checked." Do not sign for a part you did not run.

---

## Reusing this workbook for other applications

This file is app-independent — everything above applies to any city web application. To test a
different app, write a new script alongside it, modelled on `manual-screen-reader-test.md`.

A usable script needs:

- **A Setup table**: the URLs, one test address or record, and any known "Yes" case needed to
  exercise a conditional result.
- **A keyboard-only part** (no screen reader): skip link, focus visibility, no keyboard traps, 200%
  zoom with no horizontal scrolling.
- **A search/input part**: is the field correctly named and typed, are results announced without
  being asked for, does failure speak.
- **A results part**: do labels stay attached to their values, is every Yes/No spoken as a word
  rather than a colour or an icon, does every link say where it goes.
- **A results table and sign-off line** at the end.

**Choose test data that is publicly owned.** Use a city-owned parcel, a municipal address, or
synthetic data — never a private resident's property. The test address appears in a public
repository, in issues, and in whatever the tester pastes into a bug report. This project learned
that the hard way: its worked example was a private residence with two named owners until
16 September 2026.

**Keep expectations checkable, not aspirational.** "Announced as a combobox named 'Street address or
parcel number'" can be marked pass or fail by someone who has never used a screen reader. "Works
well with assistive technology" cannot.

---

## Appendix: VoiceOver equivalents

For testing on a Mac. VO = <kbd>Ctrl</kbd>+<kbd>Option</kbd>, held together.

| NVDA | VoiceOver | Action |
|:--|:--|:--|
| <kbd>Ctrl</kbd> | <kbd>Ctrl</kbd> | Stop speech |
| <kbd>Insert</kbd>+<kbd>Down</kbd> | VO+<kbd>A</kbd> | Read from here |
| <kbd>H</kbd> | VO+<kbd>Cmd</kbd>+<kbd>H</kbd> | Next heading |
| <kbd>K</kbd> | VO+<kbd>Cmd</kbd>+<kbd>L</kbd> | Next link |
| <kbd>F</kbd> | VO+<kbd>Cmd</kbd>+<kbd>J</kbd> | Next form control |
| <kbd>Insert</kbd>+<kbd>F7</kbd> | VO+<kbd>U</kbd> | Open the rotor (headings, links, landmarks) |
| <kbd>Insert</kbd>+<kbd>Q</kbd> | <kbd>Cmd</kbd>+<kbd>F5</kbd> | Turn VoiceOver off |

Turn VoiceOver on and off with <kbd>Cmd</kbd>+<kbd>F5</kbd>. Safari is VoiceOver's best-supported
browser; use it unless the script says otherwise.

**One caution.** VoiceOver and NVDA genuinely differ in how they handle live regions — the
announcements in Part B. A step that passes in one can fail in the other, and that difference is a
real finding worth recording, not a testing mistake. Say on the results sheet which one you used.

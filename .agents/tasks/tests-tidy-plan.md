# Task 6 - tidy the Playwright e2e suite (pure restructuring)

Worktree (WT): `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\tests-tidy-1`
Main checkout (MAIN): `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty`
Artifacts: `MAIN\.agents\tasks\` (baseline list: `tests-tidy-list-before.txt`, gate file: `tests-tidy-review.json`).

All paths below are relative to WT unless stated. **Use WT absolute paths in every command** - a relative path from the wrong cwd lands in MAIN.

Constraints that apply to every item:

- The repo is on OneDrive. On `cloud file provider exited unexpectedly` (or `UNKNOWN`/EBUSY on read or write), wait a few seconds and retry; re-read the file after a write that errored.
- **Line endings.** Every file under `tests/` (checked: `composer.spec.js`, `pages.js`, `README.md`) is CRLF in the working tree (`core.autocrlf=true`, no `.gitattributes`, no BOM). New and edited files must be CRLF too. Do the splitting with a Node script that slices on `'\n'` (which keeps each line's `\r`) rather than retyping bodies. After writing, assert no bare LF: `/(?<!\r)\n/.test(text) === false` for every created/edited file.
- Polish characters are in titles and bodies (`kogoś`, `Dodaj prezent…`). Read/write as UTF-8 via Node; never round-trip through PowerShell `Get-Content`/`Set-Content` (the baseline list is visibly mangled that way, see `Ôû║`).
- Temporary scripts live in `$env:TEMP` and are deleted at the end. Nothing is added to the repo except the files listed here.
- Do not commit or push unless the build-loop/finalize prompt says so. Leave the changes in the working tree so the reviewer sees them with `git status` and `git diff HEAD`.
- Playwright runs can take minutes (`workers: 1`, composer tests have a 90 s timeout). Use `timeout` >= 900000 ms for suite runs and run them in the background if the host caps shorter.

## What I read (facts the plan rests on)

- `tests/e2e/composer.spec.js`: 1101 lines, 21 tests in 4 top-level describes. **No** `test.describe.configure`, no `serial`, no `beforeAll`/`afterAll`/`afterEach`, no `fixme`/`skip`, no `userAgent`/`isMobile`, **no `visualViewport` or iOS test at all** (grep confirmed). Every test opens its own page via `openComposer`; there is no module-level mutable state and no page shared between tests. So no test is forced to stay with another one; the only hidden coupling is the per-describe config below.
- Module-level, browser-evaluated functions (`START_SAMPLER`, `STOP_SAMPLER`, `STATE`, `PROBE_FOCUS`) are passed to `page.evaluate(fn)`, so they are serialised with `toString()`. They reference nothing outside themselves, so moving them to another module is safe **only if the text is moved verbatim** (do not wrap, rename or destructure them).
- Describe-level config actually in the file:
  - `add-present composer` (L334): `test.use({ hasTouch: true, viewport: { width: 375, height: 750 } })` (L336) and `test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(90000); })` (L343), with the OneDrive rationale comment L338-342. The 90 s timeout applies to all 17 tests of this describe and **only** to them.
  - `add-present composer with reduced motion` (L927): same `test.use`, **no** beforeEach (30 s default stays).
  - `add-present composer on desktop` (L982): `test.use({ viewport: { width: 1024, height: 800 } })` (no hasTouch), no hook.
  - `the shared dock on the other pages` (L1007): same touch `test.use` as the first, no hook; a `for (const descriptor of [HOME, RECIPIENTS])` loop generates 2 tests (`home: ...`, `recipients: ...`).
- `playwright.config.js`: `workers: 1`, `fullyParallel: false`, `timeout: 30000`, `testDir ./tests/e2e`. Files run alphabetically, so the five new `composer-*` files still sit between `chat-reactions` and `edit-sheet`. Tests are independent (route-mocked add path, no demo-state mutation), so intra-group order changing is harmless; I still keep original relative order inside each file.
- Existing spec naming: kebab-case topics (`chat-reactions`, `edit-sheet`, `no-horizontal-overflow`, `xss-usernames`). New names follow `composer-<behavior>.spec.js`.
- Baseline `tests-tidy-list-before.txt`: **132 tests in 11 files**; composer.spec.js contributes 21 (title path `add-present composer › ...`, `add-present composer with reduced motion › ...`, `add-present composer on desktop › ...`, `the shared dock on the other pages › home|recipients: ...`).
- `fixme` list = 11: `a11y.spec.js:68` is inside `for (const descriptor of PAGES)` (10 tests, one per page) + `edit-sheet.spec.js:179` (1). This number scales with `PAGES`.
- Environment: `WT\node_modules` exists. `WT\tests\.cache\cdn` does **not** (gitignored), `MAIN\tests\.cache` has 20 files. Copy it before running (item 0) so the run does not need internet.

## OUT OF SCOPE (restated)

No new tests. No fixing any of the 11 `fixme` tests. No change to what `PAGES` contains. No test-logic change (assertions, selectors, timeouts, waits, ordering of steps inside a test, describe/test titles). Nothing outside `tests/` (specs, helpers, README) - not `playwright.config.js`, `package.json`, `.gitignore`, `public/`, `server.js`, `.agents/`. The one allowed non-mechanical edit in a test body is none: bodies are copied byte-for-byte. `xss-usernames.spec.js` is not touched (Work Item B).

---

## WORK ITEM A - split `composer.spec.js`

### A.1 Mapping table (old line ranges -> new files)

Ranges are 1-based, inclusive, verified against the WT file. "Block" = from `    test(` to its closing `    });`.

| New file | Group | Describe (exact title) | Old line ranges (in original order) | Tests |
|---|---|---|---|---|
| `tests/e2e/composer-states.spec.js` | collapsed bar / add-mode states, entry-exit geometry, scrim | `add-present composer` | wrapper 334-344; blocks 345-407, 409-450, 452-531, 533-556, 753-778, 866-900; close `});` (old 925) | 6 |
| `tests/e2e/composer-input.spec.js` | typing, draft preservation, submit via keyboard, focus on entry | `add-present composer` | wrapper 334-344; blocks 780-815, 817-856, 858-864; close `});` | 3 |
| `tests/e2e/composer-dock.spec.js` | dock interaction, hide-on-scroll, scroll position, reduced motion | `add-present composer` + `add-present composer with reduced motion` | wrapper 334-344; blocks 558-590, 592-622, 624-643, 645-697, 699-712, 714-751; close `});`; then whole describe 927-980 | 6 + 1 |
| `tests/e2e/composer-layout.spec.js` | overflow at 320 px, textarea min-height, desktop card | `add-present composer` + `add-present composer on desktop` | wrapper 334-344; blocks 902-910, 912-924; close `});`; then whole describe 982-1005 | 2 + 1 |
| `tests/e2e/composer-shared-dock.spec.js` | the shared dock on `home` and `recipients` | `the shared dock on the other pages` | whole describe 1007-1101 (preceded by new `const HOME`/`const RECIPIENTS`, see A.3) | 2 |

Totals: 6 + 3 + 7 + 3 + 2 = **21**, same as the original. Old `composer.spec.js` is deleted (`git rm`) in the same item so no title exists twice. The baseline "11 files" becomes **15 files**; total stays **132**.

Per-test destination (for the reviewer):

| Old range | Test title (unchanged) | New file |
|---|---|---|
| 345-407 | the collapsed bar is [chevron] [full-width bordered input]: no submit, real controls unreachable | states |
| 409-450 | entering and leaving add mode keeps the name field's left edge in place | states |
| 452-531 | entering add mode swaps the decorative chevron for the real one without shifting the input's left edge or row | states |
| 533-556 | a tap anywhere on the collapsed row opens the form and focuses the name field | states |
| 558-590 | entering add mode from a scroll-hidden dock does not move the composer | dock |
| 592-622 | the composer and the dock hide as one unit, with no padding or scrollHeight churn | dock |
| 624-643 | one downward tick after a flick up changes the dock state exactly once | dock |
| 645-697 | hide-on-scroll is inert during add mode and recovers on exit from any scroll position | dock |
| 699-712 | entering add mode does not move the scroll position, including at the very bottom | dock |
| 714-751 | the last present and "Dodaj dla kogoś innego" stay reachable with the dock shown and hidden | dock |
| 753-778 | details open with the form, not on the first keystroke, and survive a manual collapse | states |
| 780-815 | no exit path clears typed text, and the collapsed bar cannot submit it | input |
| 817-856 | Enter and Ctrl+Enter add the present, then the composer blurs, collapses and the dock returns | input |
| 858-864 | the dock's "Dodaj" tab opens the composer and focuses the name field | input |
| 866-900 | the scrim tones the list down behind the open form, and is inert | states |
| 902-910 | the edit sheet's "Dodatkowe informacje" box is tall by default here too | layout |
| 912-924 | no horizontal overflow at 320px, collapsed or open | layout |
| 930-979 (describe 927-980) | the composer and the dock change state instantly | dock |
| 985-1004 (describe 982-1005) | the inline card is unchanged: visible "+", no collapsed state, no dock | layout |
| 1022-1100 loop (describe 1007-1101) | home / recipients: the shared dock behaves and nothing churns | shared-dock |

Notes on grouping: the requested "iOS/visualViewport" group does not exist - nothing in the file touches `visualViewport` or a UA override, so no file is created for it. "Keyboard & focus" is `composer-input` (the three tests whose subject is typing/Enter/Ctrl+Enter/focus). The dock group is the only consumer of the frame sampler.

### A.2 Per-file skeleton (what the script must emit)

For the four files that contain tests of the main describe (`states`, `input`, `dock`, `layout`), the describe wrapper is copied **verbatim** from old lines 334-344 (title, `test.use`, the OneDrive comment, `test.beforeEach(... setTimeout(90000))`, blank line). Do not shorten the comment, do not move the hook into a helper - the hook must stay inside each describe so it keeps applying to exactly the same tests. The reduced-motion, desktop and shared-dock describes are copied whole and get **no** hook.

```
'use strict';
/** new 3-6 line header: what this file covers; "shared setup lives in tests/helpers/composer.js" */
const { test, expect } = require('../fixtures');
<per-file requires, see A.3>

<verbatim wrapper 334-344>
<blocks, separated by one blank line, original order>
});            <- the describe close (old line 925)

<whole extra describes, if any, each preceded by one blank line>
```

Blank-line convention: single blank line between blocks, as in the original (each block is followed by an empty line in the old file).

### A.3 Shared helpers

Create two helper modules (single-purpose, same style as `tests/helpers/scroll.js`: `'use strict'`, JSDoc header, `module.exports = {...}`). Reuse existing helpers; do not duplicate them: `openPage`/`PAGES` from `helpers/pages`, `sampleScrollY`/`describeSamples` from `helpers/scroll`, `activeDescription`/`describeFocus` from `helpers/focus`, `collectOverflow`/`describeOverflow` from `helpers/overflow` stay imported from those modules by the specs that use them.

**`tests/helpers/composer.js`** (everything the old file defined at module level for page access and geometry):

| Export | Old lines (verbatim) | Consumed by |
|---|---|---|
| `FORMULARZ` | 36 | `openComposer` (inside helper); `composer-layout` (desktop test calls `openPage(page, FORMULARZ)`) |
| `COMPOSER`, `NAME`, `DESC`, `SUBMIT`, `TOGGLE`, `CLOSE`, `CUE`, `DOCK` | 40-47 | states: COMPOSER NAME DESC SUBMIT TOGGLE CLOSE; input: COMPOSER NAME DESC CLOSE DOCK; dock: COMPOSER DOCK; layout: COMPOSER DOCK. `CUE` is unused by any test (the specs use the literal `.quick-add-cue`); keep and export it anyway, do not delete or "fix" it |
| `PHONES` | 49 | states, dock |
| `openComposer(page, width, height)` | 208-216 (doc comment + function) | all four composer-describe files |
| `wheel(page, ticks, delta)` | 218-224 | dock, shared-dock |
| `scrollUntilDockHidden(page)` | 226-239 | dock |
| `STATE` | 241-320 (doc comment + function expression) | states, input, layout |
| `PROBE_FOCUS` | 322-332 | states |

Implementation: lines 208-332 are contiguous in the old file, so the script copies that range as one slice. The helper needs `const { expect } = require('../fixtures');` (used by `openComposer`) and `const { openPage } = require('./pages');`. The helper's JSDoc header takes the background text of the old header (old lines 2-29, the two user complaints and the "numbers in failure messages" note, including the "Replaces tests/e2e/composer.placeholder.spec.js." line) plus a paragraph explaining the 90 s `beforeEach` timeout is deliberately repeated in each composer describe.

**`tests/helpers/composer-sampler.js`** (the per-frame sampler; only `composer-dock` uses it):

| Export | Old lines (verbatim) | Consumed by |
|---|---|---|
| `startSampler(page)`, `stopSampler(page)`, `report(label, m)` | functions 158-166 and 195-202; also contains non-exported `START_SAMPLER` (58-137), `STOP_SAMPLER` (139-156), `derive` (168-193) | `composer-dock` |

Contiguous slice 58-202. Replace the old banner comment (51-56, which is outside the 58-202 slice; "Inline on purpose (tests/helpers/ belongs to the harness workflow)") with a header that says the sampler now lives in helpers because the harness work has landed; keep the rest of its description. This is a comment-only change.

Per-spec `require` lines (everything not listed is unused - verified by identifier scan of each block set):

- `composer-states`: `{ activeDescription, describeFocus }` from `../helpers/focus`; `{ COMPOSER, NAME, DESC, SUBMIT, TOGGLE, CLOSE, PHONES, STATE, PROBE_FOCUS, openComposer }` from `../helpers/composer`.
- `composer-input`: `{ activeDescription, describeFocus }` from focus; `{ COMPOSER, NAME, DESC, CLOSE, DOCK, STATE, openComposer }` from composer.
- `composer-dock`: `{ sampleScrollY, describeSamples }` from `../helpers/scroll`; `{ COMPOSER, DOCK, PHONES, openComposer, wheel, scrollUntilDockHidden }` from composer; `{ startSampler, stopSampler, report }` from `../helpers/composer-sampler`.
- `composer-layout`: `{ openPage }` from `../helpers/pages`; `{ collectOverflow, describeOverflow }` from `../helpers/overflow`; `{ FORMULARZ, COMPOSER, DOCK, STATE, openComposer }` from composer.
- `composer-shared-dock`: `{ PAGES, openPage }` from `../helpers/pages`; `{ wheel }` from composer; then locally `const HOME = PAGES.find(p => p.name === 'home');` and `const RECIPIENTS = PAGES.find(p => p.name === 'recipients');` (old lines 37-38 verbatim; these two are used nowhere else).
- The unused `setViewport` import (old line 31) is dropped; it was never called (the only hit was `setViewportSize`).

### A.4 Equivalence checks the implementer must run for A

1. **Byte-identity script** (`$env:TEMP\verify-split.js`, run from WT, deleted afterwards): read `git show HEAD:tests/e2e/composer.spec.js` as UTF-8, split on `\n`; for every range in the table above (including the wrapper 334-344, and whole describes 927-980, 982-1005, 1007-1101) assert the slice `old.slice(a-1,b).join('\n')` occurs in the designated new file; for helpers assert 36, 40-47, 49, 208-332 occur in `composer.js` and 58-202 in `composer-sampler.js`. Also assert that the new spec files together contain each test's `test(` line exactly once.
2. **Title preservation.** Capture `npx playwright test --list` after the change to `MAIN\.agents\tasks\tests-tidy-list-after.txt` (UTF-8) and compare normalised against the baseline (strip leading `file:line:col`, drop non-ASCII on both sides because the baseline was captured through a mangling pipe, sort):

   ```powershell
   $norm = { param($p) Get-Content $p -Encoding UTF8 | Where-Object { $_ -match '^\s+\S+\.spec\.js:\d+:\d+ ' } |
       ForEach-Object { ($_ -replace '^\s+\S+\.spec\.js:\d+:\d+\s+','') -replace '[^\x00-\x7F]','' } | Sort-Object }
   $b = & $norm "$MAIN\.agents\tasks\tests-tidy-list-before.txt"
   $a = & $norm "$MAIN\.agents\tasks\tests-tidy-list-after.txt"
   "before=$($b.Count) after=$($a.Count)"; Compare-Object $b $a   # expect: 132 / 132 and no output
   ```
   Also confirm the `Total:` line reads `132 tests in 15 files`. Use the same capture method as the baseline (`... 2>&1 | Out-File -Encoding utf8`).
3. **Execution.** `npx playwright test composer-` -> 21 tests, 0 failed (history says 21 passed / 0 skipped in `composer-plus-verification.md`). Compare with the pre-change run from item 0; if the pre-change run was not 21 green, record the difference and do not "fix" tests.

---

## WORK ITEM B - `xss-usernames.spec.js`: **leave as is**

Decision: **no split.** Reasons, from reading the whole file (654 lines, 9 describes, 24 listed tests):

- It is one subject with one contract (the header's "nothing executed / nothing created / name still displays" triple), driven by one payload set.
- The seam is not clean. `PAYLOADS`/`ELEMENT_PAYLOAD`/`ATTR_PAYLOAD`/`JS_PAYLOAD` are used by 7 of the 9 describes; `NASTY_NAME`/`NASTY_TITLE` by three; `APOSTROPHE_NAME` is declared mid-file (L438) between the dock describe and the `/recipients` describe and used by both; four helper functions (`noExecution`, `expectLiteralName`, `expectNoInjectedHandlers`, `cardFor`) plus `openIntroLeaderboard` are shared by almost every browser test. Any split first needs a new helper module holding ~8 constants and 5 functions, i.e. more moving parts than it removes.
- The only obviously separable block, the 4-test `escape-html.js (shared helper, no browser needed)` describe (L140-207, 68 lines), still needs the payload constants, so splitting it alone saves ~10% of the file and costs a helper module.
- No hidden inter-test state exists (no serial, no beforeAll), so a future split by page (leaderboard / intro / dock panel / handlers / osoby) is possible, but it is not low-risk enough for a "pure restructuring" task. Revisit if the file grows.

No edit to this file. Its 24 titles stay in `xss-usernames.spec.js` in the after-list.

---

## WORK ITEM C - comment block in `tests/helpers/pages.js`

Insert a comment block **immediately above `const PAGES = [`** (after the existing header docblock, before the `home.html` reload comment). Comment lines only; the `PAGES` array, `VIEWPORTS`, and all functions stay byte-identical. Verification: `git -P diff --numstat -- tests/helpers/pages.js` must show `0` deleted lines, and every added line starts with `//` or is blank.

Text to add (CRLF; adjust wording lightly if needed, but keep every fact):

```js
// ---------------------------------------------------------------------------
// HOW TO ADD A PAGE
//
// Append one object to PAGES below. Fields:
//   path        URL path (plus query) passed to page.goto. Relative to baseURL.
//   name        Short unique label. It becomes part of the TEST TITLE in every
//               spec that loops over PAGES (e.g. "ustawienia: page content is
//               reachable and announceable"), so renaming one renames tests.
//   ready       CSS selector that only exists once real data is on screen.
//               openPage waits for its first match to be attached, then for
//               fonts and for layout to stop moving. Pick something rendered
//               by the page's own fetch, never a static shell element.
//   reloadsOnce Optional. Set it only for a page that reloads itself once per
//               fresh profile (home.html does); openPage then navigates twice.
//
// Specs that consume PAGES (a new entry is automatically enlisted in all of them):
//   tests/e2e/a11y.spec.js                    two tests per page: page content
//                                             is reachable (runs) and every
//                                             icon-only control has a name (a
//                                             test.fixme today, so each page
//                                             adds one more known fixme)
//   tests/e2e/no-horizontal-overflow.spec.js  one test per page, at every width
//                                             in VIEWPORTS
//   tests/e2e/composer-shared-dock.spec.js    looks up 'home' and 'recipients'
//                                             by name via PAGES.find - do not
//                                             rename those two
//
// NOT driven by PAGES (they keep their own lists on purpose): smoke.spec.js
// (path + name only, and it also visits /formularz), the single-page specs
// (chat-reactions, edit-sheet, escaping, pluralization, wrapping,
// xss-usernames) and /intro.html, which is deliberately not here because
// listing it would enlist it in the a11y and overflow matrices.
// ---------------------------------------------------------------------------
```

Duplicate-array report (do not change unless identical in content):

- Hard-coded page **arrays**: `tests/e2e/smoke.spec.js:9-20` (own `PAGES`: no `ready`, different names such as `home (dashboard)`, and an extra `/formularz`) and `tests/e2e/xss-usernames.spec.js:430-433` (`DOCK_PAGES`: different `ready` selectors). **Neither is identical to `helpers/pages.js`; leave both.**
- Single hard-coded descriptors whose content equals a `PAGES` entry exactly: `ACTIVITY` (`escaping.spec.js:19`, `pluralization.spec.js:17`, `xss-usernames.spec.js:73`) and `LEADERBOARD` (`escaping.spec.js:20`, `pluralization.spec.js:16`, `wrapping.spec.js:66` inline). These are not arrays and replacing them with `PAGES.find(...)` buys nothing; leave. Others differ (`RECIPIENTS` uses `.present-title, .present-name`, `THREAD` is named `chat thread`, the xss `LEADERBOARD`/`OSOBY` use different `ready` selectors).
- The implementer repeats this list in the final report.

---

## WORK ITEM D - `tests/README.md`

`tests/README.md` already exists (143 lines, CRLF) and already covers run/headed/ui/debug, server boot via `global-setup.js`, the CDN cache, helpers and honest limits. **Edit in place; do not rewrite.** Changes:

1. **Run it**: add `npm run test:e2e -- composer` (runs the five composer-* files) and `npm run test:e2e -- composer-dock` as one-spec examples; add `npx playwright test --list` as "see what would run". State where output goes: HTML report `tests/.report/index.html` (`npm run test:e2e:report`), traces and failure screenshots `tests/.results/`. (The current text only mentions `.results`.)
2. **How the server gets started**: keep; it is accurate. No change except if a line contradicts `global-setup.js` after re-reading it.
3. **CDN cache**: keep the existing section; add one sentence that the very first run on a new checkout or worktree needs internet because `tests/.cache/cdn/` is gitignored, and that copying that folder from another checkout avoids it.
4. **New section "Spec files"** (one line each, 15 files, alphabetical):
   `a11y` (a11y smoke over PAGES; holds 10 of the fixmes) · `chat-reactions` · `composer-dock` (dock hide-on-scroll, add-mode entry from a hidden dock, scroll position, reduced motion) · `composer-input` (draft preservation, Enter/Ctrl+Enter, "Dodaj" tab focus) · `composer-layout` (320 px overflow, textarea height, desktop inline card) · `composer-shared-dock` (the same dock behaviour on home and recipients) · `composer-states` (collapsed bar, add-mode swap, details row, scrim) · `edit-sheet` (holds the 11th fixme) · `escaping` · `helpers` (self-test of the detectors) · `no-horizontal-overflow` (PAGES x VIEWPORTS) · `pluralization` · `smoke` (harness check, own page list) · `wrapping` · `xss-usernames`.
   Add: composer specs share `tests/helpers/composer.js` (selectors, `openComposer`, `STATE`, ...) and `tests/helpers/composer-sampler.js` (per-frame sampler).
5. **Helpers table**: add rows for `helpers/composer.js` and `helpers/composer-sampler.js`; fix the `helpers/scroll.js` row if needed (it is used by `composer-dock` now).
6. **New section "Adding a page"**: point to the `HOW TO ADD A PAGE` comment in `helpers/pages.js`; summarise the four fields and the three consumers; warn that each new page adds one a11y fixme and 6 viewport measurements, and that `smoke.spec.js` has its own list that must be edited separately.
7. **Known fixme list of 11**: new subsection (or extend "Known product bugs"): 10 × `a11y.spec.js` `<page>: EVERY icon-only control including the dock has a name` (one per `PAGES` entry, so the count grows with `PAGES`) + 1 × `edit-sheet.spec.js` `closing the sheet returns focus to its trigger`. Map them to the two causes already in the table. Say they are skipped, not failing, and are not to be fixed by test-tidying work.
8. **Fix stale text**: replace the last "Honest limits" bullet ("The add-present composer and the dock are not covered yet. See `tests/e2e/composer.placeholder.spec.js`") with a sentence that the composer and dock are covered by `composer-*` specs and what is still not covered (real iOS `visualViewport`, on-screen keyboard - already in the "One engine" bullet). Leave the unrelated `page.waitForTimeout` rule untouched (composer specs use it; fixing that is out of scope).
9. Also in `tests/helpers/scroll.js`: the header comment says it is kept for in-flight work "see tests/e2e/composer.placeholder.spec.js; no shipped spec depends on it yet" - both clauses are stale. Rewrite those two comment lines only (e.g. "Used by tests/e2e/composer-dock.spec.js."). No code change.
10. Verification of D: every `tests/e2e/*.spec.js` filename appears in the README (script loop), the string `placeholder` no longer appears in README or `scroll.js`, no bare LF.

---

# Implementation Plan

- [ ] 0. Prerequisites and pre-change baseline.
      Copy the CDN cache so runs do not need internet: `Copy-Item -Recurse -Force "<MAIN>\tests\.cache" "<WT>\tests\.cache"` (gitignored). In WT run `npx playwright test composer.spec.js` and record passed/failed/skipped (expected 21 passed); also `npx playwright test --list` to confirm "132 tests in 11 files". Save nothing in the repo.
      Files: none (gitignored cache only).
      Verify: the composer.spec.js run finishes; counts are written down for the final report.

- [ ] 1. Extract the composer helpers (old spec still intact and still green).
      Create `tests/helpers/composer.js` and `tests/helpers/composer-sampler.js` exactly as in A.3 using a Node script that copies the old line slices verbatim; CRLF; exports as tabled. Do not touch `composer.spec.js` yet.
      Files: `tests/helpers/composer.js`, `tests/helpers/composer-sampler.js`.
      Verify: `node --check` on both; `node -e "require('./tests/helpers/composer'); require('./tests/helpers/composer-sampler')"` from WT loads without error and exports the names in A.3 (the helper requires `../fixtures`, which only needs `@playwright/test` at import time); `npx playwright test --list` still reports 132 tests in 11 files.

- [ ] 2. Split `composer.spec.js` into the five composer-* specs and delete the original.
      Run the generator script for A.1/A.2 (requires per A.3), write the five files with CRLF, `git rm tests/e2e/composer.spec.js`. Bodies copied byte-for-byte; no title, describe nesting, `test.use`, or hook changed.
      Files: `tests/e2e/composer-states.spec.js`, `composer-input.spec.js`, `composer-dock.spec.js`, `composer-layout.spec.js`, `composer-shared-dock.spec.js`; delete `tests/e2e/composer.spec.js`.
      Depends on: item 1.
      Verify: (a) `node --check` on each new file; (b) the byte-identity script from A.4 passes; (c) `--list` compare from A.4 prints no differences and `Total: 132 tests in 15 files`; (d) `npx playwright test composer-` -> 21 passed, 0 failed (same as item 0).

- [ ] 3. Add the HOW TO ADD A PAGE comment block to `tests/helpers/pages.js` (Work Item C).
      Comment lines only, above `const PAGES = [`. Do not alter PAGES, VIEWPORTS or any function. Report the duplicate-array findings in the final report without editing any spec.
      Files: `tests/helpers/pages.js`.
      Verify: `git -P diff --numstat -- tests/helpers/pages.js` shows 0 deletions; `node -e "const p=require('./tests/helpers/pages'); console.log(p.PAGES.length, JSON.stringify(p.PAGES).length)"` prints the same two numbers as for `git show HEAD:tests/helpers/pages.js` loaded the same way (10 pages); `npx playwright test a11y no-horizontal-overflow --grep "osoby"` passes (the fixme one reports skipped).

- [ ] 4. Update `tests/README.md` and the stale comment in `tests/helpers/scroll.js` (Work Item D).
      Apply D.1-D.10 in place. Keep CRLF.
      Files: `tests/README.md`, `tests/helpers/scroll.js` (two comment lines).
      Depends on: items 2 and 3 (README names the final spec files and the pages.js comment).
      Verify: PowerShell loop over `tests\e2e\*.spec.js` shows each file name present in `tests\README.md`; `Select-String -Path tests\README.md,tests\helpers\scroll.js -Pattern placeholder` returns nothing; `node --check tests/helpers/scroll.js`; no bare LF in either file.

- [ ] 5. Full-suite confirmation and cleanup.
      Run `npm test` in WT (full suite, headless Edge). Expected: 0 failed, 11 skipped (the fixmes), the remaining 121 passed, `132 tests in 15 files`. If something fails that also fails on a `git stash`-free comparison (i.e. was red before: check with the item 0 numbers or by re-running that spec on `git show HEAD` content in a scratch copy), report it as pre-existing and do not fix it. Re-run `--list` and the title compare one last time. Delete `$env:TEMP` scripts and `tests-tidy-list-after.txt` is left in MAIN\.agents\tasks (it is an artifact, not repo content). Run `git -P status --short` in WT and confirm the only changes are: 5 new specs, 2 new helpers, deleted `composer.spec.js`, modified `pages.js`, `scroll.js`, `README.md`, and nothing outside `tests/`.
      Files: none.
      Verify: `npm test` exit code and summary line as above; `git -P status --short` matches the list.

## Assumptions

- A new helper module may `require('../fixtures')` for `expect`; this is how `fixtures.js` already exports it (`base.expect`) and there is no import cycle (`fixtures` only requires `helpers/cdn-cache`).
- Keeping `CUE` and the 90 s `beforeEach` duplication is deliberate: removing either would be a (tiny) logic or config change, which this task forbids.
- If a reviewer prefers fewer files, `composer-input` can be merged into `composer-states` (adds 83 lines) without any other change; I chose separate files to keep each under ~300 lines.
- I did not restructure the remaining workflow steps: the work is one tightly coupled refactor plus two small doc edits, and I cannot see the existing build-loop/finalize prompts, so replacing them risked losing their behaviour. The gate file stays `MAIN\.agents\tasks\tests-tidy-review.json` (`verdict` = `APPROVED`), written by the reviewer as the loop's last step.

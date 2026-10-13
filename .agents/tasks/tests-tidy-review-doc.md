# Split of the composer e2e spec by behavior (task 6, pure restructuring)

`tests/e2e/composer.spec.js` (21 tests, 4 top-level describes) is split into five `composer-*` specs. The module-level helpers move to `tests/helpers/composer.js` and `tests/helpers/composer-sampler.js`. `pages.js` gains a comment block, `tests/README.md` is updated, and two stale comment lines in `scroll.js` are rewritten. Nothing outside `tests/` is touched. The test list is identical to the baseline (132 tests, same titles), and each new spec passes on its own. Reviewed range: `main...chore/tests-tidy-1`, one commit (`d681bf4`).

Watch for: nothing blocking. The only wrinkle is that the verification doc describes the changes as uncommitted, while the branch has one commit (confirmed, cosmetic).

**Verdict**: APPROVED

## High-level view

The split is mechanical. I compared old and new code as multisets of trimmed non-blank lines. Every executable line of the old spec appears in the new files at least as often as before. The additions are file headers, `require` lines, `module.exports`, and the repeated describe wrapper. The only old lines missing are the `setViewport` import (never called), the old helper section banner, and the old sampler banner comment.

The per-describe configuration is preserved. The touch `test.use` and the 90 s `beforeEach` are repeated verbatim in each of the four files that hold tests from the main describe (states, input, dock, layout). The reduced-motion, desktop, and shared-dock describes are copied whole. The 90 s hook still applies to the same 17 tests and to nothing else.

Tests do not depend on each other. The old file had no serial mode, no `beforeAll`/`afterAll`/`afterEach`, no module-level mutable state, and no fixme or skip. There was therefore no hidden state to keep together. The only module-level state is the page-evaluated functions, which moved verbatim.

Scope is clean. `PAGES` is byte-identical (`pages.js` diff is +33/-0, all comment lines). No fixme test file was touched. No `public/`, `server.js`, `routes/`, `lib/`, `package.json`, or `playwright.config.js` change. No live reference to `composer.spec.js` remains.

<details>
<summary>Issues (2, both non-blocking)</summary>

1. **Verification doc says changes are uncommitted** (confirmed) — the branch carries commit `d681bf4` and the worktree is clean. No action needed beyond making the finalize step aware of it.
2. **Historic "Replaces tests/e2e/composer.placeholder.spec.js." line in `helpers/composer.js:32`** (confirmed) — it is a history note, not a live reference, and the plan (A.3) says to keep it. Optional to drop later.

</details>

<details>
<summary>Details</summary>

### Normalized-body comparison

I compared `git show main:tests/e2e/composer.spec.js` against the concatenation of the five new specs and the two helpers. I stripped `\r` and leading/trailing whitespace, dropped blank lines, and compared multisets (1016 old lines vs 1127 new).

The old-only lines were:
- the `const { PAGES, openPage, setViewport } = require('../helpers/pages')` import, replaced by narrower imports. `setViewport` was never called, so dropping it has no behavioral effect.
- the old file-header docblock line "The add-present composer on /formularz, and its relationship with the", which is reproduced in the new `composer.js` header.
- the "Page helpers" section banner.
- the old "Per-frame sampler. Inline on purpose ..." banner (the plan permits rewriting this comment).
- four `// ----` section divider comment lines from the old helper/sampler sections.

The new-only lines were:
- six `'use strict'` lines and six JSDoc headers.
- the new `require` lines.
- `module.exports` blocks.
- three extra copies of the `describe('add-present composer')` wrapper (`test.use`, comment, `beforeEach`, closing `});`), giving four in total across states, input, dock, and layout.

No assertion, selector, timeout, wait, or step ordering appears in either list. The `STATE`, `PROBE_FOCUS`, `START_SAMPLER` and `STOP_SAMPLER` bodies, which are serialised by `page.evaluate`, moved intact. Their header comments only describe self-containment.

### Per-describe configuration

A grep of `test.describe`, `test.use`, `beforeEach`, `setTimeout`, `fixme` and `skip` across the old file and the new specs shows the following.

Describes and titles:
- `add-present composer` appears in states, input, dock, and layout with the exact title.
- `add-present composer with reduced motion` is in dock with the touch `test.use` and no hook.
- `add-present composer on desktop` is in layout with the 1024x800 `test.use` and no hook.
- `the shared dock on the other pages` is in shared-dock with the touch `test.use` and no hook. It keeps the `for (const descriptor of [HOME, RECIPIENTS])` loop, which still generates `home: ...` and `recipients: ...`.

Config and annotations:
- There is no `serial`, `parallel`, `beforeAll`, `afterEach`, `fixme`, or `skip` in the old or new files, so none was lost.
- `HOME` and `RECIPIENTS` are now defined locally in shared-dock via `PAGES.find`, as in the old file. `FORMULARZ`, the selector constants, and `PHONES` are exported from `composer.js`.

### Test-list identity

I ran `npx playwright test --list` in the worktree and compared against `tests-tidy-list-before.txt`. I stripped `file:line:col`, dropped non-ASCII characters on both sides (the baseline was captured through a mangling pipe), and sorted. Both sides have 132 entries, `Compare-Object` returns nothing, and the footer reads `Total: 132 tests in 15 files`.

### Isolation runs

Each spec was run with `npm run test:e2e -- <name>` in the worktree:

| Spec | Result |
|---|---|
| composer-states | 6 passed |
| composer-input | 3 passed |
| composer-dock | 7 passed |
| composer-layout | 3 passed |
| composer-shared-dock | 2 passed |

That adds up to 21, the same as the old file. I did not re-run the full suite. The verification doc records a full `npm test` run of 121 passed, 11 skipped, 0 failed, matching the expected fixme count (10 in `a11y.spec.js:68` plus 1 in `edit-sheet.spec.js:179`). Neither of those files is in the diff.

### Scope and references

- `git diff --name-status` lists only `tests/` files: README, five new specs, two new helpers, `composer.spec.js` deleted, `pages.js` and `scroll.js` modified.
- The grep of the tree outside `.agents/` for `composer.spec` finds nothing. The only `composer.placeholder` hit is the historic note above. `package.json` scripts and `playwright.config.js` have no reference, and the config uses only `testDir`.
- `pages.js` is +33/-0, comment only. `scroll.js` is a two-line comment rewrite with no code change.
- README spec list covers all 15 spec files. The `tests/.report` claim matches `playwright.config.js` (`outputFolder: 'tests/.report'`) and the `test:e2e:report` script. The fixme counts and locations match the code.
- No bare LF in any created or edited file; all are CRLF-consistent.

### What I ran

The full `--list` comparison, every new spec in isolation, and the line-multiset comparison. I did not run the full suite; the coder's 121/0/11 evidence is in the verification doc.

</details>

<details>
<summary>File map</summary>

- `tests/e2e/composer-states.spec.js`: 6 tests, collapsed bar, add-mode swap, details row, scrim
- `tests/e2e/composer-input.spec.js`: 3 tests, draft preservation, Enter/Ctrl+Enter, "Dodaj" tab
- `tests/e2e/composer-dock.spec.js`: 6 + 1 reduced-motion tests, dock and scroll behavior
- `tests/e2e/composer-layout.spec.js`: 2 + 1 desktop tests, overflow, textarea, inline card
- `tests/e2e/composer-shared-dock.spec.js`: 2 tests, dock on home and recipients
- `tests/e2e/composer.spec.js`: deleted
- `tests/helpers/composer.js`: new, selectors, `openComposer`, wheel helpers, `STATE`, `PROBE_FOCUS`
- `tests/helpers/composer-sampler.js`: new, per-frame sampler
- `tests/helpers/pages.js`: comment block only
- `tests/helpers/scroll.js`: two stale comment lines
- `tests/README.md`: spec list, run/report notes, adding a page, fixme list, stale limits bullet

Full diff: `git diff main...chore/tests-tidy-1`.

</details>

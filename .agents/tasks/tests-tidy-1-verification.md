# Task 6 verification - tests tidy (iteration 1)

Worktree: `.worktrees\tests-tidy-1` (branch `chore/tests-tidy-1`). No `tests-tidy-review.json` existed, so this is the FIRST iteration.

## What changed
- `tests/e2e/composer.spec.js` (21 tests) removed with `git rm`; split into `composer-states` (6), `composer-input` (3), `composer-dock` (6 + 1 reduced-motion), `composer-layout` (2 + 1 desktop), `composer-shared-dock` (2). Wrapper (title, `test.use`, OneDrive comment, 90 s `beforeEach`) repeated verbatim in each of the four files containing the main describe; reduced-motion / desktop / shared-dock describes copied whole.
- New helpers `tests/helpers/composer.js` (old lines 36, 40-47, 49, 208-332) and `tests/helpers/composer-sampler.js` (old lines 58-202), both copied verbatim by a Node script that sliced on `\n` (CRLF preserved).
- `tests/helpers/pages.js`: comment block only (+33 / -0, `PAGES` unchanged: 10 entries, same JSON length 779 before and after).
- `tests/helpers/scroll.js`: two stale comment lines rewritten. `tests/README.md`: updated per plan D.
- `xss-usernames.spec.js` untouched (plan decision B). No live reference to `composer.spec.js` existed in `playwright.config.js`, `package.json` or README (config has only `testDir`). The only remaining mention of `composer.placeholder.spec.js` is the historic "Replaces ..." line carried over in the `composer.js` header (plan A.3 says to keep it).
- Dropped the unused `setViewport` import (never called).

## 1. Byte-identity check (Node script, deleted afterwards)
Read `git show HEAD:tests/e2e/composer.spec.js` (normalised to CRLF, since the index holds LF and the working tree CRLF), sliced by the plan's line ranges and asserted each slice occurs in the designated new file, in original relative order. Also: every old `test(` line occurs exactly once across the new specs (20 `test(` lines = 19 + the loop generating 2 = 21 tests); every non-blank old line in 345-1101 is covered by a range; helper slices present; imports vs identifier use scan; no bare LF in any new file.
Result: `83 checks, 0 failures`.

## 2. `npx playwright test --list` comparison
Command: `npx playwright test --list 2>&1 | Out-File -Encoding utf8 ...\tests-tidy-list-after.txt`.
Last line: `Total: 132 tests in 15 files` (baseline: `132 tests in 11 files`).
Diff method: keep lines matching `^\s+\S+\.spec\.js:\d+:\d+ `, strip the `file:line:col` prefix, drop non-ASCII characters on both sides (baseline was captured through a mangling pipe), sort, `Compare-Object` (counts duplicates).
Result: `before=132 after=132`, `diff entries: 0`.

## 3. Execution
- Pre-change baseline (`npx playwright test composer.spec.js`): **21 passed**.
- Full suite after the change, `npm test` in the worktree: **121 passed, 11 skipped, 0 failed** (8.3 min).
- Each new spec alone via `npm run test:e2e -- <name>` (all exit 0):

| Spec | Result |
|---|---|
| composer-states | 6 passed |
| composer-input | 3 passed |
| composer-dock | 7 passed |
| composer-layout | 3 passed |
| composer-shared-dock | 2 passed |

6 + 3 + 7 + 3 + 2 = 21, matching the original file. No flakes or retries observed.

## 4. git status (worktree)
```
 M tests/README.md
D  tests/e2e/composer.spec.js
 M tests/helpers/pages.js
 M tests/helpers/scroll.js
?? tests/e2e/composer-{dock,input,layout,shared-dock,states}.spec.js
?? tests/helpers/composer-sampler.js
?? tests/helpers/composer.js
```
(`tests/.cache/` copied from the main checkout is gitignored.) Nothing outside `tests/`.

## Duplicate page arrays (report only, nothing changed)
- `smoke.spec.js:9-20` own `PAGES` and `xss-usernames.spec.js:430-433` `DOCK_PAGES` differ in content from `helpers/pages.js`; left alone.
- `ACTIVITY` (`escaping`, `pluralization`, `xss-usernames`) and `LEADERBOARD` (`escaping`, `pluralization`, `wrapping`) are single descriptors equal to a `PAGES` entry; left alone.

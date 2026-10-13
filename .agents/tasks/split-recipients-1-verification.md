# Verification: split `public/recipients.js` into 11 classic scripts (task 4, iteration 1)

Worktree `.worktrees/split-recipients-1`, branch `refactor/split-recipients-1`, base `bc8be84` (= `main`). Nothing pushed.
Commits: `20787c8` refactor (11 new files, 2 HTML tag swaps, `recipients.js` removed), `c610328` chore (`sw.js`), plus this document.

## 1. File map (original line ranges, contiguous, original order, no header lines)

| Load # | New file (`public/`) | Original lines | Lines | Bytes (CRLF tree) |
|---|---|---|---|---|
| 1 | `recipients-core.js` | 1-578 | 578 | 20,158 |
| 2 | `recipients-startup.js` | 579-887 | 309 | 14,577 |
| 3 | `recipients-list.js` | 888-1337 | 450 | 26,382 |
| 4 | `recipients-identify.js` | 1338-1823 | 486 | 19,731 |
| 5 | `recipients-present-actions.js` | 1824-2297 | 474 | 20,016 |
| 6 | `recipients-helpers.js` | 2298-2518 | 221 | 8,925 |
| 7 | `recipients-modals.js` | 2519-3104 | 586 | 24,411 |
| 8 | `recipients-optimistic.js` | 3105-3420 | 316 | 13,363 |
| 9 | `recipients-edit.js` | 3421-3863 | 443 | 17,533 |
| 10 | `recipients-sync.js` | 3864-4371 | 508 | 21,741 |
| 11 | `recipients-toast-undo.js` | 4372-4706 | 335 | 13,817 |
| | **Total** | 1-4706 | **4,706** | **200,654** |

Largest file is 586 lines (cap ~800). Cut with a byte-level Node splitter (split on `0x0A`, refused to run unless the input sha256 matched, `wx` flag so nothing could be overwritten, read-back compared).

## 2. Byte proof: PASS

Temporary script `tmp-split-concat.js` (outside `tests/`, deleted afterwards). It concatenates the 11 files in load order and compares with `git show main:public/recipients.js`. Output saved in `.agents/tasks/split-recipients-baseline/byte-proof-{worktree,index,git-HEAD}.txt` (untracked evidence, in the main checkout's `.agents/tasks/`).

| Form | Result |
|---|---|
| Working tree, CRLF, vs saved original | PASS, 200,654 B, sha256 `ceae7774b1814c03ed4b022243693a2495131a0e0d917f6bf97557b0e4712149` |
| Line endings normalised, vs `main:public/recipients.js` | PASS, 195,948 B, sha256 `e0ccba3a2097b354f0ab3996b342d77ee088f7c8a1d50620f15424483fc65167` |
| Staged blobs (`:public/...`) raw vs original blob | PASS, same sha256 |
| Committed blobs (`HEAD:public/...`) raw vs original blob | PASS, same sha256 |

Also asserted: each file's line count equals the table, each parses alone with `vm.Script`, no stray `\r`, and no top-level function name is declared in two different files (125 distinct names; `convertUrlsToLinks` is declared twice, both copies in `recipients-helpers.js`). `git ls-files --eol` shows the new files as `i/lf w/crlf` like their neighbours. `recipients.html` and `home.html` also stay `i/lf w/crlf`.

## 3. Runtime snapshot before/after: PASS (globals identical)

Temporary harness `tmp-split-snapshot.js` (outside `tests/`, deleted afterwards): Playwright + Edge, `serviceWorkers: 'block'`, a fresh demo-mode `server.js` per page and viewport (booted with the same `startDemoServer` helper as the e2e globalSetup), logged in through `/api/login`. Pages: `/recipients` and `/` (home, the only other page that loads the script), each at 375x812 and 1024x768. No screenshots; DOM and computed-style data only.

Recorded per page: every added `window` own property compared with a blank page (name, `typeof`, hash of every function's source, primitive values), the 10 top-level `let`/`const` bindings via indirect `eval('typeof ...')`, console messages (timings masked), page errors, HTTP >= 400 responses, list of `.js` requests, computed styles and rects of 19 key selectors, visible text and full text content. On `/recipients` a smoke run followed: identified user (Jan Nowak, id 2) -> add a present through the API and refresh with the page's own `softReloadRecipients()` and `loadRecipientsWithPresents()` -> reserve -> mark bought -> undo bought -> cancel reservation -> person filter -> status filters (reserved, unreserved, checked, unchecked, all) -> `performSearch('Kubek')` and `performSearch('')` (the page has no `#searchInput`; the call throws a null error in both before and after, which is existing behaviour). 17 smoke steps, each with DOM text, full text, toasts and reserve/bought button state.

| Comparison | Result |
|---|---|
| `before-1` vs `before-2` (determinism of the harness) | IDENTICAL on all 4 files (`compare-before-1-vs-before-2.txt`) |
| `before-1` vs `after-final` | Only 2 diffs per file: `styles.__counts.all` +10 and `styles.__counts.scripts` +10, i.e. the 10 extra `<script>` elements (1 tag became 11). Everything else is equal: global names (449 on `/recipients`, 433 on `/`), `typeof`, function-source hashes, values, lexical bindings, console multiset, page errors (0), bad responses (0), computed styles, text, all 17 smoke steps |

`/recipients` console log ordering is not stable between two runs of the same code (async fetches), so the console is compared as a multiset; ordering was equal in 3 of 4 files and the fourth differs between two baseline runs as well.

Script tag order seen in the DOM after the change on `/recipients`: `recipients-page.js`, `recipients-page-notifbell.js`, the 11 pieces in load order, `recipients-page-scroll.js` (same neighbours as before). On `/` the 11 pieces follow the inline `SKIP_RECIPIENTS_INIT` script, unchanged.

## 4. URLs: PASS

`tmp-split-urls.js` (deleted afterwards), output `urls-200.txt`:
- all 11 `/recipients-<part>.js?v=1` return `200 application/javascript; charset=UTF-8` from the demo server;
- the old `/recipients.js` now returns 404 `text/html` (not JavaScript);
- every recipients piece appears exactly once in `sw.js` `urlsToCache`, every file exists, `prezenty-v125` occurs 0 times, `prezenty-v126` once; `node --check public/sw.js` passes;
- in the browser run all 11 requests were `200 application/javascript` on `/recipients`, no response >= 400 on either page.

Old name no longer referenced by any live code: `git grep recipients\.js` (excluding `.agents` and `docs`) finds only comments (listed in section 6).

## 5. Playwright suite: PASS

`npm test` in the worktree (output in `e2e-after.txt`): **121 passed, 11 skipped, 0 failed (7.5m)**, exit 0. Same as the baseline (121 passed, 11 skipped intentional `test.fixme`).

## 6. Other references checked

No edit was needed in `routes/pages.js`, `server.js`, `Dockerfile`, `.dockerignore`, `vercel.json`, `render.yaml`, `package.json`, `postcss.config.js` (the `./public/**/*.js` PurgeCSS glob already covers the new files), `scripts/`, `tests/helpers/*`. `git diff --name-status bc8be84..HEAD` (before this doc) is: 11 `A` (`public/recipients-*.js`), 1 `D` (`public/recipients.js`), `M public/recipients.html`, `M public/home.html`, `M public/sw.js`. Each HTML file changed by 1 line out, 11 lines in. No CSS, `<link>`, server, or test files touched.

Comment-only mentions of `recipients.js` left unchanged on purpose (zero cleanup): `public/home.html` 241, 244, 248, 269; `public/recipients.html` 267; `public/escape-html.js` 11, 36; `public/filters.js` 690; `public/home-page-auth.js` 14, 75; `tests/README.md` 173 and `tests/e2e/edit-sheet.spec.js` 176 (stale `recipients.js:3604`, now `recipients-edit.js:184`; `tests/` is out of scope).

## 7. Observations (not fixed, zero behaviour change)

1. `convertUrlsToLinks` is declared twice (orig. L2348 and L2475); the first is dead.
2. `convertUrlsToLinks(escapeHtml(title))` builds `href`/`title` attributes from a URL regex that accepts `"`, while `escapeHtml` does not escape quotes: possible attribute injection. Follow-up recommended.
3. `performSearch`/`initializeSearchAndFilter` expect `#searchInput`, which `recipients.html` does not contain, so `performSearch(...)` throws on a null `querySelector` when called.
4. `window.checkAndPromptIdentification` is checked in `home-page-auth.js` but defined nowhere.
5. `if (typeof window.deletePresent !== 'function')` is always true on these pages; `initializeFAB` is empty.
6. Likely dead functions: `focusSearch`, `deleteRecipientFromModal`, `openProfileModal`, `togglePresentFromRecipients`, `addRecipient`, `deleteRecipient`, `populateAddPresentModal`, `addPresentFromModal`, `cancelReservationFromModal`, `updateButtonOptimistically`, `redirectIfAuthenticated`, `openChangePictureModal`, `refreshRecipientsCache`.
7. The new pieces are now precached by the service worker (`recipients.js` never was). A small, deliberate caching change requested for this task.
8. Each piece is revalidated on every load (`no-cache, must-revalidate`), so a page load makes 11 conditional requests instead of 1. Adjacent files can be merged without any other change.
9. Merge note: task 5 (`css-consolidate-1`) will also edit `sw.js` (`CACHE_NAME`) and the same HTML files. Take the union of `urlsToCache` and the next free `CACHE_NAME`.

## 8. Cleanup

Temporary scripts `tmp-split-{snapshot,concat,apply,tags,sw,urls,explore}.js` were deleted from `.agents/tasks/`. Evidence stays in `.agents/tasks/split-recipients-baseline/` (before-1, before-2, after-final snapshots, compare outputs, byte proofs, URL check, `e2e-after.txt`, originals).

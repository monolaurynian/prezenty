# Split of `public/recipients.js` into 11 classic scripts

The change cuts the 4,706-line `public/recipients.js` into 11 contiguous pieces, `public/recipients-{core,startup,list,identify,present-actions,helpers,modals,optimistic,edit,sync,toast-undo}.js`. It swaps the single `<script>` tag for 11 tags in `recipients.html` and `home.html`, deletes the old file, and precaches the pieces in `sw.js` with `CACHE_NAME` v125 to v126. The partition is byte-exact, so classic-script semantics hold by construction.

I re-ran every check in the brief. All are green, with one baseline-side flake noted below.

Watch for: nothing blocking. The non-blocking notes are in the Issues list.

**Verdict**: APPROVED

## High-level view

The split is a pure contiguous cut at statement boundaries, with no header comments and no reordering. Equality with `main:public/recipients.js` is therefore provable by plain concatenation, and I confirmed it. The 11 tags sit in the same position as the old one, with the same neighbours. On `home.html` they stay after the inline `SKIP_RECIPIENTS_INIT` script, so the order-critical flag is still set before the first piece runs.

Runtime behaviour is unchanged. I booted the demo server on `main` and on the worktree and compared `Object.keys(window)`, `typeof`, function-source hashes and the 10 top-level `let`/`const` bindings. The sets are identical, and there are no page errors and no new console errors.

`sw.js` adds exactly the 11 new URLs, matching the `?v=1` in the tags. The cache name is bumped once. No CSS, `<link>`, server or test files are touched.

<details>
<summary>Issues (3)</summary>

1. **Eleven conditional requests per load (possible, non-blocking)** — `server.js` serves `.js` with `no-cache, must-revalidate`, so one request becomes 11 revalidations. The design chose this knowingly and the coder noted that adjacent pieces can be merged. No action needed for this task.
2. **Stale comments and a stale test-doc reference (confirmed, non-blocking)** — comments in `home.html`, `recipients.html`, `escape-html.js`, `filters.js` and `home-page-auth.js` still say `recipients.js`. `tests/README.md:173` and `tests/e2e/edit-sheet.spec.js:176` cite `recipients.js:3604`. All were left on purpose under the zero-cleanup rule. A later docs-only pass can fix them.
3. **Merge conflict with task 5 on `sw.js` and the HTML files (likely, non-blocking)** — `css-consolidate-1` edits the same `CACHE_NAME` line and the same HTML files. Whoever merges second must take the union of `urlsToCache` and the next free cache name.

</details>

<details>
<summary>Details</summary>

### Byte-proof: independently re-run, PASS

I wrote a throwaway Node script, outside the repo and deleted afterwards. It concatenated the 11 committed blobs (`git show HEAD:public/recipients-<part>.js`) in load order. It compared them with `git show main:public/recipients.js`.

- **Committed blobs, raw.** Equal at 195,948 B, with both sides at sha256 `e0ccba3a…fc65167`. This matches the coder's recorded hash.
- **Working-tree files.** Equal after normalising CRLF to LF.
- **Per-piece checks.** No stray CR in the committed blobs, no BOM, every piece parses alone with `vm.Script`, and the line counts are 578, 309, 450, 486, 474, 221, 586, 316, 443, 508, 335. These match the plan and sum to 4,706.

`main` has since advanced to `a5f6015`, but that is only a test-spec commit. `public/recipients.js` is identical, so `main:` is the right reference.

### Globals diff and console errors: independently re-run, PASS

I wrote a Playwright and Edge harness with `serviceWorkers: 'block'`. It starts a fresh demo-mode `server.js` per tree through that tree's own `tests/helpers/start-demo-server.js`. The baseline is the `main` checkout and the "after" is the worktree.

Each page is logged in via `/api/login`. I loaded `/recipients` and `/` (home) at 1024x768 and at 375x812. These are the only two pages that load the split scripts. `git grep` of `main` finds exactly two tags, `recipients.html:775` and `home.html:249`.

Results per page and viewport:

- **Global names.** `Object.keys(window)` is identical on all four runs: 437 on `/recipients`, 421 on `/`.
- **Values.** `typeof` and primitive values are identical. Function-source hashes are identical once CRLF is normalised.
  - The only differences are `window.origin`, which holds the random server port, and `_dataCacheTimestamp`, a clock value.
  - A first run, without CRLF normalisation, also flagged `notificationText` and `plCount`/`plForm`/`plPlural`. These are untouched files that differ only by checkout line endings between the two trees. `git diff main HEAD` on them is empty, and the differences vanish with normalisation.
- **Lexical bindings.** The 10 top-level `let`/`const` bindings (via indirect `eval('typeof …')`) are identical.
- **Errors.** There are 0 page errors and 0 HTTP responses of 400 or above after the change.
- **Console.** The after-change console is identical to the baseline except for one flaky baseline case below.
  - The only warning is `Service Worker registration blocked by Playwright`, which comes from the harness setting.
  - On `/` at 375 the baseline run emitted `Failed to fetch` errors from `home-page.js` and `home-page-auth.js`. These are network aborts that happen when the load races `networkidle`. The first and second baseline runs showed different `Failed to fetch` errors. The after-change run showed none, so this is a baseline flake and not a new error.
- **Script tags.** After the change, the 11 pieces load in order, each 200 `application/javascript`. On `/recipients` they sit between `recipients-page-notifbell.js` and `recipients-page-scroll.js`, as the old tag did.

### Playwright suite: full `npm test` re-run, PASS

I re-ran the whole suite from the worktree and did not rely on recorded counts. The result was exit 0, **121 passed, 11 skipped, 0 failed** (10.9 min), which matches the expected counts.

### `sw.js`: PASS

- **Diff.** The only changes are one `CACHE_NAME` line and 11 added `urlsToCache` lines.
- **Entries.** All 11 files are listed, as `/recipients-<part>.js?v=1`, matching the tags' query strings.
- **Old entry.** `recipients.js` was never in `urlsToCache` on `main`, so there was nothing to remove. `git grep recipients.js` on `HEAD -- public/sw.js` finds nothing.
- **Cache name.** `prezenty-v125` (`main`, `bc8be84` and `a5f6015`) became `prezenty-v126`, a single bump to a strictly greater value.

### Scope and semantics: PASS

- **Files changed.** `git diff --name-status main...HEAD` shows 11 added `public/recipients-*.js`, `recipients.js` deleted, `home.html`, `recipients.html` and `sw.js` modified, and the verification doc added.
- **Untouched.** No `.css` file, no `server.js`, `routes/`, `package.json` or `tests/` file is in the diff.
- **HTML diffs.** They are exactly one line removed and 11 added each, with no `<link>` line in either diff.
- **Semantics.** Byte equality means the code is untouched, so there are no ES modules, no IIFE or namespace wrapping, and no renames, cleanups or formatting changes. The `import`, `export` and `(function (` matches in the added lines are pre-existing code that moved.
- **Cleanup.** The worktree is clean, with no stray temp files, and my own temp files are removed.

### What I did not independently re-run

I did not re-run the coder's 17-step interaction smoke or the computed-style and rect comparison. I used the coder's recorded result for those. The byte-proof plus the identical globals make a behavioural difference implausible, and the full e2e suite passed.

</details>

## File map

<details>
<summary>Files changed</summary>

- `public/recipients.js`: deleted.
- `public/recipients-{core,startup,list,identify,present-actions,helpers,modals,optimistic,edit,sync,toast-undo}.js`: new, contiguous byte-exact partition.
- `public/recipients.html`, `public/home.html`: one script tag replaced by 11.
- `public/sw.js`: cache v125 to v126, plus 11 precache URLs.
- `.agents/tasks/split-recipients-1-verification.md`: the coder's report.

Full diff: `git diff main...HEAD` in `.worktrees/split-recipients-1`.

</details>

# Extract inline CSS/JS from 12 public/ pages into 27 external files

Moves 15 inline `<script>` and 12 inline `<style>` bodies (354,838 B) out of 12 HTML pages into flat `public/<page>-page*.{css,js}` files, each referenced as `?v=1` at the exact position of the block it replaced, with a service-worker precache entry per file and `CACHE_NAME` bumped v124 to v125. Order-critical and sub-1.5 KB blocks stay inline per the plan. I independently re-proved byte identity from the committed blobs and the working tree, re-ran a computed-style/globals/console diff against an unmodified copy of the base tree, and re-ran the full Playwright suite: all match baseline. Watch for: the branch carries one extra docs commit that adds a `.agents/tasks/` artifact to the repo (confirmed, non-blocking).

**Verdict**: APPROVED

## High-level view

The change is purely mechanical. Every replacement tag is a bare `<link href="X.css?v=1" rel="stylesheet">` or `<script src="X.js?v=1"></script>`, with no `defer`, `async` or `type` (so classic, parser-blocking, same ordering as before). Substituting each tag back with `<style>`/`<script>` plus the file body reproduces the original page byte-for-byte for all 12 pages, so position, indentation and surrounding whitespace are preserved.

Runtime equivalence holds. Against an unmodified copy of base, 13 page descriptors at 375x812 and 1024x768 show identical computed styles on every element, identical stylesheet rule counts and rule-text hash across all stylesheets, identical window globals (names, `typeof`, function-source hash) and identical top-level `let`/`const`/`function` names. There are no new 404s and no new console errors. The only observed difference is a flaky count of the benign "Service Worker registration blocked" warning on `home` caused by its own one-shot reload. The full suite is 121 passed, 11 skipped, 0 failed, equal to baseline.

Service-worker wiring is correct. All 27 files are in `urlsToCache` with the `?v=1` suffix, which matters because the SW is cache-first by exact URL including query. `CACHE_NAME` changes once, and `prezenty-v124` no longer appears. No already-external file, `routes/`, `lib/`, `server.js`, `package.json` or `tests/` is touched. The single out-of-`public/` edit is one PurgeCSS content glob in `postcss.config.js`, which the plan allows.

<details>
<summary>Issues (1)</summary>

1. **Artifact committed to branch** (confirmed, non-blocking) — commit `16afcb6` adds `.agents/tasks/extract-inline-1-verification.md` to the repo; the plan says artifacts are never committed and lists it outside the allowed edits. The merge step should exclude it (revert it, or squash without it) so it does not reach the main branch.

</details>

<details>
<summary>Details</summary>

## Byte-for-byte reassembly, done two ways

For each page I located the replacement tags with a strict regex, substituted them back with `<style>BODY</style>` or `<script>BODY</script>`, and compared against the base version. Against the frozen working-tree originals the match is exact for all 12 pages, including `index.html` with its stray bare CRs. Against the git base blobs (`91e02a6`) the match is exact for 9 pages, and for the other 3 (`ustawienia`, `rezerwacje`, `index`) it is exact once CRLF/LF is normalised. Those three have CRLF in the base blob, but git (`core.autocrlf=true`) stores the new files as LF; the working tree is CRLF and matches. So the only byte-level difference on record is line-ending storage in git for new files, with the working tree identical to the original. Exactly 27 replacement tags were found (4,3,2,2,2,2,2,2,2,2,2,2) and all 27 added files are referenced exactly once; there are no orphans. No new file has a BOM, none uses `import`/`export`/`type="module"`, and none contains `document.currentScript` or `</script`.

## Runtime comparison I ran

I copied the worktree, restored the 12 HTML files, `sw.js` and `postcss.config.js` from the frozen originals, removed the 27 new files, and booted two servers on that copy (to measure noise between identical trees) plus one on the worktree. All three used `OFFLINE_MODE` demo mode and the project's CDN cache helper. Per page and viewport I compared computed-style properties of every element, `document.styleSheets` counts and rule hashes, window globals, global lexical names pulled from the new files, and console/HTTP events, masking cells that differ between the two identical-tree servers (random accordion ids, clock-driven values). Result: 26 snapshots, 0 style, stylesheet or global differences, no HTTP >= 400 and no new console errors. All 58 requests for new assets returned 200 with `text/css; charset=UTF-8` or `application/javascript; charset=UTF-8`, so there is no MIME problem and no CSP (none is configured). A negative self-test (injecting a style rule and a global into the new side only) was detected as 183 element differences plus a rule-count, stylesheet-count and extra-global difference, so the harness is capable of failing. Not covered by my run: interactive states (open modals, composer, edit sheet), real service-worker behaviour (blocked under test, checked statically), and a PurgeCSS rebuild.

## Service worker and test run

Each `urlsToCache` entry uses the exact `?v=1` URL the pages request. `npm test` from the worktree: 121 passed, 11 skipped, 0 failed (6.9 min), identical to baseline. The PurgeCSS glob was added but a rebuild of `styles.deduped.min.css` was not run by the coder or by me.

</details>

<details>
<summary>File map</summary>

Full diff: `git diff 91e02a6..HEAD` on `refactor/extract-inline-1`.

- 12 `public/*.html` pages: inline blocks replaced by `<link>`/`<script src>` tags in place
- 27 new `public/*-page*.css|js` files: verbatim block bodies
- `public/sw.js`: 27 precache entries and `prezenty-v125`
- `postcss.config.js`: one added content glob
- `.agents/tasks/extract-inline-1-verification.md`: coder report committed by mistake (Issue 1)

</details>

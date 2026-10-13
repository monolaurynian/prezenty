# Extraction plan: inline `<style>` / `<script>` blocks -> external files

Behavior-preserving refactor. Nothing here changes a single CSS declaration or JS statement: block bodies are moved byte-for-byte, the tag that replaces each one sits at the exact same position in the document.

- Worktree (ALL work happens here, branch `refactor/extract-inline-1`): `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\extract-inline-1`
- Artifact root (OUTSIDE the worktree, never committed): `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks`
- Machine-readable inventory (generated from the real files, use it as the source of truth for the tooling): `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks\extract-inline-manifest.json`
- Baselines go to: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks\extract-inline-baseline`
- Reviewer verdict file (written LAST, by the reviewer only; the coder must never create or edit it): `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks\extract-inline-review.json` (`verdict` == `APPROVED`).

Every relative path below is relative to the worktree unless it is absolute. A relative path used from the wrong cwd lands in the parent workspace, so pass absolute paths or set `cwd` to the worktree.

## 0. Decisions made in this plan

| Decision | Choice | Why |
|---|---|---|
| Restructure the remaining workflow steps into FEAT artifacts? | **No.** Keep the existing implement-and-review loop and merge step. | It is one mechanical pattern applied to 12 files and driven by one manifest and one verification harness. Splitting it would only add hand-offs. The user's "do pages in batches" is satisfied by the ordered batches below, which land as separate local commits on the one branch. |
| How blocks are moved | A small throw-away Node tool reads `extract-inline-manifest.json` and slices bytes. No hand copy/paste. | Hand-copying roughly 350 KB of CSS/JS (354,838 B across 27 blocks) is where silent corruption happens. The tool asserts size, start line and SHA-256 of every body before touching anything. |
| Extraction threshold | Extract a block when it is **>= 1,500 B** and not order-critical. | The user's table rounds ustawienia (1,854 B CSS) and osoby (1,741 B CSS) to "2 KB", so those are in. Everything under 1,500 B stays inline (the 388/390 B "critical notifications panel" styles, the 217 B home flag, the 288-1,262 B `toggleSidebar`/`logout` snippets). |
| Merge adjacent blocks? | **Never.** One block = one file. | Merging would break the byte-for-byte reassembly proof and would change error isolation (an exception in script 1 no longer stops script 2 from running). `formularz.html` styles #2 and #3 and `index.html` scripts #2 and #3 are adjacent but stay separate. |
| Script type | External **classic** `<script src>`; never `type="module"`. | Inline `onclick=` handlers need the page's function declarations to be globals, and several scripts keep top-level `let`/`const` shared between scripts. A classic external script keeps both exactly as before. |
| `defer` / `async` | None of the in-scope inline blocks has `defer`, `async`, `type` or any attribute (verified: every opening tag is the bare `<script>` / `<style>`). The replacement tag therefore has none either. Existing external `defer` tags are left alone. | Parser-blocking order stays identical. |
| Cache-bust query | `?v=1` on every new reference, and the same `?v=1` URL in the service-worker precache. | Matches `app-theme.css?v=14` convention. |
| `postcss.config.js` | Add one content glob so a future `styles.deduped.min.css` rebuild keeps the same selectors (Section 5, item 10). | Today PurgeCSS scans `public/**/*.html`, so class names that only appear in inline `<style>` selectors count as "used". After the move they would silently stop counting. This is the only file touched outside `public/`. |

## 1. How the app serves these files (read from the code)

- `server.js` mounts `express.static('public', { index: false, ... })`. The path is **relative to the process cwd**, which `tests/helpers/start-demo-server.js` sets to the repo root. New files dropped flat into `public/` are served at `/<name>` with no code change.
- `routes/pages.js` only `res.sendFile`s HTML for the extensionless routes (`/`, `/home`, `/recipients`, `/activity`, `/osoby`, `/ustawienia`, `/rezerwacje`, `/archiwum`, `/wiadomosci`, `/formularz`, `/register`). `/leaderboard.html`, `/intro.html`, `/index.html` are served straight by `express.static`. Every page lives at URL depth 0, so a relative `href="x-page.css?v=1"` resolves to `/x-page.css` from every route.
- Headers: `.html` -> `no-cache, no-store, must-revalidate`; `.css` and `.js` -> `no-cache, must-revalidate` (revalidated on each load, 304 when unchanged); `compression` is on. `express`/`send` normally adds `charset=UTF-8` to JS and CSS, which matters because 13 of the 15 extracted JS bodies contain Polish characters or emoji. This is not assumed: the harness asserts the `Content-Type` of every new file (Section 4).
- There is **no CSP**: no `helmet`, no `Content-Security-Policy` header, no `<meta http-equiv="Content-Security-Policy">` in any page (only `Cache-Control`/`Pragma`/`Expires` metas). External same-origin scripts and styles are allowed, and inline ones keep working too. There is no nonce or hash scheme to maintain.
- No server-side templating: none of the 12 pages contains `{{ }}` or `<% %>`; the server never reads or rewrites the HTML. No `<base>` tag, no `<noscript>` wrapper around any block.
- Relative `url(...)` in extracted CSS: every one is `url('seba.jpg')` (resolves to `/seba.jpg` from the stylesheet exactly as it did from the page, because the new CSS sits in the same directory) plus one self-contained `data:image/svg+xml` URI in `recipients.html`. No `@import`, no `@font-face`, no `@charset` anywhere.
- No block uses `document.currentScript`, `document.write`, `import(...)`, `import`/`export`, top-level `await`, `sourceMappingURL`, or contains the text `</script`. No `type="module"`, `type="application/json"`, JSON-LD or `importmap` exists in these 12 pages. (Checked by scanning every block.)
- Nothing in `tests/` reads HTML source or looks for `<style>` / `<script>` elements. `tests/helpers/overflow.js` walks `document.styleSheets` generically and handles `<link>` sheets the same as `<style>` sheets. The suite is therefore a valid regression gate, as is.
- Service worker (`public/sw.js`): HTML is network-first; everything else is **cache-first by exact request URL including the query** (`caches.match(event.request)`, no `ignoreSearch`). Hence the precache entries must be written `'/recipients-page.css?v=1'`, not `'/recipients-page.css'`, or they would never be hit. `playwright.config.js` sets `serviceWorkers: 'block'`, so the e2e suite never exercises the SW; SW changes are verified statically (Section 5).
- PostCSS/PurgeCSS content globs: `./public/**/*.html` and `./public/**/*.js`. New `.js` files are scanned automatically; new `.css` files are not (see decision table).

## 2. Rules the tooling and the coder must follow

### 2.1 Byte safety (Windows, CRLF, OneDrive)

- All 12 pages are UTF-8 **without BOM** and **CRLF** (`git config core.autocrlf` is `true`). No `.gitattributes`.
- Read and write with Node `Buffer` / `latin1` string round-trips only. **Never** use PowerShell `Set-Content`, `Out-File`, `>`, `-replace`, `[IO.File]::ReadAllText` with default encodings, or an editor "save" for these files: they can add a BOM, change line endings or re-encode emoji.
- The extracted file content is exactly the bytes between `<style>` / `<script>` and the closing tag, including the leading `\r\n        ` and trailing `\r\n    `. No trimming, no added final newline.
- OneDrive: on `cloud file provider exited unexpectedly`, `EBUSY`, `EPERM` or `UNKNOWN` errors, retry the file operation (the tool wraps every `fs` call in a 5x retry with 500 ms back-off). Re-run the verification afterwards, never assume a retried write succeeded.
- PowerShell: chain with `;`, never `&&`.

### 2.2 Replacement tags (exact text)

| Original | Replacement (same position, same indentation, nothing else on the line changes) |
|---|---|
| `<style>BODY</style>` | `<link href="NAME.css?v=1" rel="stylesheet">` |
| `<script>BODY</script>` | `<script src="NAME.js?v=1"></script>` |

The `<link>` goes where the `<style>` was, so cascade order against every other stylesheet and against the kept-inline critical `<style>` is unchanged. HTML comments, whitespace and neighbouring tags are not touched. `<link>` is in `<head>` in all cases (every in-scope `<style>` is in `<head>`), so it is render-blocking just like the inline style was.

### 2.3 Files that must NOT be created or modified

- Never overwrite an existing file: the tool writes new files with the `wx` flag and aborts if a name exists. All 27 names below were checked against `public/` and are free.
- Do not touch: `public/recipients.js`, `formularz.js`, `tab-bar-functions.js`, `app-theme.css`, any other already-external file, `bottom-tab-bar-snippet.html`, `tab-bar-demo.html`, `register.html`, `maintenance.html`, `routes/`, `lib/`, `server.js`, `package.json`, `package-lock.json`, `tests/`.
- Allowed edits: the 12 in-scope HTML files, the 27 new files, `public/sw.js`, `postcss.config.js` (one line).
- No push. Commit locally, one commit per batch plus one final cache-bump commit (Section 5). Stage by file name, never `git add .`.

### 2.4 What stays inline, and why

| Page | Block | Bytes | Why it stays |
|---|---|---|---|
| home.html | script #1 (L10-46) | 1,529 | **Order-critical.** First thing in `<head>`: purges caches and unregisters the service worker for stale clients, then does the one-shot reload. It must run before any stylesheet or app script, and it must not depend on an external file that a stale cache might serve. `tests/helpers/pages.js` (`reloadsOnce`) is written around this block. |
| home.html | script #8 (L403-409) | 217 | **Order-critical.** Sets `window.SKIP_RECIPIENTS_INIT = true` and `window._currentUserId` synchronously right before `recipients.js` loads. |
| recipients, activity, leaderboard, formularz | first `<style>` ("Critical styles for notifications panel") | 388-390 | Tiny, deliberately first, FOUC guard for the notifications panel. |
| recipients, activity, leaderboard | `toggleSidebar` script | 1,054-1,262 | Below the 1,500 B threshold; identical snippet on several pages. |
| formularz.html | script #8 `toggleSidebar` (L1570-1577), script #10 `logout()` (L1694-1710) | 288, 586 | Below threshold. |

Not in scope at all: `register.html`, `maintenance.html` (self-contained on purpose), `bottom-tab-bar-snippet.html`, `tab-bar-demo.html`.

## 3. Inventory: every inline block, in document order, with its decision

Numbering `#n` counts **every** `<script>` and `<style>` element in the page in document order (external ones included), so it is the same number the tool uses (`ordinal` in the manifest). "Bytes" is the exact size of the body between the opening and closing tag. Lines are 1-based and refer to the files as they are at commit `91e02a6`.

Marker scan result for every block below: **no** server-side templating placeholders, **no** JSON-LD, **no** `importmap`, **no** `type="module"`, **no** `type="application/json"`, **no** `document.currentScript`, **no** `@import`, **no** `defer`/`async`/`type` attribute on any inline block. The only special-handling item is the relative `url(...)` noted per page, which needs nothing because the new CSS lives in the same directory as the page.

### Batch A (biggest four)

#### recipients.html (118,562 B; head closes L840, body opens L842)

Markers: CSS `url('seba.jpg')` and one `data:image/svg+xml` URI (self-contained).

Document order of all script/style elements: #1 style 388 B (keep) -> **#2 style 29,568 B -> recipients-page.css** -> #3 ext `pluralize-pl.js` -> #4 ext `notification-text.js` -> #5 ext `escape-html.js` -> #6 ext `cdn:bootstrap.bundle.min.js` -> **#7 script 35,399 B -> recipients-page.js** -> #8 script 1,054 B (keep) -> **#9 script 3,262 B -> recipients-page-notifbell.js** -> #10 ext `fast-loader.js` -> #11 ext `recipients.js` -> **#12 script 2,722 B -> recipients-page-scroll.js** -> #13 ext `filters.js` -> #14 ext `profile-picture-debug.js` -> #15 ext `update-checker.js` (defer) -> #16 ext `realtime-updates.js` (defer) -> #17 ext `tab-bar-functions.js` -> #18 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L40-51 | 388 | head | `<link href="filters.css?v=7" rel="stylesheet">` / `<style>` | KEEP inline | critical notifications-panel rules (388 B, <1.5 KB); first style in document, FOUC guard |
| 2 | `<style>` | L52-836 | 29,568 | head | `</style>` / `<script src="pluralize-pl.js"></script>` | EXTRACT | `recipients-page.css` -> `<link href="recipients-page.css?v=1" rel="stylesheet">` |
| 7 | `<script>` | L1520-2262 | 35,399 | body | `<!-- PWA Install Script -->` / `<!-- Sidebar Menu Script -->` | EXTRACT | `recipients-page.js` -> `<script src="recipients-page.js?v=1"></script>` |
| 8 | `<script>` | L2265-2292 | 1,054 | body | `<!-- Sidebar Menu Script -->` / `<!-- Notification Bell Script -->` | KEEP inline | sidebar toggle (1,054 B, <1.5 KB) - tiny, duplicated on several pages |
| 9 | `<script>` | L2295-2374 | 3,262 | body | `<!-- Notification Bell Script -->` / `<!-- Fast loader (load first for instant cache a` | EXTRACT | `recipients-page-notifbell.js` -> `<script src="recipients-page-notifbell.js?v=1"></script>` |
| 12 | `<script>` | L2383-2437 | 2,722 | body | `<!-- Scroll to recipient from leaderboard -->` / `<!-- Filters -->` | EXTRACT | `recipients-page-scroll.js` -> `<script src="recipients-page-scroll.js?v=1"></script>` |

#### home.html (79,698 B; head closes L229, body opens L231)

Markers: CSS `url('seba.jpg')`.

Document order of all script/style elements: #1 script 1,529 B (keep) -> **#2 style 5,435 B -> home-page.css** -> #3 ext `pluralize-pl.js` -> #4 ext `notification-text.js` -> #5 ext `escape-html.js` -> #6 ext `cdn:bootstrap.bundle.min.js` -> #7 ext `fast-loader.js` -> #8 script 217 B (keep) -> #9 ext `recipients.js` -> #10 ext `update-checker.js` (defer) -> #11 ext `realtime-updates.js` (defer) -> **#12 script 4,951 B -> home-page-auth.js** -> **#13 script 34,502 B -> home-page.js** -> #14 ext `tab-bar-functions.js` -> #15 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<script>` | L10-46 | 1,529 | head | `<!-- Force cache refresh for users with old vers` / `<link href="https://cdn.jsdelivr.net/npm/bootstr` | KEEP inline | ORDER-CRITICAL: first script in <head>, cache/service-worker purge + one-shot reload guard; must run before any stylesheet or app script and must not depend on a (possibly stale-cached) external file |
| 2 | `<style>` | L53-216 | 5,435 | head | `<link href="app-theme.css?v=14" rel="stylesheet"` / `<!-- Manifest (required for PWA install prompt) ` | EXTRACT | `home-page.css` -> `<link href="home-page.css?v=1" rel="stylesheet">` |
| 8 | `<script>` | L403-409 | 217 | body | `<script src="fast-loader.js"></script>` / `<!-- Load recipients.js for shared functions (bu` | KEEP inline | ORDER-CRITICAL: sets window.SKIP_RECIPIENTS_INIT / window._currentUserId synchronously BEFORE recipients.js loads (217 B) |
| 12 | `<script>` | L418-524 | 4,951 | body | `<script src="realtime-updates.js?v=2" defer></sc` / `<script>` | EXTRACT | `home-page-auth.js` -> `<script src="home-page-auth.js?v=1"></script>` |
| 13 | `<script>` | L526-1152 | 34,502 | body | `</script>` / `<!-- Toast container (showToast from recipients.` | EXTRACT | `home-page.js` -> `<script src="home-page.js?v=1"></script>` |

#### formularz.html (75,667 B; head closes L1185, body opens L1187)

Markers: style #2 has `url('seba.jpg')`; style #3 has no `url()`.

Document order of all script/style elements: #1 style 390 B (keep) -> **#2 style 13,852 B -> formularz-page.css** -> **#3 style 30,720 B -> formularz-page-edit.css** -> #4 ext `pluralize-pl.js` -> #5 ext `escape-html.js` -> #6 ext `cdn:bootstrap.bundle.min.js` -> #7 ext `formularz.js` -> #8 script 288 B (keep) -> #9 ext `tab-bar-functions.js` -> #10 script 586 B (keep) -> #11 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L20-32 | 390 | head | `<link href="app-theme.css?v=14" rel="stylesheet"` / `<style>` | KEEP inline | critical notifications-panel rules (390 B, <1.5 KB) |
| 2 | `<style>` | L33-474 | 13,852 | head | `</style>` / `<style>` | EXTRACT | `formularz-page.css` -> `<link href="formularz-page.css?v=1" rel="stylesheet">` |
| 3 | `<style>` | L475-1173 | 30,720 | head | `</style>` / `<!-- Manifest (required for PWA install prompt) ` | EXTRACT | `formularz-page-edit.css` -> `<link href="formularz-page-edit.css?v=1" rel="stylesheet">` |
| 8 | `<script>` | L1570-1577 | 288 | body | `<script src="formularz.js?v=22"></script>` / `<!-- Attention scrim for the mobile quick-add co` | KEEP inline | sidebar toggle (288 B) |
| 10 | `<script>` | L1694-1710 | 586 | body | `<script src="tab-bar-functions.js?v=19"></script` / `<script src="desktop-nav.js?v=4"></script>` | KEEP inline | logout() (586 B) |

#### leaderboard.html (59,142 B; head closes L926, body opens L928)

Markers: CSS `url('seba.jpg')`; CSS declares `:root` custom properties.

Document order of all script/style elements: #1 style 390 B (keep) -> **#2 style 23,853 B -> leaderboard-page.css** -> #3 ext `pluralize-pl.js` -> #4 ext `notification-text.js` -> #5 ext `escape-html.js` -> #6 ext `cdn:bootstrap.bundle.min.js` -> #7 script 1,262 B (keep) -> **#8 script 17,800 B -> leaderboard-page.js** -> #9 ext `tab-bar-functions.js` -> #10 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L14-26 | 390 | head | `<link href="app-theme.css?v=14" rel="stylesheet"` / `<style>` | KEEP inline | critical notifications-panel rules (390 B, <1.5 KB) |
| 2 | `<style>` | L27-913 | 23,853 | head | `</style>` / `<!-- Manifest (required for PWA install prompt) ` | EXTRACT | `leaderboard-page.css` -> `<link href="leaderboard-page.css?v=1" rel="stylesheet">` |
| 7 | `<script>` | L1100-1133 | 1,262 | body | `<!-- Sidebar Menu Script -->` / `<script>` | KEEP inline | sidebar toggle (1,262 B, <1.5 KB) |
| 8 | `<script>` | L1135-1434 | 17,800 | body | `</script>` / `<!-- Bottom Tab Bar -->` | EXTRACT | `leaderboard-page.js` -> `<script src="leaderboard-page.js?v=1"></script>` |

### Batch B

#### activity.html (45,697 B; head closes L318, body opens L319)

Markers: CSS `url('seba.jpg')`.

Document order of all script/style elements: #1 style 388 B (keep) -> **#2 style 8,265 B -> activity-page.css** -> #3 ext `pluralize-pl.js` -> #4 ext `notification-text.js` -> #5 ext `cdn:bootstrap.bundle.min.js` -> #6 script 1,064 B (keep) -> **#7 script 23,753 B -> activity-page.js** -> #8 ext `update-checker.js` -> #9 ext `tab-bar-functions.js` -> #10 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L37-48 | 388 | head | `<link href="app-theme.css?v=14" rel="stylesheet"` / `<style>` | KEEP inline | critical notifications-panel rules (388 B, <1.5 KB) |
| 2 | `<style>` | L49-315 | 8,265 | head | `</style>` / `<script src="pluralize-pl.js"></script>` | EXTRACT | `activity-page.css` -> `<link href="activity-page.css?v=1" rel="stylesheet">` |
| 6 | `<script>` | L418-445 | 1,064 | body | `<!-- Sidebar Menu Script -->` / `<script>` | KEEP inline | sidebar toggle (1,064 B, <1.5 KB) |
| 7 | `<script>` | L447-941 | 23,753 | body | `</script>` / `<!-- Auto-update checker -->` | EXTRACT | `activity-page.js` -> `<script src="activity-page.js?v=1"></script>` |

#### wiadomosci.html (41,494 B; head closes L184, body opens L185)

Markers: CSS `url('seba.jpg')`.

Document order of all script/style elements: **#1 style 6,299 B -> wiadomosci-page.css** -> #2 ext `pluralize-pl.js` -> #3 ext `notification-text.js` -> #4 ext `chat-reactions.js` -> #5 ext `cdn:bootstrap.bundle.min.js` -> **#6 script 21,769 B -> wiadomosci-page.js** -> #7 ext `tab-bar-functions.js` -> #8 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L26-177 | 6,299 | head | `<link href="chat-reactions.css?v=3" rel="stylesh` / `<script src="pluralize-pl.js"></script>` | EXTRACT | `wiadomosci-page.css` -> `<link href="wiadomosci-page.css?v=1" rel="stylesheet">` |
| 6 | `<script>` | L288-741 | 21,769 | body | `<script src="https://cdn.jsdelivr.net/npm/bootst` / `<!-- Bottom Tab Bar -->` | EXTRACT | `wiadomosci-page.js` -> `<script src="wiadomosci-page.js?v=1"></script>` |

#### ustawienia.html (40,663 B; head closes L73, body opens L74)

Markers: CSS `url('seba.jpg')`.

Document order of all script/style elements: **#1 style 1,854 B -> ustawienia-page.css** -> #2 ext `pluralize-pl.js` -> #3 ext `notification-text.js` -> #4 ext `cdn:bootstrap.bundle.min.js` -> **#5 script 23,802 B -> ustawienia-page.js** -> #6 ext `tab-bar-functions.js` -> #7 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L24-68 | 1,854 | head | `<link href="app-theme.css?v=14" rel="stylesheet"` / `<!-- Manifest (required for PWA install prompt) ` | EXTRACT | `ustawienia-page.css` -> `<link href="ustawienia-page.css?v=1" rel="stylesheet">` |
| 5 | `<script>` | L202-682 | 23,802 | body | `<script src="https://cdn.jsdelivr.net/npm/bootst` / `<!-- Bottom Tab Bar -->` | EXTRACT | `ustawienia-page.js` -> `<script src="ustawienia-page.js?v=1"></script>` |

### Batch C (small pages)

#### osoby.html (24,441 B; head closes L74, body opens L75)

Markers: CSS `url('seba.jpg')`.

Document order of all script/style elements: **#1 style 1,741 B -> osoby-page.css** -> #2 ext `pluralize-pl.js` -> #3 ext `escape-html.js` -> #4 ext `cdn:bootstrap.bundle.min.js` -> **#5 script 17,758 B -> osoby-page.js** -> #6 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L23-69 | 1,741 | head | `<link href="app-theme.css?v=14" rel="stylesheet"` / `<!-- Manifest (required for PWA install prompt) ` | EXTRACT | `osoby-page.css` -> `<link href="osoby-page.css?v=1" rel="stylesheet">` |
| 5 | `<script>` | L140-465 | 17,758 | body | `<script src="https://cdn.jsdelivr.net/npm/bootst` / `<script src="desktop-nav.js?v=5"></script>` | EXTRACT | `osoby-page.js` -> `<script src="osoby-page.js?v=1"></script>` |

#### archiwum.html (17,471 B; head closes L100, body opens L101)

Markers: CSS `url('seba.jpg')`.

Document order of all script/style elements: **#1 style 2,741 B -> archiwum-page.css** -> #2 ext `pluralize-pl.js` -> #3 ext `cdn:bootstrap.bundle.min.js` -> **#4 script 9,974 B -> archiwum-page.js** -> #5 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L22-96 | 2,741 | head | `<link href="app-theme.css?v=14" rel="stylesheet"` / `<!-- Manifest (required for PWA install prompt) ` | EXTRACT | `archiwum-page.css` -> `<link href="archiwum-page.css?v=1" rel="stylesheet">` |
| 4 | `<script>` | L165-368 | 9,974 | body | `<script src="https://cdn.jsdelivr.net/npm/bootst` / `<script src="desktop-nav.js?v=5"></script>` | EXTRACT | `archiwum-page.js` -> `<script src="archiwum-page.js?v=1"></script>` |

#### intro.html (24,096 B; head closes L363, body opens L364)

Markers: CSS has no `url()`; declares `:root` custom properties.

Document order of all script/style elements: **#1 style 8,851 B -> intro-page.css** -> #2 ext `pluralize-pl.js` -> #3 ext `escape-html.js` -> #4 ext `cdn:bootstrap.bundle.min.js` -> **#5 script 6,878 B -> intro-page.js**

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L15-360 | 8,851 | head | `<link rel="stylesheet" href="https://cdnjs.cloud` / `<script src="pluralize-pl.js"></script>` | EXTRACT | `intro-page.css` -> `<link href="intro-page.css?v=1" rel="stylesheet">` |
| 5 | `<script>` | L528-681 | 6,878 | body | `<script src="https://cdn.jsdelivr.net/npm/bootst` / `</body>` | EXTRACT | `intro-page.js` -> `<script src="intro-page.js?v=1"></script>` |

#### rezerwacje.html (19,688 B; head closes L88, body opens L89)

Markers: CSS `url('seba.jpg')`.

Document order of all script/style elements: **#1 style 2,425 B -> rezerwacje-page.css** -> #2 ext `pluralize-pl.js` -> #3 ext `notification-text.js` -> #4 ext `cdn:bootstrap.bundle.min.js` -> **#5 script 7,469 B -> rezerwacje-page.js** -> #6 ext `tab-bar-functions.js` -> #7 ext `desktop-nav.js`

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 1 | `<style>` | L24-83 | 2,425 | head | `<link href="app-theme.css?v=14" rel="stylesheet"` / `<!-- Manifest (required for PWA install prompt) ` | EXTRACT | `rezerwacje-page.css` -> `<link href="rezerwacje-page.css?v=1" rel="stylesheet">` |
| 5 | `<script>` | L133-281 | 7,469 | body | `<script src="https://cdn.jsdelivr.net/npm/bootst` / `<!-- Bottom Tab Bar -->` | EXTRACT | `rezerwacje-page.js` -> `<script src="rezerwacje-page.js?v=1"></script>` |

#### index.html (15,892 B; head closes L33, body opens L35)

Markers: no inline CSS.

Document order of all script/style elements: #1 ext `cdn:bootstrap.bundle.min.js` -> **#2 script 2,908 B -> index-page-pwa.js** -> **#3 script 6,287 B -> index-page.js**

| # | Tag | Lines | Bytes | Where | Sits between | Decision | Final file / reason |
|---|---|---|---|---|---|---|---|
| 2 | `<script>` | L136-207 | 2,908 | body | `<!-- PWA Install Script -->` / `<script>` | EXTRACT | `index-page-pwa.js` -> `<script src="index-page-pwa.js?v=1"></script>` |
| 3 | `<script>` | L209-338 | 6,287 | body | `</script>` / `</body>` | EXTRACT | `index-page.js` -> `<script src="index-page.js?v=1"></script>` |

Totals: **27 files** created, **354,838 B** of body text moved out of HTML, 7,556 B of small/order-critical blocks left inline.

Per-page special notes:

- **recipients.html**: style #1 and style #2 are adjacent in `<head>`; #1 stays inline so it still precedes the new `<link>`. Script #9 (`notificationConfig`, "Notification Bell Script") and #12 (scroll-to-recipient, `setTimeout(..., 2000)`) sit on either side of `fast-loader.js` / `recipients.js?v=25&t=1111111111`; they stay on the same side. Script #7 starts with top-level `let recipientsDeferredPrompt;` and sets `window.navigateToPresent`. All ordering relative to `recipients.js`, `filters.js`, `tab-bar-functions.js` is preserved because each tag is replaced in place.
- **home.html**: scripts #12 (`checkAuth`, sets `window._currentUserId`, `window._cachedRecipients`, `window._homeData`, `window.checkAndPromptIdentification`) and #13 (`getEmojiAvatar`, dashboard logic) are adjacent in the source but stay two files. Both come after the two `defer` scripts in source order, which is unchanged.
- **formularz.html**: `<style>` #2 and #3 are adjacent; they become two `<link>` tags in the same order. `formularz.js?v=22` is not touched.
- **leaderboard.html**: links `styles.css` (not the deduped file); its extracted CSS holds the `:root { --gold-color ... }` variables, which stay global because the sheet is still document-level.
- **ustawienia.html / index.html**: their scripts register the service worker. Under the tests `serviceWorkers: 'block'` this is a no-op, in production it runs exactly as before. `index.html` #2 also registers `beforeinstallprompt`/`appinstalled` listeners; as an external parser-blocking script it still registers them before DOMContentLoaded, only one request later.
- **index.html line numbers**: all line numbers in this plan count LF characters (what the tool counts). `index.html` is the only page with stray bare-CR characters (2 bare CR and 4 bare LF, all inside the favicon `<link>` lines in `<head>`, lines 22-25). Editors and `Select-String` therefore show index.html lines **+2** (e.g. script #2 is at editor lines 138-209). Those head lines must stay byte-identical; the tool never normalises line endings.
- **intro.html**: has no tab bar and no `desktop-nav.js`; nothing special beyond the two extractions.

## 4. Verification baseline (capture BEFORE any product file changes)

Screenshots are not used (two font CDNs make pixels flaky, see `tests/README.md`). Evidence is DOM / computed-style / CSSOM / global-scope data, plus a byte-level reassembly proof, plus the existing Playwright suite.

### 4.1 The temporary harness

File: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks\tmp-extract-snapshot.js` (outside `tests/` and outside the worktree; **deleted in the last step**). Plain Node, CommonJS.

It must reuse the project's own test plumbing by **absolute path** from the worktree (read-only, `tests/` is never edited):

- `require('<W>/node_modules/@playwright/test')` -> `chromium`, `request`; launch with `channel: 'msedge', headless: true` (installed Edge, no download).
- `require('<W>/tests/helpers/start-demo-server.js').startDemoServer()` -> boots `node server.js` with `OFFLINE_MODE=true`, `NODE_ENV=development`, free port, cwd = worktree root. Stop it in a `finally` and also on SIGINT. Afterwards `Get-Process node` must show no extra process.
- `require('<W>/tests/helpers/cdn-cache.js').installCdnCache(context)` so Bootstrap/Font Awesome/remixicon come from `tests/.cache/cdn` and layout is identical in every run.
- `require('<W>/tests/helpers/pages.js')` -> `PAGES`, `openPage`, `setViewport`, `waitForLayoutSettled`. These already handle home's one-shot reload (`reloadsOnce`) and wait for real content plus settled layout.
- Login exactly like `tests/global-setup.js`: `POST /api/login` with `{username:'e2e',password:'e2e'}` (demo mode accepts anything) and keep the storage state in `<baseline>\tmp-auth.json` (deleted at the end; do not write into `tests/.auth`).

Context options: `serviceWorkers: 'block'`, `locale: 'pl-PL'`, `timezoneId: 'Europe/Warsaw'`, `storageState` (omitted for `index`). One init script, an IIFE that only replaces `Math.random` with a seeded PRNG (mulberry32, fixed seed) so emoji avatars etc. are deterministic. It must not leave a named global behind. Do not freeze `Date` (code that polls with `Date.now()` could hang).

Pages (13 descriptors = 12 in-scope files, wiadomosci has two views), each at **375x812** and **1024x768** (26 snapshots per run). A fresh page per snapshot; call `page.setViewportSize` before navigation, then `openPage`, then `setViewport(page, w, h)`:

| Descriptor | Path | Ready selector | Auth | HTML file |
|---|---|---|---|---|
| home | `/` | from `PAGES` (`reloadsOnce`) | yes | home.html |
| recipients | `/recipients` | `.present-name` | yes | recipients.html |
| osoby | `/osoby` | `#peopleContent` | yes | osoby.html |
| activity | `/activity` | `.notification-item` | yes | activity.html |
| leaderboard | `/leaderboard.html` | `.activity-card` | yes | leaderboard.html |
| wiadomosci-list | `/wiadomosci` | `.thread-row` | yes | wiadomosci.html |
| wiadomosci-thread | `/wiadomosci?rozmowa=1` | `.chat-bubble` | yes | wiadomosci.html |
| rezerwacje | `/rezerwacje` | `#reservedContent` | yes | rezerwacje.html |
| archiwum | `/archiwum` | `#archiveContent` | yes | archiwum.html |
| ustawienia | `/ustawienia` | `h1, h2, h5` | yes | ustawienia.html |
| formularz (added) | `/formularz` | `#myPresentsList .my-present-item` | yes | formularz.html |
| intro (added) | `/intro.html` | `#stepsContainer` | yes | intro.html |
| index (added) | `/` | `#loginForm` | **no** (fresh context, serves index.html) | index.html |

Output: `<baseline>\<run>\<descriptor>@<w>x<h>.json`, one file per snapshot. CLI: `capture --run <name> [--pages a,b] [--inject-css "..."] [--inject-js "..."]`, `mask --a <run> --b <run>`, `compare --a <run> --b <run> [--mask file] [--pages a,b]`. `compare` exits 1 on any difference and writes `<baseline>\compare-<b>.json`.

### 4.2 What every snapshot records

1. **Computed styles for every element in DOM order.** All elements under `<html>` except the `<head>` subtree (so `html`, `body` and everything below, scripts included). One row per element: `[domIndex, tag, id, class, ...values]`, with the property list stored once at the top. Properties: `display, position, width, height, margin, padding, color, background-color, font-size, font-weight, border, overflow, z-index, opacity, transform`. Also record the longhands `margin-top|right|bottom|left`, `padding-top|right|bottom|left`, `border-{top,right,bottom,left}-{width,style,color}`, `overflow-x`, `overflow-y`, because Chromium returns `''` for a shorthand whose sides differ and that would hide a real change. Read with `getComputedStyle(el).getPropertyValue(name)`.
2. **Stylesheets.** `document.styleSheets.length`, and for each sheet in order: `index`, `ownerNode.tagName` (`STYLE` or `LINK`), `href` path or `null`, `cssRules.length` (`null` when a cross-origin sheet throws `SecurityError`, e.g. the CDN sheets), a SHA-1 of the concatenated `rule.cssText` (null if inaccessible), and `media`. Plus `totalRules` over the accessible sheets and `adoptedStyleSheets.length`.
3. **Globals added by the page.** `Object.getOwnPropertyNames(window)` minus the same list taken on `about:blank` in the same context (init script included, so it cancels out). For each added name: `typeof`, and for functions a SHA-1 of `Function.prototype.toString.call(fn)` (detects any change to a function body). Also the **global lexical** names, which `Object.keys(window)` cannot see (`let`, `const`, `class` at script top level, which is what most of these inline scripts declare): use a CDP session `context.newCDPSession(page)` and `Runtime.globalLexicalScopeNames` (no `executionContextId` = default context).
4. **Console and errors.** Every `console` message of type `error` or `warning`, every `pageerror`, every `requestfailed`, every same-origin response with status >= 400. Normalised before storing: `127.0.0.1:<port>` -> `HOST`, source locations and stack frames dropped (they legitimately change from `/recipients:1520` to `/recipients-page.js`), keep `type + text` / `name: message` only.
5. **Same-origin request log.** Normalised `{method, path, status, content-type}`, de-duplicated and sorted. Gives the exact set of files each page loads.

### 4.3 Runs, noise mask, self-test

- Run `capture --run before-1` and `capture --run before-2` on the untouched tree. `mask --a before-1 --b before-2` writes `noise-mask.json` listing every `(snapshot, row, property)` cell that differs between two identical runs (spinners, pulsing badges, countdowns, relative timestamps). If a snapshot's element **count** differs between the two runs, the page was not settled: fix the wait, do not mask it. If more than ~2 % of a snapshot's cells are masked, say so in the report.
- **Negative self-test (the detectors must be able to fail).** `capture --run selftest --pages recipients,index --inject-css "body{margin-left:1px!important}" --inject-js "window.__selftest=function(){}"` (injected after load, never written to disk), then `compare --a before-1 --b selftest` must exit 1 and report an element-style diff, a stylesheet-count diff and an added-global diff. If it exits 0 the harness is broken.
- Baselines live in `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks\extract-inline-baseline\` (`before-1`, `before-2`, `noise-mask.json`, `orig`, `e2e-before.txt`, later `after-*`, `compare-*.json`, `verification-report.md`). None of it is committed.

### 4.4 Pass criteria for `compare --a before-1 --b <after>` (mask applied)

- Computed styles: identical for every non-masked cell; same element count and same tag/id/class per row.
- Stylesheets: same `styleSheets.length`; for each index same `cssRules.length`, same `rules` hash. The only allowed differences are `ownerNode.tagName` `STYLE` -> `LINK` and `href` `null` -> `/<name>.css?v=1`, and only at the indexes of extracted `<style>` blocks.
- Globals: `added` set, `typeof` map, function hashes and lexical-name set identical.
- Console/pageerror/requestfailed: identical multiset after normalisation. (Existing errors are baseline, not failures; new or missing ones are.)
- Requests: `after` = `before` plus exactly the new files that page references, each `200`, `text/css; charset=UTF-8` or `application/javascript; charset=UTF-8`, and no new 4xx/5xx.

### 4.5 Byte-level proof (no browser needed)

The tool's `--verify` mode rebuilds the original from the new tree: for every `refTag` in a page it substitutes `<style>` / `<script>` + the exact bytes of the external file + the closing tag, then compares the result with the frozen copy in `extract-inline-baseline\orig\<page>.html` byte for byte. It also checks that every new file's SHA-256 equals the manifest's `sha256`, and that each `refTag` occurs exactly once. Exit code 0 means "the only change in this page is the swap of block body for tag", i.e. zero logic or style edits.

### 4.6 Existing e2e suite

`npm test` (alias of `npm run test:e2e`, Playwright 1.61.0, `workers: 1`, Edge) before and after. `tests/.cache/cdn` and `tests/.auth` are git-ignored and missing in the new worktree: copy `tests\.cache` from the main workspace (20 cached CDN files) so the run works offline; global-setup recreates `tests/.auth`. Save the full list reporter output to `e2e-before.txt` / `e2e-after.txt`. Pre-existing failures or `fixme` skips are recorded as baseline; the after-run must have the same passed/skipped/failed counts and the same failing test names.

## 5. Implementation plan (ordered; batches land as local commits on the one branch)

Conventions for every item: work in the worktree; PowerShell with `;`; Node file I/O through `Buffer` only; retry OneDrive errors; stage by file name; **never push**; if any check below fails, stop, diagnose, and fix the cause (re-run the tool on a clean page: `git checkout -- public/<page>.html` and delete the new files that the tool created for that page, then re-run). Never "repair" a diff by editing CSS or JS content. Tick the box here when an item is done so a later iteration can resume.

- [ ] 1. **Preflight.** In the worktree confirm: branch `refactor/extract-inline-1`, HEAD `91e02a6`, `git -P status --short` empty, `node -v` is v24.x, `node_modules\@playwright\test` is 1.61.0, Edge exists at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Copy `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\tests\.cache` to `<W>\tests\.cache` (`Copy-Item -Recurse -Force`; git-ignored). Confirm none of the 27 `outFile` names in the manifest exists in `public\`, and that each manifest `sha256`/`bodyBytes`/`startLine` still matches the current HTML (the apply tool's `--dry-run` in item 6 does this).
  Files: none modified.
  Verify: `git -P status --short` prints nothing; `Test-Path <W>\tests\.cache\cdn` is True.

- [ ] 2. **Freeze originals.** Copy the 12 in-scope HTML files plus `public\sw.js` and `postcss.config.js` byte-for-byte (`Copy-Item`) to `<baseline>\orig\`. Write `<baseline>\orig\SHA256SUMS.json` with the SHA-256 of **every** file under `public\` and of `postcss.config.js`.
  Files: only under `<baseline>\orig\`.
  Verify: `Get-FileHash` of each copy equals the original; `git -P diff --stat` still empty.

- [ ] 3. **Write the snapshot harness** exactly as in Section 4.1-4.3 (`tmp-extract-snapshot.js`, artifact root, not in the worktree).
  Verify: `node tmp-extract-snapshot.js capture --run smoke --pages recipients` exits 0 and writes `recipients@375x812.json` and `recipients@1024x768.json`, each with > 50 element rows, `sheetCount` > 0 and a non-empty `added` globals list; server child is gone afterwards (`Get-Process node` count back to baseline). Delete `<baseline>\smoke` afterwards.

- [ ] 4. **Capture the BEFORE baseline.** `capture --run before-1`, `capture --run before-2`, `mask --a before-1 --b before-2`, then the negative self-test from Section 4.3.
  Verify: both runs have 26 snapshot files; `noise-mask.json` exists; the self-test `compare` exits 1 with the three expected categories; a clean `compare --a before-1 --b before-2 --mask noise-mask.json` exits 0.

- [ ] 5. **Capture the BEFORE e2e result.** From the worktree: `npm test 2>&1 | Tee-Object <baseline>\e2e-before.txt` (set a 1,800,000 ms timeout, or run in the background and poll).
  Verify: the file ends with Playwright's summary line (`N passed`, skipped, failed). Copy those three numbers and any failing test names into `<baseline>\notes.txt`.

- [ ] 6. **Write the extraction tool** `tmp-extract-apply.js` (artifact root). Reads the manifest; modes `--dry-run`, `--batch A|B|C|all`, `--verify [--batch ...]`, `--check-sw`; overridable `--public-dir` and `--orig-dir` for rehearsals. Algorithm per page: read the file as Buffer -> `latin1` string (1 char = 1 byte, so offsets are byte offsets); find every `<script>`/`<style>` element with `/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi`, numbering them 1..n including those with `src`; for each manifest `extract` entry assert tag, that the opening tag is exactly `<script>`/`<style>`, `bodyBytes`, SHA-256 of the body, and `startLine` counting `\n` only; assert the output file does not exist; compute the new HTML by replacing each whole `<tag>BODY</tag>` with its `refTag`, last block first; only after **all** assertions for the page pass, write the new files with flag `wx` (Buffer of the body, nothing added) and then the HTML Buffer. Wrap every fs call in a 5x retry with 500 ms back-off. `--batch` also appends the batch's `'/<name>?v=1'` lines to `urlsToCache` in `public/sw.js` (one entry per line, `  ` indent, single quotes, inserted after the `'/aws-design.css',` line and before the first `https://` entry, in manifest order) and never touches `CACHE_NAME`.
  Rehearsal: copy `public\` to `%TEMP%\extract-rehearsal\public`, run `--batch all --public-dir ... --orig-dir <baseline>\orig` there, then `--verify` there.
  Verify: `--dry-run --batch all` against the worktree prints 27 extractions and 11 keeps and writes nothing (`git -P status --short` still empty); the rehearsal creates 27 files, `--verify` exits 0, and after deliberately flipping one byte in a rehearsal copy of a new file `--verify` exits non-zero. Delete `%TEMP%\extract-rehearsal` afterwards.

- [ ] 7. **Batch A: recipients, home, formularz, leaderboard (11 files).** Run `node tmp-extract-apply.js --batch A`. New files: `recipients-page.css`, `recipients-page.js`, `recipients-page-notifbell.js`, `recipients-page-scroll.js`, `home-page.css`, `home-page-auth.js`, `home-page.js`, `formularz-page.css`, `formularz-page-edit.css`, `leaderboard-page.css`, `leaderboard-page.js`. Edited: the four HTML files and `public/sw.js` (+11 lines, no `CACHE_NAME` change).
  Verify: (a) `--verify --batch A` exits 0; (b) `node --check` on each new `.js` exits 0; (c) `capture --run after-A --pages home,recipients,formularz,leaderboard` then `compare --a before-1 --b after-A --mask noise-mask.json --pages home,recipients,formularz,leaderboard` exits 0; (d) `npm test` has the same counts as `e2e-before.txt` (full suite once here, because Batch A carries the biggest pages); (e) `git -P diff --stat` lists only the 4 HTML files + `sw.js`. Then run `npm run build` (a no-op `echo` in this repo; there is no compile step) and commit: `git add` the 4 HTML files, `public/sw.js` and the 11 new files by name; message `refactor: extract inline CSS/JS from recipients, home, formularz, leaderboard` with a body that says block bodies were moved byte-for-byte and the cache name is bumped in a later commit.

- [ ] 8. **Batch B: activity, wiadomosci, ustawienia (6 files).** `activity-page.css`, `activity-page.js`, `wiadomosci-page.css`, `wiadomosci-page.js`, `ustawienia-page.css`, `ustawienia-page.js`. Same procedure and checks as item 7 with `--batch B`, pages `activity,wiadomosci-list,wiadomosci-thread,ustawienia`, run name `after-B`; for the e2e check run the canary `npm run test:e2e -- smoke wrapping no-horizontal-overflow` instead of the whole suite. Commit `refactor: extract inline CSS/JS from activity, wiadomosci, ustawienia`.

- [ ] 9. **Batch C: osoby, archiwum, intro, rezerwacje, index (10 files).** `osoby-page.css`, `osoby-page.js`, `archiwum-page.css`, `archiwum-page.js`, `intro-page.css`, `intro-page.js`, `rezerwacje-page.css`, `rezerwacje-page.js`, `index-page-pwa.js`, `index-page.js`. Same procedure with `--batch C`, pages `osoby,archiwum,intro,rezerwacje,index`, run name `after-C`, canary `npm run test:e2e -- smoke xss-usernames`. Remember index.html editor line numbers are +2. Commit `refactor: extract inline CSS/JS from osoby, archiwum, intro, rezerwacje, index`.

- [ ] 10. **Keep PurgeCSS parity.** In `postcss.config.js` add `'./public/**/*-page*.css',` to the `content` array (after `'./public/**/*.js'`). Nothing else in that file changes.
  Verify: `node -e "const c=require('./postcss.config.js'); console.log(c.plugins.length)"` prints 2 with no error; `git -P diff --stat postcss.config.js` shows 1 insertion. Commit `chore: let PurgeCSS scan extracted page CSS`.

- [ ] 11. **Service worker finalisation (the single cache bump).** `node tmp-extract-apply.js --check-sw` must confirm that all 27 `'/<name>?v=1'` strings are in `urlsToCache`, exactly once each, and that each referenced file exists in `public\`. Then change the first line of `public/sw.js` from `const CACHE_NAME = 'prezenty-v124';` to `const CACHE_NAME = 'prezenty-v125';`, and nothing else.
  Verify: `node --check public/sw.js` exits 0; `git -P diff 91e02a6..HEAD -- public/sw.js` shows exactly 27 added lines and one changed line; `prezenty-v124` occurs 0 times and `prezenty-v125` exactly once in the file. Commit `chore: bump service worker cache to v125`.

- [ ] 12. **Final verification on the final tree.** (a) `--verify --batch all` exit 0. (b) `capture --run after-final` and `compare --a before-1 --b after-final --mask noise-mask.json` over all 13 descriptors at both viewports, exit 0. (c) full `npm test` into `e2e-after.txt`, same passed/skipped/failed counts and failing names as `e2e-before.txt`. (d) `git -P diff --name-status 91e02a6..HEAD` shows only: 12 `M` HTML files, `M public/sw.js`, `M postcss.config.js`, 27 `A` files in `public/`. (e) Hash every other file under `public\` and compare with `orig\SHA256SUMS.json`: no differences. (f) `git -P diff --stat 91e02a6..HEAD -- routes lib server.js package.json package-lock.json tests public/recipients.js public/formularz.js public/tab-bar-functions.js public/app-theme.css` is empty.
  Verify: all six sub-checks pass; if (b) shows a diff, re-run `capture` twice to separate noise from a real change before touching anything.

- [ ] 13. **Cleanup and evidence.** Delete `tmp-extract-snapshot.js`, `tmp-extract-apply.js`, `<baseline>\tmp-auth.json`, `%TEMP%\extract-rehearsal`, and any `tmp-plan-*` helper left in the artifact root. Keep the baseline folder and `extract-inline-manifest.json`. Confirm no stray `node` process from the demo server and `git -P status --short` is empty in the worktree. Write `<baseline>\verification-report.md`: the per-batch commit SHAs, snapshot counts, size of the noise mask, the `compare` result per page, `e2e-before` vs `e2e-after` counts, and the byte-proof results. Do not create `extract-inline-review.json`.
  Verify: `Get-ChildItem` shows the temp files gone and the report present.

## 6. Risks and how this plan handles them

- **Extra requests.** 27 new files mean up to 4 more parser-blocking requests per page (recipients), each a conditional GET (`no-cache, must-revalidate`) and precached by the service worker. This is the accepted cost of the refactor; `defer`/`async`/`module` would change execution order and are explicitly not used.
- **Execution order.** Every tag is replaced in place, parser-blocking, classic. Inline-onclick globals, top-level `let`/`const` shared between scripts, `window.SKIP_RECIPIENTS_INIT` and the home cache guard behave as before. The two order-critical home blocks and all small snippets stay inline.
- **Error isolation.** Blocks stay separate files so one script's uncaught exception cannot take down its neighbour (adjacent blocks included).
- **Stack traces / DevTools file names change** (`/recipients:1520` -> `/recipients-page.js`). Nothing in the repo reads them; the harness normalises them away.
- **CRLF / BOM / encoding.** Covered by the Buffer-only rule and the byte-for-byte reassembly proof. New files get CRLF bytes; git (`core.autocrlf=true`) normalises on `git add` the same way it does for the HTML.
- **Stale clients.** HTML is network-first, new URLs are not in an old cache so they are fetched, and the `v125` activation deletes the `v124` cache. The precache entries carry `?v=1` so the cache-first lookup (exact URL incl. query) actually hits.
- **Future edits** to an extracted file must bump its `?v=` in the HTML and in `urlsToCache` together (same convention as `app-theme.css?v=14`).
- **index.html** `beforeinstallprompt` listener registers one request later than before but still before `DOMContentLoaded`; Chromium fires the event after load, so no behavioural change is expected. The head-only bare CR/LF characters in that file are left untouched.
- **Concurrent work.** `.worktrees\harden-server-1` is a separate branch owned by another workflow; this plan touches no server files. If that branch also edits `public/sw.js` the merge step will see a textual conflict on `urlsToCache`/`CACHE_NAME` only.
- **Not covered by the harness** (state it in the report rather than claim otherwise): interactive states (open modals, composer, edit sheet), real service-worker behaviour (blocked in tests), non-Chromium engines. The CSS-rule hash plus the byte proof cover those cases for style, and the function-source hashes plus the byte proof cover script content.

## 7. Hand-off to the reviewer

The reviewer should find in `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks\extract-inline-baseline\`: `verification-report.md`, `compare-after-final.json` (0 differences), `e2e-before.txt` / `e2e-after.txt`, the `before-*` and `after-*` folders, and `noise-mask.json`; and in the worktree, four local commits on `refactor/extract-inline-1` (batch A, B, C, PurgeCSS glob) plus the final `chore: bump service worker cache to v125` commit (five commits in total). The reviewer writes `extract-inline-review.json` last with `"verdict": "APPROVED"` or `"CHANGES_REQUESTED"`.

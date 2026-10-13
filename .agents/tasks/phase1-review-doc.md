# Phase 1 archive of root clutter into docs/archive and scripts

Commit `195d6c5` moves 43 root-level fix notes, one-off scripts and helper wrappers into `docs/archive/<topic>/` and `scripts/`, repoints the three npm scripts that referenced them, and adds navigation READMEs. Nothing was deleted, no product logic or `public/` file changed, and every live entry point (Dockerfile, render.yaml, vercel.json, server.js, package.json) still resolves.

Watch for: only the verification note's rename count (41 vs the actual 43) is off; the three DB npm scripts were not executed against a real database, which the coder disclosed (confirmed, non-blocking).

**Verdict**: APPROVED

## High-level view

The change is a pure relocation. Markdown notes are grouped by topic under `docs/archive/` and the operational scripts under `scripts/`, all via `git mv`, so history follows the files. The only functional edits are the three `package.json` script paths, which are the sole live consumers of the moved JS files.

The moved `.bat`/`.sh` wrappers now `cd` to the repo root before running, so they keep working from their new location. The only moved JS file with a path dependency (`tmp-emoji-click.js`) was rewritten to a `__dirname`-based path that correctly climbs two levels to `public/home.html`.

Docs were kept coherent: root README gains a Project layout section, two new READMEs describe the new folders, and path mentions in DEPLOYMENT.md, tests/README.md, one server.js comment and one archived guide were updated. The root keeps exactly the files the task required.

<details>
<summary>Issues (2)</summary>

1. **Rename count in verification note** — `refactor-manageable-1-verification.md` says 41 renames; the commit has 43 (34 docs + 8 scripts + 1 archived script). Correct the number when the note is next touched (non-blocking, confirmed).
2. **DB npm scripts not executed** — `init-db`, `test-db`, `optimize-db` need a real DB and were only syntax-checked and path-checked; the risk is low because the files are byte-identical renames (0/0 line changes) and none has relative requires (non-blocking, confirmed).

</details>

<details>
<summary>Details</summary>

## Nothing deleted, everything still present

`git log --diff-filter=D main..HEAD` is empty and `git show --name-status HEAD` contains no `D` entries. The diff against main shows 43 renames plus 8 files with plain additions or modifications (the two new READMEs, the verification note, README.md, DEPLOYMENT.md, package.json, server.js, tests/README.md). Obsolete notes and the throwaway `tmp-emoji-click.js` were archived rather than removed, matching the stated requirement. The rename numstat shows 0/0 for `init-db.js`, `test-db.js`, `optimize-db.js` and `check-ip.js`, so those are content-identical moves.

## Live references still resolve

A repo-wide grep for the old bare names of every moved script (excluding `.agents/` history and the two new READMEs) returns only the intended `scripts/...` paths and the updated `docs/archive/performance/PERFORMANCE_OPTIMIZATION.md` hint inside the two wrapper scripts. The Dockerfile copies the whole tree and runs `node server.js`; `.dockerignore` excludes only `README.md` and noise, so nothing relied on the moved files; render.yaml and vercel.json only reference `server.js`/env vars. `package.json` `main` and the `offline` script are unaffected. The changed npm scripts now read `node scripts/init-db.js`, `node scripts/test-db.js`, `node scripts/optimize-db.js`. The sole server.js change is a comment (`MIRRORED in scripts/init-db.js`), no logic.

## Moved scripts keep their paths working

`grep` for relative `require(`/`__dirname` in `scripts/` finds a single hit: `scripts/archive/tmp-emoji-click.js` now builds `path.join(__dirname, '..', '..', 'public', 'home.html')`, which resolves to the repo's `public/home.html` from `scripts/archive/`. The other JS files only require packages (`mysql2`, `dotenv`, `https`); `dotenv` reads `.env` from the cwd, which `npm run` guarantees and `scripts/README.md` documents. `node --check scripts/init-db.js` passes. The `.bat`/`.sh` wrappers gained `cd /d "%~dp0.."` and `cd "$(dirname "$0")/.."`, and `run-demo.bat` (originally a bare `node server.js`) would have broken from `scripts/` without it. Wrapper edits are small (3/1, 3/1, 2/0 lines), so their original encoding and emoji echo lines were preserved.

## Docs and links

`docs/archive/README.md` lists all 34 archived notes by topic, matching the files in the commit, and warns that old notes may mention former root paths. `scripts/README.md` accurately describes the nine scripts, including the `npm run offline` alternative to `run-demo.bat` (that script exists in package.json). The README.md Project layout section links to `tests/README.md`, `scripts/README.md` and `docs/archive/README.md`, all of which exist. A grep for non-http markdown links in the touched docs finds only those README links; no broken relative links were introduced. A grep for bare names of moved `.md` files outside `docs/archive` and `.agents` returns nothing but the wrapper hint noted above.

## Root files and public/

The root contains `.dockerignore`, `.gitignore`, `DEPLOYMENT.md`, `Dockerfile`, `package-lock.json`, `package.json`, `playwright.config.js`, `postcss.config.js`, `README.md`, `render.yaml`, `server.js`, `vercel.json` plus `.agents`, `docs`, `public`, `scripts`, `tests` directories. `git diff main --stat -- public sw.js` is empty, so `public/`, the service worker cache name and `?v=` params are untouched.

## Working tree note

`.agents/tasks/server-split-routes-before.txt` is untracked and not part of this commit; it is the Phase 2 route baseline and is expected to stay local until committed.

</details>

<details>
<summary>File map</summary>

- `docs/archive/{formularz,cache,performance,profile-picture,misc}/*.md` - renamed from root (34 files; `QUICK_FIX_SLOW_LOADING.md` has 3 path edits)
- `scripts/*.js`, `*.bat`, `*.sh` - renamed from root (8 files; wrappers cd to root, `db-diagnose.js` usage text updated)
- `scripts/archive/tmp-emoji-click.js` - renamed, `__dirname`-based path, archived header
- `scripts/README.md`, `docs/archive/README.md` - new
- `README.md` - Project layout section
- `package.json` - three script paths
- `server.js` - one comment line
- `DEPLOYMENT.md`, `tests/README.md` - path mentions updated
- `.agents/tasks/refactor-manageable-1-verification.md` - verification record

Full diff: `git diff main --stat -M` in the worktree.

</details>

</details>

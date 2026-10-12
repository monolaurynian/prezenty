# Verification: refactor-manageable-1 (server.js split)

## Baseline (before refactor)

Captured at worktree HEAD `4d06241`, before any product code was touched
(Node v24.11.0, Windows / PowerShell).

### Test baseline

Command (from the worktree root, as configured in `playwright.config.js`):

```
npx playwright test --reporter=list
```

Exit code: **0**. Duration: ~6.5 min (`workers: 1`, Edge channel, demo-mode server).

| Result | Count |
|---|---|
| passed | **121** |
| failed | **0** |
| flaky | 0 |
| skipped | **11** |
| total | 132 |

Pre-existing failures: **none**.

The 11 skipped tests are intentional `test.fixme` entries, not breakage:

- `a11y.spec.js:68` "a11y smoke > <page>: EVERY icon-only control including the dock has a name"
  for home, recipients, osoby, activity, leaderboard, wiadomosci-list, wiadomosci-thread,
  rezerwacje, archiwum, ustawienia (10 tests)
- `edit-sheet.spec.js:179` "edit present bottom sheet > closing the sheet returns focus to its trigger" (1 test)

After the refactor the expected result is exactly: 121 passed, 0 failed, 11 skipped.

### Route baseline

The authoritative ordered list of every route registered by the original
`server.js` is in `.agents/tasks/server-split-routes-before.txt`
(one `METHOD /path` per line, in registration order).

- **66 routes.**
- Produced by booting the real `server.js` in demo mode (`OFFLINE_MODE=true`), intercepting
  `app.listen`, and walking `app._router.stack` (temporary script, since deleted).
  The app also has 11 non-route middleware layers, which are not in the file.
- Cross-check: a source grep of top-level `app.<verb>('...')` finds 69 lines, but the unique
  `METHOD path` set is identical to the walked set. The 3 extra grep hits
  (`GET /api/notifications`, `GET /api/notifications/unread-count`,
  `POST /api/notifications/:id/read`) are older duplicates inside a `/* ... */` comment block
  (server.js lines 2165-2305), so they are not registered. The 66-route walk is the truth.
- Compare after the refactor with the same method (walk `app._router.stack`, descending into
  mounted routers) and diff against that file. Order matters.

## Phase 1 - Archive root clutter

Behavior-preserving. Nothing deleted; all moves via `git mv` (history preserved, 41 renames).

### Reference audit (git grep over the whole worktree)
- Live references found only in `package.json` (`init-db`, `test-db`, `optimize-db` npm scripts), plus prose in `README.md`, `DEPLOYMENT.md`, `tests/README.md` and a comment in `server.js` (line ~2607).
- Dockerfile, render.yaml, vercel.json, .dockerignore and server.js logic reference none of the moved files (Dockerfile runs `node server.js`; render.yaml runs `npm start`). `.vscode` does not exist.
- `init-db.js`, `test-db.js` and `optimize-db.js` are reached only through npm scripts, so they were moved and `package.json` was updated.

### What moved where
- `docs/archive/formularz/` (15): all `FORMULARZ_*.md`.
- `docs/archive/cache/` (6): `CACHE_BUSTING_GUIDE.md`, `CACHE_DISABLED_FIX.md`, `CACHE_ERROR_FIX.md`, `CACHE_FIX.md`, `QUOTA_FIX.md`, `UPDATE_CHECKLIST.md`.
- `docs/archive/performance/` (8): `PERFORMANCE_OPTIMIZATION.md`, `QUICK_FIX_SLOW_LOADING.md`, `FAST_LOADING_GUIDE.md`, `LOADING_OPTIMIZATION_SUMMARY.md`, `INSTANT_LOAD_OPTIMIZATION.md`, `EXECUTION_ORDER_OPTIMIZATION.md`, `INCREMENTAL_UPDATES_SUMMARY.md`, `REALTIME_UPDATES_GUIDE.md`.
- `docs/archive/profile-picture/` (2): `PROFILE_PICTURE_FIX.md`, `PROFILE_PICTURE_ROOT_CAUSE.md`.
- `docs/archive/misc/` (3): `CRONJOB_STATUS.md`, `PRIVACY_FEATURES.md`, `test-notifications.md`.
- `scripts/` (8): `init-db.js`, `test-db.js`, `optimize-db.js`, `db-diagnose.js`, `check-ip.js`, `apply-optimizations.bat`, `apply-optimizations.sh`, `run-demo.bat`.
- `scripts/archive/` (1): `tmp-emoji-click.js`.
- Root now keeps: README.md, DEPLOYMENT.md, package.json, package-lock.json, server.js, playwright.config.js, postcss.config.js, Dockerfile, render.yaml, vercel.json, .dockerignore, .gitignore.

### Edits to keep things resolving
- `package.json`: `init-db`, `test-db`, `optimize-db` now `node scripts/<name>.js`.
- `scripts/run-demo.bat`, `scripts/apply-optimizations.bat`, `scripts/apply-optimizations.sh`: `cd` to the repo root first; PERFORMANCE_OPTIMIZATION.md hint points at its archive path.
- `scripts/db-diagnose.js`: usage text shows `node scripts/db-diagnose.js`.
- `scripts/archive/tmp-emoji-click.js`: `public/home.html` path now `__dirname`-based; header marks it archived.
- The other moved JS scripts have no relative requires or `__dirname` paths (only `mysql2`/`dotenv`/`https`); `dotenv` reads `.env` from the cwd, so run them from the repo root (`npm run` does).
- Path references updated in `DEPLOYMENT.md`, `tests/README.md`, the `server.js` comment (comment only, no logic) and three lines of `docs/archive/performance/QUICK_FIX_SLOW_LOADING.md`.
- Added `docs/archive/README.md`, `scripts/README.md` and a "Project layout" section in `README.md`.
- Not touched: `public/`, `sw.js`, `?v=` params, server.js logic. `.agents/tasks/*` history docs still mention root `init-db.js`/`tmp-emoji-click.js` as they were true when written.

### Verification results
- `node --check` on `scripts/init-db.js`, `test-db.js`, `optimize-db.js`, `db-diagnose.js`, `check-ip.js`, `scripts/archive/tmp-emoji-click.js`: all exit 0. `node --check server.js`: exit 0.
- `node -e "require('./package.json')"`: OK; the three scripts resolve to `node scripts/...`.
- `git grep` for old root paths of moved scripts (outside `.agents/` history and the two archive/scripts READMEs): no hits. Remaining bare `.md` names are same-folder sibling mentions inside `docs/archive/*`.
- App start: `DEMO_MODE=true PORT=3917 node server.js` from the worktree root started in demo mode; `GET /health` returned 200; process stopped afterwards.
- Not run: `npm run init-db`, `test-db`, `optimize-db` (need a real `DB_PASSWORD` and the remote database); `.bat`/`.sh` wrappers not executed.

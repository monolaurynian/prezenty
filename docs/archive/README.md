# Archived notes

These are historical fix notes, implementation summaries and checklists that used to live in the repo root. They are kept for reference only. They describe how things looked at the time they were written and may not match the current code (for example, cache names and version numbers). For current setup and deployment, see the root `README.md` and `DEPLOYMENT.md`.

Files were moved with `git mv`, so `git log --follow <path>` still shows their history.

## formularz/

The public "formularz" (form) feature, in rough order of creation.

- `FORMULARZ_FEATURE.md` - feature documentation.
- `FORMULARZ_IMPLEMENTATION_SUMMARY.md` - what was created for the first implementation.
- `FORMULARZ_UPDATES.md` - switch to a standard form with a dropdown.
- `FORMULARZ_DESIGN_UPDATES.md` - transparent blur theme.
- `FORMULARZ_STYLING_FIX.md` - styling issues fixed.
- `FORMULARZ_HAMBURGER_MENU.md` - hamburger menu implementation.
- `FORMULARZ_MENU_RIGHT_FIX.md` - menu moved to the right side, plus fixes.
- `FORMULARZ_MENU_HOME_LINK.md` - home link added to the menu.
- `FORMULARZ_TOP_MENU_CONTAINER.md` - top menu container update.
- `FORMULARZ_FINAL_UPDATES.md` - final round of changes.
- `FORMULARZ_AUTO_SELECT_USER.md` - auto-select the authenticated user name.
- `FORMULARZ_IDENTIFIED_USER_TRACKING.md` - tracking which identified user submitted.
- `FORMULARZ_CREATED_BY_FIX.md` - `created_by` column fix.
- `FORMULARZ_500_ERROR_FIX.md` - fix for a 500 error on submit.
- `FORMULARZ_ENHANCED_LOGGING.md` - more detailed error logging.

## cache/

Browser cache, service worker and localStorage issues.

- `CACHE_BUSTING_GUIDE.md` - cache-busting and auto-update mechanisms.
- `CACHE_FIX.md` - cache and profile picture fix.
- `CACHE_DISABLED_FIX.md` - cache optimization and fallback.
- `CACHE_ERROR_FIX.md` - "Error Saving to Persistent Cache" fix.
- `QUOTA_FIX.md` - localStorage quota fix.
- `UPDATE_CHECKLIST.md` - checklist for deploying a quick update (cache version bump).

## performance/

Loading speed, database indexes and incremental updates.

- `PERFORMANCE_OPTIMIZATION.md` - database loading performance guide.
- `QUICK_FIX_SLOW_LOADING.md` - quick fix for slow database loading (uses `scripts/optimize-db.js`).
- `FAST_LOADING_GUIDE.md` - fast loading optimization guide.
- `LOADING_OPTIMIZATION_SUMMARY.md` - summary of the loading optimization work.
- `INSTANT_LOAD_OPTIMIZATION.md` - instant load optimization.
- `EXECUTION_ORDER_OPTIMIZATION.md` - script execution order optimization.
- `INCREMENTAL_UPDATES_SUMMARY.md` - incremental updates implementation summary.
- `REALTIME_UPDATES_GUIDE.md` - real-time incremental updates guide.

## profile-picture/

- `PROFILE_PICTURE_FIX.md` - how to clear caches to fix profile pictures.
- `PROFILE_PICTURE_ROOT_CAUSE.md` - root cause analysis and fix.

## misc/

- `CRONJOB_STATUS.md` - keep-alive cron job status check.
- `PRIVACY_FEATURES.md` - hiding presents for identified users.
- `test-notifications.md` - notification diagnostic steps.

## Moved scripts

One-off and diagnostic scripts from the old repo root now live in `../../scripts/`. Older notes in this folder may still mention the former root paths: `init-db.js`, `test-db.js`, `optimize-db.js`, `db-diagnose.js`, `check-ip.js`, `apply-optimizations.bat`, `apply-optimizations.sh`, `run-demo.bat` and `tmp-emoji-click.js`. Use the `scripts/` paths instead.

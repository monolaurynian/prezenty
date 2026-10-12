# Scripts

Operational and diagnostic scripts. Run them from the repo root (they were moved here from the root with `git mv`). The `.js` database scripts read `.env` from the current directory, so the repo root is the right place to run them. The `.bat` and `.sh` wrappers change to the repo root themselves.

## Database (wired to npm scripts)

- `init-db.js` - creates the tables and indexes on a fresh database. Run: `npm run init-db` (or `node scripts/init-db.js`). Needs `DB_PASSWORD`. The chat schema here mirrors `ensureAnonMessageTables()` in `server.js`; keep both in sync.
- `test-db.js` - tests the database connection. Run: `npm run test-db` (or `node scripts/test-db.js`).
- `optimize-db.js` - adds performance indexes to an existing database. Run: `npm run optimize-db` (or `node scripts/optimize-db.js`).

## Diagnostics

- `db-diagnose.js` - checks database read/write health and the sessions table. Run in PowerShell: `$env:DB_PASSWORD="yourpassword"; node scripts/db-diagnose.js`.
- `check-ip.js` - prints this machine's public IP (useful for allow-listing it on the remote MySQL host). Run: `node scripts/check-ip.js`.

## Wrappers

- `apply-optimizations.bat` / `apply-optimizations.sh` - run `npm run optimize-db` and print next steps. Run: `scripts\apply-optimizations.bat` on Windows, `bash scripts/apply-optimizations.sh` elsewhere.
- `run-demo.bat` - starts the server in demo mode (`DEMO_MODE=true`, no database). Run: `scripts\run-demo.bat`. For the same thing via npm, see `npm run offline`.

## archive/

- `archive/tmp-emoji-click.js` - one-off patch that was applied to `public/home.html` long ago. Kept for reference. Do not run it again.

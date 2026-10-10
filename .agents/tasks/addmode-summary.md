# Add mode - service worker cache bump

- `CACHE_NAME`: `prezenty-v120` → **`prezenty-v121`** (`public/sw.js`, line 1).
- Assets added to `urlsToCache`: **none**. The add-mode work changed only
  already-shipped files (`formularz.html` markup + its inline `<style>`,
  `formularz.js`, `tab-bar-functions.js`); no new static asset was created, so
  the existing 13 entries are untouched.
- `node --check public/sw.js` → exit **0**.
- Effect worth noting: this bump is what drops the stale `tab-bar-functions.js`
  entries, so `leaderboard.html` and `wiadomosci.html` (still on `?v=16`,
  do-not-edit list) start getting the new script.

Full behaviour, decisions and measurements: see
[`addmode-verification.md`](./addmode-verification.md).

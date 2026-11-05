// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { DEMO_MODE, isMaintenanceMode } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { updateTracker } = require('../lib/update-tracker');
const { latestRelease } = require('../lib/release-notes');
const { gifEnabled, klipyEnabled } = require('../lib/gif');

// Routes
router.get('/health', (req, res) => {
    res.status(200).json({
        status: isMaintenanceMode() ? 'MAINTENANCE' : 'OK',
        timestamp: new Date().toISOString(),
        mode: isMaintenanceMode() ? 'MAINTENANCE' : (DEMO_MODE ? 'DEMO' : 'PRODUCTION'),
        database: (DEMO_MODE || isMaintenanceMode()) ? 'disabled' : 'enabled'
    });
});

// The service worker's cache generation (CACHE_NAME in public/sw.js) is
// read once at startup. A deploy restarts the server, so this always names
// the generation that is being served - bumping CACHE_NAME is therefore
// enough to make every open client show the "new version" banner (see
// public/update-checker.js), without also remembering to bump package.json.
function readServiceWorkerCacheName() {
    try {
        const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
        const match = source.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
        return match ? match[1] : null;
    } catch (err) {
        return null;
    }
}
const serviceWorkerCacheName = readServiceWorkerCacheName();

// Version endpoint for cache busting
router.get('/api/version', (req, res) => {
    const packageJson = require('../package.json');
    res.set('Cache-Control', 'no-store');
    res.json({
        version: packageJson.version,
        timestamp: Date.now(),
        cacheVersion: serviceWorkerCacheName || 'unknown',
        // What's new for users, or null: the banner only appears when a
        // release has something worth announcing (see lib/release-notes.js)
        release: latestRelease({ gif: gifEnabled(), klipy: klipyEnabled() })
    });
});

// Incremental updates endpoint
router.get('/api/updates', requireAuth, (req, res) => {
    const since = req.query.since || 0;
    const updates = updateTracker.getUpdatesSince(since);

    res.json({
        hasUpdates: updates.length > 0,
        updates: updates,
        timestamp: Date.now()
    });
});

module.exports = router;

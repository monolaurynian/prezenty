// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const { DEMO_MODE, isMaintenanceMode } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { updateTracker } = require('../lib/update-tracker');

// Routes
router.get('/health', (req, res) => {
    res.status(200).json({
        status: isMaintenanceMode() ? 'MAINTENANCE' : 'OK',
        timestamp: new Date().toISOString(),
        mode: isMaintenanceMode() ? 'MAINTENANCE' : (DEMO_MODE ? 'DEMO' : 'PRODUCTION'),
        database: (DEMO_MODE || isMaintenanceMode()) ? 'disabled' : 'enabled'
    });
});

// Version endpoint for cache busting
router.get('/api/version', (req, res) => {
    const packageJson = require('../package.json');
    res.json({
        version: packageJson.version,
        timestamp: Date.now(),
        cacheVersion: 'v8'
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

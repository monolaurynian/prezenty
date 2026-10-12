'use strict';
const { defineConfig } = require('@playwright/test');

/**
 * Prezenty end-to-end suite.
 *
 * The real server.js is booted once per run by tests/global-setup.js (demo
 * mode, free ephemeral port) which exports E2E_BASE_URL into the environment
 * worker processes inherit. `baseURL` below reads it; tests/fixtures.js
 * re-declares the same option so the authoritative value is always the one
 * the running server picked.
 *
 * channel: 'msedge' uses the Edge already installed on this machine, so
 * `npx playwright install` is never needed.
 */
module.exports = defineConfig({
    testDir: './tests/e2e',
    outputDir: './tests/.results',
    globalSetup: require.resolve('./tests/global-setup.js'),

    // One server, one shared in-memory demo dataset, one demo user (id 1).
    // Parallel workers would race on mutable demo state.
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,

    timeout: 30000,
    expect: { timeout: 5000 },

    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: 'tests/.report' }]
    ],

    use: {
        baseURL: process.env.E2E_BASE_URL,
        channel: 'msedge',
        headless: true,
        // index.html / ustawienia.html register a service worker; a warm SW
        // cache would make assertions depend on run order.
        serviceWorkers: 'block',
        storageState: 'tests/.auth/demo.json',
        // Assertion-first: artifacts only when something actually fails.
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
        actionTimeout: 10000,
        navigationTimeout: 15000
    }
});

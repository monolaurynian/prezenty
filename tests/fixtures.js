'use strict';
/**
 * Shared test fixtures. Every spec imports { test, expect } from here rather
 * than from '@playwright/test' directly, so it automatically gets:
 *   - baseURL pointing at the demo server global-setup booted,
 *   - the CDN read-through cache (Bootstrap / icon fonts),
 *   - uncaught page errors collected and failed on,
 *   - the pre-authenticated session from tests/.auth/demo.json (via config).
 */

const base = require('@playwright/test');
const { installCdnCache, cdnGuardMessage } = require('./helpers/cdn-cache');

const test = base.test.extend({
    // The port is only known at runtime, so the authoritative baseURL is the
    // env var global-setup exported. Declared as an option so the built-in
    // `context` fixture picks it up exactly like a config `use.baseURL`.
    baseURL: [async ({}, use) => {
        const url = process.env.E2E_BASE_URL;
        if (!url) {
            throw new Error('E2E_BASE_URL is not set - tests/global-setup.js did not run. ' +
                'Run the suite through `npm run test:e2e`, not `npx playwright test --no-config`.');
        }
        await use(url);
    }, { option: true }],

    // Page errors a spec is willing to tolerate, as regex sources.
    // Override per-file with test.use({ ignorePageErrors: ['foo'] }).
    ignorePageErrors: [[], { option: true }],

    context: async ({ context }, use, testInfo) => {
        const cdn = await installCdnCache(context);
        await use(context);
        const msg = cdnGuardMessage(cdn);
        if (msg && testInfo.status === 'failed') {
            // Surface the real cause next to the assertion failure.
            console.error('[e2e] ' + msg);
        } else if (msg) {
            throw new Error(msg);
        }
    },

    /** Uncaught exceptions thrown by page scripts. */
    pageErrors: async ({}, use) => {
        await use([]);
    },

    /** console.error(...) calls made by page scripts. Informational. */
    consoleErrors: async ({}, use) => {
        await use([]);
    },

    page: async ({ page, pageErrors, consoleErrors, ignorePageErrors }, use) => {
        page.on('pageerror', err => pageErrors.push(String(err && err.stack || err)));
        page.on('console', msg => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await use(page);

        const patterns = (ignorePageErrors || []).map(p => new RegExp(p));
        const unexpected = pageErrors.filter(e => !patterns.some(re => re.test(e)));
        if (unexpected.length) {
            throw new Error(
                `Page threw ${unexpected.length} uncaught error(s):\n\n` + unexpected.join('\n\n')
            );
        }
    }
});

module.exports = { test, expect: base.expect };

'use strict';
/**
 * The shared bottom dock on the other pages (home and recipients): it does
 * one clean thing on scroll and the page's scroll height never moves.
 * Shared setup lives in tests/helpers/composer.js.
 */
const { test, expect } = require('../fixtures');
const { PAGES, openPage } = require('../helpers/pages');
const { wheel } = require('../helpers/composer');

const HOME = PAGES.find(p => p.name === 'home');
const RECIPIENTS = PAGES.find(p => p.name === 'recipients');

test.describe('the shared dock on the other pages', () => {
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    // body.dock-hidden and the bottom-tab-bar.css selector are shared by 8
    // pages. These two carry the most furniture near the dock.
    //
    // Note the two shapes of "correct" here. initTabBarAutoHide() runs at
    // parse time and gives up if the dock is not in the DOM yet, and
    // recipients.html loads tab-bar-functions.js (line ~2449) BEFORE its
    // .bottom-tab-bar markup (~2452) - so hide-on-scroll has never been
    // active on that page, before or after this change. `resetDockAutoHide`
    // is only exported past that early return, which makes it an exact
    // probe for "is auto-hide live on this page". Either way the assertion
    // is the same in spirit: the dock does one clean thing and the page's
    // scroll height never moves.
    for (const descriptor of [HOME, RECIPIENTS]) {
        test(`${descriptor.name}: the shared dock behaves and nothing churns`, async ({ page }) => {
            // home.html reloads itself once per fresh profile (its own
            // cache-busting block), which occasionally aborts the navigation
            // openPage is waiting on. Retry rather than fail on it.
            for (let attempt = 0; ; attempt++) {
                try {
                    await openPage(page, descriptor);
                    break;
                } catch (err) {
                    const retryable = /ERR_ABORTED|Execution context was destroyed|frame was detached/i
                        .test(String(err && err.message || err));
                    if (!retryable || attempt === 2) throw err;
                }
            }
            await page.evaluate(() => {
                window.__e2eDockChanges = 0;
                let last = document.body.classList.contains('dock-hidden');
                window.__e2eDockObserver = new MutationObserver(() => {
                    const now = document.body.classList.contains('dock-hidden');
                    if (now !== last) { window.__e2eDockChanges++; last = now; }
                });
                window.__e2eDockObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
                window.__e2eHeights = new Set([document.documentElement.scrollHeight]);
                window.__e2eHeightTimer = setInterval(() => {
                    window.__e2eHeights.add(document.documentElement.scrollHeight);
                }, 16);
            });

            await wheel(page, 30, 22);
            await page.waitForTimeout(420);
            const result = await page.evaluate(() => {
                clearInterval(window.__e2eHeightTimer);
                window.__e2eDockObserver.disconnect();
                const dock = document.querySelector('.bottom-tab-bar');
                return {
                    autoHide: typeof window.resetDockAutoHide === 'function',
                    changes: window.__e2eDockChanges,
                    heights: Array.from(window.__e2eHeights),
                    hidden: document.body.classList.contains('dock-hidden'),
                    dockTop: Math.round(dock.getBoundingClientRect().top),
                    transform: getComputedStyle(dock).transform,
                    innerHeight: window.innerHeight,
                    shift: document.body.style.getPropertyValue('--dock-hide-shift'),
                    scrollY: Math.round(window.scrollY)
                };
            });
            const label = `${descriptor.name}: ` + JSON.stringify(result);
            expect(result.heights.length, 'the page height must not move while scrolling. ' + label).toBe(1);
            // No page-local travel variable here: the shared CSS fallback runs.
            expect(result.shift, 'only formularz sets --dock-hide-shift. ' + label).toBe('');
            expect(result.scrollY, 'the page must actually have scrolled. ' + label).toBeGreaterThan(100);

            if (!result.autoHide) {
                // Pre-existing on recipients.html: the script runs before the
                // dock markup, so auto-hide never armed. The shared change
                // must leave that exactly as it was - a dock that never moves.
                expect(result.changes, label).toBe(0);
                expect(result.hidden, label).toBe(false);
                expect(result.transform, label).toBe('none');
                return;
            }

            expect(result.changes, 'dock state changes for one gesture. ' + label).toBeLessThanOrEqual(2);
            expect(result.hidden, label).toBe(true);
            expect(result.dockTop, label).toBeGreaterThanOrEqual(result.innerHeight);

            await wheel(page, 3, -24);
            await page.waitForTimeout(420);
            const back = await page.evaluate(() => ({
                hidden: document.body.classList.contains('dock-hidden'),
                transform: getComputedStyle(document.querySelector('.bottom-tab-bar')).transform,
                opacity: getComputedStyle(document.querySelector('.bottom-tab-bar')).opacity
            }));
            expect(back.hidden, descriptor.name + ' ' + JSON.stringify(back)).toBe(false);
            expect(back.transform, descriptor.name + ' ' + JSON.stringify(back)).toBe('none');
            expect(back.opacity, descriptor.name + ' ' + JSON.stringify(back)).toBe('1');
        });
    }
});

'use strict';
/**
 * The pages under test and how to tell they have finished rendering.
 *
 * Every page fetches its content from the API after load, so measuring right
 * after `goto` would measure a spinner. `ready` is a selector that only exists
 * once real data is on screen - a web-first wait, no sleeps.
 */

// ---------------------------------------------------------------------------
// HOW TO ADD A PAGE
//
// Append one object to PAGES below. Fields:
//   path        URL path (plus query) passed to page.goto. Relative to baseURL.
//   name        Short unique label. It becomes part of the TEST TITLE in every
//               spec that loops over PAGES (e.g. "ustawienia: page content is
//               reachable and announceable"), so renaming one renames tests.
//   ready       CSS selector that only exists once real data is on screen.
//               openPage waits for its first match to be attached, then for
//               fonts and for layout to stop moving. Pick something rendered
//               by the page's own fetch, never a static shell element.
//   reloadsOnce Optional. Set it only for a page that reloads itself once per
//               fresh profile (home.html does); openPage then navigates twice.
//
// Specs that consume PAGES (a new entry is automatically enlisted in all of them):
//   tests/e2e/a11y.spec.js                    two tests per page: page content
//                                             is reachable (runs) and every
//                                             icon-only control has a name (a
//                                             test.fixme today, so each page
//                                             adds one more known fixme)
//   tests/e2e/no-horizontal-overflow.spec.js  one test per page, at every width
//                                             in VIEWPORTS
//   tests/e2e/composer-shared-dock.spec.js    looks up 'home' and 'recipients'
//                                             by name via PAGES.find - do not
//                                             rename those two
//
// NOT driven by PAGES (they keep their own lists on purpose): smoke.spec.js
// (path + name only, and it also visits /formularz), the single-page specs
// (chat-reactions, edit-sheet, escaping, pluralization, wrapping,
// xss-usernames) and /intro.html, which is deliberately not here because
// listing it would enlist it in the a11y and overflow matrices.
// ---------------------------------------------------------------------------
const PAGES = [
    // home.html runs a one-shot cache-busting reload (home.html:12-43): on a
    // profile where localStorage has no `homePageVersion` it sets the flag and
    // reloads itself 500ms later. Every Playwright context is a fresh profile,
    // so that reload ALWAYS fires and lands in the middle of whatever the test
    // is doing. `reloadsOnce` makes openPage navigate twice: the second visit
    // finds the version already stored and skips the block entirely.
    {
        path: '/', name: 'home', reloadsOnce: true,
        ready: '#availablePresentsList .present-name, #availablePresentsList .list-group-item, #availablePresentsList'
    },
    { path: '/recipients', name: 'recipients', ready: '.present-name' },
    { path: '/osoby', name: 'osoby', ready: '#peopleContent' },
    { path: '/activity', name: 'activity', ready: '.notification-item' },
    { path: '/leaderboard.html', name: 'leaderboard', ready: '.activity-card' },
    { path: '/wiadomosci', name: 'wiadomosci-list', ready: '.thread-row' },
    { path: '/wiadomosci?rozmowa=1', name: 'wiadomosci-thread', ready: '.chat-bubble' },
    { path: '/rezerwacje', name: 'rezerwacje', ready: '#reservedContent' },
    { path: '/archiwum', name: 'archiwum', ready: '#archiveContent' },
    { path: '/ustawienia', name: 'ustawienia', ready: 'h1, h2, h5' }
];

const VIEWPORTS = [320, 360, 375, 414, 768, 1024];

/**
 * Wait until layout stops moving, instead of sleeping and hoping.
 *
 * Needed because a viewport change is not instantly reflected: for roughly
 * half a second after a resize the chat page lays `.container` out
 * shrink-to-fit (28px inside a 320px body) before settling at the full width.
 * Measuring in that window produced a confident, completely bogus overflow
 * report. The signature below is compared across consecutive animation
 * frames and must hold steady before anything is measured.
 */
async function waitForLayoutSettled(page, timeout) {
    // Deliberately a NARROW signature: the page's own widths, not every box.
    // Sampling every div never stabilises - spinners, pulsing badges and the
    // Christmas countdown keep changing size forever.
    await page.waitForFunction(() => {
        const root = document.scrollingElement || document.documentElement;
        const containers = Array.prototype.slice.call(document.querySelectorAll('.container, .container-fluid'))
            .map(el => Math.round(el.getBoundingClientRect().width))
            .join(',');
        // Also track every scroll container, because those are exactly what
        // the overflow detector measures - #chatMessages reports clientWidth 0
        // for a moment after a resize while `.container` is already stable.
        const scrollers = Array.prototype.slice.call(document.querySelectorAll('*'))
            .filter(el => ['auto', 'scroll'].indexOf(getComputedStyle(el).overflowX) !== -1)
            .map(el => el.clientWidth + ':' + el.scrollWidth)
            .join(',');
        const current = [root.scrollWidth, root.clientWidth, document.body.clientWidth, containers, scrollers].join('|');
        if (current === window.__e2eLayoutSignature) {
            window.__e2eLayoutStable = (window.__e2eLayoutStable || 0) + 1;
        } else {
            window.__e2eLayoutSignature = current;
            window.__e2eLayoutStable = 0;
        }
        return window.__e2eLayoutStable >= 2;
    }, undefined, { timeout: timeout || 10000, polling: 150 });
    await page.evaluate(() => {
        window.__e2eLayoutSignature = undefined;
        window.__e2eLayoutStable = 0;
    });
}

/**
 * Navigate and wait until the page has real content on screen AND layout has
 * stopped moving.
 * @param {import('@playwright/test').Page} page
 */
async function openPage(page, descriptor) {
    // 'load' (not 'domcontentloaded') so every stylesheet has arrived - a late
    // stylesheet is one of the things that makes layout jump.
    await page.goto(descriptor.path, { waitUntil: 'load' });

    if (descriptor.reloadsOnce) {
        // Second visit: the one-shot reload has already recorded its flag, so
        // this load is stable. Navigating also cancels any pending timer from
        // the first load.
        await page.goto(descriptor.path, { waitUntil: 'load' });
    }

    // Belt and braces: if the page navigates under us anyway, redo the wait on
    // the new document instead of failing with "Execution context was
    // destroyed".
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await page.locator(descriptor.ready).first().waitFor({ state: 'attached', timeout: 15000 });
            await page.evaluate(() => document.fonts && document.fonts.ready);
            await waitForLayoutSettled(page);
            return;
        } catch (err) {
            const message = String((err && err.message) || err);
            const navigated = /Execution context was destroyed|navigating and changing the document|frame was detached|Target closed/i.test(message);
            if (!navigated || attempt === 2) throw err;
            await page.waitForLoadState('load');
        }
    }
}

/** Change width and wait for the new layout to stop moving. */
async function setViewport(page, width, height) {
    await page.setViewportSize({ width, height: height || 740 });
    await waitForLayoutSettled(page);
}

module.exports = { PAGES, VIEWPORTS, openPage, setViewport, waitForLayoutSettled };

'use strict';
/**
 * The add-present composer and the bottom dock moving as one unit:
 * hide-on-scroll, entering add mode from a hidden dock, scroll position,
 * and the reduced-motion variant. Uses the per-frame sampler in
 * tests/helpers/composer-sampler.js; shared setup lives in
 * tests/helpers/composer.js.
 */
const { test, expect } = require('../fixtures');
const { sampleScrollY, describeSamples } = require('../helpers/scroll');
const { COMPOSER, DOCK, PHONES, openComposer, wheel, scrollUntilDockHidden } = require('../helpers/composer');
const { startSampler, stopSampler, report } = require('../helpers/composer-sampler');

test.describe('add-present composer', () => {
    // hasTouch so tap() is available; the viewport is set per test.
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    // Several tests here walk three phone widths, each with a fresh page
    // load and ~1s of scripted scrolling - about 12s on a quiet machine, and
    // it measured 3x that when OneDrive was syncing this folder. The suite's
    // 30s default turned that slowness into a timeout inside page.goto,
    // which is a failure that says nothing about the composer.
    test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(90000); });

    test('entering add mode from a scroll-hidden dock does not move the composer', async ({ page }) => {
        // THE REGRESSION THIS FILE EXISTS FOR. The composer is moved by
        // `transform` while the dock is scroll-hidden and by `bottom` in add
        // mode. Entering from a hidden dock changes both at once, and they
        // only cancel while they share a duration and an easing - otherwise
        // the bar snaps ~98px up and glides back over 250ms on the commonest
        // path there is: scroll down the list, tap the bar.
        for (const width of PHONES) {
            await openComposer(page, width);
            const hidden = await scrollUntilDockHidden(page);
            expect(hidden, `@${width}px the dock must hide on scroll before this can be tested`).toBe(true);

            const before = await page.evaluate(() => {
                const r = document.getElementById('quickAddForm').getBoundingClientRect();
                return Math.round((window.innerHeight - r.bottom) * 100) / 100;
            });

            await startSampler(page);
            await page.locator(COMPOSER).tap();
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
            await page.waitForTimeout(520); // the whole 250ms move, and then some
            const m = await stopSampler(page);

            const label = report(`@${width}px entry from dock-hidden (resting offset ${before}px)`, m);
            expect(m.maxComposerStep, 'single-frame composer displacement. ' + label).toBeLessThanOrEqual(2);
            expect(m.maxComposerOffset - m.minComposerOffset,
                'total composer travel during entry. ' + label).toBeLessThanOrEqual(2);
            const last = m.frames[m.frames.length - 1];
            expect(last.addMode, label).toBe(true);
            expect(last.dockHidden, 'add mode must clear dock-hidden. ' + label).toBe(false);
            expect(last.transform, 'the composer must sit untransformed in add mode. ' + label).toBe('none');
        }
    });

    test('the composer and the dock hide as one unit, with no padding or scrollHeight churn', async ({ page }) => {
        for (const width of PHONES) {
            await openComposer(page, width);
            const resting = await page.evaluate(() => {
                const c = document.getElementById('quickAddForm').getBoundingClientRect();
                const d = document.querySelector('.bottom-tab-bar').getBoundingClientRect();
                return Math.round((d.top - c.bottom) * 100) / 100;
            });

            await startSampler(page);
            await wheel(page, 30, 22); // one continuous downward gesture
            await page.waitForTimeout(420);
            const m = await stopSampler(page);
            const label = report(`@${width}px 30x22px downward gesture (resting gap ${resting}px)`, m);

            // The root cause: the reserved padding (and with it scrollHeight)
            // must not move while the dock hides.
            expect(m.scrollHeights.length, 'distinct document.scrollHeight values. ' + label).toBe(1);
            expect(m.paddings.length, 'distinct body padding-bottom values. ' + label).toBe(1);
            expect(m.quickAddBottomWrites, '--quick-add-bottom writes during the gesture. ' + label).toBe(0);
            expect(m.dockAttrMutations, '.bottom-tab-bar attribute mutations. ' + label).toBe(0);
            expect(m.dockStateChanges, 'dock state changes for one gesture. ' + label).toBeLessThanOrEqual(2);
            // One unit: the gap between them never opens.
            expect(Math.abs(m.minGap - resting), 'gap floor. ' + label).toBeLessThanOrEqual(1);
            expect(Math.abs(m.maxGap - resting), 'gap ceiling. ' + label).toBeLessThanOrEqual(1);
            // Both travel, and they travel together.
            expect(m.maxComposerOffset - m.minComposerOffset, 'composer travel. ' + label).toBeGreaterThan(40);
            expect(Math.abs(m.maxComposerStep - m.maxDockStep),
                'per-frame step difference between composer and dock. ' + label).toBeLessThanOrEqual(1);
        }
    });

    test('one downward tick after a flick up changes the dock state exactly once', async ({ page }) => {
        await openComposer(page, 375);
        await wheel(page, 30, 22);
        await page.waitForTimeout(420);
        await wheel(page, 2, -20); // flick up: the dock comes back
        await page.waitForTimeout(420);
        expect(await page.evaluate(() => document.body.classList.contains('dock-hidden'))).toBe(false);

        await startSampler(page);
        await page.mouse.wheel(0, 30);
        await page.waitForTimeout(500);
        const m = await stopSampler(page);
        const label = report('single 30px tick after a flick up', m);
        expect(m.dockStateChanges, label).toBe(1);
        expect(m.scrollHeights.length, label).toBe(1);
        const last = m.frames[m.frames.length - 1];
        expect(last.dockHidden, label).toBe(true);
        expect(last.dockTop, 'the dock must complete its travel below the fold. ' + label)
            .toBeGreaterThanOrEqual(last.innerHeight);
    });

    test('hide-on-scroll is inert during add mode and recovers on exit from any scroll position', async ({ page }) => {
        await openComposer(page, 375);
        await scrollUntilDockHidden(page);
        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(400);

        // Deliberate add-mode hiding: visibility + inert + aria-hidden, which
        // the transient scroll hide never touches.
        const dock = await page.locator(DOCK).evaluate(el => ({
            visibility: getComputedStyle(el).visibility,
            inert: el.inert === true || el.hasAttribute('inert'),
            ariaHidden: el.getAttribute('aria-hidden'),
            dockHidden: document.body.classList.contains('dock-hidden')
        }));
        expect(dock.visibility, JSON.stringify(dock)).toBe('hidden');
        expect(dock.inert, JSON.stringify(dock)).toBe(true);
        expect(dock.ariaHidden, JSON.stringify(dock)).toBe('true');
        expect(dock.dockHidden, 'the two hiding mechanisms must never both be on').toBe(false);

        // Scrolling both ways inside add mode must change nothing at all.
        await startSampler(page);
        await wheel(page, 8, 24);
        await wheel(page, 8, -24);
        await page.waitForTimeout(200);
        const m = await stopSampler(page);
        const label = report('scrolling inside add mode', m);
        expect(m.dockStateChanges, label).toBe(0);
        expect(m.dockAttrMutations, label).toBe(0);
        expect(m.quickAddBottomWrites, label).toBe(0);

        // Exit with the last motion downward: the dock must come back anyway.
        await wheel(page, 4, 24);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(450);
        const after = await page.locator(DOCK).evaluate(el => ({
            visibility: getComputedStyle(el).visibility,
            transform: getComputedStyle(el).transform,
            opacity: getComputedStyle(el).opacity,
            inert: el.inert === true || el.hasAttribute('inert'),
            ariaHidden: el.getAttribute('aria-hidden'),
            dockHidden: document.body.classList.contains('dock-hidden'),
            scrollY: Math.round(window.scrollY)
        }));
        expect(after.dockHidden, JSON.stringify(after)).toBe(false);
        expect(after.visibility, JSON.stringify(after)).toBe('visible');
        expect(after.transform, JSON.stringify(after)).toBe('none');
        expect(after.opacity, JSON.stringify(after)).toBe('1');
        expect(after.inert, JSON.stringify(after)).toBe(false);
        expect(after.ariaHidden, JSON.stringify(after)).toBe(null);
        expect(after.scrollY, 'the exit must not have jumped back to the top').toBeGreaterThan(0);
    });

    test('entering add mode does not move the scroll position, including at the very bottom', async ({ page }) => {
        await openComposer(page, 375);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(450);
        const samples = await sampleScrollY(page, async () => {
            await page.locator(COMPOSER).tap();
        });
        const first = samples[0].scrollY;
        samples.forEach(s => {
            expect(Math.abs(s.scrollY - first),
                describeSamples('entry at max scroll', samples)).toBeLessThanOrEqual(2);
        });
        expect(await page.evaluate(() => document.body.classList.contains('quick-add-active'))).toBe(true);
    });

    test('the last present and "Dodaj dla kogoś innego" stay reachable with the dock shown and hidden', async ({ page }) => {
        await openComposer(page, 375);
        const measure = () => page.evaluate(() => {
            const items = document.querySelectorAll('#myPresentsList .my-present-item');
            const last = items[items.length - 1];
            const other = document.querySelector('.add-for-other-wrap button');
            const composer = document.getElementById('quickAddForm').getBoundingClientRect();
            return {
                dockHidden: document.body.classList.contains('dock-hidden'),
                lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
                otherBottom: other ? Math.round(other.getBoundingClientRect().bottom) : null,
                composerTop: Math.round(composer.top),
                scrollY: Math.round(window.scrollY),
                maxScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight)
            };
        });

        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(450);
        const atBottom = await measure();
        // The near-bottom force-show: the reader lands at the end of the page
        // with both bars on screen, which is the state the padding is sized for.
        expect(atBottom.dockHidden, 'the dock must be shown at the bottom of the page: ' +
            JSON.stringify(atBottom)).toBe(false);
        expect(atBottom.lastBottom, 'last present clipped by the composer: ' + JSON.stringify(atBottom))
            .toBeLessThanOrEqual(atBottom.composerTop);
        expect(atBottom.otherBottom, '"Dodaj dla kogoś innego" clipped by the composer: ' +
            JSON.stringify(atBottom)).toBeLessThanOrEqual(atBottom.composerTop);

        // And with the dock transform-hidden mid-page: nothing is clipped either.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        await scrollUntilDockHidden(page);
        const midScroll = await measure();
        expect(midScroll.dockHidden, JSON.stringify(midScroll)).toBe(true);
        expect(midScroll.composerTop, 'the hidden composer must be below the fold: ' +
            JSON.stringify(midScroll)).toBeGreaterThan(0);
    });
});

test.describe('add-present composer with reduced motion', () => {
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    test('the composer and the dock change state instantly', async ({ page }) => {
        // page.emulateMedia, not test.use({ reducedMotion }): the option did
        // not reach the page through this project's context fixture
        // (matchMedia('(prefers-reduced-motion: reduce)') stayed false), so
        // the emulation is applied explicitly and asserted before anything
        // is measured.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openComposer(page, 375);
        const transitions = await page.evaluate(() => ({
            matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            composer: getComputedStyle(document.getElementById('quickAddForm')).transition,
            dock: getComputedStyle(document.querySelector('.bottom-tab-bar')).transition
        }));
        expect(transitions.matches, 'reduced motion must actually be emulated: ' +
            JSON.stringify(transitions)).toBe(true);
        expect(transitions.composer, JSON.stringify(transitions)).toContain('none');
        expect(transitions.dock, JSON.stringify(transitions)).toContain('none');

        // 60ms after the flag lands, both are already fully translated.
        await wheel(page, 20, 22);
        await page.waitForFunction(() => document.body.classList.contains('dock-hidden'),
            undefined, { timeout: 5000 });
        await page.waitForTimeout(60);
        const moved = await page.evaluate(() => {
            const c = document.getElementById('quickAddForm').getBoundingClientRect();
            const d = document.querySelector('.bottom-tab-bar').getBoundingClientRect();
            return {
                composerOffset: Math.round(window.innerHeight - c.bottom),
                dockTop: Math.round(d.top),
                innerHeight: window.innerHeight,
                gap: Math.round(d.top - c.bottom)
            };
        });
        expect(moved.composerOffset, JSON.stringify(moved)).toBeLessThanOrEqual(14);
        expect(moved.dockTop, JSON.stringify(moved)).toBeGreaterThanOrEqual(moved.innerHeight);

        // Entry from the hidden state is instant too, and lands in the right place.
        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(60);
        const entered = await page.evaluate(() => {
            const c = document.getElementById('quickAddForm').getBoundingClientRect();
            return {
                composerOffset: Math.round(window.innerHeight - c.bottom),
                transform: getComputedStyle(document.getElementById('quickAddForm')).transform
            };
        });
        expect(entered.transform, JSON.stringify(entered)).toBe('none');
        expect(entered.composerOffset, JSON.stringify(entered)).toBeLessThanOrEqual(14);
    });
});

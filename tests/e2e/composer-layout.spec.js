'use strict';
/**
 * The add-present composer on /formularz: geometry that must hold at the
 * extremes - the edit sheet textarea height, no horizontal overflow at
 * 320px, and the unchanged inline card on desktop. Shared setup lives in
 * tests/helpers/composer.js.
 */
const { test, expect } = require('../fixtures');
const { openPage } = require('../helpers/pages');
const { collectOverflow, describeOverflow } = require('../helpers/overflow');
const { FORMULARZ, COMPOSER, DOCK, STATE, openComposer } = require('../helpers/composer');

test.describe('add-present composer', () => {
    // hasTouch so tap() is available; the viewport is set per test.
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    // Several tests here walk three phone widths, each with a fresh page
    // load and ~1s of scripted scrolling - about 12s on a quiet machine, and
    // it measured 3x that when OneDrive was syncing this folder. The suite's
    // 30s default turned that slowness into a timeout inside page.goto,
    // which is a failure that says nothing about the composer.
    test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(90000); });

    test('the edit sheet\'s "Dodatkowe informacje" box is tall by default here too', async ({ page }) => {
        await openComposer(page, 375);
        // The sheet itself is covered by edit-sheet.spec.js on /recipients;
        // this is the formularz copy of the same textarea, asserted on its
        // computed min-height so the sheet does not have to be opened.
        const minHeight = await page.locator('#editPresentComments')
            .evaluate(el => parseFloat(getComputedStyle(el).minHeight));
        expect(minHeight, `min-height ${minHeight}px`).toBeGreaterThanOrEqual(120);
    });

    test('no horizontal overflow at 320px, collapsed or open', async ({ page }) => {
        await openComposer(page, 320);
        const collapsed = await collectOverflow(page, { ignoreGuard: true });
        expect(collapsed.offenders, describeOverflow('collapsed @320px', collapsed)).toEqual([]);
        expect(collapsed.scrollers, describeOverflow('collapsed @320px', collapsed)).toEqual([]);

        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(400);
        const open = await collectOverflow(page, { ignoreGuard: true });
        expect(open.offenders, describeOverflow('add mode @320px', open)).toEqual([]);
        expect(open.scrollers, describeOverflow('add mode @320px', open)).toEqual([]);
    });
});

test.describe('add-present composer on desktop', () => {
    test.use({ viewport: { width: 1024, height: 800 } });

    test('the inline card is unchanged: visible "+", no collapsed state, no dock', async ({ page }) => {
        await openPage(page, FORMULARZ);
        await expect(page.locator(COMPOSER)).toBeVisible();
        const s = await page.evaluate(STATE);
        expect(s.docked, JSON.stringify(s)).toBe(false);
        expect(s.addMode, JSON.stringify(s)).toBe(false);
        expect(s.submit.visibility, 'the card\'s primary button must be visible: ' + JSON.stringify(s.submit))
            .toBe('visible');
        expect(s.cue.display, 'the compact cue must not render on desktop').toBe('none');
        expect(s.toggle.display, 'the chevron must not render on desktop').toBe('none');
        expect(s.close.display, 'there is nothing to close on desktop').toBe('none');
        expect(s.placeholder).toBe('Nazwa prezentu…');
        const scrim = await page.locator('#quickAddScrim').evaluate(el => getComputedStyle(el).display);
        expect(scrim, 'no scrim on desktop').toBe('none');
        const dock = await page.locator(DOCK).evaluate(el => getComputedStyle(el).display);
        expect(dock, 'the dock is replaced by the sidebar on desktop').toBe('none');
        const shift = await page.evaluate(() =>
            document.body.style.getPropertyValue('--dock-hide-shift'));
        expect(shift, 'the composer travel variable must not leak to desktop').toBe('');
    });
});

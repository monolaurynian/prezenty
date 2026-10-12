'use strict';
/**
 * "Edytuj prezent" bottom sheet - the thumb-reach fix.
 *
 * The user's complaint was that the edit popup opened pinned to the TOP of
 * the screen, out of thumb reach, and that the "Dodatkowe informacje"
 * textarea was too short. Both are asserted on measured geometry, plus the
 * dialog basics: focus trap, Escape, focus returned to the trigger.
 *
 * Driven from /recipients only - /formularz is owned by another workflow.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { tabCycle } = require('../helpers/a11y');

const RECIPIENTS = { path: '/recipients', name: 'recipients', ready: '.present-title, .present-name' };

const MODAL = '#editPresentModal';
const DIALOG = '#editPresentModal .modal-dialog';
const CONTENT = '#editPresentModal .modal-content';
const COMMENTS = '#editPresentComments';

/**
 * The edit buttons live inside the collapsed "Twoje prezenty - kliknij, aby
 * edytować" accordion, so it has to be expanded before anything is clickable.
 */
async function expandOwnPresents(page) {
    const toggle = page.locator('button.accordion-button[data-bs-target="#accordion-own-2-collapse"]');
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('class')).includes('collapsed')) {
        await toggle.click();
    }
    await expect(page.locator('#accordion-own-2-collapse')).toHaveClass(/show/);
}

/**
 * Open the sheet and wait for Bootstrap's own "finished opening" event.
 *
 * The `show` class lands when the slide-up STARTS. Measuring then reports the
 * dialog still at translateY(100%) - 385px below the viewport bottom - and
 * both Escape and the focus trap are not armed yet. Waiting on
 * `shown.bs.modal` is the app's own signal, so this is not a sleep.
 */
async function openSheet(page) {
    await expandOwnPresents(page);
    const trigger = page.locator('button.edit-present-btn[data-present-id]').first();
    await expect(trigger).toBeVisible();
    await trigger.evaluate(el => el.setAttribute('data-e2e-trigger', '1'));

    await page.evaluate(() => {
        window.__e2eModalShown = false;
        document.getElementById('editPresentModal')
            .addEventListener('shown.bs.modal', () => { window.__e2eModalShown = true; }, { once: true });
    });
    await trigger.click();
    await page.waitForFunction(() => window.__e2eModalShown === true, undefined, { timeout: 10000 });
    await expect(page.locator(MODAL)).toHaveClass(/show/);
    await expect(page.locator(CONTENT)).toBeVisible();
    return trigger;
}

/** Close with Escape and wait for Bootstrap's `hidden.bs.modal`. */
async function closeSheetWithEscape(page) {
    await page.evaluate(() => {
        window.__e2eModalHidden = false;
        document.getElementById('editPresentModal')
            .addEventListener('hidden.bs.modal', () => { window.__e2eModalHidden = true; }, { once: true });
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__e2eModalHidden === true, undefined, { timeout: 10000 });
    await expect(page.locator(MODAL)).not.toHaveClass(/show/);
}

test.describe('edit present bottom sheet', () => {
    test('on a phone it is pinned to the bottom edge and capped at ~90% height', async ({ page }) => {
        await openPage(page, RECIPIENTS);

        for (const width of [320, 375]) {
            await setViewport(page, width, 740);
            await openSheet(page);

            const geometry = await page.locator(DIALOG).evaluate(el => {
                const rect = el.getBoundingClientRect();
                const content = el.querySelector('.modal-content');
                const contentStyle = getComputedStyle(content);
                return {
                    position: getComputedStyle(el).position,
                    bottom: rect.bottom,
                    left: rect.left,
                    right: rect.right,
                    viewportHeight: window.innerHeight,
                    viewportWidth: window.innerWidth,
                    contentMaxHeight: parseFloat(contentStyle.maxHeight),
                    borderRadius: contentStyle.borderTopLeftRadius + ' / ' + contentStyle.borderBottomLeftRadius
                };
            });

            expect(geometry.position, `@${width}px dialog must be fixed`).toBe('fixed');
            expect(Math.abs(geometry.bottom - geometry.viewportHeight),
                `@${width}px dialog bottom ${geometry.bottom} vs viewport ${geometry.viewportHeight}`)
                .toBeLessThanOrEqual(1);
            expect(geometry.left, `@${width}px dialog must be full width`).toBeLessThanOrEqual(1);
            expect(Math.abs(geometry.right - geometry.viewportWidth)).toBeLessThanOrEqual(1);
            // 90dvh cap
            expect(geometry.contentMaxHeight, `@${width}px max-height ${geometry.contentMaxHeight} of ${geometry.viewportHeight}`)
                .toBeCloseTo(geometry.viewportHeight * 0.9, 0);
            // Rounded on top, square at the bottom - it is attached to the edge
            expect(geometry.borderRadius).toBe('20px / 0px');

            await closeSheetWithEscape(page);
        }
    });

    test('on a wide screen it is NOT bottom-pinned', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 1024, 740);
        await openSheet(page);

        const geometry = await page.locator(DIALOG).evaluate(el => {
            const rect = el.getBoundingClientRect();
            return {
                position: getComputedStyle(el).position,
                bottom: rect.bottom,
                viewportHeight: window.innerHeight,
                radius: getComputedStyle(el.querySelector('.modal-content')).borderBottomLeftRadius
            };
        });
        expect(geometry.position, 'the mobile rule must not leak to desktop').not.toBe('fixed');
        expect(geometry.bottom, 'dialog must not touch the bottom edge on desktop')
            .toBeLessThan(geometry.viewportHeight - 5);
        expect(geometry.radius).not.toBe('0px');
    });

    test('the "Dodatkowe informacje" textarea is tall by default and vertically resizable', async ({ page }) => {
        await openPage(page, RECIPIENTS);

        await setViewport(page, 375, 740);
        await openSheet(page);
        const phone = await page.locator(COMMENTS).evaluate(el => {
            const s = getComputedStyle(el);
            return { height: el.getBoundingClientRect().height, minHeight: parseFloat(s.minHeight), resize: s.resize };
        });
        expect(phone.minHeight, `min-height ${phone.minHeight}px at 375px`).toBeGreaterThanOrEqual(120);
        expect(phone.height).toBeGreaterThanOrEqual(120);
        expect(phone.resize).toBe('vertical');
        await closeSheetWithEscape(page);

        await setViewport(page, 1024, 900);
        await openSheet(page);
        const desktop = await page.locator(COMMENTS).evaluate(el => {
            const s = getComputedStyle(el);
            return { height: el.getBoundingClientRect().height, minHeight: parseFloat(s.minHeight), resize: s.resize };
        });
        expect(desktop.minHeight, `min-height ${desktop.minHeight}px at 1024px`).toBeGreaterThanOrEqual(132);
        expect(desktop.resize).toBe('vertical');
    });

    test('Tab stays inside the sheet and Escape closes it', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 375, 740);
        await openSheet(page);

        const landings = await tabCycle(page, MODAL, 12);
        const escaped = landings.filter(l => !l.inside);
        expect(escaped, 'Tab escaped the dialog: ' + JSON.stringify(landings)).toEqual([]);

        await closeSheetWithEscape(page);
    });

    // PRODUCT BUG - not fixed here (fixing it changes keyboard behaviour,
    // which is a product decision, and this task does not fix product bugs).
    //
    // Closing the edit sheet drops focus to <body> instead of returning it to
    // the "Edytuj" button that opened it (WCAG 2.4.3). Cause: the modal is
    // opened programmatically - `new bootstrap.Modal(...).show()` at
    // public/recipients.js:3604 - and Bootstrap only restores focus to the
    // trigger for modals opened through its `data-bs-toggle="modal"` data-api.
    // A keyboard user who closes the sheet is dumped at the top of the page.
    test.fixme('closing the sheet returns focus to its trigger', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 375, 740);
        await openSheet(page);
        await closeSheetWithEscape(page);

        const returned = await page.evaluate(() => {
            const active = document.activeElement;
            return {
                isTrigger: !!(active && active.getAttribute && active.getAttribute('data-e2e-trigger') === '1'),
                tag: active ? active.tagName.toLowerCase() : null,
                cls: active && active.getAttribute ? active.getAttribute('class') : null
            };
        });
        expect(returned.isTrigger, 'focus must return to the button that opened the sheet: ' + JSON.stringify(returned)).toBe(true);
    });
});

'use strict';
/**
 * The add-present composer on /formularz: typed text survives every exit,
 * Enter and Ctrl+Enter submit, and the dock's "Dodaj" tab focuses the
 * name field. Shared setup lives in tests/helpers/composer.js.
 */
const { test, expect } = require('../fixtures');
const { activeDescription, describeFocus } = require('../helpers/focus');
const { COMPOSER, NAME, DESC, CLOSE, DOCK, STATE, openComposer } = require('../helpers/composer');

test.describe('add-present composer', () => {
    // hasTouch so tap() is available; the viewport is set per test.
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    // Several tests here walk three phone widths, each with a fresh page
    // load and ~1s of scripted scrolling - about 12s on a quiet machine, and
    // it measured 3x that when OneDrive was syncing this folder. The suite's
    // 30s default turned that slowness into a timeout inside page.goto,
    // which is a failure that says nothing about the composer.
    test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(90000); });

    test('no exit path clears typed text, and the collapsed bar cannot submit it', async ({ page }) => {
        const posts = [];
        page.on('request', r => {
            if (r.method() === 'POST' && r.url().includes('/api/formularz/present')) posts.push(r.url());
        });
        await openComposer(page, 375);

        for (const exit of ['close', 'escape', 'scrim']) {
            await page.locator(COMPOSER).tap();
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
            await page.locator(NAME).fill('Rower');
            await page.locator(DESC).fill('Czerwony, rozmiar M');

            if (exit === 'close') await page.locator(CLOSE).click();
            else if (exit === 'escape') await page.keyboard.press('Escape');
            else await page.locator('#quickAddScrim').tap();

            await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'),
                undefined, { timeout: 5000 });
            await expect(page.locator(NAME), `exit via ${exit} lost the name`).toHaveValue('Rower');
            await expect(page.locator(DESC), `exit via ${exit} lost the description`).toHaveValue('Czerwony, rozmiar M');
            // No "+" appears just because a draft is being held.
            const s = await page.evaluate(STATE);
            expect(s.submit.visibility, `a preserved draft must not bring the "+" back (${exit})`).toBe('hidden');
            await page.waitForTimeout(350);
        }

        // An implicit submission from the collapsed row opens the form instead
        // of posting the draft behind the user's back.
        await page.evaluate(() => {
            document.getElementById('quickAddForm')
                .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        expect(posts, 'the collapsed bar must never POST: ' + JSON.stringify(posts)).toEqual([]);
    });

    test('Enter and Ctrl+Enter add the present, then the composer blurs, collapses and the dock returns', async ({ page }) => {
        // DEMO_MODE reports the user as unidentified, and quickAddPresent()
        // refuses without an identified name - so the add path needs this.
        await page.route('**/api/user/identification', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                isIdentified: true, name: 'Jan Nowak',
                identifiedRecipient: { id: 2, name: 'Jan Nowak' }, username: 'e2e', userId: 1
            })
        }));
        await openComposer(page, 375);

        for (const how of ['Enter', 'Control+Enter']) {
            await page.locator(COMPOSER).tap();
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
            if (how === 'Enter') {
                await page.locator(NAME).fill('Kubek');
                await page.locator(NAME).press('Enter');
            } else {
                await page.locator(NAME).fill('Kubek');
                await page.locator(DESC).fill('Biały');
                await page.locator(DESC).press('Control+Enter');
            }

            // DEMO_MODE does not persist the new present, so assert the pill
            // and the post-add state, never an item count.
            await expect(page.locator('#quickAddMessage')).toContainText('Prezent dodany');
            await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'),
                undefined, { timeout: 5000 });
            await expect(page.locator(NAME)).toHaveValue('');
            const focus = await activeDescription(page);
            expect(focus && focus.id, `after ${how}: ` + describeFocus('focus', focus)).toBe('myPresentsHeading');
            const s = await page.evaluate(STATE);
            expect(s.submit.visibility, `after ${how} the collapsed bar must have no "+"`).toBe('hidden');
            expect(s.placeholder).toBe('Dodaj prezent…');
            await expect(page.locator(DOCK)).toBeVisible();
            await page.waitForTimeout(350);
        }
    });

    test('the dock\'s "Dodaj" tab opens the composer and focuses the name field', async ({ page }) => {
        await openComposer(page, 375);
        await page.locator('a.tab-item.form-tab').first().click();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        const focus = await activeDescription(page);
        expect(focus && focus.id, describeFocus('focus', focus)).toBe('quickAddTitle');
    });
});

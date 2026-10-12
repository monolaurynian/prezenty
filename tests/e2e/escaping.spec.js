'use strict';
/**
 * User-entered text must render as text.
 *
 * Present titles and recipient names come straight from a form, so a title of
 * `<script>alert(1)</script>` has to appear on screen as those literal
 * characters, with no element created in the DOM.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');

// Seeded in DEMO_MODE
const NASTY_TITLE = 'Zestaw <script>alert(1)</script> & "mega" \'mini\'';
const NASTY_NAME = 'Zuzia & "Zuza" <mała> \'Z\'';
const NASTY_CHAT = 'A co z <b>tym</b> & "tamtym"? \'Naprawdę\'?';

const RECIPIENTS = { path: '/recipients', name: 'recipients', ready: '.present-title, .present-name' };
const THREAD = { path: '/wiadomosci?rozmowa=1', name: 'chat thread', ready: '.chat-bubble' };
const ACTIVITY = { path: '/activity', name: 'activity', ready: '.notification-item' };
const LEADERBOARD = { path: '/leaderboard.html', name: 'leaderboard', ready: '.activity-card' };

/** No element may have been created from the payload. */
async function expectNoInjection(locator, literal) {
    await expect(locator).toHaveText(literal);
    const inspection = await locator.evaluate(el => ({
        html: el.innerHTML,
        injected: el.querySelectorAll('script, img, iframe, svg, object, embed, b, i[onerror]').length,
        text: el.textContent
    }));
    expect(inspection.injected, 'payload created elements: ' + inspection.html).toBe(0);
    // The angle brackets must be entity-encoded in the markup
    if (literal.includes('<')) {
        expect(inspection.html, 'raw "<" leaked into innerHTML: ' + inspection.html).not.toMatch(/<(script|b|i|img)\b/i);
        expect(inspection.html).toContain('&lt;');
    }
}

test.describe('escaping', () => {
    test('a present title containing markup renders as literal text', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 375);

        const title = page.locator('.present-title, .present-name', { hasText: 'alert(1)' }).first();
        await expect(title).toBeAttached();
        await expectNoInjection(title, NASTY_TITLE);
        // and nothing executed
        expect(await page.evaluate(() => window.__xss === undefined)).toBe(true);
    });

    test('a recipient name containing markup renders as literal text', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 375);

        const name = page.locator('.recipient-name', { hasText: 'Zuza' }).first();
        await expect(name).toBeAttached();
        await expectNoInjection(name, NASTY_NAME);
    });

    test('a chat message containing markup renders as literal text', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const bubble = page.locator('.chat-bubble', { hasText: 'tamtym' }).first();
        await expect(bubble).toBeAttached();
        const inspection = await bubble.evaluate(el => ({
            text: el.textContent,
            injected: el.querySelectorAll('b, i, script, img').length,
            html: el.innerHTML
        }));
        expect(inspection.text).toContain(NASTY_CHAT);
        expect(inspection.injected, 'chat payload created elements: ' + inspection.html).toBe(0);
        expect(inspection.html).toContain('&lt;b&gt;');
    });

    test('a notification title containing markup renders as literal text', async ({ page }) => {
        await openPage(page, ACTIVITY);
        await setViewport(page, 375);

        const message = page.locator('.notification-message', { hasText: 'alert(1)' }).first();
        await expect(message).toBeAttached();
        const inspection = await message.evaluate(el => ({
            text: el.textContent.replace(/\s+/g, ' ').trim(),
            injected: el.querySelectorAll('script, img, iframe, b').length,
            html: el.innerHTML
        }));
        expect(inspection.text).toContain('<script>alert(1)</script>');
        expect(inspection.injected, 'notification payload created elements: ' + inspection.html).toBe(0);
        expect(inspection.html).toContain('&lt;script&gt;');
    });

    // This used to be a `fixme` recording a live stored-XSS sink:
    // public/leaderboard.html interpolated `user.username` straight into
    // innerHTML in all four of its render functions, and the surrounding
    // onclick attributes took the raw name too
    // (navigateToUserInRecipients('${user.username}')). Names are user
    // controlled via POST /api/recipients.
    //
    // Fixed - the assertion below is unchanged from when it was written as a
    // fixme. The sink-still-exists guard test that used to sit underneath it
    // has been deleted, as its own failure message instructed. Deeper
    // coverage of every render path and every injection context lives in
    // tests/e2e/xss-usernames.spec.js.
    test('a leaderboard name containing markup renders as literal text', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        const name = page.locator('.activity-name', { hasText: 'Zuza' }).first();
        await expect(name).toBeAttached();
        await expectNoInjection(name, NASTY_NAME);
    });
});

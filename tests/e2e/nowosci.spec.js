/**
 * The "Nowości" page: every announcement as a card, newest first
 * (public/nowosci.html + nowosci-page.js, fed by /api/releases).
 *
 * The page is also in the a11y and horizontal-overflow matrices (PAGES in
 * tests/helpers/pages.js), so layout and contrast are covered there.
 */
const { test, expect } = require('../fixtures');
const { openPage } = require('../helpers/pages');
const { RELEASES, releasesFor } = require('../../lib/release-notes');

const PAGE = { path: '/nowosci', name: 'nowosci', ready: '.release-card' };
// The demo server has GIFs on but no KLIPY: stickers and memes are not announced here
const ON_DEMO = releasesFor({ gif: true });

test.describe('/api/releases', () => {
    test('lists every announcement that applies, newest first', async ({ request }) => {
        const json = await (await request.get('/api/releases')).json();
        expect(json.releases.map(r => r.id)).toEqual(ON_DEMO.map(r => r.id));
        // the order is the order of RELEASES: newest at the top
        const order = RELEASES.map(r => r.id).filter(id => ON_DEMO.some(r => r.id === id));
        expect(json.releases.map(r => r.id)).toEqual(order);
    });

    test('is for signed-in users only', async ({ playwright, baseURL }) => {
        const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
        expect((await anonymous.get('/api/releases')).status()).toBe(401);
        await anonymous.dispose();
    });

    test('an announcement that needs KLIPY is left out where KLIPY is off', () => {
        expect(releasesFor({ gif: true }).map(r => r.id)).not.toContain('2026-11-naklejki-i-memy');
        expect(releasesFor({ gif: true, klipy: true })[0].id).toBe('2026-11-naklejki-i-memy');
        expect(releasesFor({}).map(r => r.id)).toEqual(['2026-11-czat-grupowy']);
    });
});

test.describe('the page', () => {
    test('shows one card per announcement, newest at the top, with its date and a "Najnowsze" mark on the first', async ({ page }) => {
        await openPage(page, PAGE);
        const cards = page.locator('.release-card');
        await expect(cards).toHaveCount(ON_DEMO.length);
        for (let i = 0; i < ON_DEMO.length; i++) {
            await expect(cards.nth(i)).toHaveAttribute('data-release', ON_DEMO[i].id);
            await expect(cards.nth(i).locator('h2')).toHaveText(ON_DEMO[i].title);
            await expect(cards.nth(i).locator('li')).toHaveCount(ON_DEMO[i].items.length);
            await expect(cards.nth(i).locator('.release-date')).toHaveText('listopad 2026');
        }
        await expect(page.locator('.release-badge')).toHaveCount(1);
        await expect(cards.first().locator('.release-badge')).toHaveText('Najnowsze');
    });

    test('a card\'s button goes to its feature, only ever on this site', async ({ page }) => {
        await openPage(page, PAGE);
        const first = page.locator('.release-card').first();
        await expect(first.locator('.release-action')).toHaveText(ON_DEMO[0].action.label);
        await expect(first.locator('.release-action')).toHaveAttribute('href', ON_DEMO[0].action.url);
        const hrefs = await page.locator('.release-action').evaluateAll(list => list.map(a => a.getAttribute('href')));
        hrefs.forEach(href => expect(href).toMatch(/^\/(?!\/)/));
    });

    test('notes are plain text: markup in them is shown, never parsed', async ({ page }) => {
        await page.route('**/api/releases', route => route.fulfill({ json: { releases: [{
            id: '2026-01-test', title: '<img src=x onerror="window.__xss=1">', intro: '<b>intro</b>',
            items: [{ icon: '<i>', text: '<script>window.__xss=1</script>' }],
            action: { label: 'Dalej', url: 'https://evil.example/' },
            image: { src: 'https://evil.example/x.gif', alt: 'x', width: 100, height: 100 }
        }] } }));
        await openPage(page, PAGE);
        const card = page.locator('.release-card');
        await expect(card).toContainText('<b>intro</b>');
        await expect(card.locator('b, script, i, img')).toHaveCount(0);
        await expect(card.locator('.release-action')).toHaveCount(0);   // an off-site link is not offered
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('says so when the list cannot be loaded', async ({ page }) => {
        await page.route('**/api/releases', route => route.fulfill({ status: 500, json: {} }));
        await page.goto('/nowosci', { waitUntil: 'load' });
        await expect(page.locator('.release-error')).toContainText('Nie udało się wczytać nowości');
    });

    test('is a subpage of Ustawienia: linked from there, and "back" goes there', async ({ page }) => {
        await page.goto('/ustawienia', { waitUntil: 'load' });
        await page.getByRole('link', { name: 'Zobacz wszystkie nowości' }).click();
        await expect(page).toHaveURL(/\/nowosci$/);
        await expect(page.locator('.release-card').first()).toBeVisible();
        await page.getByRole('link', { name: 'Ustawienia' }).first().click();
        await expect(page).toHaveURL(/\/ustawienia$/);
    });
});

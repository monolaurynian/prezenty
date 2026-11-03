'use strict';
/**
 * The "Nowa wersja" banner (public/update-checker.js + lib/release-notes.js).
 *
 * Rules locked in here:
 *  - it only appears when the release has notes worth showing, and says
 *    what is new (title, friendly intro, a few items);
 *  - every user is told once per release; a brand-new visitor is not;
 *  - release notes are plain text: nothing in them is ever parsed as HTML;
 *  - the main button refreshes and then opens the feature.
 */
const { test, expect } = require('../fixtures');
const { openPage } = require('../helpers/pages');
const { RELEASES, latestRelease } = require('../../lib/release-notes');

const PAGE = { path: '/wiadomosci', name: 'chat list', ready: '.thread-row' };
const BANNER = '#updateBanner';

/** Pretend this browser has used the app before (a returning user). */
async function asReturningUser(page, seen) {
    await page.addInitScript((seenId) => {
        if (!localStorage.getItem('app_version')) localStorage.setItem('app_version', '1.0.0|old-cache');
        if (seenId && !localStorage.getItem('app_release_seen')) localStorage.setItem('app_release_seen', seenId);
    }, seen || null);
}

/** Make /api/version answer with a given release (or none). */
async function serveRelease(page, release) {
    await page.route('**/api/version', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.release = release;
        await route.fulfill({ response, json });
    });
}

test.describe('release notes data', () => {
    test('/api/version carries the newest announcement in the agreed shape', async ({ request }) => {
        const json = await (await request.get('/api/version')).json();
        const release = json.release;
        expect(release, 'this release has notes').toBeTruthy();
        expect(release.id).toBe(latestRelease().id);
        expect(release.title).toBeTruthy();
        expect(release.intro).toBeTruthy();
        expect(release.items.length).toBeGreaterThanOrEqual(1);
        expect(release.items.length).toBeLessThanOrEqual(4);
        release.items.forEach(item => {
            expect(item.icon).toBeTruthy();
            expect(item.text).toBeTruthy();
        });
        // The action is a same-site path, never another origin
        expect(release.action.url).toMatch(/^\/(?!\/)/);
    });

    test('every release has a unique id and plain-text content', () => {
        const ids = RELEASES.map(r => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        RELEASES.forEach(release => {
            const text = [release.title, release.intro].concat((release.items || []).map(i => i.text)).join(' ');
            expect(text, release.id).not.toMatch(/<[a-z!/]/i);
        });
    });

    test('the announcement is the group chat, in relaxed Polish', () => {
        const release = latestRelease();
        expect(release.title).toContain('Czat grupowy');
        expect(release.items.map(i => i.text).join(' ')).toMatch(/Do kogo\?/);
    });
});

test.describe('banner behaviour', () => {
    test('a returning user sees what is new, once', async ({ page }) => {
        await asReturningUser(page);
        await openPage(page, PAGE);

        const banner = page.locator(BANNER);
        await expect(banner).toBeVisible();
        const release = latestRelease();
        await expect(banner).toContainText(release.title);
        await expect(banner).toContainText(release.intro);
        await expect(banner.locator('li')).toHaveCount(release.items.length);
        await expect(banner.getByRole('button', { name: release.action.label })).toBeVisible();

        await banner.getByRole('button', { name: 'Później' }).click();
        await expect(banner).toHaveCount(0);

        // Next visit: already told, so no banner
        await page.reload({ waitUntil: 'load' });
        await page.locator('.thread-row').first().waitFor();
        await page.waitForTimeout(800);
        await expect(page.locator(BANNER)).toHaveCount(0);
    });

    test('a brand-new visitor is not shown "what is new"', async ({ page }) => {
        await openPage(page, PAGE);
        await page.waitForTimeout(800);
        await expect(page.locator(BANNER)).toHaveCount(0);
        const seen = await page.evaluate(() => localStorage.getItem('app_release_seen'));
        expect(seen).toBe(latestRelease().id);
    });

    test('a release without notes updates quietly: no banner', async ({ page }) => {
        await asReturningUser(page);
        await serveRelease(page, null);
        await openPage(page, PAGE);
        await page.waitForTimeout(800);
        await expect(page.locator(BANNER)).toHaveCount(0);
    });

    test('notes are plain text: markup in them is shown, never parsed', async ({ page }) => {
        await asReturningUser(page);
        await serveRelease(page, {
            id: 'xss-check',
            title: '<img src=x onerror="window.__xss=1">Tytuł',
            intro: '<b>intro</b>',
            items: [{ icon: '<i>', text: '<script>window.__xss=1</script>' }],
            action: { label: 'Dalej', url: 'https://evil.example/' }
        });
        await openPage(page, PAGE);
        const banner = page.locator(BANNER);
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('<b>intro</b>');
        await expect(banner.locator('img, b, script, i')).toHaveCount(0);
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();

        // An off-site action URL is ignored: the button only refreshes
        const origin = new URL(page.url()).origin;
        await banner.getByRole('button', { name: 'Dalej' }).click();
        await page.waitForLoadState('load');
        await page.locator('.thread-row').first().waitFor();
        expect(new URL(page.url()).origin).toBe(origin);
        expect(page.url()).not.toContain('evil.example');
    });

    test('the main button refreshes and opens the group chat', async ({ page }) => {
        await asReturningUser(page);
        await openPage(page, PAGE);
        const banner = page.locator(BANNER);
        await expect(banner).toBeVisible();
        await banner.getByRole('button', { name: latestRelease().action.label }).click();
        await expect(page).toHaveURL(/\/wiadomosci\?rozmowa=group/);
        await expect(page.locator('#chatTitle')).toContainText('Czat grupowy');
    });

    test('touch targets in the banner are at least 44px tall', async ({ page }) => {
        await asReturningUser(page);
        await openPage(page, PAGE);
        await expect(page.locator(BANNER)).toBeVisible();
        const heights = await page.locator(`${BANNER} button`).evaluateAll(list =>
            list.map(b => Math.round(b.getBoundingClientRect().height)));
        heights.forEach(h => expect(h).toBeGreaterThanOrEqual(44));
    });
});

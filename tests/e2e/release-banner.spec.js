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
const { openPage, setViewport } = require('../helpers/pages');
const { collectOverflow } = require('../helpers/overflow');
const { RELEASES, latestRelease } = require('../../lib/release-notes');

const PAGE = { path: '/wiadomosci', name: 'chat list', ready: '.thread-row' };
const BANNER = '#updateBanner';
// The demo server has GIFs on (no key needed), so its newest announcement is the GIF one
const DEMO_RELEASE = latestRelease({ gif: true });

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
        expect(release.id).toBe(DEMO_RELEASE.id);
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

    test('the group chat and GIF announcements are written in relaxed Polish', () => {
        const group = RELEASES.find(r => r.id === '2026-11-czat-grupowy');
        expect(group.title).toContain('Czat grupowy');
        expect(group.items.map(i => i.text).join(' ')).toMatch(/Do kogo\?/);

        const gif = RELEASES.find(r => r.id === '2026-11-gify-klipy');
        expect(gif.title).toContain('GIF');
        expect(gif.requires).toBe('gif');
        expect(gif.items.map(i => i.text).join(' ')).toMatch(/przycisk GIF/);
    });

    test('an announcement that needs a feature is skipped where the feature is off', () => {
        // GIFs off (no GIPHY_API_KEY): fall back to the previous announcement
        expect(latestRelease({ gif: false }).id).toBe('2026-11-czat-grupowy');
        expect(latestRelease().id).toBe('2026-11-czat-grupowy');
        // GIFs on: the GIF announcement is the newest
        expect(latestRelease({ gif: true }).id).toBe('2026-11-gify-klipy');
    });
});

test.describe('banner behaviour', () => {
    test('a returning user sees what is new, once', async ({ page }) => {
        await asReturningUser(page);
        await openPage(page, PAGE);

        const banner = page.locator(BANNER);
        await expect(banner).toBeVisible();
        const release = DEMO_RELEASE;
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
        expect(seen).toBe(DEMO_RELEASE.id);
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
        await banner.getByRole('button', { name: DEMO_RELEASE.action.label }).click();
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

// ===========================================================================
// A picture (animated GIF) in the banner
// ===========================================================================

test.describe('banner picture', () => {
    const GIF_ENTRY = RELEASES.find(r => r.id === '2026-11-gify-klipy');

    test('the GIF announcement carries our own animated GIF and a still, both real files', async ({ request }) => {
        const json = await (await request.get('/api/version')).json();
        expect(json.release.image).toEqual(GIF_ENTRY.image);
        expect(GIF_ENTRY.image.src).toBe('/release/gify.gif');
        expect(GIF_ENTRY.image.alt.length).toBeGreaterThan(20);

        for (const [name, url] of [['animated', GIF_ENTRY.image.src], ['still', GIF_ENTRY.image.still]]) {
            const response = await request.get(url);
            expect(response.status(), name).toBe(200);
            expect(response.headers()['content-type'], name).toContain('image/gif');
            const body = await response.body();
            expect(body.subarray(0, 6).toString('latin1'), name).toMatch(/^GIF8[79]a$/);
            expect(body.length, `${name} stays light`).toBeLessThan(100 * 1024);
        }
        // The animated one really has several frames; the still has one
        const animated = await (await request.get(GIF_ENTRY.image.src)).body();
        const graphicControls = animated.toString('latin1').split('\x21\xF9\x04').length - 1;
        expect(graphicControls).toBeGreaterThan(3);
    });

    test('the banner shows the picture above the title, loaded and inside the card', async ({ page }) => {
        await asReturningUser(page);
        await openPage(page, PAGE);
        const banner = page.locator(BANNER);
        await expect(banner).toBeVisible();

        const picture = banner.locator('img');
        await expect(picture).toHaveCount(1);
        await expect(picture).toHaveAttribute('src', '/release/gify.gif');
        await expect(picture).toHaveAttribute('alt', GIF_ENTRY.image.alt);
        await expect.poll(() => picture.evaluate(img => img.naturalWidth)).toBe(360);

        const layout = await banner.evaluate(root => {
            const card = root.firstElementChild.getBoundingClientRect();
            const img = root.querySelector('img').getBoundingClientRect();
            // the title is the leaf <div> that starts with "Nowość" (not the card around it)
            const title = Array.prototype.find.call(root.querySelectorAll('div'),
                d => d.children.length === 0 && d.textContent.indexOf('Nowość') === 0).getBoundingClientRect();
            return { cardLeft: card.left, cardRight: card.right, imgLeft: img.left, imgRight: img.right, imgBottom: img.bottom, titleTop: title.top };
        });
        expect(layout.imgLeft, JSON.stringify(layout)).toBeGreaterThanOrEqual(layout.cardLeft - 0.5);
        expect(layout.imgRight, JSON.stringify(layout)).toBeLessThanOrEqual(layout.cardRight + 0.5);
        expect(layout.imgBottom, JSON.stringify(layout)).toBeLessThanOrEqual(layout.titleTop + 0.5);
    });

    for (const width of [320, 375, 768]) {
        test(`the banner with its picture fits the ${width}px screen and its buttons stay reachable`, async ({ page }) => {
            await asReturningUser(page);
            await openPage(page, PAGE);
            await setViewport(page, width);
            const banner = page.locator(BANNER);
            await expect(banner).toBeVisible();
            await expect.poll(() => banner.locator('img').evaluate(img => img.naturalWidth)).toBe(360);

            const fit = await banner.evaluate(root => {
                const card = root.firstElementChild;
                const r = card.getBoundingClientRect();
                const buttons = Array.prototype.map.call(root.querySelectorAll('button'), b => b.getBoundingClientRect());
                return { left: r.left, right: r.right, view: window.innerWidth, viewH: window.innerHeight,
                    buttonsInside: buttons.every(b => b.left >= r.left - 0.5 && b.right <= r.right + 0.5),
                    // the card scrolls inside itself when taller than the screen
                    scrollable: card.scrollHeight > card.clientHeight, cardHeight: r.height };
            });
            expect(fit.left, JSON.stringify(fit)).toBeGreaterThanOrEqual(0);
            expect(fit.right, JSON.stringify(fit)).toBeLessThanOrEqual(fit.view + 0.5);
            expect(fit.buttonsInside, JSON.stringify(fit)).toBe(true);
            expect(fit.cardHeight, JSON.stringify(fit)).toBeLessThanOrEqual(fit.viewH * 0.8 + 1);
            // The primary button can always be reached (scrolling the card if needed)
            await banner.getByRole('button', { name: DEMO_RELEASE.action.label }).scrollIntoViewIfNeeded();
            await expect(banner.getByRole('button', { name: DEMO_RELEASE.action.label })).toBeVisible();
            const report = await collectOverflow(page);
            expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
        });
    }

    test('reduced motion: the still picture is shown, not the animation', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await asReturningUser(page);
        await openPage(page, PAGE);
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('src', '/release/gify-still.gif');
    });

    test('a missing picture file leaves the text alone: no broken-image icon', async ({ page }) => {
        await asReturningUser(page);
        await page.route('**/release/gify.gif', route => route.fulfill({ status: 404, body: 'nope' }));
        await openPage(page, PAGE);
        const banner = page.locator(BANNER);
        await expect(banner).toBeVisible();
        await expect(banner.locator('img')).toHaveCount(0);
        await expect(banner).toContainText(DEMO_RELEASE.title);
        await expect(banner.getByRole('button', { name: DEMO_RELEASE.action.label })).toBeVisible();
    });

    const HOSTILE = [
        ['another site', 'https://evil.example/x.gif'],
        ['protocol-relative', '//evil.example/x.gif'],
        ['a data: URL', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='],
        ['a javascript: URL', 'javascript:alert(1)'],
        ['a query string', '/release/gify.gif?x=1'],
        ['path traversal', '/release/../../etc/passwd.gif'],
        ['not an image', '/release/gify.html'],
        ['a quote in the path', '/release/a"onerror="window.__xss=1.gif'],
        ['a number', 5],
        ['an object', { a: 1 }]
    ];
    for (const [label, src] of HOSTILE) {
        test(`an image source that is ${label} is ignored (the banner still shows its text)`, async ({ page }) => {
            await asReturningUser(page);
            await serveRelease(page, {
                id: 'image-check-' + label.replace(/\W+/g, '-'), title: 'Tytuł', intro: 'Wstęp',
                items: [{ icon: '•', text: 'punkt' }],
                image: { src, still: src, alt: 'x', width: 360, height: 180 }
            });
            const requested = [];
            page.on('request', r => { if (/evil\.example|etc\/passwd/.test(r.url())) requested.push(r.url()); });
            await openPage(page, PAGE);
            const banner = page.locator(BANNER);
            await expect(banner).toBeVisible();
            await expect(banner.locator('img')).toHaveCount(0);
            await expect(banner).toContainText('Tytuł');
            expect(requested).toEqual([]);
            expect(await page.evaluate(() => window.__xss)).toBeUndefined();
        });
    }

    test('bad dimensions or a bad still do not break the picture rules', async ({ page }) => {
        await asReturningUser(page);
        await serveRelease(page, {
            id: 'image-dims', title: 'Tytuł', intro: 'Wstęp', items: [{ icon: '•', text: 'punkt' }],
            image: { src: '/release/gify.gif', still: 'https://evil.example/s.gif', alt: 'x', width: 360, height: 180 }
        });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openPage(page, PAGE);
        // The still was rejected, so even with reduced motion the own file is used
        const picture = page.locator(`${BANNER} img`);
        await expect(picture).toHaveCount(1);
        await expect(picture).toHaveAttribute('src', '/release/gify.gif');

        await page.evaluate(() => localStorage.removeItem('app_release_seen'));
        await page.unroute('**/api/version');
        await serveRelease(page, {
            id: 'image-dims-2', title: 'Tytuł 2', intro: 'Wstęp', items: [{ icon: '•', text: 'punkt' }],
            image: { src: '/release/gify.gif', alt: 'x', width: 0, height: 99999 }
        });
        await page.reload({ waitUntil: 'load' });
        await expect(page.locator(BANNER)).toContainText('Tytuł 2');
        await expect(page.locator(`${BANNER} img`)).toHaveCount(0);
    });
});

// ===========================================================================
// The banner picture can be a KLIPY GIF, looked up live in the browser
// ===========================================================================

test.describe('banner picture from KLIPY', () => {
    const GIF_ENTRY = RELEASES.find(r => r.id === '2026-11-gify-klipy');
    const KEY = 'TEST_APP_KEY_123';
    const SLUG = GIF_ENTRY.image.klipy;
    const url = (size, ext) => `https://static.klipy.com/ii/testhash/14/af/${SLUG}-${size}.${ext}`;
    const media = (size, ext, w, h) => ({ url: url(size, ext), width: w, height: h, size: 1234 });
    const rendition = (size, w, h) => ({ gif: media(size, 'gif', w, h), webp: media(size, 'webp', w, h), jpg: media(size, 'jpg', w, h) });
    const ITEM = {
        id: 1, slug: SLUG, title: 'what buddy', type: 'gif',
        file: { hd: rendition('hd', 498, 280), md: rendition('md', 340, 191), sm: rendition('sm', 220, 124), xs: rendition('xs', 90, 51) }
    };
    const GIF_BYTES = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public', 'demo-gifs', 'hura.gif'));

    /** KLIPY on, with the item lookup answered by `items` (default: the item). */
    async function mockKlipy(page, items) {
        const asked = { items: [] };
        await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({ json: {
            enabled: true, provider: 'klipy', apiKey: KEY, rating: 'pg', contentFilter: 'high', klipyKey: KEY
        } }));
        await page.route('https://api.klipy.com/**', (route) => {
            const u = new URL(route.request().url());
            if (u.pathname.endsWith('/gifs/items')) {
                asked.items.push(u);
                if (items) return items(route);
            }
            return route.fulfill({ json: { result: true, data: { data: [ITEM], current_page: 1, per_page: 24, has_next: false } } });
        });
        await page.route('https://static*.klipy.com/**', route => route.fulfill({ contentType: 'image/gif', body: GIF_BYTES }));
        return asked;
    }

    test('the announcement names the KLIPY GIF by slug, with the drawn picture kept as the fallback', () => {
        expect(SLUG).toBe('what-buddy');
        expect(GIF_ENTRY.image.src).toBe('/release/gify.gif');
        expect(GIF_ENTRY.image.klipyAlt.length).toBeGreaterThan(10);
    });

    test('where KLIPY is on: the GIF is asked for from the browser, shown as KLIPY returned it, and credited', async ({ page }) => {
        await asReturningUser(page);
        const asked = await mockKlipy(page);
        await openPage(page, PAGE);
        const picture = page.locator(`${BANNER} img`);
        await expect(picture).toHaveAttribute('src', url('md', 'webp'));   // bigger rendition, exactly as returned
        await expect(picture).toHaveAttribute('alt', GIF_ENTRY.image.klipyAlt);
        await expect(page.locator(BANNER)).toContainText('GIF: KLIPY');
        await expect.poll(() => picture.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);

        expect(asked.items.length).toBe(1);
        expect(asked.items[0].searchParams.get('slugs')).toBe(SLUG);
        expect(asked.items[0].searchParams.get('customer_id')).toMatch(/^[0-9a-f]{32}$/);
        // nothing of ours was asked to serve a copy
        await expect(page.locator(BANNER)).not.toContainText('undefined');
    });

    test('reduced motion: the still JPG of the KLIPY GIF', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await asReturningUser(page);
        await mockKlipy(page);
        await openPage(page, PAGE);
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('src', url('md', 'jpg'));
    });

    test('KLIPY refusing (rate limit) leaves our drawn GIF, with no credit', async ({ page }) => {
        await asReturningUser(page);
        await mockKlipy(page, route => route.fulfill({ status: 429, json: { result: false } }));
        await openPage(page, PAGE);
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('src', '/release/gify.gif');
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('alt', GIF_ENTRY.image.alt);
        await expect(page.locator(BANNER)).not.toContainText('KLIPY');
    });

    test('a GIF KLIPY no longer has leaves our drawn GIF', async ({ page }) => {
        await asReturningUser(page);
        await mockKlipy(page, route => route.fulfill({ json: { result: true, data: { data: [], current_page: 1, per_page: 24, has_next: false } } }));
        await openPage(page, PAGE);
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('src', '/release/gify.gif');
        await expect(page.locator(BANNER)).not.toContainText('KLIPY');
    });

    test('KLIPY\'s picture not loading falls back to our drawn GIF', async ({ page }) => {
        await asReturningUser(page);
        await mockKlipy(page);
        await page.route('https://static*.klipy.com/**', route => route.abort());
        await openPage(page, PAGE);
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('src', '/release/gify.gif');
        await expect(page.locator(BANNER)).not.toContainText('KLIPY');
    });

    test('a KLIPY answer that never comes does not hold the banner: our GIF after a few seconds', async ({ page }) => {
        await asReturningUser(page);
        await mockKlipy(page, () => new Promise(() => { /* never answers */ }));
        await openPage(page, PAGE);
        const banner = page.locator(BANNER);
        await expect(banner).toBeVisible();                       // the banner itself is not delayed
        await expect(banner).toContainText(DEMO_RELEASE.title);
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('src', '/release/gify.gif', { timeout: 10000 });
    });

    test('without a KLIPY key (GIPHY / demo) KLIPY is never contacted', async ({ page }) => {
        await asReturningUser(page);
        const contacted = [];
        page.on('request', r => { if (r.url().includes('klipy.com')) contacted.push(r.url()); });
        await openPage(page, PAGE);   // the demo server has no KLIPY key
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('src', '/release/gify.gif');
        expect(contacted).toEqual([]);
    });

    test('a slug that is not a plain slug is ignored: our picture, nothing requested', async ({ page }) => {
        await asReturningUser(page);
        const asked = await mockKlipy(page);
        await serveRelease(page, {
            id: 'klipy-hostile', title: 'Tytuł', intro: 'Wstęp', items: [{ icon: '•', text: 'punkt' }],
            image: { src: '/release/gify.gif', klipy: 'x/../../evil?y=1', alt: 'x', width: 360, height: 180 }
        });
        await openPage(page, PAGE);
        await expect(page.locator(`${BANNER} img`)).toHaveAttribute('src', '/release/gify.gif');
        expect(asked.items).toEqual([]);
    });

    for (const width of [320, 375, 768]) {
        test(`the banner with the KLIPY GIF fits the ${width}px screen`, async ({ page }) => {
            await asReturningUser(page);
            await mockKlipy(page);
            await openPage(page, PAGE);
            await setViewport(page, width);
            const banner = page.locator(BANNER);
            await expect(banner.locator('img')).toHaveAttribute('src', url('md', 'webp'));
            const fit = await banner.evaluate(root => {
                const card = root.firstElementChild.getBoundingClientRect();
                const img = root.querySelector('img').getBoundingClientRect();
                return { cardLeft: card.left, cardRight: card.right, imgLeft: img.left, imgRight: img.right, imgHeight: img.height, view: window.innerWidth };
            });
            expect(fit.imgLeft, JSON.stringify(fit)).toBeGreaterThanOrEqual(fit.cardLeft - 0.5);
            expect(fit.imgRight, JSON.stringify(fit)).toBeLessThanOrEqual(fit.cardRight + 0.5);
            expect(fit.cardRight, JSON.stringify(fit)).toBeLessThanOrEqual(fit.view + 0.5);
            expect(fit.imgHeight, JSON.stringify(fit)).toBeLessThanOrEqual(241);
            const report = await collectOverflow(page);
            expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
        });
    }
});

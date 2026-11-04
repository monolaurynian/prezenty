'use strict';
/**
 * Tap a GIF in the chat to see it larger (gif-lightbox.js).
 *
 * Locked in here:
 *  - every GIF in a conversation is a button that opens a labelled modal,
 *    shown larger than in the chat and inside the screen at every width;
 *  - Escape, the x button and a tap outside/on the picture close it, focus
 *    returns to the GIF, Tab stays inside, the page behind does not scroll;
 *  - the bigger picture comes from the provider (GIPHY's larger rendition,
 *    KLIPY's "md" file exactly as the API returned it), and the modal opens
 *    at once with the picture the chat already has;
 *  - reduced motion: still picture + play/stop in the modal, and the chat
 *    keeps its own tap-to-play with a separate corner zoom button;
 *  - a picture that cannot be loaded is a note, never a broken image.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { collectOverflow } = require('../helpers/overflow');
const { activeDescription, describeFocus } = require('../helpers/focus');

const GROUP = { path: '/wiadomosci?rozmowa=group', name: 'group chat', ready: '.chat-bubble' };
const THREAD = { path: '/wiadomosci?rozmowa=1', name: 'chat thread', ready: '.chat-bubble' };
const BOX = '#gifLightbox';
const REPO = path.resolve(__dirname, '..', '..');
const GIF_BYTES = fs.readFileSync(path.join(REPO, 'public', 'demo-gifs', 'hura.gif'));

async function postGroupBody(page, body) {
    return page.evaluate(async (text) => {
        const response = await fetch('/api/wiadomosci/group', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text })
        });
        return response.status;
    }, body);
}

/** Posts one demo GIF and shows it; returns the zoom button of the newest GIF. */
async function withDemoGif(page, id, size) {
    await openPage(page, GROUP);
    expect(await postGroupBody(page, `[gif:demo:${id}:${size}]`)).toBe(200);
    await page.evaluate(() => window.loadThreadMessages());
    const zoom = page.locator('.chat-gif-zoom').last();
    await expect(zoom).toBeVisible();
    return zoom;
}

test.describe('gif zoom (demo provider)', () => {
    test('every chat GIF is a labelled button; tapping it opens a modal with a bigger picture', async ({ page }) => {
        await setViewport(page, 375);
        const zoom = await withDemoGif(page, 'hura', '200x200');
        await expect(zoom).toHaveAttribute('aria-label', 'Powiększ GIF');
        const small = await zoom.locator('img.chat-gif').boundingBox();

        await zoom.click();
        const box = page.locator(BOX);
        await expect(box).toHaveClass(/is-open/);
        await expect(box).toHaveAttribute('role', 'dialog');
        await expect(box).toHaveAttribute('aria-modal', 'true');
        await expect(box).toHaveAttribute('aria-label', 'Powiększony GIF');
        await expect(box).not.toHaveAttribute('aria-hidden', 'true');

        const img = box.locator('img.gif-lightbox-img');
        await expect(img).toHaveAttribute('src', '/demo-gifs/hura.gif');
        await expect.poll(() => img.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
        const big = await img.boundingBox();
        expect(big.width, `${big.width} vs chat ${small.width}`).toBeGreaterThan(small.width * 1.3);
        // ...and inside the screen
        expect(big.x).toBeGreaterThanOrEqual(0);
        expect(big.x + big.width).toBeLessThanOrEqual(375.5);
        expect(big.y).toBeGreaterThanOrEqual(0);
        expect(big.y + big.height).toBeLessThanOrEqual(740.5);
        // aspect ratio kept (square GIF)
        expect(Math.abs(big.width - big.height)).toBeLessThanOrEqual(2);
        await expect(page.locator('.gif-lightbox-play')).toBeHidden();
    });

    test('the picture keeps its shape for a tall GIF and never exceeds the screen', async ({ page }) => {
        await setViewport(page, 375);
        const zoom = await withDemoGif(page, 'swieta', '200x260');
        await zoom.click();
        const img = page.locator(`${BOX} img.gif-lightbox-img`);
        await expect.poll(() => img.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
        const big = await img.boundingBox();
        expect(big.x + big.width).toBeLessThanOrEqual(375.5);
        expect(big.height).toBeLessThanOrEqual(740 * 0.75 + 1);
        expect(big.height).toBeGreaterThan(big.width); // still taller than wide
    });

    test('closes with Escape, the x button, and a tap on the dark area or the picture; focus returns to the GIF', async ({ page }) => {
        const zoom = await withDemoGif(page, 'hura', '200x200');
        const box = page.locator(BOX);

        await zoom.click();
        await expect(box).toHaveClass(/is-open/);
        await expect(page.locator('.gif-lightbox-close')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(box).not.toHaveClass(/is-open/);
        await expect(box).toHaveAttribute('aria-hidden', 'true');
        const back = await activeDescription(page);
        expect(back.cls, describeFocus('focus after Escape', back)).toContain('chat-gif-zoom');

        await zoom.click();
        await page.locator('.gif-lightbox-close').click();
        await expect(box).not.toHaveClass(/is-open/);

        await zoom.click();
        await page.locator(BOX).click({ position: { x: 6, y: 300 } });
        await expect(box).not.toHaveClass(/is-open/);

        await zoom.click();
        await page.locator(`${BOX} img.gif-lightbox-img`).click();
        await expect(box).not.toHaveClass(/is-open/);
    });

    test('keyboard: Enter on the GIF opens it, Tab stays inside, Escape closes', async ({ page }) => {
        const zoom = await withDemoGif(page, 'hura', '200x200');
        await zoom.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator(BOX)).toHaveClass(/is-open/);
        for (let i = 0; i < 6; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => document.getElementById('gifLightbox').contains(document.activeElement));
            expect(inside, `Tab #${i + 1} left the modal`).toBe(true);
        }
        await page.keyboard.press('Shift+Tab');
        expect(await page.evaluate(() => document.getElementById('gifLightbox').contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.locator(BOX)).not.toHaveClass(/is-open/);
    });

    test('the page behind does not scroll while the modal is open, and scrolls again after', async ({ page }) => {
        const zoom = await withDemoGif(page, 'hura', '200x200');
        await zoom.click();
        await expect(page.locator('html')).toHaveClass(/gif-lightbox-open/);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
        await page.keyboard.press('Escape');
        await expect(page.locator('html')).not.toHaveClass(/gif-lightbox-open/);
    });

    test('the picture is released on close (no animation keeps running in the background)', async ({ page }) => {
        const zoom = await withDemoGif(page, 'hura', '200x200');
        await zoom.click();
        await expect(page.locator(`${BOX} img.gif-lightbox-img`)).toHaveAttribute('src', /hura/);
        await page.keyboard.press('Escape');
        await expect(page.locator(`${BOX} img.gif-lightbox-img`)).not.toHaveAttribute('src', /.+/);
    });

    test('reopening a different GIF shows that GIF, not the previous one', async ({ page }) => {
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:demo:brawo:200x150]')).toBe(200);
        expect(await postGroupBody(page, '[gif:demo:dzieki:200x112]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        await expect(page.locator('img.chat-gif[src="/demo-gifs/dzieki.gif"]').last()).toBeVisible();

        await page.locator('.chat-gif-zoom', { has: page.locator('img[src="/demo-gifs/brawo.gif"]') }).last().click();
        await expect(page.locator(`${BOX} img.gif-lightbox-img`)).toHaveAttribute('src', '/demo-gifs/brawo.gif');
        await page.keyboard.press('Escape');
        await page.locator('.chat-gif-zoom', { has: page.locator('img[src="/demo-gifs/dzieki.gif"]') }).last().click();
        await expect(page.locator(`${BOX} img.gif-lightbox-img`)).toHaveAttribute('src', '/demo-gifs/dzieki.gif');
    });

    test('works in a private conversation too', async ({ page }) => {
        await openPage(page, THREAD);
        await page.evaluate(async () => {
            await fetch('/api/wiadomosci/threads/1/messages', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: '[gif:demo:hura:200x200]' })
            });
            await window.loadThreadMessages();
        });
        const zoom = page.locator('.chat-gif-zoom').last();
        await expect(zoom).toBeVisible();
        await zoom.click();
        await expect(page.locator(BOX)).toHaveClass(/is-open/);
    });

    test('a GIF that cannot load is a note in the chat (no zoom button) and a note in the modal if opened', async ({ page }) => {
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:demo:nie-ma-takiego:200x100]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        await expect(page.locator('.chat-gif-missing').last()).toHaveText('Ten GIF jest niedostępny');
        // the broken GIF took its zoom button with it
        // (waits for this GIF's own load error: the chat already holds notes
        // left by earlier tests, so the line above can pass too early)
        await expect(page.locator('.chat-gif-zoom', { has: page.locator('img[src*="nie-ma-takiego"]') })).toHaveCount(0);

        // Opening the modal on a picture that fails shows the note
        await page.evaluate(() => window.GifLightbox.open({ animated: '/demo-gifs/nie-ma-takiego.gif', width: 200, height: 100 }));
        await expect(page.locator('.gif-lightbox-missing')).toHaveText('Ten GIF jest niedostępny');
        await expect(page.locator(`${BOX} img.gif-lightbox-img`)).toBeHidden();
        await page.keyboard.press('Escape');
    });

    for (const width of [320, 375, 768, 1024]) {
        test(`the modal fits the ${width}px screen with no horizontal overflow and a 44px close button`, async ({ page }) => {
            await setViewport(page, width);
            const zoom = await withDemoGif(page, 'brawo', '200x150');
            await zoom.click();
            const img = page.locator(`${BOX} img.gif-lightbox-img`);
            await expect.poll(() => img.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
            const geometry = await page.evaluate(() => {
                const r = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
                return { img: r(document.querySelector('.gif-lightbox-img')), close: r(document.querySelector('.gif-lightbox-close')),
                    vw: window.innerWidth, vh: window.innerHeight };
            });
            expect(geometry.img.l, JSON.stringify(geometry)).toBeGreaterThanOrEqual(-0.5);
            expect(geometry.img.r, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.vw + 0.5);
            expect(geometry.img.b, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.vh + 0.5);
            expect(geometry.close.w).toBeGreaterThanOrEqual(43.99);
            expect(geometry.close.h).toBeGreaterThanOrEqual(43.99);
            // the picture does not run under the close button
            expect(geometry.img.t, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.close.b - 0.5);
            const report = await collectOverflow(page);
            expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
        });
    }

    test('colour contrast: the close button is white on a dark backdrop', async ({ page }) => {
        const zoom = await withDemoGif(page, 'hura', '200x200');
        await zoom.click();
        const colours = await page.evaluate(() => ({
            backdrop: getComputedStyle(document.getElementById('gifLightbox')).backgroundColor,
            close: getComputedStyle(document.querySelector('.gif-lightbox-close')).color
        }));
        expect(colours.close).toBe('rgb(255, 255, 255)');
        const alpha = Number((colours.backdrop.match(/,\s*([0-9.]+)\)$/) || [0, 1])[1]);
        expect(alpha, colours.backdrop).toBeGreaterThanOrEqual(0.8);
    });
});

test.describe('gif zoom with reduced motion', () => {
    test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
    });

    test('the chat keeps tap-to-play and gains a separate corner zoom button (44px)', async ({ page }) => {
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:demo:hura:200x200]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        const wrap = page.locator('.chat-gif-wrap').last();
        await expect(wrap).toBeVisible();
        const toggle = wrap.locator('.chat-gif-toggle');
        const zoom = wrap.locator('.chat-gif-zoom-badge');
        await expect(zoom).toHaveAttribute('aria-label', 'Powiększ GIF');
        const size = await zoom.boundingBox();
        expect(size.width).toBeGreaterThanOrEqual(43.99);
        expect(size.height).toBeGreaterThanOrEqual(43.99);

        // tapping the picture still plays it in place and does NOT open the modal
        await toggle.click();
        await expect(toggle.locator('img')).toHaveAttribute('src', '/demo-gifs/hura.gif');
        // The modal is built on first use, so "never opened" = not in the page
        // at all (or, if an earlier open built it, not open)
        expect(await page.evaluate(() => {
            const box = document.getElementById('gifLightbox');
            return !!box && box.classList.contains('is-open');
        })).toBe(false);
    });

    test('the modal opens on the still picture with Odtwórz / Zatrzymaj', async ({ page }) => {
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:demo:hura:200x200]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        await page.locator('.chat-gif-zoom-badge').last().click();

        const img = page.locator(`${BOX} img.gif-lightbox-img`);
        const play = page.locator('.gif-lightbox-play');
        await expect(page.locator(BOX)).toHaveClass(/is-open/);
        await expect(img).toHaveAttribute('src', '/demo-gifs/hura-still.gif');
        await expect(play).toBeVisible();
        await expect(play).toHaveText('Odtwórz GIF');

        await play.click();
        await expect(img).toHaveAttribute('src', '/demo-gifs/hura.gif');
        await expect(play).toHaveText('Zatrzymaj GIF');
        await play.click();
        await expect(img).toHaveAttribute('src', '/demo-gifs/hura-still.gif');
        await expect(play).toHaveText('Odtwórz GIF');

        // Tab reaches both buttons and nothing else
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.getElementById('gifLightbox').contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.locator(BOX)).not.toHaveClass(/is-open/);
    });

    test('the modal has no transitions', async ({ page }) => {
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:demo:hura:200x200]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        await page.locator('.chat-gif-zoom-badge').last().click();
        const durations = await page.evaluate(() => ({
            box: getComputedStyle(document.getElementById('gifLightbox')).transitionDuration,
            figure: getComputedStyle(document.querySelector('.gif-lightbox-figure')).transitionDuration
        }));
        expect(durations).toEqual({ box: '0s', figure: '0s' });
    });
});

// ---------------------------------------------------------------------------
// Providers: the bigger picture comes from the provider
// ---------------------------------------------------------------------------

test.describe('gif zoom: GIPHY', () => {
    test('uses the larger GIPHY rendition, and opens instantly on the picture already in the chat', async ({ page }) => {
        const loaded = [];
        await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({ json: {
            enabled: true, provider: 'giphy', apiKey: 'K', rating: 'pg', contentFilter: null, klipyKey: null
        } }));
        await page.route('https://media.giphy.com/**', async (route) => {
            loaded.push(route.request().url());
            // hold the big one back: the modal must already show the small one
            if (route.request().url().includes('giphy-downsized')) await new Promise(r => setTimeout(r, 1200));
            return route.fulfill({ contentType: 'image/gif', body: GIF_BYTES });
        });
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:giphy:xT4uQulxzV39haRFjG:200x150]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        const zoom = page.locator('.chat-gif-zoom').last();
        await expect(zoom).toHaveAttribute('data-zoom-animated', 'https://media.giphy.com/media/xT4uQulxzV39haRFjG/giphy-downsized.gif');
        await expect(zoom).toHaveAttribute('data-zoom-still', 'https://media.giphy.com/media/xT4uQulxzV39haRFjG/giphy_s.gif');
        await zoom.click();

        const img = page.locator(`${BOX} img.gif-lightbox-img`);
        // first: the chat-size picture, immediately
        await expect(img).toHaveAttribute('src', 'https://media.giphy.com/media/xT4uQulxzV39haRFjG/200w.gif');
        // then the bigger one replaces it once loaded
        await expect(img).toHaveAttribute('src', 'https://media.giphy.com/media/xT4uQulxzV39haRFjG/giphy-downsized.gif', { timeout: 6000 });
        expect(loaded.some(u => u.includes('giphy-downsized'))).toBe(true);
    });
});

test.describe('gif zoom: KLIPY', () => {
    const KEY = 'TEST_APP_KEY_123';
    const u = (slug, size, ext) => `https://static.klipy.com/ii/testhash0123456789abcdef/14/af/${slug}-${size}.${ext}`;
    const rendition = (slug, size, w, h) => ['gif', 'webp', 'jpg'].reduce((o, ext) => {
        o[ext] = { url: u(slug, size, ext), width: w, height: h, size: 1 }; return o;
    }, {});

    test('zooms to the "md" file exactly as the API returned it; chat keeps the small one', async ({ page }) => {
        await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({ json: {
            enabled: true, provider: 'klipy', apiKey: KEY, rating: 'pg', contentFilter: 'high', klipyKey: KEY
        } }));
        await page.route('https://api.klipy.com/**', route => {
            const slugs = new URL(route.request().url()).searchParams.get('slugs').split(',');
            return route.fulfill({ json: { result: true, data: { data: slugs.map(slug => ({
                id: 1, slug, title: slug, type: 'gif',
                file: { sm: rendition(slug, 'sm', 220, 220), md: rendition(slug, 'md', 340, 340), hd: rendition(slug, 'hd', 498, 498) }
            })) } } });
        });
        await page.route('https://static*.klipy.com/**', route => route.fulfill({ contentType: 'image/gif', body: GIF_BYTES }));

        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:powiekszany-gif-321:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());

        const zoom = page.locator('.chat-gif-zoom').last();
        await expect(zoom.locator('img.chat-gif')).toHaveAttribute('src', u('powiekszany-gif-321', 'sm', 'webp'));
        await expect(zoom).toHaveAttribute('data-zoom-animated', u('powiekszany-gif-321', 'md', 'webp'));
        await expect(zoom).toHaveAttribute('data-zoom-still', u('powiekszany-gif-321', 'md', 'jpg'));
        await zoom.click();
        await expect(page.locator(`${BOX} img.gif-lightbox-img`)).toHaveAttribute('src', u('powiekszany-gif-321', 'md', 'webp'), { timeout: 6000 });
    });

    test('falls back to the chat-size file when the API sent only one size', async ({ page }) => {
        await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({ json: {
            enabled: true, provider: 'klipy', apiKey: KEY, rating: 'pg', contentFilter: 'high', klipyKey: KEY
        } }));
        await page.route('https://api.klipy.com/**', route => {
            const slugs = new URL(route.request().url()).searchParams.get('slugs').split(',');
            return route.fulfill({ json: { result: true, data: { data: slugs.map(slug => ({
                id: 1, slug, title: slug, type: 'gif', file: { sm: rendition(slug, 'sm', 220, 220) }
            })) } } });
        });
        await page.route('https://static*.klipy.com/**', route => route.fulfill({ contentType: 'image/gif', body: GIF_BYTES }));
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:jedyny-rozmiar-322:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        const zoom = page.locator('.chat-gif-zoom').last();
        await expect(zoom).toHaveAttribute('data-zoom-animated', u('jedyny-rozmiar-322', 'sm', 'webp'));
        await zoom.click();
        await expect(page.locator(`${BOX} img.gif-lightbox-img`)).toHaveAttribute('src', u('jedyny-rozmiar-322', 'sm', 'webp'));
    });
});

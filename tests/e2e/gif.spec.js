'use strict';
/**
 * GIFs in messages.
 *
 * Locked in here:
 *  - a GIF is stored as a strict token, never a URL; anything that does not
 *    match is plain text, and the picture URL is rebuilt from the id on the
 *    provider's own host;
 *  - choosing is two steps (preview, then "Wyślij GIF") because anonymous
 *    messages cannot be unsent;
 *  - the GIPHY adapter sends the key, rating and a random per-browser id,
 *    searches from the browser, and survives rate limits and bad keys. It is
 *    tested against a MOCKED api.giphy.com (no key is needed or used);
 *  - GIFs are switched off cleanly when the server has no key;
 *  - reduced motion shows stills, a missing GIF degrades to a note, lists
 *    and excerpts say "GIF" instead of showing the token.
 *
 * The demo provider (4 local GIFs in public/demo-gifs/) drives most tests.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { collectOverflow } = require('../helpers/overflow');
const { activeDescription, describeFocus } = require('../helpers/focus');
const GifMessage = require('../../public/gif-message');
const chatReactions = require('../../public/chat-reactions');

const THREAD = { path: '/wiadomosci?rozmowa=1', name: 'chat thread', ready: '.chat-bubble' };
const GROUP = { path: '/wiadomosci?rozmowa=group', name: 'group chat', ready: '.chat-bubble' };
const LIST = { path: '/wiadomosci', name: 'chat list', ready: '.thread-row' };

const SHEET = '#gifSheet';
const DEMO_GIF = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'demo-gifs', 'hura.gif'));

/** Post a raw message body to the group chat (same session as the page). */
async function postGroupBody(page, body) {
    return page.evaluate(async (text) => {
        const response = await fetch('/api/wiadomosci/group', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text })
        });
        return { status: response.status, json: await response.json() };
    }, body);
}

async function openGifPicker(page, buttonSelector) {
    await page.locator(buttonSelector || '#gifBtn').click();
    await expect(page.locator(SHEET)).toHaveClass(/is-open/);
    await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toBeVisible();
}

// ===========================================================================
// The token: parse / build / URLs (shared with the server)
// ===========================================================================

test.describe('gif token', () => {
    const OK = '[gif:giphy:xT4uQulxzV39haRFjG:200x150]';

    test('a valid token parses and round-trips', () => {
        expect(GifMessage.parseGif(OK)).toEqual({ provider: 'giphy', kind: 'gif', id: 'xT4uQulxzV39haRFjG', width: 200, height: 150 });
        expect(GifMessage.parseGif('  ' + OK + '\n')).not.toBeNull(); // surrounding whitespace is trimmed
        expect(GifMessage.buildGifToken('giphy', 'xT4uQulxzV39haRFjG', 200, 150)).toBe(OK);
        expect(GifMessage.buildGifToken('demo', 'hura', 200.4, 199.6)).toBe('[gif:demo:hura:200x200]');
    });

    const REJECTED = [
        ['text around the token', 'hej ' + OK],
        ['two tokens', OK + OK],
        ['unknown provider', '[gif:evil:abc123:200x150]'],
        ['a URL as the id', '[gif:giphy:http://evil.example/x.gif:200x150]'],
        ['path traversal', '[gif:giphy:../../etc/passwd:200x150]'],
        ['quote in the id', '[gif:giphy:abc"onerror="x:200x150]'],
        ['angle brackets', '[gif:giphy:<img>:200x150]'],
        ['id too short', '[gif:giphy:ab:200x150]'],
        ['id too long', '[gif:giphy:' + 'a'.repeat(41) + ':200x150]'],
        ['zero width', '[gif:giphy:abc123:0x150]'],
        ['huge height', '[gif:giphy:abc123:200x99999]'],
        ['tiny width', '[gif:giphy:abc123:5x150]'],
        ['missing size', '[gif:giphy:abc123]'],
        ['uppercase tag', '[GIF:giphy:abc123:200x150]'],
        ['empty', ''],
        ['null', null]
    ];
    for (const [label, body] of REJECTED) {
        test(`rejects: ${label}`, () => {
            expect(GifMessage.parseGif(body)).toBeNull();
        });
    }

    test('buildGifToken refuses bad input instead of producing a token', () => {
        expect(GifMessage.buildGifToken('evil', 'abc123', 200, 150)).toBeNull();
        expect(GifMessage.buildGifToken('giphy', '../x', 200, 150)).toBeNull();
        expect(GifMessage.buildGifToken('giphy', 'abc123', 0, 150)).toBeNull();
        expect(GifMessage.buildGifToken('giphy', 'abc123', 'wide', 150)).toBeNull();
    });

    test('URLs are rebuilt from the id on the provider host only', () => {
        const giphy = GifMessage.gifUrls(GifMessage.parseGif(OK));
        expect(giphy.animated).toBe('https://media.giphy.com/media/xT4uQulxzV39haRFjG/200w.gif');
        expect(giphy.still).toBe('https://media.giphy.com/media/xT4uQulxzV39haRFjG/200w_s.gif');
        const demo = GifMessage.gifUrls({ provider: 'demo', id: 'hura', width: 200, height: 200 });
        expect(demo.animated).toBe('/demo-gifs/hura.gif');
        expect(GifMessage.gifUrls({ provider: 'giphy', id: '../x', width: 200, height: 150 })).toBeNull();
    });

    test('display size keeps the aspect ratio and never exceeds the cap', () => {
        expect(GifMessage.displaySize({ width: 200, height: 100 }, 220)).toEqual({ width: 200, height: 100 });
        expect(GifMessage.displaySize({ width: 480, height: 270 }, 220)).toEqual({ width: 220, height: 124 });
    });

    test('lists, excerpts and push previews say "GIF", not the token', () => {
        expect(GifMessage.gifPreviewText(OK)).toBe(GifMessage.PREVIEW_LABEL);
        expect(GifMessage.gifPreviewText('Cześć!')).toBeNull();
        expect(chatReactions.reactionExcerpt(OK)).toBe(GifMessage.PREVIEW_LABEL);
        expect(chatReactions.reactionExcerpt('Cześć, jak się masz?')).toBe('Cześć, jak się masz?');
    });
});

// ===========================================================================
// Config endpoint and switching GIFs off
// ===========================================================================

test.describe('gif config', () => {
    test('signed-in users get the provider config; the demo server uses the offline provider', async ({ request }) => {
        const response = await request.get('/api/wiadomosci/gif-config');
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toContain('no-store');
        expect(await response.json()).toEqual({
            enabled: true, provider: 'demo', apiKey: null, rating: 'pg', contentFilter: 'high', klipyKey: null
        });
    });

    test('signed-out requests are refused', async ({ playwright, baseURL }) => {
        const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
        const response = await anonymous.get('/api/wiadomosci/gif-config');
        expect(response.status()).toBeGreaterThanOrEqual(401);
        expect(response.status()).toBeLessThan(500);
        await anonymous.dispose();
    });

    test('with GIFs off (no key) the buttons stay hidden and the chat works as before', async ({ page }) => {
        await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({
            json: { enabled: false, provider: null, apiKey: null, rating: null }
        }));
        await openPage(page, THREAD);
        await page.waitForTimeout(500);
        await expect(page.locator('#gifBtn')).toBeHidden();
        await expect(page.locator('#gifComposeBtn')).toBeHidden();
        await expect(page.locator('#replyBody')).toBeVisible();
    });

    test('a failing config request leaves GIFs off without breaking the page', async ({ page }) => {
        await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({ status: 500, json: { error: 'x' } }));
        await openPage(page, THREAD);
        await page.waitForTimeout(500);
        await expect(page.locator('#gifBtn')).toBeHidden();
        await expect(page.locator('.chat-bubble').first()).toBeVisible();
    });
});

// ===========================================================================
// The picker (demo provider)
// ===========================================================================

test.describe('gif picker', () => {
    test('the button opens a labelled dialog with GIFs, attribution and a focused search box', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await expect(page.locator('#gifBtn')).toBeVisible();
        await expect(page.locator('#gifBtn')).toHaveAttribute('aria-label', 'Wyślij GIF');
        await openGifPicker(page);

        const sheet = page.locator(SHEET);
        await expect(sheet).toHaveAttribute('role', 'dialog');
        await expect(sheet).toHaveAttribute('aria-modal', 'true');
        await expect(sheet).not.toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator('#gifSheetTitle')).toHaveText('Wybierz GIF-a');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(4);
        await expect(page.locator(`${SHEET} .gif-sheet-attribution`)).toHaveText('Demo GIFs');
        await expect(page.locator(`${SHEET} .gif-sheet-search`)).toBeFocused();
        // Thumbnails are the light stills; nothing animated is loaded yet
        const sources = await page.locator(`${SHEET} .gif-sheet-item img`).evaluateAll(list => list.map(i => i.getAttribute('src')));
        sources.forEach(src => expect(src).toMatch(/-still\.gif$/));
    });

    test('search filters, an empty search says so, clearing brings everything back', async ({ page }) => {
        await openPage(page, THREAD);
        await openGifPicker(page);
        const search = page.locator(`${SHEET} .gif-sheet-search`);
        await search.fill('hura');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1);
        await search.fill('zzzz');
        await expect(page.locator(`${SHEET} .gif-sheet-status`)).toContainText('Nic nie znaleziono');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(0);
        await search.fill('');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(4);
    });

    test('tapping a GIF only previews it: nothing is sent until "Wyślij GIF"', async ({ page }) => {
        await openPage(page, THREAD);
        const before = await page.locator('.chat-bubble').count();
        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();

        const preview = page.locator(`#gifPreview`);
        await expect(preview).toBeVisible();
        // The preview is the animated file
        await expect(preview.locator('img')).toHaveAttribute('src', /\/demo-gifs\/brawo\.gif$/);
        await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(`#gifPreview .gif-sheet-send`)).toBeFocused();
        expect(await page.locator('.chat-bubble').count()).toBe(before);

        // Changing your mind clears the preview and still sends nothing
        await page.locator(`#gifPreview .gif-sheet-cancel`).click();
        await expect(preview).toBeHidden();
        await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toHaveAttribute('aria-pressed', 'false');
        expect(await page.locator('.chat-bubble').count()).toBe(before);
    });

    test('"Wyślij GIF" sends it: stored as a token, drawn as a picture, the field stays empty', async ({ page }) => {
        await openPage(page, THREAD);
        const before = await page.locator('.chat-gif').count();

        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-search`).fill('hura');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1); // wait out the search debounce
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();
        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/threads\/1\/messages$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator(`#gifPreview .gif-sheet-send`).click();
        expect((await sent).request().postDataJSON().body).toBe('[gif:demo:hura:200x200]');

        await expect(page.locator(SHEET)).toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator('.chat-gif')).toHaveCount(before + 1);
        const bubble = page.locator('.chat-bubble.has-gif').last();
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('src', '/demo-gifs/hura.gif');
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('alt', 'Animowany GIF');
        // Nothing got typed into the field by sending a GIF
        await expect(page.locator('#replyBody')).toHaveValue('');
        // The picture actually loaded
        await expect.poll(() => bubble.locator('img.chat-gif').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    });

    test('Escape and the close button close it and return focus to the GIF button', async ({ page }) => {
        await openPage(page, THREAD);
        await openGifPicker(page);
        await page.keyboard.press('Escape');
        await expect(page.locator(SHEET)).toHaveAttribute('aria-hidden', 'true');
        const focused = await activeDescription(page);
        expect(focused.id, describeFocus('focus after Escape', focused)).toBe('gifBtn');

        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-close`).click();
        await expect(page.locator(SHEET)).toHaveAttribute('aria-hidden', 'true');
        await openGifPicker(page);
        await page.locator('#gifSheetOverlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator(SHEET)).toHaveAttribute('aria-hidden', 'true');
    });

    test('Tab stays inside the open dialog', async ({ page }) => {
        await openPage(page, THREAD);
        await openGifPicker(page);
        for (let i = 0; i < 14; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => document.getElementById('gifSheet').contains(document.activeElement));
            expect(inside, `Tab #${i + 1} escaped the dialog`).toBe(true);
        }
    });

    test('reopening starts fresh: no stale preview or search text', async ({ page }) => {
        await openPage(page, THREAD);
        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-search`).fill('hura');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1); // wait out the search debounce
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();
        await page.keyboard.press('Escape');
        await openGifPicker(page);
        await expect(page.locator(`${SHEET} .gif-sheet-search`)).toHaveValue('');
        await expect(page.locator(`#gifPreview`)).toBeHidden();
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(4);
    });

    for (const width of [320, 375, 768, 1024]) {
        test(`the open picker fits the ${width}px viewport and its targets are at least 44px`, async ({ page }) => {
            await openPage(page, THREAD);
            await setViewport(page, width);
            await openGifPicker(page);
            await page.locator(`${SHEET} .gif-sheet-item`).first().click();
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

            const rect = await page.locator(SHEET).evaluate(el => {
                const r = el.getBoundingClientRect();
                return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: window.innerWidth, h: window.innerHeight };
            });
            expect(rect.left, JSON.stringify(rect)).toBeGreaterThanOrEqual(-0.5);
            expect(rect.top, JSON.stringify(rect)).toBeGreaterThanOrEqual(-0.5);
            expect(rect.right, JSON.stringify(rect)).toBeLessThanOrEqual(rect.w + 0.5);
            expect(rect.bottom, JSON.stringify(rect)).toBeLessThanOrEqual(rect.h + 0.5);

            // The preview is a full-screen modal on top: it covers the viewport and its buttons are inside
            const modal = await page.locator('#gifPreview').evaluate(el => {
                const r = el.getBoundingClientRect();
                const inside = ['.gif-sheet-send', '.gif-sheet-cancel', '.gif-sheet-preview-img'].every(sel => {
                    const b = el.querySelector(sel).getBoundingClientRect();
                    return b.left >= -0.5 && b.right <= window.innerWidth + 0.5 && b.top >= -0.5 && b.bottom <= window.innerHeight + 0.5;
                });
                return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight, inside };
            });
            expect(modal, JSON.stringify(modal)).toEqual({ w: modal.vw, h: modal.vh, vw: modal.vw, vh: modal.vh, inside: true });

            const small = await page.evaluate(() => [['#gifSheet', '.gif-sheet-close'], ['#gifPreview', '.gif-sheet-send'], ['#gifPreview', '.gif-sheet-cancel'], ['#gifSheet', '.gif-sheet-item'], ['#gifSheet', '.gif-sheet-search']]
                .flatMap(([scope, sel]) => Array.prototype.slice.call(document.querySelectorAll(scope + ' ' + sel)).map(el => {
                    const b = el.getBoundingClientRect();
                    return { sel, w: Math.round(b.width), h: Math.round(b.height) };
                })).filter(t => t.h < 43.99 || (t.sel !== '.gif-sheet-search' && t.w < 43.99)));
            expect(small, JSON.stringify(small)).toEqual([]);

            const report = await collectOverflow(page);
            expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
        });
    }
});

// ===========================================================================
// GIFs in conversations
// ===========================================================================

test.describe('gif messages', () => {
    test('the group chat takes GIFs, they take reactions, and the list says "GIF"', async ({ page }) => {
        await openPage(page, GROUP);
        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-search`).fill('swieta');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1); // wait out the search debounce
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();
        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/group$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator(`#gifPreview .gif-sheet-send`).click();
        expect((await sent).request().postDataJSON().body).toBe('[gif:demo:swieta:200x260]');

        const bubble = page.locator('.chat-bubble.has-gif').last();
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('src', '/demo-gifs/swieta.gif');
        // A reaction strip sits under the GIF like any message. The GIF just
        // sent is the newest message, so its row is the last one (the shared
        // demo chat may hold other GIFs from earlier tests).
        const row = page.locator('.chat-msg-row').last();
        await expect(row.locator('img.chat-gif')).toHaveAttribute('src', '/demo-gifs/swieta.gif');
        await expect(row.locator('.chat-reactions .chat-reaction-add')).toHaveCount(1);

        // The conversation list shows a label, never the token
        await page.goto('/wiadomosci', { waitUntil: 'load' });
        const groupRow = page.locator('.thread-row', { hasText: 'Czat grupowy' });
        await expect(groupRow.locator('.thread-last')).toHaveText(GifMessage.PREVIEW_LABEL);
        await expect(groupRow).not.toContainText('[gif:');
    });

    test('from the new-message card: needs a recipient, then sends to the group chat', async ({ page }) => {
        await openPage(page, LIST);
        await expect(page.locator('#gifComposeBtn')).toBeVisible();
        await page.locator('#gifComposeBtn').click();
        await expect(page.locator('.toast.show .toast-body')).toContainText('Wybierz odbiorcę');
        await expect(page.locator(SHEET)).not.toBeVisible();

        await page.locator('#targetSelect').selectOption('group');
        await openGifPicker(page, '#gifComposeBtn');
        await page.locator(`${SHEET} .gif-sheet-search`).fill('dzieki');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1); // wait out the search debounce
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();
        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/group$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator(`#gifPreview .gif-sheet-send`).click();
        expect((await sent).request().postDataJSON().body).toBe('[gif:demo:dzieki:200x112]');
        await expect(page).toHaveURL(/rozmowa=group/);
        await expect(page.locator('.chat-bubble.has-gif img.chat-gif').last()).toHaveAttribute('src', '/demo-gifs/dzieki.gif');
    });

    test('hostile tokens are shown as text and never become a picture', async ({ page }) => {
        const hostile = [
            '[gif:giphy:abc"onerror="window.__xss=1:200x100]',
            '[gif:giphy:../../evil:200x100]',
            '[gif:giphy:http://evil.example/x:200x100]',
            'tekst [gif:giphy:abc123:200x100]'
        ];
        await openPage(page, GROUP);
        for (const body of hostile) expect((await postGroupBody(page, body)).status).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());

        for (const body of hostile) {
            await expect(page.locator('.chat-bubble', { hasText: body.slice(0, 20) }).last()).toBeVisible();
        }
        // None of them produced an image pointing anywhere unexpected
        const sources = await page.locator('img.chat-gif').evaluateAll(list => list.map(i => i.getAttribute('src')));
        sources.forEach(src => expect(src).toMatch(/^(\/demo-gifs\/|https:\/\/media\.giphy\.com\/media\/)/));
        expect(sources.join(' ')).not.toContain('evil');
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('a GIF that cannot be loaded becomes a short note with a retry (we cannot tell "removed" from "offline")', async ({ page }) => {
        await openPage(page, GROUP);
        expect((await postGroupBody(page, '[gif:demo:nie-istnieje:200x100]')).status).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        const note = page.locator('.chat-gif-failed').last();
        await expect(note).toContainText('Nie udało się wczytać GIF-a');
        await expect(note.locator('.chat-gif-retry')).toHaveText('Spróbuj ponownie');
    });

    test('reduced motion: a still with a play badge; tap plays, tap again stops', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openPage(page, GROUP);
        expect((await postGroupBody(page, '[gif:demo:hura:200x200]')).status).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());

        const toggle = page.locator('.chat-gif-toggle').last();
        await expect(toggle).toHaveClass(/is-still/);
        await expect(toggle).toHaveAttribute('aria-label', 'Odtwórz GIF');
        await expect(toggle.locator('img')).toHaveAttribute('src', '/demo-gifs/hura-still.gif');
        await toggle.click();
        await expect(toggle.locator('img')).toHaveAttribute('src', '/demo-gifs/hura.gif');
        await expect(toggle).toHaveAttribute('aria-label', 'Zatrzymaj GIF');
        await expect(toggle).not.toHaveClass(/is-still/);
        await toggle.click();
        await expect(toggle.locator('img')).toHaveAttribute('src', '/demo-gifs/hura-still.gif');
    });

    for (const width of [320, 375, 768]) {
        test(`a GIF bubble and the GIF button cause no horizontal overflow at ${width}px`, async ({ page }) => {
            await openPage(page, GROUP);
            expect((await postGroupBody(page, '[gif:demo:swieta:200x260]')).status).toBe(200);
            await page.evaluate(() => window.loadThreadMessages());
            await setViewport(page, width);
            await expect(page.locator('.chat-bubble.has-gif').last()).toBeVisible();
            const report = await collectOverflow(page);
            expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
            expect(report.offenders, JSON.stringify(report.offenders)).toEqual([]);
            // Empty field: the GIF pill is in the composer and inside the screen
            const row = await page.evaluate(() => {
                const r = document.getElementById('gifBtn').getBoundingClientRect();
                const c = document.getElementById('composer').getBoundingClientRect();
                return { gif: { l: r.left, r: r.right }, composer: { l: c.left, r: c.right }, view: window.innerWidth };
            });
            expect(row.gif.l, JSON.stringify(row)).toBeGreaterThanOrEqual(row.composer.l - 0.5);
            expect(row.gif.r, JSON.stringify(row)).toBeLessThanOrEqual(row.composer.r + 0.5);
            expect(row.composer.r, JSON.stringify(row)).toBeLessThanOrEqual(row.view + 0.5);
        });
    }
});

// ===========================================================================
// The GIPHY adapter, against a mocked api.giphy.com (no key is used)
// ===========================================================================

function giphyItem(id, width, height, title) {
    return {
        id, title,
        images: { fixed_width: { width: String(width), height: String(height) } },
        analytics: {
            onload: { url: `https://giphy-analytics.test/seen/${id}?e=load` },
            onclick: { url: `https://giphy-analytics.test/click/${id}?e=click` },
            onsent: { url: `https://giphy-analytics.test/sent/${id}?e=sent` }
        }
    };
}

/** Install the mocks. `calls` collects every api.giphy.com / analytics request URL. */
async function mockGiphy(page, { search } = {}) {
    const calls = { api: [], pings: [] };
    await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({
        json: { enabled: true, provider: 'giphy', apiKey: 'TEST_KEY_123', rating: 'pg' }
    }));
    await page.route('https://api.giphy.com/**', async (route) => {
        const url = new URL(route.request().url());
        calls.api.push(url);
        if (url.pathname.endsWith('/trending')) {
            return route.fulfill({ json: {
                data: [giphyItem('trendA1', 200, 150, 'kot'), giphyItem('trendB2', 200, 300, 'pies')],
                pagination: { total_count: 2, count: 2, offset: 0 }
            } });
        }
        if (search) return search(route, url);
        return route.fulfill({ json: { data: [giphyItem('foundC3', 200, 120, 'wyniki')], pagination: { total_count: 1 } } });
    });
    await page.route('https://giphy-analytics.test/**', route => { calls.pings.push(new URL(route.request().url())); return route.fulfill({ status: 200, body: 'ok' }); });
    await page.route('https://media.giphy.com/**', route => route.fulfill({ contentType: 'image/gif', body: DEMO_GIF }));
    return calls;
}

test.describe('gif picker: GIPHY adapter (mocked)', () => {
    test('opens on trending with the key, rating and a random per-browser id; shows the required attribution', async ({ page }) => {
        const calls = await mockGiphy(page);
        await openPage(page, THREAD);
        await openGifPicker(page);

        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(2);
        await expect(page.locator(`${SHEET} .gif-sheet-attribution`)).toHaveText('Powered by GIPHY');
        const trending = calls.api.find(u => u.pathname === '/v1/gifs/trending');
        expect(trending, 'a trending request was made').toBeTruthy();
        expect(trending.searchParams.get('api_key')).toBe('TEST_KEY_123');
        expect(trending.searchParams.get('rating')).toBe('pg');
        expect(trending.searchParams.get('limit')).toBe('24');
        expect(trending.searchParams.get('bundle')).toBe('messaging_non_clips');
        expect(trending.searchParams.get('q')).toBeNull();
        const customer = trending.searchParams.get('customer_id');
        expect(customer).toMatch(/^[0-9a-f]{32}$/);
        // Stable per browser, and not derived from the account
        expect(await page.evaluate(() => localStorage.getItem('prezenty-gif-customer'))).toBe(customer);
        // Thumbnails are the provider's light stills
        const sources = await page.locator(`${SHEET} .gif-sheet-item img`).evaluateAll(list => list.map(i => i.getAttribute('src')));
        expect(sources).toEqual([
            'https://media.giphy.com/media/trendA1/200w_s.gif',
            'https://media.giphy.com/media/trendB2/200w_s.gif'
        ]);
    });

    test('searching goes through the browser, debounced, with the exact words typed', async ({ page }) => {
        const calls = await mockGiphy(page);
        await openPage(page, THREAD);
        await openGifPicker(page);
        const before = calls.api.length;
        await page.locator(`${SHEET} .gif-sheet-search`).pressSequentially('kot na płocie', { delay: 40 });
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1);

        const searches = calls.api.slice(before).filter(u => u.pathname === '/v1/gifs/search');
        // Typing 13 characters quickly made ONE request (debounce), not 13
        expect(searches.length, searches.map(u => u.searchParams.get('q')).join(' | ')).toBe(1);
        expect(searches[0].searchParams.get('q')).toBe('kot na płocie');
        expect(searches[0].searchParams.get('lang')).toBe('pl');
        expect(searches[0].searchParams.get('api_key')).toBe('TEST_KEY_123');
    });

    test('long search text is capped to the provider limit', async ({ page }) => {
        const calls = await mockGiphy(page);
        await openPage(page, THREAD);
        await openGifPicker(page);
        const before = calls.api.length;
        await page.locator(`${SHEET} .gif-sheet-search`).fill('a'.repeat(120));
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1);
        const q = calls.api.slice(before).find(u => u.pathname === '/v1/gifs/search').searchParams.get('q');
        expect(q.length).toBeLessThanOrEqual(50);
    });

    test('picking and sending stores a giphy token and pings click + sent (not view) with the random id', async ({ page }) => {
        const calls = await mockGiphy(page);
        await openPage(page, THREAD);
        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-item`).nth(1).click();
        await expect(page.locator(`#gifPreview img`)).toHaveAttribute('src', 'https://media.giphy.com/media/trendB2/200w.gif');
        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/threads\/1\/messages$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator(`#gifPreview .gif-sheet-send`).click();
        expect((await sent).request().postDataJSON().body).toBe('[gif:giphy:trendB2:200x300]');

        const bubble = page.locator('.chat-bubble.has-gif').last();
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('src', 'https://media.giphy.com/media/trendB2/200w.gif');
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('width', '200');
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('height', '300');

        await expect.poll(() => calls.pings.map(u => u.pathname).join(',')).toBe('/click/trendB2,/sent/trendB2');
        const customer = await page.evaluate(() => localStorage.getItem('prezenty-gif-customer'));
        calls.pings.forEach(u => {
            expect(u.searchParams.get('customer_id')).toBe(customer);
            expect(Number(u.searchParams.get('ts'))).toBeGreaterThan(1.7e12);
        });
    });

    test('a rate limit (429) and a bad key (403) show a friendly message, and search recovers', async ({ page }) => {
        let mode = '429';
        await mockGiphy(page, { search: (route) => mode === 'ok'
            ? route.fulfill({ json: { data: [giphyItem('okay77', 200, 100, 'ok')], pagination: { total_count: 1 } } })
            : route.fulfill({ status: Number(mode), json: { meta: { status: Number(mode) } } }) });
        await openPage(page, THREAD);
        await openGifPicker(page);
        const search = page.locator(`${SHEET} .gif-sheet-search`);
        const status = page.locator(`${SHEET} .gif-sheet-status`);

        await search.fill('pierwszy');
        await expect(status).toContainText('Za dużo wyszukiwań');
        mode = '403';
        await search.fill('drugi');
        await expect(status).toContainText('chwilowo niedostępne');
        mode = 'ok';
        await search.fill('trzeci');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1);
        await expect(status).toBeHidden();
    });

    test('a network failure shows a message instead of an endless spinner', async ({ page }) => {
        await mockGiphy(page, { search: route => route.abort('failed') });
        await openPage(page, THREAD);
        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-search`).fill('cokolwiek');
        await expect(page.locator(`${SHEET} .gif-sheet-status`)).toContainText('Nie udało się pobrać');
    });

    test('malformed items from the provider are ignored, never rendered', async ({ page }) => {
        await mockGiphy(page, { search: route => route.fulfill({ json: { data: [
            giphyItem('goodOne1', 200, 100, '<img src=x onerror=window.__xss=1>'),
            giphyItem('bad/../id', 200, 100, 'zły id'),
            { id: 'noImages1', title: 'bez obrazków' },
            giphyItem('zeroSize', 0, 0, 'zero')
        ], pagination: { total_count: 4 } } }) });
        await openPage(page, THREAD);
        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-search`).fill('cokolwiek');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1);
        await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toHaveAttribute('aria-label', 'GIF: <img src=x onerror=window.__xss=1>');
        expect(await page.locator(`${SHEET} img[onerror]`).count()).toBe(0);
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('"Pokaż więcej" loads the next page without duplicating or losing results', async ({ page }) => {
        const page1 = Array.from({ length: 24 }, (_, i) => giphyItem('pageOne' + String(i).padStart(2, '0'), 200, 100 + i, 'a' + i));
        const page2 = Array.from({ length: 5 }, (_, i) => giphyItem('pageTwo' + i, 200, 100, 'b' + i));
        const calls = await mockGiphy(page, { search: (route, url) => route.fulfill({ json: {
            data: Number(url.searchParams.get('offset')) === 0 ? page1 : page2, pagination: { total_count: 29 }
        } }) });
        await openPage(page, THREAD);
        await openGifPicker(page);
        await page.locator(`${SHEET} .gif-sheet-search`).fill('dużo');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(24);
        await page.locator(`${SHEET} .gif-sheet-more`).click();
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(29);
        await expect(page.locator(`${SHEET} .gif-sheet-more`)).toBeHidden();
        const offsets = calls.api.filter(u => u.pathname === '/v1/gifs/search').map(u => u.searchParams.get('offset'));
        expect(offsets).toEqual(['0', '24']);
    });
});

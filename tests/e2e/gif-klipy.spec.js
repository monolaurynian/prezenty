'use strict';
/**
 * KLIPY as the GIF provider.
 *
 * KLIPY's integration rules (docs.klipy.com) drive what is tested here:
 *  - calls come from the browser, with the app key in the URL path;
 *  - media URLs are used EXACTLY as the API returned them - a message stores
 *    only the slug and the page asks the "items" endpoint for the URLs;
 *  - results are shown in the order sent; ads (type "ad") are not GIFs;
 *  - an invalid key answers HTTP 404, not 401.
 *
 * Everything runs against a MOCK of api.klipy.com / static.klipy.com that
 * has the response shape from their docs (all four renditions hd/md/sm/xs,
 * each as gif/webp/jpg). No key is needed or used. What the real service
 * adds on top (rate limit, moderation, real ranking) is not covered.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { collectOverflow } = require('../helpers/overflow');
const GifMessage = require('../../public/gif-message');

const GROUP = { path: '/wiadomosci?rozmowa=group', name: 'group chat', ready: '.chat-bubble' };
const THREAD = { path: '/wiadomosci?rozmowa=1', name: 'chat thread', ready: '.chat-bubble' };
const SHEET = '#gifSheet';
const REPO = path.resolve(__dirname, '..', '..');
const GIF_BYTES = fs.readFileSync(path.join(REPO, 'public', 'demo-gifs', 'hura.gif'));
const KEY = 'TEST_APP_KEY_123';

// ---------------------------------------------------------------------------
// Fixtures shaped like the KLIPY docs
// ---------------------------------------------------------------------------

/** One item with every rendition KLIPY sends. `w`x`h` is the "sm" (220px) size. */
function klipyItem(slug, w, h, title, extra) {
    const url = (size, ext) => `https://static.klipy.com/ii/testhash0123456789abcdef/14/af/${slug}-${size}.${ext}`;
    const media = (size, ext, mw, mh) => ({ url: url(size, ext), width: mw, height: mh, size: 12345 });
    const rendition = (size, mw, mh) => ({
        gif: media(size, 'gif', mw, mh), webp: media(size, 'webp', mw, mh), jpg: media(size, 'jpg', mw, mh),
        mp4: media(size, 'mp4', mw, mh), webm: media(size, 'webm', mw, mh)
    });
    return Object.assign({
        id: 8041071659142944, slug, title, type: 'gif', tags: [],
        blur_preview: 'data:image/jpeg;base64,/9j/AAAA',
        file: {
            hd: rendition('hd', 498, Math.round(498 * h / w)),
            md: rendition('md', 340, Math.round(340 * h / w)),
            sm: rendition('sm', w, h),
            xs: rendition('xs', 90, Math.round(90 * h / w))
        }
    }, extra || {});
}

const page1 = (items, hasNext) => ({ result: true, data: { data: items, current_page: 1, per_page: 24, has_next: !!hasNext } });
const U = (slug, size, ext) => `https://static.klipy.com/ii/testhash0123456789abcdef/14/af/${slug}-${size}.${ext}`;

/**
 * Installs the mocks. `handlers` can override trending / search / items;
 * everything is recorded in `calls`.
 */
async function mockKlipy(page, handlers) {
    const h = handlers || {};
    const calls = { api: [], shares: [], items: [], media: [] };
    await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({ json: {
        enabled: true, provider: 'klipy', apiKey: KEY, rating: 'pg', contentFilter: 'high', klipyKey: KEY
    } }));
    await page.route('https://api.klipy.com/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        calls.api.push({ method: request.method(), url });
        const prefix = `/api/v1/${KEY}/gifs/`;
        if (!url.pathname.startsWith(prefix)) {
            return route.fulfill({ status: 404, json: { result: false, errors: { message: ['The provided API key is invalid.'] } } });
        }
        const tail = url.pathname.slice(prefix.length);
        if (tail.startsWith('share/')) {
            calls.shares.push({ slug: decodeURIComponent(tail.slice(6)), body: request.postDataJSON() });
            return route.fulfill({ json: { result: true } });
        }
        if (tail === 'items') {
            calls.items.push(url.searchParams.get('slugs'));
            if (h.items) return h.items(route, url);
            return route.fulfill({ json: page1(url.searchParams.get('slugs').split(',').map(s => klipyItem(s, 220, 220, s))) });
        }
        if (tail === 'search' && h.search) return h.search(route, url);
        if (tail === 'trending' && h.trending) return h.trending(route, url);
        if (tail === 'trending') {
            return route.fulfill({ json: page1([klipyItem('kot-na-plocie-101', 220, 220, 'Kot'), klipyItem('pies-w-czapce-202', 220, 124, 'Pies')], false) });
        }
        return route.fulfill({ json: page1([klipyItem('wynik-szukania-303', 220, 165, 'Wynik')], false) });
    });
    await page.route('https://static*.klipy.com/**', route => {
        calls.media.push(route.request().url());
        return route.fulfill({ contentType: 'image/gif', body: GIF_BYTES });
    });
    return calls;
}

async function openKlipyPicker(page, buttonSelector) {
    await page.locator(buttonSelector || '#gifBtn').click();
    await expect(page.locator(SHEET)).toHaveClass(/is-open/);
    await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toBeVisible();
}

async function postGroupBody(page, body) {
    return page.evaluate(async (text) => {
        const response = await fetch('/api/wiadomosci/group', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text })
        });
        return response.status;
    }, body);
}

// ===========================================================================
// Token and server configuration
// ===========================================================================

test.describe('klipy token', () => {
    test('a slug token parses, round-trips and has no computed URL', () => {
        const token = '[gif:klipy:hello-hi-662:220x220]';
        expect(GifMessage.parseGif(token)).toEqual({ provider: 'klipy', id: 'hello-hi-662', width: 220, height: 220 });
        expect(GifMessage.buildGifToken('klipy', 'hello-hi-662', 220, 220)).toBe(token);
        // KLIPY forbids rebuilding URLs: the page must look them up
        expect(GifMessage.gifUrls(GifMessage.parseGif(token))).toBeNull();
        // Slugs are longer than GIPHY ids
        const long = 'a-very-long-title-about-a-cat-sitting-on-a-fence-in-the-rain-12345';
        expect(GifMessage.parseGif(`[gif:klipy:${long}:220x220]`)).not.toBeNull();
    });

    for (const [label, token] of [
        ['URL as slug', '[gif:klipy:https://static.klipy.com/x.gif:220x220]'],
        ['slash in slug', '[gif:klipy:a/b:220x220]'],
        ['dot in slug', '[gif:klipy:a.b:220x220]'],
        ['quote in slug', '[gif:klipy:a"b:220x220]'],
        ['slug too long', '[gif:klipy:' + 'a'.repeat(121) + ':220x220]'],
        ['unknown provider', '[gif:klipi:hello-hi-662:220x220]']
    ]) {
        test(`rejects: ${label}`, () => {
            expect(GifMessage.parseGif(token)).toBeNull();
        });
    }

    test('each provider keeps its own id length limit: a long GIPHY/demo id is not accepted just because KLIPY slugs may be long', () => {
        const id = n => 'a'.repeat(n);
        expect(GifMessage.parseGif(`[gif:klipy:${id(120)}:220x220]`)).not.toBeNull();
        expect(GifMessage.parseGif(`[gif:klipy:${id(121)}:220x220]`)).toBeNull();
        for (const provider of ['giphy', 'demo']) {
            expect(GifMessage.parseGif(`[gif:${provider}:${id(40)}:220x220]`), provider).not.toBeNull();
            expect(GifMessage.parseGif(`[gif:${provider}:${id(41)}:220x220]`), provider).toBeNull();
        }
        expect(GifMessage.buildGifToken('giphy', id(41), 220, 220)).toBeNull();
        expect(GifMessage.buildGifToken('klipy', id(41), 220, 220)).not.toBeNull();
    });

    test('KLIPY GIFs are labelled "GIF" in lists, like the others', () => {
        expect(GifMessage.gifPreviewText('[gif:klipy:hello-hi-662:220x220]')).toBe(GifMessage.PREVIEW_LABEL);
    });
});

test.describe('klipy server config', () => {
    const probe = "const db=require('./lib/db');const g=require('./lib/gif');" +
        "console.log(JSON.stringify(g.gifConfig()));setTimeout(()=>process.exit(0),200);";

    function config(env) {
        const base = Object.assign({}, process.env);
        ['KLIPY_API_KEY', 'KLIPY_CONTENT_FILTER', 'GIPHY_API_KEY', 'GIPHY_RATING', 'GIF_PROVIDER', 'OFFLINE_MODE', 'DB_PASSWORD']
            .forEach(k => delete base[k]);
        const run = spawnSync(process.execPath, ['-e', probe], {
            cwd: REPO, env: Object.assign(base, { DB_PASSWORD: 'x', OFFLINE_MODE: 'false' }, env), encoding: 'utf8', timeout: 30000
        });
        const line = (run.stdout || '').split('\n').filter(l => l.startsWith('{')).pop();
        expect(line, run.stderr).toBeTruthy();
        return JSON.parse(line);
    }

    test('off without any key', () => {
        expect(config({})).toMatchObject({ enabled: false, provider: null, apiKey: null, klipyKey: null });
    });

    test('KLIPY alone: on, the key is trimmed, the filter defaults to high', () => {
        expect(config({ KLIPY_API_KEY: '  abc123  ' })).toMatchObject({
            enabled: true, provider: 'klipy', apiKey: 'abc123', klipyKey: 'abc123', contentFilter: 'high'
        });
    });

    test('the content filter is configurable and junk falls back to high', () => {
        expect(config({ KLIPY_API_KEY: 'k', KLIPY_CONTENT_FILTER: 'Medium' }).contentFilter).toBe('medium');
        expect(config({ KLIPY_API_KEY: 'k', KLIPY_CONTENT_FILTER: 'whatever' }).contentFilter).toBe('high');
    });

    test('GIPHY alone still works and exposes no KLIPY key', () => {
        expect(config({ GIPHY_API_KEY: 'g1' })).toMatchObject({ enabled: true, provider: 'giphy', apiKey: 'g1', klipyKey: null });
    });

    test('both keys: KLIPY by default, GIF_PROVIDER switches, and the KLIPY key is kept for showing old GIFs', () => {
        const both = { KLIPY_API_KEY: 'k1', GIPHY_API_KEY: 'g1' };
        expect(config(both)).toMatchObject({ provider: 'klipy', apiKey: 'k1', klipyKey: 'k1' });
        expect(config(Object.assign({ GIF_PROVIDER: 'giphy' }, both))).toMatchObject({ provider: 'giphy', apiKey: 'g1', klipyKey: 'k1' });
    });

    test('GIF_PROVIDER naming a provider without a key falls back to the one that has a key', () => {
        expect(config({ GIPHY_API_KEY: 'g1', GIF_PROVIDER: 'klipy' })).toMatchObject({ provider: 'giphy' });
        expect(config({ KLIPY_API_KEY: 'k1', GIF_PROVIDER: 'giphy' })).toMatchObject({ provider: 'klipy' });
        expect(config({ KLIPY_API_KEY: 'k1', GIF_PROVIDER: 'nonsense' })).toMatchObject({ provider: 'klipy' });
    });
});

// ===========================================================================
// The picker
// ===========================================================================

test.describe('klipy picker', () => {
    test('opens on trending with the key in the path and the documented parameters; shows KLIPY attribution', async ({ page }) => {
        const calls = await mockKlipy(page);
        await openPage(page, THREAD);
        await openKlipyPicker(page);

        const trending = calls.api.find(c => c.url.pathname === `/api/v1/${KEY}/gifs/trending`);
        expect(trending, 'a trending request was made').toBeTruthy();
        expect(trending.method).toBe('GET');
        const q = trending.url.searchParams;
        expect(q.get('page')).toBe('1');
        expect(q.get('per_page')).toBe('24');
        expect(q.get('locale')).toBe('pl');
        expect(q.get('content_filter')).toBe('high');
        expect(q.get('format_filter')).toBe('webp,gif,jpg');
        expect(q.get('q')).toBeNull();
        const customer = q.get('customer_id');
        expect(customer).toMatch(/^[0-9a-f]{32}$/);
        expect(await page.evaluate(() => localStorage.getItem('prezenty-gif-customer'))).toBe(customer);

        await expect(page.locator(`${SHEET} .gif-sheet-attribution`)).toHaveText('Powered by KLIPY');
        await expect(page.locator(`${SHEET} .gif-sheet-search`)).toHaveAttribute('placeholder', 'Szukaj GIF-ów w KLIPY...');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(2);
    });

    test('thumbnails and the preview use the URLs exactly as KLIPY returned them, in KLIPY\'s order', async ({ page }) => {
        await mockKlipy(page);
        await openPage(page, THREAD);
        await openKlipyPicker(page);

        // Stills = the small JPG; order = the order of the response (never re-sorted)
        const stills = await page.locator(`${SHEET} .gif-sheet-item img`).evaluateAll(list => list.map(i => i.getAttribute('src')));
        expect(stills).toEqual([U('kot-na-plocie-101', 'sm', 'jpg'), U('pies-w-czapce-202', 'sm', 'jpg')]);

        await page.locator(`${SHEET} .gif-sheet-item`).nth(1).click();
        // Preview = the small animated WebP (lighter than the GIF), unmodified
        await expect(page.locator(`${SHEET} .gif-sheet-preview img`)).toHaveAttribute('src', U('pies-w-czapce-202', 'sm', 'webp'));
    });

    test('search is debounced, sends the exact words and the filter, and pages by page number', async ({ page }) => {
        const first = Array.from({ length: 24 }, (_, i) => klipyItem('strona-pierwsza-' + (100 + i), 220, 100 + i, 'a' + i));
        const second = Array.from({ length: 3 }, (_, i) => klipyItem('strona-druga-' + (200 + i), 220, 120, 'b' + i));
        const calls = await mockKlipy(page, { search: (route, url) => {
            const pageNo = Number(url.searchParams.get('page'));
            return route.fulfill({ json: { result: true, data: { data: pageNo === 1 ? first : second, current_page: pageNo, per_page: 24, has_next: pageNo === 1 } } });
        } });
        await openPage(page, THREAD);
        await openKlipyPicker(page);
        const before = calls.api.length;
        await page.locator(`${SHEET} .gif-sheet-search`).pressSequentially('kot na płocie', { delay: 40 });
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(24);

        const searches = calls.api.slice(before).filter(c => c.url.pathname.endsWith('/gifs/search'));
        expect(searches.length, searches.map(c => c.url.searchParams.get('q')).join(' | ')).toBe(1);
        expect(searches[0].url.searchParams.get('q')).toBe('kot na płocie');
        expect(searches[0].url.searchParams.get('page')).toBe('1');
        expect(searches[0].url.searchParams.get('content_filter')).toBe('high');

        await page.locator(`${SHEET} .gif-sheet-more`).click();
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(27);
        await expect(page.locator(`${SHEET} .gif-sheet-more`)).toBeHidden();
        const pages = calls.api.filter(c => c.url.pathname.endsWith('/gifs/search')).map(c => c.url.searchParams.get('page'));
        expect(pages).toEqual(['1', '2']);
    });

    test('ads, other media types, foreign hosts and broken items are never shown as GIFs', async ({ page }) => {
        const evil = klipyItem('podejrzany-obrazek-404', 220, 220, 'zły host');
        evil.file.sm.webp.url = 'https://evil.example/x.webp';
        evil.file.sm.gif.url = 'https://evil.example/x.gif';
        evil.file.md = evil.file.hd = evil.file.xs = undefined;
        const noFile = { slug: 'bez-plikow-505', title: 'bez plików', type: 'gif' };
        const badSlug = klipyItem('zly/slug', 220, 220, 'zły slug');
        await mockKlipy(page, { trending: route => route.fulfill({ json: page1([
            klipyItem('dobry-pierwszy-1001', 220, 220, '<img src=x onerror=window.__xss=1>'),
            { type: 'ad', id: 9, slug: 'reklama', content: '<b>kup</b>' },
            evil, noFile, badSlug,
            klipyItem('dobry-drugi-1002', 220, 150, 'drugi')
        ]) }) });
        await openPage(page, THREAD);
        await openKlipyPicker(page);

        const labels = await page.locator(`${SHEET} .gif-sheet-item`).evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        // Only the two real GIFs, in the order received; the title is text, never markup
        expect(labels).toEqual(['GIF: <img src=x onerror=window.__xss=1>', 'GIF: drugi']);
        expect(await page.locator(`${SHEET} img[onerror]`).count()).toBe(0);
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('an invalid key (KLIPY answers 404) and a rate limit (429) show friendly messages, and search recovers', async ({ page }) => {
        let mode = '404';
        await mockKlipy(page, { search: (route) => mode === 'ok'
            ? route.fulfill({ json: page1([klipyItem('udalo-sie-777', 220, 100, 'ok')]) })
            : mode === '404'
                ? route.fulfill({ status: 404, json: { result: false, errors: { message: ['The provided API key is invalid.'] } } })
                : route.fulfill({ status: 429, json: { result: false } }) });
        await openPage(page, THREAD);
        await openKlipyPicker(page);
        const search = page.locator(`${SHEET} .gif-sheet-search`);
        const status = page.locator(`${SHEET} .gif-sheet-status`);

        await search.fill('pierwszy');
        await expect(status).toContainText('chwilowo niedostępne');
        mode = '429';
        await search.fill('drugi');
        await expect(status).toContainText('Za dużo wyszukiwań');
        mode = 'ok';
        await search.fill('trzeci');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1);
        await expect(status).toBeHidden();
    });

    test('{"result": false} and a network failure also end in a message, not a spinner', async ({ page }) => {
        let mode = 'false';
        await mockKlipy(page, { search: route => mode === 'false'
            ? route.fulfill({ json: { result: false, errors: { message: ['x'] } } })
            : route.abort('failed') });
        await openPage(page, THREAD);
        await openKlipyPicker(page);
        const search = page.locator(`${SHEET} .gif-sheet-search`);
        await search.fill('cos');
        await expect(page.locator(`${SHEET} .gif-sheet-status`)).toContainText('Nie udało się pobrać');
        mode = 'abort';
        await search.fill('cos innego');
        await expect(page.locator(`${SHEET} .gif-sheet-status`)).toContainText('Nie udało się pobrać');
    });

    test('with no KLIPY key in the config the GIF buttons stay hidden', async ({ page }) => {
        await page.route('**/api/wiadomosci/gif-config', route => route.fulfill({ json: {
            enabled: true, provider: 'klipy', apiKey: null, rating: 'pg', contentFilter: 'high', klipyKey: null
        } }));
        await openPage(page, THREAD);
        await page.waitForTimeout(500);
        await expect(page.locator('#gifBtn')).toBeHidden();
    });
});

// ===========================================================================
// Sending
// ===========================================================================

test.describe('klipy sending', () => {
    test('send stores the slug token, tells KLIPY (share trigger), and draws the picture from the URL KLIPY gave', async ({ page }) => {
        const calls = await mockKlipy(page);
        await openPage(page, THREAD);
        await openKlipyPicker(page);
        await page.locator(`${SHEET} .gif-sheet-search`).fill('kot');
        await expect(page.locator(`${SHEET} .gif-sheet-item`)).toHaveCount(1); // wait out the debounce
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();

        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/threads\/1\/messages$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator(`${SHEET} .gif-sheet-send`).click();
        expect((await sent).request().postDataJSON().body).toBe('[gif:klipy:wynik-szukania-303:220x165]');

        // The share trigger: slug in the path, the browser's random id and the search words in the body
        await expect.poll(() => calls.shares.length).toBe(1);
        const customer = await page.evaluate(() => localStorage.getItem('prezenty-gif-customer'));
        expect(calls.shares[0]).toEqual({ slug: 'wynik-szukania-303', body: { customer_id: customer, q: 'kot' } });
        const share = calls.api.find(c => c.method === 'POST');
        expect(share.url.pathname).toBe(`/api/v1/${KEY}/gifs/share/wynik-szukania-303`);

        // Shown straight away from what the search returned: no extra lookup needed
        const bubble = page.locator('.chat-bubble.has-gif').last();
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('src', U('wynik-szukania-303', 'sm', 'webp'));
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('width', '220');
        await expect(bubble.locator('img.chat-gif')).toHaveAttribute('height', '165');
        expect(calls.items).toEqual([]);
    });

    test('trending sends carry an empty q in the share trigger', async ({ page }) => {
        const calls = await mockKlipy(page);
        await openPage(page, THREAD);
        await openKlipyPicker(page);
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();
        await page.locator(`${SHEET} .gif-sheet-send`).click();
        await expect.poll(() => calls.shares.length).toBe(1);
        expect(calls.shares[0].body.q).toBe('');
        expect(calls.shares[0].slug).toBe('kot-na-plocie-101');
    });

    test('nothing is shared with KLIPY until "Wyślij GIF"', async ({ page }) => {
        const calls = await mockKlipy(page);
        await openPage(page, THREAD);
        await openKlipyPicker(page);
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();
        await page.locator(`${SHEET} .gif-sheet-cancel`).click();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        expect(calls.shares).toEqual([]);
    });
});

// ===========================================================================
// Showing KLIPY GIFs that are already in a conversation
// ===========================================================================

test.describe('klipy GIFs in a conversation', () => {
    const A = '[gif:klipy:album-zdjec-901:220x220]';
    const B = '[gif:klipy:drugi-obrazek-902:220x124]';
    const GONE = '[gif:klipy:usuniety-gif-903:220x180]';

    test('stored slugs are exchanged for URLs in ONE batched request, drawn exactly as KLIPY returned them, and cached', async ({ page }) => {
        const calls = await mockKlipy(page, { items: (route, url) => {
            const slugs = url.searchParams.get('slugs').split(',').filter(s => s !== 'usuniety-gif-903');
            return route.fulfill({ json: page1(slugs.map(s => klipyItem(s, 220, s.startsWith('drugi') ? 124 : 220, s))) });
        } });
        await openPage(page, GROUP);
        for (const token of [A, B, GONE]) expect(await postGroupBody(page, token)).toBe(200);
        calls.items.length = 0;
        await page.evaluate(() => window.loadThreadMessages());

        const shown = page.locator('.chat-bubble.has-gif img.chat-gif');
        await expect(shown.last()).toBeVisible();
        const sources = await shown.evaluateAll(list => list.map(i => i.getAttribute('src')));
        expect(sources).toContain(U('album-zdjec-901', 'sm', 'webp'));
        expect(sources).toContain(U('drugi-obrazek-902', 'sm', 'webp'));
        // The one KLIPY no longer has becomes a note
        await expect(page.locator('.chat-gif-missing').last()).toHaveText('Ten GIF jest niedostępny');

        // One request carried all the slugs that were on screen and unknown;
        // the one KLIPY left out is asked for once more on its own before it counts as gone
        expect(calls.items.length, JSON.stringify(calls.items)).toBe(2);
        expect(calls.items[0].split(',')).toEqual(expect.arrayContaining(['album-zdjec-901', 'drugi-obrazek-902', 'usuniety-gif-903']));
        expect(calls.items[1]).toBe('usuniety-gif-903');
        const itemsCall = calls.api.find(c => c.url.pathname.endsWith('/gifs/items'));
        expect(itemsCall.url.searchParams.get('customer_id')).toMatch(/^[0-9a-f]{32}$/);

        // Opening the conversation again re-renders every message from scratch
        // and does not ask again: found slugs AND the "gone" one are cached
        const askedBefore = calls.items.length;
        await page.evaluate(() => window.openThread('group', false));
        await expect(shown.last()).toBeVisible();
        await expect(page.locator('.chat-gif-missing').last()).toBeVisible();
        await page.waitForTimeout(800);
        expect(calls.items.length).toBe(askedBefore);
        expect(await page.locator('.chat-gif-slot').count()).toBe(0);
    });

    // Real KLIPY behaviour (seen in a production console): a searched GIF has a
    // slug "title--kId", and the items endpoint answers with the item under "title".
    test('a searched GIF ("title--id") is found when KLIPY answers under the title alone', async ({ page }) => {
        const titleOf = s => (s.includes('--') ? s.slice(0, s.lastIndexOf('--')) : s);
        await mockKlipy(page, { items: (route, url) => route.fulfill({
            json: page1(url.searchParams.get('slugs').split(',').map(s => klipyItem(titleOf(s), 220, 220, titleOf(s))))
        }) });
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:merry-christmas-trump--krgkjE0X7:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        const row = page.locator('.chat-msg-row').last();
        await expect(row.locator(`img.chat-gif[src="${U('merry-christmas-trump', 'sm', 'webp')}"]`)).toBeVisible();
        await expect(row.locator('.chat-gif-missing')).toHaveCount(0);
    });

    test('while the lookup is pending a slot of the final size holds the place (no layout jump), then the picture replaces it', async ({ page }) => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await mockKlipy(page, { items: async (route, url) => {
            await gate;
            return route.fulfill({ json: page1(url.searchParams.get('slugs').split(',').map(s => klipyItem(s, 220, 220, s))) });
        } });
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:wolny-gif-950:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());

        const slot = page.locator('.chat-gif-slot[data-klipy-slug="wolny-gif-950"]');
        await expect(slot).toBeVisible();
        const box = await slot.boundingBox();
        expect(Math.round(box.width)).toBe(220);
        expect(Math.round(box.height)).toBe(220);
        await expect(slot).toHaveAttribute('role', 'img');

        release();
        const picture = page.locator(`img.chat-gif[src="${U('wolny-gif-950', 'sm', 'webp')}"]`);
        await expect(picture).toBeVisible();
        await expect(slot).toHaveCount(0);
        const after = await picture.boundingBox();
        expect(Math.round(after.width)).toBe(220);
        expect(Math.round(after.height)).toBe(220);
    });

    // A lookup that fails (offline, the provider's rate limit) is NOT the same
    // as a GIF that is gone: it is temporary, so it says so and can be retried.
    test('if the lookup itself fails (rate limit) it retries on its own, then offers "Spróbuj ponownie" instead of claiming the GIF is gone', async ({ page }) => {
        await page.addInitScript(() => { window.GIF_RETRY_DELAYS = [60, 60]; });
        const warnings = [];
        page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
        const calls = await mockKlipy(page, { items: route => route.fulfill({ status: 429, json: { result: false } }) });
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:limit-gif-960:220x220]')).toBe(200);
        calls.items.length = 0;
        await page.evaluate(() => window.loadThreadMessages());

        // Only the message just sent: the shared chat still holds notes from earlier tests
        const row = page.locator('.chat-msg-row').last();
        const note = row.locator('.chat-gif-failed');
        await expect(note).toContainText('Nie udało się wczytać GIF-a');
        await expect(note.locator('.chat-gif-retry')).toHaveText('Spróbuj ponownie');
        await expect(row.locator('.chat-gif-slot')).toHaveCount(0);
        // never the permanent message for a temporary problem
        await expect(row.locator('.chat-gif-missing:not(.chat-gif-failed)')).toHaveCount(0);
        // first try + the two automatic retries
        expect(calls.items.length, JSON.stringify(calls.items)).toBe(3);
        expect(warnings.join('\n')).toContain('[GIF] KLIPY lookup failed');
    });

    test('"Spróbuj ponownie" draws the GIF once KLIPY answers again', async ({ page }) => {
        await page.addInitScript(() => { window.GIF_RETRY_DELAYS = []; });
        let healthy = false;
        await mockKlipy(page, { items: (route, url) => healthy
            ? route.fulfill({ json: page1(url.searchParams.get('slugs').split(',').map(s => klipyItem(s, 220, 220, s))) })
            : route.fulfill({ status: 429, json: { result: false } }) });
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:znowu-dziala-961:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        const row = page.locator('.chat-msg-row').last();
        const retry = row.locator('.chat-gif-retry');
        await expect(retry).toBeVisible();

        healthy = true;
        await retry.click();
        await expect(row.locator(`img.chat-gif[src="${U('znowu-dziala-961', 'sm', 'webp')}"]`)).toBeVisible();
        await expect(row.locator('.chat-gif-failed')).toHaveCount(0);
    });

    test('a failed lookup that recovers during the automatic retries just shows the GIF', async ({ page }) => {
        await page.addInitScript(() => { window.GIF_RETRY_DELAYS = [150, 150, 150]; });
        let asked = 0;
        const calls = await mockKlipy(page, { items: (route, url) => (++asked < 2)
            ? route.fulfill({ status: 429, json: { result: false } })
            : route.fulfill({ json: page1(url.searchParams.get('slugs').split(',').map(s => klipyItem(s, 220, 220, s))) }) });
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:szybko-wraca-962:220x220]')).toBe(200);
        calls.items.length = 0; asked = 0;
        await page.evaluate(() => window.loadThreadMessages());
        const row = page.locator('.chat-msg-row').last();
        await expect(row.locator(`img.chat-gif[src="${U('szybko-wraca-962', 'sm', 'webp')}"]`)).toBeVisible();
        await expect(row.locator('.chat-gif-failed')).toHaveCount(0);
    });

    test('a picture that will not load (blocked, offline) becomes the retryable note, not "niedostępny"', async ({ page }) => {
        await page.addInitScript(() => { window.GIF_RETRY_DELAYS = []; });
        await mockKlipy(page, { items: (route, url) => route.fulfill({ json: page1(url.searchParams.get('slugs').split(',').map(s => klipyItem(s, 220, 220, s))) }) });
        await page.route('https://static*.klipy.com/**', route => route.abort()); // registered last, so it wins
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:obrazek-pada-963:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        const row = page.locator('.chat-msg-row').last();
        await expect(row.locator('.chat-gif-failed .chat-gif-retry')).toBeVisible();
        await expect(row.locator('.chat-gif-missing:not(.chat-gif-failed)')).toHaveCount(0);
    });

    test('a hostile items response (foreign host) is not drawn', async ({ page }) => {
        await mockKlipy(page, { items: (route, url) => {
            const item = klipyItem(url.searchParams.get('slugs'), 220, 220, 'x');
            ['hd', 'md', 'sm', 'xs'].forEach(size => ['gif', 'webp', 'jpg'].forEach(ext => { item.file[size][ext].url = `https://evil.example/${size}.${ext}`; }));
            return route.fulfill({ json: page1([item]) });
        } });
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:zly-host-970:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        await expect(page.locator('.chat-gif-missing').last()).toBeVisible();
        const sources = await page.locator('img.chat-gif').evaluateAll(list => list.map(i => i.getAttribute('src')));
        expect(sources.join(' ')).not.toContain('evil.example');
    });

    test('without a KLIPY key a stored KLIPY GIF is a note (nothing is requested)', async ({ page }) => {
        const requested = [];
        page.on('request', r => { if (r.url().includes('klipy.com')) requested.push(r.url()); });
        await openPage(page, GROUP); // the demo server has no KLIPY key
        expect(await postGroupBody(page, '[gif:klipy:bez-klucza-980:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        await expect(page.locator('.chat-gif-missing').last()).toHaveText('Ten GIF jest niedostępny');
        expect(requested).toEqual([]);
    });

    test('the conversation list says "GIF" for a KLIPY GIF', async ({ page }) => {
        await mockKlipy(page);
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:ostatni-gif-990:220x220]')).toBe(200);
        await page.goto('/wiadomosci', { waitUntil: 'load' });
        const row = page.locator('.thread-row', { hasText: 'Czat grupowy' });
        await expect(row.locator('.thread-last')).toHaveText(GifMessage.PREVIEW_LABEL);
    });

    test('reduced motion: the still JPG with a play badge, tap plays the WebP', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await mockKlipy(page);
        await openPage(page, GROUP);
        expect(await postGroupBody(page, '[gif:klipy:spokojny-gif-995:220x220]')).toBe(200);
        await page.evaluate(() => window.loadThreadMessages());
        const toggle = page.locator('.chat-gif-toggle').last();
        await expect(toggle.locator('img')).toHaveAttribute('src', U('spokojny-gif-995', 'sm', 'jpg'));
        await toggle.click();
        await expect(toggle.locator('img')).toHaveAttribute('src', U('spokojny-gif-995', 'sm', 'webp'));
    });

    for (const width of [320, 375, 768]) {
        test(`slots and pictures cause no horizontal overflow at ${width}px`, async ({ page }) => {
            await mockKlipy(page);
            await openPage(page, GROUP);
            expect(await postGroupBody(page, '[gif:klipy:szeroki-gif-999:220x220]')).toBe(200);
            await page.evaluate(() => window.loadThreadMessages());
            await setViewport(page, width);
            // the shared demo chat keeps the copies posted by earlier widths
            await expect(page.locator(`img.chat-gif[src="${U('szeroki-gif-999', 'sm', 'webp')}"]`).last()).toBeVisible();
            const report = await collectOverflow(page);
            expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
            expect(report.offenders, JSON.stringify(report.offenders)).toEqual([]);
        });
    }
});

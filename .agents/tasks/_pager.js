// KLIPY cards: swipe, tabs, drawn scrollbar (mocked KLIPY)
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', '@playwright/test'));
const { startDemoServer } = require(path.join(REPO, 'tests', 'helpers', 'start-demo-server.js'));
const out = n => path.join(__dirname, n);
(async () => {
    const server = await startDemoServer();
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 375, height: 740 }, serviceWorkers: 'block', hasTouch: true });
    await context.request.post('/api/login', { data: { username: 'e2e', password: 'e2e' } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 200)); });
    const GIF = fs.readFileSync(path.join(REPO, 'public', 'demo-gifs', 'hura.gif'));
    const calls = [];
    const media = (slug, size, ext, w, h) => ({ url: `https://static.klipy.com/ii/x/${slug}-${size}.${ext}`, width: w, height: h, size: 1 });
    const rend = (slug, size, w, h) => ({ gif: media(slug, size, 'gif', w, h), webp: media(slug, size, 'webp', w, h), jpg: media(slug, size, 'jpg', w, h), png: media(slug, size, 'png', w, h) });
    const make = (kind, n) => Array.from({ length: 24 }, (_, i) => { const h = 120 + (i % 3) * 40; const slug = `${kind}-${n}-${i}`; return { id: i, slug, title: slug, type: kind, file: { hd: rend(slug, 'hd', 400, h * 2), md: rend(slug, 'md', 300, h * 1.5), sm: rend(slug, 'sm', 200, h), xs: rend(slug, 'xs', 90, 60) } }; });
    await page.route('**/api/wiadomosci/gif-config', r => r.fulfill({ json: { enabled: true, provider: 'klipy', apiKey: 'K', rating: 'pg', contentFilter: 'high', klipyKey: 'K' } }));
    await page.route('https://api.klipy.com/**', r => {
        const u = r.request().url();
        const kind = u.includes('/stickers/') ? 'sticker' : u.includes('/static-memes/') ? 'meme' : 'gif';
        calls.push(kind + (new URL(u).searchParams.get('q') ? ':' + new URL(u).searchParams.get('q') : ''));
        return r.fulfill({ json: { result: true, data: { data: make(kind, new URL(u).searchParams.get('q') ? 2 : 1), current_page: 1, per_page: 24, has_next: false } } });
    });
    await page.route('https://static*.klipy.com/**', r => r.fulfill({ contentType: 'image/gif', body: GIF }));
    const info = () => page.evaluate(() => {
        const p = document.querySelector('.gif-sheet-pager');
        const ind = document.querySelector('.gif-sheet-tab-indicator').getBoundingClientRect();
        const sel = document.querySelector('.gif-sheet-tab[aria-selected=true]');
        const thumb = document.querySelector('.gif-sheet-pagethumb').getBoundingClientRect();
        const bar = document.querySelector('.gif-sheet-pagebar').getBoundingClientRect();
        return {
            page: +(p.scrollLeft / p.clientWidth).toFixed(2), selected: sel && sel.dataset.kind,
            indLeft: Math.round(ind.left), selLeft: sel && Math.round(sel.getBoundingClientRect().left),
            thumb: `${Math.round(thumb.left - bar.left)}+${Math.round(thumb.width)}/${Math.round(bar.width)}`,
            cards: Array.from(document.querySelectorAll('.gif-sheet-card')).map(c => c.dataset.kind + ':' + c.querySelectorAll('.gif-sheet-item').length).join(' ')
        };
    });
    const cdp = await context.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const swipe = async (x0, x1, y0, y1, steps) => { await touch('touchStart', x0, y0); for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.waitForTimeout(16); } await touch('touchEnd'); await page.waitForTimeout(900); };
    try {
        await page.goto('/wiadomosci?rozmowa=group', { waitUntil: 'load' });
        await page.waitForTimeout(2500);
        console.log('debug', JSON.stringify(await page.evaluate(() => ({ picker: typeof window.GifPicker, klipy: typeof window.GifKlipy, enabled: window.GifPicker && window.GifPicker.isEnabled(), msg: typeof window.GifMessage }))));
        await page.waitForSelector('#gifBtn', { state: 'visible' });
        await page.locator('#gifBtn').click();
        await page.waitForSelector('#gifSheet.is-open .gif-sheet-item');
        await page.waitForTimeout(600);
        console.log('open           ', JSON.stringify(await info()), ' requests:', calls.join(','));
        await swipe(300, 90, 600, 604, 10);
        console.log('swipe left     ', JSON.stringify(await info()), ' requests:', calls.join(','));
        await swipe(300, 90, 600, 604, 10);
        console.log('swipe left     ', JSON.stringify(await info()), ' requests:', calls.join(','));
        await swipe(300, 90, 600, 604, 10);
        console.log('swipe left (end)', JSON.stringify(await info()));
        await swipe(90, 300, 600, 590, 10);
        console.log('swipe right    ', JSON.stringify(await info()));
        // small sideways flick with a bit of vertical drift
        await swipe(250, 200, 600, 630, 6);
        console.log('short drift    ', JSON.stringify(await info()));
        // vertical drag still resizes the panel and does not turn the page
        await swipe(200, 205, 650, 480, 12);
        console.log('vertical drag  ', JSON.stringify(await info()), 'panel h', await page.evaluate(() => Math.round(document.getElementById('gifSheet').getBoundingClientRect().height)));
        // tap on the third tab, then the first
        await page.locator('.gif-sheet-tab[data-kind=meme]').click(); await page.waitForTimeout(900);
        console.log('tap Memy       ', JSON.stringify(await info()), ' requests:', calls.join(','));
        await page.locator('.gif-sheet-tab[data-kind=gif]').click(); await page.waitForTimeout(900);
        console.log('tap GIF-y      ', JSON.stringify(await info()));
        // drag the scrollbar thumb to the middle, then to the end
        const bar = await page.evaluate(() => { const b = document.querySelector('.gif-sheet-pagebar').getBoundingClientRect(); const t = document.querySelector('.gif-sheet-pagethumb').getBoundingClientRect(); return { y: b.top + b.height / 2, x: t.left + t.width / 2, left: b.left, right: b.right }; });
        await page.mouse.move(bar.x, bar.y); await page.mouse.down();
        for (let i = 1; i <= 10; i++) { await page.mouse.move(bar.x + i * 12, bar.y); await page.waitForTimeout(20); }
        console.log('dragging thumb ', JSON.stringify(await info()));
        await page.mouse.up(); await page.waitForTimeout(900);
        console.log('thumb released ', JSON.stringify(await info()), ' requests:', calls.join(','));
        // tap on the bare track near the end
        await page.mouse.click(bar.right - 6, bar.y); await page.waitForTimeout(900);
        console.log('track tap (end)', JSON.stringify(await info()));
        await page.screenshot({ path: out('_p1.png') });
        // a search follows the card in front
        await page.locator('.gif-sheet-search').fill('kot'); await page.waitForTimeout(1200);
        console.log('search "kot"   ', JSON.stringify(await info()), ' requests:', calls.join(','));
        await page.locator('.gif-sheet-tab[data-kind=sticker]').click(); await page.waitForTimeout(1000);
        console.log('→ stickers     ', JSON.stringify(await info()), ' requests:', calls.join(','));
    } catch (e) { console.log('FAIL', e.message); }
    console.log('pageerrors', errors);
    await browser.close();
    await server.stop().catch(() => {});
    process.exit(0);
})();

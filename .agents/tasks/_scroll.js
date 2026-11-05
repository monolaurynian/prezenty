// Scrolling the GIF list expands / collapses the docked panel
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', '@playwright/test'));
const { startDemoServer } = require(path.join(REPO, 'tests', 'helpers', 'start-demo-server.js'));
(async () => {
    const server = await startDemoServer();
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 375, height: 740 }, serviceWorkers: 'block' });
    await context.request.post('/api/login', { data: { username: 'e2e', password: 'e2e' } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const state = () => page.evaluate(() => {
        const s = document.getElementById('gifSheet'); const r = document.getElementById('gifSheetResults');
        return { expanded: s.classList.contains('is-expanded'), h: Math.round(s.getBoundingClientRect().height), top: Math.round(r.scrollTop), max: r.scrollHeight - r.clientHeight, aria: document.querySelector('.gif-sheet-expand').getAttribute('aria-expanded') };
    });
    const scrollTo = async (y) => { await page.evaluate(v => { document.getElementById('gifSheetResults').scrollTop = v; }, y); await page.waitForTimeout(700); };
    try {
        const fs = require('fs');
        const GIF = fs.readFileSync(path.join(REPO, 'public', 'demo-gifs', 'hura.gif'));
        const KEY = 'K';
        const media = (slug, size, ext, w, h) => ({ url: `https://static.klipy.com/ii/x/${slug}-${size}.${ext}`, width: w, height: h, size: 1 });
        const rend = (slug, size, w, h) => ({ gif: media(slug, size, 'gif', w, h), webp: media(slug, size, 'webp', w, h), jpg: media(slug, size, 'jpg', w, h) });
        const items = Array.from({ length: 24 }, (_, i) => { const h = 120 + (i % 3) * 40; const slug = 'gif-' + (100 + i); return { id: i, slug, title: slug, type: 'gif', file: { hd: rend(slug, 'hd', 498, h * 2), md: rend(slug, 'md', 340, Math.round(h * 1.5)), sm: rend(slug, 'sm', 220, h), xs: rend(slug, 'xs', 90, 50) } }; });
        await page.route('**/api/wiadomosci/gif-config', r => r.fulfill({ json: { enabled: true, provider: 'klipy', apiKey: KEY, rating: 'pg', contentFilter: 'high', klipyKey: KEY } }));
        await page.route('https://api.klipy.com/**', r => r.fulfill({ json: { result: true, data: { data: items, current_page: 1, per_page: 24, has_next: false } } }));
        await page.route('https://static*.klipy.com/**', r => r.fulfill({ contentType: 'image/gif', body: GIF }));
        await page.goto('/wiadomosci?rozmowa=group', { waitUntil: 'load' });
        await page.waitForSelector('#gifBtn', { state: 'visible' });
        await page.locator('#gifBtn').click();
        await page.waitForSelector('#gifSheet.is-open .gif-sheet-item');
        await page.waitForTimeout(600);
        console.log('open      ', JSON.stringify(await state()));
        await scrollTo(10);  console.log('scroll 10 ', JSON.stringify(await state()));
        await scrollTo(60);  console.log('scroll 60 ', JSON.stringify(await state()));
        await scrollTo(0);   console.log('back to 0 ', JSON.stringify(await state()));
        await scrollTo(80);  console.log('down again', JSON.stringify(await state()));
        await page.locator('.gif-sheet-expand').click(); await page.waitForTimeout(600);
        console.log('chevron   ', JSON.stringify(await state()));
        await scrollTo(0);   console.log('0 manual  ', JSON.stringify(await state()));
        await page.keyboard.press('Escape'); await page.waitForTimeout(400);
        await page.locator('#gifBtn').click(); await page.waitForSelector('#gifSheet.is-open .gif-sheet-item'); await page.waitForTimeout(600);
        console.log('reopen    ', JSON.stringify(await state()));
        await scrollTo(60);  console.log('reopen 60 ', JSON.stringify(await state()));
    } catch (e) { console.log('FAIL', e.message); }
    console.log('pageerrors', errors);
    await browser.close();
    await server.stop().catch(() => {});
    process.exit(0);
})();


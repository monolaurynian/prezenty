// Screenshots: new-message card (empty / typed), GIF panel header, banner with a live KLIPY GIF
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', '@playwright/test'));
const { startDemoServer } = require(path.join(REPO, 'tests', 'helpers', 'start-demo-server.js'));
const GIF = fs.readFileSync(path.join(REPO, 'public', 'demo-gifs', 'hura.gif'));
const out = n => path.join(__dirname, n);
(async () => {
    const server = await startDemoServer();
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 375, height: 740 }, serviceWorkers: 'block' });
    await context.request.post('/api/login', { data: { username: 'e2e', password: 'e2e' } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    try {
        await page.goto('/wiadomosci', { waitUntil: 'load' });
        await page.waitForSelector('#gifComposeBtn', { state: 'visible' });
        await page.locator('#targetSelect').selectOption('group');
        await page.screenshot({ path: out('_n1-compose-empty.png') });
        await page.locator('#composeBody').fill('Jaki rozmiar buta nosisz? Bardzo chciałabym wiedzieć, bo szukam prezentu.');
        await page.screenshot({ path: out('_n2-compose-typed.png') });
        await page.locator('#composeBody').fill('');
        await page.locator('#gifComposeBtn').click();
        await page.waitForSelector('#gifSheet.is-open .gif-sheet-item');
        await page.waitForTimeout(600);
        await page.screenshot({ path: out('_n3-panel.png') });
        await page.keyboard.press('Escape');

        // Banner with a live KLIPY GIF (mocked)
        const KEY = 'TEST_KEY';
        const media = (size, ext, w, h) => ({ url: `https://static.klipy.com/ii/x/what-buddy-${size}.${ext}`, width: w, height: h, size: 1 });
        const rend = (size, w, h) => ({ gif: media(size, 'gif', w, h), webp: media(size, 'webp', w, h), jpg: media(size, 'jpg', w, h) });
        const item = { id: 1, slug: 'what-buddy', title: 'what buddy', type: 'gif', file: { hd: rend('hd', 498, 280), md: rend('md', 340, 191), sm: rend('sm', 220, 124), xs: rend('xs', 90, 51) } };
        const page2 = await context.newPage();
        await page2.route('**/api/wiadomosci/gif-config', r => r.fulfill({ json: { enabled: true, provider: 'klipy', apiKey: KEY, rating: 'pg', contentFilter: 'high', klipyKey: KEY } }));
        await page2.route('https://api.klipy.com/**', r => r.fulfill({ json: { result: true, data: { data: [item], current_page: 1, per_page: 24, has_next: false } } }));
        await page2.route('https://static*.klipy.com/**', r => r.fulfill({ contentType: 'image/gif', body: GIF }));
        await page2.addInitScript(() => { localStorage.setItem('app_version', 'old'); localStorage.setItem('app_release_seen', 'older'); });
        await page2.goto('/home', { waitUntil: 'load' });
        await page2.waitForSelector('#updateBanner img');
        await page2.waitForTimeout(1500);
        await page2.screenshot({ path: out('_n4-banner.png') });
        console.log('banner img', await page2.locator('#updateBanner img').evaluate(i => ({ src: i.src, w: i.naturalWidth, alt: i.alt })));
        console.log('credit', await page2.locator('#updateBanner').innerText().then(t => t.includes('GIF: KLIPY')));
    } catch (e) { console.log('FAIL', e.message); }
    console.log('pageerrors', errors);
    await browser.close();
    await server.stop().catch(() => {});
    process.exit(0);
})();

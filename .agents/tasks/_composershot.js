// Screenshots of the new composer and docked GIF panel (demo provider, phone size).
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
    page.setDefaultTimeout(10000);
    const out = (n) => path.join(__dirname, n);
    const log = [];
    try {
        await page.goto('/wiadomosci?rozmowa=group', { waitUntil: 'load' });
        await page.waitForSelector('.chat-bubble');
        await page.waitForSelector('#gifBtn', { state: 'visible' });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        await page.screenshot({ path: out('_c1-empty.png') });

        await page.locator('#replyBody').fill('Dzięki za pomysł!');
        await page.waitForTimeout(300);
        await page.screenshot({ path: out('_c2-typed.png') });

        await page.locator('#replyBody').fill('To jest dłuższa wiadomość, która zajmie więcej niż jedną linię, żeby sprawdzić czy pole rośnie razem z tekstem i nie psuje układu.');
        await page.waitForTimeout(300);
        await page.screenshot({ path: out('_c3-multiline.png') });
        log.push('textarea height: ' + await page.locator('#replyBody').evaluate(el => el.offsetHeight));

        await page.locator('#replyBody').fill('');
        await page.locator('#gifBtn').click();
        await page.waitForSelector('#gifSheet .gif-sheet-item');
        await page.waitForTimeout(900);
        await page.screenshot({ path: out('_c4-panel.png') });

        await page.locator('.gif-sheet-expand').click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: out('_c5-expanded.png') });

        await page.locator('.gif-sheet-expand').click();
        await page.waitForTimeout(500);
        await page.locator('#gifSheet .gif-sheet-item').nth(1).click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: out('_c6-chosen.png') });
        log.push('ok');
    } catch (e) { log.push('ERR ' + e.message); }
    console.log(log.join('\n'));
    await browser.close();
    await server.stop();
})();

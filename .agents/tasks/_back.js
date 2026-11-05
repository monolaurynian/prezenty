// Does the new-message field keep its size after a conversation was open?
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
    const size = () => page.evaluate(() => {
        const r = document.getElementById('composeBody').getBoundingClientRect();
        const f = document.querySelector('#composeComposer .composer-field').getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width), fieldW: Math.round(f.width), styleH: document.getElementById('composeBody').style.height };
    });
    try {
        await page.goto('/wiadomosci', { waitUntil: 'load' });
        await page.waitForSelector('#composeBody', { state: 'visible' });
        console.log('first   ', JSON.stringify(await size()));
        await page.evaluate(() => window.openThread('group'));
        await page.waitForSelector('#replyBody', { state: 'visible' });
        await page.locator('#replyBody').fill('hej');
        await page.locator('#replyBody').press('Enter');
        await page.waitForTimeout(800);
        await page.evaluate(() => window.closeThread());
        await page.waitForSelector('#composeBody', { state: 'visible' });
        await page.waitForTimeout(500);
        console.log('returned', JSON.stringify(await size()));
        await page.evaluate(() => window.openThread('group'));
        await page.waitForSelector('#replyBody', { state: 'visible' });
        console.log('reply   ', JSON.stringify(await page.evaluate(() => { const r = document.getElementById('replyBody').getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; })));
    } catch (e) { console.log('FAIL', e.message); }
    await browser.close();
    await server.stop().catch(() => {});
    process.exit(0);
})();

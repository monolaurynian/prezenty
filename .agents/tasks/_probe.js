// Probe: why does the docked panel still cover the newest message?
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
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const log = [];
    try {
        await page.goto('/wiadomosci?rozmowa=group', { waitUntil: 'load' });
        await page.waitForSelector('#gifBtn', { state: 'visible' });
        const measure = () => page.evaluate(() => {
            const box = document.getElementById('chatMessages').getBoundingClientRect();
            const sheet = document.getElementById('gifSheet');
            const last = Array.from(document.querySelectorAll('.chat-msg-row')).pop().getBoundingClientRect();
            return {
                scrollY: Math.round(window.scrollY), docH: document.documentElement.scrollHeight, innerH: window.innerHeight,
                boxBottom: Math.round(box.bottom), lastMsgBottom: Math.round(last.bottom),
                panelTop: sheet ? Math.round(sheet.getBoundingClientRect().top) : null,
                bodyPad: getComputedStyle(document.body).paddingBottom,
                cls: document.documentElement.className, panelH: document.documentElement.style.getPropertyValue('--gif-panel-h')
            };
        });
        log.push('before: ' + JSON.stringify(await measure()));
        await page.locator('#gifBtn').click();
        await page.waitForSelector('#gifSheet .gif-sheet-item');
        await page.waitForTimeout(1200);
        log.push('open:      ' + JSON.stringify(await measure()));
        await page.locator('.gif-sheet-expand').click();
        await page.waitForTimeout(900);
        log.push('expanded:  ' + JSON.stringify(await measure()));
        await page.locator('.gif-sheet-expand').click();
        await page.waitForTimeout(900);
        log.push('collapsed: ' + JSON.stringify(await measure()));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
        const closed = await measure();
        log.push('closed:    ' + JSON.stringify(closed));
        log.push('composer visible after close: ' + await page.evaluate(() => { const r = document.getElementById('composer').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }));
    } catch (e) { log.push('ERR ' + e.message); }
    log.push('pageerrors: ' + JSON.stringify(errors));
    console.log(log.join('\n'));
    await browser.close();
    await server.stop();
})();

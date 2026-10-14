'use strict';
const path = require('path');
const WT = 'c:\\Users\\matmamon\\OneDrive - amazon.com\\Documents\\Prezenty\\prezenty\\.worktrees\\home-buckets-1';
const { chromium, request } = require(path.join(WT, 'node_modules', '@playwright', 'test'));
const { startDemoServer } = require(path.join(WT, 'tests', 'helpers', 'start-demo-server.js'));
const { installCdnCache } = require(path.join(WT, 'tests', 'helpers', 'cdn-cache.js'));
const { openPage } = require(path.join(WT, 'tests', 'helpers', 'pages.js'));
(async () => {
    const server = await startDemoServer();
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const api = await request.newContext({ baseURL: server.baseURL });
        await api.post('/api/login', { data: { username: 'm', password: 'm' } });
        const state = await api.storageState();
        for (const w of [375, 1024]) {
            const ctx = await browser.newContext({ baseURL: server.baseURL, viewport: { width: w, height: 800 }, storageState: state, serviceWorkers: 'block' });
            await installCdnCache(ctx);
            const page = await ctx.newPage();
            await openPage(page, { path: '/', name: 'home', reloadsOnce: true, ready: '#availablePresentsList .home-recipient-card' });
            for (const id of ['Available', 'Reservations', 'Bought']) {
                await page.click(`#accordion${id} .accordion-button`);
                await page.waitForTimeout(700);
                const r = await page.evaluate((id) => {
                    const b = document.querySelector(`#accordion${id} .accordion-button`);
                    const i = document.querySelector(`#accordion${id} .accordion-item`);
                    return { collapsed: b.classList.contains('collapsed'), btn: getComputedStyle(b).borderRadius, item: getComputedStyle(i).borderRadius, itemH: Math.round(i.getBoundingClientRect().height), btnH: Math.round(b.getBoundingClientRect().height) };
                }, id);
                console.log(w, id, JSON.stringify(r));
            }
            await ctx.close();
        }
    } finally { await browser.close(); await server.stop(); }
})().catch(e => { console.error('FAILED', e); process.exit(1); });

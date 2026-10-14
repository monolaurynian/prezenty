'use strict';
// node repro2.js <baseURL> <presentId>   (recipients page; reserves a specific present using an unambiguous selector)
const ROOT = 'c:/Users/matmamon/OneDrive - amazon.com/Documents/Prezenty/prezenty';
const { chromium } = require(ROOT + '/node_modules/playwright');
const { installCdnCache } = require(ROOT + '/tests/helpers/cdn-cache');

const snap = (page) => page.evaluate(() => {
    const out = { presents: [], recipients: [] };
    document.querySelectorAll('.present-item').forEach(el => {
        const b = el.querySelector('.reserve-btn');
        out.presents.push(`present#${el.dataset.id} cls=[${el.className.replace(/\s+/g, ' ').trim()}] btn=[${b ? b.textContent.trim().replace(/\s+/g, ' ') : '-'}] title=${(el.querySelector('.present-title') || {}).textContent}`.slice(0, 190));
    });
    document.querySelectorAll('.recipient-item').forEach(el => {
        out.recipients.push(`recipient#${el.dataset.id} cls=[${el.className.replace(/\s+/g, ' ').trim()}]`);
    });
    out.cache = (window._dataCache.presents || []).filter(p => p.reserved_by).map(p => `${p.id}:${p.reserved_by}`).join(',');
    return out;
});

(async () => {
    const base = process.argv[2];
    const pid = process.argv[3];
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
    await installCdnCache(context);
    await context.request.post(base + '/api/login', { data: { username: 'demo', password: 'demo' } });
    const page = await context.newPage();
    const net = [];
    page.on('response', async r => { const u = r.url(); if (u.includes('/api/presents') || u.includes('recipients-with-presents')) net.push(`${r.request().method()} ${u.replace(base, '')} -> ${r.status()}`); });
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE.ERROR ' + m.text().slice(0, 200)); });
    await page.goto(base + '/recipients', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const before = await snap(page);
    console.log('BEFORE\n  ' + before.presents.join('\n  ') + '\n  ' + before.recipients.join('\n  ') + '\n  cache reserved: ' + before.cache);
    net.length = 0;
    await page.click(`.present-item[data-id="${pid}"] .reserve-btn`);
    await page.waitForTimeout(2500);
    const after = await snap(page);
    console.log('AFTER CLICK present ' + pid + '\n  ' + after.presents.join('\n  ') + '\n  ' + after.recipients.join('\n  ') + '\n  cache reserved: ' + after.cache);
    console.log('NET ' + net.join(' | '));
    net.length = 0;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const rl = await snap(page);
    console.log('AFTER RELOAD\n  ' + rl.presents.join('\n  ') + '\n  cache reserved: ' + rl.cache);
    console.log('ERRORS ' + (errs.join('\n   ') || '(none)'));
    await browser.close();
})().catch(e => { console.error('SCRIPT FAIL', e); process.exit(1); });

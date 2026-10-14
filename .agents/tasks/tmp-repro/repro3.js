'use strict';
// node repro3.js <baseURL> : home -> reserve 5 -> bought -> rezerwacje.html -> recipients, with SW enabled after first visit
const ROOT = 'c:/Users/matmamon/OneDrive - amazon.com/Documents/Prezenty/prezenty';
const { chromium } = require(ROOT + '/node_modules/playwright');
const { installCdnCache } = require(ROOT + '/tests/helpers/cdn-cache');
const txt = (page, id) => page.evaluate((i) => (document.getElementById(i) || {}).innerText && document.getElementById(i).innerText.replace(/\s+/g, ' ').slice(0, 260), id);

(async () => {
    const base = process.argv[2];
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
    await installCdnCache(context);
    await context.request.post(base + '/api/login', { data: { username: 'demo', password: 'demo' } });
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE.ERROR ' + m.text().slice(0, 200)); });

    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    console.log('SW controller on home:', await page.evaluate(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller));
    await page.click('button[onclick*="reservePresent(event, 5)"]');
    await page.waitForTimeout(2000);
    console.log('HOME after reserve 5 -> myRes:', await txt(page, 'myReservationsList'));
    // mark bought
    const bought = page.locator('#myReservationsList button[onclick*="Bought"], #myReservationsList button:has-text("Kupione")').first();
    console.log('bought btn count', await bought.count());
    if (await bought.count()) {
        await bought.click();
        await page.waitForTimeout(2000);
        console.log('HOME after Kupione -> myRes:', await txt(page, 'myReservationsList'));
        console.log('HOME after Kupione -> bought:', await txt(page, 'boughtPresentsList'));
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    console.log('HOME reload -> myRes:', await txt(page, 'myReservationsList'));
    console.log('HOME reload -> bought:', await txt(page, 'boughtPresentsList'));
    await page.goto(base + '/rezerwacje.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    console.log('REZERWACJE:', await txt(page, 'reservedContent'));
    await page.goto(base + '/recipients', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    console.log('SW controller on recipients:', await page.evaluate(() => !!navigator.serviceWorker.controller));
    const mine = await page.evaluate(() => [...document.querySelectorAll('.present-item.reserved-by-me')].map(e => e.dataset.id + (e.classList.contains('checked') ? '(checked)' : '')));
    console.log('RECIPIENTS reserved-by-me:', mine.join(','));
    console.log('ERRORS', errs.join('\n   ') || '(none)');
    await browser.close();
})().catch(e => { console.error('SCRIPT FAIL', e); process.exit(1); });

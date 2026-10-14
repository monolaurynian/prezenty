'use strict';
// SW-upgrade scenario. PHASE=warm : visit pages on the (old) server so the SW + cache-first assets get stored.
//                      PHASE=test : (new server, same origin + same profile) reserve on home, then check lists.
const ROOT = 'c:/Users/matmamon/OneDrive - amazon.com/Documents/Prezenty/prezenty';
const { chromium } = require(ROOT + '/node_modules/playwright');
const { installCdnCache } = require(ROOT + '/tests/helpers/cdn-cache');
const txt = (page, id) => page.evaluate((i) => { const e = document.getElementById(i); return e && e.innerText.replace(/\s+/g, ' ').slice(0, 200); }, id);

(async () => {
    const base = process.argv[2];
    const phase = process.env.PHASE;
    const profile = ROOT + '/.agents/tasks/tmp-repro/profile';
    const context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, baseURL: base, viewport: { width: 1280, height: 900 } });
    await installCdnCache(context);
    await context.request.post(base + '/api/login', { data: { username: 'demo', password: 'demo' } });
    const page = context.pages()[0] || await context.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    const served = [];
    page.on('response', r => { const u = r.url(); if (/home-page|recipients-|\.js/.test(u) && u.startsWith(base)) served.push(`${r.status()} ${u.replace(base, '')} fromSW=${r.fromServiceWorker()}`); });
    if (phase === 'warm') {
        await page.goto(base + '/', { waitUntil: 'networkidle' });
        await page.goto(base + '/recipients', { waitUntil: 'networkidle' });
        await page.waitForTimeout(3000);
        const keys = await page.evaluate(async () => { const ks = await caches.keys(); const out = {}; for (const k of ks) out[k] = (await (await caches.open(k)).keys()).length; return out; });
        console.log('WARM caches', JSON.stringify(keys));
    } else {
        await page.goto(base + '/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        const keys = await page.evaluate(async () => { const ks = await caches.keys(); const out = {}; for (const k of ks) out[k] = (await (await caches.open(k)).keys()).length; return out; });
        console.log('TEST caches', JSON.stringify(keys));
        const btn = page.locator('button[onclick*="reservePresent(event, 5)"]');
        console.log('reserve btn count', await btn.count());
        if (await btn.count()) {
            await btn.click();
            await page.waitForTimeout(2500);
            console.log('myRes after reserve:', await txt(page, 'myReservationsList'));
        }
        console.log('SERVED', served.join('\n   '));
    }
    console.log('ERRORS', errs.join('\n  ') || '(none)');
    await context.close();
})().catch(e => { console.error('SCRIPT FAIL', e); process.exit(1); });

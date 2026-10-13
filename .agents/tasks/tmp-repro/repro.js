'use strict';
// Throwaway read-only repro. Usage: node repro.js <baseURL> <home|recipients>
const path = require('path');
const ROOT = 'c:/Users/matmamon/OneDrive - amazon.com/Documents/Prezenty/prezenty';
const { chromium } = require(ROOT + '/node_modules/playwright');
const { installCdnCache } = require(ROOT + '/tests/helpers/cdn-cache');

(async () => {
    const base = process.argv[2];
    const mode = process.argv[3] || 'recipients';
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
    await installCdnCache(context);
    const login = await context.request.post(base + '/api/login', { data: { username: 'demo', password: 'demo' } });
    console.log('LOGIN', login.status());
    const page = await context.newPage();
    const net = [];
    page.on('response', async r => {
        const u = r.url();
        if (u.includes('/api/') && !u.includes('/api/wiadomosci') && !u.includes('/api/notifications')) {
            let body = '';
            try { body = (await r.text()).slice(0, 160); } catch (e) {}
            net.push(`${r.request().method()} ${u.replace(base, '')} -> ${r.status()} ${body.replace(/\s+/g, ' ')}`);
        }
    });
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE.ERROR ' + m.text().slice(0, 200)); });

    const url = mode === 'home' ? '/' : '/recipients';
    await page.goto(base + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    console.log('URL', page.url());
    net.length = 0;

    if (mode === 'recipients') {
        const info = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('.reserve-btn')];
            return {
                count: btns.length,
                firstItems: btns.slice(0, 5).map(b => {
                    const it = b.closest('[data-id]');
                    return { id: it && it.getAttribute('data-id'), text: b.textContent.trim(), cls: b.className, onclick: b.getAttribute('onclick') };
                }),
                userId: window._currentUserId
            };
        });
        console.log('BEFORE', JSON.stringify(info, null, 1));
        const target = info.firstItems.find(i => /Zarezerwuj/i.test(i.text) || /reserve'/.test(i.onclick || ''));
        if (!target) { console.log('NO RESERVABLE BUTTON'); }
        else {
            const sel = `[data-id="${target.id}"] .reserve-btn`;
            await page.click(sel);
            await page.waitForTimeout(2500);
            const after = await page.evaluate((id) => {
                const it = document.querySelector(`[data-id="${id}"]`);
                const b = it && it.querySelector('.reserve-btn');
                return {
                    itemCls: it && it.className,
                    btnText: b && b.textContent.trim(),
                    btnCls: b && b.className,
                    inCache: (window._dataCache && window._dataCache.presents || []).filter(p => String(p.id) === String(id)).map(p => ({ id: p.id, reserved_by: p.reserved_by, u: p.reserved_by_username })),
                    toast: [...document.querySelectorAll('.toast, .toast-message, [class*=toast]')].map(e => e.textContent.trim()).slice(0, 3),
                    myReservedItems: [...document.querySelectorAll('.reserved-by-me')].length
                };
            }, target.id);
            console.log('AFTER click (+2.5s)', JSON.stringify(after, null, 1));
            // reserved modal / list
            const modal = await page.evaluate(async () => {
                if (typeof openReservedPresentsModal !== 'function') return 'no fn';
                openReservedPresentsModal();
                await new Promise(r => setTimeout(r, 1500));
                const l = document.getElementById('reservedPresentsList');
                return l ? l.innerText.slice(0, 400) : 'no list';
            });
            console.log('RESERVED MODAL', modal);
            console.log('NET', net.join('\n    '));
            net.length = 0;
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForTimeout(1500);
            const reload = await page.evaluate((id) => {
                const it = document.querySelector(`[data-id="${id}"]`);
                const b = it && it.querySelector('.reserve-btn');
                return { itemCls: it && it.className, btnText: b && b.textContent.trim() };
            }, target.id);
            console.log('AFTER reload', JSON.stringify(reload));
        }
    } else {
        const info = await page.evaluate(() => ({
            availableHtml: (document.getElementById('availablePresentsList') || {}).innerText && document.getElementById('availablePresentsList').innerText.slice(0, 300),
            myRes: (document.getElementById('myReservationsList') || {}).innerText,
            bought: (document.getElementById('boughtPresentsList') || {}).innerText,
            btns: [...document.querySelectorAll('button[onclick*="reservePresent"]')].slice(0, 3).map(b => b.getAttribute('onclick') + ' | ' + b.textContent.trim()),
            userId: window._currentUserId
        }));
        console.log('BEFORE', JSON.stringify(info, null, 1));
        const btn = page.locator('button[onclick*="reservePresent"]').first();
        if (await btn.count()) {
            await btn.click();
            await page.waitForTimeout(2500);
            const after = await page.evaluate(() => ({
                available: document.getElementById('availablePresentsList').innerText.slice(0, 200),
                myRes: document.getElementById('myReservationsList').innerText.slice(0, 300),
                data: (window._homeData.presents || []).filter(p => p.reserved_by).map(p => ({ id: p.id, rb: p.reserved_by, t: typeof p.reserved_by }))
            }));
            console.log('AFTER', JSON.stringify(after, null, 1));
        }
    }
    console.log('NET', net.join('\n    '));
    console.log('ERRORS', errs.join('\n   ') || '(none)');
    await browser.close();
})().catch(e => { console.error('SCRIPT FAIL', e); process.exit(1); });

'use strict';
// Throwaway measurement script. Usage: node tmp-measure.js <label>
// Writes home-buckets-baseline/<label>.json (computed-style + geometry data).
const fs = require('fs');
const path = require('path');
const WT = 'c:\\Users\\matmamon\\OneDrive - amazon.com\\Documents\\Prezenty\\prezenty\\.worktrees\\home-buckets-1';
const OUT_DIR = path.join(__dirname, 'home-buckets-baseline');
const { chromium, request } = require(path.join(WT, 'node_modules', '@playwright', 'test'));
const { startDemoServer } = require(path.join(WT, 'tests', 'helpers', 'start-demo-server.js'));
const { installCdnCache } = require(path.join(WT, 'tests', 'helpers', 'cdn-cache.js'));
const { openPage } = require(path.join(WT, 'tests', 'helpers', 'pages.js'));

const label = process.argv[2] || 'run';
const WIDTHS = [[320, 640], [375, 812], [768, 1024], [1024, 768]];
const OTHER_PAGES = [
    { path: '/recipients', name: 'recipients', ready: '.present-name' },
    { path: '/activity', name: 'activity', ready: '.notification-item' },
    { path: '/rezerwacje', name: 'rezerwacje', ready: '#reservedContent' },
    { path: '/leaderboard.html', name: 'leaderboard', ready: '.activity-card' },
    { path: '/formularz', name: 'formularz', ready: 'body' },
    { path: '/wiadomosci', name: 'wiadomosci', ready: '.thread-row' }
];

// Runs in the page: collects style + geometry data for the home buckets.
function collectHome() {
    const P = ['display', 'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap', 'flexDirection',
        'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'overflowX', 'overflowY',
        'boxShadow', 'backgroundColor'];
    const snap = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const o = {};
        P.forEach(k => { o[k] = cs[k]; });
        o.w = +r.width.toFixed(2); o.h = +r.height.toFixed(2);
        return o;
    };
    const buckets = [
        ['available', 'accordionAvailable', 'availablePresentsList', 'availablePresentsSection'],
        ['reservations', 'accordionReservations', 'myReservationsList', 'myReservationsSection'],
        ['bought', 'accordionBought', 'boughtPresentsList', 'boughtPresentsSection']
    ];
    const res = {};
    buckets.forEach(([name, accId, listId, secId]) => {
        const acc = document.getElementById(accId);
        const list = document.getElementById(listId);
        const item = acc.querySelector('.accordion-item');
        const cards = Array.from(list.querySelectorAll('.home-recipient-card'));
        const b = {
            section: snap(document.getElementById(secId)),
            accordion: snap(acc), item: snap(item),
            button: snap(item.querySelector('.accordion-button')),
            collapse: snap(item.querySelector('.accordion-collapse')),
            body: snap(item.querySelector('.accordion-body')),
            list: snap(list),
            cardCount: cards.length,
            cards: cards.map(snap),
            rows: Array.from(list.querySelectorAll('.home-present-row')).map(snap),
            empty: snap(list.querySelector('.text-center.py-5')),
            customProps: {
                inset: getComputedStyle(acc).getPropertyValue('--home-bucket-inset').trim(),
                cardR: getComputedStyle(acc).getPropertyValue('--home-card-radius').trim()
            }
        };
        if (cards.length) {
            const lr = list.getBoundingClientRect(); const ir = item.getBoundingClientRect();
            const cr = cards[0].getBoundingClientRect(); const lcs = getComputedStyle(list);
            const lastR = cards[cards.length - 1].getBoundingClientRect();
            b.offsets = {
                firstCardLeftFromListContent: +(cr.left - lr.left - parseFloat(lcs.paddingLeft) - parseFloat(lcs.borderLeftWidth || 0)).toFixed(2),
                firstCardTopFromListContent: +(cr.top - lr.top - parseFloat(lcs.paddingTop)).toFixed(2),
                firstCardLeftFromItemEdge: +(cr.left - ir.left).toFixed(2),
                firstCardTopFromCollapseEdge: +(cr.top - item.querySelector('.accordion-collapse').getBoundingClientRect().top).toFixed(2),
                lastCardBottomToItemBottom: +(ir.bottom - lastR.bottom).toFixed(2),
                cardRightFromItemEdge: +(ir.right - cr.right).toFixed(2),
                betweenCards: cards.length > 1 ? +(cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().bottom).toFixed(2) : null
            };
        }
        res[name] = b;
    });
    return res;
}

// Runs in the page: chain of ancestors (card -> body) that clip (overflow != visible).
function clipChain() {
    const out = {};
    [['available', 'availablePresentsList'], ['reservations', 'myReservationsList'], ['bought', 'boughtPresentsList']].forEach(([n, id]) => {
        const card = document.getElementById(id).querySelector('.home-recipient-card');
        const chain = [];
        for (let el = card; el && el !== document.documentElement; el = el.parentElement) {
            const cs = getComputedStyle(el);
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
                chain.push((el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').join('.') + ' ' + cs.overflowX + '/' + cs.overflowY);
            }
        }
        out[n] = chain;
    });
    return out;
}

// Runs in the page: generic snapshot of every element inside body (other pages).
function collectGeneric() {
    const P = ['display', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight',
        'marginBottom', 'marginLeft', 'rowGap', 'columnGap', 'borderTopLeftRadius', 'borderTopRightRadius',
        'borderBottomRightRadius', 'borderBottomLeftRadius', 'borderTopWidth', 'borderLeftWidth', 'boxShadow'];
    const out = [];
    document.querySelectorAll('body *').forEach((el, i) => {
        if (i > 1500) return;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const o = { k: i + ':' + el.tagName + (el.id ? '#' + el.id : '') + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ').join('.') };
        P.forEach(p => { o[p] = cs[p]; });
        o.w = Math.round(r.width); o.h = Math.round(r.height);
        out.push(o);
    });
    return out;
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const server = await startDemoServer();
    const result = { label, ts: new Date().toISOString(), notes: [], viewports: {}, other: {} };
    let browser;
    try {
        // Login + populate state through the API (reserve UI-move bug: set state via API, reload).
        const api = await request.newContext({ baseURL: server.baseURL });
        const lr = await api.post('/api/login', { data: { username: 'measure', password: 'measure' } });
        if (!lr.ok()) throw new Error('login failed ' + lr.status());
        for (const id of [1, 3, 6, 7]) {
            const r = await api.post(`/api/presents/${id}/reserve`, { data: {} });
            result.notes.push(`reserve ${id}: ${r.status()}`);
        }
        const c = await api.put('/api/presents/6/check', { data: { is_checked: true } });
        result.notes.push(`check 6: ${c.status()}`);
        const state = await api.storageState();
        await api.dispose();

        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const newCtx = async (w, h) => {
            const ctx = await browser.newContext({ baseURL: server.baseURL, viewport: { width: w, height: h }, storageState: state, serviceWorkers: 'block' });
            await installCdnCache(ctx);
            return ctx;
        };

        for (const [w, h] of WIDTHS) {
            const ctx = await newCtx(w, h);
            const page = await ctx.newPage();
            await openPage(page, { path: '/', name: 'home', reloadsOnce: true, ready: '#availablePresentsList .home-recipient-card' });
            await page.locator('#myReservationsList .home-recipient-card').first().waitFor({ state: 'attached', timeout: 10000 });
            await page.locator('#boughtPresentsList .home-recipient-card').first().waitFor({ state: 'attached', timeout: 10000 });
            // make sure every accordion is expanded
            await page.evaluate(() => {
                document.querySelectorAll('.accordion-collapse').forEach(el => el.classList.add('show'));
                document.querySelectorAll('.accordion-button').forEach(b => { b.classList.remove('collapsed'); b.setAttribute('aria-expanded', 'true'); });
            });
            await page.waitForTimeout(400);
            const v = { populated: await page.evaluate(collectHome), clip: await page.evaluate(clipChain) };
            v.scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

            // keyboard focus ring on the first action button of each bucket
            v.focus = await page.evaluate(() => {
                const out = {};
                [['available', 'availablePresentsList'], ['reservations', 'myReservationsList'], ['bought', 'boughtPresentsList']].forEach(([n, id]) => {
                    const btn = document.getElementById(id).querySelector('.home-present-actions .btn');
                    out[n] = { exists: !!btn };
                });
                return out;
            });
            await page.keyboard.press('Tab');
            for (const [n, id] of [['available', 'availablePresentsList'], ['reservations', 'myReservationsList'], ['bought', 'boughtPresentsList']]) {
                const btn = page.locator(`#${id} .home-present-actions .btn`).first();
                await btn.focus();
                v.focus[n] = await btn.evaluate((el) => {
                    const cs = getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    const ring = Math.max(parseFloat(cs.outlineWidth) || 0, 4) + (parseFloat(cs.outlineOffset) || 0);
                    let clippedBy = null;
                    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
                        const acs = getComputedStyle(a);
                        if (acs.overflowX !== 'visible' || acs.overflowY !== 'visible') {
                            const ar = a.getBoundingClientRect();
                            if (r.left - ring < ar.left || r.right + ring > ar.right || r.top - ring < ar.top || r.bottom + ring > ar.bottom) {
                                clippedBy = a.className;
                            }
                        }
                    }
                    return { focusVisible: el.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, boxShadow: cs.boxShadow, clippedBy };
                });
            }

            // empty state
            await page.evaluate(() => {
                renderAvailablePresents([], []);
                renderPresentsList([], [], 'myReservationsList', 'Brak zarezerwowanych prezentów');
                renderPresentsList([], [], 'boughtPresentsList', 'Brak kupionych prezentów');
            });
            v.empty = await page.evaluate(collectHome);
            // skeleton state (markup copied from the real skeleton)
            await page.evaluate(() => {
                const sk = '<div class="skeleton-cards" aria-hidden="true" style="padding: 14px;"><div class="skeleton-card"><div class="skeleton skeleton-avatar"></div><div class="skeleton-lines"><div class="skeleton skeleton-line" style="width: 45%;"></div><div class="skeleton skeleton-line" style="width: 70%;"></div></div></div></div>';
                ['availablePresentsList', 'myReservationsList', 'boughtPresentsList'].forEach(id => { document.getElementById(id).innerHTML = sk; });
            });
            v.skeleton = await page.evaluate(() => {
                const o = {};
                ['availablePresentsList', 'myReservationsList', 'boughtPresentsList'].forEach(id => {
                    const l = document.getElementById(id); const s = l.querySelector('.skeleton-cards'); const k = l.querySelector('.skeleton-card');
                    const cs = getComputedStyle(l); const sc = getComputedStyle(s); const kc = getComputedStyle(k);
                    o[id] = { listPadding: cs.padding, listGap: cs.gap, listDisplay: cs.display, skelPadding: sc.padding, skelCardPadding: kc.padding, skelCardRadius: kc.borderRadius, skelCardLeftFromList: +(k.getBoundingClientRect().left - l.getBoundingClientRect().left).toFixed(2) };
                });
                return o;
            });
            await ctx.close();

            // long-text overflow test on a fresh load
            const ctx2 = await newCtx(w, h);
            const p2 = await ctx2.newPage();
            await openPage(p2, { path: '/', name: 'home', reloadsOnce: true, ready: '#availablePresentsList .home-recipient-card' });
            v.longText = await p2.evaluate(() => {
                const d = window._homeData;
                const long1 = 'Superdlugitytulprezentubezspacji'.repeat(8);
                const long2 = 'bardzo dlugi tytul prezentu '.repeat(12);
                d.presents.forEach((p, i) => { p.title = i % 2 ? long1 : long2; p.comments = long2; });
                d.recipients.forEach((r) => { r.name = 'Maksymilian-Bartholomeusz-Wiśniewski-Kowalczyk-Nowak-Jankowska'.repeat(2); });
                rerenderHomeSections();
                const r = document.documentElement;
                const cards = Array.from(document.querySelectorAll('.home-recipient-card'));
                const maxRight = Math.max.apply(null, cards.map(c => c.getBoundingClientRect().right));
                const itemRights = Array.from(document.querySelectorAll('.accordion-item')).map(i => i.getBoundingClientRect().right);
                const rows = Array.from(document.querySelectorAll('.home-present-row'));
                const rowOverflow = rows.filter(rw => rw.scrollWidth > rw.clientWidth + 1).length;
                return { scrollWidth: r.scrollWidth, innerWidth: window.innerWidth, noOverflow: r.scrollWidth <= window.innerWidth, maxCardRight: +maxRight.toFixed(1), minItemRight: +Math.min.apply(null, itemRights).toFixed(1), rowsWithInnerOverflow: rowOverflow, cardCount: cards.length };
            });
            await ctx2.close();
            result.viewports[w + 'x' + h] = v;
            console.log('home measured', w, h);
        }

        // other pages at 375 and 1024
        for (const [w, h] of [[375, 812], [1024, 768]]) {
            for (const pg of OTHER_PAGES) {
                const ctx = await newCtx(w, h);
                const page = await ctx.newPage();
                try {
                    await openPage(page, pg);
                    await page.waitForTimeout(300);
                    result.other[pg.name + '@' + w] = await page.evaluate(collectGeneric);
                } catch (e) {
                    result.other[pg.name + '@' + w] = { error: String(e.message).slice(0, 200) };
                }
                await ctx.close();
            }
            console.log('other pages measured', w);
        }
    } finally {
        if (browser) await browser.close();
        await server.stop();
    }
    fs.writeFileSync(path.join(OUT_DIR, label + '.json'), JSON.stringify(result, null, 1));
    console.log('written', label);
})().catch(e => { console.error('FAILED', e); process.exit(1); });

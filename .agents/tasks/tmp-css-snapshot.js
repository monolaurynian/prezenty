'use strict';
/**
 * TEMPORARY CSS snapshot harness (deleted at the end of the css-consolidate task).
 *
 * Boots the demo server (tests/helpers/start-demo-server.js), opens every
 * in-scope public/*.html page at four viewports and dumps computed styles for
 * every element plus document scroll size, as stable JSON files:
 *   <outDir>/<page>@<W>x<H>.json
 *
 * Usage: node .agents/tasks/tmp-css-snapshot.js [outDir]
 *   default outDir = .agents/tasks/css-baseline
 *
 * Animations/transitions are frozen via an injected stylesheet so values are
 * deterministic; the same injection is used for every run.
 * No screenshots - computed-style dumps only.
 */
const fs = require('fs');
const path = require('path');
const { chromium, request } = require('@playwright/test');
const { startDemoServer } = require('../../tests/helpers/start-demo-server');
const { installCdnCache } = require('../../tests/helpers/cdn-cache');
const { openPage, waitForLayoutSettled } = require('../../tests/helpers/pages');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'css-baseline'));
const EXCLUDE = new Set(['bottom-tab-bar-snippet.html', 'tab-bar-demo.html']);
const PUBLIC_ONLY = new Set(['index', 'intro', 'register', 'maintenance']); // no session
const VIEWPORTS = [[320, 640], [375, 812], [768, 1024], [1024, 768]];

const PAGES = fs.readdirSync(path.join(ROOT, 'public'))
    .filter(f => f.endsWith('.html') && !EXCLUDE.has(f))
    .sort()
    .map(f => f.replace(/\.html$/, ''));

const PROPS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color',
    'background-color', 'background-image', 'font-family', 'font-size', 'font-weight',
    'line-height', 'border', 'border-radius', 'box-shadow', 'overflow-x', 'overflow-y',
    'z-index', 'opacity', 'transform',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'justify-content', 'align-items', 'align-self', 'align-content', 'order', 'gap',
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row'];

const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

async function dump(page, label) {
    return page.evaluate(({ props, label }) => {
        const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'HEAD']);
        const describe = el => {
            let s = el.tagName.toLowerCase();
            // random suffixes (e.g. accordion-bought-saomsbvpt) are normalised for stable diffs
            if (el.id) s += '#' + el.id.replace(/^(accordion-[a-z]+)-[a-z0-9]{9}(-.*)?$/, '$1-RAND$2');
            if (typeof el.className === 'string' && el.className.trim()) {
                s += '.' + el.className.trim().split(/\s+/).filter(c => c !== 'appearing').join('.'); // 'appearing' is a transient entry-animation class
            }
            return s;
        };
        const nodes = [];
        const walk = (el, path) => {
            if (SKIP.has(el.tagName)) return;
            const cs = getComputedStyle(el);
            const styles = {};
            props.forEach(p => { styles[p] = cs.getPropertyValue(p); });
            const here = path + '>' + describe(el);
            nodes.push({ path: here, styles });
            // pseudo-elements carry a lot of the visual CSS
            ['::before', '::after'].forEach(ps => {
                const pcs = getComputedStyle(el, ps);
                if (pcs.getPropertyValue('content') && pcs.getPropertyValue('content') !== 'none' &&
                    pcs.getPropertyValue('content') !== 'normal') {
                    const pst = { content: pcs.getPropertyValue('content') };
                    props.forEach(p => { pst[p] = pcs.getPropertyValue(p); });
                    nodes.push({ path: here + ps, styles: pst });
                }
            });
            Array.prototype.forEach.call(el.children, c => walk(c, here));
        };
        walk(document.documentElement, '');
        const root = document.scrollingElement || document.documentElement;
        return {
            state: label,
            scroll: { width: root.scrollWidth, height: root.scrollHeight,
                clientWidth: root.clientWidth, clientHeight: root.clientHeight },
            count: nodes.length,
            elements: nodes
        };
    }, { props: PROPS, label });
}

/** Extra UI states, best effort, mirroring the e2e specs. Returns dump or null. */
async function extraStates(page, name, snaps) {
    try {
        if (name === 'formularz') {
            // composer.spec.js: focusing the prompt field enters add mode
            await page.locator('#quickAddTitle').click({ timeout: 3000 });
            await page.waitForFunction(() => document.getElementById('quickAddForm') &&
                document.getElementById('quickAddForm').classList.contains('is-expanded'), undefined, { timeout: 3000 })
                .catch(() => {});
            await waitForLayoutSettled(page, 5000);
            snaps.push(await dump(page, 'composer-add-mode'));
            await page.locator('#quickAddToggle').click({ timeout: 3000 }).catch(() => {});
            await waitForLayoutSettled(page, 5000);
            snaps.push(await dump(page, 'composer-toggled'));
        } else if (name === 'recipients') {
            // edit-sheet.spec.js: expand own presents, open the edit bottom sheet
            const toggle = page.locator('button.accordion-button[data-bs-target="#accordion-own-2-collapse"]');
            if (await toggle.count()) {
                if ((await toggle.getAttribute('class')).includes('collapsed')) await toggle.click();
                await page.waitForFunction(() => document.querySelector('#accordion-own-2-collapse.show'), undefined, { timeout: 3000 });
                await waitForLayoutSettled(page, 5000);
                snaps.push(await dump(page, 'own-presents-expanded'));
                const trigger = page.locator('button.edit-present-btn[data-present-id]').first();
                if (await trigger.count()) {
                    await page.evaluate(() => {
                        window.__shown = false;
                        document.getElementById('editPresentModal')
                            .addEventListener('shown.bs.modal', () => { window.__shown = true; }, { once: true });
                    });
                    await trigger.click();
                    await page.waitForFunction(() => window.__shown === true, undefined, { timeout: 5000 });
                    await waitForLayoutSettled(page, 5000);
                    snaps.push(await dump(page, 'edit-sheet-open'));
                }
            }
        }
    } catch (e) {
        snaps.push({ state: 'extra-states-error', error: String(e.message || e).split('\n')[0] });
    }
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const server = await startDemoServer();
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    // Demo login accepts any credentials (same as tests/global-setup.js)
    const api = await request.newContext({ baseURL: server.baseURL });
    const login = await api.post('/api/login', { data: { username: 'e2e', password: 'e2e' } });
    if (!login.ok()) throw new Error('demo login failed: ' + login.status());
    const AUTH = await api.storageState();
    await api.dispose();
    let written = 0;
    try {
        for (const name of PAGES) {
            for (const [w, h] of VIEWPORTS) {
                const authed = !PUBLIC_ONLY.has(name);
                const context = await browser.newContext({
                    baseURL: server.baseURL,
                    viewport: { width: w, height: h },
                    serviceWorkers: 'block',
                    reducedMotion: 'reduce',
                    storageState: authed ? AUTH : undefined
                });
                await installCdnCache(context);
                const page = await context.newPage();
                try {
                    const desc = { path: '/' + name + '.html', name, ready: 'body', reloadsOnce: name === 'home' };
                    await openPage(page, desc);
                    await page.addStyleTag({ content: FREEZE });
                    await page.waitForTimeout(400); // let API-rendered content land
                    await waitForLayoutSettled(page, 8000);
                    const snaps = [await dump(page, 'base')];
                    await extraStates(page, name, snaps);
                    const file = path.join(OUT, `${name}@${w}x${h}.json`);
                    // The demo server port is random per run; normalise it so runs diff byte-for-byte.
                    const text = JSON.stringify({ page: name, viewport: { w, h }, states: snaps }, null, 1)
                        .split(server.baseURL).join('http://HOST');
                    fs.writeFileSync(file, text);
                    written++;
                    console.log(`ok ${name}@${w}x${h} states=${snaps.map(s => s.state).join(',')}`);
                } catch (e) {
                    console.error(`FAIL ${name}@${w}x${h}: ${String(e.message || e).split('\n')[0]}`);
                    process.exitCode = 1;
                } finally {
                    await context.close();
                }
            }
        }
    } finally {
        await browser.close();
        await server.stop();
    }
    console.log(`wrote ${written} files to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });

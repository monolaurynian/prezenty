#!/usr/bin/env node
/*
 * Records the screen-recording KLIPY asks for when you request Production
 * access: KLIPY running inside the app, on a phone-sized screen.
 *
 *   BASE_URL=https://your-site PREZENTY_USER=name PREZENTY_PASS=password \
 *     node scripts/record-klipy-demo.js
 *
 * (PowerShell:  $env:BASE_URL='https://your-site'; $env:PREZENTY_USER='name';
 *               $env:PREZENTY_PASS='password'; node scripts/record-klipy-demo.js)
 *
 * Run it against the DEPLOYED app, where your real KLIPY key is set, so the
 * video shows real KLIPY results. It signs in with the account you give it,
 * walks through every KLIPY screen with a short caption on top of each step
 * and writes recordings/klipy-integration-demo.webm (a few MB, far below
 * KLIPY's 100 MB limit).
 *
 * It SENDS ONE REAL GIF to the group chat ("Czat grupowy"), because KLIPY
 * wants to see a GIF being sent. Anonymous messages cannot be unsent, so it
 * is worth running with a test account, or telling the group first.
 *
 * Nothing is stored: the password is read from the environment, never from
 * a file, and is only used to sign in.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const PHONE = { width: 390, height: 844 };

// Captions and a tap marker, drawn inside the page so they end up in the video
const OVERLAY = () => {
    const css = document.createElement('style');
    css.textContent =
        '#demoCaption{position:fixed;top:8px;left:8px;right:8px;z-index:2147483647;pointer-events:none;' +
        'background:rgba(20,20,20,.82);color:#fff;font:600 13px/1.35 system-ui,sans-serif;padding:8px 12px;' +
        'border-radius:10px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.3)}' +
        '.demoTap{position:fixed;z-index:2147483647;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;' +
        'background:rgba(255,64,129,.45);border:2px solid #ff4081;pointer-events:none;animation:demoTap .6s ease-out forwards}' +
        '@keyframes demoTap{from{transform:scale(.5);opacity:1}to{transform:scale(1.5);opacity:0}}';
    const attach = () => {
        document.head.appendChild(css);
        const box = document.createElement('div');
        box.id = 'demoCaption';
        box.hidden = true;
        document.body.appendChild(box);
        window.__caption = (text) => { box.textContent = text || ''; box.hidden = !text; };
    };
    if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);
    document.addEventListener('pointerdown', (e) => {
        const dot = document.createElement('div');
        dot.className = 'demoTap';
        dot.style.left = e.clientX + 'px';
        dot.style.top = e.clientY + 'px';
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 700);
    }, true);
};

async function record(options) {
    const { baseURL, user, pass } = options;
    const outDir = options.outDir || path.join(__dirname, '..', 'recordings');
    fs.mkdirSync(outDir, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(outDir, '.rec-'));

    const browser = await chromium.launch({ channel: options.channel || process.env.PW_CHANNEL || undefined, headless: true });
    const context = await browser.newContext({
        baseURL,
        viewport: PHONE,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
        locale: 'pl-PL',
        recordVideo: { dir: tmpDir, size: PHONE }
    });
    // A returning visitor, so the "what's new" announcement is shown
    await context.addInitScript(() => {
        try { if (!localStorage.getItem('app_version')) localStorage.setItem('app_version', 'recording|old'); } catch (e) { /* ignore */ }
    });
    await context.addInitScript(OVERLAY);

    const login = await context.request.post('/api/login', { data: { username: user, password: pass } });
    if (!login.ok()) throw new Error('Sign-in failed (HTTP ' + login.status() + '). Check PREZENTY_USER / PREZENTY_PASS.');

    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    if (typeof options.prepare === 'function') await options.prepare(page, context);

    const checks = [];
    const note = (label, ok, detail) => { checks.push({ label, ok }); console.log((ok ? '  ok   ' : '  MISSING ') + label + (detail ? ' - ' + detail : '')); };
    const say = (text) => page.evaluate((t) => window.__caption && window.__caption(t), text);
    const wait = (ms) => page.waitForTimeout(ms);

    try {
        // 1. The announcement with a KLIPY GIF (shown once per browser)
        await page.goto('/home', { waitUntil: 'load' });
        const banner = page.locator('#updateBanner');
        if (await banner.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
            // give the GIF time to arrive, so the video does not show an empty box
            await page.waitForFunction(() => {
                const img = document.querySelector('#updateBanner img');
                return !img || (img.complete && img.naturalWidth > 0);
            }, null, { timeout: 8000 }).catch(() => {});
            await say('1/7  "What\'s new" announcement with a GIF from KLIPY');
            await wait(2500);
            await wait(2500);
            await banner.getByRole('button', { name: 'Później' }).click();
            await say('');
            await wait(600);
        } else {
            console.log('  (no announcement this time: it is shown once per browser and may be switched off)');
        }

        // 2. The chat
        await page.goto('/wiadomosci?rozmowa=group', { waitUntil: 'load' });
        await page.waitForSelector('#gifBtn', { state: 'visible' });
        await say('2/7  Group chat: the purple GIF button sits next to the message field');
        await wait(2500);

        // 3. The KLIPY picker
        await page.locator('#gifBtn').click();
        await page.waitForSelector('#gifSheet.is-open .gif-sheet-item');
        await wait(1200);
        const placeholder = await page.locator('#gifSheet .gif-sheet-search').getAttribute('placeholder');
        const powered = (await page.locator('#gifSheet .gif-sheet-attribution').innerText()).trim();
        note('search field placeholder is "Search KLIPY"', placeholder === 'Search KLIPY', placeholder);
        note('"Powered by KLIPY" is shown in the picker', powered === 'Powered by KLIPY', powered);
        await say('3/7  KLIPY picker: trending GIFs, search field "Search KLIPY", "Powered by KLIPY"');
        await wait(3500);

        // 4. Browsing: dragging the list also expands the panel
        await say('4/7  Scrolling the results expands the panel');
        await page.mouse.move(195, 640);
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 40); await wait(90); }
        await wait(1800);

        // 4b. The other KLIPY kinds, one tab each
        const tabs = page.locator('#gifSheet .gif-sheet-tab');
        if (await tabs.count()) {
            await say('4b/7  Tabs for KLIPY stickers and memes too');
            await tabs.nth(1).click();
            await page.locator('#gifSheet .gif-sheet-item').first().waitFor();
            await wait(2500);
            await tabs.nth(2).click();
            await page.locator('#gifSheet .gif-sheet-item').first().waitFor();
            await wait(2500);
            await tabs.nth(0).click();
            await page.locator('#gifSheet .gif-sheet-item').first().waitFor();
            await wait(1200);
            note('GIF, sticker and meme tabs', (await tabs.count()) === 3);
        }

        // 5. Searching
        await say('5/7  Searching KLIPY');
        const search = page.locator('#gifSheet .gif-sheet-search');
        await search.click();
        await search.pressSequentially('hello', { delay: 160 });
        await wait(2500);
        await page.locator('#gifSheet .gif-sheet-item').first().waitFor();
        await wait(1500);

        // 6. Choosing and sending
        await page.locator('#gifSheet .gif-sheet-item').first().click();
        await say('6/7  A GIF is chosen: preview first, then "Wyślij GIF" sends it');
        await wait(2800);
        const sent = page.waitForResponse((r) => /\/api\/wiadomosci\/group$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator('#gifSheet .gif-sheet-send').click();
        await sent;
        await say('7/7  The GIF arrives in the chat; tap it to zoom');
        const sentGif = page.locator('.chat-gif-zoom, .chat-gif-wrap').last();
        await sentGif.waitFor();
        await sentGif.scrollIntoViewIfNeeded();
        await wait(3000);

        // 7. Zoom
        await sentGif.click();
        await page.locator('#gifLightbox.is-open').waitFor();
        await wait(3500);
        await page.keyboard.press('Escape');
        await say('');
        await wait(1200);
    } finally {
        await context.close();     // writes the video
        await browser.close();
    }

    const video = fs.readdirSync(tmpDir).find((f) => f.endsWith('.webm'));
    if (!video) throw new Error('No video was written.');
    const target = path.join(outDir, 'klipy-integration-demo.webm');
    fs.copyFileSync(path.join(tmpDir, video), target);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const mb = fs.statSync(target).size / (1024 * 1024);
    console.log('\nVideo: ' + target + ' (' + mb.toFixed(1) + ' MB' + (mb > 100 ? ' - TOO BIG for KLIPY\'s 100 MB limit' : ', within the 100 MB limit') + ')');
    const missing = checks.filter((c) => !c.ok);
    if (missing.length) console.log('Not as KLIPY expects: ' + missing.map((c) => c.label).join('; '));
    return { target, megabytes: mb, checks };
}

module.exports = { record };

if (require.main === module) {
    const { BASE_URL, PREZENTY_USER, PREZENTY_PASS } = process.env;
    if (!BASE_URL || !PREZENTY_USER || !PREZENTY_PASS) {
        console.error('Set BASE_URL, PREZENTY_USER and PREZENTY_PASS first (see the top of this file).');
        process.exit(1);
    }
    record({ baseURL: BASE_URL, user: PREZENTY_USER, pass: PREZENTY_PASS })
        .catch((error) => { console.error(error.message); process.exit(1); });
}

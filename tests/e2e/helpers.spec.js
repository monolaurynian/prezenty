'use strict';
/**
 * Self-test for the measurement helpers.
 *
 * A detector that can never fire is worse than no detector - it reports green
 * forever. Every check below runs twice: once against a deliberately broken
 * DOM (the detector MUST report it) and once against a clean one (it must
 * not). If these tests pass, a green result from the other specs means
 * something.
 */
const { test, expect } = require('../fixtures');
const { collectOverflow } = require('../helpers/overflow');
const { wordBreakReport } = require('../helpers/line-breaks');
const { nonColorSignature, signatureKey } = require('../helpers/non-color-cue');
const { stashFocus, focusSurvived } = require('../helpers/focus');
const { iconOnlyButtonsWithoutName, focusableInsideAriaHidden } = require('../helpers/a11y');

// A blank page served by the app itself, so the helpers run in the same
// environment the real specs use.
async function sandbox(page) {
    await page.goto('/leaderboard.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'e2e-sandbox';
        host.style.cssText = 'position:relative;width:300px;margin:0;padding:0;background:#fff;';
        document.body.appendChild(host);
    });
    return page.locator('#e2e-sandbox');
}

test.describe('helper self-test: overflow detector', () => {
    test('fires on an element wider than the viewport, and is clean after removal', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await sandbox(page);

        await page.evaluate(() => {
            const bad = document.createElement('div');
            bad.id = 'e2e-overflow-victim';
            bad.style.cssText = 'width:900px;height:20px;background:#f00;';
            document.getElementById('e2e-sandbox').appendChild(bad);
        });

        const dirty = await collectOverflow(page, { container: '#e2e-sandbox' });
        const hit = dirty.offenders.find(o => o.path.includes('e2e-overflow-victim'));
        expect(hit, 'detector must report the 900px child').toBeTruthy();
        expect(hit.delta).toBeGreaterThan(500);

        await page.evaluate(() => document.getElementById('e2e-overflow-victim').remove());
        const clean = await collectOverflow(page, { container: '#e2e-sandbox' });
        expect(clean.offenders.filter(o => o.path.includes('e2e-sandbox'))).toEqual([]);
    });

    test('fires on an overflowing ::after pseudo-element', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await sandbox(page);

        await page.evaluate(() => {
            const style = document.createElement('style');
            style.id = 'e2e-pseudo-style';
            style.textContent =
                '#e2e-pseudo-victim { position: relative; width: 100px; height: 20px; }' +
                '#e2e-pseudo-victim::after { content: "x"; position: absolute; right: -400px; width: 40px; height: 10px; background: #0f0; }';
            document.head.appendChild(style);
            const el = document.createElement('div');
            el.id = 'e2e-pseudo-victim';
            document.getElementById('e2e-sandbox').appendChild(el);
        });

        const dirty = await collectOverflow(page, { container: '#e2e-sandbox' });
        const hit = dirty.offenders.find(o => o.pseudo === '::after' && o.path.includes('e2e-pseudo-victim'));
        expect(hit, 'detector must report the ::after box').toBeTruthy();

        await page.evaluate(() => {
            document.getElementById('e2e-pseudo-victim').remove();
            document.getElementById('e2e-pseudo-style').remove();
        });
        const clean = await collectOverflow(page, { container: '#e2e-sandbox' });
        expect(clean.offenders.filter(o => o.pseudo === '::after')).toEqual([]);
    });

    test('fires on an inner scroll container that scrolls sideways', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await sandbox(page);

        await page.evaluate(() => {
            const box = document.createElement('div');
            box.id = 'e2e-scroller-victim';
            box.style.cssText = 'width:200px;overflow-x:auto;overflow-y:hidden;';
            box.innerHTML = '<div style="width:400px;height:10px;"></div>';
            document.getElementById('e2e-sandbox').appendChild(box);
        });

        const dirty = await collectOverflow(page, { container: '#e2e-sandbox' });
        const hit = dirty.scrollers.find(s => s.path.includes('e2e-scroller-victim'));
        expect(hit, 'detector must report the sideways scroller').toBeTruthy();
        expect(hit.delta).toBeGreaterThan(100);

        await page.evaluate(() => document.getElementById('e2e-scroller-victim').remove());
        const clean = await collectOverflow(page, { container: '#e2e-sandbox' });
        expect(clean.scrollers.filter(s => s.path.includes('e2e-scroller-victim'))).toEqual([]);
    });

    test('ignoreGuard really does neutralise html,body overflow-x:hidden', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await page.goto('/leaderboard.html', { waitUntil: 'domcontentloaded' });

        await page.evaluate(() => {
            const style = document.createElement('style');
            style.id = 'e2e-guard-style';
            style.textContent = 'html, body { overflow-x: hidden; }';
            document.head.appendChild(style);
            const bad = document.createElement('div');
            bad.id = 'e2e-guarded-victim';
            bad.style.cssText = 'width:900px;height:20px;background:#00f;';
            document.body.appendChild(bad);
        });

        const guarded = await collectOverflow(page);
        const unguarded = await collectOverflow(page, { ignoreGuard: true });

        // With the guard in place the document does not scroll; without it the
        // structural overflow shows up.
        expect(guarded.rootScroll.delta).toBeLessThanOrEqual(0.5);
        expect(unguarded.rootScroll.delta).toBeGreaterThan(400);

        await page.evaluate(() => {
            document.getElementById('e2e-guarded-victim').remove();
            document.getElementById('e2e-guard-style').remove();
        });
    });
});

test.describe('helper self-test: line-break detector', () => {
    test('reports a mid-word break and accepts a space break', async ({ page }) => {
        await sandbox(page);

        // break-all forces a slice in the middle of a word
        await page.evaluate(() => {
            const el = document.createElement('p');
            el.id = 'e2e-break-victim';
            el.style.cssText = 'width:40px;word-break:break-all;font-size:14px;margin:0;';
            // One token with no spaces at all, so any wrap is a mid-word slice
            el.textContent = 'MurphyMurphyMurphyMurphy';
            document.getElementById('e2e-sandbox').appendChild(el);
        });
        const dirty = await wordBreakReport(page.locator('#e2e-break-victim'));
        expect(dirty.info.lines.length, JSON.stringify(dirty.info.lines)).toBeGreaterThan(1);
        expect(dirty.ok, 'detector must reject the mid-word break: ' + JSON.stringify(dirty.info.lines)).toBe(false);

        // normal wrapping breaks at spaces only
        await page.evaluate(() => {
            const el = document.getElementById('e2e-break-victim');
            el.style.wordBreak = 'normal';
            el.style.width = '120px';
            el.textContent = 'Ciepły wełniany szalik butelkowej zieleni';
        });
        const clean = await wordBreakReport(page.locator('#e2e-break-victim'));
        expect(clean.info.lines.length).toBeGreaterThan(1);
        expect(clean.ok, 'space-only wrapping must pass: ' + JSON.stringify(clean.info.lines)).toBe(true);

        await page.evaluate(() => document.getElementById('e2e-break-victim').remove());
    });
});

test.describe('helper self-test: non-colour cue', () => {
    test('two elements differing only in colour share a signature; a border change does not', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => {
            const host = document.getElementById('e2e-sandbox');
            host.insertAdjacentHTML('beforeend',
                '<span id="e2e-cue-a" style="border:1px solid #111;color:#111;">a</span>' +
                '<span id="e2e-cue-b" style="border:1px solid #c00;color:#c00;">b</span>' +
                '<span id="e2e-cue-c" style="border:2px solid #111;color:#111;">c</span>');
        });

        const a = await nonColorSignature(page.locator('#e2e-cue-a'));
        const b = await nonColorSignature(page.locator('#e2e-cue-b'));
        const c = await nonColorSignature(page.locator('#e2e-cue-c'));

        expect(signatureKey(a), 'colour-only difference must NOT change the signature').toBe(signatureKey(b));
        expect(signatureKey(a), 'a border-width difference MUST change the signature').not.toBe(signatureKey(c));

        await page.evaluate(() => ['a', 'b', 'c'].forEach(k => document.getElementById('e2e-cue-' + k).remove()));
    });
});

test.describe('helper self-test: focus survival', () => {
    test('detects both a surviving and a destroyed focus', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => {
            document.getElementById('e2e-sandbox').insertAdjacentHTML('beforeend',
                '<button id="e2e-focus-victim">klik</button>');
        });

        await page.locator('#e2e-focus-victim').focus();
        await stashFocus(page);
        // harmless DOM change elsewhere - focus must survive
        await page.evaluate(() => { document.title = document.title + ' '; });
        const survived = await focusSurvived(page);
        expect(survived.same, 'focus should have survived an unrelated change').toBe(true);

        // destroy the focused node - the detector must say so
        await stashFocus(page);
        await page.evaluate(() => {
            const el = document.getElementById('e2e-focus-victim');
            el.outerHTML = '<button id="e2e-focus-victim">klik</button>'; // rebuilt in place
        });
        const lost = await focusSurvived(page);
        expect(lost.same, 'focus must be reported as lost after a rebuild').toBe(false);
        expect(lost.activeIsBody).toBe(true);

        await page.evaluate(() => document.getElementById('e2e-focus-victim').remove());
    });
});

test.describe('helper self-test: a11y detectors', () => {
    test('finds an unnamed icon-only button and a focusable inside aria-hidden', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => {
            document.getElementById('e2e-sandbox').insertAdjacentHTML('beforeend',
                '<button id="e2e-unnamed"><i class="fas fa-gift" aria-hidden="true"></i></button>' +
                '<div id="e2e-hidden-wrap" aria-hidden="true"><button id="e2e-hidden-btn" aria-label="ukryty">x</button></div>');
        });

        const unnamed = await iconOnlyButtonsWithoutName(page);
        expect(unnamed.some(u => u.path.includes('e2e-unnamed')), JSON.stringify(unnamed)).toBe(true);

        const hidden = await focusableInsideAriaHidden(page);
        expect(hidden.some(h => h.path.includes('e2e-hidden-btn')), JSON.stringify(hidden)).toBe(true);

        // Fix both, detectors must go quiet
        await page.evaluate(() => {
            document.getElementById('e2e-unnamed').setAttribute('aria-label', 'Dodaj prezent');
            document.getElementById('e2e-hidden-btn').setAttribute('tabindex', '-1');
        });
        const unnamedAfter = await iconOnlyButtonsWithoutName(page);
        expect(unnamedAfter.some(u => u.path.includes('e2e-unnamed'))).toBe(false);
        const hiddenAfter = await focusableInsideAriaHidden(page);
        expect(hiddenAfter.some(h => h.path.includes('e2e-hidden-btn'))).toBe(false);

        await page.evaluate(() => {
            document.getElementById('e2e-unnamed').remove();
            document.getElementById('e2e-hidden-wrap').remove();
        });
    });
});

'use strict';
/**
 * The add-present composer on /formularz, and its relationship with the
 * bottom dock.
 *
 * Two user complaints are pinned down here:
 *
 *  1. "I'm not sure if the add present bar needs to have + button when it's
 *     collapsed" - the compact bar carried a round green "+" submit roughly
 *     44px above the dock's own green "Dodaj" tab, and with an empty field it
 *     could not submit anything. The compact bar is now a single tappable
 *     "start adding" row: a decorative cue, a prompt, no "+" and no chevron.
 *
 *  2. "the bar is fighting with the tap bar and the tap bar can't hide
 *     properly and it's jumpy" - the composer's reserved bottom padding was
 *     derived from the dock's live visibility, so hiding the dock shrank
 *     document.scrollHeight mid-gesture, the browser clamped scrollY, and the
 *     clamp came back as a "scrolled up" event that showed the dock again.
 *     The two now move as one unit off a single flag (body.dock-hidden) and
 *     the reserved padding never changes while scrolling.
 *
 * Everything below is measured geometry and counted mutations - the numbers
 * are quoted in the failure messages, because "it feels jumpy" is only
 * actionable once it has a number attached.
 *
 * Replaces tests/e2e/composer.placeholder.spec.js.
 */
const { test, expect } = require('../fixtures');
const { PAGES, openPage, setViewport } = require('../helpers/pages');
const { sampleScrollY, describeSamples } = require('../helpers/scroll');
const { activeDescription, describeFocus } = require('../helpers/focus');
const { collectOverflow, describeOverflow } = require('../helpers/overflow');

const FORMULARZ = { path: '/formularz', name: 'formularz', ready: '#myPresentsList .my-present-item' };
const HOME = PAGES.find(p => p.name === 'home');
const RECIPIENTS = PAGES.find(p => p.name === 'recipients');

const COMPOSER = '#quickAddForm';
const NAME = '#quickAddTitle';
const DESC = '#quickAddComments';
const SUBMIT = '#quickAddBtn';
const TOGGLE = '#quickAddToggle';
const CLOSE = '#quickAddClose';
const CUE = '.quick-add-cue';
const DOCK = '.bottom-tab-bar';

const PHONES = [320, 375, 414];

// ---------------------------------------------------------------------------
// Per-frame sampler. Inline on purpose (tests/helpers/ belongs to the harness
// workflow): a requestAnimationFrame loop recording the geometry of the
// composer and the dock, plus MutationObservers counting the writes that used
// to happen once per scroll event.
// ---------------------------------------------------------------------------

const START_SAMPLER = function () {
    const composer = document.getElementById('quickAddForm');
    const dock = document.querySelector('.bottom-tab-bar');
    const s = {
        frames: [],
        bodyClassMutations: 0,
        bodyStyleMutations: 0,
        quickAddBottomWrites: 0,
        dockAttrMutations: 0,
        dockStateChanges: 0,
        scrollEvents: 0,
        running: true
    };
    window.__e2eComposer = s;

    let lastHidden = document.body.classList.contains('dock-hidden');
    let lastVar = document.body.style.getPropertyValue('--quick-add-bottom');
    s.bodyObserver = new MutationObserver(function (records) {
        records.forEach(function (r) {
            if (r.attributeName === 'class') {
                s.bodyClassMutations++;
                const now = document.body.classList.contains('dock-hidden');
                if (now !== lastHidden) { s.dockStateChanges++; lastHidden = now; }
            } else if (r.attributeName === 'style') {
                s.bodyStyleMutations++;
                const now = document.body.style.getPropertyValue('--quick-add-bottom');
                if (now !== lastVar) { s.quickAddBottomWrites++; lastVar = now; }
            }
        });
    });
    s.bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

    if (dock) {
        s.dockObserver = new MutationObserver(function (records) {
            s.dockAttrMutations += records.length;
        });
        s.dockObserver.observe(dock, { attributes: true });
    }

    s.onScroll = function () { s.scrollEvents++; };
    window.addEventListener('scroll', s.onScroll, { passive: true });

    const t0 = performance.now();
    const round = function (n) { return Math.round(n * 100) / 100; };
    const sample = function () {
        const cRect = composer.getBoundingClientRect();
        const dRect = dock ? dock.getBoundingClientRect() : null;
        const cs = getComputedStyle(composer);
        const bs = getComputedStyle(document.body);
        s.frames.push({
            t: Math.round(performance.now() - t0),
            scrollY: Math.round(window.scrollY),
            scrollHeight: document.documentElement.scrollHeight,
            paddingBottom: bs.paddingBottom,
            innerHeight: window.innerHeight,
            // Distance from the viewport's bottom edge to the composer's own
            // bottom edge: the number the user sees move.
            composerOffset: round(window.innerHeight - cRect.bottom),
            composerTop: round(cRect.top),
            composerHeight: round(cRect.height),
            dockTop: dRect ? round(dRect.top) : null,
            gap: dRect ? round(dRect.top - cRect.bottom) : null,
            transform: cs.transform,
            bottom: cs.bottom,
            quickAddBottom: bs.getPropertyValue('--quick-add-bottom').trim(),
            quickAddReserve: bs.getPropertyValue('--quick-add-reserve').trim(),
            dockHideShift: bs.getPropertyValue('--dock-hide-shift').trim(),
            addMode: document.body.classList.contains('quick-add-active'),
            dockHidden: document.body.classList.contains('dock-hidden')
        });
    };
    sample();
    const tick = function () {
        if (!s.running) return;
        sample();
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
};

const STOP_SAMPLER = function () {
    const s = window.__e2eComposer;
    if (!s) return null;
    s.running = false;
    if (s.bodyObserver) s.bodyObserver.disconnect();
    if (s.dockObserver) s.dockObserver.disconnect();
    if (s.onScroll) window.removeEventListener('scroll', s.onScroll);
    delete window.__e2eComposer;
    return {
        frames: s.frames,
        bodyClassMutations: s.bodyClassMutations,
        bodyStyleMutations: s.bodyStyleMutations,
        quickAddBottomWrites: s.quickAddBottomWrites,
        dockAttrMutations: s.dockAttrMutations,
        dockStateChanges: s.dockStateChanges,
        scrollEvents: s.scrollEvents
    };
};

async function startSampler(page) {
    await page.evaluate(START_SAMPLER);
}

async function stopSampler(page) {
    const raw = await page.evaluate(STOP_SAMPLER);
    if (!raw) throw new Error('sampler was never started');
    return Object.assign(raw, derive(raw.frames));
}

/** Node-side summary of a frame series - these are the reported numbers. */
function derive(frames) {
    const distinct = key => Array.from(new Set(frames.map(f => f[key])));
    let maxComposerStep = 0;
    let maxDockStep = 0;
    for (let i = 1; i < frames.length; i++) {
        maxComposerStep = Math.max(maxComposerStep,
            Math.abs(frames[i].composerOffset - frames[i - 1].composerOffset));
        if (frames[i].dockTop !== null && frames[i - 1].dockTop !== null) {
            maxDockStep = Math.max(maxDockStep, Math.abs(frames[i].dockTop - frames[i - 1].dockTop));
        }
    }
    const gaps = frames.map(f => f.gap).filter(g => g !== null);
    const offsets = frames.map(f => f.composerOffset);
    return {
        frameCount: frames.length,
        scrollHeights: distinct('scrollHeight'),
        paddings: distinct('paddingBottom'),
        maxComposerStep: Math.round(maxComposerStep * 100) / 100,
        maxDockStep: Math.round(maxDockStep * 100) / 100,
        minGap: gaps.length ? Math.min.apply(null, gaps) : null,
        maxGap: gaps.length ? Math.max.apply(null, gaps) : null,
        minComposerOffset: Math.min.apply(null, offsets),
        maxComposerOffset: Math.max.apply(null, offsets)
    };
}

function report(label, m) {
    return `${label}: ${m.frameCount} frames, scrollHeight ${JSON.stringify(m.scrollHeights)}, ` +
        `padding ${JSON.stringify(m.paddings)}, --quick-add-bottom writes ${m.quickAddBottomWrites}, ` +
        `dock attr mutations ${m.dockAttrMutations}, dock state changes ${m.dockStateChanges}, ` +
        `scroll events ${m.scrollEvents}, composer step max ${m.maxComposerStep}px, ` +
        `dock step max ${m.maxDockStep}px, gap ${m.minGap}..${m.maxGap}px, ` +
        `composer offset ${m.minComposerOffset}..${m.maxComposerOffset}px`;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/** /formularz at `width`, edit tab on screen, composer docked and collapsed. */
async function openComposer(page, width, height) {
    await page.setViewportSize({ width, height: height || 750 });
    await openPage(page, FORMULARZ);
    await expect(page.locator(COMPOSER)).toBeVisible();
    if (width <= 768) {
        await page.waitForFunction(() => document.body.classList.contains('quick-add-docked'));
    }
}

/** One continuous gesture: `ticks` wheel notches of `delta`px, ~60fps apart. */
async function wheel(page, ticks, delta) {
    for (let i = 0; i < ticks; i++) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(16);
    }
}

/** Scroll down in small notches until hide-on-scroll has hidden the dock. */
async function scrollUntilDockHidden(page) {
    for (let i = 0; i < 40; i++) {
        await page.mouse.wheel(0, 22);
        await page.waitForTimeout(16);
        const hidden = await page.evaluate(() => document.body.classList.contains('dock-hidden'));
        if (hidden) {
            // let the 0.3s travel finish so the "before" geometry is settled
            await page.waitForTimeout(420);
            return true;
        }
    }
    return false;
}

/** Collapsed/add-mode geometry of the row and of its controls. */
const STATE = function () {
    const form = document.getElementById('quickAddForm');
    const name = document.getElementById('quickAddTitle');
    const box = name.getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    // Does the prompt actually fit? At 320px the field has ~130px of room,
    // which a longer wording overran and the browser clipped mid-word.
    const nameStyle = getComputedStyle(name);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = nameStyle.fontWeight + ' ' + nameStyle.fontSize + ' ' + nameStyle.fontFamily;
    const vis = function (sel) {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
            display: cs.display, visibility: cs.visibility, pointerEvents: cs.pointerEvents,
            width: Math.round(r.width), height: Math.round(r.height),
            left: Math.round(r.left), top: Math.round(r.top)
        };
    };
    return {
        addMode: document.body.classList.contains('quick-add-active'),
        docked: document.body.classList.contains('quick-add-docked'),
        expanded: form.classList.contains('is-expanded'),
        cursor: getComputedStyle(form).cursor,
        formHeight: Math.round(formRect.height),
        formWidth: Math.round(formRect.width),
        nameLeft: Math.round(box.left),
        nameWidth: Math.round(box.width),
        placeholder: name.placeholder,
        promptWidth: Math.round(ctx.measureText(name.placeholder).width),
        promptRoom: Math.round(box.width -
            parseFloat(nameStyle.paddingLeft) - parseFloat(nameStyle.paddingRight) -
            parseFloat(nameStyle.borderLeftWidth) - parseFloat(nameStyle.borderRightWidth)),
        paddingBottom: getComputedStyle(document.body).paddingBottom,
        submit: vis('#quickAddBtn'),
        toggle: vis('#quickAddToggle'),
        close: vis('#quickAddClose'),
        cue: vis('.quick-add-cue')
    };
};

/** Try to focus a control and report where focus actually ended up. */
const PROBE_FOCUS = function (selectors) {
    return selectors.map(function (sel) {
        const el = document.querySelector(sel);
        if (!el) return { sel: sel, present: false, focused: false };
        try { el.focus(); } catch (e) { /* not focusable */ }
        const got = document.activeElement === el;
        if (got) el.blur();
        return { sel: sel, present: true, focused: got };
    });
};

test.describe('add-present composer', () => {
    // hasTouch so tap() is available; the viewport is set per test.
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    // Several tests here walk three phone widths, each with a fresh page
    // load and ~1s of scripted scrolling - about 12s on a quiet machine, and
    // it measured 3x that when OneDrive was syncing this folder. The suite's
    // 30s default turned that slowness into a timeout inside page.goto,
    // which is a failure that says nothing about the composer.
    test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(90000); });

    test('the collapsed bar has no + and no chevron, and neither is reachable', async ({ page }) => {
        for (const width of PHONES) {
            await openComposer(page, width);

            // Probe the controls BEFORE anything touches the name field -
            // focusing that is what enters add mode.
            const probe = await page.evaluate(PROBE_FOCUS, [SUBMIT, TOGGLE, CLOSE]);
            for (const control of probe) {
                expect(control.present, `@${width}px ${control.sel} must still exist`).toBe(true);
                expect(control.focused,
                    `@${width}px ${control.sel} must not be focusable while collapsed: ${JSON.stringify(probe)}`)
                    .toBe(false);
            }

            const s = await page.evaluate(STATE);
            expect(s.addMode, `@${width}px probing must not have entered add mode`).toBe(false);
            expect(s.submit.visibility, `@${width}px the "+" must be hidden: ${JSON.stringify(s.submit)}`).toBe('hidden');
            expect(s.toggle.visibility, `@${width}px the chevron must be hidden: ${JSON.stringify(s.toggle)}`).toBe('hidden');
            expect(s.close.visibility, `@${width}px the close control must be hidden`).toBe('hidden');
            // The one affordance: a decorative 48x48 cue in the chevron's cell
            expect(s.cue.visibility, `@${width}px the cue must be visible`).toBe('visible');
            expect(s.cue.width, `@${width}px cue box ${JSON.stringify(s.cue)}`).toBe(48);
            expect(s.cue.height).toBe(48);
            expect(s.cue.left, `@${width}px the cue must share the chevron's cell: ` +
                `cue ${s.cue.left}/${s.cue.top} vs toggle ${s.toggle.left}/${s.toggle.top}`).toBe(s.toggle.left);
            expect(s.cue.top).toBe(s.toggle.top);
            expect(s.cue.pointerEvents, `@${width}px the cue must not swallow the row's tap`).toBe('none');
            // The row itself is the target: >= 44px tall and obviously tappable
            expect(s.formHeight, `@${width}px collapsed row height ${s.formHeight}px`).toBeGreaterThanOrEqual(44);
            expect(s.cursor, `@${width}px the row must look tappable`).toBe('pointer');
            expect(s.placeholder, `@${width}px the collapsed prompt`).toBe('Dodaj prezent…');
            // ...and it must fit, or it is clipped mid-word (320px is the
            // narrowest screen this app supports)
            expect(s.promptWidth, `@${width}px the prompt needs ${s.promptWidth}px ` +
                `and has ${s.promptRoom}px`).toBeLessThanOrEqual(s.promptRoom);
        }
    });

    test('entering and leaving add mode moves the name field by 0px', async ({ page }) => {
        for (const width of PHONES) {
            await openComposer(page, width);
            const collapsed = await page.evaluate(STATE);

            await page.locator(COMPOSER).tap();
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
            await page.waitForTimeout(400); // both transitions finished
            const active = await page.evaluate(STATE);

            await page.locator(CLOSE).click();
            await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'));
            await page.waitForTimeout(400);
            const back = await page.evaluate(STATE);

            const seen = `@${width}px collapsed ${collapsed.nameLeft}/${collapsed.nameWidth}, ` +
                `add mode ${active.nameLeft}/${active.nameWidth}, back ${back.nameLeft}/${back.nameWidth}`;
            expect(active.nameLeft, seen).toBe(collapsed.nameLeft);
            expect(active.nameWidth, seen).toBe(collapsed.nameWidth);
            expect(back.nameLeft, seen).toBe(collapsed.nameLeft);
            expect(back.nameWidth, seen).toBe(collapsed.nameWidth);
            // The "+" and the chevron swap in, in the columns already reserved
            expect(active.submit.visibility).toBe('visible');
            expect(active.toggle.visibility).toBe('visible');
            expect(active.cue.visibility).toBe('hidden');
            expect(active.placeholder).toBe('Nazwa prezentu…');
            expect(back.placeholder).toBe('Dodaj prezent…');
            // The row grows (the form opens) and returns to the same height
            expect(back.formHeight, `@${width}px height ${collapsed.formHeight} -> ` +
                `${active.formHeight} -> ${back.formHeight}`).toBe(collapsed.formHeight);
            expect(active.formHeight).toBeGreaterThan(collapsed.formHeight);
            expect(back.paddingBottom, `@${width}px padding ${collapsed.paddingBottom} -> ` +
                `${active.paddingBottom} -> ${back.paddingBottom}`).toBe(collapsed.paddingBottom);
        }
    });

    test('a tap anywhere on the collapsed row opens the form and focuses the name field', async ({ page }) => {
        await openComposer(page, 375);
        const box = await page.locator(COMPOSER).boundingBox();
        const spots = [
            { label: 'the cue', x: box.x + 32, y: box.y + box.height / 2 },
            { label: 'the middle of the row', x: box.x + box.width / 2, y: box.y + box.height / 2 },
            { label: 'the empty cell where the "+" used to be', x: box.x + box.width - 30, y: box.y + box.height / 2 }
        ];

        for (const spot of spots) {
            await page.touchscreen.tap(spot.x, spot.y);
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'),
                undefined, { timeout: 5000 });
            const focus = await activeDescription(page);
            expect(focus && focus.id, `tapping ${spot.label}: ` + describeFocus('focus', focus))
                .toBe('quickAddTitle');
            const s = await page.evaluate(STATE);
            expect(s.expanded, `tapping ${spot.label} must open the details row too`).toBe(true);

            await page.locator(CLOSE).click();
            await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'));
            await page.waitForTimeout(350); // clear the "the tap that closed must not re-open" window
        }
    });

    test('entering add mode from a scroll-hidden dock does not move the composer', async ({ page }) => {
        // THE REGRESSION THIS FILE EXISTS FOR. The composer is moved by
        // `transform` while the dock is scroll-hidden and by `bottom` in add
        // mode. Entering from a hidden dock changes both at once, and they
        // only cancel while they share a duration and an easing - otherwise
        // the bar snaps ~98px up and glides back over 250ms on the commonest
        // path there is: scroll down the list, tap the bar.
        for (const width of PHONES) {
            await openComposer(page, width);
            const hidden = await scrollUntilDockHidden(page);
            expect(hidden, `@${width}px the dock must hide on scroll before this can be tested`).toBe(true);

            const before = await page.evaluate(() => {
                const r = document.getElementById('quickAddForm').getBoundingClientRect();
                return Math.round((window.innerHeight - r.bottom) * 100) / 100;
            });

            await startSampler(page);
            await page.locator(COMPOSER).tap();
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
            await page.waitForTimeout(520); // the whole 250ms move, and then some
            const m = await stopSampler(page);

            const label = report(`@${width}px entry from dock-hidden (resting offset ${before}px)`, m);
            expect(m.maxComposerStep, 'single-frame composer displacement. ' + label).toBeLessThanOrEqual(2);
            expect(m.maxComposerOffset - m.minComposerOffset,
                'total composer travel during entry. ' + label).toBeLessThanOrEqual(2);
            const last = m.frames[m.frames.length - 1];
            expect(last.addMode, label).toBe(true);
            expect(last.dockHidden, 'add mode must clear dock-hidden. ' + label).toBe(false);
            expect(last.transform, 'the composer must sit untransformed in add mode. ' + label).toBe('none');
        }
    });

    test('the composer and the dock hide as one unit, with no padding or scrollHeight churn', async ({ page }) => {
        for (const width of PHONES) {
            await openComposer(page, width);
            const resting = await page.evaluate(() => {
                const c = document.getElementById('quickAddForm').getBoundingClientRect();
                const d = document.querySelector('.bottom-tab-bar').getBoundingClientRect();
                return Math.round((d.top - c.bottom) * 100) / 100;
            });

            await startSampler(page);
            await wheel(page, 30, 22); // one continuous downward gesture
            await page.waitForTimeout(420);
            const m = await stopSampler(page);
            const label = report(`@${width}px 30x22px downward gesture (resting gap ${resting}px)`, m);

            // The root cause: the reserved padding (and with it scrollHeight)
            // must not move while the dock hides.
            expect(m.scrollHeights.length, 'distinct document.scrollHeight values. ' + label).toBe(1);
            expect(m.paddings.length, 'distinct body padding-bottom values. ' + label).toBe(1);
            expect(m.quickAddBottomWrites, '--quick-add-bottom writes during the gesture. ' + label).toBe(0);
            expect(m.dockAttrMutations, '.bottom-tab-bar attribute mutations. ' + label).toBe(0);
            expect(m.dockStateChanges, 'dock state changes for one gesture. ' + label).toBeLessThanOrEqual(2);
            // One unit: the gap between them never opens.
            expect(Math.abs(m.minGap - resting), 'gap floor. ' + label).toBeLessThanOrEqual(1);
            expect(Math.abs(m.maxGap - resting), 'gap ceiling. ' + label).toBeLessThanOrEqual(1);
            // Both travel, and they travel together.
            expect(m.maxComposerOffset - m.minComposerOffset, 'composer travel. ' + label).toBeGreaterThan(40);
            expect(Math.abs(m.maxComposerStep - m.maxDockStep),
                'per-frame step difference between composer and dock. ' + label).toBeLessThanOrEqual(1);
        }
    });

    test('one downward tick after a flick up changes the dock state exactly once', async ({ page }) => {
        await openComposer(page, 375);
        await wheel(page, 30, 22);
        await page.waitForTimeout(420);
        await wheel(page, 2, -20); // flick up: the dock comes back
        await page.waitForTimeout(420);
        expect(await page.evaluate(() => document.body.classList.contains('dock-hidden'))).toBe(false);

        await startSampler(page);
        await page.mouse.wheel(0, 30);
        await page.waitForTimeout(500);
        const m = await stopSampler(page);
        const label = report('single 30px tick after a flick up', m);
        expect(m.dockStateChanges, label).toBe(1);
        expect(m.scrollHeights.length, label).toBe(1);
        const last = m.frames[m.frames.length - 1];
        expect(last.dockHidden, label).toBe(true);
        expect(last.dockTop, 'the dock must complete its travel below the fold. ' + label)
            .toBeGreaterThanOrEqual(last.innerHeight);
    });

    test('hide-on-scroll is inert during add mode and recovers on exit from any scroll position', async ({ page }) => {
        await openComposer(page, 375);
        await scrollUntilDockHidden(page);
        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(400);

        // Deliberate add-mode hiding: visibility + inert + aria-hidden, which
        // the transient scroll hide never touches.
        const dock = await page.locator(DOCK).evaluate(el => ({
            visibility: getComputedStyle(el).visibility,
            inert: el.inert === true || el.hasAttribute('inert'),
            ariaHidden: el.getAttribute('aria-hidden'),
            dockHidden: document.body.classList.contains('dock-hidden')
        }));
        expect(dock.visibility, JSON.stringify(dock)).toBe('hidden');
        expect(dock.inert, JSON.stringify(dock)).toBe(true);
        expect(dock.ariaHidden, JSON.stringify(dock)).toBe('true');
        expect(dock.dockHidden, 'the two hiding mechanisms must never both be on').toBe(false);

        // Scrolling both ways inside add mode must change nothing at all.
        await startSampler(page);
        await wheel(page, 8, 24);
        await wheel(page, 8, -24);
        await page.waitForTimeout(200);
        const m = await stopSampler(page);
        const label = report('scrolling inside add mode', m);
        expect(m.dockStateChanges, label).toBe(0);
        expect(m.dockAttrMutations, label).toBe(0);
        expect(m.quickAddBottomWrites, label).toBe(0);

        // Exit with the last motion downward: the dock must come back anyway.
        await wheel(page, 4, 24);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(450);
        const after = await page.locator(DOCK).evaluate(el => ({
            visibility: getComputedStyle(el).visibility,
            transform: getComputedStyle(el).transform,
            opacity: getComputedStyle(el).opacity,
            inert: el.inert === true || el.hasAttribute('inert'),
            ariaHidden: el.getAttribute('aria-hidden'),
            dockHidden: document.body.classList.contains('dock-hidden'),
            scrollY: Math.round(window.scrollY)
        }));
        expect(after.dockHidden, JSON.stringify(after)).toBe(false);
        expect(after.visibility, JSON.stringify(after)).toBe('visible');
        expect(after.transform, JSON.stringify(after)).toBe('none');
        expect(after.opacity, JSON.stringify(after)).toBe('1');
        expect(after.inert, JSON.stringify(after)).toBe(false);
        expect(after.ariaHidden, JSON.stringify(after)).toBe(null);
        expect(after.scrollY, 'the exit must not have jumped back to the top').toBeGreaterThan(0);
    });

    test('entering add mode does not move the scroll position, including at the very bottom', async ({ page }) => {
        await openComposer(page, 375);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(450);
        const samples = await sampleScrollY(page, async () => {
            await page.locator(COMPOSER).tap();
        });
        const first = samples[0].scrollY;
        samples.forEach(s => {
            expect(Math.abs(s.scrollY - first),
                describeSamples('entry at max scroll', samples)).toBeLessThanOrEqual(2);
        });
        expect(await page.evaluate(() => document.body.classList.contains('quick-add-active'))).toBe(true);
    });

    test('the last present and "Dodaj dla kogoś innego" stay reachable with the dock shown and hidden', async ({ page }) => {
        await openComposer(page, 375);
        const measure = () => page.evaluate(() => {
            const items = document.querySelectorAll('#myPresentsList .my-present-item');
            const last = items[items.length - 1];
            const other = document.querySelector('.add-for-other-wrap button');
            const composer = document.getElementById('quickAddForm').getBoundingClientRect();
            return {
                dockHidden: document.body.classList.contains('dock-hidden'),
                lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
                otherBottom: other ? Math.round(other.getBoundingClientRect().bottom) : null,
                composerTop: Math.round(composer.top),
                scrollY: Math.round(window.scrollY),
                maxScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight)
            };
        });

        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(450);
        const atBottom = await measure();
        // The near-bottom force-show: the reader lands at the end of the page
        // with both bars on screen, which is the state the padding is sized for.
        expect(atBottom.dockHidden, 'the dock must be shown at the bottom of the page: ' +
            JSON.stringify(atBottom)).toBe(false);
        expect(atBottom.lastBottom, 'last present clipped by the composer: ' + JSON.stringify(atBottom))
            .toBeLessThanOrEqual(atBottom.composerTop);
        expect(atBottom.otherBottom, '"Dodaj dla kogoś innego" clipped by the composer: ' +
            JSON.stringify(atBottom)).toBeLessThanOrEqual(atBottom.composerTop);

        // And with the dock transform-hidden mid-page: nothing is clipped either.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        await scrollUntilDockHidden(page);
        const midScroll = await measure();
        expect(midScroll.dockHidden, JSON.stringify(midScroll)).toBe(true);
        expect(midScroll.composerTop, 'the hidden composer must be below the fold: ' +
            JSON.stringify(midScroll)).toBeGreaterThan(0);
    });

    test('details open with the form, not on the first keystroke, and survive a manual collapse', async ({ page }) => {
        await openComposer(page, 375);
        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await expect(page.locator(COMPOSER)).toHaveClass(/is-expanded/);
        await expect(page.locator(DESC)).toBeVisible();

        // Collapse by hand: it must stay collapsed for the rest of the session,
        // including while typing (there is deliberately no keystroke re-expand).
        await page.locator(TOGGLE).click();
        await expect(page.locator(COMPOSER)).not.toHaveClass(/is-expanded/);
        await expect(page.locator(TOGGLE)).toHaveAttribute('aria-label', 'Dodaj opis (opcjonalnie)');
        await page.locator(NAME).fill('Szalik');
        await page.waitForTimeout(100);
        await expect(page.locator(COMPOSER)).not.toHaveClass(/is-expanded/);

        // A fresh entry opens the details again, with the draft intact.
        await page.locator(CLOSE).click();
        await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(350);
        await expect(page.locator(NAME)).toHaveValue('Szalik');
        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await expect(page.locator(COMPOSER)).toHaveClass(/is-expanded/);
        await expect(page.locator(NAME)).toHaveValue('Szalik');
    });

    test('no exit path clears typed text, and the collapsed bar cannot submit it', async ({ page }) => {
        const posts = [];
        page.on('request', r => {
            if (r.method() === 'POST' && r.url().includes('/api/formularz/present')) posts.push(r.url());
        });
        await openComposer(page, 375);

        for (const exit of ['close', 'escape', 'scrim']) {
            await page.locator(COMPOSER).tap();
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
            await page.locator(NAME).fill('Rower');
            await page.locator(DESC).fill('Czerwony, rozmiar M');

            if (exit === 'close') await page.locator(CLOSE).click();
            else if (exit === 'escape') await page.keyboard.press('Escape');
            else await page.locator('#quickAddScrim').tap();

            await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'),
                undefined, { timeout: 5000 });
            await expect(page.locator(NAME), `exit via ${exit} lost the name`).toHaveValue('Rower');
            await expect(page.locator(DESC), `exit via ${exit} lost the description`).toHaveValue('Czerwony, rozmiar M');
            // No "+" appears just because a draft is being held.
            const s = await page.evaluate(STATE);
            expect(s.submit.visibility, `a preserved draft must not bring the "+" back (${exit})`).toBe('hidden');
            await page.waitForTimeout(350);
        }

        // An implicit submission from the collapsed row opens the form instead
        // of posting the draft behind the user's back.
        await page.evaluate(() => {
            document.getElementById('quickAddForm')
                .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        expect(posts, 'the collapsed bar must never POST: ' + JSON.stringify(posts)).toEqual([]);
    });

    test('Enter and Ctrl+Enter add the present, then the composer blurs, collapses and the dock returns', async ({ page }) => {
        // DEMO_MODE reports the user as unidentified, and quickAddPresent()
        // refuses without an identified name - so the add path needs this.
        await page.route('**/api/user/identification', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                isIdentified: true, name: 'Jan Nowak',
                identifiedRecipient: { id: 2, name: 'Jan Nowak' }, username: 'e2e', userId: 1
            })
        }));
        await openComposer(page, 375);

        for (const how of ['Enter', 'Control+Enter']) {
            await page.locator(COMPOSER).tap();
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
            if (how === 'Enter') {
                await page.locator(NAME).fill('Kubek');
                await page.locator(NAME).press('Enter');
            } else {
                await page.locator(NAME).fill('Kubek');
                await page.locator(DESC).fill('Biały');
                await page.locator(DESC).press('Control+Enter');
            }

            // DEMO_MODE does not persist the new present, so assert the pill
            // and the post-add state, never an item count.
            await expect(page.locator('#quickAddMessage')).toContainText('Prezent dodany');
            await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'),
                undefined, { timeout: 5000 });
            await expect(page.locator(NAME)).toHaveValue('');
            const focus = await activeDescription(page);
            expect(focus && focus.id, `after ${how}: ` + describeFocus('focus', focus)).toBe('myPresentsHeading');
            const s = await page.evaluate(STATE);
            expect(s.submit.visibility, `after ${how} the collapsed bar must have no "+"`).toBe('hidden');
            expect(s.placeholder).toBe('Dodaj prezent…');
            await expect(page.locator(DOCK)).toBeVisible();
            await page.waitForTimeout(350);
        }
    });

    test('the dock\'s "Dodaj" tab opens the composer and focuses the name field', async ({ page }) => {
        await openComposer(page, 375);
        await page.locator('a.tab-item.form-tab').first().click();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        const focus = await activeDescription(page);
        expect(focus && focus.id, describeFocus('focus', focus)).toBe('quickAddTitle');
    });

    test('the scrim tones the list down behind the open form, and is inert', async ({ page }) => {
        await openComposer(page, 375);
        const read = () => page.locator('#quickAddScrim').evaluate(el => {
            const cs = getComputedStyle(el);
            return {
                opacity: Number(cs.opacity),
                visibility: cs.visibility,
                pointerEvents: cs.pointerEvents,
                background: cs.backgroundColor,
                zIndex: cs.zIndex,
                ariaHidden: el.getAttribute('aria-hidden'),
                tabIndex: el.tabIndex,
                role: el.getAttribute('role')
            };
        });

        const collapsed = await read();
        expect(collapsed.visibility, JSON.stringify(collapsed)).toBe('hidden');
        expect(collapsed.pointerEvents, JSON.stringify(collapsed)).toBe('none');

        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(300);
        const open = await read();
        expect(open.visibility, JSON.stringify(open)).toBe('visible');
        expect(open.opacity, JSON.stringify(open)).toBeGreaterThan(0.9);
        expect(open.background, 'the dim must be a real tone-down: ' + JSON.stringify(open))
            .toBe('rgba(0, 0, 0, 0.45)');
        // Decorative, not a dialog: no role, no tab stop, hidden from AT, and
        // below the composer (999) and the dock (1000) in the stack.
        expect(open.role, JSON.stringify(open)).toBe(null);
        expect(open.ariaHidden, JSON.stringify(open)).toBe('true');
        expect(open.tabIndex, JSON.stringify(open)).toBe(-1);
        expect(Number(open.zIndex), JSON.stringify(open)).toBeLessThan(999);
    });

    test('the edit sheet\'s "Dodatkowe informacje" box is tall by default here too', async ({ page }) => {
        await openComposer(page, 375);
        // The sheet itself is covered by edit-sheet.spec.js on /recipients;
        // this is the formularz copy of the same textarea, asserted on its
        // computed min-height so the sheet does not have to be opened.
        const minHeight = await page.locator('#editPresentComments')
            .evaluate(el => parseFloat(getComputedStyle(el).minHeight));
        expect(minHeight, `min-height ${minHeight}px`).toBeGreaterThanOrEqual(120);
    });

    test('no horizontal overflow at 320px, collapsed or open', async ({ page }) => {
        await openComposer(page, 320);
        const collapsed = await collectOverflow(page, { ignoreGuard: true });
        expect(collapsed.offenders, describeOverflow('collapsed @320px', collapsed)).toEqual([]);
        expect(collapsed.scrollers, describeOverflow('collapsed @320px', collapsed)).toEqual([]);

        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(400);
        const open = await collectOverflow(page, { ignoreGuard: true });
        expect(open.offenders, describeOverflow('add mode @320px', open)).toEqual([]);
        expect(open.scrollers, describeOverflow('add mode @320px', open)).toEqual([]);
    });
});

test.describe('add-present composer with reduced motion', () => {
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    test('the composer and the dock change state instantly', async ({ page }) => {
        // page.emulateMedia, not test.use({ reducedMotion }): the option did
        // not reach the page through this project's context fixture
        // (matchMedia('(prefers-reduced-motion: reduce)') stayed false), so
        // the emulation is applied explicitly and asserted before anything
        // is measured.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openComposer(page, 375);
        const transitions = await page.evaluate(() => ({
            matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            composer: getComputedStyle(document.getElementById('quickAddForm')).transition,
            dock: getComputedStyle(document.querySelector('.bottom-tab-bar')).transition
        }));
        expect(transitions.matches, 'reduced motion must actually be emulated: ' +
            JSON.stringify(transitions)).toBe(true);
        expect(transitions.composer, JSON.stringify(transitions)).toContain('none');
        expect(transitions.dock, JSON.stringify(transitions)).toContain('none');

        // 60ms after the flag lands, both are already fully translated.
        await wheel(page, 20, 22);
        await page.waitForFunction(() => document.body.classList.contains('dock-hidden'),
            undefined, { timeout: 5000 });
        await page.waitForTimeout(60);
        const moved = await page.evaluate(() => {
            const c = document.getElementById('quickAddForm').getBoundingClientRect();
            const d = document.querySelector('.bottom-tab-bar').getBoundingClientRect();
            return {
                composerOffset: Math.round(window.innerHeight - c.bottom),
                dockTop: Math.round(d.top),
                innerHeight: window.innerHeight,
                gap: Math.round(d.top - c.bottom)
            };
        });
        expect(moved.composerOffset, JSON.stringify(moved)).toBeLessThanOrEqual(14);
        expect(moved.dockTop, JSON.stringify(moved)).toBeGreaterThanOrEqual(moved.innerHeight);

        // Entry from the hidden state is instant too, and lands in the right place.
        await page.locator(COMPOSER).tap();
        await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
        await page.waitForTimeout(60);
        const entered = await page.evaluate(() => {
            const c = document.getElementById('quickAddForm').getBoundingClientRect();
            return {
                composerOffset: Math.round(window.innerHeight - c.bottom),
                transform: getComputedStyle(document.getElementById('quickAddForm')).transform
            };
        });
        expect(entered.transform, JSON.stringify(entered)).toBe('none');
        expect(entered.composerOffset, JSON.stringify(entered)).toBeLessThanOrEqual(14);
    });
});

test.describe('add-present composer on desktop', () => {
    test.use({ viewport: { width: 1024, height: 800 } });

    test('the inline card is unchanged: visible "+", no collapsed state, no dock', async ({ page }) => {
        await openPage(page, FORMULARZ);
        await expect(page.locator(COMPOSER)).toBeVisible();
        const s = await page.evaluate(STATE);
        expect(s.docked, JSON.stringify(s)).toBe(false);
        expect(s.addMode, JSON.stringify(s)).toBe(false);
        expect(s.submit.visibility, 'the card\'s primary button must be visible: ' + JSON.stringify(s.submit))
            .toBe('visible');
        expect(s.cue.display, 'the compact cue must not render on desktop').toBe('none');
        expect(s.toggle.display, 'the chevron must not render on desktop').toBe('none');
        expect(s.close.display, 'there is nothing to close on desktop').toBe('none');
        expect(s.placeholder).toBe('Nazwa prezentu…');
        const scrim = await page.locator('#quickAddScrim').evaluate(el => getComputedStyle(el).display);
        expect(scrim, 'no scrim on desktop').toBe('none');
        const dock = await page.locator(DOCK).evaluate(el => getComputedStyle(el).display);
        expect(dock, 'the dock is replaced by the sidebar on desktop').toBe('none');
        const shift = await page.evaluate(() =>
            document.body.style.getPropertyValue('--dock-hide-shift'));
        expect(shift, 'the composer travel variable must not leak to desktop').toBe('');
    });
});

test.describe('the shared dock on the other pages', () => {
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    // body.dock-hidden and the bottom-tab-bar.css selector are shared by 8
    // pages. These two carry the most furniture near the dock.
    //
    // Note the two shapes of "correct" here. initTabBarAutoHide() runs at
    // parse time and gives up if the dock is not in the DOM yet, and
    // recipients.html loads tab-bar-functions.js (line ~2449) BEFORE its
    // .bottom-tab-bar markup (~2452) - so hide-on-scroll has never been
    // active on that page, before or after this change. `resetDockAutoHide`
    // is only exported past that early return, which makes it an exact
    // probe for "is auto-hide live on this page". Either way the assertion
    // is the same in spirit: the dock does one clean thing and the page's
    // scroll height never moves.
    for (const descriptor of [HOME, RECIPIENTS]) {
        test(`${descriptor.name}: the shared dock behaves and nothing churns`, async ({ page }) => {
            // home.html reloads itself once per fresh profile (its own
            // cache-busting block), which occasionally aborts the navigation
            // openPage is waiting on. Retry rather than fail on it.
            for (let attempt = 0; ; attempt++) {
                try {
                    await openPage(page, descriptor);
                    break;
                } catch (err) {
                    const retryable = /ERR_ABORTED|Execution context was destroyed|frame was detached/i
                        .test(String(err && err.message || err));
                    if (!retryable || attempt === 2) throw err;
                }
            }
            await page.evaluate(() => {
                window.__e2eDockChanges = 0;
                let last = document.body.classList.contains('dock-hidden');
                window.__e2eDockObserver = new MutationObserver(() => {
                    const now = document.body.classList.contains('dock-hidden');
                    if (now !== last) { window.__e2eDockChanges++; last = now; }
                });
                window.__e2eDockObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
                window.__e2eHeights = new Set([document.documentElement.scrollHeight]);
                window.__e2eHeightTimer = setInterval(() => {
                    window.__e2eHeights.add(document.documentElement.scrollHeight);
                }, 16);
            });

            await wheel(page, 30, 22);
            await page.waitForTimeout(420);
            const result = await page.evaluate(() => {
                clearInterval(window.__e2eHeightTimer);
                window.__e2eDockObserver.disconnect();
                const dock = document.querySelector('.bottom-tab-bar');
                return {
                    autoHide: typeof window.resetDockAutoHide === 'function',
                    changes: window.__e2eDockChanges,
                    heights: Array.from(window.__e2eHeights),
                    hidden: document.body.classList.contains('dock-hidden'),
                    dockTop: Math.round(dock.getBoundingClientRect().top),
                    transform: getComputedStyle(dock).transform,
                    innerHeight: window.innerHeight,
                    shift: document.body.style.getPropertyValue('--dock-hide-shift'),
                    scrollY: Math.round(window.scrollY)
                };
            });
            const label = `${descriptor.name}: ` + JSON.stringify(result);
            expect(result.heights.length, 'the page height must not move while scrolling. ' + label).toBe(1);
            // No page-local travel variable here: the shared CSS fallback runs.
            expect(result.shift, 'only formularz sets --dock-hide-shift. ' + label).toBe('');
            expect(result.scrollY, 'the page must actually have scrolled. ' + label).toBeGreaterThan(100);

            if (!result.autoHide) {
                // Pre-existing on recipients.html: the script runs before the
                // dock markup, so auto-hide never armed. The shared change
                // must leave that exactly as it was - a dock that never moves.
                expect(result.changes, label).toBe(0);
                expect(result.hidden, label).toBe(false);
                expect(result.transform, label).toBe('none');
                return;
            }

            expect(result.changes, 'dock state changes for one gesture. ' + label).toBeLessThanOrEqual(2);
            expect(result.hidden, label).toBe(true);
            expect(result.dockTop, label).toBeGreaterThanOrEqual(result.innerHeight);

            await wheel(page, 3, -24);
            await page.waitForTimeout(420);
            const back = await page.evaluate(() => ({
                hidden: document.body.classList.contains('dock-hidden'),
                transform: getComputedStyle(document.querySelector('.bottom-tab-bar')).transform,
                opacity: getComputedStyle(document.querySelector('.bottom-tab-bar')).opacity
            }));
            expect(back.hidden, descriptor.name + ' ' + JSON.stringify(back)).toBe(false);
            expect(back.transform, descriptor.name + ' ' + JSON.stringify(back)).toBe('none');
            expect(back.opacity, descriptor.name + ' ' + JSON.stringify(back)).toBe('1');
        });
    }
});

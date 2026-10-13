'use strict';
/**
 * Shared setup for the add-present composer specs
 * (tests/e2e/composer-*.spec.js): selectors, openComposer(), the wheel
 * gesture helpers and the STATE / PROBE_FOCUS probes that run in the page.
 *
 * Background - the composer on /formularz, and its relationship with the
 * bottom dock.
 *
 * Two user complaints are pinned down here:
 *
 *  1. "I'm not sure if the add present bar needs to have + button when it's
 *     collapsed" - the compact bar carried a round green "+" submit roughly
 *     44px above the dock's own green "Dodaj" tab, and with an empty field it
 *     could not submit anything. The compact bar is now a single tappable
 *     "start adding" row: a decorative copy of the normal chevron (the real
 *     toggle takes its cell in add mode), a bordered prompt field spanning
 *     the rest of the row, and no submit button.
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
 *
 * Every composer describe repeats its own test.use() and the 90s
 * test.beforeEach() timeout on purpose: the timeout must apply to exactly
 * the tests it applied to before the spec was split, so it is not hoisted
 * into this module.
 *
 * STATE and PROBE_FOCUS are handed to page.evaluate(), which serialises
 * them with toString(): they must stay self-contained (no references to
 * anything outside their own body).
 */
const { expect } = require('../fixtures');
const { openPage } = require('./pages');

const FORMULARZ = { path: '/formularz', name: 'formularz', ready: '#myPresentsList .my-present-item' };

const COMPOSER = '#quickAddForm';
const NAME = '#quickAddTitle';
const DESC = '#quickAddComments';
const SUBMIT = '#quickAddBtn';
const TOGGLE = '#quickAddToggle';
const CLOSE = '#quickAddClose';
const CUE = '.quick-add-cue';
const DOCK = '.bottom-tab-bar';

const PHONES = [320, 375, 414];

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
        nameBox: { left: box.left, width: box.width, right: box.right, top: box.top },
        // Where the composer's content box ends: the inset the chevron circle
        // has on the left, mirrored on the right.
        formInnerRight: formRect.right - parseFloat(getComputedStyle(form).borderRightWidth) -
            parseFloat(getComputedStyle(form).paddingRight),
        formInnerLeft: formRect.left + parseFloat(getComputedStyle(form).borderLeftWidth) +
            parseFloat(getComputedStyle(form).paddingLeft),
        cueIcon: (function () {
            const i = document.querySelector('.quick-add-cue i');
            return i ? i.className : null;
        })(),
        toggleIcon: (function () {
            const i = document.querySelector('#quickAddToggle i');
            return i ? i.className : null;
        })(),
        // The cue must be a visual twin of the real toggle's collapsed look
        look: (function () {
            const pick = function (sel) {
                const el = document.querySelector(sel);
                const cs = getComputedStyle(el);
                const ics = getComputedStyle(el.querySelector('i'));
                return {
                    width: cs.width, height: cs.height, borderTopWidth: cs.borderTopWidth,
                    borderTopColor: cs.borderTopColor, borderRadius: cs.borderTopLeftRadius,
                    background: cs.backgroundColor, color: cs.color, iconSize: ics.fontSize,
                    iconTransform: ics.transform
                };
            };
            return { cue: pick('.quick-add-cue'), toggle: pick('#quickAddToggle') };
        })(),
        nameBorder: {
            width: parseFloat(nameStyle.borderTopWidth),
            color: nameStyle.borderTopColor,
            visibility: nameStyle.visibility,
            display: nameStyle.display,
            background: nameStyle.backgroundColor
        },
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

module.exports = {
    FORMULARZ,
    COMPOSER,
    NAME,
    DESC,
    SUBMIT,
    TOGGLE,
    CLOSE,
    CUE,
    DOCK,
    PHONES,
    openComposer,
    wheel,
    scrollUntilDockHidden,
    STATE,
    PROBE_FOCUS
};

'use strict';
/**
 * The add-present composer on /formularz: the collapsed bar, the swap into
 * add mode, the details row that opens with the form, and the scrim.
 * Shared setup lives in tests/helpers/composer.js.
 */
const { test, expect } = require('../fixtures');
const { activeDescription, describeFocus } = require('../helpers/focus');
const { COMPOSER, NAME, DESC, SUBMIT, TOGGLE, CLOSE, PHONES, STATE, PROBE_FOCUS, openComposer } =
    require('../helpers/composer');

test.describe('add-present composer', () => {
    // hasTouch so tap() is available; the viewport is set per test.
    test.use({ hasTouch: true, viewport: { width: 375, height: 750 } });

    // Several tests here walk three phone widths, each with a fresh page
    // load and ~1s of scripted scrolling - about 12s on a quiet machine, and
    // it measured 3x that when OneDrive was syncing this folder. The suite's
    // 30s default turned that slowness into a timeout inside page.goto,
    // which is a failure that says nothing about the composer.
    test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(90000); });

    test('the collapsed bar is [chevron] [full-width bordered input]: no submit, real controls unreachable', async ({ page }) => {
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
            expect(s.submit.visibility, `@${width}px the green submit button must be hidden: ${JSON.stringify(s.submit)}`).toBe('hidden');
            // The form stays visible when the bar is closed: a real, bordered
            // input (it used to be painted transparent).
            expect(s.nameBorder.display, `@${width}px ${JSON.stringify(s.nameBorder)}`).not.toBe('none');
            expect(s.nameBorder.visibility, `@${width}px the input must be visible: ${JSON.stringify(s.nameBorder)}`).toBe('visible');
            expect(s.nameBorder.width, `@${width}px the input needs a border: ${JSON.stringify(s.nameBorder)}`).toBeGreaterThanOrEqual(1);
            expect(s.nameBorder.color, `@${width}px the border must not be transparent: ${JSON.stringify(s.nameBorder)}`)
                .not.toMatch(/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$|^transparent$/);
            expect(s.nameBorder.background, `@${width}px the field must have a fill: ${JSON.stringify(s.nameBorder)}`)
                .not.toMatch(/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$|^transparent$/);
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
            // The leading icon is the NORMAL chevron, not a "+", and looks
            // exactly like the real toggle's collapsed look
            expect(s.cueIcon, `@${width}px the cue icon`).toContain('fa-chevron-up');
            expect(s.cueIcon, `@${width}px the cue icon must not be a plus`).not.toContain('fa-plus');
            expect(s.cueIcon, `@${width}px same icon as the real toggle`).toBe(s.toggleIcon);
            expect(s.look.cue, `@${width}px the cue must look like the real toggle`).toEqual(s.look.toggle);
            // The bordered input spans the whole row: its right edge sits on
            // the composer's inner right edge, mirroring the circle's inset
            // on the left (no empty strip where the submit column was)
            expect(Math.abs(s.nameBox.right - s.formInnerRight),
                `@${width}px input right edge ${s.nameBox.right} vs composer inner right ${s.formInnerRight}`)
                .toBeLessThanOrEqual(1);
            expect(Math.abs(s.cue.left - s.formInnerLeft),
                `@${width}px circle left ${s.cue.left} vs composer inner left ${s.formInnerLeft}`).toBeLessThanOrEqual(1);
            expect(s.formInnerRight - s.nameBox.right,
                `@${width}px right gap ${s.formInnerRight - s.nameBox.right}px, left gap ` +
                `${s.cue.left - s.formInnerLeft}px`).toBeLessThanOrEqual(1);
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

    test('entering and leaving add mode keeps the name field\'s left edge in place', async ({ page }) => {
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
            // The LEFT edge never moves. The width does, by design: collapsed
            // the input spans the (hidden) submit column, in add mode the
            // submit button takes it back - so the input is narrower by that
            // column and its right edge stops short of the button.
            expect(active.nameLeft, seen).toBe(collapsed.nameLeft);
            expect(back.nameLeft, seen).toBe(collapsed.nameLeft);
            expect(back.nameWidth, seen).toBe(collapsed.nameWidth);
            expect(active.nameWidth, seen).toBeLessThan(collapsed.nameWidth);
            expect(active.nameBox.right, seen + ` (submit left ${active.submit.left})`)
                .toBeLessThanOrEqual(active.submit.left);
            // The real submit button and the real chevron swap in, and the
            // decorative chevron out, in the cells already reserved
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

    test('entering add mode swaps the decorative chevron for the real one without shifting the input\'s left edge or row', async ({ page }) => {
        for (const width of [320, 375]) {
            await openComposer(page, width);
            const before = await page.evaluate(STATE);
            expect(before.cue.visibility, `@${width}px collapsed: decorative chevron`).toBe('visible');
            expect(before.toggle.visibility, `@${width}px collapsed: chevron`).toBe('hidden');
            expect(before.submit.visibility, `@${width}px collapsed: submit`).toBe('hidden');

            // Every animation frame from the tap until well after both
            // transitions have finished: the input's LEFT edge, its vertical
            // offset from the chevron circle (same grid row, so 0) and the
            // circle's own left edge must not move. The right edge and width
            // do move - the submit button takes its column back - and that
            // is instant, not animated.
            await page.evaluate(() => {
                const input = document.getElementById('quickAddTitle');
                const circle = document.getElementById('quickAddToggle'); // same cell as the decorative one
                const s = window.__nameFrames = { frames: [], run: true };
                (function tick() {
                    const r = input.getBoundingClientRect();
                    const c = circle.getBoundingClientRect();
                    s.frames.push({ left: r.left, width: r.width, rowOffset: r.top - c.top, circleLeft: c.left });
                    if (s.run) requestAnimationFrame(tick);
                })();
            });
            await page.locator(COMPOSER).tap();
            await page.waitForFunction(() => document.body.classList.contains('quick-add-active'));
            await page.waitForTimeout(500);
            const frames = await page.evaluate(() => { window.__nameFrames.run = false; return window.__nameFrames.frames; });
            const after = await page.evaluate(STATE);

            const lefts = frames.map(f => f.left);
            const offsets = frames.map(f => f.rowOffset);
            const circles = frames.map(f => f.circleLeft);
            const range = a => Math.max(...a) - Math.min(...a);
            const seen = `@${width}px input left/top/right before ${before.nameBox.left}/${before.nameBox.top}/${before.nameBox.right}, ` +
                `after ${after.nameBox.left}/${after.nameBox.top}/${after.nameBox.right} ` +
                `(width ${before.nameBox.width} -> ${after.nameBox.width}), ` +
                `over ${frames.length} frames: left ${Math.min(...lefts)}..${Math.max(...lefts)}, ` +
                `offset from circle ${Math.min(...offsets)}..${Math.max(...offsets)}, ` +
                `circle left ${Math.min(...circles)}..${Math.max(...circles)}`;
            console.log('SHIFT ' + seen);
            expect(Math.abs(after.nameBox.left - before.nameBox.left), seen).toBeLessThanOrEqual(1);
            expect(range(lefts), 'left drift during entry. ' + seen).toBeLessThanOrEqual(1);
            expect(range(offsets), 'vertical offset from the circle during entry. ' + seen).toBeLessThanOrEqual(1);
            expect(range(circles), 'circle left drift during entry. ' + seen).toBeLessThanOrEqual(1);
            // The width change is the submit column coming back: instant, once
            expect(after.nameBox.width, seen).toBeLessThan(before.nameBox.width);

            // Add mode: real chevron in, decorative one out, real submit in
            expect(after.toggle.visibility, `@${width}px add mode: chevron`).toBe('visible');
            expect(after.cue.visibility, `@${width}px add mode: decorative chevron`).toBe('hidden');
            expect(after.submit.visibility, `@${width}px add mode: submit`).toBe('visible');
            expect(after.expanded, `@${width}px details open with the form`).toBe(true);
            await expect(page.locator(TOGGLE)).toHaveAttribute('aria-expanded', 'true');
            // ...and the real toggle is focusable now
            await page.locator(TOGGLE).focus();
            expect(await page.evaluate(() => document.activeElement && document.activeElement.id),
                `@${width}px the real toggle must take focus in add mode`).toBe('quickAddToggle');

            // The chevron toggles the details textarea and keeps aria-expanded honest
            await page.locator(TOGGLE).click();
            await expect(page.locator(TOGGLE)).toHaveAttribute('aria-expanded', 'false');
            await expect(page.locator(COMPOSER)).not.toHaveClass(/is-expanded/);
            await page.locator(TOGGLE).click();
            await expect(page.locator(TOGGLE)).toHaveAttribute('aria-expanded', 'true');
            await expect(page.locator(COMPOSER)).toHaveClass(/is-expanded/);

            // Leaving restores the collapsed picture and aria-expanded
            await page.locator(CLOSE).click();
            await page.waitForFunction(() => !document.body.classList.contains('quick-add-active'));
            await page.waitForTimeout(400);
            const back = await page.evaluate(STATE);
            expect(back.cue.visibility, `@${width}px closed again: decorative chevron`).toBe('visible');
            expect(back.toggle.visibility, `@${width}px closed again: real chevron`).toBe('hidden');
            expect(Math.abs(back.nameBox.left - before.nameBox.left), seen).toBeLessThanOrEqual(1);
            expect(Math.abs(back.nameBox.right - before.nameBox.right), seen).toBeLessThanOrEqual(1);
            await expect(page.locator(TOGGLE)).toHaveAttribute('aria-expanded', 'false');
        }
    });

    test('a tap anywhere on the collapsed row opens the form and focuses the name field', async ({ page }) => {
        await openComposer(page, 375);
        const box = await page.locator(COMPOSER).boundingBox();
        const spots = [
            { label: 'the decorative chevron', x: box.x + 32, y: box.y + box.height / 2 },
            { label: 'the middle of the row', x: box.x + box.width / 2, y: box.y + box.height / 2 },
            { label: 'the right-hand end of the input, where the submit button used to be', x: box.x + box.width - 30, y: box.y + box.height / 2 }
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
});

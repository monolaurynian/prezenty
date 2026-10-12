'use strict';
/**
 * Accessibility smoke across every page under test.
 *
 * Two mechanical rules, both of which this app has broken before:
 *  - an icon-only control with no accessible name announces as just "button";
 *  - an element that is aria-hidden AND focusable puts a keyboard user on
 *    something a screen reader will not read out.
 *
 * This is a smoke check. Real WCAG conformance needs manual testing with
 * assistive technology and expert review - see tests/README.md.
 */
const { test, expect } = require('../fixtures');
const { PAGES, openPage, setViewport } = require('../helpers/pages');
const {
    iconOnlyButtonsWithoutName,
    focusableInsideAriaHidden,
    positiveTabIndexes
} = require('../helpers/a11y');

// The bottom dock and its two slide-out panels. Scoped OUT of the passing
// test below and covered by the fixme after it - see the comment there.
const DOCK = '.bottom-tab-bar, #bottom-tab-bar, #tabBarMenuPanel, #notificationsPanel, #tabBarOverlay';

test.describe('a11y smoke', () => {
    for (const descriptor of PAGES) {
        test(`${descriptor.name}: page content is reachable and announceable`, async ({ page }) => {
            await openPage(page, descriptor);

            const findings = [];
            for (const width of [375, 1024]) {
                await setViewport(page, width);

                // Everything outside the dock must name its icon-only controls.
                const unnamed = await iconOnlyButtonsWithoutName(page, DOCK);
                unnamed.forEach(u => findings.push(`@${width}px unnamed control: ${u.path}\n    ${u.html}`));

                // Nothing rendered may be aria-hidden and still focusable.
                const hiddenFocusable = await focusableInsideAriaHidden(page);
                hiddenFocusable.forEach(h => findings.push(
                    `@${width}px focusable inside aria-hidden ${h.insideHidden}: ${h.path}\n    ${h.html}`));

                // A positive tabindex rearranges tab order for the whole page.
                const positive = await positiveTabIndexes(page);
                positive.forEach(p => findings.push(`@${width}px positive tabindex=${p.tabindex}: ${p.html}`));
            }

            expect(findings.join('\n'), `${descriptor.name} accessibility findings`).toBe('');
        });
    }

    // PRODUCT BUG - not fixed here, and the assertion is NOT weakened: this is
    // the same check as above with no exclusions, kept as a fixme so the debt
    // stays visible.
    //
    // On every page, three dock controls have no accessible name:
    //   button.tab-bar-menu-close           (the menu panel's X)
    //   button.tab-bar-notifications-close  (the notifications panel's X)
    //   a.tab-item.messages-tab             (on /rezerwacje and /ustawienia the
    //                                        whole link renders EMPTY - no icon,
    //                                        no label, no name - yet it is still
    //                                        in the tab order. Its markup in
    //                                        those two files has an unclosed
    //                                        <div class="tab-icon-wrapper">.)
    // The first two live in public/bottom-tab-bar-snippet.html, which this task
    // may not write to. All three announce as a bare "button"/"link".
    for (const descriptor of PAGES) {
        test.fixme(`${descriptor.name}: EVERY icon-only control including the dock has a name`, async ({ page }) => {
            await openPage(page, descriptor);
            const findings = [];
            for (const width of [375, 1024]) {
                await setViewport(page, width);
                const unnamed = await iconOnlyButtonsWithoutName(page);
                unnamed.forEach(u => findings.push(`@${width}px unnamed control: ${u.path}\n    ${u.html}`));
            }
            expect(findings.join('\n'), `${descriptor.name} unnamed controls`).toBe('');
        });
    }
});

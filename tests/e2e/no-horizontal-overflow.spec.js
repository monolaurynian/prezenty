'use strict';
/**
 * No page may scroll sideways, at any phone or tablet width.
 *
 * This is the regression guard for a real bug: #chatMessages measured
 * scrollWidth 323 against clientWidth 317 at 320px - a 6px sideways scroll
 * that a screenshot does not show.
 *
 * Each page is checked twice per viewport:
 *   - as shipped, and
 *   - with `html, body { overflow-x: hidden }` neutralised, which proves the
 *     layout is structurally clean instead of merely clipped.
 *
 * Failures print the offending element path and the measured delta.
 */
const { test, expect } = require('../fixtures');
const { collectOverflow, describeOverflow } = require('../helpers/overflow');
const { PAGES, VIEWPORTS, openPage, setViewport } = require('../helpers/pages');

test.describe('no horizontal overflow', () => {
    for (const descriptor of PAGES) {
        test(`${descriptor.name} does not scroll sideways at any width`, async ({ page }) => {
            test.slow(); // six viewports, two measurements each
            await openPage(page, descriptor);

            const problems = [];
            for (const width of VIEWPORTS) {
                await setViewport(page, width);

                for (const ignoreGuard of [false, true]) {
                    const report = await collectOverflow(page, { ignoreGuard });
                    const label = `${descriptor.name} @${width}px${ignoreGuard ? ' (guard off)' : ''}`;

                    if (report.rootScroll.delta > 0.5 || report.scrollers.length || report.offenders.length) {
                        problems.push(describeOverflow(label, report));
                    }
                }
            }

            expect(problems.join('\n\n'), 'horizontal overflow detected').toBe('');
        });
    }
});

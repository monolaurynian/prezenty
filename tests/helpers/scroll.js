'use strict';
/**
 * Frame-accurate scrollY sampling around an action.
 *
 * "Did the page jump?" cannot be answered by a before/after pair - the jump
 * often happens and self-corrects within a few frames, which is exactly what
 * the user sees as "jumpy". Sampling at 0/60/150/300/450 ms catches it.
 *
 * Used by tests/e2e/composer-dock.spec.js.
 */

const START = function (marks) {
    window.__e2eScrollSamples = [];
    const start = performance.now();
    const target = document.scrollingElement || document.documentElement;
    const sample = () => {
        const t = performance.now() - start;
        window.__e2eScrollSamples.push({ t: Math.round(t), scrollY: Math.round(window.scrollY), scrollTop: Math.round(target.scrollTop) });
    };
    sample();
    marks.forEach(ms => setTimeout(sample, ms));
    return true;
};

const READ = function () {
    return window.__e2eScrollSamples || [];
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<unknown>} action
 * @param {number[]} [marks]
 */
async function sampleScrollY(page, action, marks) {
    const at = marks || [60, 150, 300, 450];
    await page.evaluate(START, at);
    await action();
    await page.waitForFunction(
        (count) => (window.__e2eScrollSamples || []).length >= count,
        at.length + 1,
        { timeout: Math.max(...at) + 2000 }
    );
    return page.evaluate(READ);
}

function describeSamples(label, samples) {
    return label + ': ' + samples.map(s => `${s.t}ms=${s.scrollY}px`).join(', ');
}

module.exports = { sampleScrollY, describeSamples };
